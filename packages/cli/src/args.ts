export class UsageError extends Error {}

export interface ParsedArgs {
  flags: Set<string>;
  values: Map<string, string>;
  positionals: string[];
}

interface ParseOptions {
  flags?: readonly string[];
  values?: readonly string[];
  minPositionals?: number;
  maxPositionals?: number;
  positionalLabel?: string;
}

export function parseArgs(argv: string[], options: ParseOptions = {}): ParsedArgs {
  const allowedFlags = new Set(options.flags ?? []);
  const allowedValues = new Set(options.values ?? []);
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const positionals: string[] = [];
  let positionalOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (positionalOnly || !arg.startsWith('--') || arg === '-') {
      positionals.push(arg);
      continue;
    }
    if (arg === '--') {
      positionalOnly = true;
      continue;
    }

    const equals = arg.indexOf('=');
    const name = equals === -1 ? arg : arg.slice(0, equals);
    if (allowedFlags.has(name)) {
      if (equals !== -1) throw new UsageError(`${name} does not accept a value.`);
      if (flags.has(name)) throw new UsageError(`${name} may only be specified once.`);
      flags.add(name);
      continue;
    }
    if (allowedValues.has(name)) {
      if (values.has(name)) throw new UsageError(`${name} may only be specified once.`);
      const value = equals === -1 ? argv[++index] : arg.slice(equals + 1);
      if (value === undefined || value === '' || (equals === -1 && value.startsWith('--'))) {
        throw new UsageError(`${name} requires a non-empty value.`);
      }
      values.set(name, value);
      continue;
    }
    throw new UsageError(`Unknown option: ${name}`);
  }

  const min = options.minPositionals ?? 0;
  const max = options.maxPositionals ?? 0;
  if (positionals.length < min || positionals.length > max) {
    const label = options.positionalLabel ?? 'arguments';
    throw new UsageError(`Expected ${min === max ? min : `${min} to ${max}`} ${label}.`);
  }
  return { flags, values, positionals };
}
