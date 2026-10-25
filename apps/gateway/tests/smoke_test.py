#!/usr/bin/env python3
import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "bin" / "oakb-mcp"

requests = [
    {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "smoke", "version": "0"}}},
    {"jsonrpc": "2.0", "method": "notifications/initialized"},
    {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
    {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "kb_get_context", "arguments": {}}},
    {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "kb_get_status", "arguments": {}}},
    {"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "kb_search", "arguments": {"query": "SPEC-WRITE-TEST-V1", "limit": 5}}},
]

payload = "".join(json.dumps(x, ensure_ascii=False) + "\n" for x in requests)
proc = subprocess.run(
    [str(SERVER)],
    input=payload,
    text=True,
    capture_output=True,
    env={**os.environ, "KB_AGENT_ID": os.environ.get("KB_AGENT_ID", "codex")},
    timeout=15,
)
if proc.returncode != 0:
    raise SystemExit(f"server exited {proc.returncode}: {proc.stderr}")
lines = [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]
by_id = {msg.get("id"): msg for msg in lines if msg.get("id") is not None}
assert 1 in by_id and "result" in by_id[1]
assert 2 in by_id and len(by_id[2]["result"]["tools"]) == 8
assert 3 in by_id and by_id[3]["result"]["structuredContent"]["agent_id"] == "codex"
assert 4 in by_id and "result" in by_id[4]
assert 5 in by_id and by_id[5]["result"]["structuredContent"]["count"] >= 1
print("smoke test: PASS")
print("tools:", ", ".join(t["name"] for t in by_id[2]["result"]["tools"]))
