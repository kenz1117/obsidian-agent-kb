# Obsidian Plugin

**Languages:** [中文](README.md) | English

A complete local agent knowledge base. This single plugin includes the knowledge runtime, MCP service, automatic initialization, and human review—no additional components. The current release package supports macOS Apple Silicon.

## Install and connect

1. Extract the release ZIP into `<vault>/.obsidian/plugins/`, producing an `obsidian-agent-kb` directory containing `manifest.json`, `main.js`, `service.js`, `service-node`, and `styles.css`.
2. Enable the plugin in Obsidian and let initialization and background service startup finish.
3. Click **Connect agents** in plugin settings or the Knowledge Review settings gear, or copy the generic MCP address.
4. Restart the agent. Existing users only need this one address update.

## Features

- Eight embedded MCP tools operating directly on the current vault.
- Agent candidates appear in `03-knowledge/auto/` and the review queue.
- Governance score, status, confidence, source, and tags.
- Human review, canonical promotion, and archive.
- Only actually detected agents are listed. Automatic setup covers WorkBuddy, Codex, Claude Code, Trae CN, ZCode, MiniMax Code, Kimi Code, Qwen Code, and previously supported clients, with backups.
- Per-agent identity URLs preserve each `agent_id` across profiles, write provenance, audit entries, and connection records.
- Address configuration is separate from real connection records; agents requiring in-app setup can copy their own identity URL.
- Loopback-only service with a random access token in the URL.
- Path escape and secret rejection plus local audit records.

The background service starts at login and remains available after Obsidian closes. It can be stopped manually in plugin settings.
