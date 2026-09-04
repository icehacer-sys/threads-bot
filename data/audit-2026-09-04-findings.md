# Engagement audit — findings and experiment queue

Source data: `data/audit-2026-09-04.md` (86 mature challenge posts, 90-day window).
North star: gross follows per 100K non-follower viewers. Guardrail: median views per post.

---

## Phase 2 — Findings

### 1. The engagement decline is MIX, not rate. Your content did not get worse.

Per-post medians, age-controlled at 72h:

| window | n | median views | **median int/1k** | aggregate int/1k |
|---|---|---|---|---|
| last 30d | 23 | 69,069 | **7.61** | 1.75 |
| prior 30d | 28 | 59,877 | **8.05** | 3.05 |
| 60–90d | 35 | 408,022 | 2.46 | 1.15 |

The typical post engages within 5.5% of where it was a month ago (8.05 → 7.61). The *aggregate*
rate fell 43% (3.05 → 1.75) purely because a handful of mega-reach, near-zero-rate posts dominate
the view denominator.

**The Insights panel's "interactions +0.1% while views +38.7%" is a distribution artifact.** There
is no content-quality regression to fix.

### 2. Reach and engagement rate are almost perfectly inversely related.

Spearman **rho(views, interactions per 1k views) = −0.953** across 86 posts.

| reach quintile | n | median views | median int/1k | median replies |
|---|---|---|---|---|
| Q1 (low) | 18 | 15,267 | **19.10** | 141 |
| Q2 | 18 | 41,643 | 10.47 | 207 |
| Q3 | 18 | 110,420 | 4.70 | 224 |
| Q4 | 18 | 677,442 | 1.75 | 360 |
| Q5 (high) | 14 | 2,156,293 | **0.77** | 783 |

141x more views buys **5.5x** more comments. Rate falls **25x**. The top 2 posts took 23.7% of all
views but produced only 15.0% of all interactions.

This is not a fixable inefficiency — it is what happens when the algorithm pushes medical content
into Cats-of-Threads and Mom-Threads feeds. Reach past a point is actively dilutive.

### 3. Absolute comment count does scale — weakly. rho = +0.679.

More reach genuinely does bring more comments in absolute terms. Reach is not worthless; it is
just far less valuable per unit than it looks.

### 4. The answer resolves the guessing game at minute 21, on every single post.

Our own reply offsets in the first 90 min, across all 10 sampled posts, contain a reply at
**21 minutes** every time — `BOT_ANSWER_DELAY_MIN=20` in `xray-poster/publish.yml` firing reliably.
The other clusters (12–16, 29–31, 46–48, 62–64, 77–80 min) are this bot's 15-minute poll batches.

The guessing mechanic — the thing that produces the comments — is terminated 21 minutes in.
Everything after that is people reading an answer rather than generating one.

### 5. Reply latency does NOT affect whether people reply back. Negative result.

612 reconstructed pairs, median latency 11.3 min:

| latency | pairs | replied back | rate |
|---|---|---|---|
| 0–5 min | 124 | 41 | 33.1% |
| 5–15 min | 290 | 77 | 26.6% |
| 15–30 min | 157 | 51 | 32.5% |
| 30–60 min | 30 | 10 | 33.3% |
| 1–3 h | 11 | 3 | 27.3% |

Flat across every bucket. **This kills the "tighten the poll cadence" experiment** — it would cost
API budget and buy nothing measurable. Leave the taper alone.

### 6. Publish hour is confounded beyond rescue. The experiment is the only way.

July h22 n=25, August h22 n=26 — the modern era is effectively 100% 22:00 Cairo. The 21:00 posts
are 12 of 14 from June, when median reach was 216K against 60K now. Hour cannot be separated from
era. **No within-sample signal exists for 15:00–18:00**, exactly as predicted.

### 7. The follow spike tracked reach — but possibly not proportionally.

23 Aug carried **2,386,756 views = 24.7x the 96,570 median**, the largest reach day inside the
Follows-chart window. The ~245/day follow spike sits on top of it, so follows look reach-driven.

**Open question worth 60 seconds in the app:** 27 Aug hit 1,861,680 views (19.3x median) — only
22% less reach — yet the Follows chart appears to show only a ~40–55/day bump there against 23
Aug's ~245. If that holds when you read the chart precisely, reach is *necessary but not
sufficient*, and 23 Aug had something extra worth copying. My chart-date reading is eyeballed off
a 30-day sparkline and must be confirmed before anything is built on it.

### 8. The hook pattern that separates over- from under-performers.

Same reach tier, opposite outcomes:

