# Reply bot operations

The active service reads Threads comments and drafts replies in the account's written voice. It does not synthesize speech. Workflow overrides set the Cairo active window to 22:00-10:00 and enable Haiku triage with selected Sonnet escalation. See the [generated configuration](docs/runtime-config.md) for exact declarations and active overrides.

## Reply policy

All diagnosis guesses are held before the answer is public, whether right or wrong. Private answers are not sent to the drafting prompt in that state. After reveal, supported guesses can be affirmed and genuine new questions answered. Prior replies to another reader do not suppress a useful answer to this reader.

Image/anatomy inconsistencies and questions about the account's operator are held for owner review rather than given invented explanations. Pending owner items are recorded in `state.json` under `ownerReviews`, including post, reason and time. They are an operator queue, not an automatic direct-message or notification service.

Personal symptoms and requests for individual advice are skipped. Shared experiences receive brief empathy when appropriate. Product facts come from the catalog; links require an explicit request. Outgoing GIF attachments and the Facebook branch remain disabled in the active workflow. Input media may still be read.

## Running and recovery

`npm run dry` can make paid model calls and write drafts or local artifacts. It does not mean no cost or no filesystem changes. Use the offline verification commands below for deterministic checks without public posting. `npm run live` also requires the live confirmation setting.

Do not reset corrupt state to an empty file. Keep the failed file and restore a known-good checkpoint after reconciling remote publications. Receipts are saved before publishing and acknowledged after success; a persistence failure exits with code 4 and stops new writes. Never delete an uncertain receipt merely to force a retry. Git sync failures stop normal handoff, and failure artifacts preserve recovery data.

The publisher remains responsible for its case challenge, answer and CTA. The read-only case bridge supplies source facts and public reveal state. Companion service: [xray-cases](https://github.com/icehacer-sys/xray-cases).

## Budget and learning

Reply spending estimates include model/cache tokens and provider-reported web searches. Current triage cost is charged before deciding on escalation. Unknown model pricing fails explicitly. The configured dollar threshold is an estimated reply budget, not a strict system-wide cap: an in-flight call can cross it, and generation, preflight and weekly learning are separate. Provider billing is authoritative.

Weekly learning samples actual follow-ups across days and coarse feedback categories. A reply back is not automatically a success. Proposed notes have enforced size limits and must pass the fixed synthetic evaluation before replacing active notes. Failed candidates and evaluation artifacts remain available while the previous active notes are retained.

`npm run voice:evaluate` sends the current prompt, learned notes and synthetic comments to Anthropic and incurs usage charges. It does not publish replies. This checks routing and selected policy failures; it is not a blinded human comparison or full clinical/style benchmark. Do not interpret a passing category as proof of factual correctness.

Follower snapshots record elapsed hours and account-wide net change. They do not measure gross follows or prove which case or reply caused growth.

## Verification

Offline checks: `npm run typecheck`, `npm run publishing:verify`, `npm run audit:verify`, `npm run voice:verify`, `npm run spend:verify`, and `npm run budget:verify`. They use fixtures rather than live publishing endpoints.

Regenerate the configuration document with `npm run runtime:summary -- --write`. This reads tracked source expressions and workflow settings without printing credentials or resolving GitHub secrets.
