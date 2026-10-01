// No network, no provider key, no paid inference, no state writes.
import assert from 'node:assert/strict';
import { planReplyProvider, projectDeepSeekUsage, type ReplyRequest } from '../src/reply-provider-plan';
import { DEEPSEEK_REPLY_GUIDANCE, groundDeepSeekRequest } from '../src/deepseek-media-policy';

const policy = { mode: 'deepseek-text-trial' as const, triageModel: 'claude-haiku-4-5-20251001', qualityModel: 'claude-sonnet-4-6' };
const request: ReplyRequest = {
  model: policy.triageModel, max_tokens: 1024,
  system: [{ type: 'text', text: 'Synthetic system context.', cache_control: { type: 'ephemeral', ttl: '1h' } }],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'A synthetic English comment and its history.' }] }],
  tools: [{ name: 'submit_reply', input_schema: { type: 'object', properties: { reply_text: { type: 'string' } } } }],
  tool_choice: { type: 'tool', name: 'submit_reply' },
};
let checks = 0;
const check = (run: () => void) => { run(); checks++; };
const unchanged = (input: ReplyRequest, reason: string) => {
  const copy = JSON.stringify(input);
  const plan = planReplyProvider(input, policy);
  check(() => assert.equal(plan.provider, 'anthropic'));
  check(() => assert.equal(plan.reason, reason));
  check(() => assert.equal(plan.request, input));
  check(() => assert.equal(JSON.stringify(input), copy));
};
const original = JSON.stringify(request);
const mapped = planReplyProvider(request, policy);
check(() => assert.equal(mapped.provider, 'deepseek'));
check(() => assert.equal(mapped.logicalModel, policy.triageModel));
check(() => assert.equal(mapped.requestedModel, 'deepseek-flash'));
check(() => assert.equal(mapped.baseURL, 'https://api.deepseek.com/anthropic'));
check(() => assert.deepEqual(mapped.request.thinking, { type: 'disabled' }));
for (const key of ['messages', 'tools', 'tool_choice'] as const) check(() => assert.equal(mapped.request[key], request[key]));
// Original system blocks are kept in order; only the DeepSeek discipline block is appended.
check(() => assert.deepEqual(mapped.request.system, [...(request.system as unknown[]), { type: 'text', text: DEEPSEEK_REPLY_GUIDANCE }]));
check(() => assert.equal(mapped.request.max_tokens, 1024));
check(() => assert.equal(JSON.stringify(request), original));
check(() => assert.equal(planReplyProvider(request, { ...policy, mode: 'anthropic' }).request, request));
check(() => assert.equal(planReplyProvider(request, { ...policy, qualityModel: policy.triageModel }).provider, 'anthropic'));
check(() => assert.throws(() => planReplyProvider(request, { ...policy, mode: 'deepseek' as never })));
unchanged({ ...request, model: policy.qualityModel }, 'quality');
unchanged({ ...request, tool_choice: { type: 'auto' } }, 'tool-contract');
unchanged({ ...request, tools: undefined }, 'tool-contract');
unchanged({ ...request, tools: [{ name: 'other', input_schema: { type: 'object' } }] }, 'tool-contract');
const search = { type: 'web_search_20250305', name: 'web_search', max_uses: 3 };
unchanged({ ...request, tools: [search, ...request.tools!] } as ReplyRequest, 'tool-contract');
for (const type of ['image', 'document', 'search_result', 'server_tool_use', 'web_search_tool_result', 'tool_result']) {
  unchanged({ ...request, messages: [{ role: 'user', content: [{ type, source: { type: 'base64', media_type: 'image/png', data: 'synthetic' } }] }] } as unknown as ReplyRequest, 'media-or-unsupported-block');
}
// Exact chronological frame payload is retained, including later-frame text evidence.
const frames = ['SURE', 'WAIT', 'NOPE', 'FINAL'].map(data => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }));
unchanged({ ...request, messages: [{ role: 'user', content: [{ type: 'text', text: 'FRAMES IN ORDER' }, ...frames] }] } as ReplyRequest, 'media-or-unsupported-block');
// A search continuation retains the original assistant tool/result history verbatim.
unchanged({ ...request, messages: [...request.messages, { role: 'assistant', content: [{ type: 'server_tool_use', name: 'web_search', id: 'synthetic', input: { query: 'synthetic' } }] }] } as unknown as ReplyRequest, 'media-or-unsupported-block');
check(() => assert.deepEqual(projectDeepSeekUsage({ input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 }), {
  provider: 'deepseek', scope: 'top-level-message-response', inputTokens: 10, outputTokens: 2, cacheReadTokens: 5, cacheCreationTokens: 0, serverWebSearchRequests: null,
}));
for (const value of [undefined, null, {}, { input_tokens: -1, output_tokens: 0.5, cache_read_input_tokens: '10', cache_creation_input_tokens: NaN }]) {
  check(() => assert.deepEqual(Object.values(projectDeepSeekUsage(value)).slice(2), [null, null, null, null, null]));
}
check(() => assert.equal(projectDeepSeekUsage({ server_tool_use: { web_search_requests: 0 } }).serverWebSearchRequests, 0));

// Capture requests built by the actual classifier with synthetic inputs. Every
// transport is mocked with a terminal 400; no real model or visual interpretation.
process.env.ANTHROPIC_API_KEY = 'synthetic-offline-key';
process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
let captured: ReplyRequest | undefined;
globalThis.fetch = async (_url, init) => {
  assert.equal(captured, undefined, 'one physical mocked attempt per capture');
  captured = JSON.parse(String(init?.body));
  return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Synthetic capture only' } }), {
    status: 400, headers: { 'content-type': 'application/json' },
  });
};
const { config } = await import('../src/config');
const { classifyAndDraft } = await import('../src/reply');
Object.assign(config, { webSearch: true, triageModel: policy.triageModel, model: policy.qualityModel });
const base = { postText: 'Tell me an anatomy-class memory that stayed with you.', commentText: 'Extra teeth used to fascinate me in anatomy class.', answerPublic: true, replyAll: false, modelOverride: policy.triageModel };
for (const scenario of ['text', 'style-repair', 'gif', 'search'] as const) {
  captured = undefined;
  const input = { ...base,
    ...(scenario === 'style-repair' ? { styleRecheck: true } : {}),
    ...(scenario === 'search' ? { modelOverride: policy.qualityModel, allowSearch: true } : {}),
    ...(scenario === 'gif' ? { modelOverride: policy.qualityModel, commentText: '', commentMediaKind: 'video-frame' as const,
      commentImages: frames.map(frame => ({ media_type: 'image/jpeg' as const, data: frame.source.data })) } : {}),
  };
  await classifyAndDraft(input);
  check(() => assert.ok(captured, `${scenario}: actual workflow built a request`));
  const wire = captured!;
  const snapshot = JSON.stringify(wire);
  const plan = planReplyProvider(wire, policy);
  if (scenario === 'text' || scenario === 'style-repair') {
    check(() => assert.equal(plan.provider, 'deepseek'));
    check(() => assert.deepEqual(plan.request, groundDeepSeekRequest({ ...wire, model: 'deepseek-flash', thinking: { type: 'disabled' } })));
  } else {
    check(() => assert.equal(plan.provider, 'anthropic'));
    check(() => assert.equal(plan.request, wire));
  }
  check(() => assert.equal(JSON.stringify(wire), snapshot));
}
console.log(`PASS ${checks} offline provider-plan assertions. Routing draft only; no native search/media/provider execution tested.`);