**Over-performers** — a concrete visual puzzle with a spatial contradiction:
- 17 Aug (52.4/1k): bullet nowhere near the entry wound
- 3 Jul (27.9/1k): something snagged going down
- 6 Aug (**2.07/1k at 1.7M views — 2.7x its quintile**): a malformed twin skeleton inside a baby

**Under-performers at high reach** — vague chronic symptoms:
- 26 Jun (0.18/1k): "grumbling ache in the upper belly ... brushed off as indigestion"
- 21 Jun (0.46/1k): "ordinary bloating and a bit too much gas"
- 29 Jul (0.50/1k): newborn choked and turned blue

Vague relatable symptoms are exactly what the algorithm broadcasts to everyone, and exactly what
nobody has anything to say about. Reply-to-like ratio confirms it: over-performers run 1.27–2.32
(people typing), under-performers 0.15–0.69 (people tapping past).

**6 Aug is the single best template in the dataset** — the only post that held a decent rate at
mega reach.

### Data anomalies — do not build on these

| date | views | likes | replies | note |
|---|---|---|---|---|
| 2026-06-26 | 2,552,002 | **15** | 430 | 15 likes on 2.55M views is not plausible |
| 2026-06-24 | 49,022 | **4** | 418 | same shape |

Both June-era and outside the current window. Sanity-check in the app before trusting any June
aggregate.

---

## Phase 3 — Experiment queue

Ranked by the north star (follow conversion), then by evidence strength and cost.
One at a time, alternating arms nightly, medians not means.

### KILLED before running

**Reply-cadence tightening.** Finding 5 shows a flat reply-back rate across every latency bucket.
No change to the taper in `reply.yml`.

---

### 1. Answer delay — highest leverage, one env var, now evidenced

**Hypothesis:** the answer landing at minute 21 truncates the guessing window that produces the
comments, so delaying it lengthens the thread.

**Metric:** median replies per post, and median interactions per 1k views. Win = +15% median
replies with no median-views regression.

**Design:** nightly alternation, 14 nights per arm. Stop early if median views drops more than 30%
for four consecutive nights in either arm.

**STATUS: LIVE** as of commit `55ef1d7` in `icehacer-sys/xray-cases`.

- Arm A (even day-of-year): answer +20, CTA +75 — exact status quo
- Arm B (odd day-of-year): answer **+90**, CTA **+145**

B is 90 rather than the 180 first drafted. 90 already clears the ~first-hour window Threads uses to
judge reach — the actual mechanism — while keeping the Gumroad CTA at 00:25 Cairo instead of 01:55,
where it would land on a sleeping audience half the nights.

**`BOT_CTA_DELAY_MIN` must move with the answer delay.** `xray-poster/src/config.ts:141` throws on a
reversed or equal pair, and a throw means nothing publishes that night at all. Verified: 20/75 and
90/145 both load, 180/75 throws.

**Prior art:** the owner set this to 45 on 2026-07-03 for exactly this reason (see the comment at
`config.ts:31`) and reverted to 20 the next day. One night is not a test, but the reason for the
revert is unrecorded.

**Second answer mechanism — resolved, not a confounder.** This repo's `BOT_ANSWER_DELAY_HOURS: "1"`
path is dormant: `src/index.ts:1036` requires an `answers.json` entry with a `breakdown`, and only 2
of 4 entries have one. Nightly posts are never added, and xray-poster's `Answer:` reply trips
`answerFromConversation()` before the bot's own path fires. `answeredPostIds` holds exactly 1 id
across the whole history, confirming it. **Watch item:** if a breakdown is hand-added to
`answers.json` during the experiment, the bot could post at +60 and contaminate an arm-B night.

**No arm logging needed** — the answer's own offset from the post (+21 vs +90) is measurable from
the API, so the data self-labels. The audit's "Answer mechanisms" table reads it directly.

### 2. Hook specificity — the mechanism behind rho = −0.95

**Hypothesis:** hooks built on a concrete spatial contradiction hold their engagement rate at high
reach; vague-chronic-symptom hooks buy cold reach that never converts.

**Metric:** interactions per 1k views, compared **within reach quintile** so the comparison is not
just re-measuring reach. Win = B arm beats its quintile median by >1.5x consistently.

**Design:** 14 nights per arm, alternating. A = current caption generation. B = constrained to a
visible spatial contradiction, modelled on 6 Aug.

**Change:** caption generation in `xray-poster` (`src/captions.ts`). House style applies to any new
hook copy — no commas outside genuine lists.

Reference shapes that worked (all published, all in-voice):

> A patient came in with a gunshot wound to the thigh yet the bullet was nowhere near the entry point.

> A patient came in with a baby with a slowly growing belly mass since birth.

### 3. Follow CTA — the north-star metric, never once tested

**Hypothesis:** 5.3M strangers see the post and are given no reason to follow, which is why the
rate is 0.032%.

