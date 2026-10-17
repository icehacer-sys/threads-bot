# Runtime configuration

Generated from tracked source. This does not read or print credentials, local .env values, or GitHub secrets. Workflow overrides take precedence over defaults. Shell assignments are listed as source expressions, not evaluated values.

## Configuration declarations

```ts
const raw = (process.env.BOT_ACTIVE_WINDOWS ?? "").trim();
return [[num("BOT_ACTIVE_START", 0), num("BOT_ACTIVE_END", 24)]];
const raw = (process.env.BOT_REPLY_PROVIDER ?? '').trim().toLowerCase();
if (raw) throw new Error(`BOT_REPLY_PROVIDER must be claude, hybrid or deepseek (got "${raw}")`);
return (process.env.BOT_DEEPSEEK_TRIAL ?? 'off').toLowerCase() === 'on' ? 'hybrid' : 'claude';
evalReplay: (process.env.BOT_EVAL_REPLAY ?? 'off').toLowerCase() === 'on',
evalPreReveal: (process.env.BOT_EVAL_PRE_REVEAL ?? 'off').toLowerCase() === 'on',
evalDeepSeekAll: (process.env.BOT_EVAL_DEEPSEEK_ALL ?? 'off').toLowerCase() === 'on',
model: process.env.BOT_MODEL ?? "claude-sonnet-5-5",
triageModel: process.env.BOT_TRIAGE_MODEL ?? "claude-haiku-4-5-20251001",
escalateCategories: (process.env.BOT_ESCALATE ?? "correct,teach,reference")
escalateMedia: (process.env.BOT_ESCALATE_MEDIA ?? "motion").toLowerCase(),
voiceVariant: (process.env.BOT_VOICE ?? "lean").toLowerCase(),
dailyUsdCap: num("BOT_DAILY_USD", 1.25),
escalateUsdCap: num("BOT_ESCALATE_USD", 0.875),
medicalReserveUsd: num("BOT_MEDICAL_RESERVE_USD", 0.31),
reserveMinValue: num("BOT_RESERVE_MIN_VALUE", 2),
antiRepeatWindow: num("BOT_ANTIREPEAT", 30),
priorityUsernames: (process.env.BOT_PRIORITY_USERNAMES ?? "tgeorgekoshy,ruth.werner.9").split(',').map(s => s.trim().replace(/^@/, '').toLowerCase()).filter(Boolean),
webSearch: (process.env.BOT_WEB_SEARCH ?? "off").toLowerCase() === "on",
windowHours: num("BOT_WINDOW_HOURS", 0),
heldRevisitHours: num("BOT_HELD_REVISIT_HOURS", 72),
maxPostsScanned: num("BOT_MAX_POSTS", 5),
newestOnly: (process.env.BOT_NEWEST_ONLY ?? "off").toLowerCase() === "on",
pinnedPostIds: (process.env.BOT_PINNED_POSTS ?? "")
replyAll: (process.env.BOT_REPLY_ALL ?? 'on').toLowerCase() !== 'off',
maxThreadReplies: Math.max(1, Math.min(3, Math.floor(num('BOT_MAX_THREAD_REPLIES', 2)))),
selection: (process.env.BOT_SELECTION as Selection) ?? "recent",
dailyCap: num("BOT_DAILY_CAP", 250), // Threads' ~250/day ceiling is the hard backstop
perPostCap: num("BOT_PER_POST_CAP", 220), // hard cap on total replies per post; sits below the daily cap
minCommentLength: num("BOT_MIN_COMMENT_LEN", 3),
educationalReplies: (process.env.BOT_EDUCATIONAL ?? "on").toLowerCase() !== "off",
answerEnabled: (process.env.BOT_ANSWER ?? "on").toLowerCase() !== "off",
answerDelayHours: num("BOT_ANSWER_DELAY_HOURS", 1),
answerUseSpoiler: (process.env.BOT_ANSWER_SPOILER ?? "off").toLowerCase() === "on",
visionEnabled: (process.env.BOT_VISION ?? "on").toLowerCase() !== "off",
activeTz: process.env.BOT_ACTIVE_TZ ?? "",
activeStart: num("BOT_ACTIVE_START", 0),
activeEnd: num("BOT_ACTIVE_END", 24),
xrayCasesRawBase: (process.env.BOT_XRAY_CASES_BASE ?? "https://raw.githubusercontent.com/icehacer-sys/xray-cases/main").replace(/\/+$/, ""),
facebookReply: (process.env.BOT_FACEBOOK_REPLY ?? "off").toLowerCase() === "on",
fbMaxPosts: num("BOT_FB_MAX_POSTS", 5),
fbStateFile: process.env.BOT_FB_STATE_FILE ?? "./fb-state.json",
gifReplies: (process.env.BOT_GIF_REPLIES ?? "off").toLowerCase() === "on",
gifChance: num("BOT_GIF_CHANCE", 0.5), // probability gate on a model-flagged banger
gifMaxPerPost: num("BOT_GIF_MAX_PER_POST", 1), // hard: never a second GIF on one post
gifMaxPerDay: num("BOT_GIF_MAX_PER_DAY", 2),
promoReplies: (process.env.BOT_PROMO ?? "on").toLowerCase() !== "off",
promoMaxPerPost: num("BOT_PROMO_PER_POST", 1), // hard: never a second LINK on one post
promoMaxPerDay: num("BOT_PROMO_PER_DAY", 2), // link-frequency is the main spam signal; kept low (owner, 2/day). Product MENTIONS (no link) are not capped here.
lateSweep: (process.env.BOT_LATE_SWEEP ?? "off").toLowerCase() === "on",
lateSweepAt: (process.env.BOT_LATE_SWEEP_AT ?? "21:30").trim(),
lateSweepMax: Math.max(0, Math.min(20, Math.floor(num("BOT_LATE_SWEEP_MAX", 15)))),
lateSweepUsd: num("BOT_LATE_SWEEP_USD", 0.15),
clinicianNod: (process.env.BOT_CLINICIAN_NOD ?? "off").toLowerCase() === "on",
ownerReviewExpiryHours: num("BOT_OWNER_REVIEW_EXPIRY_HOURS", 48),
stateFile: process.env.BOT_STATE_FILE ?? "./state.json",
confirmLive: (process.env.BOT_CONFIRM_LIVE ?? "").toLowerCase() === "yes",
```

