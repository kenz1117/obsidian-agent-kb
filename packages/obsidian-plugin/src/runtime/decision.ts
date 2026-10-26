import { homedir } from 'node:os';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export type DecisionProvider = 'bailian-decision' | 'openai-compatible';

export interface DecisionSettings {
  provider: DecisionProvider;
  endpoint: string;
  model: string;
  apiKeyEnv: string;
  threshold: number;
  autoPromote: boolean;
  autoArchive: boolean;
  dryRun: boolean;
  maxItems: number;
}

export interface DecisionContext {
  title: string;
  content: string;
  tags: string[];
  source: string;
  score: number | null;
  confidence: string;
  sensitivity: string;
  status: string;
}

export interface DecisionOutcome {
  promotable: boolean;
  /** Normalised model confidence, 0..1. */
  confidence: number;
  /** Quality / severity score, 0..100. */
  qualityScore: number;
  needsHumanReview: boolean;
  category: string;
  reason: string;
  provider: string;
  model: string;
  raw: unknown;
  error?: string;
}

export interface DecisionRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
}

export type DecisionTransport = (request: DecisionRequest) => Promise<{ status: number; body: string }>;

export class DecisionError extends Error {}

const SCORE_CRITERIA = [
  '很可能出错，或包含需要人工核实的关键细节',
  '存在明显疑点，部分内容可能已经过时',
  '基本可靠，可直接作为长期知识复用',
  '高度可信，内容完整且可直接复用'
];

const CATEGORY_CRITERIA: Record<string, string> = {
  fact: '客观事实、数据或现状描述',
  decision: '决策结论、取舍理由与约束',
  procedure: '操作步骤、方法与可重复的操作指南',
  reference: '外部资料、链接或待整理的素材'
};

const PROMOTABLE_INSTRUCTION =
  '这张知识卡的内容是否准确、完整、可作为长期正式知识直接复用？' +
  '如果包含具体时间承诺、未经证实的断言、需要人工核实的细节，或只是一次性的临时记录，回答否。';

const NEEDS_HUMAN_INSTRUCTION =
  '这张知识卡是否必须由人工复核后才能进入正式知识库？' +
  '只要存在事实不确定性、敏感信息、互相矛盾的结论、或需要结合本地上下文才能判断的情况，就回答是。';

const CATEGORY_INSTRUCTION = '这条知识属于哪一类？';

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.\-]/g, '');
    // A string with no digits is not a number: treating it as 0 would make
    // label-based answers (e.g. "高度可信") look like a zero score.
    if (!cleaned || !/[0-9]/.test(cleaned)) return null;
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Recursively look for a named answer anywhere in an arbitrary payload. */
function findAnswer(payload: unknown, key: string, depth = 0): unknown {
  if (!payload || typeof payload !== 'object' || depth > 6) return undefined;
  const record = payload as Record<string, unknown>;
  if (key in record) return record[key];
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') {
      const nested = findAnswer(value, key, depth + 1);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

interface RawAnswer {
  /** The answer itself: boolean, probability, label or a score record. */
  value: unknown;
  /** Probability of the answer being "yes" (noul) or the dominant share. */
  probability: number | null;
  /** The provider's own confidence in this answer. */
  confidence: number | null;
  /** A 0..100 quality figure when the provider returned a scaled score. */
  percent: number | null;
}

/**
 * Read one answer from a structured-decision payload.
 *
 * The Bailian decision endpoint answers with:
 *   noul  -> { type: "noul",  noul: 0.51 }              (probability of "yes")
 *   score -> { type: "score", score: 1.71, legend: {...}, probabilities: {...}, confidence: 0.72 }
 *   choice-> { type: "choice", choice: "fact", confidence: 0.49, probabilities: {...} }
 * Other providers answer with plain booleans/numbers, which fall through to
 * the generic branches below.
 */
function readAnswer(raw: unknown): RawAnswer {
  if (raw === null || raw === undefined) {
    return { value: null, probability: null, confidence: null, percent: null };
  }
  if (typeof raw !== 'object') {
    const number = parseNumber(raw);
    return { value: raw, probability: number, confidence: null, percent: null };
  }
  const record = raw as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : null;

  if (type === 'noul') {
    const noul = parseNumber(record.noul ?? record.value ?? record.answer);
    return { value: noul, probability: noul, confidence: noul, percent: null };
  }
  if (type === 'score') {
    const score = parseNumber(record.score ?? record.value);
    const legend = record.legend && typeof record.legend === 'object' && !Array.isArray(record.legend)
      ? record.legend as Record<string, unknown>
      : null;
    const maxIndex = legend ? Math.max(0, Object.keys(legend).length - 1) : 3;
    const percent = score !== null && maxIndex > 0 ? clamp((score / maxIndex) * 100, 0, 100) : null;
    const probabilities = record.probabilities && typeof record.probabilities === 'object'
      ? record.probabilities as Record<string, unknown>
      : null;
    let dominant: number | null = null;
    if (probabilities) {
      for (const value of Object.values(probabilities)) {
        const parsed = parseNumber(value);
        if (parsed !== null && (dominant === null || parsed > dominant)) dominant = parsed;
      }
    }
    return { value: { score, legend }, probability: dominant, confidence: parseNumber(record.confidence), percent };
  }
  if (type === 'choice') {
    const choice = record.choice ?? record.value ?? record.answer;
    const probabilities = record.probabilities && typeof record.probabilities === 'object'
      ? record.probabilities as Record<string, unknown>
      : null;
    const share = probabilities ? parseNumber(probabilities[String(choice)]) : null;
    return { value: choice, probability: share, confidence: parseNumber(record.confidence), percent: null };
  }

  // Generic shapes: plain booleans, numbers, or { value, probability } records.
  const value = 'value' in record ? record.value
    : 'answer' in record ? record.answer
      : 'label' in record ? record.label
        : 'result' in record ? record.result
          : 'text' in record ? record.text
            : undefined;
  const confidence = parseNumber(record.probability ?? record.confidence ?? record.score ?? record.prob);
  const percent = 'quality_score' in record ? parseNumber(record.quality_score) : null;
  return { value: value === undefined ? raw : value, probability: confidence, confidence, percent };
}

function answerToBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0.5;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'y', '1', '是'].includes(normalized)) return true;
    if (['false', 'no', 'n', '0', '否'].includes(normalized)) return false;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const field of ['value', 'answer', 'label', 'result', 'text']) {
      if (field in record) {
        const nested = answerToBoolean(record[field]);
        if (nested !== null) return nested;
      }
    }
    const probability = parseNumber(record.probability ?? record.confidence ?? record.score);
    if (probability !== null) return probability > 0.5;
  }
  return null;
}

