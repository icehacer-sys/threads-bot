# Reply voice and cost audit, 11 September 2026

Reviewed the completed live worker 34527404735 and its persisted publication records for the coin case. This is an editorial review of actual replies, not a paid model evaluation or a clinical certification.

## Findings

The voice is uneven. Short replies such as "That's the one" work. Longer replies often stack praise, an explanation and a joke, which sounds formulaic. Some add facts unsupported by the known answer. The formatter also actively damages otherwise natural punctuation.

| Actual output or behavior | Assessment | Change |
| --- | --- | --- |
| "Coin it is. And yeah. Battery risk is real. Which is why..." | Choppy and unnecessarily long for a short guess | Preserve commas; ask for connected sentences and brief acknowledgments |
| "This one turned out to be a coin. Still. Ruling out..." | The isolated transition sounds mechanical | Remove the comma-to-period conversion |
| "Four days of poo inspection... commitment to currency recovery... digestive gauntlet" | Responds to the story but stacks elaborate metaphors | Ask for one simple response to the shared detail |
| "The internal button warranty expires at 45... every radiologist's diagnosis note..." | Overwritten joke with an invented medical flourish | No added backstory, clinical lesson or generalized experience in banter |
| "Quarter's the call" | The known answer is a coin; denomination was not established | Explicitly prohibit embellishing the answer's specificity |
| "...kid's panorex... crisp on X-ray, which rules out battery..." | Adds an unsupported projection and diagnostic inference | Explicitly forbid these unsupported inferences; explanations belong in teach/correct |
| Repeated held guesses sent to the model before the reveal | Avoidable repeated classification spending | Persist the hold and bypass classification until the actual reveal or a text edit |

## Implemented

- Normal commas, conjunctions, quoted speech and numeric punctuation survive sanitization. Numeric en-dash ranges become hyphenated ranges; prose dashes become commas instead of new sentences.
- The shared voice used by both full and lean settings now favors connected prose, contractions, brief replies, one joke at most, and sincere story responses.
- Medical explanations must not be disguised as affirmations or banter. Existing accuracy and review requirements remain in force.
- Reveal holds survive worker restarts and are filtered before candidate ranking, leaving room for fresh comments.
- The workflow syncs main before the first live poll to avoid loading a stale publication history after a queued restart.

## Verification and limits

Typechecking and offline punctuation, concern/story, voice-policy, and audit regression checks passed. The reveal-hold regression also passed, including twelve simulated checks with no reclassification, restart persistence, release after reveal, and reconsideration after a text edit.

No paid voice evaluation was run. These checks prove the formatting and hold behavior, not that every future model reply will sound natural or be clinically correct. Prompt changes reduce the observed tendencies but do not guarantee factual grounding. Previously published replies were not edited or deleted; the projection/diagnostic inference and denomination examples above remain owner-review items.

The approximately $0.30 previously reported was total model spending at that checkpoint, including eight recorded replies and skipped decisions. The exact share spent on repeated holds was not separately established. Polling remains at the existing cadence and the configured budget is unchanged. Savings should be measured from subsequent runs, not asserted in advance.
