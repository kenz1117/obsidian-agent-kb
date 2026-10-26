import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, UsageError } from './args.js';
import { runGateway } from './gateway.js';

const packageJson = new URL('../package.json', import.meta.url);
const templateRoot = fileURLToPath(new URL('../../../templates/vault/', import.meta.url));

const COMMANDS = {
  init: 'Initialize a governed vault without overwriting files',
  doctor: 'Validate vault structure, policy, and knowledge safety',
  ingest: 'Build an inbox review index (no AI generation)',
  distill: 'Score, deduplicate, and route existing knowledge cards',
  review: 'Show the review queue, or refresh it with --scan',
  promote: 'Promote an eligible reviewed card to canonical',
  archive: 'Archive a knowledge object with an audit reason',
  status: 'Show vault and registered agent status'
} as const;

type Command = keyof typeof COMMANDS;

const USAGE: Record<Command, string> = {
  init: 'oakb init [path]',
  doctor: 'oakb [--agent <id>] doctor',
  ingest: 'oakb [--agent <id>] ingest',
  distill: 'oakb [--agent <id>] distill',
  review: 'oakb [--agent <id>] review [--scan]',
  promote: 'oakb [--agent <id>] promote <target> [--reviewer <name>]',
  archive: 'oakb [--agent <id>] archive <target> [--reason <text>]',
  status: 'oakb [--agent <id>] status'
};

function generalHelp(): string {
  const lines = [
    'Obsidian Agent KB CLI',
    '',
    'Usage: oakb [--agent <id>] [--json] <command> [options]',
    '',
    'Commands:'
  ];
  for (const [name, description] of Object.entries(COMMANDS)) {
    lines.push(`  ${name.padEnd(10)} ${description}`);
  }
  lines.push(
    '',
    'All data output is JSON. Use oakb <command> --help for command usage.',
    'Environment: KB_VAULT_ROOT, KB_RUNTIME_DIR, KB_AGENT_ID, KB_AGENT_IDS',
    'Optional: OAKB_GATEWAY_BIN, OAKB_PYTHON'
  );
  return lines.join('\n');
}

function isCommand(value: string): value is Command {
  return Object.hasOwn(COMMANDS, value);
}

