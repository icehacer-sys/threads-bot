# Mr. M reply voice correction

Audited the current [scapular mass case](https://www.threads.com/@mdnoteslab/post/DdpBNJzj7FB). The snapshot included ten fixed acknowledgment replies before the 19:25 UTC public answer and five audience replies after it.

The September 23 coverage change replaced model drafts for anything classified as a diagnosis guess with one of six fixed participation acknowledgments. This caused the reported "Thanks for putting a guess in" response and also replaced banter on "Silly Putty Shoulder", a pizza comparison and a shoulder/boulder pun. That implementation was removed.

Replies are now drafted for the actual comment. Fictional diagnoses and food comparisons get banter. Before the reveal, genuine guesses can receive playful non-grading conversation or a general invitation to look again without revealing a feature or verdict. After the reveal, a wrong guess should receive one supported distinguishing observation and the teaching answer when appropriate. The model is still not given the hidden answer before publication. Accepted differentials cannot be dismissed just to create a correction.

The six receipt phrases are retired at both the draft and final sanitizer layers. Unpublished saved receipts are held for review instead of being resumed. Their exemption from duplicate-reply checks was removed. No new canned replacement pool was added. One repair attempt is shared with the existing repair limit.

Other findings: a fried-pickle joke received an unnecessary diagnosis reference, a mom's-kiss joke became a surgery lesson, and a correct guess got the already-disallowed "Nailed it." Strengthened the relevant voice instructions and added a bounded check against the stock praise/"new way to describe" wording.

The two-turn limit, reply coverage, supporters, operating hours and spending cap remain unchanged. Existing public replies were not edited, deleted or given a second response. Their receipts remain intact to prevent duplicates.

Verification: TypeScript, coverage, supporter and concern checks passed. Regression fixtures cover the exact reported jokes, all six retired receipts, repair bounds, pre-reveal answer withholding, post-reveal correction and stock-praise repair. The initial sandbox test failed with `TransformError: spawn EPERM`; the permitted rerun passed. No paid model test calls were used. The local read-only snapshot is `_voice-now.json`.
