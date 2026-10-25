from __future__ import annotations

import json
import os
import re
import sys
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
_default_config = ROOT / "config" / "gateway.json"
_local_config = ROOT / "config" / "gateway.local.json"
CONFIG_PATH = Path(os.environ.get("KB_CONFIG_PATH", _local_config if _local_config.exists() else _default_config))
CONFIG = json.loads(CONFIG_PATH.read_text("utf-8")) if CONFIG_PATH.exists() else {}
VAULT = Path(os.environ.get("KB_VAULT_ROOT", CONFIG.get("vault_root", "."))).expanduser().resolve()
AGENT_ID = os.environ.get("KB_AGENT_ID", "").strip().lower()
_config_agents = CONFIG.get("agents") or os.environ.get("KB_AGENT_IDS", "").split(",")
REGISTERED_IDS = {str(item).strip().lower() for item in _config_agents if str(item).strip()}
READ_CONTEXT_FILES = [
    "AGENTS.md",
    "00-contract/AGENT-CONTRACT.md",
    "00-contract/CONTEXT-PACK.md",
    "00-contract/GLOSSARY.md",
    "00-contract/DECISION-INDEX.md",
    "07-maps/ACTIVE-CONTEXT.md",
    "00-contract/AGENT-REGISTRY.md",
    "00-contract/SPEC-MCP-INTEGRATION-V1.md",
]
PROTECTED_PARTS = {".git", ".obsidian"}
SECRET_PATTERNS = [
    re.compile(r"-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----"),
    re.compile(r"(?i)\b(?:api[_-]?key|secret|token|password|passwd|pwd)\b\s*[:=]\s*['\"]?[A-Za-z0-9_\-]{16,}"),
    re.compile(r"(?i)\b(?:mysql|postgres|postgresql|mongodb(?:\+srv)?|redis)://[^\s/:]+:[^\s@]+@"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bsk-[A-Za-z0-9]{20,}\b"),
]


class JsonRpcError(Exception):
    def __init__(self, code: int, message: str, data: Any = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data


def utc_now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def now_parts() -> tuple[str, str, str, str, str, str]:
    d = datetime.now()
    return (
        d.strftime("%Y"),
        d.strftime("%m"),
        d.strftime("%d"),
        d.strftime("%Y-%m-%d"),
        d.strftime("%Y%m%d"),
        d.strftime("%H%M"),
    )


def slugify(value: str, max_len: int = 64) -> str:
    value = unicodedata.normalize("NFKC", value).strip().lower()
    value = re.sub(r"[^\w\s-]", "", value, flags=re.UNICODE)
    value = re.sub(r"[\s_]+", "-", value).strip("-")
    value = re.sub(r"-{2,}", "-", value)
    value = value[:max_len].rstrip("-")
    return value or "note"


def require_agent() -> str:
    if not AGENT_ID:
        raise JsonRpcError(-32000, "KB_AGENT_ID is required")
    if AGENT_ID not in REGISTERED_IDS:
        raise JsonRpcError(-32000, f"unregistered agent_id: {AGENT_ID}")
    return AGENT_ID


def audit(tool: str, target: str, result: str, error: str | None = None, bytes_written: int | None = None) -> None:
    y, m, d, *_ = now_parts()
    audit_dir = ROOT / "runtime" / "audit" / y / m
    audit_dir.mkdir(parents=True, exist_ok=True)
    record: dict[str, Any] = {
        "timestamp": utc_now(),
        "agent_id": AGENT_ID or None,
        "tool": tool,
        "target": target,
        "result": result,
    }
    if bytes_written is not None:
        record["bytes"] = bytes_written
    if error:
        record["error"] = error[:1000]
    path = audit_dir / f"{d}.jsonl"
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")


def safe_vault_path(raw: str, *, must_exist: bool = True, md_only: bool = False) -> Path:
    if not isinstance(raw, str) or not raw.strip():
        raise JsonRpcError(-32602, "path is required")
    p = Path(raw.strip())
    candidate = p if p.is_absolute() else VAULT / p
    try:
        resolved = candidate.resolve(strict=False)
    except OSError as exc:
        raise JsonRpcError(-32602, f"invalid path: {exc}") from exc
    if VAULT not in resolved.parents and resolved != VAULT:
        raise JsonRpcError(-32001, "path escapes vault")
    rel = resolved.relative_to(VAULT)
    if any(part in PROTECTED_PARTS for part in rel.parts):
        raise JsonRpcError(-32001, "protected directory is not readable")
    if md_only and resolved.suffix.lower() != ".md":
        raise JsonRpcError(-32602, "only .md files are supported")
    if must_exist and not resolved.is_file():
        raise JsonRpcError(-32002, f"note not found: {rel.as_posix()}")
    return resolved


def detect_secret(text: str) -> str | None:
    for pattern in SECRET_PATTERNS:
        match = pattern.search(text)
        if match:
            return f"potential secret matched: {pattern.pattern}"
    return None


def ensure_frontmatter_value(value: str) -> str:
    value = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{value}"'


def write_audit_and_file(tool: str, target: Path, content: str) -> dict[str, Any]:
    error = detect_secret(content)
    if error:
        audit(tool, target.relative_to(VAULT).as_posix(), "rejected_secret", error)
        raise JsonRpcError(-32003, "write rejected: potential secret detected", error)

    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        audit(tool, target.relative_to(VAULT).as_posix(), "rejected_exists")
        raise JsonRpcError(-32004, f"file already exists: {target.relative_to(VAULT).as_posix()}")

    data = content.encode("utf-8")
    if len(data) > 262144:
        raise JsonRpcError(-32602, "content exceeds 256KB")

    tmp = target.with_suffix(target.suffix + f".tmp-{os.getpid()}")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, target)
    finally:
        if tmp.exists():
            tmp.unlink()
    audit(tool, target.relative_to(VAULT).as_posix(), "success", bytes_written=len(data))
    return {
        "created": True,
        "path": str(target),
        "vault_path": target.relative_to(VAULT).as_posix(),
        "bytes": len(data),
    }


def tool_get_context(_: dict[str, Any]) -> dict[str, Any]:
    agent = require_agent()
    files: dict[str, str] = {}
    truncated: list[str] = []
    for rel in [*READ_CONTEXT_FILES, f"00-contract/agents/{agent}.md"]:
        candidate = safe_vault_path(rel, must_exist=False, md_only=True)
        if not candidate.is_file():
            continue
        path = candidate
        data = path.read_text(encoding="utf-8")
        if len(data.encode("utf-8")) > 65536:
            data = data.encode("utf-8")[:65536].decode("utf-8", errors="ignore") + "\n\n<!-- truncated -->\n"
            truncated.append(rel)
        files[rel] = data
    return {
        "agent_id": agent,
        "vault_root": str(VAULT),
        "read_at": utc_now(),
        "files": files,
        "truncated": truncated,
    }


def tool_search(args: dict[str, Any]) -> dict[str, Any]:
    require_agent()
    query = args.get("query")
    if not isinstance(query, str) or not query.strip():
        raise JsonRpcError(-32602, "query is required")
    query = query.strip()
    flags = re.IGNORECASE if args.get("case_sensitive") is not True else 0
    pattern = re.compile(re.escape(query) if args.get("regex") is not True else query, flags)
    limit = min(max(int(args.get("limit", 20)), 1), 50)
    results: list[dict[str, Any]] = []
    for path in VAULT.rglob("*.md"):
        rel = path.relative_to(VAULT)
        if any(part in PROTECTED_PARTS for part in rel.parts):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
        matches = []
        for i, line in enumerate(text.splitlines(), 1):
            if pattern.search(line):
                matches.append({"line": i, "text": line.strip()[:300]})
                if len(matches) >= 5:
                    break
        if matches:
            results.append({"path": rel.as_posix(), "matches": matches})
            if len(results) >= limit:
                break
    return {"query": query, "count": len(results), "results": results}


def tool_read_note(args: dict[str, Any]) -> dict[str, Any]:
    require_agent()
    path = safe_vault_path(args.get("path"), must_exist=True, md_only=True)
    max_bytes = min(max(int(args.get("max_bytes", 65536)), 1), 262144)
    data = path.read_bytes()
    truncated = len(data) > max_bytes
    if truncated:
        data = data[:max_bytes]
    return {
        "path": path.relative_to(VAULT).as_posix(),
        "bytes": len(data),
        "total_bytes": path.stat().st_size,
        "truncated": truncated,
        "content": data.decode("utf-8", errors="ignore"),
    }


def tool_get_status(_: dict[str, Any]) -> dict[str, Any]:
    agent = require_agent()
    status = safe_vault_path("07-maps/AGENT-STATUS.md").read_text(encoding="utf-8")
    profile = safe_vault_path(f"00-contract/agents/{agent}.md").read_text(encoding="utf-8")
    registry = safe_vault_path("00-contract/AGENT-REGISTRY.md").read_text(encoding="utf-8")
    return {
        "agent_id": agent,
        "registered": True,
        "status_map_excerpt": "\n".join(status.splitlines()[:80]),
        "profile": profile,
        "registry_excerpt": "\n".join(registry.splitlines()[:100]),
    }


def tool_create_inbox_card(args: dict[str, Any]) -> dict[str, Any]:
    agent = require_agent()
    title = args.get("title")
    content = args.get("content")
    if not isinstance(title, str) or not title.strip():
        raise JsonRpcError(-32602, "title is required")
    if not isinstance(content, str) or not content.strip():
        raise JsonRpcError(-32602, "content is required")
    _, _, _, date, compact, hhmm = now_parts()
    slug = slugify(args.get("slug") or title)
    path = VAULT / "01-inbox" / agent / f"{date}-{slug}.md"
    tags = args.get("tags") or ["inbox", "agent"]
    if not isinstance(tags, list) or not all(isinstance(x, str) for x in tags):
        raise JsonRpcError(-32602, "tags must be a list of strings")
    tags = tags or ["inbox", "agent"]
    tag_lines = "\n".join(f"  - {t}" for t in tags)
    confidence = args.get("confidence", "medium")
    if confidence not in {"low", "medium", "high"}:
        raise JsonRpcError(-32602, "confidence must be low, medium, or high")
    text = f"""---
id: kb-{compact}-{hhmm}-{slug}
type: knowledge
title: {ensure_frontmatter_value(title.strip())}
status: seed
confidence: {confidence}
agent: {agent}
created: {date}
updated: {date}
tags:
{tag_lines}
---

# {title.strip()}

{content.strip()}
"""
    return write_audit_and_file("kb.create_inbox_card", path, text)


def tool_create_session_note(args: dict[str, Any]) -> dict[str, Any]:
    agent = require_agent()
    title = args.get("title")
    content = args.get("content")
    if not isinstance(title, str) or not title.strip():
        raise JsonRpcError(-32602, "title is required")
    if not isinstance(content, str) or not content.strip():
        raise JsonRpcError(-32602, "content is required")
    y, m, d, date, compact, hhmm = now_parts()
    slug = slugify(args.get("slug") or title)
    path = VAULT / "02-sessions" / y / m / d / f"{date}-{hhmm}-{agent}-{slug}.md"
    result = args.get("result", "completed")
    if result not in {"completed", "partial", "failed"}:
        raise JsonRpcError(-32602, "result must be completed, partial, or failed")
    tags = args.get("tags") or ["session", "agent"]
    tag_lines = "\n".join(f"  - {t}" for t in tags)
    text = f"""---
id: session-{compact}-{hhmm}-{agent}-{slug}
type: session
agent: {agent}
date: {date}
title: {ensure_frontmatter_value(title.strip())}
result: {result}
tags:
{tag_lines}
---

# {title.strip()}

{content.strip()}
"""
    return write_audit_and_file("kb.create_session_note", path, text)


def tool_create_message(args: dict[str, Any]) -> dict[str, Any]:
    agent = require_agent()
    content = args.get("content")
    if not isinstance(content, str) or not content.strip():
        raise JsonRpcError(-32602, "content is required")
    title = args.get("title") or "Agent message"
    if not isinstance(title, str) or not title.strip():
        raise JsonRpcError(-32602, "title must be a string")
    _, _, _, date, compact, hhmm = now_parts()
    slug = slugify(args.get("slug") or title)
    path = VAULT / "01-inbox" / agent / "messages" / f"{date}-{hhmm}-{slug}.md"
    tags = args.get("tags") or ["agent-message", agent]
    if not isinstance(tags, list) or not all(isinstance(x, str) for x in tags):
        raise JsonRpcError(-32602, "tags must be a list of strings")
    tag_lines = "\n".join(f"  - {t}" for t in tags)
    text = f"""---
id: message-{compact}-{hhmm}-{agent}-{slug}
type: message
agent: {agent}
date: {date}
title: {ensure_frontmatter_value(title.strip())}
status: pending
tags:
{tag_lines}
---

# {title.strip()}

{content.strip()}
"""
    return write_audit_and_file("kb.create_message", path, text)


def tool_propose_update(args: dict[str, Any]) -> dict[str, Any]:
    agent = require_agent()
    target_raw = args.get("target_path")
    reason = args.get("reason")
    proposed_content = args.get("proposed_content")
    if not isinstance(target_raw, str) or not target_raw.strip():
        raise JsonRpcError(-32602, "target_path is required")
    if not isinstance(reason, str) or not reason.strip():
        raise JsonRpcError(-32602, "reason is required")
    if not isinstance(proposed_content, str) or not proposed_content.strip():
        raise JsonRpcError(-32602, "proposed_content is required")
    target = safe_vault_path(target_raw, must_exist=True, md_only=True)
    target_rel = target.relative_to(VAULT).as_posix()
    if target_rel.startswith(("01-inbox/", "02-sessions/")):
        raise JsonRpcError(-32602, "proposal target must be outside inbox and sessions")

    _, _, _, date, compact, hhmm = now_parts()
    slug = slugify(args.get("slug") or target.stem)
    path = VAULT / "01-inbox" / agent / "proposals" / f"{date}-{slug}.proposal.md"
    evidence = args.get("evidence", "待补充")
    impact = args.get("impact", "待补充")
    rollback = args.get("rollback_note", "Git revert proposed content after review.")
    text = f"""---
id: proposal-{compact}-{hhmm}-{agent}-{slug}
type: proposal
agent: {agent}
date: {date}
status: open
target_path: "{target_rel}"
---

# Proposal: {target_rel}

## Reason

{reason.strip()}

## Evidence

{evidence.strip()}

## Impact

{impact.strip()}

## Proposed Content

```markdown
{proposed_content.strip()}
```

## Rollback

{rollback.strip()}
"""
    return write_audit_and_file("kb.propose_update", path, text)


TOOLS: list[dict[str, Any]] = [
    {
        "name": "kb_get_context",
        "description": "Read the unified agent context pack from the Knowledge Vault.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "kb_search",
        "description": "Search Markdown notes inside the Knowledge Vault.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 50},
                "case_sensitive": {"type": "boolean"},
                "regex": {"type": "boolean"},
            },
            "required": ["query"],
            "additionalProperties": False,
        },
    },
    {
        "name": "kb_read_note",
        "description": "Read one Markdown note by Vault-relative or absolute path.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "max_bytes": {"type": "integer", "minimum": 1, "maximum": 262144},
            },
            "required": ["path"],
            "additionalProperties": False,
        },
    },
    {
        "name": "kb_get_status",
        "description": "Read the current agent profile, registry excerpt, and status map.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "kb_create_inbox_card",
        "description": "Create a Knowledge Card in the calling agent's own Inbox.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "content": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
                "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
                "slug": {"type": "string"},
            },
            "required": ["title", "content"],
            "additionalProperties": False,
        },
    },
    {
        "name": "kb_create_session_note",
        "description": "Create a Session Note in the daily session directory.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "content": {"type": "string"},
                "result": {"type": "string", "enum": ["completed", "partial", "failed"]},
                "tags": {"type": "array", "items": {"type": "string"}},
                "slug": {"type": "string"},
            },
            "required": ["title", "content"],
            "additionalProperties": False,
        },
    },
    {
        "name": "kb_propose_update",
        "description": "Propose a change to a protected Vault note without directly modifying it.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "target_path": {"type": "string"},
                "reason": {"type": "string"},
                "evidence": {"type": "string"},
                "impact": {"type": "string"},
                "proposed_content": {"type": "string"},
                "rollback_note": {"type": "string"},
                "slug": {"type": "string"},
            },
            "required": ["target_path", "reason", "proposed_content"],
            "additionalProperties": False,
        },
    },
    {
        "name": "kb_create_message",
        "description": "Create an inbound agent message for hourly automatic distillation.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "content": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
                "slug": {"type": "string"}
            },
            "required": ["content"],
            "additionalProperties": False
        }
    },
]

