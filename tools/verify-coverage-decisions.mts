// Synthetic in-memory fixtures only. Never import the orchestrator or production state.
import assert from 'node:assert/strict';
import { COVERAGE_REASONS, CoverageLedger, type CoverageCohort, type CoverageEvent } from '../src/coverage-decisions';

const scope: CoverageCohort = {
  id: 'fixture-cohort', startedAt: '2026-09-30T00:00:00.000Z', endedAt: '2026-10-01T00:00:00.000Z',
  discovery: 'partial', maxComments: 50, maxEvents: 500,
};
const base = { platform: 'threads' as const, postId: 'post', commentId: 'comment', pollId: 'poll-1', at: '2026-09-30T01:00:00.000Z' };
const discovered: CoverageEvent = { ...base, eventId: 'discovery-1', stage: 'discovery', reason: 'observed' };
const eligible: CoverageEvent = { ...base, eventId: 'eligible-1', stage: 'eligibility', verdict: 'eligible', reason: 'policy_eligible' };
const seed = () => { const ledger = new CoverageLedger(scope); ledger.record(discovered); ledger.record(eligible); return ledger; };
const confirmedCount = (ledger: CoverageLedger) => ledger.report().numerator.uniqueEligibleWithRecordedDurableConfirmation;
const reject = (ledger: CoverageLedger, value: unknown) => assert.throws(() => ledger.record(value as CoverageEvent));

const ledger = seed();
assert.equal(ledger.record(discovered), 'duplicate');
ledger.record({ ...discovered, eventId: 'discovery-conversation' });
ledger.record({ ...discovered, eventId: 'discovery-2', pollId: 'poll-2', at: '2026-09-30T02:00:00.000Z' });
let report = ledger.report();
assert.equal(report.uniqueObserved, 1);
assert.equal(report.encounters, 2, 'two discovery edges in one poll are one encounter');
assert.equal(report.repeatedEncounters, 1);
assert.equal(report.denominator.uniqueObservedEverEligible, 1);
assert.equal(report.observations[0].firstObservedAt, base.at);
assert.equal(report.observations[0].lastObservedAt, '2026-09-30T02:00:00.000Z');
assert.equal(report.observations[0].stages.publication, 'UNKNOWN');
assert.equal(report.observations[0].stages.durable_outcome, 'UNKNOWN');
assert.equal(confirmedCount(ledger), 0, 'discovery, eligibility and counters are not publication success');

for (const reason of ['image_review_hold', 'reveal_hold', 'budget', 'per_post_cap', 'participant_turn_limit', 'owner_review'] as const) {
  ledger.record({ ...base, eventId: `held-${reason}`, stage: 'admission', verdict: 'deferred', reason });
  assert.equal(ledger.report().denominator.uniqueObservedEverEligible, 1, 'holds never remove eligible comments');
}
assert.equal(ledger.report().outcomes.deferred, 1);
assert.equal(ledger.report().denominator.intentionalExclusions, 0);

for (const [attemptId, kind, verdict] of [
  ['draft-1', 'initial', 'started'], ['draft-1', 'initial', 'provider_error'],
  ['draft-2', 'retry', 'accepted'], ['draft-3', 'repair', 'rejected'],
  ['draft-4', 'escalation', 'accepted'], ['draft-5', 'forced_tool', 'accepted'],
] as const) ledger.record({ ...base, eventId: `${attemptId}-${verdict}`, stage: 'drafting', attemptId, kind, verdict, reason: verdict === 'provider_error' ? 'provider_error' : kind });
ledger.record({ ...base, eventId: 'validation', stage: 'validation', verdict: 'rejected', reason: 'validation_rejected' });
ledger.record({ ...base, eventId: 'skip', stage: 'durable_outcome', verdict: 'skipped', reason: 'terminal_skip' });
report = ledger.report();
assert.equal(report.attempts.drafting, 5, 'attempt start/completion is one attempt; retries are separate attempts');
assert.equal(report.attempts.kinds['drafting:repair'], 1);
assert.equal(report.attempts.kinds['drafting:retry'], 1);
assert.equal(report.outcomes.providerErrors, 1);
assert.equal(report.outcomes.draftRejected, 1);
assert.equal(report.outcomes.unknownDurability, 0, 'an explicitly recorded terminal skip is a known outcome');
assert.equal(report.reasons.validation_rejected, 1);
assert.equal(confirmedCount(ledger), 0, 'accepted draft, validation and terminal skip cannot confirm publication');
reject(ledger, { ...base, eventId: 'kind-conflict', stage: 'drafting', attemptId: 'draft-1', kind: 'repair', verdict: 'accepted', reason: 'accepted' });

