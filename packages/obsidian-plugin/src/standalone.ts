import { readFile } from 'node:fs/promises';
import { KnowledgeRuntime, type RuntimeFolders } from './runtime/knowledge';
import { EmbeddedMcpServer } from './runtime/mcp-server';

interface StandaloneConfig {
  vaultRoot: string;
  auditDirectory: string;
  folders: RuntimeFolders;
  port: number;
  tokens: Record<string, string>;
}

async function main(): Promise<void> {
  const configPath = process.argv[2];
  if (!configPath) throw new Error('Standalone service config path is required');
  const config = JSON.parse(await readFile(configPath, 'utf8')) as StandaloneConfig;
  const runtime = new KnowledgeRuntime(config.vaultRoot, config.folders, config.auditDirectory);
  await runtime.initialize();
  const server = new EmbeddedMcpServer(runtime, config.port, config.tokens);
  await server.start();
  console.log(`Obsidian Agent KB background service listening on 127.0.0.1:${config.port}`);

  const shutdown = (): void => {
    void server.stop().finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

void main().catch(error => {
  console.error('[Obsidian Agent KB] background service failed', error);
  process.exitCode = 1;
});
