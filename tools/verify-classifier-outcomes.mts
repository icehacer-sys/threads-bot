// Synthetic classifier comparisons; no endpoint, production state or environment files.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CoverageLedger, type CoverageEvent } from '../src/coverage-decisions';
import { createCoverageObservation } from '../src/coverage-observation';

const at = '2026-09-30T01:00:00.000Z';
const scope = { id: 'classifier', startedAt: '2026-09-30T00:00:00.000Z', endedAt: '2026-10-01T00:00:00.000Z', discovery: 'partial' as const, maxComments: 100, maxEvents: 1000 };
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = mkdtempSync(join(tmpdir(), 'classifier-outcomes-'));
const baseline = process.argv.includes('--baseline-dir') ? process.argv[process.argv.indexOf('--baseline-dir') + 1] : undefined;
const variants = ['disabled', 'recorded', 'throws', 'rejects', 'thenable', 'mutates', 'clock', 'limit', 'recorder', ...(baseline ? ['original'] : [])];
const scenarios = ['accepted', 'spam', 'operator', 'anatomy', 'recursiveAccepted', 'recursiveRejected', 'styleRepair', 'forcedTool', 'sdkRetry', 'fatal', 'parseFailure', 'prepThrows'] as const;
const expectedCalls = [1, 1, 0, 0, 2, 2, 2, 2, 3, 1, 1, 0];
const outputs = new Map<string, unknown[]>();
const reports = new Map<string, ReturnType<CoverageLedger['report']>>();
const originalTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((fn: (...args: any[]) => void, ms?: number, ...args: any[]) => originalTimeout(fn, ms !== undefined && ms <= 3000 ? 0 : ms, ...args)) as typeof setTimeout;
let fixtureFetch: typeof fetch = async () => { throw Error('Unexpected HTTP outside a scenario'); };
globalThis.fetch = (...args) => fixtureFetch(...args); // SDK captures this stable dispatcher.
const unhandled: unknown[] = [];
const rejectListener = (error: unknown) => unhandled.push(error);
process.on('unhandledRejection', rejectListener);
const valid = { intent: 'friendly reaction', decision: 'reply', category: 'banter', reply_text: 'That was a rough one.', reason: 'PRIVATE_MARKER', needs_lookup: false, promo_product: 'none', promo_explicit: false };
const tool = (decision: unknown) => ({ id: 'fixture', type: 'message', role: 'assistant', model: 'fixture', stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id: 'tool', name: 'submit_reply', input: decision }] });
const error = (type: string) => ({ type: 'error', error: { type, message: 'PRIVATE_MARKER' } });
try {
  for (const variant of variants) {
    const dir = join(fixture, variant); mkdirSync(dir);
    cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    if (variant === 'original') cpSync(join(baseline!, 'reply.ts'), join(dir, 'src/reply.ts'));
    const { config } = await import(pathToFileURL(join(dir, 'src/config.ts')).href);
    const { classifyAndDraft } = await import(pathToFileURL(join(dir, 'src/reply.ts')).href);
    const { drainSpend } = await import(pathToFileURL(join(dir, 'src/spend.ts')).href);
    Object.assign(config, { webSearch: true, gifReplies: false });
    const results: unknown[] = [];
    for (const [index, scenario] of scenarios.entries()) {
      let queue: Array<{ body: unknown; status: number }> = [{ body: tool(valid), status: 200 }];
      const input = { postText: 'A knee that looked wrong from birth.', commentText: 'A friendly reaction.', answer: 'Knee dislocation', answerPublic: true, replyAll: false, modelOverride: config.triageModel, allowSearch: false };
      if (scenario === 'spam') queue = [{ body: tool({ ...valid, decision: 'skip', category: 'spam', reply_text: '' }), status: 200 }];
      if (scenario === 'operator') { input.commentText = 'Are you a bot?'; queue = []; }
      if (scenario === 'anatomy') { input.commentText = 'This image has an extra finger.'; queue = []; }
      if (scenario === 'recursiveAccepted') {
        input.replyAll = true;
        queue = [{ body: tool({ ...valid, decision: 'skip', category: 'other', reply_text: '', reason: 'A lone emoji with no substantive content' }), status: 200 }, { body: tool(valid), status: 200 }];
      }
      if (scenario === 'recursiveRejected') queue = [0, 1].map(() => ({ body: tool({ ...valid, reply_text: 'Your guess is in.' }), status: 200 }));
      if (scenario === 'styleRepair') queue = [{ body: tool({ ...valid, reply_text: 'Coins went in; nothing came out.' }), status: 200 }, { body: tool(valid), status: 200 }];
      if (scenario === 'forcedTool') {
        input.modelOverride = config.model; input.allowSearch = true;
        queue = [{ body: { ...tool(valid), stop_reason: 'end_turn', content: [{ type: 'text', text: 'Synthetic search completed.' }] }, status: 200 }, { body: tool(valid), status: 200 }];
      }
      if (scenario === 'sdkRetry') queue = [{ body: error('overloaded_error'), status: 503 }, { body: error('overloaded_error'), status: 503 }, { body: tool(valid), status: 200 }];
      if (scenario === 'fatal') queue = [{ body: error('authentication_error'), status: 401 }];
      if (scenario === 'parseFailure') queue = [{ body: tool({ ...valid, decision: 'invented' }), status: 200 }];
      if (scenario === 'prepThrows') { input.modelOverride = 'unpriced-fixture'; queue = []; }
      const requests: string[] = [];
      fixtureFetch = async (url, init) => {
        assert.equal(new URL(String(url)).pathname, '/v1/messages');
        requests.push(String(init?.body));
        const next = queue.shift(); assert.ok(next, 'unexpected physical provider request');
        return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'content-type': 'application/json' } });
      };
      const ledger = new CoverageLedger({ ...scope, maxEvents: variant === 'limit' ? 1 : 1000 });
      const recorder = variant === 'recorder' ? { record: (_: CoverageEvent): 'recorded' => { throw Error('PRIVATE_MARKER'); }, report: ledger.report.bind(ledger) } : ledger;
      const o = createCoverageObservation(recorder, 'poll', () => { if (variant === 'clock') throw Error('PRIVATE_MARKER'); return at; });
      o.discover('post', [{ id: 'comment' }]);
      let callbacks = 0;
      const observe = (outcome: { decision: 'reply' | 'skip'; category: any }) => {
        callbacks++; assert.deepEqual(Object.keys(outcome), ['decision', 'category']);
        o.classified('post', 'comment', outcome);
        if (variant === 'throws') throw Error('PRIVATE_MARKER');
        if (variant === 'rejects') return Promise.reject(Error('PRIVATE_MARKER'));
        if (variant === 'thenable') return Object.defineProperty({}, 'then', { get() { throw Error('PRIVATE_MARKER'); } });
        if (variant === 'mutates') { outcome.decision = 'skip'; outcome.category = 'spam'; }
      };
      drainSpend();
      let decision: unknown, thrown: unknown;
      try { decision = await classifyAndDraft(input, ['disabled', 'original'].includes(variant) ? undefined : observe); }
      catch (err) { thrown = { name: (err as Error).name, message: (err as Error).message }; }
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(unhandled.length, 0, 'rejected observation cannot become an unhandled rejection');
      assert.equal(requests.length, expectedCalls[index], `${scenario} physical request count`);
      assert.equal(queue.length, 0, `${scenario} response queue consumed`);
      if (!['disabled', 'original'].includes(variant)) assert.equal(callbacks, scenario === 'prepThrows' ? 0 : 1, 'one completion after all internal requests; no completion on thrown preparation');
      results.push({ decision, thrown, requests, spend: drainSpend(), exit: process.exitCode });
      reports.set(`${variant}:${scenario}`, ledger.report());
      if (variant === 'recorded') {
        assert.equal(ledger.report().classifications.completedInvocations, scenario === 'prepThrows' ? 0 : 1);
        assert.equal(JSON.stringify(ledger.snapshot()).includes('PRIVATE_MARKER'), false);
        assert.equal(ledger.report().attempts.drafting, 0, 'physical drafting/provider attempts remain uninstrumented');
        assert.equal(ledger.report().numerator.uniqueEligibleWithRecordedDurableConfirmation, 0);
        assert.deepEqual(CoverageLedger.restore(ledger.snapshot()).report(), ledger.report());
      }
    }
    outputs.set(variant, results);
  }
} finally { globalThis.setTimeout = originalTimeout; process.off('unhandledRejection', rejectListener); globalThis.fetch = async () => { throw Error('Unexpected HTTP after fixtures'); }; }
for (const variant of variants.filter(v => v !== 'disabled')) assert.deepEqual(outputs.get(variant), outputs.get('disabled'), `${variant}: complete decisions, thrown errors, prompt bodies, physical request counts/order and spending unchanged`);
const baselineOutput = outputs.get('disabled') as Array<{ decision?: { decision: string }; thrown?: unknown }>;
assert.equal(baselineOutput[4].decision?.decision, 'reply');
assert.equal(baselineOutput[5].decision?.decision, 'skip');
assert.ok(baselineOutput[11].thrown);
assert.equal(reports.get('recorded:spam')!.observations[0].stages.classification, 'skip');
assert.equal(reports.get('recorded:spam')!.denominator.unknownEligibility, 1, 'skip does not invent a policy exclusion');
assert.equal(reports.get('recorded:accepted')!.denominator.uniqueObservedEverEligible, 1);
assert.equal(reports.get('recorded:sdkRetry')!.classifications.completedInvocations, 1);
const invalid = new CoverageLedger(scope);
invalid.record({ platform: 'threads', postId: 'post', commentId: 'comment', eventId: 'd', pollId: 'p', at, reason: 'observed', stage: 'discovery' });
const base = { platform: 'threads', postId: 'post', commentId: 'comment', eventId: 'c', pollId: 'p', at, reason: 'classified_skip', stage: 'classification', verdict: 'skip', category: 'spam' };
assert.throws(() => invalid.record({ ...base, category: 'private category' } as CoverageEvent));
assert.throws(() => invalid.record({ ...base, prompt: 'PRIVATE_MARKER' } as unknown as CoverageEvent));
assert.equal(invalid.report().observations[0].stages.classification, 'UNKNOWN');
console.log(`PASS classifier outcomes: ${variants.length} variants x ${scenarios.length} scenarios; final completions only; recursive/forced-tool/SDK requests preserved; sync/rejected/mutating observations isolated; sanitized enums, UNKNOWN and deterministic restore`);
