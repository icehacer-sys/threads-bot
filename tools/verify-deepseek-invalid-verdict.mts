// A malformed DeepSeek verdict gets one DeepSeek repair, then Claude; never an API-error skip. All HTTP is mocked.
// Repro: faecaloma eval 36907000952, "Uterine tumor?" -> "error: Invalid reply verdict: unexpected field".
// index.ts counts every error: skip as an API failure (poll exit 1, never cached, re-billed next poll).
import assert from 'node:assert/strict';
process.env.ANTHROPIC_API_KEY = 'synthetic-claude';
process.env.DEEPSEEK_API_KEY = 'synthetic-deepseek';
process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const provider = process.argv.includes('--all') ? 'deepseek-all' : process.argv.includes('--primary') ? 'deepseek' : 'hybrid';
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
  assert.deepEqual(calls.map(call => call.host), ['api.deepseek.com', 'api.deepseek.com', 'api.anthropic.com'], `${name}: one DeepSeek attempt, one DeepSeek repair, then one Claude call`);
  assert.match(JSON.stringify(calls[1].body.messages.at(-1).content.at(-1)), /REPAIR \(one attempt\)/, `${name}: the repair carries the validator error`);
  assert.equal(calls[2].body.model, provider === 'deepseek-all' ? 'claude-haiku-5-5' : config.triageModel, `${name}: Claude gets the original request model (the Haiku 5.5 fallback in deepseek-all)`);
  if (provider === 'deepseek-all') {
    assert.deepEqual(calls[2].body.thinking, { type: 'disabled' }, `${name}: Haiku 5.5 runs with thinking off`);
    assert.deepEqual(calls[2].body.tool_choice, { type: 'tool', name: 'submit_reply' }, `${name}: Haiku 5.5 keeps the forced submit_reply`);
  }
  assert.ok(!JSON.stringify(calls[2].body.system).includes('DEEPSEEK REPLY DISCIPLINE'), `${name}: Claude gets the original prompt, not the DeepSeek-grounded one`);
  assert.ok(!JSON.stringify(calls[2].body.messages).includes('REPAIR (one attempt)'), `${name}: Claude gets the original request without the repair note`);
  const expected = 2 * deepSeekTokenCost('deepseek-flash', usage)! + costOf(calls[2].body.model, usage);
  assert.ok(Math.abs(spend.usd - expected) < 1e-12, `${name}: two DeepSeek calls priced plus the Claude call`);
  assert.equal(spend.calls, 3, name);
  assert.equal(takeDeepSeekTrip(), false, `${name}: a known-cost malformed verdict does not trip the cap-day breaker`);
  assert.equal(replyTrialProviderSnapshot().halted, false, `${name}: DeepSeek stays on for the next comment`);
}

// The repair fixes it: DeepSeek answers on the second attempt and Claude is never called.
{
  const calls: string[] = [];
  let n = 0;
  handler = async (url, init) => {
    calls.push(new URL(String(url)).hostname);
    const body = JSON.parse(String(init?.body));
    return json(n++ === 0 ? tool(body.model, { ...valid, confidence: 'high' }) : tool(body.model, valid));
  };
  const repaired = await classifyAndDraft(base);
  assert.equal(repaired.reply_text, valid.reply_text);
  assert.deepEqual(calls, ['api.deepseek.com', 'api.deepseek.com'], 'a successful repair needs no Claude call');
}

// Everything unusable (DeepSeek, its repair and Claude): a bounded draft failure, never an API-error skip.
const calls: string[] = [];
handler = async (url, init) => {
  const host = new URL(String(url)).hostname;
  calls.push(host);
  return json(tool(JSON.parse(String(init?.body)).model, { ...valid, confidence: 'high' }));
};
drainSpend();
const both = await classifyAndDraft(base);
assert.match(both.reason, /^unusable verdict after DeepSeek repair and fallback: Invalid reply verdict: unexpected field/, 'surfaces as a draft failure');
assert.equal(both.draftFailure, 'verdict', 'index.ts re-checks it on two later polls, then caches it');
assert.deepEqual(calls, ['api.deepseek.com', 'api.deepseek.com', 'api.anthropic.com'], 'one repair and one Claude call; no retry loop');

// A good DeepSeek verdict is used as is, with no Claude call.
calls.length = 0;
handler = async (url, init) => {
  calls.push(new URL(String(url)).hostname);
  return json(tool(JSON.parse(String(init?.body)).model, valid));
};
const good = await classifyAndDraft(base);
assert.equal(good.reply_text, valid.reply_text);
assert.deepEqual(calls, ['api.deepseek.com']);
console.log(`PASS [${provider}] malformed DeepSeek verdict (unexpected field, missing field, truncation, no submit): one DeepSeek repair with the validator error, then Claude answers the same comment with the original request; DeepSeek left on; a successful repair needs no Claude call; all three unusable is a bounded draft failure; a good DeepSeek verdict needs no Claude call.`);
