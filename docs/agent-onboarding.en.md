# Agent Onboarding

**Languages:** [中文](agent-onboarding.md) | English

## 1. Install and enable the plugin

Install only the Obsidian Agent KB plugin. First activation creates the knowledge folders, agent instructions, and local MCP service. No other components are required.

## 2. One-click setup

Open **Settings → Obsidian Agent KB**, or use the settings gear at the top of **Knowledge Review**. The plugin only lists agents with a detected application or executable; leftover configuration directories do not count as installations.

**Connect agents** automatically configures WorkBuddy, Codex, Claude Code, Trae CN, ZCode, MiniMax Code, Kimi Code, Qwen Code, and installed Claude Desktop, Cursor, or Windsurf clients. Existing MCP servers are preserved and original files are backed up. Restart the corresponding agent afterward. Legacy standalone MCP users also only need this one address update.

Agents without supported config-file setup, including DeepSeek Harness, Qwen Work, and Doubao Work, are marked for in-app setup. Click **Copy agent address** on that agent's row and paste its own URL into the app's MCP URL field. Other MCP Streamable HTTP clients can also use their identity-specific URLs. Do not share these addresses.

Each agent URL contains a separate token that determines its `agent_id`. `kb_get_context` reads `00-contract/agents/<agent_id>.md`; messages, candidates, sessions, proposals, audit entries, and connection records all retain that identity. After upgrading from the old shared URL, click **Connect agents** once more to switch to individual URLs. Existing profiles are never overwritten.

A configured address only means the configuration was written; it is not proof of a real connection. Use the service test to verify the service and all eight tools, and check real connection records to see which agent actually initialized MCP.

The background service starts at login and remains available after Obsidian closes. Turn it off in plugin settings to stop it. The current package with the embedded background runtime supports macOS Apple Silicon.

## 3. Recommended session rules

Add these rules to the agent's permanent instructions:

```text
At task start, call kb_get_context.
Submit durable decisions, facts, and methods through kb_create_inbox_card.
Never write canonical knowledge directly.
Never include secrets.
```

## 4. Human review

Agent candidates appear in `03-knowledge/auto/` and the Obsidian review queue. A human marks them for review and then promotes them to canonical knowledge, or archives unsuitable content.

The legacy standalone MCP server and CLI are advanced options for deployments without Obsidian, not installation steps for plugin users.
