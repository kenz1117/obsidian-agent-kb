import importlib
import os
from pathlib import Path
import tempfile

def test_vault_and_agents_are_configurable(monkeypatch):
  with tempfile.TemporaryDirectory() as td:
    monkeypatch.setenv("KB_VAULT_ROOT", td)
    monkeypatch.setenv("KB_AGENT_ID", "test-agent")
    monkeypatch.setenv("KB_AGENT_IDS", "test-agent,other-agent")
    import oakb_gateway.server as server
    importlib.reload(server)
    assert server.VAULT.resolve() == Path(td).resolve()
    assert server.require_agent() == "test-agent"
    assert "other-agent" in server.REGISTERED_IDS
