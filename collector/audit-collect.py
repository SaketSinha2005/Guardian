import os
import re
import json
import time
import subprocess
from datetime import datetime
import yaml

OUTPUT_FILE = "/data/audit_dump.txt"
SCAN_INTERVAL_SECONDS = 60
STATE_FILE = "/data/.audit_scan_state.json"
TARGET_NAMESPACE = "default"   # only events in this namespace are written out


def find_audit_log():
    """Find the real audit log path from the actual apiserver flag (ground truth),
    not guesswork."""
    try:
        for pid in os.listdir("/proc"):
            if not pid.isdigit():
                continue
            try:
                with open(f"/proc/{pid}/cmdline", "rb") as f:
                    cmdline = f.read().decode(errors="ignore")
            except (FileNotFoundError, PermissionError):
                continue
            if "kube-apiserver" in cmdline:
                for arg in cmdline.split("\x00"):
                    if arg.startswith("--audit-log-path="):
                        path = arg.split("=", 1)[1]
                        if path and path != "-":
                            return path
    except FileNotFoundError:
        pass

    manifest_path = "/etc/kubernetes/manifests/kube-apiserver.yaml"
    if os.path.isfile(manifest_path):
        try:
            with open(manifest_path) as f:
                manifest = yaml.safe_load(f)
            for c in manifest.get("spec", {}).get("containers", []):
                for cmd in c.get("command", []):
                    m = re.match(r"--audit-log-path=(.+)", cmd)
                    if m and m.group(1) != "-":
                        return m.group(1)
        except Exception:
            pass

    try:
        out = subprocess.run(
            ["kubectl", "get", "pod", "-n", "kube-system",
             "-l", "component=kube-apiserver",
             "-o", "jsonpath={.items[0].spec.containers[0].command}"],
            capture_output=True, text=True, timeout=5
        )
        if out.returncode == 0 and out.stdout:
            m = re.search(r"--audit-log-path=(\S+)", out.stdout)
            if m and m.group(1) != "-":
                return m.group(1)
    except FileNotFoundError:
        pass

    return None


def load_state():
    if os.path.isfile(STATE_FILE):
        try:
            with open(STATE_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return {"offset": 0}


def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f)


def dump_event(event, out_fp):
    """Write EVERY field of the event, fully expanded, no filtering."""
    out_fp.write("\n" + "=" * 80 + "\n")
    out_fp.write(f"SCANNED AT: {datetime.now().isoformat()}\n")
    out_fp.write("=" * 80 + "\n")
    out_fp.write(json.dumps(event, indent=2, sort_keys=True, default=str))
    out_fp.write("\n")


def event_namespace(event):
    """Extract the namespace an audit event applies to, if any.
    Most requests carry it under objectRef.namespace; cluster-scoped
    requests (e.g. node watches) simply won't have one."""
    return event.get("objectRef", {}).get("namespace")


def scan_once(audit_log_path, state):
    if not os.path.isfile(audit_log_path):
        print(f"[{datetime.now()}] Audit log not found at {audit_log_path}, skipping scan.")
        return state

    file_size = os.path.getsize(audit_log_path)

    if state["offset"] > file_size:
        state["offset"] = 0

    new_events = 0
    skipped_events = 0
    with open(audit_log_path, "r") as fp, open(OUTPUT_FILE, "a") as out_fp:
        fp.seek(state["offset"])
        for line in fp:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
                if event_namespace(event) == TARGET_NAMESPACE:
                    dump_event(event, out_fp)
                    new_events += 1
                else:
                    skipped_events += 1
            except json.JSONDecodeError:
                out_fp.write("\n[UNPARSEABLE LINE]\n")
                out_fp.write(line + "\n")
        state["offset"] = fp.tell()

    print(
        f"[{datetime.now()}] Scan complete: {new_events} new '{TARGET_NAMESPACE}' "
        f"event(s) written to {OUTPUT_FILE} ({skipped_events} other-namespace event(s) skipped)"
    )
    return state


def main():
    audit_log_path = find_audit_log()
    if audit_log_path is None:
        print("No audit log found (checked running process, static manifest, kubectl).")
        return

    print(f"Audit log found at: {audit_log_path}")
    print(f"Filtering to namespace: {TARGET_NAMESPACE}")
    print(f"Writing filtered event dumps to: {OUTPUT_FILE}")
    print(f"Scanning every {SCAN_INTERVAL_SECONDS} seconds. Ctrl+C to stop.")

    state = load_state()

    try:
        while True:
            state = scan_once(audit_log_path, state)
            save_state(state)
            time.sleep(SCAN_INTERVAL_SECONDS)
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()