export interface McpToolSpec {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: boolean;
  };
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
}

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const;

const GOVERNED_WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
} as const;

const tags = { type: 'array', items: { type: 'string' }, maxItems: 20 };
const slug = { type: 'string', maxLength: 128 };

export const TOOLS: McpToolSpec[] = [
  {
    name: 'kb_get_context',
    description: 'Get the governed context pack for this Obsidian vault.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: READ_ONLY
  },
  {
    name: 'kb_search',
    description: 'Search Markdown notes in this Obsidian vault.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 1000 },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        case_sensitive: { type: 'boolean', default: false }
      },
      required: ['query'],
      additionalProperties: false
    },
    annotations: READ_ONLY
  },
  {
    name: 'kb_read_note',
    description: 'Read a Markdown note from this Obsidian vault.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1 },
        max_bytes: { type: 'integer', minimum: 1, maximum: 262144, default: 65536 }
      },
      required: ['path'],
      additionalProperties: false
    },
    annotations: READ_ONLY
  },
  {
    name: 'kb_get_status',
    description: 'Get knowledge service status and the agent instructions.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: READ_ONLY
  },
  {
    name: 'kb_create_message',
    description: 'Create an inbound agent message (persistent memory channel) for later review. Use this for information, records, task context and user preferences — not for reusable judgments, which belong in kb_create_inbox_card.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 500 },
        content: { type: 'string', minLength: 1 },
        tags,
        slug
      },
      required: ['content'],
      additionalProperties: false
    },
    annotations: GOVERNED_WRITE
  },
  {
    name: 'kb_create_inbox_card',
    description: 'Create a candidate knowledge card for human review in Obsidian. The card must contain a reusable judgment, a traceable source, an owner and a scope — information or raw records belong in kb_create_message instead.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 500 },
        content: { type: 'string', minLength: 1 },
        tags,
        confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        owner: { type: 'string', maxLength: 200, description: 'Who is responsible for this knowledge. Defaults to the submitting agent.' },
        scope: { type: 'string', maxLength: 500, description: 'Where this judgment applies. Extracted from the 适用范围 section when omitted.' },
        expires_at: { type: 'string', maxLength: 64, description: 'Optional expiry date (YYYY-MM-DD). After this date it must not be treated as authoritative.' },
        version: { type: 'string', maxLength: 32 },
        slug
      },
      required: ['title', 'content'],
      additionalProperties: false
    },
    annotations: GOVERNED_WRITE
  },
  {
    name: 'kb_create_session_note',
    description: 'Create a session record (task-context channel) in this Obsidian vault.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 500 },
        content: { type: 'string', minLength: 1 },
        result: { type: 'string', enum: ['completed', 'partial', 'failed'] },
        tags,
        slug
      },
      required: ['title', 'content'],
      additionalProperties: false
    },
    annotations: GOVERNED_WRITE
  },
  {
    name: 'kb_propose_update',
    description: 'Propose a note update without directly modifying existing knowledge.',
    inputSchema: {
      type: 'object',
      properties: {
        target_path: { type: 'string', minLength: 1 },
        reason: { type: 'string', minLength: 1 },
        evidence: { type: 'string' },
        impact: { type: 'string' },
        proposed_content: { type: 'string', minLength: 1 },
        rollback_note: { type: 'string' },
        slug
      },
      required: ['target_path', 'reason', 'proposed_content'],
      additionalProperties: false
    },
    annotations: GOVERNED_WRITE
  }
];
