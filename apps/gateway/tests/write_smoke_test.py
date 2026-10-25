#!/usr/bin/env python3
import json
import os
import subprocess
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "bin" / "oakb-mcp"
VAULT = Path(os.environ["KB_VAULT_ROOT"]).expanduser().resolve()
token = datetime.now().strftime("%Y%m%d-%H%M%S")

requests = [
    {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "write-smoke", "version": "0"}}},
    {"jsonrpc": "2.0", "method": "notifications/initialized"},
    {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "kb_create_inbox_card", "arguments": {"title": f"Knowledge MCP write smoke {token}", "content": "This file was created through the local Knowledge MCP Gateway.", "tags": ["mcp", "smoke-test"], "slug": f"mcp-write-smoke-{token}"}}},
    {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "kb_create_session_note", "arguments": {"title": f"Knowledge MCP write smoke {token}", "content": "Gateway write path verified.", "result": "completed", "slug": f"mcp-write-smoke-{token}"}}},
    {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "kb_propose_update", "arguments": {"target_path": "07-maps/ACTIVE-CONTEXT.md", "reason": "Gateway proposal smoke test", "proposed_content": "# Active Context\n\nMCP proposal path verified.", "slug": f"mcp-proposal-smoke-{token}"}}},
    {"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "kb_create_inbox_card", "arguments": {"title": "bad secret", "content": "API_KEY = 'abcdefghijklmnopqrstuvwxyz123456'", "slug": f"bad-secret-{token}"}}},
]

payload = "".join(json.dumps(x, ensure_ascii=False) + "\n" for x in requests)
proc = subprocess.run([str(SERVER)], input=payload, text=True, capture_output=True, env={**os.environ, "KB_AGENT_ID": os.environ.get("KB_AGENT_ID", "codex")}, timeout=15)
lines = [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]
by_id = {msg.get("id"): msg for msg in lines if msg.get("id") is not None}
for i in (2, 3, 4):
    assert by_id[i]["result"]["isError"] is False
assert by_id[5].get("error", {}).get("code") == -32003
created = [by_id[i]["result"]["structuredContent"]["vault_path"] for i in (2, 3, 4)]
for rel in created:
    path = VAULT / rel
    if path.exists():
        path.unlink()
print("write smoke test: PASS")
print("created and cleaned:", ", ".join(created))
