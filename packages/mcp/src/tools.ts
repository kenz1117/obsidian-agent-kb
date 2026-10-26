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
  governance: 'read' | 'message' | 'candidate' | 'proposal';
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

export const TOOLS: McpToolSpec[] = [
  {
    name: 'kb_get_context',
    description: 'Get the minimum governed context pack for the calling agent.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
    governance: 'read'
  },
  {
    name: 'kb_search',
    description: 'Search governed Markdown notes using literal text matching.',
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
    annotations: READ_ONLY,
    governance: 'read'
  },
  {
    name: 'kb_read_note',
    description: 'Read a Markdown note within the vault boundary.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1 },
        max_bytes: { type: 'integer', minimum: 1, maximum: 262144, default: 65536 }
      },
      required: ['path'],
      additionalProperties: false
    },
    annotations: READ_ONLY,
    governance: 'read'
  },
  {
    name: 'kb_get_status',
    description: 'Get agent identity, permissions, and vault status.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
    governance: 'read'
  },
  {
    name: 'kb_create_message',
    description: 'Create an inbound agent message for governed distillation.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 500 },
        content: { type: 'string', minLength: 1 },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 20 },
        slug: { type: 'string', maxLength: 128 }
      },
      required: ['content'],
      additionalProperties: false
    },
    annotations: GOVERNED_WRITE,
    governance: 'message'
  },
  {
    name: 'kb_create_inbox_card',
    description: 'Create a candidate knowledge card in the calling agent inbox.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 500 },
        content: { type: 'string', minLength: 1 },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 20 },
        confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        slug: { type: 'string', maxLength: 128 }
      },
      required: ['title', 'content'],
      additionalProperties: false
    },
    annotations: GOVERNED_WRITE,
    governance: 'candidate'
  },
  {
    name: 'kb_create_session_note',
    description: 'Create a session record.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 500 },
        content: { type: 'string', minLength: 1 },
        result: { type: 'string', enum: ['completed', 'partial', 'failed'] },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 20 },
        slug: { type: 'string', maxLength: 128 }
      },
      required: ['title', 'content'],
      additionalProperties: false
    },
    annotations: GOVERNED_WRITE,
    governance: 'candidate'
  },
  {
    name: 'kb_propose_update',
    description: 'Propose a protected update without direct mutation.',
    inputSchema: {
      type: 'object',
      properties: {
        target_path: { type: 'string', minLength: 1 },
        reason: { type: 'string', minLength: 1 },
        evidence: { type: 'string' },
        impact: { type: 'string' },
        proposed_content: { type: 'string', minLength: 1 },
        rollback_note: { type: 'string' },
        slug: { type: 'string', maxLength: 128 }
      },
      required: ['target_path', 'reason', 'proposed_content'],
      additionalProperties: false
    },
    annotations: GOVERNED_WRITE,
    governance: 'proposal'
  }
];
