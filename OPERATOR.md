# Reply bot operations

The active service reads Threads comments and drafts replies in the account's written voice. It does not synthesize speech. Workflow overrides set the Cairo active window to 22:00-10:00 and enable Haiku triage with selected Sonnet escalation. See the [generated configuration](docs/runtime-config.md) for exact declarations and active overrides.

## Reply policy

Regular supporters `tgeorgekoshy` and `ruth.werner.9` receive first priority within the normal 22:00-10:00 Cairo hours. `BOT_PRIORITY_USERNAMES` overrides this exact, case-insensitive list. Their short reactions are eligible even below the usual minimum length and they bypass the low-value reserve filter and soft per-post cap. Friendly low-engagement model skips receive one bounded reconsideration. Daily/API limits, deduplication, reveal holds, owner-review holds and medical safeguards remain active. There is still no 24-hour scanning; the only out-of-window activity is the limited late sweep below. Verify with `npm run supporters:verify`.

### Late sweep (owner approved 2026-10-17)

The 2026-10-17 audit found 21% of comments arrive after the 10:00 Cairo window closes and were never seen. With `BOT_LATE_SWEEP=on` (default off in code, on in `reply.yml`) the worker lands one poll at `BOT_LATE_SWEEP_AT` (21:30 Cairo, kept in sync with `LATE_SWEEP_LEAD=1800` in the poll step) and runs one sweep per cap-day of the PREVIOUS night's post (the newest post, 12 to 36 hours old). It considers only comments that arrived after the window closed plus in-window comments that a guard or model skip left unanswered, and only genuine case questions and personal or family stories (`src/late-sweep.ts`). Jokes, political comments, AI remarks, bot questions, owner-review items, already-replied comments and the three-turn thread limit are excluded before any model call, and a draft that comes back as banter is skipped. Every normal guard, the public reveal state, receipts and the replied log still apply, so a comment is never answered twice. The sweep stops at `BOT_LATE_SWEEP_MAX` (15) replies or `BOT_LATE_SWEEP_USD` ($0.15) of spend. 21:30 sits on the same 12:00-to-12:00 cap-day as the night that opens at 22:00, so the sweep's replies and spend come out of tonight's daily caps (15 of 250 replies; on DeepSeek about $0.03). The pre-open credit check still runs at 21:55. Preview offline with `npm run dry -- --late-sweep`. Turn it off with `BOT_LATE_SWEEP: "off"` in `reply.yml`; like every env change it takes effect at the next hand-off. Verify with `npm run coverage:verify`.

### Guards, repairs and voice register (2026-10-17)

The deterministic draft guards (`deepSeekPolicy` in `src/reply.ts`) now run for every served model, not only deepseek-flash; only the pre-reveal hold stays DeepSeek-specific. Political comments and AI-provenance remarks are skipped before any model call (AI remarks are queued for owner review). Internal wording, brightness, organism taxonomy, invented teaching contrasts and affirming a finding only the commenter named each get one concrete rewrite before a skip. A DeepSeek transport error is retried once per poll, a comment that still fails is answered on the fallback alone, and the cap-day breaker trips only after two failed comments in one poll (`BOT_DEEPSEEK_TRIP_FAILURES`); every uncertain attempt is still charged $0.35 conservatively and only the error class and HTTP status are logged. The owner also loosened the register: one to three short sentences or two to six words, an occasional question back or "!", and about one reply in five may carry one allowed emoji, never on grief, fear, corrections or medical answers. Commas outside lists, dashes, pre-reveal grading and unsupported medical claims stay banned. Verify with `npm run supporters:verify` and `npm run deepseek:verify`.

### Peer conversation (owner-reported 2026-10-17)

`BOT_REPLY_ALL` puts every comment in the flattened conversation into the pool, so the bot used to answer people who were talking to each other. `src/peer-conversation.ts` now checks the addressee before any model call: a reply to another commenter's comment is skipped unless it addresses the account (`@mdnoteslab`, or a direct "OP", "doc" or "Mr M" address); a reply under one of our replies by someone other than the person we answered who is talking to that person (`@them`, or opening with another handle) is skipped; a top-level comment that only tags friends ("@sarah this is you") is skipped. A top-level comment that tags a friend and also makes a guess or asks a question is still answered, and the drafting note says the tag is not for the account. Skips are logged as `peer_conversation` eligibility exclusions, never errors, and stay outside the coverage denominator. The late sweep and the clinician nod follow the same rule.

### Clinician nod and owner-review expiry (2026-10-17)

