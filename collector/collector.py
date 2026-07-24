import threading
from kubernetes import client, config, watch
from kubernetes.config.config_exception import ConfigException
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

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

def main():
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

    try:
        for t in threads:
            t.join()
    except KeyboardInterrupt:
        print("\nShutting down watchers...")

if __name__ == '__main__':
    main()