# September 20 reply audit and supporter priority

## Snapshot

Audited the [September 20 case post](https://www.threads.com/@mdnoteslab/post/DdhSmjIHad9), published at 22:02 Cairo. The saved snapshot contained 89 conversation entries and 25 owner replies excluding the answer. All returned reply text and available parent comments were read. Two owner entries lacked a parent in the returned snapshot. Comments arriving later are outside these snapshot counts.

The punctuation audit found no violations and no emoji in the 25 replies. Repetition analysis connected seven clinical replies through shared phrases and finding lists. Repeated diagnostic terminology alone is not a defect, but several one-word guesses received unnecessarily similar full explanations.

## Findings

- **Unsupported blame:** `self-inflicted dust` assigns fault without case evidence. The response about why care was delayed also asserted `Denial and adaptation` without a recorded history establishing that explanation.
- **Invented personal context:** the fragment `Inhaled talcum powder as a baby.` was treated as the commenter's own health history. The reply began `That's a worrying start for your lungs` and added an unsolicited future-risk claim. In a diagnosis challenge the fragment can instead be a proposed cause for the case.
- **Overexplaining guesses:** multiple fungal/asbestos guesses received the same upper-lobe-mass and calcified-node summary. Corrections should use the supported answer and at most one useful clue. Genuine questions still need a substantive response.
- **Extra claims in jokes and stories:** rock-salt and alien jokes acquired medical comparisons. A personal autopsy story acquired invented quoted dialogue. The voice now explicitly discourages these additions.
- **Good elements:** several brief jokes addressed their actual premise. The previously requested comma, semicolon and sentence-transition rules held in this snapshot.

The occupational exposure context and relationship between silica and tuberculosis risk are consistent with [CDC/NIOSH information](https://www.cdc.gov/niosh/silica/symptoms/index.html). That does not establish a confirmed diagnosis or exclusion of infection in an individual image. This is a reply audit, not a new certification of the image or every clinical claim.

## Supporters

The owner requested consistent replies to `tgeorgekoshy` and `ruth.werner.9` and explicitly selected normal hours rather than 24/7 operation.

Ruth's `Gotta be fungal. Aspergillosis ?` comment, ID `18369322597242554`, was unanswered and present in the persisted skip list at inspection. No comment from `tgeorgekoshy` appeared in the initial snapshot. Release Ruth's specific skip for a fresh assessment during deployment, subject to duplicate checks and the already-public answer.

Both exact usernames now rank first. Short comments and emoji are eligible. They bypass the low-value reserve filter and soft per-post cap. A harmless model skip based only on low engagement gets one reconsideration, shared with all other repair limits. Persistent failed drafts remain cached rather than billed on every poll. The bot is instructed to respond naturally without announcing priority, inventing familiarity or upselling.

Daily/API caps, medical advice boundaries, unrevealed-answer holds, image-review holds and duplicate protection remain. The policy applies on posts the bot normally scans during 22:00-10:00 Cairo; it does not promise an immediate or unrestricted response to every possible comment.

## Implemented reply checks

New checks reject the observed blame phrases and assumed second-person medical history without first-person context. Short guess affirmations/corrections over 24 words get one redraft. Voice instructions address unsupported motivation, invented dialogue, stock correction praise and unsolicited alternate-exposure risk claims. Broader semantic accuracy still depends on model judgment and supplied evidence.

TypeScript plus supporter, concern, GIF, wording, publishing and invented-specifics regression checks passed. Runtime configuration documentation was regenerated. Draft-only API checks were performed; test drafts were not published. The normal live bot remains responsible for actual replies after deployment.

The existing public replies and case caption were not edited or deleted. Local snapshot and draft evidence are in the session artifact directory as `replies-audit-2026-09-20.json` and `supporter-draft-check*.json`.
