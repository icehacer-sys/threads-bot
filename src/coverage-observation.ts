import { CoverageLedger, type CoverageEvent, type CoverageReason, type CoverageCategory } from './coverage-decisions';
import { replyProviderSnapshot } from './provider-observation';

type Eligibility = Extract<CoverageEvent, { stage: 'eligibility' }>['verdict'];
type Admission = Extract<CoverageEvent, { stage: 'admission' }>['verdict'];
type Recorder = Pick<CoverageLedger, 'record' | 'report'>;

/** Synchronous, bounded memory only. No callback result participates in a bot decision. */
export function createCoverageObservation(ledger: Recorder | undefined, pollId: string, now = () => new Date().toISOString()) {
  let sequence = 0, failedRecorderCalls = 0, limitedRecorderCalls = 0;
  const safely = (observation: () => void) => {
    try { observation(); } catch { failedRecorderCalls++; }
  };
  const record = (postId: string, commentId: string, decision: { stage: 'discovery' } | { stage: 'eligibility'; verdict: Eligibility } | { stage: 'admission'; verdict: Admission } | { stage: 'classification'; verdict: 'reply' | 'skip'; category: CoverageCategory }, reason: CoverageReason) => {
    try {
      if (!ledger) { failedRecorderCalls++; return; }
      const status = ledger.record({ platform: 'threads', postId, commentId, eventId: `${pollId}_${++sequence}`, pollId, at: now(), reason, ...decision });
      if (status === 'limit') limitedRecorderCalls++;
    } catch { failedRecorderCalls++; } // Never copy error text or change exit/retry behavior.
  };
  return {
    discover(postId: string, comments: readonly { id: string }[]) {
      safely(() => { for (const c of comments) record(postId, c.id, { stage: 'discovery' }, 'observed'); });
    },
    eligibility(postId: string, commentId: string, verdict: Eligibility, reason: CoverageReason) {
      record(postId, commentId, { stage: 'eligibility', verdict }, reason);
    },
    admission(postId: string, commentId: string, verdict: Admission, reason: CoverageReason) {
      record(postId, commentId, { stage: 'admission', verdict }, reason);
    },
    classified(postId: string, commentId: string, outcome: { decision: 'reply' | 'skip'; category: CoverageCategory }) {
      safely(() => {
        const { decision, category } = outcome;
        record(postId, commentId, { stage: 'classification', verdict: decision, category }, decision === 'reply' ? 'classified_reply' : 'classified_skip');
        // A returned skip can be policy, a hold, a guard failure or provider error.
        // Its free-text reason is never stored or used to invent an exclusion.
        record(postId, commentId, { stage: 'eligibility', verdict: decision === 'reply' ? 'eligible' : 'UNKNOWN' }, decision === 'reply' ? 'policy_eligible' : 'unclassified');
      });
    },
    deferred(postId: string, comments: readonly { id: string }[], reason: CoverageReason) {
      safely(() => { for (const c of comments) record(postId, c.id, { stage: 'admission', verdict: 'deferred' }, reason); });
    },
    printSummary() {
      try {
        const report = ledger?.report();
        console.log(JSON.stringify({ coverageObservation: {
          scope: 'observed_this_poll', discovery: 'partial', persistence: 'none',
          uniqueObserved: report?.uniqueObserved ?? null, encounters: report?.encounters ?? null,
          unknownEligibility: report?.denominator.unknownEligibility ?? null,
          classifierPositiveComments: report?.denominator.uniqueObservedEverEligible ?? null,
          intentionalExclusions: report?.denominator.intentionalExclusions ?? null,
          deferred: report?.outcomes.deferred ?? null,
          classifierCompletions: report?.classifications ?? null,
          reasons: report?.reasons ?? null,
          failedRecorderCalls, limitedRecorderCalls, truncated: report?.measurement.truncated ?? null,
          // Completion counts do not measure physical provider/draft attempts.
          accountCoveragePercent: null,
          // Cumulative process totals have a different scope from the per-poll counts above.
          replyProvider: replyProviderSnapshot(),
        } }));
      } catch { /* Reporting must not affect successful work or surface unsanitized errors. */ }
    },
    health: () => ({ failedRecorderCalls, limitedRecorderCalls }),
  };
}

export type CoverageObservation = ReturnType<typeof createCoverageObservation>;

/** A new CLI poll cannot claim cross-poll durability or full discovery. */
export function createPollObservation(): CoverageObservation {
  try {
    const start = Date.now();
    const pollId = `poll_${start}`;
    const ledger = new CoverageLedger({ id: pollId, startedAt: new Date(start).toISOString(), endedAt: new Date(start + 86_400_000).toISOString(), discovery: 'partial', maxComments: 10_000, maxEvents: 100_000 });
    return createCoverageObservation(ledger, pollId);
  } catch { return createCoverageObservation(undefined, 'unavailable'); }
}
