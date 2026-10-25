# Obsidian Agent KB

**Languages:** [中文](README.md) | English

**One Obsidian plugin that gives your AI agents a shared local knowledge base.**

Your knowledge remains ordinary Markdown. Agents can search, read, and submit knowledge; you review it in Obsidian before it becomes canonical.

## Install just one plugin

No Python, Node, standalone MCP server, CLI, or repository paths are required. The current package embeds a macOS Apple Silicon background runtime.

### Installation

1. Download `obsidian-agent-kb-<version>.zip` from GitHub Releases.
2. Extract it into the current vault's `.obsidian/plugins/` directory.
3. Confirm that `.obsidian/plugins/obsidian-agent-kb/main.js` exists.
4. Enable **Obsidian Agent KB** under **Settings → Community plugins**.

First activation automatically initializes the folders, agent instructions, and background service. Existing notes are never overwritten.

### Connect agents

1. Open **Settings → Obsidian Agent KB**, or use the settings gear at the top of **Knowledge Review**.
2. Confirm that **Background service is running**.
3. Click **Connect agents**. The plugin only processes agents it actually detects and backs up configuration before changing it.
4. Restart the corresponding agent. Legacy standalone MCP users also only need this one address update.

Agents without supported config-file setup are explicitly marked for in-app setup. For any other client supporting MCP Streamable HTTP, click **Copy agent address** and add the copied value as its MCP URL. A configured address is not proof of a real connection; check the connection records.

**The background service starts at login and remains available after Obsidian closes. Turn it off in plugin settings to stop it.**

## Everyday use

```text
Agents search and read the vault
        ↓
Agents submit candidate knowledge
        ↓
Obsidian Knowledge Review queue
        ↓
Human promotion or archive
```

- `03-knowledge/auto/`: candidates submitted by agents.
- `03-knowledge/reviewed/`: notes awaiting final confirmation.
- `03-knowledge/canonical/`: approved knowledge.
- `90-archive/governance/manual/`: manually archived notes.

## Built in

- Eight MCP tools for context, search, read, status, messages, candidates, sessions, and update proposals.
- Agents cannot directly mutate canonical knowledge.
- Secret rejection, vault path boundaries, a local access token, and local audit records.
- Chinese and English review UI, governance scores, promotion, and archive.

See [Agent Onboarding](docs/agent-onboarding.en.md) and [MCP Tools](docs/mcp-tools.en.md).

## Release and development

Maintainers build the same customer package with:

```bash
pnpm install --frozen-lockfile
scripts/fetch-obsidian-service-runtime.sh
scripts/package-obsidian-plugin.sh
```

The runtime script downloads a pinned Node.js release and enforces its SHA-256 checksum; the large binary is not committed. The output is `dist/obsidian-agent-kb-<version>.zip`. Pushing a `v*` tag runs tests, fetches the runtime, builds the package, and uploads it to GitHub Releases.

The standalone Python gateway, TypeScript MCP server, and CLI remain advanced options for deployments without Obsidian. They are not customer installation steps.

Run all checks with:

```bash
pnpm check
```

## Status

`0.6.x` — single-plugin installation, automatic initialization, persistent background MCP, one-click agent setup, and human review are operational.

## License

Apache-2.0.