ledger.record({ ...base, eventId: 'publish-unknown', stage: 'publication', attemptId: 'send-1', kind: 'initial', verdict: 'UNKNOWN', reason: 'publication_unknown' });
ledger.record({ ...base, eventId: 'durability-unknown', stage: 'durable_outcome', verdict: 'UNKNOWN', reason: 'durability_unknown' });
assert.equal(ledger.report().outcomes.unknownPublication, 1);
assert.equal(ledger.report().outcomes.unknownDurability, 1);
assert.equal(confirmedCount(ledger), 0, 'unknown sends never enter the numerator');
reject(ledger, { ...base, eventId: 'no-evidence', stage: 'publication', attemptId: 'send-2', kind: 'retry', verdict: 'confirmed', reason: 'publication_confirmed' });
reject(ledger, { ...base, eventId: 'empty-evidence', stage: 'publication', attemptId: 'send-2', kind: 'retry', verdict: 'confirmed', reason: 'publication_confirmed', evidence: {} });
reject(ledger, { ...base, eventId: 'false-evidence', stage: 'publication', attemptId: 'send-2', kind: 'retry', verdict: 'confirmed', reason: 'publication_confirmed', evidence: { confirmedPublished: false } });
reject(ledger, { ...base, eventId: 'unverified-durability', stage: 'durable_outcome', verdict: 'confirmed', reason: 'publication_confirmed', publicationEventId: 'publish-unknown' });
ledger.record({ ...base, eventId: 'publish-confirmed', stage: 'publication', attemptId: 'send-2', kind: 'retry', verdict: 'confirmed', reason: 'publication_confirmed', evidence: { publishedId: 'published-id' } });
assert.equal(confirmedCount(ledger), 0, 'publisher confirmation alone does not attest a durable outcome');
ledger.record({ ...base, eventId: 'durable-confirmed', stage: 'durable_outcome', verdict: 'confirmed', reason: 'publication_confirmed', publicationEventId: 'publish-confirmed' });
assert.equal(confirmedCount(ledger), 1);
assert.equal(ledger.report().attempts.publication, 2);
assert.equal(ledger.report().denominator.uniqueObservedEverEligible, 1, 'multiple sends remain one comment');
assert.equal(ledger.report().measurement.publicationDurability, 'unverified_caller_evidence', 'pure recorder cannot verify a checkpoint itself');

const recovered = seed();
recovered.record({ ...base, eventId: 'lost-response-confirmed', stage: 'publication', attemptId: 'resume-1', kind: 'resume', verdict: 'confirmed', reason: 'publication_confirmed', evidence: { confirmedPublished: true } });
recovered.record({ ...base, eventId: 'resume-durable', stage: 'durable_outcome', verdict: 'confirmed', reason: 'publication_confirmed', publicationEventId: 'lost-response-confirmed' });
assert.equal(confirmedCount(recovered), 1, 'existing already-published evidence needs no invented public reply ID');
const other = { ...base, commentId: 'other-comment' };
recovered.record({ ...other, eventId: 'other-discovery', stage: 'discovery', reason: 'observed' });
reject(recovered, { ...other, eventId: 'cross-comment', stage: 'durable_outcome', verdict: 'confirmed', reason: 'publication_confirmed', publicationEventId: 'lost-response-confirmed' });

ledger.record({ ...base, commentId: 'excluded', eventId: 'excluded-discovery', stage: 'discovery', reason: 'observed' });
ledger.record({ ...base, commentId: 'excluded', eventId: 'excluded-policy', stage: 'eligibility', verdict: 'excluded', reason: 'policy_excluded' });
ledger.record({ ...base, commentId: 'legacy', eventId: 'legacy-discovery', stage: 'discovery', reason: 'observed' });
ledger.record({ ...base, commentId: 'legacy', eventId: 'legacy-status', stage: 'eligibility', verdict: 'UNKNOWN', reason: 'legacy_unknown' });
ledger.record({ ...discovered, postId: 'other-post', eventId: 'same-id-other-post' });
assert.equal(ledger.report().uniqueObserved, 4, 'platform/post/comment tuple defines identity');
assert.equal(ledger.report().denominator.intentionalExclusions, 1);
assert.equal(ledger.report().denominator.unknownEligibility, 2, 'legacy skips invent no past policy exclusion');

