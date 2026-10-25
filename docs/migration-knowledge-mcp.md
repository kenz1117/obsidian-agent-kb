# Migrating from Knowledge-MCP

The private prototype has been logically merged into `apps/gateway`.

## Compatibility mapping

| Old command | New command |
|---|---|
| `Knowledge-MCP/bin/kb-mcp` | `apps/gateway/bin/oakb-mcp` |
| `Knowledge-MCP/bin/kb` | `apps/gateway/bin/oakb` |
| `Knowledge-MCP/bin/kb-automate` | `apps/gateway/bin/oakb-automate` |
| `Knowledge-MCP/bin/kb-auto-ingest` | `apps/gateway/bin/oakb-auto-ingest` |
| `Knowledge-MCP/bin/kb-daily-sync` | `apps/gateway/bin/oakb-daily-sync` |
| `Knowledge-MCP/bin/kb-secret-scan` | `apps/gateway/bin/oakb-secret-scan` |

## Configuration mapping

Old hardcoded values are now configuration:

| Old value | New variable |
|---|---|
| `/Users/ken/Documents/Knowledge` | `KB_VAULT_ROOT` |
| `runtime/` | `KB_RUNTIME_DIR` |
| private agent list | `KB_AGENT_IDS` or `gateway.json.agents` |
| Codex CLI location | `CODEX_BIN` |

Create:

```bash
cp apps/gateway/config/gateway.env.example apps/gateway/config/gateway.env
$EDITOR apps/gateway/config/gateway.env
```

Then run:

```bash
scripts/switch-local-gateway.sh
```