**Metric:** gross follows per 100K non-follower viewers, read off the Follows chart per arm.
Win = any sustained lift above the ~35/day baseline on non-spike nights.

**STATUS: LIVE** alongside the answer-delay experiment, crossed as a balanced 2×2.

**Placement changed from the original spec.** This section first said "appends one line to the
answer post." Reading the code, that was the worst of the options: the answer is 500-char budgeted
and already drops "Why it matters" under pressure, its timing is being varied by the answer-delay
experiment, and it reaches only the fraction who open the thread. The line goes in the **challenge
caption** instead — the only surface the ~5.3M non-follower viewers actually see. Longest observed
caption is 353 chars, so there is 147 chars of headroom.

> A new case goes up every night. Follow so you catch tomorrow's before the answer drops.

**Orthogonal parity, so the two live experiments do not confound:**

| | parity | arm B |
|---|---|---|
| answer-delay | `doy % 2` | answer +90, CTA +145 |
| follow-CTA | `(doy / 2) % 2` | follow line appended |

Verified balanced over 28 nights: 7 per cell, 14 per main-effect arm. Each main effect pools all
28 nights; the four cells estimate any interaction.

**Applied at POST time** (`xray-poster/src/index.ts`, via `withFollowCta()`), never at generation
time — `generated.threadsCaption` is drafted days ahead and cached in `case.json`, so gating it
during generation would label the drafting night rather than the publishing night.
`withFollowCta()` skips silently rather than truncating if the line would overflow 500.

**Measurement — now real, not eyeballed.** `followers_count` turns out to be API-available (as a
bare snapshot, no history), so `src/followersnapshot.ts` + `.github/workflows/followers.yml`
snapshot it daily at 18:00 UTC — exactly 1h before the 19:00 UTC post, so each delta brackets one
post's full response window. Deltas give net follower change; unfollows sit on a flat ~135–150/day
floor, so net + that floor proxies gross follows.

Account-level daily `views` **is** a real time series and is captured alongside, because net change
is dominated by reach — a 2.4M-view night swamps a ~20/night CTA effect. Control for views before
comparing arms.

Rough power: unfollow SD is ~12/day, so 14 nights per arm gives SE ≈ 3.2. A 20/night effect is
detectable; a 5/night effect is not.

**Prior art / risk:** the owner reverted a caption-format experiment (case number, difficulty,
layperson question, reveal line) on 2026-07-04 after those posts underperformed — see the comment
at `captions.ts:43`. This is a much smaller change (one appended line, format otherwise untouched),
but it is the same class. **Watch the median-views guardrail**: if arm-B nights lose reach, Meta is
demoting the follow ask and the experiment should stop.

### 4. Post time — worth doing, but rank it last

Highest theoretical value, but the audit **cannot** support it with within-sample evidence
(finding 6), and it is by far the most operationally dangerous change.

**Metric:** median views and median interactions per 1k views. **Design:** 14 nights per arm,
22:00 vs 16:00 Cairo.

**The 7 coupled settings — missing one silences the bot during its own peak:**

| # | File | Setting | Now |
|---|---|---|---|
| 1 | `xray-poster/.github/workflows/publish.yml:70` | `BOT_POST_HOUR_UTC` | `19` |
| 2 | `xray-poster/.github/workflows/publish.yml:71` | `BOT_ANSWER_DELAY_MIN` | `20` |
| 3 | `.github/workflows/reply.yml` | `BOT_ACTIVE_WINDOWS` | `22-10` |
| 4 | `.github/workflows/reply.yml` | `BOT_ACTIVE_START` / `BOT_ACTIVE_END` | `22` / `10` |
| 5 | `.github/workflows/reply.yml` | taper thresholds in the poll loop | `22`, `2`, `5`, `10` |
| 6 | `.github/workflows/reply.yml` | idle branch `nap=$(( (22 - ch) * 3600 ...))` | hardcoded `22` |
| 7 | `.github/workflows/reply.yml` | `BOT_WINDOW_HOURS` | `16` |

**DST trap:** `BOT_POST_HOUR_UTC` is pinned in UTC, so 19:00 UTC becomes 9 PM Cairo at late-October
DST — roughly 7 weeks out. Any new hour must be reasoned about in Cairo and the DST shift diarised,
or the post drifts an hour mid-experiment and corrupts both arms.

---

## Re-running

```
npx tsx src/engagementaudit.ts --days=90 --latency=10
```

Each run writes a dated `data/audit-<date>.md`. Because per-post insight history does not exist
retroactively, running this weekly is the only way to build the T+24h time series that would make
future audits sharper. `_audit-raw-<date>.json` carries commenter usernames and stays gitignored —
this repo is public.
