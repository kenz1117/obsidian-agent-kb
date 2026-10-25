# Gateway

Operational Python gateway used for local MCP, ingestion, distillation, scheduled jobs, and Git backup.

This is the production-ready reference implementation while the TypeScript MCP package matures.

## Layout

```text
bin/         executable entrypoints
src/         gateway implementation
config/      local and example configuration
tests/       smoke and integration checks
```

## Run

```bash
export KB_VAULT_ROOT=/absolute/path/to/vault
export KB_AGENT_ID=codex
bin/oakb-mcp --list-tools
bin/oakb context
```

## Scheduled automation

```bash
bin/oakb-auto-ingest      # hourly source/message distillation
bin/oakb-daily-sync       # daily maps, indexes, commit, push
```

The scripts read `config/gateway.env` when present. Copy `config/gateway.env.example` and do not commit it.
