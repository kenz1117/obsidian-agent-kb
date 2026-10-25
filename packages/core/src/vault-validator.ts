import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { parseFrontmatter, type FrontmatterData } from './frontmatter.js';
import type { GovernancePolicy } from './types.ts';

export interface ValidationIssue {
  level: 'error' | 'warning';
  code: string;
  path: string;
  message: string;
}

export interface VaultValidationResult {
  root: string;
  ok: boolean;
  checkedFiles: number;
  issues: ValidationIssue[];
}

const REQUIRED_DIRECTORIES = [
  '00-contract',
  '01-inbox/human',
  '02-sessions',
  '03-knowledge/auto',
  '03-knowledge/reviewed',
  '03-knowledge/canonical',
  '04-projects',
  '05-decisions',
  '06-sources',
  '07-maps',
  '90-archive'
];

const IGNORED_PARTS = new Set(['.git', '.obsidian', 'node_modules', 'dist', '.trash']);
const ALLOWED_STATUSES = new Set([
  'pending',
  'intake',
  'auto',
  'review',
  'canonical',
  'stale',
  'archive',
  'purge'
]);
const ALLOWED_TYPES = new Set([
  'message',
  'source',
  'knowledge',
  'session',
  'decision',
  'map',
  'contract'
]);

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return !!rel && !rel.startsWith(`..${sep}`) && rel !== '..';
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const output: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return output;
  }

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (IGNORED_PARTS.has(entry.name)) continue;
    const info = await stat(path);
    if (info.isDirectory()) output.push(...(await listMarkdownFiles(path)));
    else if (entry.isFile() && entry.name.endsWith('.md')) output.push(path);
  }
  return output;
}

function field(data: FrontmatterData, key: string): string {
  const value = data[key];
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value).trim();
}

function validateMetadata(
  relativePath: string,
  data: FrontmatterData,
  policy?: GovernancePolicy,
  issues: ValidationIssue[] = []
): void {
  const required = [
    'id',
    'type',
    'title',
    'status',
    'source',
    'origin',
    'confidence',
    'sensitivity',
    'created',
    'updated',
    'tags'
  ];

  for (const key of required) {
    if (!field(data, key)) {
      issues.push({
        level: 'error',
        code: 'metadata/missing',
        path: relativePath,
        message: `Missing required frontmatter field: ${key}`
      });
    }
  }

  const type = field(data, 'type');
  if (type && !ALLOWED_TYPES.has(type)) {
    issues.push({
      level: 'error',
      code: 'metadata/invalid-type',
      path: relativePath,
      message: `Unsupported type: ${type}`
    });
  }

  const status = field(data, 'status');
  if (status && !ALLOWED_STATUSES.has(status)) {
    issues.push({
      level: 'error',
      code: 'metadata/invalid-status',
      path: relativePath,
      message: `Unsupported status: ${status}`
    });
  }

  const confidence = field(data, 'confidence');
  if (confidence && !['low', 'medium', 'high'].includes(confidence)) {
    issues.push({
      level: 'error',
      code: 'metadata/invalid-confidence',
      path: relativePath,
      message: `Confidence must be low, medium, or high`
    });
  }

  const sensitivity = field(data, 'sensitivity');
  if (
    sensitivity &&
    !['public', 'internal', 'confidential', 'personal', 'secret'].includes(sensitivity)
  ) {
    issues.push({
      level: 'error',
      code: 'metadata/invalid-sensitivity',
      path: relativePath,
      message: `Unsupported sensitivity: ${sensitivity}`
    });
  }

  if (policy) {
    const allowedTypes = policy.intake.allowed_types;
    if (type && allowedTypes.length && !allowedTypes.includes(type)) {
      issues.push({
        level: 'error',
        code: 'governance/type-not-allowed',
        path: relativePath,
        message: `Type is not allowed by policy: ${type}`
      });
    }

    for (const key of policy.intake.reject_if_missing) {
      if (!field(data, key)) {
        issues.push({
          level: 'error',
          code: 'governance/missing-required-field',
          path: relativePath,
          message: `Policy requires field: ${key}`
        });
      }
    }

    if (sensitivity && policy.sensitivity.reject.includes(sensitivity as never)) {
      issues.push({
        level: 'error',
        code: 'governance/sensitivity-rejected',
        path: relativePath,
        message: `Sensitivity is rejected by policy: ${sensitivity}`
      });
    }
  }
}

export async function validateVaultStructure(
  root: string
): Promise<{ ok: boolean; issues: ValidationIssue[] }> {
  const issues: ValidationIssue[] = [];
  const absRoot = resolve(root);

  let info;
  try {
    info = await stat(absRoot);
  } catch {
    return {
      ok: false,
      issues: [
        {
          level: 'error',
          code: 'vault/missing-root',
          path: absRoot,
          message: 'Vault root does not exist'
        }
      ]
    };
  }

  if (!info.isDirectory()) {
    return {
      ok: false,
      issues: [
        {
          level: 'error',
          code: 'vault/root-not-directory',
          path: absRoot,
          message: 'Vault root is not a directory'
        }
      ]
    };
  }

  for (const dir of REQUIRED_DIRECTORIES) {
    const target = join(absRoot, dir);
    try {
      const targetInfo = await stat(target);
      if (!targetInfo.isDirectory()) {
        issues.push({
          level: 'error',
          code: 'vault/not-directory',
          path: dir,
          message: `Expected directory: ${dir}`
        });
      }
    } catch {
      issues.push({
        level: 'error',
        code: 'vault/missing-directory',
        path: dir,
        message: `Missing required directory: ${dir}`
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

export async function validateVault(
  root: string,
  policy?: GovernancePolicy
): Promise<VaultValidationResult> {
  const absRoot = resolve(root);
  const structure = await validateVaultStructure(absRoot);
  const issues = [...structure.issues];
  const files = await listMarkdownFiles(absRoot);
  const governedRoots = ['00-contract', '01-inbox', '02-sessions', '03-knowledge', '04-projects', '05-decisions', '06-sources', '07-maps', '90-archive'];
  const seenIds = new Map<string, string>();

  for (const file of files) {
    const relativePath = relative(absRoot, file).split(sep).join('/');
    const governed = governedRoots.some((prefix) => relativePath.startsWith(`${prefix}/`));
    if (!governed) continue;

    let parsed;
    try {
      parsed = parseFrontmatter(await readFile(file, 'utf8'));
    } catch (error) {
      issues.push({
        level: 'error',
        code: 'file/unreadable',
        path: relativePath,
        message: error instanceof Error ? error.message : String(error)
      });
      continue;
    }

    if (!parsed.hasFrontmatter) {
      issues.push({
        level: 'error',
        code: 'metadata/no-frontmatter',
        path: relativePath,
        message: 'Governed Markdown file has no frontmatter'
      });
      continue;
    }

    validateMetadata(relativePath, parsed.data, policy, issues);

    const id = field(parsed.data, 'id');
    if (id) {
      const existing = seenIds.get(id);
      if (existing) {
        issues.push({
          level: 'error',
          code: 'metadata/duplicate-id',
          path: relativePath,
          message: `Duplicate id: ${id}; first seen in ${existing}`
        });
      } else {
        seenIds.set(id, relativePath);
      }
    }
  }

  return {
    root: absRoot,
    ok: issues.every((issue) => issue.level !== 'error'),
    checkedFiles: files.length,
    issues
  };
}

export async function isInsideVault(vaultRoot: string, target: string): Promise<boolean> {
  return isInside(resolve(vaultRoot), resolve(target));
}
