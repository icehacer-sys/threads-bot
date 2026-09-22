# Latest-post reply audit: September 23

Audited the [September 22 knee challenge](https://www.threads.com/@mdnoteslab/post/DdmcJFDiUFF), its public answer and the full conversation returned by Threads. The initial snapshot contained 64 audience comments and 35 with a visible account reply. These include nested comments, so 29 unanswered does not mean 29 missed original comments. Snapshot API spend was $0.6456981; the later saved state recorded $0.669287. These are bot estimates for the cap-day, not a provider billing statement.

## Findings

| Finding | Evidence and action |
| --- | --- |
| Selective coverage was deliberate | Minimum length, a low-value reserve filter, value ranking, model noise skips and omitted audience-to-audience nested comments reduced coverage. Coverage mode now includes short reactions, understandable non-English comments and nested comments. Responses remain in English. |
| Back-and-forth had no useful small limit | The previous ancestry walk allowed roughly six exchanges. The new limit is two bot replies per participant per original thread: first response plus one follow-up. A different participant gets their own allowance. Both API replies and persisted receipts count, with a second check before processing siblings in the same poll. |
| Guesses were held until reveal | Owner requested acknowledgment before the answer drops. All identified diagnosis guesses now receive neutral participation wording independent of correctness and independent of the hidden answer. No grading, repetition of the diagnosis, hints or clinical explanation. The secret answer is absent from the pre-reveal model request. One reply per comment remains enforced, so an acknowledgment is not automatically followed by a second response to the same comment after reveal. |
| Caption and age context differed | The public caption said "from birth" without stating current age. The publisher's internal condition specifies infant/newborn, and its generic takeaway says newborn. The bridge passed that takeaway as case evidence. Several public replies used newborn framing without acknowledging what readers were told. The bridge now excludes the generic takeaway and the reply guard requires caption support for newborn/current-age claims. |
| Unsupported patient outcomes | One reply stated "They couldn't walk on it which is part of why it gets caught at birth." Others asserted detection at birth and a best chance of correction. The provided public case does not record walking ability, detection timing or an outcome. Added a targeted history guard and clearer instructions to state missing information honestly. |
| Some published replies sounded repetitive | Several jokes reused missing manuals, assembly instructions and quality control, often with "definitely" or "clearly". Added a focused voice instruction against that repeated construction and against questions used merely to extend an exchange. Existing punctuation rules remain. |
| Valid comments failed draft checks | Logs show prose-dash failures, overlong short-guess replies and repetition holds. These checks remain protective. Coverage now requests a brief relevant response and applies the existing single bounded repair to harmless low-engagement skips for everyone. It does not force an unsafe or invalid draft to publish. |
| Anatomical foot was mistaken for a unit | A reply about the foot could trip the distance check. Plain anatomical "foot" and "foot view" no longer count as an invented measurement. Numeric and clearly worded lengths are still checked. |
| Latest image needs review | An existing anatomy concern remains open. The saved publisher QA contains opposing descriptions: the blind read describes posterior displacement/flexion while the final rationale describes anterior displacement/hyperextension. The intended infant context does not itself resolve that disagreement. The bot's image-dependent medical reply hold remains active. |
| Review holds were wasting calls | Completed logs show the same blocked comments being reclassified on successive polls. A persisted review-wait marker now prevents model calls until the anatomy review is resolved. The real public reveal state is also kept separate from the image hold instead of incorrectly telling the model the already-published answer is still private. |
| Earlier workflow stopped on state persistence | Run 35776298755 stopped after a Git push failure, with public writes halted by the checkpoint safeguard. Its successor resumed and saved further state. This audit preserves that safeguard and deploys by stopping the old worker before syncing and pushing. |

## Coverage and cost boundaries

First responses rank ahead of follow-ups. Within those groups the two named supporters retain priority, followed by older unanswered comments. Coverage mode removes the low-value reserve filter and permits quality review up to the existing daily API cap. It bypasses the cumulative 220-per-post soft limit while retaining the configured 250 daily reply cap. It does not increase the $1.25 API cap or change the 22:00-10:00 Cairo window.

Literal 100% automatic coverage cannot be guaranteed: spending limits, spam, unreadable media, personal medical boundaries, authenticity questions, unresolved image concerns and failed quality checks can still stop a reply. Unknown or cyclic thread ancestry also blocks publication rather than risking a runaway exchange. Closed conversations are excluded before model calls. No additional paid model tests were used in this audit.

## Verification

Passed TypeScript, coverage, concern handling, supporter, invented-specifics, GIF/media, caption-wording and publication-recovery checks. The new offline coverage tests include nested and answer comments, multiple participants, sibling comments in the same poll, lagging API receipts, missing ancestry, bounded repair, correct/wrong guesses receiving answer-independent wording, review holds and mnemonic exclusion.

Initial typecheck failed with TS7022 for two unannotated traversal locals; explicit types resolved it. A new measurement regression initially failed because "a foot view" still counted as a distance; narrowing the measurement context resolved it. No lint/build result is claimed.

## Not changed or certified

Deployment recovery released three cached comments for a fresh attempt: veveheart's "Flamingo Syndrome", bluecrab74's "Supplied by MFI" and purpleautist's assembly joke. Seven medical comments repeatedly blocked in the completed logs were explicitly marked waiting for image review, preserving their ability to be reconsidered after the review is resolved without paying to reassess them each poll. Existing reply receipts were preserved.

- Existing public comments and the caption have not been edited or deleted.
- The current image is not newly certified, regenerated or released from its review hold.
- Anatomy-dependent cached skips are not mass-released while that hold is active.
- Paid API limits and normal operating hours remain unchanged. More coverage can use more of the existing allowance.
- Unrelated local scripts and the publisher repository were not modified.

Evidence is retained locally in `_latest-audit.json`, `_latest-run.log` and the saved GitHub state. The initial full conversation, including media URLs, is an audit snapshot and not a claim that every comment's media was visually reviewed.
