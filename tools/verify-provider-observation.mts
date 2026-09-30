// Transport references and sanitized aggregate contract, entirely synthetic.
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { createProviderObservation } from '../src/provider-observation';
import { createCoverageObservation } from '../src/coverage-observation';

const rejected: unknown[] = [];
const rejectListener = (value: unknown) => rejected.push(value);
process.on('unhandledRejection', rejectListener);
let checks = 0;
const check = async (work: () => unknown) => { await work(); checks++; };
try {
  await check(async () => {
    const url = new URL('https://synthetic.invalid/v1/messages?token=PRIVATE_MARKER');
    const signal = new AbortController().signal;
    const init = { body: 'PRIVATE_MARKER prompt/comment/draft/media', method: 'POST', signal, headers: new Headers({ authorization: 'PRIVATE_MARKER', 'x-api-key': 'PRIVATE_MARKER', 'x-stainless-retry-count': '2' }) };
    const response = new Response('PRIVATE_MARKER'); response.clone = () => { throw Error('No clone'); };
    const owner = { marker: 'PRIVATE_MARKER' };
    const probe = createProviderObservation();
    const base: typeof fetch = function (this: unknown, input, options) {
      assert.equal(this, owner); assert.equal(input, url); assert.equal(options, init);
      assert.equal(options?.signal, signal); return Promise.resolve(response);
    };
    assert.equal(await probe.wrapFetch(base).call(owner, url, init), response);
    assert.equal(response.bodyUsed, false);
    assert.equal(probe.snapshot().transport.sdkRetryOrdinals!['2'], 1);
    assert.equal(JSON.stringify(probe.snapshot()).includes('PRIVATE_MARKER'), false);
  });
  await check(async () => {
    for (const error of [new TypeError('PRIVATE_MARKER'), 'PRIVATE_MARKER', undefined]) {
      const probe = createProviderObservation(() => { throw Error('PRIVATE_MARKER'); });
      let seen: unknown = 'unseen';
      try { await probe.wrapFetch(async () => { throw error; })('synthetic'); } catch (value) { seen = value; }
      assert.equal(seen, error); assert.equal(probe.snapshot().transport.throws, 1);
    }
  });
  await check(async () => {
    for (const observer of [() => Promise.reject(Error('PRIVATE_MARKER')), () => Object.defineProperty({}, 'then', { get() { throw Error('PRIVATE_MARKER'); } }), () => ({ then(_resolve: unknown, reject: (error: Error) => void) { reject(Error('PRIVATE_MARKER')); } })]) {
      const probe = createProviderObservation(observer); const response = new Response('safe');
      assert.equal(await probe.wrapFetch(async () => response)('synthetic'), response);
      probe.usage(null); await new Promise(resolve => setImmediate(resolve));
      assert.ok(probe.snapshot().measurement.failedObservations > 0);
    }
    assert.equal(rejected.length, 0);
  });
  await check(async () => {
    const probe = createProviderObservation(() => new Promise(() => {})); const response = new Response('safe');
    assert.equal(await probe.wrapFetch(async () => response)('synthetic'), response);
  });
  await check(async () => {
    class HostileHeaders extends Headers { get() { throw Error('PRIVATE_MARKER'); } }
    const probe = createProviderObservation(); const response = new Response('safe'); let dispatches = 0;
    assert.equal(await probe.wrapFetch(async () => { dispatches++; return response; })('synthetic', { headers: new HostileHeaders() }), response);
    assert.equal(dispatches, 1); assert.ok(probe.snapshot().measurement.failedObservations > 0);
    probe.usage(new Proxy({}, { get() { throw Error('PRIVATE_MARKER'); } }));
    for (const [key, value] of Object.entries(probe.snapshot().usage)) if (key !== 'records') {
      assert.deepEqual(value, { reportedTotal: null, knownRecords: 0, unknownRecords: 1 });
    }
  });
  await check(async () => {
    const probe = createProviderObservation(), response = new Response('safe');
    Object.defineProperty(response, 'status', { get() { throw Error('PRIVATE_MARKER'); } });
    assert.equal(await probe.wrapFetch(async () => response)('synthetic'), response);
    assert.equal(probe.snapshot().transport.throws, 0);
    assert.equal(probe.snapshot().measurement.failedObservations, 1);
  });
  await check(async () => {
    const probe = createProviderObservation(undefined, 1); let dispatches = 0;
    const wrapped = probe.wrapFetch(async () => { dispatches++; return new Response('safe'); });
    for (let n = 0; n < 5; n++) { await wrapped('synthetic'); probe.usage({ input_tokens: 100 }); }
    assert.equal(dispatches, 5); assert.equal(probe.snapshot().transport.starts, 1);
    assert.equal(probe.snapshot().measurement.saturated, true);
    assert.equal(probe.snapshot().usage.inputTokens.reportedTotal, 1);
  });
  await check(async () => {
    let first!: (response: Response) => void, second!: (response: Response) => void;
    const probe = createProviderObservation();
    const wrapped = probe.wrapFetch(url => new Promise(resolve => { if (url === 'first') first = resolve; else second = resolve; }));
    const a = wrapped('first'), b = wrapped('second');
    const responseA = new Response('A', { status: 201 }), responseB = new Response('B', { status: 202 });
    second(responseB); assert.equal(await b, responseB); first(responseA); assert.equal(await a, responseA);
    assert.equal(probe.snapshot().transport.starts, 2); assert.equal(probe.snapshot().transport.responses, 2);
    assert.equal(probe.snapshot().transport.statuses!.other, 2);
  });
  await check(async () => {
    const controller = new AbortController(); controller.abort();
    const probe = createProviderObservation(); let dispatches = 0;
    const client = new Anthropic({ apiKey: 'offline-fixture', fetch: probe.wrapFetch(async () => { dispatches++; throw Error('Unexpected'); }) });
    assert.equal(client.maxRetries, 2);
    await assert.rejects(client.messages.create({ model: 'claude-haiku-4-5', max_tokens: 1, messages: [{ role: 'user', content: 'synthetic' }] }, { signal: controller.signal }), error => error instanceof Anthropic.APIUserAbortError);
    assert.equal(dispatches, 0); assert.equal(probe.snapshot().transport.starts, 0);
  });
  await check(() => {
    const probe = createProviderObservation();
    assert.equal(probe.snapshot().transport.starts, null, 'uninstalled observation is unavailable');
    assert.throws(() => probe.wrapFetch(undefined as unknown as typeof fetch));
    probe.installationFailed(); assert.equal(probe.snapshot().measurement.installationFailures, 1);
    probe.usage({ input_tokens: -1, output_tokens: Infinity, cache_read_input_tokens: 'PRIVATE_MARKER', server_tool_use: { web_search_requests: 0 } });
    probe.usage(null);
    assert.deepEqual(probe.snapshot().usage.inputTokens, { reportedTotal: null, knownRecords: 0, unknownRecords: 2 });
    assert.deepEqual(probe.snapshot().usage.serverWebSearchRequests, { reportedTotal: 0, knownRecords: 1, unknownRecords: 1 });
    assert.equal(JSON.stringify(probe.snapshot()).includes('PRIVATE_MARKER'), false);
  });
  await check(() => {
    const probe = createProviderObservation();
    const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40, cache_creation: { ephemeral_1h_input_tokens: 20, ephemeral_5m_input_tokens: 20 }, server_tool_use: { web_search_requests: 3 }, prompt: 'PRIVATE_MARKER', error: 'PRIVATE_MARKER' };
    const original = JSON.stringify(usage); probe.usage(usage);
    assert.equal(JSON.stringify(usage), original);
    const snapshot = probe.snapshot(); snapshot.usage.inputTokens.reportedTotal = -1;
    assert.equal(probe.snapshot().usage.inputTokens.reportedTotal, 10);
    assert.equal(probe.snapshot().usage.serverWebSearchRequests.reportedTotal, 3);
    assert.deepEqual(Object.keys(snapshot), ['scope', 'persistence', 'transport', 'usage', 'measurement']);
    assert.deepEqual(Object.keys(snapshot.usage), ['records', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'cacheCreation1hTokens', 'cacheCreation5mTokens', 'serverWebSearchRequests']);
    assert.equal(JSON.stringify(probe.snapshot()).includes('PRIVATE_MARKER'), false);
  });
  await check(() => {
    const log = console.log; const lines: string[] = [];
    try { console.log = line => lines.push(String(line)); createCoverageObservation(undefined, 'fixture').printSummary(); }
    finally { console.log = log; }
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).coverageObservation.replyProvider.scope, 'reply_client_process');
    assert.equal(JSON.parse(lines[0]).coverageObservation.replyProvider.persistence, 'none');
  });
  assert.equal(rejected.length, 0);
  console.log(`PASS provider observation: ${checks} synthetic checks; exact references/errors/signals, untouched bodies, fixed aggregate fields, UNKNOWN usage, bounded counts and fail-open observers`);
} finally { process.off('unhandledRejection', rejectListener); }
