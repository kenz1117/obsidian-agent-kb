# MCP Tools

All agent-facing operations are exposed through MCP.

## Read tools

### `kb_get_context`

Returns the minimum context pack for the calling agent.

### `kb_search`

Searches governed Markdown notes.

### `kb_read_note`

Reads a note inside the vault boundary.

### `kb_get_status`

Returns agent identity, permissions, and vault status.

## Write tools

### `kb_create_message`

Creates an inbound agent message.

```json
{
  "title": "Decision from task",
  "content": "The team decided to use SQLite for local metadata.",
  "tags": ["decision", "storage"]
}
```

### `kb_create_inbox_card`

Creates a candidate knowledge card.

### `kb_create_session_note`

Creates a session record.

### `kb_propose_update`

Proposes a change to protected content without modifying it directly.

## Governance tools planned

### `kb_review_card`

Approves, rejects, or requests changes.

### `kb_promote_card`

Moves a reviewed card to canonical storage.

### `kb_archive_card`

Moves stale material into archive.

### `kb_purge_card`

Executes retention policy after approval.

## Access rules

1. Agent identity comes from gateway configuration, not prompt text.
2. Agents write only to their own inbox or governed write endpoints.
3. Canonical promotion is governance-controlled.
4. Secret-bearing writes are rejected.
