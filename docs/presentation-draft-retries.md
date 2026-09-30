# Bounded presentation-draft retries

A punctuation, caption-wording or repetition failure can occur on an otherwise
eligible reply. After the existing shared repair fails, code may mark the result
as a presentation failure. The worker then uses the existing two-strike counter
instead of immediately caching that comment as skipped.

With no prior strike, a later organically scheduled poll may draft again. A marked
failure that brings the shared count to two or more exhausts the allowance and permanently
caches the skip. Previous soft strikes consume the same allowance. This counter is
cumulative by comment ID, not per reason; it is not reset by this change. Committed
threads and escalated attempts use the same limit of two for these marked failures.
Other outcomes retain their existing handling, including the six-strike threshold
for ordinary soft skips on committed threads. This is not a new lifetime limit on
every kind of attempt for a comment.

The internal flag is excluded from both provider schemas. Model reason text
cannot grant it. An actual sanitizer punctuation rejection is tracked internally
before its result is copied. Marking a final failure also requires an original
reply in banter/affirm/empathize, already-public or personal-post context, no
image review or commenter media, and no evidence, clinical or other sanitizer
blocker. The internal safety probe ignores punctuation only to determine later
retry eligibility; its output is never published. Existing rejection objects,
reasons and immediate repair order otherwise remain unchanged.

Medical, safety, authenticity, image-review, pre-reveal and intentional policy
skips retain their current handling. The public-context spoiler proposal is not
implemented. No daily/spend/admission limit, prompt, provider setting or saved
receipt recovery changes. Every later attempt passes the normal guards again;
the rejected draft stays unpublished. A later attempt can include the existing
repair and SDK retries, so this is not a one-extra-HTTP-call or fixed-dollar bound.

No state migration, skipped-ID clearing, hold release or historical replay occurs.
Only comments that normal discovery still admits can receive the allowance.
No new top-level state field is added and the internal flag is not persisted.
Old workers may still cache a presentation failure immediately, so mixed code
versions do not guarantee the later opportunity.

Verify with `npm run draft-retry:verify` (also run by `npm run wording:verify` and
the existing PR offline workflow). The fixtures preload the offline guard and
use only temporary synthetic state and mocked provider/publisher responses.
They cover restart success/exhaustion, prior strikes, committed/escalated paths,
spend/daily limits, saved-container recovery, old skips, forged reasons/fields and
overlapping safety failures. The flag fixture accepts `--baseline-dir` for an
exact-main comparison of unchanged decisions, sanitizer outputs, prompts, request
order and spending apart from the new internal flag.

Reverting the code restores immediate caching on future presentation failures.
It does not undo any reply published by a later attempt or restore subsequently
cached IDs. State reconciliation would require separate authorization.
