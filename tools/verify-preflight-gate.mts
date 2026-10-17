// Pre-flight gate (decision A, 2026-10-17). In deepseek-all the DeepSeek probe gates the window: 401/402/403
// is fatal (exit 3); the Anthropic probe only reports whether the Haiku 5.5 fallback is available. Legacy
// modes keep the Claude gate. Offline: fetch is mocked, nothing is spent.
import assert from 'node:assert/strict';
process.env.ANTHROPIC_API_KEY = 'synthetic-claude';
process.env.DEEPSEEK_API_KEY = 'synthetic-deepseek';
process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
process.env.BOT_REPLY_PROVIDER = 'deepseek-all';
delete process.env.BOT_MODEL; delete process.env.BOT_TRIAGE_MODEL; delete process.env.BOT_FALLBACK_MODEL;
delete process.env.ANTHROPIC_AUTH_TOKEN;

let deep = 200, claude = 200;
const seen: Array<{ host: string; body: any }> = [];
const err = (status: number, message: string) => new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message } }), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init) => {
  const host = new URL(String(url)).hostname;
  const body = JSON.parse(String(init?.body));
  seen.push({ host, body });
  const status = host === 'api.deepseek.com' ? deep : claude;
  if (status === 402) return err(402, 'Insufficient Balance');
  if (status === 400) return err(400, 'Your credit balance is too low to access the Anthropic API.');
  if (status !== 200) return err(status, 'synthetic');
  return new Response(JSON.stringify({ id: 'p', type: 'message', role: 'assistant', model: body.model, stop_reason: 'max_tokens', stop_sequence: null, usage: { input_tokens: 8, output_tokens: 1 }, content: [] }), { headers: { 'content-type': 'application/json' } });
};
const logs: string[] = [];
const keep = { log: console.log, warn: console.warn, error: console.error };
console.log = console.warn = console.error = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
const { config } = await import('../src/config');
const { preflight } = await import('../src/preflight');
const run = async (d: number, c: number) => { deep = d; claude = c; seen.length = 0; logs.length = 0; return preflight(); };
try {
  assert.equal(await run(200, 200), 0, 'both healthy');
  assert.deepEqual(seen.map(s => s.host), ['api.deepseek.com', 'api.anthropic.com'], 'DeepSeek gate first, then the fallback probe');
  assert.equal(seen[1].body.model, 'claude-haiku-5-5', 'the fallback probe uses Haiku 5.5');
  assert.deepEqual(seen[1].body.thinking, { type: 'disabled' }, 'one token is not spent on thinking');
  assert.equal(await run(402, 200), 3, 'DeepSeek balance exhausted is fatal');
  assert.deepEqual(seen.map(s => s.host), ['api.deepseek.com'], 'no fallback probe after a fatal gate');
  assert.equal(await run(401, 200), 3, 'DeepSeek key rejected is fatal');
  assert.equal(await run(200, 400), 0, 'a dead Anthropic key is not fatal in deepseek-all');
  assert.ok(logs.some(l => /::warning::The Anthropic key cannot spend, so the claude-haiku-5-5 fallback is unavailable/.test(l)));
  assert.equal(await run(500, 200), 0, 'a DeepSeek transient is a warning, not a credit failure');
  delete process.env.DEEPSEEK_API_KEY;
  assert.equal(await run(200, 200), 3, 'a missing DeepSeek key is fatal');
  process.env.DEEPSEEK_API_KEY = 'synthetic-deepseek';

  // Legacy deepseek mode: Claude still gates the window, a DeepSeek failure only warns.
  Object.assign(config, { replyProvider: 'deepseek', deepSeekTrial: true, triageModel: 'claude-haiku-4-5-20251001' });
  assert.equal(await run(200, 400), 3, 'legacy: Anthropic credit exhausted is fatal');
  assert.equal(await run(402, 200), 0, 'legacy: DeepSeek balance only warns');
  assert.deepEqual(seen.map(s => s.host), ['api.anthropic.com', 'api.deepseek.com']);
} finally {
  Object.assign(console, keep);
}
console.log('PASS preflight gate: deepseek-all gates on DeepSeek (401/402/403 and a missing key exit 3, transients pass), the Anthropic probe only reports the Haiku 5.5 fallback; legacy modes keep the Claude gate.');
