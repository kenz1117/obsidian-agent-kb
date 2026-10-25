# Agent Onboarding

## 1. Configure MCP

```json
{
  "mcpServers": {
    "obsidian-agent-kb": {
      "command": "oakb-mcp",
      "args": ["serve"],
      "env": {
        "KB_VAULT_ROOT": "/absolute/path/to/vault",
        "KB_AGENT_ID": "codex"
      }
    }
  }
}
```

## 2. Session rule

Add this to the agent's permanent instructions:

```text
At task start, call kb_get_context.
Before finishing, send durable decisions, facts, methods, and constraints through kb_create_message.
Never write canonical knowledge directly.
Never include secrets.
```

## 3. Human review

Agents produce `auto` knowledge.  
Humans or trusted policy promote `review` knowledge to `canonical`.