function answerToConfidence(value: unknown): number | null {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const probability = parseNumber(record.probability ?? record.confidence ?? record.score ?? record.prob);
    if (probability !== null) return probability > 1 ? probability / 100 : probability;
    return answerToConfidence(findAnswer(record, 'probability', 0));
  }
  const number = parseNumber(value);
  if (number === null) return null;
  return number > 1 ? number / 100 : number;
}

function answerToText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const field of ['value', 'answer', 'label', 'text', 'name', 'choice']) {
      if (field in record) return answerToText(record[field]);
    }
    return JSON.stringify(value).slice(0, 400);
  }
  return '';
}

/** Score 0..100 from either a 0..100 number or a 1..4 criteria label. */
function answerToQuality(value: unknown): number {
  const numeric = parseNumber(value);
  if (numeric !== null && !(value && typeof value === 'object' && 'label' in (value as object))) {
    return clamp(numeric > 1 ? numeric : numeric * 100, 0, 100);
  }
  const text = answerToText(value);
  const index = SCORE_CRITERIA.findIndex(criterion => text.includes(criterion.slice(0, 6)));
  if (index >= 0) return Math.round(((index + 1) / SCORE_CRITERIA.length) * 100);
  const fallback = SCORE_CRITERIA.findIndex(criterion => text && criterion.startsWith(text.slice(0, 6)));
  if (fallback >= 0) return Math.round(((fallback + 1) / SCORE_CRITERIA.length) * 100);
  return 0;
}

