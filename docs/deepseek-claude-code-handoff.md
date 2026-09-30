# MNL default-off DeepSeek adapter handoff

Base: merged main `51a56a6805c5fb4e4d035025ea4ed3bf1b7bfab3` (PR13).
Branch: `codex/mnl-deepseek-trial`. Local commit only; parent owns activation decisions.

## Ready

The runtime seam is wired at both existing reply request sites. `BOT_DEEPSEEK_TRIAL` defaults
to `off`; unset/off preserves the Claude path and is rollback. No workflow passes/enables the
new flag or DeepSeek secret yet. No workflow, dispatch, state, holds or publisher changes.

When enabled after approval, supported no-search text and chronological base64 JPEG/PNG/WebP
frame requests use a separate `deepseek-flash` Anthropic-compatible client with thinking
disabled, fixed endpoint, 1024 output cap and zero SDK retries. Prompts, tool schema, context,
frame order, logical routing, validation, shared repair allowance and presentation retries
are retained. Outgoing GIF behavior remains unchanged/default off. RE is untouched.

Every search-enabled request, including repairs carrying the search tool and forced-submit
continuations, stays on the existing Claude client with its exact payload. Unsupported blocks
also retain Claude. Logs and provider-scoped diagnostics disclose this hybrid. A full
DeepSeek switch has not been implemented or certified.

Each client gets one PR13 fetch observation wrapper. Claude native usage remains in its
original observation/accounting path. DeepSeek usage has a separate provider/process scope;
input/output/cache counters use their native meanings and absent fields remain unknown.
Known DeepSeek no-search usage is priced at conservative peak rates ($0.30 input miss,
$0.006 cache hit, $1.20 output per million), with no Claude cache-write multipliers.

Unknown DeepSeek transport, malformed response/model or required cache/token counters charge
$0.35 conservatively to the existing runtime meter and stop both reply providers for that
process. The normal index drains the meter before its existing fatal-stop branch. No search
billing is inferred from missing counters. Existing daily dollar gates remain estimates and
can be exceeded by an in-flight request; this change does not create a strict service cap.

## Checks and focused review

Run in a checkout without .env files, with the offline network/state guard:

```powershell
$env:NODE_OPTIONS='--import=./tools/offline-guard.mjs'
npm run deepseek:verify
npm run provider:verify
npm run spend:verify
npm run typecheck
```

Focused composition fixtures exercise default-off and enabled behavior through the actual
classifier and SDK: text, shared repair, quality, chronological GIF frames, unclear-media
skip, HTTP-200 search error plus forced continuation, truncation, invalid schema and operator
guard. They compare complete request payloads and final decisions, native prices, physical
attempts and provider scopes. Separate fixtures prove transport/usage/null-response uncertainty
charges once and blocks both providers. These mocks do not prove native search equivalence.

One independent reviewer (`/root/review_continuation`) found a null-response accounting bypass.
It was corrected: response/usage projection failures retain unknown cost, charge $0.35 and
halt. The exact null-response regression passes. The reviewer then returned PASS with no
remaining high-risk findings in the focused adapter scope. No evaluator API was charged.
Default-off classifier comparison against byte-exact pinned main also passed (10 variants
by 12 scenarios): complete request bodies, decisions, physical counts/order and spend match.

## Blocked before activation

Both ANTHROPIC_API_KEY and DEEPSEEK_API_KEY GitHub Actions secret names are present. Values
were not read or changed. The new GitHub key's validity is untested; the successful native
smoke used the previously authorized local benchmark key. Parent must approve workflow secret
wiring, activation and the disclosed Claude search fallback. Do not activate merely by merging.

One native bare-GIF smoke correctly read SURE -> WAIT -> NOPE -> NOPE and confidence turning
into withdrawal, returned valid media fields and passed current guards without repair. It
invented that the final NOPE grows larger. Guarded reply: "Take one more look whenever you like."
This is safe but generic. No publication occurred. Remaining media acceptance tests: written
comment plus GIF/context; dependence on later frames and order; contradictory/unreadable text;
missing frames; instruction-like on-screen text; repair and truncation handling.

Native DeepSeek search through its Anthropic-compatible endpoint is documented, but MNL's exact
`web_search_20250305`, `max_uses:3`, fresh sources/citations, error objects versus empty results,
timeout/quota, pause_turn/truncation and final-submit sequence remain unverified. Provider-internal
summarization billing has no proven test ceiling. Do not run paid search without a precise
bounded plan and parent approval. Full replacement requires truthful acceptance of these gaps.

Benchmark caps are still $0.50 each. Cumulative conservative usage-derived ledger totals:
Claude $0.030497 (remaining $0.469503); DeepSeek $0.005638 (remaining $0.494362). No further paid
calls are approved. Ledgers/paid evidence remain in the separate benchmark checkout with its
source pin frozen. The committed GIF fixture is synthetic; it contains no private comment payloads.

Runtime files: src/reply-provider.ts, src/reply-provider-plan.ts, src/deepseek-reply-client.ts;
small integrations in src/config.ts, src/reply.ts, src/spend.ts, src/coverage-observation.ts.
The existing PR13 observation module, frame extractor, prompts, state and workflows are unchanged.
