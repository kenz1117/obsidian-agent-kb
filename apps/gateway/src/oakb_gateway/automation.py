from __future__ import annotations

import json
import os
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

VAULT = Path(os.environ.get("KB_VAULT_ROOT", ".")).expanduser().resolve()
AGENTS = [x.strip() for x in os.environ.get("KB_AGENT_IDS", "codex,generic-agent").split(",") if x.strip()]
INBOX_SOURCES = set(AGENTS) | {"human"}
PROTECTED_PARTS = {".git", ".obsidian"}


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    match = re.match(r"^---\n(.*?)\n---\n?", text, re.S)
    if not match:
        return {}, text
    fm: dict[str, Any] = {}
    key = None
    for raw in match.group(1).splitlines():
        line = raw.rstrip()
        if not line or line.startswith("#"):
            continue
        item = re.match(r"^-\s+(.+)$", line)
        if item and key:
            fm.setdefault(key, [])
            if isinstance(fm[key], list):
                fm[key].append(item.group(1).strip())
            continue
        pair = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if pair:
            key = pair.group(1)
            value = pair.group(2).strip().strip('"').strip("'")
            fm[key] = value
    return fm, text[match.end():]


def heading_value(body: str, heading: str) -> str:
    match = re.search(rf"^##\s+{re.escape(heading)}\s*\n+(.*?)(?=^##\s+|\Z)", body, re.M | re.S)
    if not match:
        return ""
    return " ".join(x.strip() for x in match.group(1).splitlines() if x.strip())[:280]


def atomic_write(path: Path, content: str) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    import os
    os.replace(tmp, path)
    return {"path": str(path), "bytes": len(content.encode("utf-8"))}


def normalize_title(value: str) -> str:
    return re.sub(r"[^\w]+", "", value.lower(), flags=re.UNICODE)


def inbox_triage() -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    proposals: list[dict[str, Any]] = []
    inbox_root = VAULT / "01-inbox"
    for path in sorted(inbox_root.rglob("*.md")):
        rel = path.relative_to(VAULT)
        if any(part in PROTECTED_PARTS for part in rel.parts):
            continue
        parts = rel.parts
        if len(parts) < 3 or parts[1] not in INBOX_SOURCES:
            continue
        agent = parts[1]
        fm, body = parse_frontmatter(path.read_text(encoding="utf-8"))
        title = str(fm.get("title") or "").strip()
        if not title:
            h1 = re.search(r"^#\s+(.+)$", body, re.M)
            title = h1.group(1).strip() if h1 else path.stem
        record = {
            "agent": agent,
            "path": rel.as_posix(),
            "type": str(fm.get("type") or "unknown"),
            "status": str(fm.get("status") or "unknown"),
            "title": title,
        }
        if "proposals" in parts:
            proposals.append(record)
        else:
            items.append(record)

    by_title: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in items:
        by_title[normalize_title(item["title"])].append(item)
    duplicates = {k: v for k, v in by_title.items() if len(v) > 1 and k}

    by_agent: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in items:
        by_agent[item["agent"]].append(item)

    lines = [
        "---",
        "id: inbox-review",
        "type: map",
        "status: generated",
        f"updated: {datetime.now().strftime('%Y-%m-%d')}",
        "generator: Knowledge MCP Gateway",
        "tags:",
        "  - inbox",
        "  - automation",
        "  - review",
        "---",
        "",
        "# Inbox Review",
        "",
        f"Generated at: `{now_iso()}`",
        "",
        "## Summary",
        "",
        f"- Inbox cards: `{len(items)}`",
        f"- Proposals: `{len(proposals)}`",
        f"- Duplicate title groups: `{len(duplicates)}`",
        "",
        "## Items",
        "",
    ]
    if not items:
        lines.append("No inbox cards found.")
    for agent in [*AGENTS, "human"]:
        agent_items = by_agent.get(agent, [])
        if not agent_items:
            continue
        lines += [f"### `{agent}`", ""]
        lines += ["| Title | Type | Status | Path |", "|---|---|---|---|"]
        for item in agent_items:
            title = item["title"].replace("|", "\\|")
            lines.append(f"| {title} | `{item['type']}` | `{item['status']}` | `{item['path']}` |")
        lines.append("")

    lines += ["## Proposals", ""]
    if not proposals:
        lines.append("No open proposals found.")
    else:
        lines += ["| Agent | Title | Status | Path |", "|---|---|---|---|"]
        for item in proposals:
            title = item["title"].replace("|", "\\|")
            lines.append(f"| `{item['agent']}` | {title} | `{item['status']}` | `{item['path']}` |")
    lines += ["", "## Duplicate Title Groups", ""]
    if not duplicates:
        lines.append("None.")
    else:
        for _, group in duplicates.items():
            lines.append(f"- **{group[0]['title']}**")
            for item in group:
                lines.append(f"  - `{item['agent']}` / `{item['path']}`")

    output = atomic_write(VAULT / "07-maps" / "INBOX-REVIEW.md", "\n".join(lines) + "\n")
    return {"generated_at": now_iso(), "inbox_cards": len(items), "proposals": len(proposals), "duplicate_groups": len(duplicates), **output}