TOOL_HANDLERS = {
    "kb_get_context": tool_get_context,
    "kb_search": tool_search,
    "kb_read_note": tool_read_note,
    "kb_get_status": tool_get_status,
    "kb_create_inbox_card": tool_create_inbox_card,
    "kb_create_session_note": tool_create_session_note,
    "kb_propose_update": tool_propose_update,
    "kb_create_message": tool_create_message,
}


def send(msg: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(msg, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def result(request_id: Any, value: Any) -> None:
    send({"jsonrpc": "2.0", "id": request_id, "result": value})


def error(request_id: Any, exc: JsonRpcError) -> None:
    item: dict[str, Any] = {"code": exc.code, "message": exc.message}
    if exc.data is not None:
        item["data"] = exc.data
    send({"jsonrpc": "2.0", "id": request_id, "error": item})


def unexpected_error(request_id: Any, exc: Exception) -> None:
    send({
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": -32603, "message": "internal error", "data": str(exc)},
    })


def main() -> None:
    config = json.loads(CONFIG_PATH.read_text("utf-8"))
    server_info = config["server"]
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            send({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}})
            continue
        method = req.get("method")
        request_id = req.get("id")
        if method == "initialize":
            result(request_id, {
                "protocolVersion": server_info["protocol_version"],
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": server_info["name"], "version": server_info["version"]},
            })
        elif method == "notifications/initialized":
            continue
        elif method == "ping":
            result(request_id, {})
        elif method == "tools/list":
            result(request_id, {"tools": TOOLS})
        elif method == "tools/call":
            params = req.get("params") or {}
            name = params.get("name")
            args = params.get("arguments") or {}
            handler = TOOL_HANDLERS.get(name)
            if not handler:
                send({"jsonrpc": "2.0", "id": request_id, "error": {"code": -32602, "message": f"unknown tool: {name}"}})
                continue
            try:
                value = handler(args)
                audit(str(name), "", "success")
                result(request_id, {
                    "content": [{"type": "text", "text": json.dumps(value, ensure_ascii=False, indent=2)}],
                    "structuredContent": value,
                    "isError": False,
                })
            except JsonRpcError as exc:
                audit(str(name), str(args.get("path") or args.get("target_path") or ""), "error", exc.message)
                error(request_id, exc)
            except Exception as exc:
                audit(str(name), str(args.get("path") or args.get("target_path") or ""), "error", str(exc))
                unexpected_error(request_id, exc)
        elif request_id is not None:
            send({"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": f"method not found: {method}"}})


if __name__ == "__main__":
    main()
