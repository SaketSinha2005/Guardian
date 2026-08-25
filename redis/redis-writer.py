import os
import json
import time
import redis
from datetime import datetime

DUMP_FILE = os.environ.get("DUMP_FILE", "/data/audit_dump.txt")
REDIS_HOST = os.environ.get("REDIS_HOST", "localhost")
REDIS_PORT = int(os.environ.get("REDIS_PORT", 6379))
REDIS_DB = int(os.environ.get("REDIS_DB", 0))
OFFSET_KEY = "guardian:dump_offset"
POD_EVENTS_MAX = 200          # max raw events kept per pod
SCAN_INTERVAL = 5             # seconds

SEPARATOR = "=" * 80

r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=REDIS_DB, decode_responses=True)


# ─── helpers ────────────────────────────────────────────────────────────────

def get_offset() -> int:
    val = r.get(OFFSET_KEY)
    return int(val) if val else 0


def set_offset(offset: int):
    r.set(OFFSET_KEY, offset)


def extract_pod_name(event: dict) -> str | None:
    """
    Return the pod name this event is about, or None if it's not pod-related.
    Audit events reference pods in two ways:
      1. objectRef.resource == 'pods'  → objectRef.name is the pod
      2. objectRef.resource is something else but has a pod subresource
         (e.g. pods/log, pods/exec) — still use objectRef.name
    """
    obj = event.get("objectRef", {})
    resource = obj.get("resource", "")
    if resource == "pods" or resource.startswith("pods/"):
        name = obj.get("name")
        if name:
            return name
    return None


def index_event(event: dict):
    """Push one audit event into the Redis structures for its pod."""
    pod = extract_pod_name(event)
    if not pod:
        return  # not a pod-targeted event

    namespace = event.get("objectRef", {}).get("namespace")
    verb      = event.get("verb", "unknown")
    user      = event.get("user", {}).get("username", "unknown")
    resource  = event.get("objectRef", {}).get("resource", "unknown")
    stage     = event.get("stage", "")
    code      = str(event.get("responseStatus", {}).get("code", ""))
    ts        = event.get("requestReceivedTimestamp", datetime.now().isoformat())

    pipe = r.pipeline()

    # 1. Raw event list (capped)
    slim = {
        "auditID":    event.get("auditID", ""),
        "verb":       verb,
        "user":       user,
        "resource":   resource,
        "subresource": event.get("objectRef", {}).get("subresource", ""),
        "namespace":  namespace,
        "stage":      stage,
        "code":       code,
        "ts":         ts,
    }
    pipe.lpush(f"pod:{pod}:events", json.dumps(slim))
    pipe.ltrim(f"pod:{pod}:events",  0, POD_EVENTS_MAX - 1)

    # 2. Verb counts
    pipe.hincrby(f"pod:{pod}:verbs", verb, 1)

    # 3. User/serviceaccount counts
    pipe.hincrby(f"pod:{pod}:users", user, 1)

    # 4. Resource counts (e.g. pods, configmaps, secrets)
    pipe.hincrby(f"pod:{pod}:resources", resource, 1)

    # 5. HTTP response code counts
    if code:
        pipe.hincrby(f"pod:{pod}:response_codes", code, 1)

    # 6. Stage counts (RequestReceived / ResponseStarted / ResponseComplete / Panic)
    pipe.hincrby(f"pod:{pod}:stages", stage, 1)

    # 7. Last-seen timestamp
    pipe.set(f"pod:{pod}:last_seen", ts)

    # 8. Global pod registry for this namespace
    pipe.sadd(f"namespace:{namespace}:pods", pod)

    pipe.execute()


# ─── main tail loop ─────────────────────────────────────────────────────────

def parse_raw_block(block: str) -> dict | None:
    """
    audit_dump.txt blocks look like:
        ================...
        SCANNED AT: <iso>
        ================...
        { ...json... }
    Strip the headers and parse the JSON portion.
    """
    block = block.strip()
    if not block:
        return None
    lines = block.splitlines()
    json_lines = []
    skip_next = False
    for line in lines:
        if line.startswith("SCANNED AT:"):
            skip_next = True
            continue
        if skip_next:
            skip_next = False
            continue
        json_lines.append(line)
    raw = "\n".join(json_lines).strip()
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def tail_dump_file():
    """Read only new content from audit_dump.txt since last offset."""
    if not os.path.isfile(DUMP_FILE):
        print(f"[{datetime.now()}] Dump file not found, waiting…")
        return

    file_size = os.path.getsize(DUMP_FILE)
    offset = get_offset()

    # Handle truncation / rotation
    if offset > file_size:
        print(f"[{datetime.now()}] File shrunk — resetting offset.")
        offset = 0

    if offset == file_size:
        return  # nothing new

    with open(DUMP_FILE, "r") as f:
        f.seek(offset)
        new_content = f.read()
        new_offset = f.tell()

    # Split on the separator; each chunk is one event block
    blocks = new_content.split(SEPARATOR)
    indexed = 0
    for block in blocks:
        event = parse_raw_block(block)
        if event:
            index_event(event)
            indexed += 1

    set_offset(new_offset)
    if indexed:
        print(f"[{datetime.now()}] Indexed {indexed} pod event(s) into Redis. Offset → {new_offset}")


def main():
    print(f"Redis writer started. Watching: {DUMP_FILE}")
    print(f"Redis: {REDIS_HOST}:{REDIS_PORT} db={REDIS_DB}")
    while True:
        try:
            tail_dump_file()
        except Exception as e:
            print(f"[{datetime.now()}] Error: {e}")
        time.sleep(SCAN_INTERVAL)


if __name__ == "__main__":
    main()