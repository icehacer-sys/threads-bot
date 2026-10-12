// Claude Sonnet 5.5 boundary (2026-10-12): no forced tool_choice, thinking counts toward max_tokens.
// Offline: fetch is mocked, no network, no state writes.
import assert from 'node:assert/strict';
process.env.ANTHROPIC_API_KEY = 'offline-fixture';
process.env.BOT_WEB_SEARCH = 'off';
process.env.BOT_USAGE_LOG = 'off';
const sent: any[] = [];
const replies: any[] = [];
globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
  sent.push(JSON.parse(String(init?.body)));
  const body = replies.shift();
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}) as typeof fetch;
const { config } = await import('../src/config');
Object.assign(config, { deepSeekTrial: false });
const { adaptClaudeRequest, createReplyMessage, NO_FORCED_TOOL_CHOICE } = await import('../src/reply-provider');

const base = {
  model: 'claude-sonnet-5-5', max_tokens: 1024, output_config: { effort: 'low' },
  system: [{ type: 'text', text: 'sys' }], messages: [{ role: 'user', content: 'Comment: GSW' }],
  tools: [{ name: 'submit_reply', description: 'x', input_schema: { type: 'object', properties: {} } }],
  tool_choice: { type: 'tool', name: 'submit_reply' },
} as any;

// Older models are untouched, so Haiku triage and DeepSeek-shared bodies keep the exact contract.
for (const model of ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-sonnet-5']) {
  const { request, forcedTool } = adaptClaudeRequest({ ...base, model });
  assert.equal(request.model, model); assert.equal(forcedTool, null);
  assert.deepEqual(request.tool_choice, base.tool_choice); assert.equal(request.max_tokens, 1024);
}
for (const model of ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1']) assert.ok(NO_FORCED_TOOL_CHOICE.test(model), model);
const adapted = adaptClaudeRequest(base);
assert.equal(adapted.forcedTool, 'submit_reply');
assert.deepEqual(adapted.request.tool_choice, { type: 'auto' });
assert.equal(adapted.request.max_tokens, 4096, 'thinking headroom');
assert.deepEqual(base.tool_choice, { type: 'tool', name: 'submit_reply' }, 'original request not mutated');
assert.equal(adaptClaudeRequest({ ...base, tool_choice: { type: 'auto' } }).forcedTool, null);

const usage = { input_tokens: 10, output_tokens: 5 };
const msg = (content: any[], stop = 'end_turn') => ({ id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content, stop_reason: stop, stop_sequence: null, usage });
const toolUse = { type: 'tool_use', id: 't1', name: 'submit_reply', input: { decision: 'skip' } };

// 1. The model calls the tool under auto: one request, no forced choice on the wire.
replies.push(msg([{ type: 'thinking', thinking: '', signature: 's' }, toolUse], 'tool_use'));
let res = await createReplyMessage(base);
assert.equal(sent.length, 1);
assert.deepEqual(sent[0].tool_choice, { type: 'auto' });
assert.equal(sent[0].max_tokens, 4096);
assert.ok(res.content.some((b: any) => b.type === 'tool_use'));

// 2. The model answers in text: one append-only continuation asks for the tool.
sent.length = 0;
replies.push(msg([{ type: 'text', text: 'Looks like bullet holes.' }]), msg([toolUse], 'tool_use'));
res = await createReplyMessage(base);
assert.equal(sent.length, 2);
assert.deepEqual(sent[1].messages.slice(0, 1), base.messages, 'history unchanged (preserved thinking)');
assert.equal(sent[1].messages[1].role, 'assistant');
assert.match(sent[1].messages[2].content, /submit_reply/);
assert.ok(res.content.some((b: any) => b.type === 'tool_use'));

// 3. A refusal or truncation is returned as is, never re-asked.
for (const stop of ['refusal', 'max_tokens']) {
  sent.length = 0;
  replies.push(msg([{ type: 'text', text: '' }], stop));
  res = await createReplyMessage(base);
  assert.equal(sent.length, 1, stop); assert.equal(res.stop_reason, stop);
}

// 4. Haiku triage still sends the forced contract unchanged.
sent.length = 0;
replies.push({ ...msg([toolUse], 'tool_use'), model: 'claude-haiku-4-5-20251001' });
await createReplyMessage({ ...base, model: 'claude-haiku-4-5-20251001' });
assert.deepEqual(sent[0].tool_choice, { type: 'tool', name: 'submit_reply' });
assert.equal(sent[0].max_tokens, 1024);
console.log('Sonnet 5.5 boundary checks passed');