async function existsAsNonDirectory(target: string): Promise<boolean> {
  try {
    const stat = await lstat(target);
    return !stat.isDirectory() || stat.isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function initializeVault(destinationArg: string | undefined, cwd: string): Promise<Record<string, unknown>> {
  const destination = path.resolve(cwd, destinationArg ?? '.');
  if (await existsAsNonDirectory(destination)) {
    throw new Error(`Initialization target is not a regular directory: ${destination}`);
  }
  const templateStat = await lstat(templateRoot);
  if (!templateStat.isDirectory() || templateStat.isSymbolicLink()) {
    throw new Error(`Invalid vault template: ${templateRoot}`);
  }

  const entries: { source: string; destination: string; directory: boolean }[] = [];
  async function collect(source: string, target: string): Promise<void> {
    const children = await readdir(source, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const sourcePath = path.join(source, child.name);
      const targetPath = path.join(target, child.name);
      if (child.isSymbolicLink() || (!child.isDirectory() && !child.isFile())) {
        throw new Error(`Unsupported vault template entry: ${sourcePath}`);
      }
      const directory = child.isDirectory();
      entries.push({ source: sourcePath, destination: targetPath, directory });
      if (directory) await collect(sourcePath, targetPath);
    }
  }
  await collect(templateRoot, destination);

  for (const entry of entries) {
    try {
      const stat = await lstat(entry.destination);
      if (entry.directory && stat.isDirectory() && !stat.isSymbolicLink()) continue;
      throw new Error(`Refusing to overwrite existing path: ${entry.destination}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  await mkdir(destination, { recursive: true });
  let files = 0;
  for (const entry of entries) {
    if (entry.directory) await mkdir(entry.destination, { recursive: true });
    else {
      await copyFile(entry.source, entry.destination, constants.COPYFILE_EXCL);
      files += 1;
    }
  }
  return { initialized: true, vault: destination, files };
}

async function version(): Promise<string> {
  const manifest = JSON.parse(await readFile(packageJson, 'utf8')) as { version: string };
  return manifest.version;
}

export async function main(argv: string[]): Promise<number> {
  try {
    if (argv.length === 0) {
      console.log(generalHelp());
      return 0;
    }

    const env = { ...process.env };
    let index = 0;
    while (index < argv.length) {
      const arg = argv[index];
      if (arg === '--help' || arg === '-h') {
        if (index !== argv.length - 1) throw new UsageError(`${arg} cannot be combined with other arguments.`);
        console.log(generalHelp());
        return 0;
      }
      if (arg === '--version' || arg === '-v') {
        if (index !== argv.length - 1) throw new UsageError(`${arg} cannot be combined with other arguments.`);
        console.log(await version());
        return 0;
      }
      if (arg === '--json') {
        index += 1;
        continue;
      }
      if (arg === '--agent' || arg.startsWith('--agent=')) {
        const inline = arg.startsWith('--agent=');
        const agent = inline ? arg.slice('--agent='.length) : argv[++index];
        if (!agent || (!inline && agent.startsWith('--'))) throw new UsageError('--agent requires a non-empty value.');
        env.KB_AGENT_ID = agent;
        index += 1;
        continue;
      }
      break;
    }

    const commandName = argv[index];
    if (!commandName) throw new UsageError('Missing command.');
    if (!isCommand(commandName)) throw new UsageError(`Unknown command: ${commandName}`);
    const commandArgs = argv.slice(index + 1);
    if (commandArgs.includes('--help') || commandArgs.includes('-h')) {
      if (commandArgs.length !== 1) throw new UsageError(`Usage: ${USAGE[commandName]}`);
      console.log(`Usage: ${USAGE[commandName]}\n\n${COMMANDS[commandName]}.`);
      return 0;
    }

    let output: Record<string, unknown>;
    let exitCode = 0;
    if (commandName === 'init') {
      const args = parseArgs(commandArgs, { maxPositionals: 1, positionalLabel: 'vault paths' });
      output = await initializeVault(args.positionals[0], process.cwd());
    } else {
      const agentArgs = env.KB_AGENT_ID ? ['--agent', env.KB_AGENT_ID] : [];
      if (commandName === 'doctor') {
        parseArgs(commandArgs);
        output = await runGateway('oakb', [...agentArgs, 'governance', '--action', 'doctor'], env);
        if (output.ok !== true) exitCode = 1;
      } else if (commandName === 'ingest') {
        parseArgs(commandArgs);
        output = await runGateway('oakb-automate', ['inbox-triage'], env);
      } else if (commandName === 'distill') {
        parseArgs(commandArgs);
        output = await runGateway('oakb', [...agentArgs, 'governance', '--action', 'scan'], env);
      } else if (commandName === 'review') {
        const args = parseArgs(commandArgs, { flags: ['--scan'] });
        output = await runGateway('oakb', [...agentArgs, 'review', '--action', args.flags.has('--scan') ? 'scan' : 'list'], env);
      } else if (commandName === 'promote') {
        const args = parseArgs(commandArgs, {
          values: ['--reviewer'], minPositionals: 1, maxPositionals: 1, positionalLabel: 'targets'
        });
        const gatewayArgs = [...agentArgs, 'promote', args.positionals[0]];
        const reviewer = args.values.get('--reviewer');
        if (reviewer) gatewayArgs.push('--reviewer', reviewer);
        output = await runGateway('oakb', gatewayArgs, env);
      } else if (commandName === 'archive') {
        const args = parseArgs(commandArgs, {
          values: ['--reason'], minPositionals: 1, maxPositionals: 1, positionalLabel: 'targets'
        });
        const gatewayArgs = [...agentArgs, 'archive', args.positionals[0]];
        const reason = args.values.get('--reason');
        if (reason) gatewayArgs.push('--reason', reason);
        output = await runGateway('oakb', gatewayArgs, env);
      } else {
        parseArgs(commandArgs);
        output = await runGateway('oakb', [...agentArgs, 'status'], env);
      }
    }
    console.log(JSON.stringify(output, null, 2));
    return exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`oakb: ${message}`);
    if (error instanceof UsageError) console.error('Run oakb --help for usage.');
    return error instanceof UsageError ? 2 : 1;
  }
}
