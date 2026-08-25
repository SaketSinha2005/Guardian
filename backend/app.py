import os
import json
import redis
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

DUMP_FILE    = os.environ.get("DUMP_FILE", "/data/audit_dump.txt")
REDIS_HOST   = os.environ.get("REDIS_HOST", "localhost")
REDIS_PORT   = int(os.environ.get("REDIS_PORT", 6379))
REDIS_DB     = int(os.environ.get("REDIS_DB", 0))
DEFAULT_LIMIT = 50
SEPARATOR    = "=" * 80

# Redis client — fail gracefully if Redis is not yet up
try:
    r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=REDIS_DB, decode_responses=True)
    r.ping()
    REDIS_OK = True
except Exception:
    r = None
    REDIS_OK = False


# ─── existing file-based endpoint (unchanged) ────────────────────────────────

def parse_events_from_dump(path, limit=DEFAULT_LIMIT):
    if not os.path.isfile(path):
        return []
    with open(path, "r") as f:
        content = f.read()
    blocks = content.split(SEPARATOR)
    events = []
    for block in blocks:
        block = block.strip()
        if not block or block.startswith("SCANNED AT") or block.startswith("[UNPARSEABLE LINE]"):
            continue
        try:
            events.append(json.loads(block))
        except json.JSONDecodeError:
            continue
    recent = events[-limit:]
    recent.reverse()
    return recent


@app.route("/api/logs")
def get_logs():
    events = parse_events_from_dump(DUMP_FILE, DEFAULT_LIMIT)
    return jsonify({"count": len(events), "events": events})


# ─── Redis-backed pod endpoints ───────────────────────────────────────────────

def redis_required(fn):
    """Decorator — return 503 when Redis is unavailable."""
    from functools import wraps
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not REDIS_OK or r is None:
            return jsonify({"error": "Redis unavailable"}), 503
        return fn(*args, **kwargs)
    return wrapper


@app.route("/api/pods")
@redis_required
def list_pods():
    """
    List all pods seen in a namespace.
    Query params:
      namespace (default: "default")
    """
    ns = request.args.get("namespace", "default")
    pods = sorted(r.smembers(f"namespace:{ns}:pods"))
    return jsonify({"namespace": ns, "count": len(pods), "pods": pods})


@app.route("/api/pods/<pod_name>")
@redis_required
def get_pod_summary(pod_name: str):
    """
    Full summary for one pod:
      - verb counts
      - user/serviceaccount counts
      - resource counts
      - HTTP response code counts
      - stage counts
      - last seen timestamp
      - recent events (last N, default 20)
    """
    limit = int(request.args.get("limit", 20))

    # Check pod exists
    if not r.exists(f"pod:{pod_name}:last_seen"):
        return jsonify({"error": f"Pod '{pod_name}' not found in Redis"}), 404

    verbs          = r.hgetall(f"pod:{pod_name}:verbs")
    users          = r.hgetall(f"pod:{pod_name}:users")
    resources      = r.hgetall(f"pod:{pod_name}:resources")
    response_codes = r.hgetall(f"pod:{pod_name}:response_codes")
    stages         = r.hgetall(f"pod:{pod_name}:stages")
    last_seen      = r.get(f"pod:{pod_name}:last_seen")
    raw_events     = r.lrange(f"pod:{pod_name}:events", 0, limit - 1)

    events = []
    for e in raw_events:
        try:
            events.append(json.loads(e))
        except json.JSONDecodeError:
            pass

    # Cast all count values to int
    def to_int(d):
        return {k: int(v) for k, v in d.items()}

    return jsonify({
        "pod":            pod_name,
        "last_seen":      last_seen,
        "verb_counts":    to_int(verbs),
        "user_counts":    to_int(users),
        "resource_counts": to_int(resources),
        "response_codes": to_int(response_codes),
        "stage_counts":   to_int(stages),
        "total_events":   sum(to_int(verbs).values()),
        "recent_events":  events,
    })


@app.route("/api/pods/<pod_name>/verbs")
@redis_required
def get_pod_verbs(pod_name: str):
    """Verb counts only — lightweight endpoint for dashboards."""
    verbs = r.hgetall(f"pod:{pod_name}:verbs")
    if not verbs:
        return jsonify({"error": f"Pod '{pod_name}' not found"}), 404
    return jsonify({
        "pod":        pod_name,
        "verb_counts": {k: int(v) for k, v in verbs.items()},
        "total":      sum(int(v) for v in verbs.values()),
    })


@app.route("/api/pods/<pod_name>/events")
@redis_required
def get_pod_events(pod_name: str):
    """
    Paginated raw events for a pod.
    Query params:
      limit  (default 50, max 200)
      offset (default 0)
      verb   (optional filter: get / list / watch / create / delete …)
    """
    limit  = min(int(request.args.get("limit", 50)), 200)
    offset = int(request.args.get("offset", 0))
    verb_filter = request.args.get("verb", "").lower()

    raw = r.lrange(f"pod:{pod_name}:events", 0, -1)  # newest first
    events = []
    for e in raw:
        try:
            parsed = json.loads(e)
            if verb_filter and parsed.get("verb", "").lower() != verb_filter:
                continue
            events.append(parsed)
        except json.JSONDecodeError:
            pass

    page = events[offset: offset + limit]
    return jsonify({
        "pod":    pod_name,
        "total":  len(events),
        "offset": offset,
        "limit":  limit,
        "events": page,
    })


@app.route("/api/pods/<pod_name>/users")
@redis_required
def get_pod_users(pod_name: str):
    """Which users / service accounts have touched this pod and how many times."""
    users = r.hgetall(f"pod:{pod_name}:users")
    if not users:
        return jsonify({"error": f"Pod '{pod_name}' not found"}), 404
    sorted_users = sorted(users.items(), key=lambda x: int(x[1]), reverse=True)
    return jsonify({
        "pod":   pod_name,
        "users": [{"user": u, "count": int(c)} for u, c in sorted_users],
    })


# ─── health ──────────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    redis_alive = False
    if r:
        try:
            r.ping()
            redis_alive = True
        except Exception:
            pass
    return jsonify({
        "status":          "ok",
        "dump_file_exists": os.path.isfile(DUMP_FILE),
        "redis":           redis_alive,
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)