// Actual SDK/classifier parity against the source with only observation seams removed.
// Every request is synthetic; run with tools/offline-guard.mjs. No live CLI or state.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = mkdtempSync(join(tmpdir(), 'provider-observation-'));
const originalSource = readFileSync(join(root, 'src/reply-provider.ts'), 'utf8');
const source = originalSource.replace(/\r\n/g, '\n'); // Normal Windows checkout/merge line endings.
const observation = readFileSync(join(root, 'src/provider-observation.ts'), 'utf8');
const variants = ['original', 'instrumented', 'transportOnly', 'throws', 'rejects', 'thenable', 'pending', 'saturated', 'installFailure', 'usageFailure'];
type Item = { status?: number; body?: unknown; raw?: string; headers?: Record<string, string>; thrown?: Error };
type Scenario = { name: string; queue: Item[]; physical: number; usage: number; configure?: (input: any, config: any) => void };
const valid = { intent: 'friendly reaction', decision: 'reply', category: 'banter', reply_text: 'That was a rough one.', reason: 'PRIVATE_MARKER', needs_lookup: false, promo_product: 'none', promo_explicit: false };
const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40, cache_creation: { ephemeral_1h_input_tokens: 40, ephemeral_5m_input_tokens: 0 }, server_tool_use: { web_search_requests: 0 } };
const tool = (decision: unknown = valid, u: unknown = usage) => ({ id: 'fixture', type: 'message', role: 'assistant', model: 'fixture', stop_reason: 'tool_use', usage: u, content: [{ type: 'tool_use', id: 'tool', name: 'submit_reply', input: decision }] });
const ok = (decision: unknown = valid, u: unknown = usage): Item => ({ status: 200, body: tool(decision, u) });
const fail = (status = 503, headers?: Record<string, string>): Item => ({ status, headers, body: { type: 'error', error: { type: status === 401 ? 'authentication_error' : 'overloaded_error', message: 'PRIVATE_MARKER' } } });
const searchOnly = (): Item => ({ status: 200, body: { ...tool(valid, { ...usage, server_tool_use: { web_search_requests: 3 } }), stop_reason: 'end_turn', content: [{ type: 'web_search_tool_result', tool_use_id: 'server-tool', content: [] }, { type: 'text', text: 'PRIVATE_MARKER search evidence.' }] } });
const useSearch = (input: any, config: any) => { input.modelOverride = config.model; input.allowSearch = true; };
const scenarios: Scenario[] = [
  { name: 'accepted', queue: [ok()], physical: 1, usage: 1 },
  { name: 'modelSkip', queue: [ok({ ...valid, decision: 'skip', category: 'spam', reply_text: '' })], physical: 1, usage: 1 },
  { name: 'operatorGuard', queue: [], physical: 0, usage: 0, configure: input => { input.commentText = 'Are you a bot?'; } },
  { name: 'anatomyGuard', queue: [], physical: 0, usage: 0, configure: input => { input.commentText = 'This image has an extra finger.'; } },
  { name: 'recursiveAccepted', queue: [ok({ ...valid, decision: 'skip', category: 'other', reply_text: '', reason: 'A lone emoji with no substantive content' }), ok()], physical: 2, usage: 2, configure: input => { input.replyAll = true; } },
  { name: 'recursiveRejected', queue: [ok({ ...valid, reply_text: 'Your guess is in.' }), ok({ ...valid, reply_text: 'Your guess is in.' })], physical: 2, usage: 2 },
  { name: 'styleRepair', queue: [ok({ ...valid, reply_text: 'Coins went in; nothing came out.' }), ok()], physical: 2, usage: 2 },
  { name: 'presentationFailure', queue: [ok({ ...valid, reply_text: 'Coins went in; nothing came out.' }), ok({ ...valid, reply_text: 'Coins went in; nothing came out.' })], physical: 2, usage: 2 },
  { name: 'forgedFailureFlag', queue: [ok({ ...valid, decision: 'skip', category: 'other', reply_text: '', draftFailure: 'punctuation' })], physical: 1, usage: 1 },
  { name: 'forcedTool', queue: [searchOnly(), ok()], physical: 2, usage: 2, configure: useSearch },
  { name: 'sdk503Retries', queue: [fail(), fail(), ok()], physical: 3, usage: 1 },
  { name: 'sdk429Retry', queue: [fail(429), ok()], physical: 2, usage: 1 },
  { name: 'sdk408Retry', queue: [fail(408), ok()], physical: 2, usage: 1 },
  { name: 'sdk409Retry', queue: [fail(409), ok()], physical: 2, usage: 1 },
  { name: 'connectionRetry', queue: [{ thrown: new TypeError('PRIVATE_MARKER connection') }, ok()], physical: 2, usage: 1 },
  { name: 'timeoutRetry', queue: [{ thrown: new DOMException('PRIVATE_MARKER timed out', 'AbortError') }, ok()], physical: 2, usage: 1 },
  { name: 'exhausted503', queue: [fail(), fail(), fail()], physical: 3, usage: 0 },
  { name: 'explicitNoRetry', queue: [fail(503, { 'x-should-retry': 'false' })], physical: 1, usage: 0 },
  { name: 'explicitRetry', queue: [fail(400, { 'x-should-retry': 'true' }), ok()], physical: 2, usage: 1 },
  { name: 'fatal401', queue: [fail(401)], physical: 1, usage: 0 },
  { name: 'invalidDecision', queue: [ok({ ...valid, decision: 'invented' })], physical: 1, usage: 1 },
  { name: 'invalidJson', queue: [{ status: 200, raw: '{broken' }], physical: 1, usage: 0 },
  { name: 'searchWithSubmit', queue: [{ status: 200, body: { ...tool(valid, { ...usage, server_tool_use: { web_search_requests: 3 } }), content: [{ type: 'web_search_tool_result', tool_use_id: 'server-tool', content: [] }, ...tool().content] } }], physical: 1, usage: 1, configure: useSearch },
  { name: 'cache5mReported', queue: [ok(valid, { ...usage, cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 40 } })], physical: 1, usage: 1 },
  { name: 'cacheUnsplit', queue: [ok(valid, { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 40 })], physical: 1, usage: 1 },
  { name: 'missingUsage', queue: [ok(valid, null)], physical: 1, usage: 1 },
  { name: 'prepThrows', queue: [], physical: 0, usage: 0, configure: input => { input.modelOverride = 'unpriced-fixture'; } },
];

