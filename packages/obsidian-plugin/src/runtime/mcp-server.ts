import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { TOOLS } from '../mcp-tools.js';
import { KnowledgeError, KnowledgeRuntime } from './knowledge.js';

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

async function parsedBody(request: IncomingMessage): Promise<unknown> {
  if (request.method !== 'POST') return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) throw new KnowledgeError('request exceeds 2 MiB');
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new KnowledgeError('invalid JSON request');
  }
}

function localOriginAllowed(request: IncomingMessage): boolean {
  const host = request.headers.host || '';
  if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(host)) return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return ['127.0.0.1', 'localhost', '::1'].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export class EmbeddedMcpServer {
  private server: HttpServer | null = null;
  private readonly agentByToken: Record<string, string>;

  constructor(
    private readonly runtime: KnowledgeRuntime,
    private readonly port: number,
    tokens: Record<string, string> | string
  ) {
    this.agentByToken = typeof tokens === 'string' ? { [tokens]: 'obsidian-agent' } : { ...tokens };
  }

  get url(): string {
    return this.urlFor('obsidian-agent');
  }

  urlFor(agentId: string): string {
    const entry = Object.entries(this.agentByToken).find(([, identity]) => identity === agentId);
    if (!entry) throw new Error(`No MCP token configured for ${agentId}`);
    return `http://127.0.0.1:${this.port}/mcp/${entry[0]}`;
  }

  async start(): Promise<void> {
    if (this.server) return;
    if (!Number.isInteger(this.port) || this.port < 1024 || this.port > 65535) throw new Error('MCP port must be between 1024 and 65535');
    for (const [token, agentId] of Object.entries(this.agentByToken)) {
      if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('MCP access token is invalid');
      this.runtime.forAgent(agentId);
    }
    const server = createServer((request, response) => void this.handle(request, response));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error): void => reject(error);
      server.once('error', failed);
      server.listen(this.port, '127.0.0.1', () => {
        server.off('error', failed);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (!localOriginAllowed(request)) {
        response.writeHead(403, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'forbidden host or origin' }));
        return;
      }
      const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
      if (pathname === '/health' && request.method === 'GET') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ status: 'ok', service: 'obsidian-agent-kb' }));
        return;
      }
      const agentId = pathname.startsWith('/mcp/') ? this.agentByToken[pathname.slice(5)] : undefined;
      if (!agentId) {
        response.writeHead(404);
        response.end();
        return;
      }
      const agentRuntime = this.runtime.forAgent(agentId);
      const body = await parsedBody(request);
      if (body && typeof body === 'object' && (body as Record<string, unknown>).method === 'initialize') {
        const params = (body as Record<string, unknown>).params;
        const clientInfo = params && typeof params === 'object'
          ? (params as Record<string, unknown>).clientInfo
          : null;
        if (clientInfo && typeof clientInfo === 'object') {
          const client = clientInfo as Record<string, unknown>;
          if (typeof client.name === 'string') {
            await agentRuntime.recordConnection(client.name, typeof client.version === 'string' ? client.version : '');
          }
        }
      }
      const mcp = new Server(
        { name: 'obsidian-agent-kb', version: '0.6.0' },
        {
          capabilities: { tools: { listChanged: false } },
          instructions: 'Search and read governed knowledge. Create candidates for human review; never write secrets or modify canonical notes directly.'
        }
      );
      mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
      mcp.setRequestHandler(CallToolRequestSchema, async call => {
        if (!TOOLS.some(tool => tool.name === call.params.name)) {
          throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${call.params.name}`);
        }
        try {
          const args = call.params.arguments ?? {};
          const result = await agentRuntime.callTool(call.params.name, args);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            structuredContent: result,
            isError: false
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
            isError: true
          };
        }
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        allowedHosts: [`127.0.0.1:${this.port}`, `localhost:${this.port}`],
        enableDnsRebindingProtection: true
      });
      response.on('close', () => void mcp.close());
      await mcp.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch (error) {
      if (!response.headersSent) {
        const message = error instanceof Error ? error.message : 'request failed';
        response.writeHead(message.includes('2 MiB') ? 413 : 400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: message }));
      } else {
        response.end();
      }
    }
  }
}
