// Decision A (2026-10-17): BOT_REPLY_PROVIDER=deepseek-all. DeepSeek answers everything; Claude Haiku 5.5 is an
// idle fallback for the rest of ONE poll after DeepSeek fails, never a cap-day handover, and a dead fallback
// never aborts a night DeepSeek can serve. Offline: every HTTP call is mocked, no state is written.
import assert from 'node:assert/strict';
process.env.ANTHROPIC_API_KEY = 'synthetic-claude';
process.env.DEEPSEEK_API_KEY = 'synthetic-deepseek';
process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
process.env.BOT_REPLY_PROVIDER = 'deepseek-all';
process.env.BOT_DEEPSEEK_RETRY_MS = '0';
process.env.BOT_USAGE_LOG = 'off';
delete process.env.BOT_MODEL; delete process.env.BOT_TRIAGE_MODEL; delete process.env.BOT_FALLBACK_MODEL;
delete process.env.ANTHROPIC_AUTH_TOKEN;

type Reply = { status?: number; body?: unknown; throws?: boolean };
let deepScript: Reply[] = [];
let claudeScript: Reply[] = [];
const sent: Array<{ host: string; body: any }> = [];
const usage = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const valid = { intent: 'question', decision: 'reply', category: 'teach', reply_text: 'Impacted stool fills the colon here.', reason: 'synthetic', needs_lookup: false, promo_product: 'none', promo_explicit: false };
const submit = (model: string, input: unknown = valid) => ({ id: 's', type: 'message', role: 'assistant', model, stop_reason: 'tool_use', usage, content: [{ type: 'tool_use', id: 't', name: 'submit_reply', input }] });
globalThis.fetch = async (url, init) => {
  const host = new URL(String(url)).hostname;
  const body = JSON.parse(String(init?.body));
  sent.push({ host, body });
  const step = (host === 'api.deepseek.com' ? deepScript : claudeScript).shift() ?? {};
  if (step.throws) throw new TypeError('synthetic network failure');
  return new Response(JSON.stringify(step.body ?? submit(body.model)), { status: step.status ?? 200, headers: { 'content-type': 'application/json' } });
};
const logs: string[] = [];
const origLog = console.log;
console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };

const { config } = await import('../src/config');
Object.assign(config, { gifReplies: false, voiceVariant: 'lean', webSearch: false });
const { classifyAndDraft } = await import('../src/reply');
const rp = await import('../src/reply-provider');
const { drainSpend, costOf, priceFor } = await import('../src/spend');
const base = { postText: 'A synthetic teaching puzzle.', commentText: 'How does this happen?', answer: 'Synthetic answer', answerPublic: true, replyAll: true, learnedNotesOverride: '', modelOverride: config.triageModel, allowSearch: false };
const hosts = () => sent.map(s => s.host);
const reset = () => { rp.resetDeepSeekBreakerForTests(); sent.length = 0; deepScript = []; claudeScript = []; drainSpend(); };
const credit = { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } } };

