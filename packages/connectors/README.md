# Connectors

Connectors adapt external platforms to governed intake.

Preferred order:

1. Native MCP client
2. CLI invocation
3. Filesystem outbox
4. Webhook connector
5. Manual paste connector

## Contract

Every connector must produce:

```yaml
origin: connector
connector: platform-name
agent_id: stable-agent-id
task_id: optional-task-id
source_path: local-or-remote-reference
timestamp: ISO-8601
```

## Current adapters

| Platform | Entry | Status |
|---|---|---|
| Codex | MCP stdio | planned |
| Claude Code | MCP stdio | planned |
| Cursor | MCP config | planned |
| Generic CLI | `oakb` CLI | planned |
| Generic filesystem | inbox watcher | planned |
