export type QueueName = 'review' | 'auto' | 'canonical' | 'archive' | 'conflicts' | 'stale';

export interface FolderSettings {
  knowledgeRoot: string;
  autoFolder: string;
  reviewedFolder: string;
  canonicalFolder: string;
  archiveRoot: string;
}

export interface GovernedCard {
  path: string;
  title: string;
  status: string;
  score: number | null;
  confidence: string;
  source: string;
  updated: string;
  duplicateOf?: string;
  issues?: string[];
  [key: string]: unknown;
}

export function normalizeFolderPath(value: string): string {
  if (typeof value !== 'string') throw new Error('Knowledge paths must be strings');
  if (/[\0-\x1f]/.test(value) || /^[A-Za-z]:[\\/]/.test(value)) throw new Error('Knowledge paths must be relative and printable');
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').replace(/\/+$/, '');
  if (!normalized || normalized === '.') return '';
  if (normalized.split('/').some(part => part === '..' || part === '.')) throw new Error('Knowledge paths cannot contain "." or ".."');
  return normalized;
}

export function withRoot(root: string, folder: string): string {
  const a = normalizeFolderPath(root);
  const b = normalizeFolderPath(folder);
  return [a, b].filter(Boolean).join('/');
}

export function isWithin(path: string, folder: string): boolean {
  const p = normalizeFolderPath(path);
  const f = normalizeFolderPath(folder);
  return !!f && (p === f || p.startsWith(`${f}/`));
}

export function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function isStale(card: GovernedCard, staleDays = 180): boolean {
  const date = parseDate(card.updated);
  if (!date) return true;
  return Date.now() - date.getTime() > staleDays * 24 * 60 * 60 * 1000;
}

export function scoreBand(score: number | null): 'high' | 'medium' | 'low' | 'unknown' {
  if (score === null || Number.isNaN(score)) return 'unknown';
  if (score >= 80) return 'high';
  if (score >= 60) return 'medium';
  return 'low';
}

/** Keep UI promotion rules aligned with config/governance.policy.json. */
export function promotionBlockers(card: Pick<GovernedCard, 'status' | 'score' | 'confidence'> & { sensitivity?: unknown }): string[] {
  const blockers: string[] = [];
  if (card.status !== 'review' && card.status !== 'canonical') blockers.push(`status must be review, got ${card.status}`);
  if (card.score === null || !Number.isFinite(card.score) || card.score < 80) blockers.push('governance score must be at least 80');
  if (!['medium', 'high'].includes(card.confidence)) blockers.push('confidence must be medium or high');
  if (card.sensitivity === 'secret') blockers.push('secret sensitivity cannot be promoted');
  return blockers;
}

export function queueForCard(
  card: GovernedCard,
  settings: FolderSettings,
  staleDays = 180
): QueueName {
  const path = card.path;
  const archive = withRoot(settings.archiveRoot, '');
  const canonical = withRoot(settings.knowledgeRoot, settings.canonicalFolder);
  const reviewed = withRoot(settings.knowledgeRoot, settings.reviewedFolder);
  const auto = withRoot(settings.knowledgeRoot, settings.autoFolder);

  if (card.status === 'archive' || isWithin(path, archive)) return 'archive';
  if (card.duplicateOf || (Array.isArray(card.issues) && card.issues.some(x => /duplicate/i.test(x)))) return 'conflicts';
  if (card.status === 'canonical' || isWithin(path, canonical)) return 'canonical';
  if (isWithin(path, reviewed) || card.status === 'review') return 'review';
  if (isWithin(path, auto) || card.status === 'auto' || card.status === 'pending') return 'auto';
  return isStale(card, staleDays) ? 'stale' : 'review';
}

export interface CardFilter {
  query?: string;
  minScore?: number | null;
  confidence?: string;
}

export function filterCards<T extends GovernedCard>(cards: T[], filter: CardFilter): T[] {
  const query = (filter.query ?? '').trim().toLowerCase();
  return cards.filter(card => {
    if (filter.minScore !== null && filter.minScore !== undefined && (card.score === null || card.score < filter.minScore)) return false;
    if (filter.confidence && card.confidence !== filter.confidence) return false;
    if (!query) return true;
    return `${card.title}\n${card.path}\n${card.source}\n${card.status}`.toLowerCase().includes(query);
  });
}

export function duplicateGroups(cards: GovernedCard[]): GovernedCard[][] {
  const exact = new Map<string, GovernedCard[]>();
  for (const card of cards) {
    const body = String((card as any).bodyHash ?? '');
    const key = `${normalizeTitle(card.title)}|${body}`;
    const group = exact.get(key) ?? [];
    group.push(card);
    exact.set(key, group);
  }
  return [...exact.values()].filter(group => group.length > 1);
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');
}

export function governanceStats(cards: GovernedCard[], settings: FolderSettings): Record<QueueName, number> {
  const queues: QueueName[] = ['review', 'auto', 'canonical', 'archive', 'conflicts', 'stale'];
  const result = Object.fromEntries(queues.map(name => [name, 0])) as Record<QueueName, number>;
  for (const card of cards) result[queueForCard(card, settings)] += 1;
  return result;
}
