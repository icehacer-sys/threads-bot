# Independent re-audit of the jaw case and Claude's changes

Reviewed 12 September 2026. Post: https://www.threads.com/@mdnoteslab/post/DdKHbSNjxEb

## Scope

Read all 195 entries returned by the full conversation endpoint: 120 reader comments, 73 owner replies, the answer and the CTA. This is a later snapshot than Claude's 72-reply audit. Read all available text including reader-to-reader exchanges and unanswered comments. Inspected the saved image associated with the published case and checked its SHA256 against the recorded approval: 5fb924737a8d2c9c6ad2520a1d1c13c9afd70411f63239148a2f6b7b6629a7a3. This is not a pixel comparison against the platform's recompressed image. Reader media attachments were not visually assessed. A reply has a missing parent in the API response. Deleted content cannot be reconstructed from this snapshot.

## Verdict

Claude's punctuation findings are supported. The blanket clinical clearance is not. The image supports a differential discussion rather than dismissal of every ameloblastoma answer. The most serious reply failure is invented case confirmation: no biopsy result is present in the case record, but the bot wrote that the diagnosis came back on histology.

The previous image approval was too confident for a single-answer quiz. Confirming that requested findings appear does not establish that the intended label is the best supported diagnosis.

## What Claude changed

Commit 6c47cc1 added src/reply-metrics.ts, an offline regression verifier, a package command and audit/handoff documents. No live reply prompt or posting behavior changed in that commit. The module measures shared word sequences and emoji usage. The local ignored _lastnight audit script contains integration that is not distributed through the repository.

The repetition verifier passed. Applying the metrics to this snapshot found 28 candidate similar pairs and connected groups of 17 and two replies. These are review candidates, not proof that every grouped reply is bad: shared clinical phrases can be legitimate and connected components can join dissimilar endpoints. Twenty-six replies contain the crying emoji and 25 end with it. The audit module is useful, but it is not a live repetition guard.

## What the readers actually said

- Eleven reader comments mention ameloblastoma or a close spelling. Some offer it alone and others explicitly include OKC in a differential. Several provide substantive reasoning rather than just contradicting the answer.
- edd56md describes the posterior mandibular location, multilocular soap-bubble appearance and impacted tooth. A follow-up discusses expansion and tooth displacement. flower21214 independently describes a similar differential.
- pappawood47 writes: "Ameloblastoma, but need path confirmation". The bot responds: "Close but it's an odontogenic keratocyst..." without evidence that pathology had been obtained.
- adooranz asks in Indonesian: "Itu di perjelas dengan AI gak sih". Approximately: "Was that enhanced/clarified with AI?" This is specifically an enhancement question. It is not evidence that the commenter identified a particular anatomical defect.
- lnart_dxi writes only "IA". This plausibly refers to artificial intelligence but the two-letter comment is ambiguous.
- jasminepoppyjackson remarks that the other teeth are perfect. brendakatalinich calls them a fantastic mouthful of teeth. tower737guy remarks on healthy teeth and gums. These are observations, not explicit accusations.
- Other discussions concern whether the swelling could be painless, CT and oral-surgery assessment, tooth displacement, treatment, personal experiences and jokes. Do not collapse those into AI accusations or hostility.

## Image and differential

The saved image visibly emphasizes a large rounded multilocular lucency in the posterior mandible/ramus with prominent internal partitions and displacement of an unerupted tooth. Those cues explain the ameloblastoma guesses. Buccolingual expansion cannot be reliably measured from this single two-dimensional image.

The case's own [cited radiology review](https://link.springer.com/article/10.1007/s13244-018-0644-z) describes overlap between multilocular OKC and ameloblastoma. Multiple septa and greater expansion/displacement can favor ameloblastoma; OKC more often extends along the bone with less expansion. Histology establishes the tissue diagnosis. This does not make either label certain from this image.

The fair conclusion is that ameloblastoma is a defensible differential. The evidence does not justify an exclusive confirmed OKC answer or an automatic relabeling as confirmed ameloblastoma.

## Why the image may have raised AI suspicion

Observed visual features: unusually uniform detail in the remaining teeth, crisp outlines across much of the image, a very cleanly compartmentalized lesion and pervasive fine bone texture. My impression is that the overall presentation looks more polished and diagram-like than an ordinary clinical panoramic image. That is a visual assessment, not proof of a specific impossible structure.

The strongest audience evidence concerns exceptional image clarity and perfect-looking teeth. The comments do not establish a specific duplicated tooth or impossible bone as the giveaway. Repetitive replies and unsupported certainty may separately weaken credibility, but nobody in this snapshot explicitly says those were the reason for their AI suspicion.

## Replies that need review despite the earlier clearance

| Reply ID | Finding |
| --- | --- |
| 17895045699670469 | "came back ... on histology" invents case-specific test confirmation |
| 18045229052820105 | "this one came back as..." implies an established result absent from the record |
| 18125169079695189 | Dismisses a reasoned ameloblastoma differential by asserting the intended answer |
| 18457532719185053 | Repeats categorical correction of a plausible differential |
| 18106584548238055 | Rejects a reader who explicitly says pathology confirmation is needed |
| 17877363177547256 | Adds a categorical same-session tooth-removal claim not supplied in the case facts |
| 18074619404404867 | Blanket agreement that repeating scans adds dose for no reason overstates what the discussion establishes |
| 18136897561715120 | Invents a seven-year duration in an unrelated joke |

The original record says specialist assessment and histology guide treatment. It has no biopsy report, no operative result and no established duration. A generally plausible medical statement is not evidence that it happened in this case.

## Root causes and recommended priorities

1. Represent diagnosis certainty and confirmation evidence explicitly. An intended teaching label must not become a claimed pathology result. Block invented biopsy, surgery and outcome claims.
2. Treat supported alternative diagnoses as a differential. For this case a defensible correction would be: "Ameloblastoma is a reasonable differential here. This image alone does not confirm an odontogenic keratocyst." This draft has not been published.
3. Add an image review that asks for plausible competing diagnoses before revealing the intended label. The current required observations are multilocularity and an impacted tooth. Both can be satisfied without discriminating OKC from ameloblastoma.
4. Judge clinical fidelity and acquisition consistency. Cosmetic sharpness is not a quality guarantee. Do not solve the concern by inventing provenance or adding fake clinical defects.
5. Keep Claude's metrics and make the audit runner reproducible. Use the repeated-reply candidates to review formulaic wording rather than automatically reject all shared clinical language.
6. The handoff records a separate preference to stop dental cases and says the generator exclusion was not implemented. This re-audit has not independently implemented or approved that change.

## What was and was not changed

This turn fetched the conversation, inspected the image and code, checked the cited literature, ran the offline repetition verifier and saved this report plus a complete local comment inventory. No paid model calls were made. No public reply was posted, edited or deleted. Production prompts, case labels, images, schedules and budgets were not changed during this re-audit.
