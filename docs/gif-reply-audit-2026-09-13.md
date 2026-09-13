# GIF reply audit: September 13, 2026

The two reported replies used nearly the same stock formula and failed to engage with the GIFs' actual meaning. This patch changes future incoming-GIF replies and records the evidence needed to investigate future failures.

## Scope and evidence

Read all 48 entries in the saved conversation snapshot for the [September 13 safety-pin challenge](https://www.threads.com/@mdnoteslab/post/DdPRNoYmvxp), including 23 bot replies and the account's answer. The challenge was posted at 22:04 Cairo time. This is a snapshot of tonight's conversation, not a claim to cover comments added after collection.

The two supplied [first share link](https://www.threads.com/share/BAd_YDLyOi/) and [second share link](https://www.threads.com/share/BAVrEdtBfI/) could not be opened by the web tool. The configured Threads API supplied the conversation and original GIF URLs instead. Both GIFs successfully produced four distinct frames using the production extraction functions. Representative frames were visually inspected.

| Commenter | Public bot reply | What the GIF actually conveys |
| --- | --- | --- |
| staringispolite | That's the face everyone makes when they see what came back on the X-ray. | Escalating shock as a man pulls at his eyes and face. A brief shared reaction fits better than commentary about everyone's face. |
| swearymichigander | That's the exact face for discovering a safety pin was never actually safe. | A man saying "THAT'S NOT SAFE AT ALL". The words are the premise. The reply should answer that claim. |

The local reproduction shows readable media. It does not establish which frames reached the model during the original run. Original model-routing details could not be recovered from the queried cancelled run. Missing-media and budget fallback weaknesses were additional code findings, not proven causes of these two historical replies.

## Other findings

The 23 replies passed the punctuation audit: no prose commas, semicolons, disallowed dashes or sentence openings with And/Which were detected. There were no emojis. The broad repetition detector found one shared-phrase pair but missed the short repeated GIF formula. Specific media regression checks now cover it.

Some tiny emotional comments received excessive case narration. Examples included "about as bad as it gets" and "every parent's nightmare and then some." Another reply invented a general claim about what nobody expects to see twice. The voice now discourages amplified fear and unsupported generalizations under brief reactions. These automated checks are not a clinical certification or a guarantee of human taste.

## Changes made

- Route readable incoming GIF/video frames directly to the configured quality model. Remove the initial cheap draft and automatic second escalation from that route. Disable automatic web search for it.
- Use a short conversational prompt for textless reaction GIFs. Supply their actual frames without case summaries, the post X-ray or previous clinical replies that repeatedly pulled test drafts into medical narration. Written questions accompanying media retain the full context. Internal reveal and safety checks still retain the original case information.
- Require private structured fields for visible action, on-screen words, interpreted meaning and confidence before accepting a media reply.
- Reject the observed face-template family, generic performance commentary and case narration. Keep bare reactions to at most 12 words. Detect exact recently used drafts and provide lightweight opening-variety cues without copying previous medical replies into the prompt.
- Allow at most one shared repair across media, style, evidence and story checks. Cache persistent failures so each poll does not buy another draft for the same rejected comment.
- Skip unreadable textless media or an unavailable quality budget before purchasing a model draft. Keep existing budget thresholds and medical reserve unchanged.
- Log frame counts, routing and private media interpretation for future audits.

## Verification and cost

Offline checks passed for TypeScript, media regressions, concerns, publishing, audit, voice and budget behavior. Media fixtures cover both original public failures, one-pass routing, no automatic search, missing-media zero-call behavior, bounded repairs, repetition, reveal protection and context retention for written questions.

Iterative live draft-only checks used the two actual GIFs. The final pair correctly interpreted both and completed in one model call each:

- Shock GIF: "Yeah that one does not get easier to look at."
- Unsafe GIF: "Yeah \"not safe\" might be the understatement of the year."

These drafts were not posted. An additional opening-variety cue was added after that pair and verified offline. It was not separately evaluated with another paid call.

All seven pairs of iterative checks used 17 model calls with estimated usage of $0.3090534. The final pair alone cost an estimated $0.0202779. These are token-based estimates; provider billing is authoritative. They are testing costs, not a promise about every future GIF's cost. A rejected draft can still consume a paid call, with one bounded repair where appropriate.

## Remaining limits

Existing public replies were not edited or deleted. No test drafts were published. This patch changes the reply service and does not regenerate or recertify scheduled case images. Future ambiguous GIFs can still be skipped and naturalness remains variable. A fresh production GIF conversation is needed to assess audience response after deployment.

Local evidence is saved under the session artifact directory as `gif-audit-2026-09-13.json`, extracted frame folders and seven `gif-draft-check*.json` outputs. The final accepted pair is in `gif-draft-check-isolated-2026-09-13.json`.
