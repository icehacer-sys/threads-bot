// A malformed DeepSeek verdict is answered by Claude, never an API-error skip. All HTTP is mocked.
// Repro: faecaloma eval 36907000952, "Uterine tumor?" -> "error: Invalid reply verdict: unexpected field".
// index.ts counts every error: skip as an API failure (poll exit 1, never cached, re-billed next poll).
import assert from 'node:assert/strict';
process.env.ANTHROPIC_API_KEY = 'synthetic-claude';
process.env.DEEPSEEK_API_KEY = 'synthetic-deepseek';
process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const provider = process.argv.includes('--primary') ? 'deepseek' : 'hybrid';
process.env.BOT_REPLY_PROVIDER = provider;
delete process.env.ANTHROPIC_AUTH_TOKEN;
let handler: typeof fetch = async () => { throw Error('Unexpected HTTP'); };
globalThis.fetch = (...args) => handler(...args);
const { config } = await import('../src/config');
const { classifyAndDraft } = await import('../src/reply');
const { drainSpend, costOf } = await import('../src/spend');
const { replyTrialProviderSnapshot, takeDeepSeekTrip } = await import('../src/reply-provider');
const { deepSeekTokenCost } = await import('../src/deepseek-reply-client');
Object.assign(config, { webSearch: false, gifReplies: false, voiceVariant: 'lean' });
assert.equal(config.replyProvider, provider);
const usage = { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 30 };
const valid = { intent: 'friendly reaction', decision: 'reply', category: 'banter', reply_text: 'That was a rough one.', reason: 'synthetic friendly reaction', needs_lookup: false, promo_product: 'none', promo_explicit: false };
const claudeText = 'That one stings a little.';
const base = { postText: 'A synthetic teaching puzzle.', commentText: 'A friendly reaction.', answer: 'Synthetic answer', answerPublic: true, replyAll: false, modelOverride: config.triageModel, allowSearch: false, learnedNotesOverride: '' };
const tool = (model: string, input: unknown, stop = 'tool_use') => ({ id: 'synthetic', type: 'message', role: 'assistant', model, stop_reason: stop, usage, content: [{ type: 'tool_use', id: 'synthetic-submit', name: 'submit_reply', input }] });
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const broken: Record<string, (model: string) => unknown> = {
  'unexpected field': model => tool(model, { ...valid, confidence: 'high' }),
  'missing field': model => { const { reason: _reason, ...rest } = valid; return tool(model, rest); },
  'truncated': model => tool(model, valid, 'max_tokens'),
  'no submit_reply': model => ({ ...tool(model, valid), stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here is my reply.' }] }),
};
for (const [name, deepSeekResponse] of Object.entries(broken)) {
  const calls: Array<{ host: string; body: any }> = [];
  handler = async (url, init) => {
    const host = new URL(String(url)).hostname;
    const body = JSON.parse(String(init?.body));
    calls.push({ host, body });
    return json(host === 'api.deepseek.com' ? deepSeekResponse(body.model) : tool(body.model, { ...valid, reply_text: claudeText }));
  };
  drainSpend();
  const result = await classifyAndDraft(base);
  const spend = drainSpend();
  assert.doesNotMatch(result.reason, /^(?:error|fatal):/, `${name}: never an API-error skip`);
  assert.equal(result.decision, 'reply', name);
  assert.equal(result.reply_text, claudeText, `${name}: Claude answers the same comment`);
  assert.deepEqual(calls.map(call => call.host), ['api.deepseek.com', 'api.anthropic.com'], `${name}: one DeepSeek attempt then one Claude call`);
  assert.equal(calls[1].body.model, config.triageModel, `${name}: Claude gets the original request model`);
  assert.ok(!JSON.stringify(calls[1].body.system).includes('DEEPSEEK REPLY DISCIPLINE'), `${name}: Claude gets the original prompt, not the DeepSeek-grounded one`);
  const expected = deepSeekTokenCost('deepseek-flash', usage)! + costOf(config.triageModel, usage);
  assert.ok(Math.abs(spend.usd - expected) < 1e-12, `${name}: DeepSeek priced once plus the Claude call`);
  assert.equal(spend.calls, 2, name);
  assert.equal(takeDeepSeekTrip(), false, `${name}: a known-cost malformed verdict does not trip the cap-day breaker`);
  assert.equal(replyTrialProviderSnapshot().halted, false, `${name}: DeepSeek stays on for the next comment`);
}

// Claude's own malformed verdict keeps today's behavior: a single error skip, no loop.
const calls: string[] = [];
handler = async (url, init) => {
  const host = new URL(String(url)).hostname;
  calls.push(host);
  return json(tool(JSON.parse(String(init?.body)).model, { ...valid, confidence: 'high' }));
};
drainSpend();
const both = await classifyAndDraft(base);
assert.match(both.reason, /^error: Invalid reply verdict: unexpected field/, 'a Claude failure still surfaces');
assert.deepEqual(calls, ['api.deepseek.com', 'api.anthropic.com'], 'Claude is tried once; no retry loop');

// A good DeepSeek verdict is used as is, with no Claude call.
calls.length = 0;
handler = async (url, init) => {
  calls.push(new URL(String(url)).hostname);
  return json(tool(JSON.parse(String(init?.body)).model, valid));
};
const good = await classifyAndDraft(base);
assert.equal(good.reply_text, valid.reply_text);
assert.deepEqual(calls, ['api.deepseek.com']);
console.log(`PASS [${provider}] malformed DeepSeek verdict (unexpected field, missing field, truncation, no submit): Claude answers the same comment with the original request, DeepSeek priced once and left on; a Claude failure still surfaces; a good DeepSeek verdict needs no Claude call.`);
