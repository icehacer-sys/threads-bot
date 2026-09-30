# Reply lifecycle ledger: offline slice

This draft adds a standalone recorder and report contract, not live end-to-end instrumentation. `src/coverage-decisions.ts` has no imports, I/O, timers, model calls or policy decisions. The orchestrator, classifier, publisher, runtime state schema, prompts and schedules are unchanged. No historical state is imported or migrated.

## Base and release dependency

The branch is stacked on [PR5](https://github.com/icehacer-sys/threads-bot/pull/5), checkpoint repair head `3e94c075f6b4876e1f2321d13b528ccd8b62838e`. Its draft PR targets `codex/fix-checkpoint-contention` so the diff contains only this slice. Keep it draft. Do not release before PR5 and the separate recovery/owner gate; do not merge it into the checkpoint repair as part of recovery.

## Metrics contract

- A cohort has an explicit half-open UTC event window, an opaque identifier and a discovery declaration. `complete_in_scope` means only the declared observed scope; it never means account-wide coverage. The recorder cannot independently verify the declaration.
- Identity is `(platform, postId, commentId)`. Only an explicit discovery creates a comment record. First/last observation timestamps derive from discovery events, never publication counters.
- Encounters are unique `(identity, pollId)` observations. A comment on both discovery edges in one poll is one encounter. Repeated polls increase encounters, not the denominator.
- The denominator is unique observed comments explicitly marked policy eligible at least once in that cohort. It remains stable when a later gate holds or excludes a comment. Never-eligible exclusions and unknown eligibility are separate counts; a legacy skip needs an explicit observed record with `legacy_unknown`, not an invented reason or historic discovery timestamp.
- Admission is separate from eligibility. Holds and budget/cap deferrals preserve the eligible opportunity. Reasons are a bounded allowlist; no free-text model reasons, prompts, comment text, draft text, credentials or raw publication parameters are accepted. Unknown fields and malformed identifiers are rejected, rather than stored. Callers must supply opaque system identifiers, not put private text into identifier fields.
- Drafting and publication have separate attempt identities and kinds. Start/completion events count once per attempt; initial, repair, escalation, forced-tool, retry and resume attempts remain distinguishable. A reused attempt cannot change its kind. Existing provider SDK retries will need explicit hooks before they can be measured.
- Every unobserved decision stage is `UNKNOWN` in the per-comment report. Publication `UNKNOWN` is an explicit uncertain send; a missing publication event alone is not evidence of an attempted send. `failed` must only be supplied when existing evidence establishes definite failure.
- A publication confirmation needs the existing publisher's `publishedId` or `confirmedPublished: true`. This accommodates lost-response recovery without inventing a public reply ID. A durable confirmation additionally references a matching prior confirmed publication event for the same identity. Discovery, draft acceptance, counters and publisher confirmation alone never enter that numerator.
- The numerator is named `uniqueEligibleWithRecordedDurableConfirmation`: it counts explicitly recorded caller attestations backed by publication evidence. **This pure recorder cannot verify that an external checkpoint actually succeeded.** Every report labels publication durability `unverified_caller_evidence`. Future live integration must submit the durable event only after the existing persistence/checkpoint operation succeeds, and retain `UNKNOWN` on an uncertain save. Serializing an in-memory ledger is not independent proof of durable publication.
- Outcome and reason buckets can overlap. Reasons count unique comments per code; provider-error counts include errors before later recovery. Latest validation/admission outcomes are separate from ever-eligible cohort membership and any recorded confirmed durable outcome. Account-wide coverage percentage is always `null`.

## Retention, identity and restart

The constructor requires explicit bounds, capped at 10,000 comments and 100,000 events. Existing records are never silently evicted. A rejected recorder call at either bound returns `limit`, sets `truncated` and increments `droppedEvents`. That counter is not a unique-comment count. Reports describe only retained observations and must not be extrapolated to dropped or undiscovered comments.

An event ID is unique across the cohort. Repeating an identical event is idempotent; changing its contents is rejected. Event property order does not affect duplicate detection. Snapshots contain canonical projected fields in insertion order and can be restored deterministically. Events with the same timestamp use insertion order for their latest-stage report. Snapshot and input mutation cannot change stored records. Restore validates the complete schema/history and rejects malformed or duplicate events. The caller owns storage, error handling and cohort rotation; this module never writes `state.json`, a sidecar or a Git checkpoint.

## Verification and remaining integration work

`npm run coverage:decisions:verify` runs synthetic in-memory fixtures. `npm run coverage:verify` includes both the existing behavior regression and this suite, so the unchanged offline PR workflow executes the new checks. Repository typechecking includes the module; the fixture can also be checked explicitly with TypeScript. There is no repository lint command; `git diff --check` checks patch whitespace.

Deferred integration work: expose actual discovery/pagination limits and pre-ranking observations; distinguish policy from admission at each existing gate; instrument recursive draft repairs and forced-tool/provider attempts; observe both new publication and saved-container recovery; bind durable events to successful existing checkpoints; choose metadata persistence and failure handling without changing reply decisions, public-send ordering, holds, skip/retry policies or schedule. None of these live hooks is implemented here. Separately tracked coverage behavior defects remain out of scope.