def session_digest(date: str | None = None) -> dict[str, Any]:
    target = date or datetime.now().strftime("%Y-%m-%d")
    try:
        y, m, d = target.split("-")
    except ValueError as exc:
        raise ValueError("date must use YYYY-MM-DD") from exc
    directory = VAULT / "02-sessions" / y / m / d
    records: list[dict[str, Any]] = []
    if directory.exists():
        for path in sorted(directory.glob("*.md")):
            fm, body = parse_frontmatter(path.read_text(encoding="utf-8"))
            title = str(fm.get("title") or "").strip()
            if not title:
                h1 = re.search(r"^#\s+(.+)$", body, re.M)
                title = h1.group(1).strip() if h1 else path.stem
            records.append({
                "agent": str(fm.get("agent") or "unknown"),
                "title": title,
                "result": str(fm.get("result") or fm.get("status") or "unknown"),
                "task": str(fm.get("task") or ""),
                "summary": heading_value(body, "Result"),
                "next": heading_value(body, "Next Actions"),
                "path": path.relative_to(VAULT).as_posix(),
            })

    lines = [
        "---",
        f"id: session-digest-{target}",
        "type: map",
        "status: generated",
        f"date: {target}",
        "generator: Knowledge MCP Gateway",
        "tags:",
        "  - session",
        "  - automation",
        "  - digest",
        "---",
        "",
        f"# Session Digest: {target}",
        "",
        f"Generated at: `{now_iso()}`",
        "",
        f"Session count: `{len(records)}`",
        "",
    ]
    if not records:
        lines.append("No sessions found.")
    for record in records:
        lines += [
            f"## {record['title']}",
            "",
            f"- Agent: `{record['agent']}`",
            f"- Result: `{record['result']}`",
            f"- Path: `{record['path']}`",
        ]
        if record["task"]:
            lines.append(f"- Task: {record['task']}")
        if record["summary"]:
            lines += ["", record["summary"]]
        if record["next"]:
            lines += ["", "**Next actions:**", "", record["next"]]
        lines.append("")
    output = atomic_write(VAULT / "07-maps" / "SESSION-DIGEST.md", "\n".join(lines) + "\n")
    return {"date": target, "sessions": len(records), **output}


