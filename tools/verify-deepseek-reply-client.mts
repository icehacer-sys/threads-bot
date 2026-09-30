// One mocked overload verifies retries/observer composition; no external HTTP.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createProviderObservation } from '../src/provider-observation';
import { createDeepSeekReplyClient, deepSeekTokenCost } from '../src/deepseek-reply-client';
const observer = createProviderObservation();
let physical = 0;
const mock: typeof fetch = async (url, init) => {
  physical++;
  assert.equal(String(url), 'https://api.deepseek.com/anthropic/v1/messages');
  const headers = new Headers(init?.headers);
  assert.equal(headers.get('authorization'), null, 'no inherited Anthropic bearer credential');
  assert.equal(headers.get('x-api-key'), 'synthetic-only');
  return new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'synthetic' } }), { status: 503, headers: { 'content-type': 'application/json' } });
};
process.env.ANTHROPIC_AUTH_TOKEN = 'synthetic-unrelated-token';
process.env.ANTHROPIC_BASE_URL = 'https://unrelated.invalid';
const client = createDeepSeekReplyClient('synthetic-only', observer.wrapFetch(mock));
await assert.rejects(client.messages.create({ model: 'deepseek-flash', thinking: { type: 'disabled' }, max_tokens: 1024, messages: [{ role: 'user', content: 'Synthetic' }] }));
assert.equal(physical, 1, 'no SDK overload retry');
assert.equal(observer.snapshot().transport.starts, 1, 'exactly one observer wrapper');
const usage = { input_tokens: 5840, output_tokens: 217, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
assert.ok(Math.abs(deepSeekTokenCost('deepseek-flash', usage)! - 0.0020124) < 1e-12);
assert.equal(deepSeekTokenCost('deepseek-flash', { input_tokens: 1, output_tokens: 1 }), null);
assert.equal(deepSeekTokenCost('deepseek-flash', { ...usage, cache_read_input_tokens: null }), null);
assert.equal(deepSeekTokenCost('deepseek-flash', { ...usage, cache_creation_input_tokens: 1 }), null);
assert.equal(deepSeekTokenCost('deepseek-flash', { ...usage, server_tool_use: { web_search_requests: 1 } }), null);
assert.equal(deepSeekTokenCost('claude-sonnet-4-6', usage), null);
observer.usage(usage);
assert.equal(observer.snapshot().usage.serverWebSearchRequests.reportedTotal, null);
assert.equal(observer.snapshot().usage.serverWebSearchRequests.unknownRecords, 1);
{
  const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/deepseek-gif-smoke.json', import.meta.url), 'utf8'));
  const response = fixture.response;
  const cost = deepSeekTokenCost(response.model, response.usage);
  assert.ok(cost !== null);
  assert.equal(Math.ceil(cost * 1_000_000), fixture.peakTokenCostMicroUsd);
  const nativeObserver = createProviderObservation();
  nativeObserver.usage(response.usage);
  assert.equal(nativeObserver.snapshot().usage.inputTokens.reportedTotal, 3377);
  assert.equal(nativeObserver.snapshot().usage.outputTokens.reportedTotal, 387);
  assert.equal(nativeObserver.snapshot().usage.serverWebSearchRequests.reportedTotal, null);
  assert.equal(nativeObserver.snapshot().usage.serverWebSearchRequests.unknownRecords, 1);
}
console.log('PASS explicit DeepSeek client: fixed endpoint/key isolation, one physical mocked 503, retries off, one observer, native cache/token pricing and unknown usage preserved. No paid calls.');
