// 2026-10-17 audit: one DeepSeek transport error tripped the cap-day breaker and moved six hours to Claude.
// Decision A (2026-10-17): retry 429/5xx/network errors twice with backoff, answer only the failed comment
// on the fallback, never retry a request-specific 4xx, log class and status only. An HTTP error response is
// not charged; a network error is charged conservatively once per comment. Legacy mode: the breaker trips
// on the second failed comment in one poll. Mocked HTTP and a fake fallback: no network, no state.
import assert from 'node:assert/strict';
process.env.ANTHROPIC_API_KEY = 'synthetic-claude';
process.env.DEEPSEEK_API_KEY = 'synthetic-deepseek-key-SECRET';
process.env.BOT_DEEPSEEK_RETRY_MS = '0';
process.env.BOT_USAGE_LOG = 'off';
delete process.env.ANTHROPIC_AUTH_TOKEN;

const SECRET_BODY = 'upstream said: prompt contained PATIENT-SECRET';
type Step = 'ok' | 'http500' | 'http429' | 'http400' | 'http402' | 'net';
let script: Step[] = [];
let deepCalls = 0;
globalThis.fetch = async (url, init) => {
  const host = new URL(String(url)).hostname;
  assert.equal(host, 'api.deepseek.com', 'the fake fallback answers; Claude is never called');
  deepCalls++;
  const step = script.shift() ?? 'ok';
  if (step === 'net') throw new TypeError('socket hang up');
  if (step !== 'ok') {
    const status = Number(step.slice(4));
    return new Response(JSON.stringify({ error: { type: 'api_error', message: SECRET_BODY } }), { status, headers: { 'content-type': 'application/json', 'retry-after': '0' } });
  }
  const body = JSON.parse(String(init?.body));
  return new Response(JSON.stringify({ id: 'd', type: 'message', role: 'assistant', model: 'deepseek-flash', stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    content: [{ type: 'tool_use', id: 't', name: 'submit_reply', input: { echo: body.model } }] }), { headers: { 'content-type': 'application/json' } });
};
const logs: string[] = [];
const origLog = console.log;
console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
const { config } = await import('../src/config');
Object.assign(config, { deepSeekTrial: true, replyProvider: 'deepseek', webSearch: false });
const { createReplyMessage, setReplyFallback, takeDeepSeekTrip, lastServedModel, errorClass, resetDeepSeekBreakerForTests } = await import('../src/reply-provider');
const { drainSpend } = await import('../src/spend');
let fallbackCalls = 0;
const previous = setReplyFallback({ name: 'fake-fallback', send: async (request) => { fallbackCalls++; return { id: 'f', type: 'message', role: 'assistant', model: 'fake-fallback-model', stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 }, content: [{ type: 'text', text: String(request.model) }] } as never; } });
assert.equal(previous.name, 'claude', 'Claude is the default fallback');
const request = { model: config.triageModel, max_tokens: 1024, messages: [{ role: 'user', content: 'hi' }], tools: [], tool_choice: { type: 'auto' } } as never;
const tokens = (10 * 0.30 + 10 * 1.20) / 1e6;

