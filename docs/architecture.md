# Architecture

Obsidian Agent KB is intentionally divided into four layers.

## 1. Ingestion Layer

Accepts data from:

- AI agent messages
- local Markdown files
- chat exports
- project notes
- external systems via connectors

Standard entrypoints:

```text
MCP tool call
CLI command
filesystem inbox
connector webhook
```

## 2. Governance Layer

The governance layer is the most important layer.

It turns raw input into governed memory.

Responsibilities:

- reject invalid input
- detect secrets and sensitive data
- normalize frontmatter
- remove duplicates
- assign provenance
- calculate confidence
- classify knowledge type
- enforce retention
- route into review or archive

Raw data never becomes canonical knowledge automatically.

## 3. Knowledge Layer

The knowledge layer is Markdown-native and Git-versioned.

Lifecycle:

```text
intake → auto → review → canonical → stale → archive → purge
```

## 4. Delivery Layer

Agents consume knowledge through:

- MCP tools
- CLI queries
- context packs
- source indexes
- project maps

Humans inspect and manage through Obsidian.

## Repository layout

```text
packages/core              domain model and governance engine
packages/mcp               MCP server
packages/cli               command-line interface
packages/obsidian-plugin   human review UI
connectors                 platform adapters
templates/vault            standard starter vault
docs                       specifications
config                     governance defaults
```

## Design rules

1. Markdown is the storage contract.
2. Obsidian is an interface, not the runtime.
3. Agents never bypass governance.
4. Canonical knowledge requires review or explicit policy.
5. Every object has provenance.
6. Every mutation can be audited.
7. Sensitive data never enters the vault.
