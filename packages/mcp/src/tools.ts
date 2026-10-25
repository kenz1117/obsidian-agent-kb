export interface McpToolSpec {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: boolean;
  };
  governance: 'read' | 'message' | 'candidate' | 'proposal';
}

export const TOOLS: McpToolSpec[] = [
  {
    name: 'kb_get_context',
    description: 'Get the minimum governed context pack for the calling agent.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    governance: 'read'
  },
  {
    name: 'kb_search',
    description: 'Search governed Markdown notes.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 50 }
      },
      required: ['query'],
      additionalProperties: false
    },
    governance: 'read'
  },
  {
    name: 'kb_read_note',
    description: 'Read a note within the vault boundary.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        max_bytes: { type: 'integer', minimum: 1 }
      },
      required: ['path'],
      additionalProperties: false
    },
    governance: 'read'
  },
  {
    name: 'kb_get_status',
    description: 'Get agent identity, permissions, and vault status.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    governance: 'read'
  },
  {
    name: 'kb_create_message',
    description: 'Create an inbound agent message for governed distillation.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } }
      },
      required: ['content'],
      additionalProperties: false
    },
    governance: 'message'
  },
  {
    name: 'kb_create_inbox_card',
    description: 'Create a candidate knowledge card.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } }
      },
      required: ['title', 'content'],
      additionalProperties: false
    },
    governance: 'candidate'
  },
  {
    name: 'kb_create_session_note',
    description: 'Create a session record.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' }
      },
      required: ['title', 'content'],
      additionalProperties: false
    },
    governance: 'candidate'
  },
  {
    name: 'kb_propose_update',
    description: 'Propose a protected update without direct mutation.',
    inputSchema: {
      type: 'object',
      properties: {
        target_path: { type: 'string' },
        reason: { type: 'string' },
        proposed_content: { type: 'string' }
      },
      required: ['target_path', 'reason', 'proposed_content'],
      additionalProperties: false
    },
    governance: 'proposal'
  }
];
