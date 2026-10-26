# Architecture

**Languages:** [中文](architecture.md) | English

The default product has one customer entry point: the Obsidian plugin. It contains the knowledge runtime, MCP service, and human review UI.

```text
Other AI agents
     │ MCP Streamable HTTP (loopback only)
     ▼
Obsidian Agent KB plugin
     ├── Knowledge runtime: validation, secret rejection, writes, search, audit
     ├── MCP service: eight governed tools
     └── Human UI: review, promote, archive
     ▼
Current Obsidian vault (Markdown)
```

## 1. Access

Agents read and submit content through the embedded MCP service. First activation creates standard folders, agent instructions, and context files. Plugin settings provide the service toggle, one-click agent configuration, and generic address copying.

## 2. Governance

The runtime enforces input boundaries, secret rejection, provenance metadata, governance scoring, candidate routing, and local audit. Agents can create candidates, messages, sessions, and proposals, but cannot directly promote canonical knowledge.

## 3. Knowledge

Markdown is the native storage format. Users can continue using Obsidian, Git, and other Markdown tools.

```text
auto → review → canonical → stale → archive
```

## 4. Delivery

- Agents use the loopback MCP address provided in plugin settings.
- Humans use the Obsidian Knowledge Review queue.
- Advanced automation can use the standalone CLI and Python gateway retained in this repository; neither is a default product dependency.

## Repository layout

```text
packages/obsidian-plugin   Complete customer product: runtime, MCP, review, setup
packages/core              Standalone governance model (advanced)
packages/mcp               Legacy standalone MCP adapter (advanced)
packages/cli               Standalone command-line interface (advanced)
apps/gateway               Standalone Python gateway (advanced)
templates/vault            Starter vault examples
docs                       Specifications
config                     Governance defaults
```

## Design rules

1. Markdown is the storage contract.
2. By default the Obsidian plugin hosts the UI, knowledge runtime, and MCP service; the standalone gateway is only for advanced headless deployments.
3. Agents never bypass governance.
4. Canonical knowledge requires human review or explicit policy.
5. Every object has provenance.
6. Every mutation can be audited.
7. Sensitive data never enters the vault.
8. Customers need only one plugin package and never need to understand the internal runtime.