With `BOT_CLINICIAN_NOD=on` the strongest structured clinician read on a post (credential, modality, findings, impression; `src/clinician-nod.ts`) gets one short facts-only nod after the reveal, once per post. Owner-review items queued more than `BOT_OWNER_REVIEW_EXPIRY_HOURS` (48) ago expire automatically at poll time and the count is logged; an expired image-review item also drops its held comments so that post is not revisited. `npm run reviews` hides expired items without writing state.

Interpret the target of a comment before its tone. Caption criticism and rhetorical questions should receive a short acknowledgment of the writing rather than a reaction to the scan. Narrow quoted-caption cues have a 12-word backstop and share the existing single-repair allowance; genuine clarification questions keep their normal handling. See the [September 14 sarcasm audit](docs/wording-sarcasm-audit-2026-09-14.md). Offline regression command: `npm run wording:verify`.

All diagnosis guesses are held before the answer is public, whether right or wrong. Private answers are not sent to the drafting prompt in that state. After reveal, supported guesses can be affirmed and genuine new questions answered. Prior replies to another reader do not suppress a useful answer to this reader.

Specific image/anatomy concerns may receive one neutral acknowledgment and create a persistent review hold. The bot pauses image-dependent replies until every concern for that post is resolved. Image-provenance and operator questions remain unanswered for owner review. Pending items include the post, comment, reason and time. Use `npm run reviews` to view them. See [concern reply rules and resolution](docs/concern-replies.md). This queue does not send automatic messages or notifications.

Personal symptoms and requests for individual advice receive approved boundary wording at most once per commenter and post. Scan requests receive a fixed decline. The bot does not diagnose, suggest treatment or request private information. Shared experiences remain eligible for brief empathy. Concern acknowledgments have no product plugs, links or GIFs. Product facts elsewhere come from the catalog; links require an explicit request. Outgoing GIF attachments and the Facebook branch remain disabled in the active workflow. Input media may still be read.

## Running and recovery

`npm run dry` can make paid model calls and write drafts or local artifacts. It does not mean no cost or no filesystem changes. Use the offline verification commands below for deterministic checks without public posting. `npm run live` also requires the live confirmation setting.

Do not reset corrupt state to an empty file. Keep the failed file and restore a known-good checkpoint after reconciling remote publications. Receipts are saved before publishing and acknowledged after success; a persistence failure exits with code 4 and stops new writes. Never delete an uncertain receipt merely to force a retry. Git sync failures stop normal handoff, and failure artifacts preserve recovery data.

The publisher remains responsible for its case challenge, answer and CTA. The read-only case bridge supplies source facts and public reveal state. Companion service: [xray-cases](https://github.com/icehacer-sys/xray-cases).

## Budget and learning

Incoming GIFs and video frames use one direct quality-model read with search disabled. Bare GIF reactions receive the actual frames and a concise conversational prompt. Case summaries stay out of that prompt; written questions with media retain the full case context. The model must record the visible action, on-screen words and meaning privately. Unreadable textless media and unavailable quality budget skip without a model call. Generic or repeated drafts receive at most one shared repair attempt before a cached skip. Frame counts and media interpretations are logged for audit. See the [September 13 GIF audit](docs/gif-reply-audit-2026-09-13.md).

Reply spending estimates include model/cache tokens and provider-reported web searches. Current triage cost is charged before deciding on escalation. Unknown model pricing fails explicitly. The configured dollar threshold is an estimated reply budget, not a strict system-wide cap: an in-flight call can cross it, and generation, preflight and weekly learning are separate. Provider billing is authoritative.

Weekly learning samples actual follow-ups across days and coarse feedback categories. A reply back is not automatically a success. Proposed notes have enforced size limits and must pass the fixed synthetic evaluation before replacing active notes. Failed candidates and evaluation artifacts remain available while the previous active notes are retained.

`npm run voice:evaluate` sends the current prompt, learned notes and synthetic comments to Anthropic and incurs usage charges. It does not publish replies. This checks routing and selected policy failures; it is not a blinded human comparison or full clinical/style benchmark. Do not interpret a passing category as proof of factual correctness.

Follower snapshots record elapsed hours and account-wide net change. They do not measure gross follows or prove which case or reply caused growth.

## Verification

Offline checks: `npm run typecheck`, `npm run publishing:verify`, `npm run audit:verify`, `npm run voice:verify`, `npm run media:verify`, `npm run spend:verify`, and `npm run budget:verify`. They use fixtures rather than live publishing endpoints.

Regenerate the configuration document with `npm run runtime:summary -- --write`. This reads tracked source expressions and workflow settings without printing credentials or resolving GitHub secrets.
