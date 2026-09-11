# Overnight reply audit: 10–11 September 2026

## Scope and verdict

Fetched the full available conversation for coin case 18103023326210157 through the configured Threads account. The snapshot contains 284 entries. The overnight cutoff is 10:00 Cairo on 11 September: 216 entries comprising 131 reader comments, 83 visible bot replies and two publisher stages. The persisted bot counter is 84 because the deleted story response remains recorded. Reviewed the full text of every overnight reply and reader comment plus completed worker logs. Attached media was not visually reviewed. Deleted content cannot be reconstructed completely from the current conversation.

Verdict: more tweaking was needed. Successful posting and improved sentence length did not establish consistent voice or clinical accuracy.

## Findings

- 43 of 83 visible replies contain commas. Most are prose joins rather than lists.
- Eight contain a full stop followed by And. One contains a semicolon.
- 33 mention batteries. Many repeat praise about the right fear or instinct instead of making a short correction.
- Some banter misses the joke: "Time for a battery of tests" received an endoscopy explanation.
- Personal stories receive invented details or conclusions: a decade, a comparison with an unseen scan, or congratulations for knowing what to look for.
- Clinical explanations were labeled affirm, banter or empathize and therefore could bypass the category-based quality pass.
- 48 overnight reader comments have no visible bot reply. This includes the deliberately deleted response, repeated short guesses, low-value reactions, reader-to-reader exchanges, substantive comments requiring review and comments deferred by the late-night budget reserve. Not all should receive a response.
- The bereavement comment about losing a childhood friend has fewer than 80 characters and no question. The old score left it below the reserve threshold. Length alone is an inadequate proxy for importance.
- The final recorded overnight model spend was $1.0696954. That includes replies, skipped classifications and quality passes. Several empty polls show $0.0000. Exact savings from the reveal cache have not been established.

## Changes

1. Replaced the prior permission for normal prose commas with the owner's latest rule: commas only in explicit lists. No semicolons, prose dashes or sentence transitions beginning And/Which after punctuation.
2. Added a conservative posting guard. Ambiguous comma uses are redrafted instead of mechanically turned into periods. Lists of three or more short items with a final and/or are recognized. Write numbers without comma separators.
3. A rejected draft gets one bounded style recheck on the same configured model. A second failure is empty and cached rather than retried each poll. This can add one model call for a failing draft; the audit and regression checks themselves use no paid model calls.
4. Both final outgoing text and unpublished saved drafts are checked. Previously published replies are not automatically replaced.
5. Added content-based routing for clinical terminology in affirm/banter/empathy drafts so they receive the existing clinical quality pass. The existing budget still applies. This detector is a backstop, not a complete medical claim extractor.
6. Added explicit guards for the observed unsafe airway and battery-imaging claims plus tighter prompt instructions against invented clinical details and repetitive battery praise.
7. Prioritized short loss stories in candidate scoring and the reserve gate. The overall budget and polling cadence are unchanged.

## Published replies needing owner review

| Reply ID | Problem |
| --- | --- |
| 18026143793916614 | Places the halo/double-ring sign on the lateral view |
| 18340100272267158 | Infers that breathing is fine and says the object cleared the airway |
| 17992278731844153 | Affirms a windpipe guess and adds an unsupported airway narrative |
| 17945442579292836 | Invents a panorex projection and says a crisp disc rules out a battery |
| 18041677541824580 | Calls the object a quarter without established denomination |
| 17949168585264721 | Certifies the need for a rigid scope and compares an unseen personal scan |
| 18097939871157756 | Predicts recurrence and tells the reader they will know what to look for |

The [National Capital Poison Center guideline](https://www.poison.org/battery/guideline) places the halo/double-rim sign on the AP view and the step-off on the lateral view. It also warns that a step-off may not be visible. The guard and prompt preserve that distinction; no retroactive public correction was posted during this audit.

## Validation limits

Offline checks cover allowed lists, blocked punctuation, bounded style rechecks, clinical routing, specific unsafe claims, personal-story handling and publication safeguards. They do not certify all future replies as medically correct or human-sounding. Further live examples are needed to measure style compliance, meaningful engagement and the cost of occasional style retries. The raw conversation and full comment inventory are kept locally rather than committed into the public repository.
