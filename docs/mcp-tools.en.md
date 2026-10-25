# MCP server and tools

**Languages:** [中文](mcp-tools.md) | English

Starting with `0.6.0`, the plugin's embedded runtime starts the default MCP service as a login background service. No separate Python, Node, MCP server, or environment-variable setup is required. The current package with the embedded background runtime supports macOS Apple Silicon.

## Connect

The service uses MCP Streamable HTTP on `127.0.0.1`, default port `27183`, with a random access token in its URL. Use **Connect agents** or **Copy agent address** in plugin settings; do not construct the address manually.

Closing Obsidian does not stop the background service; turn it off in plugin settings to stop it. It is not exposed to the LAN or internet. Legacy stdio servers remain available for advanced headless deployments.

## Read tools

- `kb_get_context`: reads the bounded context pack and agent instructions.
- `kb_search`: performs case-sensitive or case-insensitive literal search across 1–50 files, with at most five matching lines per file.
- `kb_read_note`: reads one Markdown note up to 256 KiB.
- `kb_get_status`: reads service status, the agent profile, and status notes.

Read tools are annotated as read-only and idempotent.

## Governed write tools

- `kb_create_message`: creates an inbound message.
- `kb_create_inbox_card`: creates a scored candidate in `03-knowledge/auto/`, directly visible in the Obsidian review queue.
- `kb_create_session_note`: creates a session record with `completed`, `partial`, or `failed` result.
- `kb_propose_update`: creates a reviewable proposal and never mutates the target note.

Writes are not idempotent; name collisions receive a unique filename. New objects include agent provenance and `internal` sensitivity. Only a human can promote canonical knowledge in Obsidian.

## Access and safety rules

1. Each distinct URL token maps to exactly one allowlisted `agent_id`; agents cannot switch or elevate identity through tool arguments or request headers.
2. Paths must remain inside the current vault. `..` escapes, outside absolute paths, protected `.obsidian`／`.git` directories, non-Markdown files, and symlink escapes are rejected.
3. MCP requests are limited to 2 MiB and writes to 256 KiB. Content is scanned for likely secrets before creation.
4. Titles, tags, optional text, integer limits, and enums are validated; frontmatter strings are serialized safely.
5. Search skips protected directories, symbolic links, and files larger than 1 MiB.
6. Only local Host／Origin values are accepted and the random URL token is required. `/health` returns only service status.
7. Audit records stay in the plugin's local `runtime/audit.jsonl`; note bodies are not logged.
8. Agents receive no promote, archive, or purge tools. Those operations remain in the human review UI.
