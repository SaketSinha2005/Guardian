import os
import json
from flask import Flask, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  

DUMP_FILE = os.environ.get("DUMP_FILE", "/data/audit_dump.txt")
DEFAULT_LIMIT = 50
SEPARATOR = "=" * 80


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
            event = json.loads(block)
            events.append(event)
        except json.JSONDecodeError:
            continue

    recent = events[-limit:]
    recent.reverse()
    return recent


@app.route("/api/logs")
def get_logs():
    events = parse_events_from_dump(DUMP_FILE, DEFAULT_LIMIT)
    return jsonify({
        "count": len(events),
        "events": events,
    })


@app.route("/health")
def health():
    return jsonify({"status": "ok", "dump_file_exists": os.path.isfile(DUMP_FILE)})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)