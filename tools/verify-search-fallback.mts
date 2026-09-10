import assert from 'node:assert/strict';
process.env.ANTHROPIC_API_KEY = 'offline-fixture';
process.env.BOT_WEB_SEARCH = 'on';
process.env.BOT_GIF_REPLIES = 'off';
const searchBlocks = [
  { type: 'server_tool_use', id: 'search-fixture', name: 'web_search', input: { query: 'fictional reference' } },
  { type: 'web_search_tool_result', tool_use_id: 'search-fixture', content: [{ type: 'web_search_result', title: 'Fixture source', url: 'https://example.com/reference', encrypted_content: 'fixture-evidence' }] },
];
const requests: any[] = [];
globalThis.fetch = async (_url, options) => {
  const request = JSON.parse(String(options?.body)); requests.push(request);
  assert.ok(requests.length <= 2, 'Unexpected retry');
  const content = requests.length === 1 ? searchBlocks : [{ type: 'tool_use', id: 'submit-fixture', name: 'submit_reply', input: {
    intent: 'Reference question', decision: 'reply', category: 'reference', reply_text: 'That is the scene you meant.', reason: 'Supported by the provided search evidence', needs_lookup: false, promo_product: 'none', promo_explicit: false,
  } }];
  return new Response(JSON.stringify({ id: 'message-fixture', type: 'message', role: 'assistant', model: request.model, content, stop_reason: requests.length === 1 ? 'end_turn' : 'tool_use', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const { classifyAndDraft } = await import('../src/reply');
const result = await classifyAndDraft({ postText: 'A playful reference thread', commentText: 'Which film does this line come from?', answerPublic: true, modelOverride: 'claude-sonnet-4-6', allowSearch: true });
assert.equal(result.decision, 'reply', result.reason); assert.equal(requests.length, 2);
assert.deepEqual(requests[1].messages[1], { role: 'assistant', content: searchBlocks });
assert.deepEqual(requests[1].messages[0], requests[0].messages[0]);
assert.equal(requests[1].tool_choice.name, 'submit_reply');
console.log('PASS forced reply fallback preserves original input, server search invocation and returned evidence; no network calls');
