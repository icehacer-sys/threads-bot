// Full worker synthetic comparisons; no real endpoints, state, env files or model calls.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CoverageLedger, type CoverageEvent, type CoverageReason } from '../src/coverage-decisions';
import { createCoverageObservation } from '../src/coverage-observation';
import { replyCoverage } from '../src/reply-coverage';

const at = '2026-09-30T01:00:00.000Z';
const scope = { id: 'fixture', startedAt: '2026-09-30T00:00:00.000Z', endedAt: '2026-10-01T00:00:00.000Z', discovery: 'partial' as const, maxComments: 100, maxEvents: 1000 };
const c = (id: string, username = 'reader', parent = 'post', text = 'A friendly fixture reaction.') => ({ id, username, replied_to: { id: parent }, text });
const ledger = new CoverageLedger(scope);
for (const poll of ['p1', 'p2']) {
  const o = createCoverageObservation(ledger, poll, () => at);
  o.discover('post', [c('same'), c('same')]);
  o.eligibility('post', 'same', 'UNKNOWN', 'unclassified');
  o.admission('post', 'same', 'deferred', 'reveal_hold');
}
assert.equal(ledger.report().uniqueObserved, 1);
assert.equal(ledger.report().encounters, 2);
assert.equal(ledger.report().repeatedEncounters, 1);
assert.equal(ledger.report().denominator.uniqueObservedEverEligible, 0, 'mechanical admission is not full policy eligibility');
assert.deepEqual(ledger.report().attempts, { drafting: 0, publication: 0, kinds: {} });
assert.equal(ledger.report().numerator.uniqueEligibleWithRecordedDurableConfirmation, 0);
const badClock = createCoverageObservation(ledger, 'badclock', () => { throw Error('private-error'); });
badClock.discover('post', [c('clock')]);
assert.equal(badClock.health().failedRecorderCalls, 1);
const invalid = createCoverageObservation(ledger, 'invalid', () => at);
invalid.discover('post', [c('private text with spaces')]);
assert.equal(invalid.health().failedRecorderCalls, 1);
assert.equal(JSON.stringify(ledger.snapshot()).includes('private'), false);
// API payloads are not schema-validated. Malformed observer inputs must remain
// invisible to the worker's existing parsing and error paths.
const malformed = createCoverageObservation(ledger, 'malformed', () => at);
const badEntry = { get id(): string { throw Error('private entry getter'); } };
const badEntries = { [Symbol.iterator]() { throw Error('private iterator'); } } as unknown as readonly { id: string }[];
for (const entries of [[null] as unknown as readonly { id: string }[], [badEntry], badEntries]) {
  assert.doesNotThrow(() => malformed.discover('post', entries));
  assert.doesNotThrow(() => malformed.deferred('post', entries, 'budget'));
}
assert.equal(malformed.health().failedRecorderCalls, 6);
assert.doesNotThrow(() => malformed.classified('post', 'same', null as any));
assert.doesNotThrow(() => malformed.classified('post', 'same', { decision: 'reply', get category(): never { throw Error('private outcome getter'); } }));
assert.equal(malformed.health().failedRecorderCalls, 8);
const small = new CoverageLedger({ ...scope, maxEvents: 1 });
const limited = createCoverageObservation(small, 'limit', () => at);
limited.discover('post', [c('limit')]); limited.admission('post', 'limit', 'admitted', 'admitted');
assert.equal(limited.health().limitedRecorderCalls, 1);
assert.equal(small.report().measurement.truncated, true);
const savedLog = console.log;
const reporting = createCoverageObservation({ record: ledger.record.bind(ledger), report: () => { throw Error('private-report'); } }, 'report', () => at);
assert.doesNotThrow(() => reporting.printSummary());
console.log = () => { throw Error('private-console'); };
assert.doesNotThrow(() => createCoverageObservation(ledger, 'log', () => at).printSummary());
console.log = savedLog;

