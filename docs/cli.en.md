# TypeScript CLI

**Languages:** [中文](cli.md) | English

`@oakb/cli` provides a local, scriptable interface to the same Python governance gateway used by MCP and the Obsidian plugin. It does not maintain a separate governance implementation.

## Build and run

```bash
pnpm install
pnpm --filter @oakb/cli build
node packages/cli/dist/index.js --help
```

After linking the workspace package, the executable is `oakb`.

## Configuration

| Variable | Purpose |
|---|---|
| `KB_VAULT_ROOT` | Absolute or user-relative vault path |
| `KB_RUNTIME_DIR` | Runtime audit directory |
| `KB_AGENT_ID` | Active registered agent identity |
| `KB_AGENT_IDS` | Comma-separated registered agent identities |
| `OAKB_GATEWAY_BIN` | Optional override for the gateway `bin` directory |
| `OAKB_PYTHON` | Optional Python executable; defaults to `python3` |

`--agent <id>` overrides `KB_AGENT_ID`. Successful command data is emitted as JSON on stdout; diagnostics are emitted on stderr. `--json` is accepted for explicit scripting intent, although output is always JSON.

## Commands

```text
oakb init [path]
oakb [--agent <id>] doctor
oakb [--agent <id>] ingest
oakb [--agent <id>] distill
oakb [--agent <id>] review [--scan]
oakb [--agent <id>] promote <target> [--reviewer <name>]
oakb [--agent <id>] archive <target> [--reason <text>]
oakb [--agent <id>] status
```

- `init` copies the governed vault template with exclusive file creation. Existing files and symbolic-link destination entries are never overwritten.
- `doctor` reports vault, policy, and knowledge-safety issues. A valid JSON report with `ok: false` exits with status `1`.
- `ingest` generates `07-maps/INBOX-REVIEW.md` from existing inbox material. It does not invoke an AI model.
- `distill` runs the existing governance scan over knowledge cards: validation, scoring, duplicate handling, review routing, and archiving. It does not synthesize new knowledge or run Git operations.
- `review` returns the review-map location; `review --scan` refreshes governance results first.
- `promote` and `archive` delegate lifecycle policy and audit behavior to the gateway.
- `status` reads the active agent's registration and vault status and records the CLI status audit event.

The separate `oakb-auto-ingest` agent automation remains opt-in; it is not called by these commands. Its external-agent and Git behavior is therefore never a hidden side effect of routine CLI use.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Command completed successfully |
| `1` | Gateway, health-check, filesystem, or lifecycle operation failed |
| `2` | Command-line usage error |

Gateway subprocesses run without a shell, with a 30-second timeout and a 4 MiB output bound per stream.
