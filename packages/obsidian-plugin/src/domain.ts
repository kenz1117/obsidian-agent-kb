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

export interface AdmissionCard {
  status: string;
  score: number | null;
  confidence: string;
  sensitivity?: unknown;
  /** 对该知识正确性负责的人或组织。 */
  owner?: string;
  /** 适用范围。 */
  scope?: string;
  /** 失效日期。 */
  expires_at?: string;
  /** 存续状态：active / archived / retired。 */
  state?: string;
  /** 重复指向的卡。 */
  duplicateOf?: string;
}

/** 存续状态中不得作为权威依据的。 */
const REJECTED_STATES = ['archived', 'retired', 'draft'];

/**
 * 判断力检测（与 packages/core 的 hasJudgment 保持一致）。
 * 中英文都要覆盖：只匹配英文会让纯中文的知识卡全部判为"无判断"。
 */
const JUDGMENT_PATTERNS: RegExp[] = [
  // 中文情态与规范标记
  /必须|务必|严禁|禁止|不得|不可|不要|切勿|勿|不应|不该|应当|应该|需要|建议|推荐|优先|宁可|避免|防止|确保|保证/,
  // "应"单用太常见（响应、适应…），必须限定后面的动作动词
  /应(保留|声明|设置|使用|配置|读取|固定|统一|优先|先|为|是|与|保持|采用|符合|满足|包含|提供|区分|避免|遵循)/,
  // 因果与依据
  /因为|因此|所以|由于|原因是|理由是|依据是|基于/,
  // 规则、职责与边界
  /规则|约定|规范|约束|前提|条件|边界|限制|准则|标准|要求|职责|负责|决定/,
  // 方法与步骤
  /步骤|方法|流程|做法|如何|怎么/,
  // 失效与例外
  /风险|例外|除非|失效|过期|不适用|仅当|只有当|不作为/,
  // 默认与一致
  /默认|统一|一律|始终|总是|慎用|一致/,
  // 英文
  /\b(decide|decision|use|prefer|avoid|because|since|therefore|constraint|require|requires|required|must|should|shall|never|always|rule|method|steps?|risk|unless|except|default|only when|do not|don't|responsible for|determines)\b/i
];
/** 内容是否包含可复用的判断（而不只是信息或原始记录）。 */
export function hasJudgment(body: string): boolean {
  return JUDGMENT_PATTERNS.some((pattern) => pattern.test(body));
}

/** 从正文里提取"## 适用范围"段落。 */
export function extractScope(body: string): string {
  const lines = body.split('\n');
  const start = lines.findIndex(line => /^##\s*适用范围\s*$/.test(line.trim()));
  if (start < 0) return '';
  const collected: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s/.test(lines[index].trim())) break;
    collected.push(lines[index]);
  }
  return collected
    .join(' ')
    .replace(/^[-*]\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

/**
 * Keep UI promotion rules aligned with config/governance.policy.json.
 * 该文件是 plugin 内的唯一副本，packages/core 的测试会断言两者一致。
 */
export function promotionBlockers(card: AdmissionCard, now: Date = new Date()): string[] {
  const blockers: string[] = [];
  if (card.status !== 'review' && card.status !== 'canonical') blockers.push(`status must be review, got ${card.status}`);
  if (card.score === null || !Number.isFinite(card.score) || card.score < 80) blockers.push('governance score must be at least 80');
  if (!['medium', 'high'].includes(card.confidence)) blockers.push('confidence must be medium or high');
  if (card.sensitivity === 'secret') blockers.push('secret sensitivity cannot be promoted');

  // ---- 第一道门：来源与 Owner（一票否决）----
  if (!String(card.owner ?? '').trim()) blockers.push('owner is required');
  if (!String(card.scope ?? '').trim()) blockers.push('scope is required');
  if (card.expires_at) {
    const expiry = Date.parse(card.expires_at);
    if (Number.isFinite(expiry) && expiry < now.getTime()) blockers.push(`expired on ${card.expires_at}`);
  }
  if (REJECTED_STATES.includes(String(card.state ?? 'active'))) blockers.push(`state is ${card.state}`);

  // ---- 第二道门：复用与去重（一票否决）----
  if (card.duplicateOf && card.duplicateOf.trim()) blockers.push(`duplicate of ${card.duplicateOf}`);

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

/** 分组标题：把长路径压成「目录/文件」，让人一眼认出这批卡来自哪份材料。 */
function groupLabel(source: string): string {
  const value = (source || '').trim();
  if (!value || value === 'unknown') return 'unknown';
  // URI 形态（agent://xxx、https://xxx）按原样显示，拆路径会把它拆坏。
  if (value.includes('://')) return value;
  if (!value.includes('/')) return value;
  const parts = value.split('/').filter(Boolean);
  if (parts.length <= 1) return value;
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

export interface SourceGroup<T extends GovernedCard = GovernedCard> {
  label: string;
  cards: T[];
}

/** 总览卡识别：同一来源下先看总览，再看原子卡。 */
function isOverviewCard(card: GovernedCard): boolean {
  const title = String(card.title || '');
  const path = String(card.path || '');
  return /总览|概览|导航|overview/i.test(title) || /overview/i.test(path);
}

/**
 * 按来源分组。
 * 几十张候选卡平铺时无法判断该先审哪一批；派生物按源文档成组出现，
 * 同组共享同一份来源与同一套限定语，适合连着审。
 * 组内总览卡排最前——先看总览确认整份材料的理解对不对，再逐张看原子卡。
 */
export function groupBySource<T extends GovernedCard>(cards: T[]): SourceGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const card of cards) {
    const key = (card.source || '').trim() || 'unknown';
    const bucket = groups.get(key);
    if (bucket) bucket.push(card);
    else groups.set(key, [card]);
  }
  return [...groups.entries()]
    .map(([source, bucket]) => ({
      label: groupLabel(source),
      cards: [...bucket].sort((a, b) => Number(isOverviewCard(b)) - Number(isOverviewCard(a)))
    }))
    .sort((a, b) => b.cards.length - a.cards.length || a.label.localeCompare(b.label));
}

export function duplicateGroups(cards: GovernedCard[]): GovernedCard[][] {  const exact = new Map<string, GovernedCard[]>();
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