def decision_sync() -> dict[str, Any]:
    decisions: list[dict[str, Any]] = []
    directory = VAULT / "05-decisions"
    for path in sorted(directory.glob("*.md")):
        fm, _ = parse_frontmatter(path.read_text(encoding="utf-8"))
        decisions.append({
            "id": str(fm.get("id") or path.stem),
            "title": str(fm.get("title") or path.stem),
            "status": str(fm.get("status") or "unknown"),
            "date": str(fm.get("date") or ""),
            "path": path.relative_to(VAULT).as_posix(),
        })

    lines = [
        "---",
        "id: decision-index",
        "type: map",
        "status: canonical",
        f"updated: {datetime.now().strftime('%Y-%m-%d')}",
        "generator: Knowledge MCP Gateway",
        "tags:",
        "  - adr",
        "  - decision",
        "---",
        "",
        "# 当前决策索引",
        "",
        "这里只保留当前有效决策索引。详细内容见 `05-decisions/`。",
        "",
        "## 决策表",
        "",
        "| ID | 决策 | 状态 | 日期 | 笔记 |",
        "|---|---|---|---|---|",
    ]
    for d in decisions:
        title = d["title"].replace("|", "\\|")
        lines.append(f"| {d['id']} | {title} | `{d['status']}` | {d['date']} | [[{Path(d['path']).stem}]] |")

    lines += [
        "",
        "## 使用规则",
        "",
        "1. Agent 给出方案前，应先检查这里是否已有相关决策。",
        "2. 如果新方案与现有决策冲突，必须显式指出。",
        "3. 不应重新讨论已经 Accepted 且没有新证据的决策。",
        "",
        f"Generated at: `{now_iso()}`",
        "",
    ]
    output = atomic_write(VAULT / "00-contract" / "DECISION-INDEX.md", "\n".join(lines) + "\n")
    return {"decisions": len(decisions), **output}


def load_audit_events() -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    audit_root = Path(os.environ.get("KB_RUNTIME_DIR", "./runtime")).expanduser().resolve() / "audit"
    if not audit_root.exists():
        return events
    for path in audit_root.rglob("*.jsonl"):
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return events


def status_sync() -> dict[str, Any]:
    events = load_audit_events()
    mcp_success: set[str] = set()
    cli_success: set[str] = set()
    for event in events:
        agent = event.get("agent_id")
        tool = str(event.get("tool") or "")
        result = event.get("result")
        if agent not in AGENTS:
            continue
        if result in {"success", "rejected_secret"} and (tool in {"kb_get_status", "kb.get_status"} or tool.endswith(".get_status")):
            mcp_success.add(agent)
        if result == "success" and tool == "cli.status":
            cli_success.add(agent)

    status_path = VAULT / "07-maps" / "AGENT-STATUS.md"
    text = status_path.read_text(encoding="utf-8")
    changed: list[dict[str, str]] = []
    for agent in AGENTS:
        pattern = re.compile(rf"^(\| [^|\n]+ \| `{re.escape(agent)}` \| confirmed \| confirmed \| )([^|\n]+)( \|)$", re.M)
        match = pattern.search(text)
        if not match:
            continue
        current = match.group(2).strip()
        if agent in mcp_success:
            desired = "mcp-confirmed"
        elif agent in cli_success or current == "cli-fallback-confirmed":
            desired = "cli-fallback-confirmed"
        else:
            desired = "client-config-pending"
        if current != desired:
            text = pattern.sub(lambda m: f"{m.group(1)}{desired}{m.group(3)}", text, count=1)
            changed.append({"agent": agent, "from": current, "to": desired})

    marker = "## MCP 接入结果更新"
    text = re.sub(r"^- Status Sync generated at `.*?`.*$\n?", "", text, flags=re.M)
    total_agents = len(AGENTS)
    sync_note = f"- Status Sync generated at `{now_iso()}`: MCP confirmed `{len(mcp_success)}/{total_agents}`, CLI fallback confirmed `{len(cli_success)}/{total_agents}`.\n"
    if marker in text:
        text += sync_note
    else:
        text += f"\n{marker}\n\n{sync_note}"
    output = atomic_write(status_path, text)
    return {"mcp_confirmed": len(mcp_success), "cli_confirmed": len(cli_success), "changed": changed, **output}
