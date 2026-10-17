// 2026-10-17 audit: one DeepSeek transport error tripped the cap-day breaker and moved six hours to Claude.
// Retry once with backoff, answer only the failed comment on the fallback, log class and status only, and
// trip only after two failed comments in one poll. Mocked HTTP and a fake fallback: no network, no state.
import assert from 'node:assert/strict';
process.env.ANTHROPIC_API_KEY = 'synthetic-claude';
process.env.DEEPSEEK_API_KEY = 'synthetic-deepseek-key-SECRET';
process.env.BOT_DEEPSEEK_RETRY_MS = '0';
process.env.BOT_USAGE_LOG = 'off';
delete process.env.ANTHROPIC_AUTH_TOKEN;

const SECRET_BODY = 'upstream said: prompt contained PATIENT-SECRET';
let script: Array<'ok' | 'http500' | 'net'> = [];
let deepCalls = 0;
globalThis.fetch = async (url, init) => {
  const host = new URL(String(url)).hostname;
  assert.equal(host, 'api.deepseek.com', 'the fake fallback answers; Claude is never called');
  deepCalls++;
  const step = script.shift() ?? 'ok';
  if (step === 'net') throw new TypeError('socket hang up');
  if (step === 'http500') return new Response(JSON.stringify({ error: { type: 'api_error', message: SECRET_BODY } }), { status: 500, headers: { 'content-type': 'application/json' } });
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

try {
  // A blip then success: one retry, DeepSeek serves, two attempts, one conservative charge, no trip.
  resetDeepSeekBreakerForTests(); drainSpend(); script = ['http500', 'ok']; deepCalls = 0; fallbackCalls = 0;
  const recovered = await createReplyMessage(request);
  assert.equal(recovered.model, 'deepseek-flash'); assert.equal(lastServedModel(), 'deepseek-flash');
  assert.equal(deepCalls, 2); assert.equal(fallbackCalls, 0); assert.equal(takeDeepSeekTrip(), false);
  assert.ok(Math.abs(drainSpend().usd - (0.35 + (10 * 0.30 + 10 * 1.20) / 1e6)) < 1e-9, 'the failed attempt is still charged conservatively');
  assert.ok(logs.some((l) => /DeepSeek transport error \(class=\w+ status=500\)/.test(l)), 'class and status are logged');
  assert.ok(logs.some((l) => l.includes('DeepSeek retry succeeded')));

  // Same poll: the retry is spent. Next failure goes straight to the fallback for that comment only.
  script = ['net']; deepCalls = 0;
  const first = await createReplyMessage(request);
  assert.equal(first.model, 'fake-fallback-model'); assert.equal(lastServedModel(), 'fake-fallback-model');
  assert.equal(deepCalls, 1, 'no second retry in one poll'); assert.equal(fallbackCalls, 1); assert.equal(takeDeepSeekTrip(), false, 'one failed comment does not trip');
  assert.ok(logs.some((l) => /class=TypeError status=none/.test(l) || /class=\w+ status=none/.test(l)));
  // The next comment is tried on DeepSeek again and succeeds.
  script = ['ok']; deepCalls = 0;
  assert.equal((await createReplyMessage(request)).model, 'deepseek-flash'); assert.equal(deepCalls, 1);
  // A second failed comment in the same poll trips the cap-day breaker.
  script = ['http500']; deepCalls = 0;
  assert.equal((await createReplyMessage(request)).model, 'fake-fallback-model');
  assert.equal(takeDeepSeekTrip(), true, 'second failure trips'); assert.equal(takeDeepSeekTrip(), false, 'reported once');
  deepCalls = 0;
  assert.equal((await createReplyMessage(request)).model, 'fake-fallback-model'); assert.equal(deepCalls, 0, 'halted for the rest of the process');

  // A fresh poll: a failure then a failed retry answers that comment on the fallback without tripping.
  resetDeepSeekBreakerForTests(); script = ['net', 'http500']; deepCalls = 0; fallbackCalls = 0; drainSpend();
  assert.equal((await createReplyMessage(request)).model, 'fake-fallback-model');
  assert.equal(deepCalls, 2); assert.equal(fallbackCalls, 1); assert.equal(takeDeepSeekTrip(), false);
  assert.ok(Math.abs(drainSpend().usd - 0.70) < 1e-9, 'two uncertain attempts, two conservative charges');
  assert.ok(logs.some((l) => l.includes('DeepSeek retry failed')));

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
console.log('PASS DeepSeek retry: one retry per poll with backoff, the failed comment alone on a pluggable fallback, breaker trips on the second failed comment, conservative charge per uncertain attempt, class and status logged without bodies or keys.');
