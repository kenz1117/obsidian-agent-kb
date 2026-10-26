import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBailianRequest,
  buildOpenAiRequest,
  extractChatContent,
  normalizeOutcome,
  planAutoAction,
  DecisionEngine,
  type DecisionSettings,
  type DecisionTransport
} from './decision.ts';

const settings: DecisionSettings = {
  provider: 'bailian-decision',
  endpoint: 'https://example.invalid/systemone',
  model: 'decision-model-preview',
  apiKeyEnv: 'DASHSCOPE_API_KEY',
  threshold: 0.85,
  autoPromote: true,
  autoArchive: false,
  dryRun: false,
  maxItems: 10
};

const context = {
  title: 'Vault 目录约定',
  content: '# Vault 目录约定\n\n知识分为 auto / reviewed / canonical 三层。',
  tags: ['vault', 'convention'],
  source: 'agent://codex',
  score: 92,
  confidence: 'high',
  sensitivity: 'internal',
  status: 'review'
};

test('bailian request carries state and the three governance questions', () => {
  const request = buildBailianRequest(settings, context);
  const body = JSON.parse(request.body);
  assert.equal(request.method, 'POST');
  assert.equal(body.model, 'decision-model-preview');
  assert.equal(body.state.title, context.title);
  assert.ok(body.state.content.includes('auto'));
  assert.deepEqual(Object.keys(body.questions).sort(), ['category', 'needs_human_review', 'promotable', 'quality']);
  assert.equal(body.questions.promotable.type, 'noul');
  assert.equal(body.questions.quality.type, 'score');
  assert.equal(body.questions.category.type, 'choice');
});

test('openai request asks for strict json with the expected keys', () => {
  const request = buildOpenAiRequest({ ...settings, provider: 'openai-compatible' }, context);
  const body = JSON.parse(request.body);
  assert.equal(body.response_format.type, 'json_object');
  assert.equal(body.temperature, 0);
  assert.ok(body.messages[0].content.includes('promotable'));
  assert.ok(body.messages[1].content.includes(context.title));
});

test('normalizes a bailian payload into confidence and verdict', () => {
  const outcome = normalizeOutcome({
    output: {
      promotable: { value: true, probability: 0.93 },
      quality: { value: '高度可信，内容完整且可直接复用' },
      category: { value: 'decision' },
      needs_human_review: { value: false, probability: 0.08 }
    }
  }, settings);
  assert.equal(outcome.promotable, true);
  assert.equal(outcome.needsHumanReview, false);
  assert.ok(outcome.confidence > 0.9);
  assert.ok(outcome.qualityScore >= 75);
  assert.equal(outcome.category, 'decision');
});

test('normalizes an openai chat completion payload', () => {
  const payload = {
    choices: [{ message: { content: JSON.stringify({
      promotable: false,
      promotable_confidence: 0.42,
      quality_score: 30,
      needs_human_review: true,
      category: 'reference',
      reason: '包含未经证实的断言'
    }) } }]
  };
  const outcome = normalizeOutcome(extractChatContent(payload), { ...settings, provider: 'openai-compatible' });
  assert.equal(outcome.promotable, false);
  assert.equal(outcome.needsHumanReview, true);
  assert.equal(outcome.qualityScore, 30);
  assert.equal(outcome.category, 'reference');
  assert.equal(outcome.reason, '包含未经证实的断言');
});

test('tolerates a fenced json answer', () => {
  const extracted = extractChatContent({ choices: [{ message: { content: '```json\n{"promotable":true}\n```' } }] });
  assert.equal((extracted as { promotable: boolean }).promotable, true);
});

test('hard rules always win over a confident model', () => {
  const outcome = normalizeOutcome({ promotable: { value: true, probability: 0.99 } }, settings);
  const plan = planAutoAction(outcome, { status: 'auto', score: 40, confidence: 'low' }, settings, ['score too low']);
  assert.equal(plan.action, 'review');
  assert.match(plan.reason, /硬性规则/);
});

test('low confidence is escalated even when the model says yes', () => {
  const outcome = normalizeOutcome({ promotable: { value: true, probability: 0.6 } }, settings);
  const plan = planAutoAction(outcome, { status: 'review', score: 90, confidence: 'high' }, settings, []);
  assert.equal(plan.action, 'review');
  assert.match(plan.reason, /低于阈值/);
});

test('needs_human_review is escalated even with high confidence', () => {
  const outcome = normalizeOutcome({ promotable: { value: true, probability: 0.97 }, needs_human_review: true }, settings);
  const plan = planAutoAction(outcome, { status: 'review', score: 90, confidence: 'high' }, settings, []);
  assert.equal(plan.action, 'review');
});

test('a confident yes promotes when every gate passes', () => {
  const outcome = normalizeOutcome({ promotable: { value: true, probability: 0.95 }, needs_human_review: false }, settings);
  const plan = planAutoAction(outcome, { status: 'review', score: 90, confidence: 'high' }, settings, []);
  assert.equal(plan.action, 'promote');
});

test('auto archive stays off unless explicitly enabled', () => {
  const outcome = normalizeOutcome({ promotable: { value: false, probability: 0.96 }, needs_human_review: false }, settings);
  const off = planAutoAction(outcome, { status: 'review', score: 90, confidence: 'high' }, settings, []);
  assert.equal(off.action, 'review');
  const on = planAutoAction(outcome, { status: 'review', score: 90, confidence: 'high' }, { ...settings, autoArchive: true }, []);
  assert.equal(on.action, 'archive');
});

