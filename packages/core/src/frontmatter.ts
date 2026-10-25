export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | FrontmatterValue[]
  | { [key: string]: FrontmatterValue };

export type FrontmatterData = Record<string, FrontmatterValue>;

export interface ParsedMarkdown {
  data: FrontmatterData;
  body: string;
  hasFrontmatter: boolean;
}

function parseScalar(raw: string): FrontmatterValue {
  const value = raw.trim();

  if (!value) return '';
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).replace(/\\(["'])/g, '$1');
  }
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;

  if (/^[+-]?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^[+-]?\d+\.\d+$/.test(value)) return Number.parseFloat(value);

  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return splitFlowSequence(inner).map((item) => parseScalar(item));
  }

  return value;
}

function splitFlowSequence(value: string): string[] {
  const items: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let depth = 0;

  for (const char of value) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '[') depth += 1;
    if (char === ']') depth -= 1;
    if (char === ',' && depth === 0) {
      items.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim()) items.push(current.trim());
  return items;
}

export function parseFrontmatter(input: string): ParsedMarkdown {
  if (!input.startsWith('---\n') && !input.startsWith('---\r\n')) {
    return { data: {}, body: input, hasFrontmatter: false };
  }

  const normalized = input.replace(/\r\n/g, '\n');
  const end = normalized.indexOf('\n---', 4);
  if (end === -1) return { data: {}, body: input, hasFrontmatter: false };

  const yaml = normalized.slice(4, end).trim();
  let body = normalized.slice(end + 4);
  if (body.startsWith('\n')) body = body.slice(1);

  const data: FrontmatterData = {};
  let currentKey: string | null = null;
  let currentList: FrontmatterValue[] | null = null;

  for (const rawLine of yaml.split('\n')) {
    const line = rawLine.replace(/\t/g, '  ');
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const listItem = line.match(/^\s+-\s+(.*)$/);
    if (listItem && currentKey && currentList) {
      currentList.push(parseScalar(listItem[1]));
      continue;
    }

    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) continue;

    const key = pair[1];
    const rawValue = pair[2].trim();
    currentKey = key;
    currentList = null;

    if (rawValue === '') {
      currentList = [];
      data[key] = currentList;
      continue;
    }

    data[key] = parseScalar(rawValue);
  }

  return { data, body, hasFrontmatter: true };
}

function stringifyScalar(value: FrontmatterValue): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  const text = String(value);
  if (/^[\w./ -]+$/.test(text)) return text;
  return JSON.stringify(text);
}

export function stringifyFrontmatter(data: FrontmatterData): string {
  const lines: string[] = ['---'];

  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) lines.push(`  - ${stringifyScalar(item)}`);
      }
    } else {
      lines.push(`${key}: ${stringifyScalar(value)}`);
    }
  }

  lines.push('---', '');
  return lines.join('\n');
}

export function withFrontmatter(
  data: FrontmatterData,
  body: string
): string {
  return `${stringifyFrontmatter(data)}${body.startsWith('\n') ? body : `\n${body}`}`;
}