try {
  // A 5xx blip then success: one retry, DeepSeek serves, the HTTP error is not charged, no trip.
  resetDeepSeekBreakerForTests(); drainSpend(); script = ['http500', 'ok']; deepCalls = 0; fallbackCalls = 0;
  const recovered = await createReplyMessage(request);
  assert.equal(recovered.model, 'deepseek-flash'); assert.equal(lastServedModel(), 'deepseek-flash');
  assert.equal(deepCalls, 2); assert.equal(fallbackCalls, 0); assert.equal(takeDeepSeekTrip(), false);
  assert.ok(Math.abs(drainSpend().usd - tokens) < 1e-12, 'an HTTP error response produced nothing and is not charged');
  assert.ok(logs.some((l) => /DeepSeek error \(class=\w+ status=500\)/.test(l)), 'class and status are logged');
  assert.ok(logs.some((l) => l.includes('DeepSeek retry 1 succeeded')));

  // 429 twice then success: two retries are allowed per comment.
  script = ['http429', 'http429', 'ok']; deepCalls = 0;
  assert.equal((await createReplyMessage(request)).model, 'deepseek-flash'); assert.equal(deepCalls, 3);
  drainSpend();

  // Three network failures: the comment goes to the fallback, charged 0.35 once, DeepSeek stays on (1/2).
  script = ['net', 'net', 'net']; deepCalls = 0;
  const first = await createReplyMessage(request);
  assert.equal(first.model, 'fake-fallback-model'); assert.equal(lastServedModel(), 'fake-fallback-model');
  assert.equal(deepCalls, 3, 'first attempt plus two retries'); assert.equal(fallbackCalls, 1); assert.equal(takeDeepSeekTrip(), false, 'one failed comment does not trip');
  assert.ok(Math.abs(drainSpend().usd - 0.35) < 1e-12, 'uncertain usage charged once per comment, not per attempt');
  assert.ok(logs.some((l) => /DeepSeek transport error \(class=\w+ status=none\)/.test(l)), 'a network error has no status');
  // The next comment is tried on DeepSeek again and succeeds.
  script = ['ok']; deepCalls = 0;
  assert.equal((await createReplyMessage(request)).model, 'deepseek-flash'); assert.equal(deepCalls, 1);
  // A second failed comment in the same poll trips the legacy cap-day breaker.
  script = ['http500', 'http500', 'http500']; deepCalls = 0;
  assert.equal((await createReplyMessage(request)).model, 'fake-fallback-model');
  assert.equal(takeDeepSeekTrip(), true, 'second failure trips'); assert.equal(takeDeepSeekTrip(), false, 'reported once');
  deepCalls = 0;
  assert.equal((await createReplyMessage(request)).model, 'fake-fallback-model'); assert.equal(deepCalls, 0, 'halted for the rest of the process');

  // A request-specific rejection (400) is never retried and never trips: only that comment falls back.
  resetDeepSeekBreakerForTests(); script = ['http400']; deepCalls = 0; fallbackCalls = 0; drainSpend();
  assert.equal((await createReplyMessage(request)).model, 'fake-fallback-model');
  assert.equal(deepCalls, 1, 'no retry on 400'); assert.equal(takeDeepSeekTrip(), false);
  script = ['ok']; assert.equal((await createReplyMessage(request)).model, 'deepseek-flash', 'DeepSeek stays on after a 400');
  assert.equal(drainSpend().calls, 1, 'the 400 is not charged');

  // An exhausted balance (402) is never retried, warns loudly, and the comment falls back.
  resetDeepSeekBreakerForTests(); script = ['http402']; deepCalls = 0; fallbackCalls = 0;
  assert.equal((await createReplyMessage(request)).model, 'fake-fallback-model');
  assert.equal(deepCalls, 1, 'no retry on 402');
  assert.ok(logs.some((l) => /::warning::DeepSeek balance exhausted \(HTTP 402\)/.test(l)));

  // Never a body, message or key in the logs.
  for (const l of logs) {
    assert.ok(!l.includes('PATIENT-SECRET') && !l.includes('socket hang up') && !l.includes('SECRET'), `no body, message or key: ${l}`);
  }
  assert.equal(errorClass(Object.assign(new Error('secret body'), { status: 429 })), 'class=Error status=429');
  assert.equal(errorClass('string thrown'), 'class=String status=none');
} finally {
  console.log = origLog;
  setReplyFallback(null);
}
console.log('PASS DeepSeek retry: two retries with backoff on 429/5xx/network, none on 400/402, HTTP errors uncharged and network errors charged once per comment, the failed comment alone on a pluggable fallback, legacy breaker trips on the second failed comment, class and status logged without bodies or keys.');