for (const reason of COVERAGE_REASONS) {
  const candidate = new CoverageLedger(scope);
  assert.equal(candidate.record({ ...discovered, reason }), 'recorded');
}
for (const patch of [
  { reason: 'error: private patient text' }, { prompt: 'secret' }, { commentText: 'private' },
  { reply_text: 'draft' }, { access_token: 'secret' }, { postId: 'https://private.example/token' },
  { eventId: '__with whitespace' }, { at: '2026-09-30T00:00:00Z' }, { at: '2026-09-31T00:00:00.000Z' },
  { at: scope.endedAt }, { platform: 'facebook' }, { stage: 'made_up' },
]) reject(seed(), { ...discovered, ...patch });
reject(seed(), { ...discovered, stage: 'eligibility', verdict: 'maybe' });
reject(seed(), { ...base, eventId: 'private-evidence', stage: 'publication', attemptId: 'send', kind: 'initial', verdict: 'confirmed', reason: 'publication_confirmed', evidence: { confirmedPublished: true, params: { text: 'secret' } } });
reject(new CoverageLedger(scope), eligible);
reject(seed(), { ...discovered, reason: 'hidden' });
assert.throws(() => new CoverageLedger({ ...scope, maxEvents: 100_001 }));
assert.throws(() => new CoverageLedger({ ...scope, endedAt: scope.startedAt }));

const serialized = JSON.stringify(ledger.snapshot());
const restarted = CoverageLedger.restore(JSON.parse(serialized));
assert.equal(JSON.stringify(restarted.snapshot()), serialized, 'serialization and restart preserve event order and exact sanitized metadata');
assert.deepEqual(restarted.report(), ledger.report());
assert.equal(restarted.record(discovered), 'duplicate');
const reversedKeys = Object.fromEntries(Object.entries(discovered).reverse()) as CoverageEvent;
assert.equal(restarted.record(reversedKeys), 'duplicate', 'input key order is irrelevant to identity');
const detached = restarted.snapshot(); detached.events[0].reason = 'hidden';
assert.equal(JSON.stringify(restarted.snapshot()), serialized, 'snapshot mutations do not alter the ledger');
const mutableEvent = { ...base, eventId: 'mutable', stage: 'publication' as const, attemptId: 'mutable-send', kind: 'initial' as const, verdict: 'confirmed' as const, reason: 'publication_confirmed' as const, evidence: { publishedId: 'original' } };
restarted.record(mutableEvent); mutableEvent.evidence.publishedId = 'modified';
assert.equal((restarted.snapshot().events.at(-1) as typeof mutableEvent).evidence.publishedId, 'original');
for (const patch of [{ schema: 2 }, { events: [discovered, discovered] }, { truncated: true }, { droppedEvents: -1 }, { privateText: 'secret' }]) {
  assert.throws(() => CoverageLedger.restore({ ...ledger.snapshot(), ...patch }));
}

const limited = new CoverageLedger({ ...scope, maxComments: 1, maxEvents: 2 });
assert.equal(limited.record(discovered), 'recorded');
assert.equal(limited.record({ ...discovered, eventId: 'over-comments', commentId: 'unretained' }), 'limit');
assert.equal(limited.record(eligible), 'recorded', 'retention does not evict the retained comment');
assert.equal(limited.record({ ...discovered, eventId: 'over-events', pollId: 'poll-3' }), 'limit');
assert.equal(limited.record(discovered), 'duplicate', 'duplicates remain idempotent at the retention limit');
assert.equal(limited.report().uniqueObserved, 1);
assert.equal(limited.report().measurement.truncated, true);
assert.equal(limited.report().measurement.droppedRecorderCalls, 2, 'overflow counts recorder calls, not missed opportunities');
assert.equal(limited.report().measurement.accountCoveragePercent, null);
assert.deepEqual(CoverageLedger.restore(JSON.parse(JSON.stringify(limited.snapshot()))).report(), limited.report());

console.log('PASS coverage ledger: identities/encounters, attempts/retries, holds, sanitized reasons, evidence-gated confirmations, UNKNOWN, deterministic restart and bounded retention; no live hooks or I/O');
