// The political-jab backstop applies to DeepSeek drafts only; Claude behavior is unchanged. Mocked HTTP.
import assert from 'node:assert/strict';
process.env.ANTHROPIC_API_KEY = 'synthetic-claude'; process.env.DEEPSEEK_API_KEY = 'synthetic-deepseek';
delete process.env.ANTHROPIC_AUTH_TOKEN;
let replyText = 'Wrong branch of medicine.';
const reply = { intent: 'joke', decision: 'reply', category: 'banter', reply_text: 'Wrong branch of medicine.', reason: 'synthetic', needs_lookup: false, promo_product: 'none', promo_explicit: false };
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body));
  return new Response(JSON.stringify({ id: 's', type: 'message', role: 'assistant', model: body.model, stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    content: [{ type: 'tool_use', id: 't', name: 'submit_reply', input: { ...reply, reply_text: replyText } }] }), { headers: { 'content-type': 'application/json' } });
};
const { config } = await import('../src/config');
Object.assign(config, { gifReplies: false, voiceVariant: 'lean', webSearch: false });
const { classifyAndDraft } = await import('../src/reply');
const input = { postText: 'A synthetic teaching puzzle.', commentText: "I know! I know! It's a Republican", answerPublic: true, replyAll: true, modelOverride: config.triageModel, allowSearch: false, learnedNotesOverride: '' };
config.deepSeekTrial = false;
const claude = await classifyAndDraft(input);
assert.equal(claude.decision, 'reply', 'Claude path unchanged');
config.deepSeekTrial = true;
const deep = await classifyAndDraft(input);
assert.equal(deep.decision, 'skip');
assert.match(deep.reason, /^political jab: DeepSeek reply skipped/);
assert.doesNotMatch(deep.reason, /^(?:error|fatal):/, 'not an API-error skip');
const benign = await classifyAndDraft({ ...input, commentText: 'Fatberg?' });
assert.equal(benign.decision, 'reply', 'non-political DeepSeek banter still replies');
replyText = 'Itu tahi yang tersekat dan membesar sampai usus besar diregangkan.';
const malay = await classifyAndDraft({ ...input, commentText: 'apa tu' });
assert.match(malay.reason, /^non-English reply: DeepSeek reply skipped/);
replyText = 'Liked and followed. Any page numbers?';
const action = await classifyAndDraft({ ...input, commentText: 'You have to like and follow me first' });
assert.match(action.reason, /^claims an off-platform action: DeepSeek reply skipped/);
config.deepSeekTrial = false;
assert.equal((await classifyAndDraft({ ...input, commentText: 'apa tu' })).reason.includes('non-English reply: DeepSeek'), false, 'Claude path unchanged');
console.log('PASS non-English and false-action backstops on DeepSeek drafts only.');
console.log('PASS political-jab backstop: DeepSeek political banter skipped, Claude unchanged, non-political DeepSeek banter kept.');
