import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const GATEWAY_TIMEOUT_MS = 30_000;

export class GatewayError extends Error {}

interface GatewayResult {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputExceeded: boolean;
}

function execute(script: string, args: string[], env: NodeJS.ProcessEnv): Promise<GatewayResult> {
  const gatewayBin = env.OAKB_GATEWAY_BIN
    ? path.resolve(env.OAKB_GATEWAY_BIN)
    : path.join(repositoryRoot, 'apps', 'gateway', 'bin');
  const executable = env.OAKB_PYTHON || 'python3';

  return new Promise((resolve, reject) => {
    const child = spawn(executable, [path.join(gatewayBin, script), ...args], {
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let outputExceeded = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, GATEWAY_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= MAX_OUTPUT_BYTES) stdout.push(chunk);
      else outputExceeded = true;
      if (outputExceeded) child.kill('SIGTERM');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= MAX_OUTPUT_BYTES) stderr.push(chunk);
      else outputExceeded = true;
      if (outputExceeded) child.kill('SIGTERM');
    });
    child.once('error', error => {
      clearTimeout(timer);
      reject(new GatewayError(`Unable to start gateway Python (${executable}): ${error.message}`));
    });
    child.once('close', status => {
      clearTimeout(timer);
      resolve({
        status,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut,
        outputExceeded
      });
    });
  });
}

export async function runGateway(
  script: 'oakb' | 'oakb-automate',
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<Record<string, unknown>> {
  const result = await execute(script, args, env);
  if (result.timedOut) throw new GatewayError(`Gateway timed out after ${GATEWAY_TIMEOUT_MS / 1000} seconds.`);
  if (result.outputExceeded) throw new GatewayError(`Gateway output exceeded ${MAX_OUTPUT_BYTES} bytes.`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim().slice(-4000);
    throw new GatewayError(detail || `Gateway exited with status ${result.status ?? 'unknown'}.`);
  }
  try {
    const value: unknown = JSON.parse(result.stdout);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected an object');
    return value as Record<string, unknown>;
  } catch {
    throw new GatewayError('Gateway returned invalid JSON output.');
  }
}
