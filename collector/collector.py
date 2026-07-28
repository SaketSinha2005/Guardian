import threading
import yaml
from datetime import datetime, timezone
from flask import Flask, jsonify
from flask_cors import CORS
from kubernetes import client, config, watch
from kubernetes.config.config_exception import ConfigException
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

HTTP_PORT = 8000

app = Flask(__name__)
CORS(app)

# Set in main() after client config loads; the Flask routes read from these.
core_v1 = None
apps_v1 = None


def watch_resource(api_function, resource_name):
    w = watch.Watch()
    while True:
        try:
            print(f"Starting watch for: {resource_name}")
            for event in w.stream(api_function):
                event_type = event['type']
                obj = event['object']
                print(f"[{resource_name}] {event_type} - {obj.metadata.namespace}/{obj.metadata.name}")
        except Exception as e:
            print(f"Watch connection for {resource_name} dropped: {e}. Reconnecting...")


def pod_age(pod):
    if not pod.metadata.creation_timestamp:
        return "unknown"
    delta = datetime.now(timezone.utc) - pod.metadata.creation_timestamp
    total_seconds = int(delta.total_seconds())
    if total_seconds < 60:
        return f"{total_seconds}s"
    if total_seconds < 3600:
        return f"{total_seconds // 60}m"
    if total_seconds < 86400:
        return f"{total_seconds // 3600}h"
    return f"{total_seconds // 86400}d"


def to_yaml(obj):
    obj_dict = client.ApiClient().sanitize_for_serialization(obj)
    return yaml.dump(obj_dict, default_flow_style=False, sort_keys=False)


def find_owning_deployment(pod):
    """Pod -> ReplicaSet (via ownerReferences) -> Deployment (via the
    ReplicaSet's own ownerReferences). Returns None if the pod isn't
    managed by a Deployment (e.g. a bare Pod, or owned by a DaemonSet/Job)."""
    for owner in pod.metadata.owner_references or []:
        if owner.kind == "ReplicaSet":
            try:
                rs = apps_v1.read_namespaced_replica_set(name=owner.name, namespace=pod.metadata.namespace)
            except client.exceptions.ApiException:
                return None
            for rs_owner in rs.metadata.owner_references or []:
                if rs_owner.kind == "Deployment":
                    try:
                        return apps_v1.read_namespaced_deployment(name=rs_owner.name, namespace=pod.metadata.namespace)
                    except client.exceptions.ApiException:
                        return None
    return None


def find_matching_services(pod):
    """Services in the same namespace whose selector is a subset of the
    pod's labels - the same matching logic Kubernetes itself uses."""
    matches = []
    try:
        services = core_v1.list_namespaced_service(namespace=pod.metadata.namespace)
    except client.exceptions.ApiException:
        return matches

    pod_labels = pod.metadata.labels or {}
    for svc in services.items:
        selector = svc.spec.selector or {}
        if not selector:
            continue
        if all(pod_labels.get(k) == v for k, v in selector.items()):
            matches.append(svc)
    return matches


@app.route("/api/pods")
def list_pods():
    """List every currently running pod across the whole cluster."""
    try:
        pods = core_v1.list_pod_for_all_namespaces()
    except client.exceptions.ApiException as e:
        return jsonify({"error": str(e)}), 502

    result = []
    for pod in pods.items:
        if pod.status.phase != "Running":
            continue
        container_statuses = pod.status.container_statuses or []
        ready_count = sum(1 for c in container_statuses if c.ready)
        total_count = len(container_statuses)
        restart_count = sum(c.restart_count for c in container_statuses)
        result.append({
            "name": pod.metadata.name,
            "namespace": pod.metadata.namespace,
            "status": pod.status.phase,
            "ready": f"{ready_count}/{total_count}",
            "restarts": restart_count,
            "node": pod.spec.node_name,
            "age": pod_age(pod),
        })

    return jsonify({"count": len(result), "pods": result})


@app.route("/api/pods/<namespace>/<pod_name>/resources")
def pod_resources(namespace, pod_name):
    """Full manifest bundle for one pod: the pod itself, its owning
    Deployment (if any), any Services that select it, and the
    ServiceAccount it runs as."""
    try:
        pod = core_v1.read_namespaced_pod(name=pod_name, namespace=namespace)
    except client.exceptions.ApiException as e:
        status = 404 if e.status == 404 else 502
        return jsonify({"error": str(e)}), status

    bundle = {
        "pod": to_yaml(pod),
        "deployment": None,
        "services": [],
        "serviceaccount": None,
    }

    deployment = find_owning_deployment(pod)
    if deployment:
        bundle["deployment"] = to_yaml(deployment)

    for svc in find_matching_services(pod):
        bundle["services"].append({"name": svc.metadata.name, "yaml": to_yaml(svc)})

    sa_name = pod.spec.service_account_name or "default"
    try:
        sa = core_v1.read_namespaced_service_account(name=sa_name, namespace=namespace)
        bundle["serviceaccount"] = to_yaml(sa)
    except client.exceptions.ApiException:
        pass  # SA might not be readable/found; leave as None rather than failing the whole request

    return jsonify(bundle)


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


def start_api_server():
    print(f"Pod API serving on :{HTTP_PORT} (GET /api/pods, GET /api/pods/<ns>/<name>/resources)")
    app.run(host="0.0.0.0", port=HTTP_PORT, use_reloader=False)


def main():
    global core_v1, apps_v1

    try:
        config.load_incluster_config()
        print("Using in-cluster Kubernetes configuration")
    except ConfigException:
        config.load_kube_config()
        print("Using local kubeconfig")

    core_v1 = client.CoreV1Api()
    apps_v1 = client.AppsV1Api()
    rbac_v1 = client.RbacAuthorizationV1Api()

    watch_tasks = {
        "Pods": core_v1.list_pod_for_all_namespaces,
        "Services": core_v1.list_service_for_all_namespaces,
        "ServiceAccounts": core_v1.list_service_account_for_all_namespaces,
        "Deployments": apps_v1.list_deployment_for_all_namespaces,
        "Roles": rbac_v1.list_role_for_all_namespaces,
        "RoleBindings": rbac_v1.list_role_binding_for_all_namespaces
    }

    threads = []

    for name, api_func in watch_tasks.items():
        t = threading.Thread(target=watch_resource, args=(api_func, name), daemon=True)
        threads.append(t)
        t.start()

    api_thread = threading.Thread(target=start_api_server, daemon=True)
    threads.append(api_thread)
    api_thread.start()

    try:
        for t in threads:
            t.join()
    except KeyboardInterrupt:
        print("\nShutting down watchers...")


if __name__ == '__main__':
    main()