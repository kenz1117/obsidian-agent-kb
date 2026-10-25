# Changelog

**Languages:** [中文](CHANGELOG.md) | English

## 0.6.0 - 2026-10-25

- Bundled a verified Node runtime and added a macOS LaunchAgent so agents can use the vault after Obsidian closes.
- Agent detection now requires an actual application or executable instead of treating leftover configuration directories as installations.
- Added one-click setup for WorkBuddy, Codex, Claude Code, Trae CN, ZCode, MiniMax Code, Kimi Code, and Qwen Code while retaining existing client support.
- Added per-agent tokens and URLs so context profiles, write provenance, audit records, and connection records retain each agent's identity instead of falling back to `obsidian-agent`.
- Separated address configuration from real connection records; agents without supported config-file setup are marked for in-app setup and can copy their own identity URL.
- The package with the embedded background runtime currently supports macOS Apple Silicon.

## 0.5.1 - 2026-10-25

- Added agent configuration matching, service connection testing, and actual MCP client connection records to settings.
- Added service status, last connection, and a settings gear to the Knowledge Review panel.
- Clarified that legacy standalone MCP users reconnect only once and restart the agent afterward.

## 0.5.0 - 2026-10-25

- Embedded the knowledge runtime and all eight MCP tools in the Obsidian plugin; customers no longer install Python, Node, standalone MCP, or CLI components.
- Added automatic first-run initialization of knowledge folders, agent instructions, and context files without overwriting existing notes.
- Added a local service toggle, one-click Claude／Cursor／Windsurf setup, and generic address copying to plugin settings.
- Routed agent candidates directly into the Obsidian review queue while preserving secret rejection, vault boundaries, and audit records.
- Changed releases to a single ZIP package and added tagged GitHub Release uploads.

## 0.4.0 - 2026-10-25

- Wired `@oakb/mcp` to the official MCP SDK and the governed Python gateway.
- Added MCP lifecycle handling, tool annotations, timeouts, bounded responses, and end-to-end tests.
- Hardened gateway path resolution, literal search, input validation, provenance, runtime configuration, and error responses.
- Enforced Obsidian promotion policy, expanded review queues, prevented move collisions, and enabled TypeScript checks in CI.
- Implemented the TypeScript CLI with all eight governed commands, exclusive vault initialization, bounded gateway subprocesses, stable exit codes, and end-to-end tests.

## 0.1.0 - 2026-10-25

- Added governed vault architecture and lifecycle model.
- Added data governance engine, policy schema, and quality scoring model.
- Added MCP tool contract.
- Added CLI and Obsidian plugin skeletons.
- Migrated operational Python gateway from private prototype.
