# Caption sarcasm audit: September 14, 2026

## Reported exchange

The [supplied share link](https://www.threads.com/share/BAWlCat9kf/) resolves to [gan2925d's comment](https://www.threads.com/@gan2925d/post/DdPR__llXSF). A fresh read-only Threads API snapshot confirmed its parent post and reply.

- Comment: `"an open V-shaped metal object with a small coil” ! Really?`
- Bot: `Right? That's the kind of detail that makes you do a double take at the monitor.`
- Comment ID: `17899558572372633`.
- Bot reply ID: `18135863161651064`.
- Parent: [September 13 safety-pin case](https://www.threads.com/@mdnoteslab/post/DdPRNoYmvxp).
- Comment time: 22:11 Cairo. Reply time: 22:15 Cairo, before the answer reveal.

The commenter quoted the caption's elaborate description and questioned its wording or obviousness. The bot instead treated the comment as surprise at the scan. This agrees with the owner's interpretation. The reply missed the target of the criticism and added a generic reaction.

The refreshed conversation contained 107 entries. Incoming comments were reviewed for nearby context. This focused audit does not certify every clinical statement in that conversation.

## Cause and changes

The intent schema instructed the model to determine what a comment "LITERALLY" meant and treated plain-looking questions as genuine questions. That instruction protected casual medical questions but pushed too hard against rhetorical questions and dry criticism. The voice lacked an explicit distinction between criticism of the writing and reactions to the case.

The updated intent instruction first identifies the target: case/image, caption, earlier reply or personal experience. It then distinguishes genuine questions, sarcasm, mock praise and criticism. The voice now calls for a brief acknowledgment of writing criticism without defensiveness, invented excuses, diagnosis recaps or explanations of the joke.

A conservative contextual detector recognizes a quoted caption phrase of at least four words followed only by a skeptical reaction, plus a small set of explicit writing criticisms. It does not treat a bare "Really?", unrelated quotation or substantive clarification question as established sarcasm. Broader sarcasm recognition remains the model's job.

For that narrow context, the draft must stay within 12 words and avoid scan-surprise templates and clinical-answer categories. A failed draft receives at most one repair shared with existing style, evidence, story and media repairs. Persistent failures become cached skips. Reveal and authenticity safeguards remain active. There is no new default escalation or extra model call for a passing reply.

## Verification

TypeScript and the wording, GIF, concern, publishing, audit and voice checks passed. Fixtures cover the original public failure, the overly long draft found during testing, quoted-caption variants, genuine questions, one shared repair, cached failures and pre-reveal/operator boundaries.

Six paid draft-only calls used the configured Haiku model and actual case image with the original pre-reveal context. All six identified writing criticism. Two were held by the existing pre-reveal safeguard. An early overlong response led to the new length backstop. The final observed draft passed after normal cleanup:

`That reads like a furniture assembly manual.`

A related movie-trailer sarcasm test produced:

`Radiology doesn't need the cliffhanger treatment.`

These are observed drafts, not prescribed stock replies. No test replies were posted. Total estimated model usage was $0.027515 across six calls. Provider billing is authoritative. Offline tests incurred no model charges.

## Scope and remaining limits

Existing public comments and the case caption were not edited or deleted. The patch changes future reply interpretation. Sarcasm remains context-dependent and an uncertain or unsafe draft can still be held. A passing fixture is not proof that every future sarcastic comment will be understood.

The local evidence consists of `wording-audit-2026-09-14.json` and four `wording-draft-check*.json` files in the session artifact directory. The final observed result is in `wording-draft-check-observed-2026-09-14.json`.
