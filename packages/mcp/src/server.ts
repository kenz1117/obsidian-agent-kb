#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import { GatewayClient, GatewayToolError } from './gateway-client.js';
import { TOOLS } from './tools.js';

export async function main(): Promise<void> {
  if (process.argv.includes('--list-tools')) {
    process.stdout.write(`${JSON.stringify({ tools: TOOLS }, null, 2)}\n`);
    return;
  }

  const gateway = new GatewayClient();
  try {
    await gateway.initialize();
  } catch (error) {
    gateway.close();
    throw error;
  }

  const server = new Server(
    { name: 'obsidian-agent-kb', version: '0.2.0' },
    {
      capabilities: { tools: { listChanged: false } },
      instructions: 'Use read tools for governed context. Writes only create inbox, session, message, or proposal objects; canonical knowledge still requires human review.'
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name } = request.params;
    if (!TOOLS.some(tool => tool.name === name)) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
    }
    try {
      return await gateway.callTool(name, request.params.arguments ?? {});
    } catch (error) {
      const message = error instanceof GatewayToolError
        ? error.message
        : `Knowledge gateway unavailable: ${error instanceof Error ? error.message : String(error)}`;
      return { content: [{ type: 'text', text: message }], isError: true };
    }
  });

  const transport = new StdioServerTransport(undefined, undefined, { maxBufferSize: 2 * 1024 * 1024 });
  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    gateway.close();
    await server.close();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  server.onclose = () => void shutdown();

  await server.connect(transport);
}

main().catch(error => {
  process.stderr.write(`Obsidian Agent KB MCP failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