export function buildBailianRequest(settings: DecisionSettings, context: DecisionContext): DecisionRequest {
  const body = {
    model: settings.model || 'decision-model-preview',
    state: {
      title: context.title,
      content: context.content.slice(0, 6000),
      tags: context.tags,
      source: context.source,
      governance_score: context.score,
      declared_confidence: context.confidence,
      sensitivity: context.sensitivity,
      status: context.status
    },
    questions: {
      promotable: { type: 'noul', instructions: PROMOTABLE_INSTRUCTION },
      quality: { type: 'score', instructions: '这张知识卡作为正式知识被长期复用的质量有多高？', criteria: SCORE_CRITERIA },
      category: { type: 'choice', instructions: CATEGORY_INSTRUCTION, criteria: CATEGORY_CRITERIA },
      needs_human_review: { type: 'noul', instructions: NEEDS_HUMAN_INSTRUCTION }
    }
  };
  return {
    url: settings.endpoint,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

export function buildOpenAiRequest(settings: DecisionSettings, context: DecisionContext): DecisionRequest {
  const system = [
    'You are a governance reviewer for a long-term knowledge base.',
    'Judge whether a candidate knowledge card may be promoted to canonical knowledge.',
    'Answer with STRICT JSON only, no prose and no markdown fence, using exactly these keys:',
    '{"promotable": boolean, "promotable_confidence": number between 0 and 1,',
    ' "quality_score": integer 0-100, "needs_human_review": boolean,',
    ' "category": "fact"|"decision"|"procedure"|"reference", "reason": string}',
    'Be conservative: set needs_human_review to true whenever the content contains specific claims,',
    'dates, promises, unverifiable assertions, contradictions, or sensitive details.'
  ].join(' ');
  const user = [
    `Title: ${context.title}`,
    `Tags: ${context.tags.join(', ') || '(none)'}`,
    `Source: ${context.source || '(none)'}`,
    `Governance score: ${context.score ?? 'unknown'} | Declared confidence: ${context.confidence} | Sensitivity: ${context.sensitivity}`,
    '',
    'Content:',
    context.content.slice(0, 6000)
  ].join('\n');
  const body = {
    model: settings.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0,
    response_format: { type: 'json_object' }
  };
  return {
    url: settings.endpoint,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

/** Normalise a provider payload into a single decision outcome. */
export function normalizeOutcome(payload: unknown, settings: DecisionSettings): DecisionOutcome {
  const base: DecisionOutcome = {
    promotable: false,
    confidence: 0,
    qualityScore: 0,
    needsHumanReview: true,
    category: 'unknown',
    reason: '',
    provider: settings.provider,
    model: settings.model,
    raw: payload
  };

  // The structured-decision endpoint nests its answers under `answers`.
  const container = (payload && typeof payload === 'object'
    ? (payload as Record<string, unknown>).answers
    : undefined);
  const source = container && typeof container === 'object' ? container : payload;

  const promotable = readAnswer(findAnswer(source, 'promotable'));
  const quality = readAnswer(findAnswer(source, 'quality') ?? findAnswer(source, 'quality_score'));
  const needsHuman = readAnswer(findAnswer(source, 'needs_human_review'));
  const category = readAnswer(findAnswer(source, 'category'));
  const explicitConfidence = readAnswer(findAnswer(source, 'promotable_confidence'));

  const promotableBoolean = answerToBoolean(promotable.value);
  const confidence = clamp(
    explicitConfidence.probability ?? promotable.probability ?? promotable.confidence ?? 0,
    0,
    1
  );
  const qualityScore = quality.percent ?? answerToQuality(quality.value);
  const needsHumanBoolean = answerToBoolean(needsHuman.value);
  const categoryText = answerToText(category.value);

  // Without an explicit escalation flag we only assume "needs review" when
  // the model also gave us no usable signal. A confident answer is then
  // governed by the confidence threshold instead of being discarded.
  const needsHumanReview = needsHumanBoolean ?? !(confidence > 0 && promotableBoolean !== null);

  const outcome: DecisionOutcome = {
    ...base,
    promotable: promotableBoolean ?? false,
    confidence,
    qualityScore,
    needsHumanReview,
    category: categoryText || 'unknown',
    reason: answerToText(findAnswer(source, 'reason'))
  };

  if (!outcome.reason) {
    outcome.reason = synthesizeReason(outcome, {
      promotableProbability: promotable.probability,
      needsHumanProbability: needsHuman.probability,
      qualityScore: quality.value
    });
  }
  return outcome;
}

/**
 * The structured-decision endpoint returns probabilities but no prose, so the
 * human reviewer gets a readable summary built from the raw numbers.
 */
function synthesizeReason(
  outcome: DecisionOutcome,
  extra: { promotableProbability: number | null; needsHumanProbability: number | null; qualityScore: unknown }
): string {
  const parts: string[] = [];
  if (extra.promotableProbability !== null) {
    parts.push(`可晋升概率 ${(extra.promotableProbability * 100).toFixed(0)}%`);
  }
  parts.push(`质量分 ${Math.round(outcome.qualityScore)}`);
  if (extra.needsHumanProbability !== null) {
    parts.push(`需人工复核概率 ${(extra.needsHumanProbability * 100).toFixed(0)}%`);
  }
  if (outcome.category && outcome.category !== 'unknown') {
    parts.push(`分类 ${outcome.category}`);
  }
  return parts.join('，');
}

/** Pull the JSON payload out of an OpenAI-compatible chat completion. */
export function extractChatContent(payload: unknown): unknown {
  const content = findAnswer(payload, 'content');
  if (typeof content === 'string') {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const text = fenced ? fenced[1] : content;
    try {
      return JSON.parse(text);
    } catch {
      return { reason: content.slice(0, 500) };
    }
  }
  return payload;
}

/* ----------------------------------------------------------- api key --- */

const SECRETS_DIR = path.join(homedir(), 'Library', 'Application Support', 'obsidian-agent-kb');
const SECRETS_FILE = path.join(SECRETS_DIR, 'secrets.json');

export async function readStoredApiKey(): Promise<string> {
  try {
    const text = await readFile(SECRETS_FILE, 'utf8');
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return typeof parsed.apiKey === 'string' ? parsed.apiKey : '';
  } catch {
    return '';
  }
}

/** Store the API key outside the vault so it never reaches vault sync or git. */
export async function writeStoredApiKey(apiKey: string): Promise<void> {
  await mkdir(SECRETS_DIR, { recursive: true });
  await writeFile(SECRETS_FILE, `${JSON.stringify({ apiKey }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export async function resolveApiKey(envName: string): Promise<string> {
  const fromEnv = process.env[envName];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return (await readStoredApiKey()).trim();
}

/* ------------------------------------------------------------ engine --- */

export class DecisionEngine {
  constructor(
    private readonly settings: DecisionSettings,
    private readonly transport: DecisionTransport,
    private readonly apiKey: string
  ) {}

  async decide(context: DecisionContext): Promise<DecisionOutcome> {
    const request = this.settings.provider === 'bailian-decision'
      ? buildBailianRequest(this.settings, context)
      : buildOpenAiRequest(this.settings, context);
    const headers: Record<string, string> = { ...request.headers };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    let response: { status: number; body: string };
    try {
      response = await this.transport({ ...request, headers });
    } catch (error) {
      return this.failure(error instanceof Error ? error.message : String(error));
    }
    if (response.status >= 400) {
      return this.failure(`HTTP ${response.status}: ${response.body.slice(0, 300)}`);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(response.body);
    } catch {
      return this.failure('response was not valid JSON');
    }
    const normalized = this.settings.provider === 'openai-compatible'
      ? normalizeOutcome(extractChatContent(payload), this.settings)
      : normalizeOutcome(payload, this.settings);
    if (!normalized.reason) {
      normalized.reason = normalized.promotable
        ? '模型判定可晋升为正式知识。'
        : '模型判定不适合直接晋升。';
    }
    return normalized;
  }

  private failure(message: string): DecisionOutcome {
    return {
      promotable: false,
      confidence: 0,
      qualityScore: 0,
      needsHumanReview: true,
      category: 'unknown',
      reason: '',
      provider: this.settings.provider,
      model: this.settings.model,
      raw: null,
      error: message
    };
  }
}

/* ------------------------------------------------------------ gating --- */

export type AutoAction = 'promote' | 'archive' | 'review';

export interface AutoDecisionPlan {
  action: AutoAction;
  reason: string;
  blockers: string[];
  outcome: DecisionOutcome;
}

/**
 * Combine the model's judgement with the deterministic governance rules.
 * The model can never overrule a hard rule — it only decides what is left.
 */
export function planAutoAction(
  outcome: DecisionOutcome,
  card: { status: string; score: number | null; confidence: string; sensitivity?: unknown },
  settings: DecisionSettings,
  hardBlockers: string[]
): AutoDecisionPlan {
  if (hardBlockers.length) {
    return {
      action: 'review',
      reason: `硬性规则未通过：${hardBlockers.join('；')}`,
      blockers: hardBlockers,
      outcome
    };
  }
  if (outcome.error) {
    return { action: 'review', reason: `模型调用失败：${outcome.error}`, blockers: hardBlockers, outcome };
  }
  if (outcome.needsHumanReview) {
    return { action: 'review', reason: `模型建议人工复核：${outcome.reason}`, blockers: hardBlockers, outcome };
  }
  if (outcome.confidence < settings.threshold) {
    return {
      action: 'review',
      reason: `模型置信度 ${(outcome.confidence * 100).toFixed(0)}% 低于阈值 ${(settings.threshold * 100).toFixed(0)}%`,
      blockers: hardBlockers,
      outcome
    };
  }
  if (outcome.promotable) {
    return { action: 'promote', reason: outcome.reason, blockers: hardBlockers, outcome };
  }
  if (settings.autoArchive && !settings.dryRun) {
    return { action: 'archive', reason: outcome.reason, blockers: hardBlockers, outcome };
  }
  return { action: 'review', reason: `模型判定不建议晋升：${outcome.reason}`, blockers: hardBlockers, outcome };
}
