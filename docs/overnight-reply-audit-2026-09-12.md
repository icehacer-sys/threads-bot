# Overnight reply audit: 11–12 September 2026

## Scope and verdict

Post `18114371644992668`, odontogenic keratocyst of the mandible, published 2026-09-11 19:02 UTC (22:02 Cairo). Pulled the full conversation through the configured Threads account and reviewed all 72 visible bot replies with their parent comments at full length. Attached media was not visually reviewed. Deleted content cannot be reconstructed.

This is the first complete night running the punctuation and clinical-routing changes from `6dfef12`, which landed 2026-09-11 17:05 UTC, roughly two hours before the post went up.

Verdict: **the 09-11 fix worked, and it worked completely on the thing it targeted.** Every punctuation rule that failed last audit now holds at zero violations across 72 replies. Clinical accuracy is sound and the invented-detail failure mode is largely closed. What remains is a different problem the fix did not address and was not meant to: the replies are now clean but heavily templated, and the emoji crutch has migrated rather than gone away.

## Regression against the 10–11 September findings

| Check | 10–11 Sep | 11–12 Sep | Status |
| --- | --- | --- | --- |
| Replies containing a comma | 43 of 83 (52%) | **0 of 72** | Fixed |
| Semicolons | 1 | **0** | Fixed |
| Prose dashes | present | **0** | Fixed |
| Full stop followed by And/But/Which | 8 | **0** | Fixed |
| Invented detail on a personal story | multiple | 1 borderline | Largely fixed |
| Missed jokes | multiple | 1 mild | Largely fixed |
| Clinical claims needing owner review | 7 | **0** | Fixed |

The comma rule going from 52% to zero in one night is the headline. That is the sanitizer and the redraft guard both doing their job, not a lucky sample.

## Clinical accuracy

No reply requires owner review this time. Spot-checked every substantive claim against standard OKC teaching:

