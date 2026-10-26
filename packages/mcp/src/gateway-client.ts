import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const PROTOCOL_VERSION = '2024-11-05';
const MAX_RESPONSE_BUFFER_BYTES = 2 * 1024 * 1024;

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class GatewayToolError extends Error {}

function gatewayPath(): string {
  const configured = process.env.OAKB_GATEWAY_PATH?.trim();
  if (configured) return path.resolve(configured);
  const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  return path.resolve(packageDir, '../../apps/gateway/bin/oakb-mcp');
}

function timeoutMs(): number {
  const parsed = Number(process.env.OAKB_GATEWAY_TIMEOUT_MS ?? 15000);
  return Number.isFinite(parsed) ? Math.max(1000, Math.min(120000, parsed)) : 15000;
}

/** A small, bounded JSON-RPC client for the local production gateway. */
export class GatewayClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private buffer = '';
  private stderr = '';
  private closed = false;

  constructor(command = gatewayPath()) {
    if (!existsSync(command)) {
      throw new Error(`Knowledge gateway not found: ${command}. Set OAKB_GATEWAY_PATH to its executable.`);
    }
    this.child = spawn(command, [], {
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    this.child.stderr.on('data', (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-8192);
    });
    this.child.on('error', error => this.failAll(new Error(`Unable to start knowledge gateway: ${error.message}`)));
    this.child.on('exit', (code, signal) => {
      if (!this.closed) {
        const detail = this.stderr.trim().split('\n').at(-1);
        this.failAll(new Error(`Knowledge gateway exited (${code ?? signal ?? 'unknown'})${detail ? `: ${detail}` : ''}`));
      }
    });
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: '@oakb/mcp', version: '0.2.0' }
    });
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const result = await this.request('tools/call', { name, arguments: args });
    if (!result || typeof result !== 'object' || !Array.isArray((result as CallToolResult).content)) {
      throw new Error('Knowledge gateway returned an invalid tool result');
    }
    return result as CallToolResult;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new Error('Knowledge gateway closed'));
    this.child.stdin.end();
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGTERM');
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('Knowledge gateway is closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Knowledge gateway request timed out: ${method}`));
      }, timeoutMs());
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, error => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`Unable to write to knowledge gateway: ${error.message}`));
      });
    });
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > MAX_RESPONSE_BUFFER_BYTES) {
      this.buffer = '';
      this.failAll(new Error('Knowledge gateway response exceeded the 2 MiB safety limit'));
      this.close();
      return;
    }
    while (true) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message: JsonRpcResponse;
      try {
        message = JSON.parse(line) as JsonRpcResponse;
      } catch {
        this.failAll(new Error('Knowledge gateway returned malformed JSON'));
        continue;
      }
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new GatewayToolError(message.error.message));
      else pending.resolve(message.result);
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
