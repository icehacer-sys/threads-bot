// BOT_REPLY_PROVIDER=deepseek: DeepSeek answers everything except web-search lookups. Mocked HTTP only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.ANTHROPIC_API_KEY = 'synthetic-claude'; process.env.DEEPSEEK_API_KEY = 'synthetic-deepseek';
process.env.BOT_REPLY_PROVIDER = 'deepseek';
delete process.env.ANTHROPIC_AUTH_TOKEN;
const valid = { intent: 'question', decision: 'reply', category: 'teach', reply_text: 'Impacted stool fills the colon here.', reason: 'synthetic', needs_lookup: false, promo_product: 'none', promo_explicit: false };
let mediaResponse: any = null;
const seen: Array<{ host: string; tools: string[]; choice: string; model: string }> = [];
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(String(init?.body));
  seen.push({ host: new URL(String(url)).hostname, tools: (body.tools ?? []).map((t: any) => t.name), choice: body.tool_choice?.type, model: body.model });
  if (mediaResponse) return new Response(JSON.stringify({ ...mediaResponse, model: body.model }), { headers: { 'content-type': 'application/json' } });
  return new Response(JSON.stringify({ id: 's', type: 'message', role: 'assistant', model: body.model, stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    content: [{ type: 'tool_use', id: 't', name: 'submit_reply', input: valid }] }), { headers: { 'content-type': 'application/json' } });
};
const { config } = await import('../src/config');
assert.equal(config.replyProvider, 'deepseek');
assert.equal(config.deepSeekTrial, true);
Object.assign(config, { gifReplies: false, voiceVariant: 'lean', webSearch: true });
const { classifyAndDraft } = await import('../src/reply');
const base = { postText: 'A synthetic teaching puzzle.', commentText: 'How does this happen?', answer: 'Synthetic answer', answerPublic: true, replyAll: true, learnedNotesOverride: '' };
const run = async (input: object) => { seen.length = 0; const d = await classifyAndDraft({ ...base, ...input } as never); return { d, calls: [...seen] }; };

const triage = await run({ modelOverride: config.triageModel, allowSearch: false });
assert.deepEqual(triage.calls.map(c => c.host), ['api.deepseek.com'], 'triage on DeepSeek');
const escalation = await run({ modelOverride: config.model, allowSearch: false });
assert.deepEqual(escalation.calls.map(c => c.host), ['api.deepseek.com'], 'correct/teach escalation on DeepSeek');
assert.deepEqual(escalation.calls[0].tools, ['submit_reply'], 'no search tool on a non-lookup escalation');
assert.equal(escalation.calls[0].choice, 'tool');
const lookup = await run({ modelOverride: config.model, allowSearch: true });
assert.deepEqual(lookup.calls.map(c => c.host), ['api.anthropic.com'], 'web-search lookup on Claude');
assert.ok(lookup.calls[0].tools.includes('web_search'));
const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/deepseek-gif-smoke.json', import.meta.url), 'utf8'));
mediaResponse = fx.response;
const media = await run({ ...fx.input, answerPublic: true });
assert.deepEqual(media.calls.map(c => c.host), ['api.deepseek.com'], 'commenter GIF on DeepSeek');
assert.doesNotMatch(media.d.reason, /^(?:error|fatal):|media-grounding/, 'production media is never held');
assert.equal(media.d.decision, 'reply');
mediaResponse = null;
const pre = await run({ modelOverride: config.triageModel, allowSearch: false, answerPublic: false });
assert.equal(pre.calls.length, 1, 'pre-reveal hold costs exactly one DeepSeek call, no repair');
assert.match(pre.d.reason, /^spoiler guard: DeepSeek pre-reveal reply held/);
console.log('PASS BOT_REPLY_PROVIDER=deepseek: triage, escalations and commenter media on DeepSeek; only web-search lookups on Claude; media never held.');