const originalTimeout = globalThis.setTimeout;
// Accelerate synthetic short backoffs only; retain the SDK's default two retries.
globalThis.setTimeout = ((fn: (...args: any[]) => void, ms?: number, ...args: any[]) => originalTimeout(fn, ms !== undefined && ms <= 3000 ? 0 : ms, ...args)) as typeof setTimeout;
let activeFake: typeof fetch = async () => { throw Error('Unexpected fixture dispatch'); };
globalThis.fetch = (...args) => activeFake(...args); // Stable SDK-captured fake, no network.
const outputs = new Map<string, unknown[]>();
const measurements = new Map<string, any>();
const unhandled: unknown[] = [];
const rejected = (value: unknown) => unhandled.push(value);
process.on('unhandledRejection', rejected);
const originalLog = console.log, originalError = console.error;
const once = (text: string, from: string, to: string) => {
  assert.equal(text.split(from).length, 2, `exactly one observation seam: ${from}`);
  return text.replace(from, to);
};
try {
  for (const variant of variants) {
    const dir = join(fixture, variant); mkdirSync(dir);
    cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    if (variant === 'original' || variant === 'transportOnly') {
      let copy = source;
      if (variant === 'original') {
        copy = once(copy, 'observedReplyFetch, observeReplyUsage, ', '');
        copy = once(copy, ', fetch: observedReplyFetch()', '');
      }
      copy = once(copy, '    try { observeReplyUsage(response.usage); } catch { /* PR13 observation is optional. */ }\n', '');
      writeFileSync(join(dir, 'src/reply-provider.ts'), copy);
    }
    let module = observation;
    const callback = variant === 'throws' ? '() => { throw Error("PRIVATE_MARKER"); }'
      : variant === 'rejects' ? '() => Promise.reject(Error("PRIVATE_MARKER"))'
      : variant === 'thenable' ? '() => Object.defineProperty({}, "then", { get() { throw Error("PRIVATE_MARKER"); } })'
      : variant === 'pending' ? '() => new Promise(() => {})' : 'undefined';
    if (callback !== 'undefined' || variant === 'saturated') module = once(module, 'createProviderObservation();', `createProviderObservation(${callback}, ${variant === 'saturated' ? 1 : 'Number.MAX_SAFE_INTEGER'});`);
    if (variant === 'installFailure') module = once(module, 'return replyObservation.wrapFetch(globalThis.fetch);', 'throw Error("PRIVATE_MARKER");');
    if (variant === 'usageFailure') module = once(module, 'try { replyObservation.usage(usage); } catch { /* No observation affects spending or decisions. */ }', 'throw Error("PRIVATE_MARKER");');
    writeFileSync(join(dir, 'src/provider-observation.ts'), module);
    const { config } = await import(pathToFileURL(join(dir, 'src/config.ts')).href);
    const { classifyAndDraft } = await import(pathToFileURL(join(dir, 'src/reply.ts')).href);
    const { drainSpend } = await import(pathToFileURL(join(dir, 'src/spend.ts')).href);
    const { replyProviderSnapshot } = await import(pathToFileURL(join(dir, 'src/provider-observation.ts')).href);
    Object.assign(config, { webSearch: true, gifReplies: false, deepSeekTrial: false });
    const results: unknown[] = [];
    for (const scenario of scenarios) {
      const before = replyProviderSnapshot();
      const queue = scenario.queue.slice();
      const input = { postText: 'A knee that looked wrong from birth.', commentText: 'A friendly reaction.', answer: 'Knee dislocation', answerPublic: true, replyAll: false, modelOverride: config.triageModel, allowSearch: false, learnedNotesOverride: '' };
      scenario.configure?.(input, config);
      const requests: any[] = [], logs: unknown[] = [];
      activeFake = async (url, init) => {
        assert.equal(new URL(String(url)).pathname, '/v1/messages');
        requests.push({ url: String(url), method: init?.method, body: String(init?.body), headers: [...new Headers(init?.headers).entries()] });
        const next = queue.shift(); assert.ok(next, 'unexpected transport dispatch');
        if (next.thrown) throw next.thrown;
        return new Response(next.raw ?? JSON.stringify(next.body), { status: next.status ?? 200, headers: { 'content-type': 'application/json', 'retry-after-ms': '1', ...next.headers } });
      };
      drainSpend();
      console.log = (...args) => { logs.push(['log', ...args]); };
      console.error = (...args) => { logs.push(['error', ...args]); };
      let decision: unknown, thrown: unknown, completions = 0;
      try { decision = await classifyAndDraft(input, (outcome: unknown) => { assert.deepEqual(Object.keys(outcome as object), ['decision', 'category']); completions++; }); }
      catch (error) { thrown = { name: (error as Error).name, message: (error as Error).message }; }
      finally { console.log = originalLog; console.error = originalError; }
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(unhandled.length, 0, 'observer rejections are handled');
      assert.equal(requests.length, scenario.physical, scenario.name);
      assert.equal(queue.length, 0, 'every response fixture consumed');
      const spend = drainSpend();
      assert.equal(spend.calls, scenario.usage, `${scenario.name}: existing spend call unit`);
      assert.equal(completions, scenario.name === 'prepThrows' ? 0 : 1, 'caller completions remain separate');
      if (scenario.name === 'presentationFailure') assert.equal((decision as any).draftFailure, 'punctuation', 'trusted internal flag survives the caller wrapper and observer');
      if (scenario.name === 'forgedFailureFlag') assert.equal((decision as any).draftFailure, undefined, 'provider cannot invent later retry eligibility');
      const after = replyProviderSnapshot(); assert.ok(before && after);
      assert.equal(JSON.stringify(after).includes('PRIVATE_MARKER'), false);
      if (!['original', 'saturated', 'installFailure'].includes(variant)) assert.equal((after.transport.starts ?? 0) - (before.transport.starts ?? 0), scenario.physical);
      if (!['original', 'transportOnly', 'saturated', 'usageFailure'].includes(variant)) assert.equal(after.usage.records - before.usage.records, scenario.usage);
      if (variant === 'installFailure') assert.equal(after.transport.starts, null, 'unavailable measurement is not zero attempts');
      if (variant === 'instrumented') {
        measurements.set(scenario.name, { before, after, requests });
        if (scenario.name === 'missingUsage') {
          assert.equal(after.usage.inputTokens.unknownRecords - before.usage.inputTokens.unknownRecords, 1);
          assert.equal(after.usage.inputTokens.reportedTotal, before.usage.inputTokens.reportedTotal);
        }
      }
      results.push({ decision, thrown, requests, spend, logs, completions, exit: process.exitCode });
    }
    if (['throws', 'rejects', 'thenable'].includes(variant)) assert.ok(replyProviderSnapshot()!.measurement.failedObservations > 0);
    if (variant === 'saturated') assert.equal(replyProviderSnapshot()!.measurement.saturated, true);
    if (variant === 'installFailure') assert.ok(replyProviderSnapshot()!.measurement.installationFailures > 0);
    outputs.set(variant, results);
  }
} finally {
  globalThis.setTimeout = originalTimeout;
  console.log = originalLog; console.error = originalError;
  process.off('unhandledRejection', rejected);
  globalThis.fetch = async () => { throw Error('Network prohibited after fixture completion'); };
}
for (const variant of variants.filter(v => v !== 'original')) assert.deepEqual(outputs.get(variant), outputs.get('original'), `${variant}: decisions, thrown errors, complete request bytes/headers/order, spend, logs and completions unchanged`);
const ordinals = (name: string) => measurements.get(name).requests.map((r: any) => Number(new Headers(r.headers).get('x-stainless-retry-count')));
assert.deepEqual(ordinals('sdk503Retries'), [0, 1, 2]);
assert.deepEqual(ordinals('recursiveAccepted'), [0, 0]);
assert.deepEqual(ordinals('forcedTool'), [0, 0]);
const search = measurements.get('searchWithSubmit');
assert.equal(search.after.usage.serverWebSearchRequests.reportedTotal - search.before.usage.serverWebSearchRequests.reportedTotal, 3);
for (const name of ['invalidJson', 'exhausted503']) {
  const data = measurements.get(name);
  assert.equal(data.after.usage.records, data.before.usage.records, 'transport outcome cannot invent usage or billing');
}
assert.equal(readFileSync(join(root, 'src/reply-provider.ts'), 'utf8'), originalSource, 'checkout source untouched by fixtures');
console.log(`PASS provider attempts: ${variants.length} variants x ${scenarios.length} scenarios; ${variants.length * scenarios.reduce((sum, s) => sum + s.physical, 0)} fake dispatches; complete requests/decisions/spend/completions preserved; observation failures isolated`);