## reply.yml

```text
- cron: "*/30 * * * *" # heartbeat to (re)start the polling loop; the loop does its own tapering cadence
BOT_CONFIRM_LIVE: "yes"
BOT_EDUCATIONAL: "on"
BOT_NEWEST_ONLY: "on" # reply only to the single newest post (focus the night on tonight's fresh case, not the sword)
BOT_PINNED_POSTS: "17986874135820855" # pinned intro thread (DY_tUxfiMUb): ALSO scanned every run, replying to any un-replied comment. Comma-separated media ids or post URLs. Find ids with: npm run dry -- --list
BOT_WINDOW_HOURS: "16" # scan only the day's fresh post: 16h excludes the prior day's post (~21-24h old at window open) so the bot focuses on today's, not yesterday's tail
BOT_VISION: "on"
BOT_ANSWER: "on"
BOT_ANSWER_DELAY_HOURS: "1"
BOT_ANSWER_SPOILER: "on"
BOT_ACTIVE_TZ: "Africa/Cairo"
BOT_ACTIVE_WINDOWS: ${{ github.event.inputs.window || '22-10' }}
BOT_ACTIVE_START: "22"
BOT_ACTIVE_END: "10"
BOT_PER_POST_CAP: "220" # sits below the 250 daily cap, leaving headroom for the pinned-thread replies; still covers a viral hit (461-comment post)
BOT_DAILY_CAP: "250" # Threads' ~250/day ceiling is the hard backstop
BOT_VOICE: "lean" # consolidated brand voice (same rules, ~20% fewer prompt tokens). "full" reverts to the original voice-full.ts with no code change.
BOT_REPLY_ALL: "on" # include brief reactions and nested comments within the hard daily caps
BOT_MAX_THREAD_REPLIES: "3" # one initial response plus two follow-ups per person per original thread (owner 2026-10-02; code caps at 3)
BOT_DAILY_USD: "1.60" # raised from 1.25 on 2026-10-02 with the switch to full DeepSeek mode (about a tenth of the Claude cost per reply)
BOT_ESCALATE_USD: "1.12" # 70% of the cap: past this, DISCRETIONARY escalations (reference / media lookups) stop. correct+teach keep escalating up to BOT_DAILY_USD.
BOT_MEDICAL_RESERVE_USD: "0.31" # kept at 0.31 (about 19% of the 1.60 cap) so ordinary comments still get replies until 1.29; reserved for medical replies. Added 2026-08-24 after a night where the flat gate held 16 correct/teach comments unanswered from 00:15 Cairo while cheap banter kept posting on the rest of the budget.
BOT_RESERVE_MIN_VALUE: "2" # inside the reserve, only comments scoring >=2 on the value heuristic are triaged at all (questions, long stories); one-word quips and guesses are dropped un-triaged, costing nothing.
BOT_ESCALATE_MEDIA: "motion" # GIF/video frames go directly to one quality read; no cheap fallback when the quality budget is unavailable.
BOT_REPLY_PROVIDER: "deepseek" # owner 2026-10-02, cost: DeepSeek writes every reply incl. corrections, teaching and commenter media; Claude only for web-search lookups and DeepSeek failures. Rollback: "hybrid" (or "claude")
BOT_MODEL: "claude-sonnet-5-5" # quality model: corrections/teaching and direct GIF/video reads
BOT_TRIAGE_MODEL: "claude-haiku-4-5-20251001" # cheap first pass outside direct motion-media routing
BOT_ESCALATE: "correct,teach,reference" # categories the Haiku triage hands to Sonnet
BOT_ANTIREPEAT: "30" # replies the model sees as ALREADY POSTED so it doesn't repeat toppers/corrections. Raised 15->30 on 2026-07-08 after a 101-reply night repeated toppers >15 apart (modest uncached-token cost, worth it on viral nights)
BOT_WEB_SEARCH: "on" # search runs ONLY on the Sonnet "reference" re-run (unrecognized memes/refs), never on triage
BOT_FACEBOOK_REPLY: "off" # FB dropped — Threads only (owner deleted the Page over the "AI info" label, 2026-07-03). fbindex early-returns when off; flip to "on" to restore.
BOT_GIF_REPLIES: "off" # bot-posted reaction GIFs KILLED by owner (2026-07-07) — text replies only. (Reading COMMENTER GIFs is unaffected; that path stays on.)
BOT_GIF_CHANCE: "1" # no coin flip — when the model tags a banter reply and caps allow, attach the GIF (owner, 2026-07-04 moderate loosening; was 0.5). Volume is bounded by the model's tag rate + the 1/post, 2/day caps
BOT_PROMO: "on" # RARE product plug (data/products.json). The reply NAMES the product in-voice on a genuine opening; the raw LINK is attached ONLY when the commenter explicitly asks for it (ask-only links, to keep spam/reach risk low). Never on medical/tender/corrections.
BOT_PROMO_PER_POST: "1" # hard: never a second LINK on one post
BOT_PROMO_PER_DAY: "2" # link-frequency is the main spam signal; kept low
BOT_LATE_SWEEP: "on"
BOT_LATE_SWEEP_AT: "21:30"
BOT_LATE_SWEEP_MAX: "15"
BOT_LATE_SWEEP_USD: "0.15"
BOT_CLINICIAN_NOD: "on" # owner 2026-10-17: one short facts-only nod per post to the strongest clinician read, after the reveal. Rollback: "off"
BOT_OWNER_REVIEW_EXPIRY_HOURS: "48" # owner 2026-10-17: owner-review items queued more than 48h ago auto-expire at poll time. 0 disables
echo "rebase failed (attempt $attempt/3), retrying in 3s"; sleep 3; continue
echo "push failed (attempt $attempt/3), retrying in 3s"; sleep 3
if [ "${BOT_LATE_SWEEP:-off}" = "on" ]; then
```

## voicelearn.yml

```text
- cron: "0 9 * * 1" # Mondays 09:00 UTC (12 PM Cairo)
BOT_LEARN_MODEL: "claude-sonnet-5"
BOT_LEARN_DAYS: "7" # matches the weekly cron — at 3 the audit paid for a weekly run but only ever saw 3 of the 7 days
BOT_LEARN_MAX_PAIRS: "150"
git pull --rebase --autostash origin "${GITHUB_REF_NAME}" || { git rebase --abort 2>/dev/null || true; sleep 3; continue; }
git push && { synced=true; break; } || { echo "push failed ($attempt/3)"; sleep 3; }
```

## followers.yml

```text
- cron: "0 18 * * *" # daily, 1h before the challenge posts
git pull --rebase --autostash origin "${GITHUB_REF_NAME}" || { git rebase --abort 2>/dev/null || true; sleep 3; continue; }
git push && { synced=true; break; } || { echo "push failed ($attempt/3)"; sleep 3; }
```
