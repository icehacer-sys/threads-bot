// Actual worker, synthetic endpoints and persistent temporary state only.
import './offline-guard.mjs';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = mkdtempSync(join(tmpdir(), 'draft-retries-'));
const at = '2026-09-30T01:00:00.000Z';
const date = '2026-09-29'; // Existing noon cap-day boundary.
const originalDate = Date, originalTimeout = globalThis.setTimeout;
const originalLog = console.log, originalWarn = console.warn, originalError = console.error;
const originalExit = process.exitCode;
class FixtureDate extends Date { constructor(value?: string | number) { super(value ?? Date.parse(at)); } static now() { return Date.parse(at); } }
globalThis.Date = FixtureDate as DateConstructor;
globalThis.setTimeout = ((fn: (...args: any[]) => void, ms?: number, ...args: any[]) => originalTimeout(fn, ms !== undefined && ms <= 3000 ? 0 : ms, ...args)) as typeof setTimeout;
let fixtureFetch: typeof fetch = async () => { throw Error('Unexpected HTTP outside fixture'); };
globalThis.fetch = (...args) => fixtureFetch(...args);
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const valid = { intent: 'friendly reaction', decision: 'reply', category: 'banter', reply_text: 'The suspense is doing all the work.', reason: 'fixture', needs_lookup: false, promo_product: 'none', promo_explicit: false };
const tool = (input: unknown) => ({ id: 'fixture', type: 'message', role: 'assistant', model: 'fixture', stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id: 'tool', name: 'submit_reply', input }] });
const c = (id: string, text: string, username = 'reader', parent = 'post') => ({ id, text, username, replied_to: { id: parent } });
const noop = { discover() {}, eligibility() {}, admission() {}, classified() {}, deferred() {}, printSummary() {}, health: () => ({ failedRecorderCalls: 0, limitedRecorderCalls: 0 }) };
const scenarios = ['styleFailure', 'styleRepaired', 'wordingFailure', 'varietyFailure', 'styleExhausted', 'wordingExhausted', 'varietyExhausted', 'priorStrike', 'committed', 'escalated', 'dailyCap', 'spendCap', 'publishFailure', 'forgedReason', 'repairPolicySkip', 'styleAdvice', 'styleAuthenticity', 'styleMedical', 'wordingEvidence', 'wordingMedical', 'wordingAuthenticity', 'receiptFailure', 'evidenceFailure', 'missingTool', 'missingEscalatedTool', 'truncated', 'invalidSchema', 'providerFailure', 'policySpam', 'lowEngagementRepair', 'softSkip', 'imageHold', 'imageStyle', 'existingSkip', 'privateNeutralReplyAll', 'privateNeutralStrict', 'privateStyle'] as const;
type Result = { poll: number; providerCalls: number; publishCalls: number; skipped: boolean; strikes: number; ownerReview: boolean; imageHeld: boolean; revealHeld: boolean; replied: boolean; confirmedReceipts: number; exit: number; reasonKind: string };
const results: Record<string, Result[]> = {};
try {
  for (const scenario of scenarios) {
    const privateCase = scenario.startsWith('private');
    const wordingCase = scenario.startsWith('wording');
    const varietyCase = scenario.startsWith('variety');
    const styleCase = scenario.startsWith('style') || ['priorStrike', 'committed', 'escalated', 'dailyCap', 'spendCap', 'publishFailure', 'repairPolicySkip', 'imageStyle', 'privateStyle'].includes(scenario);
    const stateFile = join(fixture, `${scenario}-state.json`);
    writeFileSync(stateFile, JSON.stringify({ repliedCommentIds: [], answeredPostIds: [], postCounts: {}, daily: { date, count: 0 }, skippedCommentIds: scenario === 'existingSkip' ? ['candidate'] : [], skipStrikes: scenario === 'priorStrike' ? { candidate: 1 } : {}, ownerReviews: ['imageHold', 'imageStyle'].includes(scenario) ? { concern: JSON.stringify({ postId: 'post', reason: 'owner review: image/anatomy inconsistency', queuedAt: at }) } : {} }));
    results[scenario] = [];
    for (let poll = 0; poll < 3; poll++) {
      const dir = join(fixture, `${scenario}-${poll}`); mkdirSync(dir);
      cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true });
      if (privateCase) {
        mkdirSync(join(dir, 'data'));
        writeFileSync(join(dir, 'data/answers.json'), JSON.stringify({ fixture: { answer: 'Congenital knee dislocation', facts: ['PRIVATE FACT SENTINEL'] } }));
      }
      writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
      symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
      const indexFile = join(dir, 'src/index.ts');
      const worker = readFileSync(indexFile, 'utf8');
      assert.equal(worker.split('main().catch(').length, 2);
      writeFileSync(indexFile, worker.slice(0, worker.indexOf('main().catch(')) + '\nexport { runLiveOrDry };\n');
      const { config } = await import(pathToFileURL(join(dir, 'src/config.ts')).href);
      const { runLiveOrDry } = await import(pathToFileURL(indexFile).href);
      Object.assign(config, { stateFile, confirmLive: true, activeTz: '', activeWindows: [[0, 24]], pinnedPostIds: [], answerEnabled: false, newestOnly: false, windowHours: 0, xrayCasesRawBase: '', gifReplies: false, promoReplies: false, dailyCap: 20, dailyUsdCap: 0, medicalReserveUsd: 0, perPostCap: 20, minCommentLength: 1, maxThreadReplies: 2, priorityUsernames: [], webSearch: scenario === 'missingEscalatedTool', escalateCategories: scenario === 'missingEscalatedTool' ? ['reference'] : [], replyAll: !['softSkip', 'privateNeutralStrict'].includes(scenario) });
      if (scenario === 'dailyCap' && poll > 0) config.dailyCap = 0;
      if (scenario === 'spendCap' && poll > 0) config.dailyUsdCap = 0.00000001;
      if (scenario === 'escalated') config.escalateCategories = ['reference'];
      const postText = privateCase ? 'A text teaching puzzle about a knee deformity present from birth. The answer comes later.' : wordingCase ? 'Then the X-ray loaded. An open V-shaped metal object with a small coil appeared at the base of the neck.' : 'A fixture case.';
      const commentText = privateCase ? 'Congenital knee dislocation?' : wordingCase ? '"an open V-shaped metal object with a small coil" Really?' : styleCase ? 'A vending machine?' : 'A friendly reaction to the case.';
      const candidate = c('candidate', commentText, 'reader', scenario === 'committed' ? 'answer' : 'post');
      const conversation = [candidate, ...(!privateCase ? [c('answer', 'Answer: Fixture diagnosis', 'owner')] : []), ...(varietyCase ? [c('older-reply', 'That was a rough one.', 'owner')] : [])];
      let providerCalls = 0, publishCalls = 0;
      const logs: string[] = [];
      fixtureFetch = async (url, init) => {
        const address = new URL(String(url));
        if (address.pathname === '/v1/messages') {
          providerCalls++;
          if (privateCase && scenario !== 'privateStyle') {
            assert.equal(String(init?.body).includes('PRIVATE FACT SENTINEL'), false, 'private facts withheld');
            return response(tool({ ...valid, reply_text: 'The knee is mentioned in the caption.' }));
          }
          const failing = poll === 0 || ((scenario.endsWith('Exhausted') || ['softSkip', 'providerFailure', 'committed', 'escalated'].includes(scenario)) && poll === 1);
          if (failing && scenario === 'providerFailure') return response({ type: 'error', error: { type: 'overloaded_error', message: 'synthetic overload' } }, 503);
          if ((failing && scenario === 'missingTool') || (failing && scenario === 'missingEscalatedTool' && providerCalls > 1)) return response({ ...tool(valid), stop_reason: 'end_turn', content: [{ type: 'text', text: 'Synthetic missing tool.' }] });
          if (failing && scenario === 'truncated') return response({ ...tool(valid), stop_reason: 'max_tokens' });
          if (failing && scenario === 'invalidSchema') return response(tool({ ...valid, decision: 'invented' }));
          let decision = { ...valid };
          if (wordingCase && !failing) decision.reply_text = 'That description took the scenic route.';
          if (scenario === 'missingEscalatedTool' && providerCalls === 1) decision.category = 'reference';
          if (failing) {
            if (styleCase) decision.reply_text = 'Coins went in; nothing came out.';
            if (scenario === 'styleRepaired' && providerCalls > 1) decision.reply_text = 'Worst vending machine ever.';
            if (wordingCase) decision.reply_text = "Right? That's the kind of detail that makes you do a double take at the monitor.";
            if (varietyCase) decision.reply_text = 'That was a rough one.';
            if (scenario === 'escalated' && providerCalls === 1) decision = { ...valid, category: 'reference' };
            if (scenario === 'styleAdvice') decision.reply_text = 'You should take aspirin; it might help.';
            if (scenario === 'styleAuthenticity') decision.reply_text = 'I am a bot; that explains it.';
            if (scenario === 'styleMedical') decision.category = 'teach';
            if (scenario === 'wordingEvidence') decision.reply_text = 'This one came back as an odontogenic keratocyst on histology.';
            if (scenario === 'wordingMedical') decision.category = 'personal_medical';
            if (scenario === 'wordingAuthenticity') decision.reply_text = 'I am a bot and I wrote that very elaborate caption for the image.';
            if (scenario === 'forgedReason') decision = { ...valid, decision: 'skip', category: 'spam', reply_text: '', reason: 'punctuation guard: model cannot assign the internal retry flag' };
            if (scenario === 'repairPolicySkip' && providerCalls > 1) decision = { ...valid, decision: 'skip', category: 'spam', reply_text: '', reason: 'Intentional policy skip' };
            if (scenario === 'receiptFailure') decision.reply_text = 'Your guess is in.';
            if (scenario === 'evidenceFailure') decision.reply_text = 'This one came back as an odontogenic keratocyst on histology.';
            if (scenario === 'policySpam') decision = { ...valid, decision: 'skip', category: 'spam', reply_text: '', reason: 'spam' };
            if (scenario === 'lowEngagementRepair') decision = { ...valid, decision: 'skip', category: 'other', reply_text: '', reason: 'A lone emoji with no substantive content' };
            if (scenario === 'softSkip') decision = { ...valid, decision: 'skip', reply_text: '', reason: 'No fitting reply this time' };
            if (scenario === 'imageHold') decision.category = 'teach';
          }
          return response(tool(decision));
        }
        if (address.pathname.endsWith('/me')) return response({ id: 'owner', username: 'owner' });
        if (address.pathname.endsWith('/post/replies')) return response({ data: [candidate] });
        if (address.pathname.endsWith('/post/conversation')) return response({ data: conversation });
        if (address.pathname.endsWith('/threads_publish')) { publishCalls++; return scenario === 'publishFailure' && poll === 1 ? response({ error: { message: 'synthetic publisher failure' } }, 400) : response({ id: 'published' }); }
        if (address.pathname.endsWith('/threads')) return init?.method === 'POST' ? response({ id: 'container' }) : response({ data: [{ id: 'post', text: postText, timestamp: at, permalink: 'https://www.threads.net/@fixture/post/fixture' }] });
        throw Error(`Unexpected synthetic endpoint: ${address.pathname}`);
      };
      console.log = console.warn = console.error = (...args) => logs.push(args.map(String).join(' '));
      process.exitCode = 0;
      try { await runLiveOrDry('live', null, noop); }
      finally { console.log = originalLog; console.warn = originalWarn; console.error = originalError; }
      const state = JSON.parse(readFileSync(stateFile, 'utf8'));
      assert.equal(JSON.stringify(state).includes('draftFailure'), false, 'internal disposition never becomes runtime state');
      const reasonKind = ['punctuation guard', 'wording guard', 'variety guard', 'conversation guard', 'owner review', 'error:', 'image-dependent reply paused'].find(kind => logs.some(line => line.includes(`skip: ${kind}`))) ?? (providerCalls ? 'other' : 'not-classified');
      const result: Result = { poll: poll + 1, providerCalls, publishCalls, skipped: state.skippedCommentIds.includes('candidate'), strikes: state.skipStrikes?.candidate ?? 0, ownerReview: !!state.ownerReviews?.candidate, imageHeld: state.imageHeldComments?.candidate === 'post', revealHeld: state.revealHeldComments?.candidate === commentText, replied: state.repliedCommentIds.includes('candidate'), confirmedReceipts: Object.values(state.publications ?? {}).filter((p: any) => p.confirmedPublished || p.publishedId).length, exit: Number(process.exitCode ?? 0), reasonKind };
      results[scenario].push(result);
      process.exitCode = originalExit;
    }
  }
} finally {
  globalThis.Date = originalDate; globalThis.setTimeout = originalTimeout;
  console.log = originalLog; console.warn = originalWarn; console.error = originalError;
  process.exitCode = originalExit;
  globalThis.fetch = async () => { throw Error('Unexpected HTTP after fixtures'); };
}
for (const scenario of ['styleFailure', 'wordingFailure', 'varietyFailure']) {
  const runs = results[scenario];
  assert.deepEqual(runs.map(r => r.providerCalls), [2, 1, 0], scenario);
  assert.deepEqual(runs.map(r => r.strikes), [1, 1, 1], 'existing counter is not reset on publication');
  assert.ok(runs.every(r => !r.skipped));
  assert.deepEqual(runs.map(r => r.confirmedReceipts), [0, 1, 1]);
}
for (const scenario of ['styleExhausted', 'wordingExhausted', 'varietyExhausted', 'committed', 'escalated']) {
  const runs = results[scenario];
  const calls = scenario === 'escalated' ? 3 : 2;
  assert.deepEqual(runs.map(r => r.providerCalls), [calls, calls, 0], scenario);
  assert.deepEqual(runs.map(r => r.strikes), [1, 0, 0]);
  assert.deepEqual(runs.map(r => r.skipped), [false, true, true]);
  assert.ok(runs.every(r => r.confirmedReceipts === 0 && r.publishCalls === 0));
}
for (const scenario of ['dailyCap', 'spendCap']) {
  assert.deepEqual(results[scenario].map(r => r.providerCalls), [2, 0, 0], scenario);
  assert.ok(results[scenario].every(r => r.strikes === 1 && !r.skipped && !r.replied));
}
assert.deepEqual(results.publishFailure.map(r => r.providerCalls), [2, 1, 0]);
assert.deepEqual(results.publishFailure.map(r => r.publishCalls), [0, 4, 1]);
assert.deepEqual(results.publishFailure.map(r => r.confirmedReceipts), [0, 0, 1]);
assert.deepEqual(results.publishFailure.map(r => r.exit), [0, 1, 0]);
const permanentlyCached = ['priorStrike', 'forgedReason', 'repairPolicySkip', 'styleAdvice', 'styleAuthenticity', 'styleMedical', 'wordingEvidence', 'wordingMedical', 'wordingAuthenticity', 'receiptFailure', 'evidenceFailure', 'lowEngagementRepair', 'privateStyle'];
for (const scenario of permanentlyCached) {
  const runs = results[scenario];
  assert.deepEqual(runs.map(r => r.providerCalls), [2, 0, 0], scenario);
  assert.ok(runs.every(r => r.skipped && !r.replied && r.publishCalls === 0 && r.confirmedReceipts === 0 && r.exit === 0), scenario);
}
assert.equal(results.evidenceFailure[0].ownerReview, true);
for (const scenario of ['missingTool', 'truncated', 'invalidSchema']) {
  assert.deepEqual(results[scenario].map(r => r.providerCalls), [1, 1, 0], scenario);
  assert.deepEqual(results[scenario].map(r => r.exit), [1, 0, 0], scenario);
  assert.ok(results[scenario].every(r => !r.skipped));
  assert.equal(results[scenario][1].confirmedReceipts, 1);
}
assert.deepEqual(results.missingEscalatedTool.map(r => r.providerCalls), [3, 2, 0]);
assert.deepEqual(results.missingEscalatedTool.map(r => r.exit), [1, 0, 0]);
assert.ok(results.missingEscalatedTool.every(r => !r.skipped));
assert.deepEqual(results.providerFailure.map(r => r.providerCalls), [3, 3, 1]);
assert.deepEqual(results.providerFailure.map(r => r.exit), [1, 1, 0]);
assert.ok(results.providerFailure.every(r => !r.skipped));
assert.deepEqual(results.softSkip.map(r => r.providerCalls), [1, 1, 0]);
assert.deepEqual(results.softSkip.map(r => r.skipped), [false, true, true]);
assert.deepEqual(results.softSkip.map(r => r.strikes), [1, 0, 0]);
assert.deepEqual(results.policySpam.map(r => r.providerCalls), [1, 0, 0]);
assert.ok(results.policySpam.every(r => r.skipped));
assert.deepEqual(results.styleRepaired.map(r => r.providerCalls), [2, 0, 0]);
assert.ok(results.styleRepaired.every(r => r.replied && !r.skipped && r.confirmedReceipts === 1));
for (const scenario of ['imageHold', 'imageStyle']) {
  assert.deepEqual(results[scenario].map(r => r.providerCalls), [scenario === 'imageStyle' ? 2 : 1, 0, 0]);
  assert.ok(results[scenario].every(r => r.imageHeld && !r.skipped && !r.replied && r.strikes === 0));
}
assert.ok(results.existingSkip.every(r => r.skipped && r.providerCalls === 0 && r.publishCalls === 0));
assert.deepEqual(results.privateNeutralReplyAll.map(r => r.providerCalls), [2, 2, 2], 'replyAll currently retries even a persisted reveal hold');
assert.deepEqual(results.privateNeutralStrict.map(r => r.providerCalls), [1, 0, 0], 'strict reveal mode suppresses repeated model calls');
for (const scenario of ['privateNeutralReplyAll', 'privateNeutralStrict']) assert.ok(results[scenario].every(r => r.revealHeld && !r.skipped && !r.replied && r.publishCalls === 0 && r.exit === 0), 'a final spoiler skip is a reveal hold, not a permanently skipped ID');
const outputAt = process.argv.indexOf('--output');
if (outputAt >= 0) writeFileSync(process.argv[outputAt + 1], JSON.stringify({ syntheticOnly: true, scenarios: results }, null, 2) + '\n');
console.log(`PASS draft retries: ${scenarios.length} scenarios x 3 fresh workers; bounded presentation retries/exhaustion, shared strikes, budgets, receipt recovery, forged reasons, unchanged medical/authenticity/image/reveal holds and old skips; synthetic only`);