// A throwing callback must not change boolean results or state lookup order.
const members = [c('root'), c('bot', 'owner', 'root'), c('sibling', 'reader', 'bot'), c('orphan', 'reader', 'missing')];
for (const limit of [0, 1, 2, Number.NaN]) {
  for (const id of ['root', 'sibling', 'orphan']) {
    const readsA: string[] = [], readsB: string[] = [];
    const a = replyCoverage('post', 'owner', members, key => { readsA.push(key); return false; }, limit);
    const b = replyCoverage('post', 'owner', members, key => { readsB.push(key); return false; }, limit, () => { throw Error('observer'); });
    assert.equal(a.canReply(id), b.canReply(id)); assert.deepEqual(readsA, readsB);
  }
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = mkdtempSync(join(tmpdir(), 'coverage-observation-'));
const noop = { discover() {}, eligibility() {}, admission() {}, classified() {}, deferred() {}, printSummary() {}, health: () => ({ failedRecorderCalls: 0, limitedRecorderCalls: 0 }) };
const baselines = process.argv.includes('--baseline-dir') ? [process.argv[process.argv.indexOf('--baseline-dir') + 1]] : [];
const variants = ['disabled', 'recorded', 'throws', 'hookThrows', 'hookRejects', 'clock', 'limit', ...baselines.map(() => 'baseline')];
const originalDate = Date, originalTimeout = globalThis.setTimeout;
class FixtureDate extends Date { constructor(value?: string | number) { super(value ?? Date.parse(at)); } static now() { return Date.parse(at); } }
globalThis.Date = FixtureDate as DateConstructor;
globalThis.setTimeout = ((fn: (...args: any[]) => void, ms?: number, ...args: any[]) => originalTimeout(fn, ms !== undefined && ms <= 3000 ? 0 : ms, ...args)) as typeof setTimeout;
const outputs = new Map<string, unknown[]>();
const reports = new Map<string, ReturnType<CoverageLedger['report']>>();
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
let fixtureFetch: typeof fetch = async () => { throw Error('Unexpected HTTP outside a scenario'); };
// The provider SDK captures fetch when constructed. Keep one dispatcher so later
// scenarios exercise their own responses and record their own complete requests.
globalThis.fetch = (...args) => fixtureFetch(...args);
try {
  for (const variant of variants) {
    const dir = join(fixture, variant); mkdirSync(dir);
    cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    if (variant === 'baseline') for (const file of ['index.ts', 'reply-coverage.ts', 'reply.ts']) cpSync(join(baselines[0], file), join(dir, 'src', file));
    const indexFile = join(dir, 'src/index.ts');
    const worker = readFileSync(indexFile, 'utf8');
    assert.equal(worker.split('main().catch(').length, 2, 'fixture must disable exactly one CLI entry');
    writeFileSync(indexFile, worker.slice(0, worker.indexOf('main().catch(')) + '\nexport { runLiveOrDry };\n');
    const { config } = await import(pathToFileURL(join(dir, 'src/config.ts')).href);
    const { runLiveOrDry } = await import(pathToFileURL(indexFile).href);
    Object.assign(config, { confirmLive: true, activeTz: '', activeWindows: [[0, 24]], pinnedPostIds: [], answerEnabled: false, newestOnly: false, windowHours: 0, xrayCasesRawBase: '', gifReplies: false, promoEnabled: false, dailyCap: 20, dailyUsdCap: 0, medicalReserveUsd: 0, perPostCap: 20, minCommentLength: 10, maxThreadReplies: 2, priorityUsernames: ['supporter'], webSearch: false, escalateCategories: [] });
    const results: unknown[] = [];
    for (const scenario of ['gates', 'reveal', 'replyAll', 'cap', 'daily', 'usd', 'reserve', 'fetchFailure', 'outage', 'escalation', 'workerHold', 'malformed']) {
      Object.assign(config, { replyAll: scenario !== 'reveal' && scenario !== 'cap' && scenario !== 'reserve', perPostCap: scenario === 'cap' ? 2 : 20, dailyCap: scenario === 'daily' ? 1 : 20, dailyUsdCap: ['usd', 'reserve'].includes(scenario) ? 0.01 : 0, medicalReserveUsd: scenario === 'reserve' ? 0.005 : 0, escalateCategories: scenario === 'escalation' ? ['banter'] : [] });
      const stateFile = join(dir, `${scenario}-state.json`); config.stateFile = stateFile;
      const date = '2026-09-29'; // Existing cap-day rolls at noon, not midnight.
      const state = { repliedCommentIds: ['done', 'second'], answeredPostIds: [], postCounts: scenario === 'cap' ? { post: 2 } : {}, daily: { date, count: 0 }, skippedCommentIds: ['skipped'], imageHeldComments: { imageheld: 'post' }, revealHeldComments: { revealheld: c('revealheld').text }, ownerReviews: ['gates', 'workerHold'].includes(scenario) ? { concern: JSON.stringify({ postId: 'post', reason: 'image/anatomy fixture', queuedAt: at }) } : {}, spend: { date, usd: ['usd', 'reserve'].includes(scenario) ? 0.01 : 0 } };
      writeFileSync(stateFile, JSON.stringify(state));
      const comments = scenario === 'gates' ? [c('own', 'owner'), { ...c('hidden'), hide_status: 'HUSHED' }, c('empty', 'reader', 'post', ''), c('done'), c('skipped'), c('imageheld'), c('root'), c('first', 'owner', 'root'), c('second', 'reader', 'first'), c('third', 'owner', 'second'), c('turnlimited', 'reader', 'third'), c('orphan', 'reader', 'missing')]
        : scenario === 'reveal' ? [c('revealheld')]
        : scenario === 'cap' ? [c('low', 'reader', 'post', 'A friendly fixture reaction.'), c('high', 'reader', 'post', 'What is a fixture question?'), c('support', 'supporter', 'post', 'hi')]
        : scenario === 'malformed' ? [null] : [c('one', 'alice'), c('two', 'bob')];
      const calls: unknown[] = [], logs: string[] = [];
      fixtureFetch = async (url, init) => {
        const address = new URL(String(url));
        calls.push({ path: address.pathname, query: address.search, method: init?.method ?? 'GET', body: init?.body ? String(init.body) : null });
        if (address.pathname === '/v1/messages') {
          if (scenario === 'outage') return response({ type: 'error', error: { type: 'authentication_error', message: 'synthetic auth failure' } }, 401);
          return response({ id: 'fixture', type: 'message', role: 'assistant', model: config.triageModel, stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id: 'tool', name: 'submit_reply', input: { intent: 'friendly reaction', decision: 'reply', category: scenario === 'workerHold' ? 'teach' : 'banter', reply_text: scenario === 'workerHold' ? 'The caption does not state the age.' : 'That was a rough one.', reason: 'synthetic', needs_lookup: false, promo_product: 'none', promo_explicit: false } }] });
        }
        if (address.pathname.endsWith('/me')) return response({ id: 'owner', username: 'owner' });
        if (address.pathname.endsWith('/post/replies')) return response({ data: comments });
        if (address.pathname.endsWith('/post/conversation')) return scenario === 'fetchFailure' ? response({ error: 'synthetic discovery failure' }, 400) : response({ data: comments });
        if (address.pathname.endsWith('/later/replies') || address.pathname.endsWith('/later/conversation')) return response({ data: [c('later-comment', 'reader', 'later')] });
        if (address.pathname.endsWith('/threads_publish')) return response({ id: 'published' });
        if (address.pathname.endsWith('/threads')) return init?.method === 'POST' ? response({ id: 'container' }) : response({ data: [{ id: 'post', text: 'A fixture post.', timestamp: at }, ...(scenario === 'malformed' ? [{ id: 'later', text: 'A later fixture post.', timestamp: at }] : [])] });
        throw Error(`Unexpected synthetic endpoint: ${address.pathname}`);
      };
      const observed = new CoverageLedger({ ...scope, maxEvents: variant === 'limit' ? 1 : 1000 });
      const recorder = variant === 'throws' ? { record: (_: CoverageEvent): 'recorded' => { throw Error('private recorder failure'); }, report: observed.report.bind(observed) } : observed;
      const o = variant === 'hookThrows' ? new Proxy(noop, { get() { throw Error('private hook lookup'); } }) : variant === 'hookRejects' ? new Proxy(noop, { get() { return async () => { throw Error('private hook rejection'); }; } }) : variant === 'disabled' || variant === 'baseline' ? noop : createCoverageObservation(recorder, 'worker', () => { if (variant === 'clock') throw Error('private clock failure'); return at; });
      const savedError = console.error, savedWarn = console.warn;
      console.log = (...args) => { if (!String(args[0]).startsWith('{"coverageObservation":')) logs.push(args.map(String).join(' ')); };
      console.error = console.warn = (...args) => logs.push(args.map(String).join(' '));
      process.exitCode = 0;
      let thrown: { name: string; message: string } | undefined;
      try { await runLiveOrDry('live', null, o); }
      catch (err) { thrown = { name: (err as Error).name, message: (err as Error).message }; }
      finally { console.log = savedLog; console.error = savedError; console.warn = savedWarn; }
      assert.equal(!!thrown, scenario === 'malformed', 'only malformed payload exercises the original thrown worker path');
      results.push({ calls, logs, state: readFileSync(stateFile, 'utf8'), exit: process.exitCode, thrown });
      reports.set(`${variant}:${scenario}`, observed.report());
      process.exitCode = 0;
    }
    outputs.set(variant, results);
  }
} finally { globalThis.Date = originalDate; globalThis.setTimeout = originalTimeout; console.log = savedLog; globalThis.fetch = async () => { throw Error('Unexpected HTTP after synthetic fixtures'); }; }
for (const variant of variants.filter(v => v !== 'disabled')) assert.deepEqual(outputs.get(variant), outputs.get('disabled'), `${variant}: decisions, prompts, retry calls, state bytes and exit status must match disabled observation`);
const disabled = outputs.get('disabled') as Array<{ calls: Array<{ path: string }>; state: string; exit: number; thrown?: { name: string } }>;
assert.ok(disabled[2].calls.some(call => call.path === '/v1/messages'), 'replyAll exercises real drafting through synthetic provider');
assert.ok(JSON.parse(disabled[3].state).repliedCommentIds.includes('support'), 'supporter bypasses the existing soft post cap');
assert.equal(JSON.parse(disabled[4].state).daily.count, 1, 'daily cap stops subsequent candidates');
assert.equal(disabled[8].exit, 3, 'fatal synthetic provider failure exercises the original abort path');
for (const reason of ['self', 'hidden', 'insufficient_content', 'already_replied', 'already_skipped', 'image_review_hold', 'participant_turn_limit', 'incomplete_ancestry']) assert.ok(reports.get('recorded:gates')!.reasons[reason as CoverageReason], reason);
assert.equal(reports.get('recorded:reveal')!.reasons.reveal_hold, 1);
assert.ok(reports.get('recorded:cap')!.reasons.per_post_cap);
assert.ok(reports.get('recorded:daily')!.reasons.budget);
assert.ok(reports.get('recorded:usd')!.reasons.budget);
assert.ok(reports.get('recorded:reserve')!.reasons.budget);
assert.equal(reports.get('recorded:fetchFailure')!.uniqueObserved, 2, 'successful edge observed even if sibling edge fails');
assert.equal(reports.get('recorded:replyAll')!.uniqueObserved, 2);
assert.equal(reports.get('recorded:replyAll')!.encounters, 2, 'both edges in one poll are one encounter');
assert.equal(reports.get('recorded:replyAll')!.numerator.uniqueEligibleWithRecordedDurableConfirmation, 0);
assert.equal(reports.get('recorded:replyAll')!.classifications.completedInvocations, 2, 'internal repairs collapse to each completed caller invocation');
assert.equal(reports.get('recorded:replyAll')!.denominator.uniqueObservedEverEligible, 1);
assert.ok(reports.get('recorded:escalation')!.classifications.completedInvocations > 2, 'quality escalation completion is observed separately');
assert.equal(reports.get('recorded:workerHold')!.denominator.uniqueObservedEverEligible, 2, 'classifier-positive eligibility remains distinct from downstream image holds');
assert.equal(JSON.parse(disabled[10].state).daily.count, 0, 'downstream worker hold prevents publication despite classifier reply');
assert.equal(reports.get('recorded:workerHold')!.numerator.uniqueEligibleWithRecordedDurableConfirmation, 0);
assert.equal(disabled[11].thrown?.name, 'TypeError');
assert.ok(!disabled[11].calls.some(call => call.path.includes('/later/')), 'malformed first post retains original abort before later-post processing');
assert.equal(JSON.parse(disabled[11].state).daily.count, 0);
console.log(`PASS observation: ${variants.length} worker variants x 12 scenarios preserve decisions, prompts, request/retry order, holds, state and exit codes; malformed input retains original abort; classifier completions, unique encounters, explicit reasons, UNKNOWN, limits, throwing recorder/clock/report/console; synthetic only`);
