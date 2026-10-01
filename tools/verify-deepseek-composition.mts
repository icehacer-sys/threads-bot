// Actual classifier + SDK + selected-provider accounting. All HTTP is mocked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.ANTHROPIC_API_KEY = 'synthetic-claude';
process.env.DEEPSEEK_API_KEY = 'synthetic-deepseek';
process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
delete process.env.ANTHROPIC_AUTH_TOKEN;
let handler: typeof fetch = async () => { throw Error('Unexpected HTTP'); };
globalThis.fetch = (...args) => handler(...args);
const { config } = await import('../src/config');
const { classifyAndDraft } = await import('../src/reply');
const { drainSpend, costOf } = await import('../src/spend');
const { replyTrialProviderSnapshot } = await import('../src/reply-provider');
const { deepSeekTokenCost } = await import('../src/deepseek-reply-client');
const { groundDeepSeekMediaRequest, DEEPSEEK_MEDIA_HOLD } = await import('../src/deepseek-media-policy');
Object.assign(config, { deepSeekTrial: false, gifReplies: false, voiceVariant: 'lean' });
const nativeUsage = { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 30 };
const valid = { intent: 'friendly reaction', decision: 'reply', category: 'banter', reply_text: 'That was a rough one.', reason: 'synthetic friendly reaction', needs_lookup: false, promo_product: 'none', promo_explicit: false };
const base = { postText: 'A synthetic teaching puzzle.', commentText: 'A friendly reaction.', answer: 'Synthetic answer', answerPublic: true, replyAll: false, modelOverride: config.triageModel, allowSearch: false, learnedNotesOverride: '' };
const tool = (model: string, decision: unknown = valid, usage: unknown = nativeUsage) => ({ id: 'synthetic', type: 'message', role: 'assistant', model, stop_reason: 'tool_use', usage, content: [{ type: 'tool_use', id: 'synthetic-submit', name: 'submit_reply', input: decision }] });
if (process.argv.includes('--unknown-usage') || process.argv.includes('--unknown-transport') || process.argv.includes('--null-response')) {
  config.deepSeekTrial = true;
  let attempts = 0;
  handler = async () => { attempts++; if (process.argv.includes('--unknown-transport')) throw new TypeError('Synthetic transport failure'); return new Response(JSON.stringify(process.argv.includes('--null-response') ? null : tool('deepseek-flash', valid, { input_tokens: 10, output_tokens: 20 })), { status: 200, headers: { 'content-type': 'application/json' } }); };
  const first = await classifyAndDraft(base);
  assert.match(first.reason, /^fatal:/);
  assert.deepEqual(drainSpend(), { usd: 0.35, calls: 1 });
  config.webSearch = true;
  const second = await classifyAndDraft({ ...base, modelOverride: config.model, allowSearch: true });
  assert.match(second.reason, /^fatal:/);
  assert.equal(attempts, 1, 'uncertain native attempt halts DeepSeek and Claude fallback without retry');
  assert.deepEqual(drainSpend(), { usd: 0, calls: 0 });
  assert.equal(replyTrialProviderSnapshot().halted, true);
  console.log('PASS uncertain trial: one physical attempt, conservative $0.35 charge, fatal halt of both providers, no extra requests.');
} else {
  const mediaFixture = JSON.parse(fs.readFileSync(new URL('./fixtures/deepseek-gif-smoke.json', import.meta.url), 'utf8'));
  const mediaInput = mediaFixture.input;
  const mediaResponse = mediaFixture.response;
  const expected = new Map<string, any>();
  let deepPhysical = 0, claudeFallbackPhysical = 0;
  const claudeOwned = new Set(['media', 'unclear-media', 'search-error-continuation']);
  for (const enabled of [false, true]) {
    config.deepSeekTrial = enabled;
    for (const scenario of ['text', 'repair', 'quality', 'media', 'unclear-media', 'search-error-continuation', 'truncation', 'bad-schema', 'operator']) {
      config.webSearch = scenario === 'search-error-continuation' || scenario === 'media' || scenario === 'unclear-media';
      let input: any = { ...base };
      if (scenario === 'quality' || scenario === 'search-error-continuation') input.modelOverride = config.model;
      if (scenario === 'search-error-continuation') input.allowSearch = true;
      if (scenario === 'media' || scenario === 'unclear-media') input = mediaInput;
      if (scenario === 'operator') input.commentText = 'Are you a bot?';
      const requests: any[] = [];
      const responses: any[] = [];
      handler = async (url, init) => {
        const body = JSON.parse(String(init?.body));
        const deep = new URL(String(url)).hostname === 'api.deepseek.com';
        if (enabled) { if (deep) deepPhysical++; else claudeFallbackPhysical++; }
        assert.equal(new Headers(init?.headers).get('x-api-key'), deep ? 'synthetic-deepseek' : 'synthetic-claude');
        const index = requests.length;
        requests.push({ url: String(url), body });
        let response: any = tool(body.model);
        if (scenario === 'repair' && index === 0) response = tool(body.model, { ...valid, reply_text: 'Coins went in; nothing came out.' });
        if (scenario === 'media') response = { ...mediaResponse, model: body.model };
        if (scenario === 'unclear-media') response = tool(body.model, { ...mediaResponse.content[0].input, media_clear: false, decision: 'skip', category: 'other', reply_text: '', reason: 'Essential media evidence unavailable.' });
        if (scenario === 'truncation') response.stop_reason = 'max_tokens';
        if (scenario === 'bad-schema') response.content[0].input = { ...valid, decision: 'invalid' };
        if (scenario === 'search-error-continuation' && index === 0) {
          response = { ...response, stop_reason: 'end_turn', usage: { ...nativeUsage, server_tool_use: { web_search_requests: 3 } }, content: [
            { type: 'server_tool_use', name: 'web_search', id: 'server-synthetic', input: { query: 'synthetic' } },
            { type: 'web_search_tool_result', tool_use_id: 'server-synthetic', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
          ] };
        }
        responses.push(response);
        return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
      };
      drainSpend();
      const result = await classifyAndDraft(input);
      const spend = drainSpend();
      assert.equal(requests.length, scenario === 'operator' ? 0 : scenario === 'repair' || scenario === 'search-error-continuation' ? 2 : 1, scenario);
      if (!enabled) expected.set(scenario, { requests, result });
      else {
        const baseline = expected.get(scenario);
        assert.deepEqual(result, baseline.result, `${scenario}: identical final guard behavior`);
        // index.ts counts error:/fatal: skips as API failures (non-zero poll exit, poll abandonment).
        if (claudeOwned.has(scenario)) assert.doesNotMatch(result.reason, /^(?:error|fatal):/, `${scenario}: commenter media is not an API-error skip`);
        assert.notEqual(result.reason, `error: ${DEEPSEEK_MEDIA_HOLD}`);
        for (const [index, request] of requests.entries()) {
          const original = baseline.requests[index].body;
          if (scenario === 'media' || scenario === 'unclear-media') {
            assert.deepEqual(request, baseline.requests[index], `${scenario}: exact commenter-media payload stays Claude-owned`);
          } else if (scenario === 'search-error-continuation') {
            assert.deepEqual(request, baseline.requests[index], 'exact native search payload and forced continuation stay Claude-owned');
            assert.equal(original.tools[0].type, 'web_search_20250305');
            assert.equal(original.tools[0].max_uses, 3);
            if (index === 1) assert.deepEqual(original.messages[1].content, responses[0].content, 'HTTP-200 search error blocks retained in continuation');
          } else {
            const { output_config: _effort, ...rest } = original;
            assert.deepEqual(request.body, groundDeepSeekMediaRequest({ ...rest, model: 'deepseek-flash', thinking: { type: 'disabled' } }), `${scenario}: original prompt/tool/context/frame parity plus explicit DeepSeek media guidance`);
            assert.equal(request.url, 'https://api.deepseek.com/anthropic/v1/messages');
          }
        }
        const expectedUsd = responses.reduce((sum, response, index) => sum + (claudeOwned.has(scenario) ? costOf(requests[index].body.model, response.usage) : deepSeekTokenCost(response.model, response.usage)!), 0);
        assert.ok(Math.abs(spend.usd - expectedUsd) < 1e-12, `${scenario}: selected native pricing`);
        assert.equal(spend.calls, requests.length);
      }
      if (scenario === 'media') assert.equal(result.reply_text, 'Take one more look whenever you like.');
      if (scenario === 'truncation' || scenario === 'bad-schema' || scenario === 'operator' || scenario === 'unclear-media') assert.equal(result.decision, 'skip');
    }
  }
  const snapshot = replyTrialProviderSnapshot();
  assert.equal(snapshot.providers.deepseek.observation.transport.starts, deepPhysical);
  assert.equal(snapshot.providers.deepseek.observation.usage.records, deepPhysical);
  assert.equal(claudeFallbackPhysical, 4, 'search continuation (2) plus commenter media and unclear media (1 each)');
  assert.equal(snapshot.providers.deepseek.observation.usage.serverWebSearchRequests.reportedTotal, null);
  assert.equal(snapshot.providers.deepseek.observation.usage.serverWebSearchRequests.unknownRecords, deepPhysical);
  console.log(`PASS default-off/ON actual composition: 9 scenarios each, exact prompts/repairs, Claude-owned commenter media and search continuation, ${deepPhysical} DeepSeek physical mocks, ${claudeFallbackPhysical} explicit Claude fallback mocks, native pricing and scoped observers. No paid calls.`);
}