- Arises from dental lamina remnants, develops independently of the impacted tooth (#13, #50) — correct.
- Enucleation with curettage of the cavity walls, impacted tooth removed at the same sitting, remnant lining seeds recurrence (#2) — correct.
- Painless silent growth as a hallmark, high recurrence rate (#3, #32, #67, #69) — correct.
- Correctly declined the ameloblastoma, dentigerous cyst and abscess guesses without hedging into vagueness.

One soft spot worth naming. The night's single most repeated clinical line is that "imaging alone can't separate them" from ameloblastoma. Histology being definitive is correct and safe, but radiographically OKC classically grows antero-posteriorly along the marrow space with comparatively little bone expansion, whereas ameloblastoma expands and blows out the cortex. Imaging does favour one. The statement is a mild oversimplification, and because it is templated it went out **11 times in one night**.

## Findings

### 1. The correction template is back, at 15% of the night

The current `voice-learned.md` **Retire** list already contains "A repeated compare-and-contrast formula on every correction". It is not holding. Eleven replies (#6, #15, #16, #27, #33, #35, #42, #43, #56, #63, #70) are the same sentence machine:

> #6 Close but this one came back as an odontogenic keratocyst. Both wrap around an impacted tooth and look nearly identical on the scan so histology is what calls it.
> #35 Close but it's an odontogenic keratocyst. Both wrap around an impacted tooth and look similar on the scan so histology is what separates them.
> #43 Close but it's an odontogenic keratocyst. Both can wrap around an impacted tooth so they're easy to mix up on imaging and histology is what separates them.

#6 and #35 share 12 word-level 4-grams. These are not the same words in a different order, they are the same shape reskinned, which is exactly what the north star calls the failure. A reader scrolling the thread sees three of these in a row.

The existing audit metric reports "exact duplicate replies: none" and is technically right, which is why this passed unnoticed. There is no near-duplicate detector.

### 2. The 🤣 crutch became the 😭 crutch

| | Rate |
| --- | --- |
| 🤣 last night | 0.0% (historical baseline 31.7%) |
| 😭 last night | **36.1%** (26 of 72) |
| 😭 in trailing position | **34.7%** (25 of 72) |

The old problem was a laugh emoji tacked onto a third of replies, almost always trailing. That is still precisely true, at a slightly higher rate, with a different glyph. 25 of the 26 sit at the end of the line.

This is not a new discovery. The changelog flagged "😭 overtaking 🤣 as the new emoji crutch" on **2026-07-15** and again on **2026-07-27**. It has since dropped out of the active notes, which now carry only the much weaker "Use emoji sparingly, particularly on sincere comments". The specific finding decayed into a vague one and the behaviour returned.

The `_lastnight.ts` metrics block measures 🤣 and trailing-🤣 explicitly and does not measure 😭 at all, so the dashboard reads clean while the tell is at 36%.

### 3. Opener concentration

| Opener | Count |
| --- | --- |
| Starts with "That..." | 25 of 72 (35%) |
| Starts with a demonstrative or stock word | 51 of 72 (71%) |
| "That's the..." | 5 |
| "Close but" | 4 |
| "Right?" as opener | 4 |
| "Worst place/flavor..." | 3 |

Seven in ten replies open the same structural way. Varying the words inside a fixed frame is the template failure one level down.

### 4. One unestablished duration

#18, to a commenter who wrote only "Xenomorph-pital":

> That jaw definitely looks like it hosted something extraterrestrial for **seven years**.

Nothing establishes seven years. The post text gives no duration. The figure comes from the swallowed-gum folklore running through other comments (#45, #53), where it is grounded because those commenters raised gum themselves. Here it leaked across to an unrelated comment and reads as an asserted fact about the patient.

Related but defensible: #28 answers a commenter who said "I can't remember if there was a graft but it did fill in" with "Glad the removal and bone fill worked out". "Bone fill" tracks "it did fill in", but it leans toward the graft detail the commenter explicitly disclaimed. Worth watching, not a violation.

### 5. Engagement is at the low end of normal, not collapsed

Last night landed 10 of 72, **14%**. For a real comparison I measured the raw unsampled rate on the last seven case posts:

| Date | Replies | Landed | Rate |
| --- | --- | --- | --- |
| 2026-09-11 | 72 | 10 | **14%** |
| 2026-09-10 | 83 | 14 | 17% |
| 2026-09-09 | 108 | 31 | 29% |
| 2026-09-08 | 132 | 22 | 17% |
| 2026-09-07 | 82 | 24 | 29% |
| 2026-09-06 | 44 | 6 | 14% |
| 2026-09-05 | 38 | 12 | 32% |

14% is the joint lowest of the seven against a mean near 22%, but 2026-09-06 matched it and the spread is wide. One night is not a trend.

Note that the landed rates quoted in `voice-changelog.md` (typically 19–33%) are **not** comparable to these. `balancedSample` round-robins across `day:signal` buckets, and "no-followup" is one bucket among six, so replies that drew a follow-up are over-represented by construction. Those numbers describe the coach's sample, not the night.

## Recommended changes

Not implemented. These follow from the findings above and are ordered by value.

1. **Add a near-duplicate detector to the audit metrics.** Shared word-4-gram count between reply pairs on the same post catches the correction cluster that "exact duplicates: none" misses. Cheap and offline.
2. **Generalise the emoji metric from 🤣 to any emoji, with trailing position tracked separately.** The current metric is pinned to the specific glyph that was the problem in July, so it cannot see the same behaviour wearing a new face.
3. **Re-sharpen the notes rather than adding a rule.** The 😭 finding and the correction-formula retirement both already existed and both decayed. The problem is note durability, not note absence. Over-constraining `voice.ts` risks the humanness the north star prioritises.
4. **Consider an opener-diversity check per post.** 71% demonstrative openers is measurable and would have flagged this night.
5. **Soften the "imaging can't separate them" line** to something like "imaging narrows it but histology calls it", which stays safe and stops asserting something a radiologist would push back on.

## Validation limits

One post, one night, 72 replies. The punctuation result is strong because the rules are mechanical and the sample is uniform. The engagement figure is a single night against a seven-night baseline and should not be read as a trend. Attached media was not reviewed, so replies to image and GIF comments were judged on text alone. The near-duplicate and opener statistics are computed on normalised text and will differ slightly from a human reading. No reply was edited or deleted during this audit.
