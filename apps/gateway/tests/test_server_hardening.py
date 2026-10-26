import importlib
import json
from pathlib import Path

import pytest


@pytest.fixture
def server(tmp_path, monkeypatch):
    monkeypatch.setenv("KB_VAULT_ROOT", str(tmp_path / "vault"))
    monkeypatch.setenv("KB_RUNTIME_DIR", str(tmp_path / "runtime"))
    monkeypatch.setenv("KB_AGENT_ID", "test-agent")
    monkeypatch.setenv("KB_AGENT_IDS", "test-agent")
    (tmp_path / "vault").mkdir()
    import oakb_gateway.server as module
    return importlib.reload(module)


def test_search_is_literal_and_validates_numbers(server):
    (server.VAULT / "note.md").write_text("literal (a+)+ text\n", encoding="utf-8")
    result = server.tool_search({"query": "(a+)+", "limit": 1})
    assert result["count"] == 1
    with pytest.raises(server.JsonRpcError) as error:
        server.tool_search({"query": "literal", "limit": "ten"})
    assert error.value.code == -32602


def test_search_does_not_follow_file_symlinks_outside_vault(server, tmp_path):
    outside = tmp_path / "outside.md"
    outside.write_text("outside secret content", encoding="utf-8")
    link = server.VAULT / "link.md"
    try:
        link.symlink_to(outside)
    except OSError:
        pytest.skip("symlinks unavailable")
    assert server.tool_search({"query": "outside"})["count"] == 0


def test_write_quotes_tags_and_adds_provenance(server):
    result = server.tool_create_inbox_card({
        "title": "Safe card",
        "content": "Durable knowledge",
        "tags": ["safe:value", "two words"],
    })
    path = Path(result["path"])
    text = path.read_text(encoding="utf-8")
    assert '  - "safe:value"' in text
    assert '  - "two words"' in text
    assert "status: pending" in text
    assert "source: agent://test-agent" in text
    assert "sensitivity: internal" in text


def test_write_rejects_invalid_tags_and_bad_limits(server):
    with pytest.raises(server.JsonRpcError):
        server.tool_create_inbox_card({"title": "Bad", "content": "Body", "tags": ["line\nbreak"]})
    with pytest.raises(server.JsonRpcError):
        server.tool_read_note({"path": "missing.md", "max_bytes": True})


def test_runtime_audit_uses_configured_directory(server):
    server.audit("kb.test", "", "success")
    events = list((server.RUNTIME / "audit").rglob("*.jsonl"))
    assert len(events) == 1
    assert json.loads(events[0].read_text(encoding="utf-8"))["tool"] == "kb.test"