try {
  assert.equal(config.replyProvider, 'deepseek-all');
  assert.equal(config.fallbackModel, 'claude-haiku-5-5');
  assert.ok(!/sonnet/.test(config.model) && !/sonnet/.test(config.triageModel), 'no Sonnet anywhere in the deepseek-all reply path');

  // 1. One-poll fallback: retries exhausted -> Haiku 5.5 answers, DeepSeek is off for the rest of this poll only.
  reset();
  deepScript = [{ status: 503 }, { status: 503 }, { status: 503 }];
  const failed = await classifyAndDraft(base);
  assert.equal(failed.reply_text, valid.reply_text, 'the fallback answered the comment');
  assert.deepEqual(hosts(), ['api.deepseek.com', 'api.deepseek.com', 'api.deepseek.com', 'api.anthropic.com'], 'two retries, then Claude');
  const haiku = sent[3].body;
  assert.equal(haiku.model, 'claude-haiku-5-5', 'the fallback is Haiku 5.5');
  assert.deepEqual(haiku.tool_choice, { type: 'tool', name: 'submit_reply' }, 'Haiku 5.5 keeps the forced submit_reply');
  assert.deepEqual(haiku.thinking, { type: 'disabled' }); assert.equal(haiku.output_config.effort, 'low');
  assert.equal(haiku.max_tokens, 1024);
  assert.ok(!JSON.stringify(haiku.system).includes('DEEPSEEK REPLY DISCIPLINE'), 'the fallback gets the original prompt');
  assert.equal(rp.takeDeepSeekTrip(), false, 'deepseek-all never persists a cap-day breaker');
  assert.equal(rp.replyTrialProviderSnapshot().halted, true, 'DeepSeek is off for the rest of this poll');
  assert.ok(Math.abs(drainSpend().usd - costOf('claude-haiku-5-5', usage)) < 1e-12, 'HTTP 503s are not charged; Haiku priced at its own rate');
  sent.length = 0;
  await classifyAndDraft({ ...base, commentText: 'And this one?' });
  assert.deepEqual(hosts(), ['api.anthropic.com'], 'the rest of the poll goes straight to Haiku without retries');
  assert.ok(logs.some(l => /DeepSeek off for the rest of this poll/.test(l)));

  // 2. Recovery: the next poll (a new process) tries DeepSeek again, and a persisted legacy breaker is ignored.
  reset();
  rp.seedDeepSeekHalt(true);
  await classifyAndDraft(base);
  assert.deepEqual(hosts(), ['api.deepseek.com'], 'next poll: DeepSeek again, legacy cap-day halt ignored');

  // 3. A dead idle fallback must not abort the run: DeepSeek transient + Claude out of credit = transient error.
  reset();
  deepScript = [{ throws: true }, { throws: true }, { throws: true }];
  claudeScript = [credit];
  const deferred = await classifyAndDraft(base);
  assert.equal(deferred.decision, 'skip');
  assert.match(deferred.reason, /^error: fallback unavailable after a DeepSeek failure/, 'transient error, left for the next poll');
  assert.doesNotMatch(deferred.reason, /^fatal:/, 'never fatal while DeepSeek itself is healthy');
  assert.ok(Math.abs(drainSpend().usd - 0.35) < 1e-12, 'network failures charged once for the comment');

  // 4. Both providers dead (DeepSeek 402 + Anthropic credit): fatal, so the worker exits 3 and alarms.
  reset();
  deepScript = [{ status: 402, body: { error: { message: 'Insufficient Balance', type: 'unknown_error' } } }];
  claudeScript = [credit];
  const dead = await classifyAndDraft(base);
  assert.match(dead.reason, /^fatal:/, 'both providers dead is fatal');
  assert.deepEqual(hosts(), ['api.deepseek.com', 'api.anthropic.com'], 'no retry on 402');

  // 5. DeepSeek 402 with a healthy fallback: Haiku answers and the poll succeeds.
  reset();
  deepScript = [{ status: 402, body: { error: { message: 'Insufficient Balance' } } }];
  const covered = await classifyAndDraft(base);
  assert.equal(covered.reply_text, valid.reply_text);
  assert.ok(logs.some(l => /::warning::DeepSeek balance exhausted \(HTTP 402\)/.test(l)));

  // 6. DeepSeek repair path: an unusable verdict gets one DeepSeek repair; a good repair needs no Claude.
  reset();
  deepScript = [{ body: submit('deepseek-flash', { ...valid, confidence: 'high' }) }, {}];
  const repaired = await classifyAndDraft(base);
  assert.equal(repaired.reply_text, valid.reply_text);
  assert.deepEqual(hosts(), ['api.deepseek.com', 'api.deepseek.com']);
  assert.match(JSON.stringify(sent[1].body.messages.at(-1).content.at(-1)), /REPAIR \(one attempt\).*unexpected field confidence/);
  assert.equal(rp.replyTrialProviderSnapshot().halted, false, 'an unusable verdict is not an outage');
  // A failed repair goes to Haiku 5.5 with the original request.
  reset();
  deepScript = [{ body: submit('deepseek-flash', { ...valid, confidence: 'high' }) }, { body: submit('deepseek-flash', { ...valid, confidence: 'low' }) }];
  const viaHaiku = await classifyAndDraft(base);
  assert.equal(viaHaiku.reply_text, valid.reply_text);
  assert.deepEqual(hosts(), ['api.deepseek.com', 'api.deepseek.com', 'api.anthropic.com']);
  assert.equal(sent[2].body.model, 'claude-haiku-5-5');
  assert.ok(!JSON.stringify(sent[2].body.messages).includes('REPAIR (one attempt)'));

  // 7. Haiku 5.5 request adaptation (docs + live smoke 2026-10-17): forced tool kept, thinking off, effort low,
  // sampling parameters dropped; Sonnet 5.5 keeps its auto + headroom adaptation.
  const shape = { model: 'claude-haiku-5-5', max_tokens: 1024, temperature: 0, top_p: 0.5, top_k: 5, messages: [{ role: 'user', content: 'x' }], tools: [], tool_choice: { type: 'tool', name: 'submit_reply' } } as any;
  const adapted = rp.adaptClaudeRequest(shape);
  assert.equal(adapted.forcedTool, null);
  assert.deepEqual(adapted.request.tool_choice, { type: 'tool', name: 'submit_reply' });
  assert.deepEqual((adapted.request as any).thinking, { type: 'disabled' });
  assert.equal((adapted.request as any).output_config.effort, 'low');
  assert.ok(!('temperature' in adapted.request) && !('top_p' in adapted.request) && !('top_k' in adapted.request), 'Haiku 5.5 rejects non-default sampling');
  assert.equal(adapted.request.max_tokens, 1024, 'no thinking headroom needed with thinking off');
  assert.equal(shape.temperature, 0, 'original request not mutated');
  assert.ok(!rp.NO_FORCED_TOOL_CHOICE.test('claude-haiku-5-5'), 'Haiku 5.5 accepts forced tool_choice');
  assert.ok(rp.HAIKU_5_5.test('claude-haiku-5-5'));
  assert.deepEqual(rp.adaptClaudeRequest({ ...shape, model: 'claude-sonnet-5-5' }).request.tool_choice, { type: 'auto' });

  // 8. Haiku 5.5 pricing from the official page: $0.10/$0.50 up to 100K prompt tokens, $0.50/$2.50 above.
  assert.deepEqual(priceFor('claude-haiku-5-5'), { input: 0.1, output: 0.5 });
  const small = { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 10_000, cache_creation: { ephemeral_1h_input_tokens: 2000, ephemeral_5m_input_tokens: 0 } };
  assert.ok(Math.abs(costOf('claude-haiku-5-5', small) - (1000 * 0.1 + 10_000 * 0.01 + 2000 * 0.2 + 100 * 0.5) / 1e6) < 1e-12);
  const long = { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 100_000 };
  assert.ok(Math.abs(costOf('claude-haiku-5-5', long) - (1000 * 0.5 + 100_000 * 0.05 + 100 * 2.5) / 1e6) < 1e-12, 'long-prompt tier counts cache reads');
} finally {
  console.log = origLog;
}
console.log('PASS deepseek-all: retries then Haiku 5.5 for the rest of one poll, no cap-day breaker, next poll back on DeepSeek; dead fallback is transient, both dead is fatal; DeepSeek repair before Haiku; Haiku 5.5 adaptation and pricing.');
