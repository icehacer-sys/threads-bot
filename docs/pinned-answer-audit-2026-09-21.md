# Pinned-answer follow-up audit: September 21

The [reported pinned comment](https://www.threads.com/@mdnoteslab/post/Ddhc-hpnQZQ) is the progressive massive fibrosis answer, ID `18105852512238701`. The reply selector already includes its direct replies and follow-ups. There is no policy to ignore this pinned answer.

Three direct replies were unanswered in the saved snapshot:

| Commenter | Question | Verified reason |
| --- | --- | --- |
| jordankingsford | Bereavement story and comparison with a father's unseen lung scan | Unsupported-specifics guard rejected `year`. The supplied history used `6-7yrs` and `9wks`, which the unit matcher did not recognize. |
| crandalln2012 | General question about silica mixed with personal dog-nail dust exposure | Personal-medical classification remained ambiguous after one recheck. The entire comment was skipped instead of separating supported general education from personal risk. |
| skadunkist | Whether dust causes tuberculosis | The drafted answer failed the comma-outside-a-list guard. This was a draft-quality rejection, not an ineligible question. |

The abbreviation matcher now handles numeric yr/yrs, wk/wks and mo/mos in both evidence and generated text. Tests verify that those abbreviations support the corresponding unit while truly unsupported units remain rejected. This is unit validation, not independent confirmation of every number in a story.

The voice and classification recheck now distinguish general education from personal remarks. They permit a supported general answer without assessing the commenter's lungs or recommending individual protective equipment. Bereavement can receive empathy without comparing an unseen scan or inventing clinical differences.

TypeScript, invented-specifics and concern regressions passed. The three saved skips were selected for one fresh assessment after deployment, preserving reply receipts and existing safety checks. The punctuation rule remains unchanged. No paid test calls were needed for this fix, and no replies were manually published.

The cap-day was at an estimated $0.9649494 of its $1.25 daily budget at inspection. The medical reserve had begun filtering low-value comments, but these three recorded skips had the specific causes above. No spending cap was increased. Live reconsideration can still be held if the result is unsupported or the remaining budget is exhausted.

Evidence: local `pinned-audit-2026-09-21.json`, `pinned-state-2026-09-21.json` and completed reply runs `35537387532` and `35537703473`.