test('dry run never archives automatically', () => {
  const outcome = normalizeOutcome({ promotable: { value: false, probability: 0.99 }, needs_human_review: false }, settings);
  const plan = planAutoAction(outcome, { status: 'review', score: 90, confidence: 'high' }, { ...settings, autoArchive: true, dryRun: true }, []);
  assert.equal(plan.action, 'review');
});

test('a transport failure is reported as a human-review escalation', async () => {
  const transport: DecisionTransport = async () => { throw new Error('network down'); };
  const engine = new DecisionEngine(settings, transport, 'key');
  const outcome = await engine.decide(context);
  assert.equal(outcome.error, 'network down');
  assert.equal(outcome.needsHumanReview, true);
});

test('an http error body becomes a readable error', async () => {
  const transport: DecisionTransport = async () => ({ status: 401, body: '{"message":"invalid api key"}' });
  const engine = new DecisionEngine(settings, transport, 'key');
  const outcome = await engine.decide(context);
  assert.match(outcome.error ?? '', /401/);
});

test('the api key is sent as a bearer token and never leaks into the body', async () => {
  let body = '';
  let auth = '';
  const transport: DecisionTransport = async request => {
    body = request.body;
    auth = request.headers.Authorization ?? '';
    return { status: 200, body: JSON.stringify({ promotable: { value: true, probability: 0.9 } }) };
  };
  const engine = new DecisionEngine(settings, transport, 'secret-key');
  await engine.decide(context);
  assert.equal(auth, 'Bearer secret-key');
  assert.equal(body.includes('secret-key'), false);
});

/* -------------------------------------------------------------------------
   Real payloads captured from the Bailian structured decision endpoint.
   ---------------------------------------------------------------------- */

const BAILIAN_PAYLOAD = {
  model: 'decision-model-preview',
  request_id: '8968b62a-bf7c-9ac5-825b-ec0042746f13',
  answers: {
    promotable: { type: 'noul', noul: 0.51 },
    quality: {
      type: 'score',
      score: 1.71,
      legend: { '0': '很可能出错', '1': '存在明显疑点', '2': '基本可靠', '3': '高度可信' },
      probabilities: { '0': 0.26, '1': 0.04, '2': 0.42, '3': 0.27 },
      confidence: 0.72
    },
    category: {
      type: 'choice',
      choice: 'fact',
      confidence: 0.49,
      probabilities: { fact: 0.62, decision: 0.36, procedure: 0, reference: 0.02 }
    },
    needs_human_review: { type: 'noul', noul: 0.48 }
  },
  usage: { input_tokens: 160 },
  latency_ms: 55.7
};

test('reads the real bailian payload: noul is the probability of yes', () => {
  const outcome = normalizeOutcome(BAILIAN_PAYLOAD, settings);
  // 0.51 is a genuine borderline, not a boolean false.
  assert.equal(outcome.promotable, true);
  assert.ok(Math.abs(outcome.confidence - 0.51) < 1e-9);
  assert.equal(outcome.category, 'fact');
});

test('reads the real bailian payload: score maps the 0..3 legend to 0..100', () => {
  const outcome = normalizeOutcome(BAILIAN_PAYLOAD, settings);
  // score 1.71 on a 0..3 legend -> 57%
  assert.ok(Math.abs(outcome.qualityScore - 57) < 0.5, `got ${outcome.qualityScore}`);
});

test('reads the real bailian payload: needs_human_review probability decides', () => {
  const outcome = normalizeOutcome(BAILIAN_PAYLOAD, settings);
  // 0.48 < 0.5 -> not flagged as needing review
  assert.equal(outcome.needsHumanReview, false);
});

test('a bailian payload without prose still yields a readable reason', () => {
  const outcome = normalizeOutcome(BAILIAN_PAYLOAD, settings);
  assert.match(outcome.reason, /可晋升概率 51%/);
  assert.match(outcome.reason, /质量分 57/);
  assert.match(outcome.reason, /需人工复核概率 48%/);
  assert.match(outcome.reason, /分类 fact/);
});

test('a borderline bailian answer is escalated rather than auto-promoted', () => {
  const outcome = normalizeOutcome(BAILIAN_PAYLOAD, settings);
  const plan = planAutoAction(outcome, { status: 'review', score: 90, confidence: 'high' }, settings, []);
  assert.equal(plan.action, 'review');
  assert.match(plan.reason, /低于阈值/);
});

test('a strongly positive bailian answer is promoted', () => {
  const payload = {
    answers: {
      promotable: { type: 'noul', noul: 0.96 },
      quality: { type: 'score', score: 2.9, legend: { '0': 'a', '1': 'b', '2': 'c', '3': 'd' }, confidence: 0.9 },
      category: { type: 'choice', choice: 'decision', confidence: 0.9 },
      needs_human_review: { type: 'noul', noul: 0.04 }
    }
  };
  const outcome = normalizeOutcome(payload, settings);
  assert.equal(outcome.promotable, true);
  assert.equal(outcome.needsHumanReview, false);
  assert.ok(outcome.qualityScore > 90);
  const plan = planAutoAction(outcome, { status: 'review', score: 90, confidence: 'high' }, settings, []);
  assert.equal(plan.action, 'promote');
});

test('a high needs_human_review probability forces escalation', () => {
  const payload = {
    answers: {
      promotable: { type: 'noul', noul: 0.93 },
      needs_human_review: { type: 'noul', noul: 0.88 }
    }
  };
  const outcome = normalizeOutcome(payload, settings);
  assert.equal(outcome.needsHumanReview, true);
  const plan = planAutoAction(outcome, { status: 'review', score: 90, confidence: 'high' }, settings, []);
  assert.equal(plan.action, 'review');
});
