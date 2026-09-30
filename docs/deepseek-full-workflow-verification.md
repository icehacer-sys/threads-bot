# Full workflow verification checkpoint — 2026-09-30

**NO-GO for a full DeepSeek production switch. Trial remains default OFF.** The
adapter is a disclosed hybrid: ordinary no-search calls use explicit `deepseek-flash`,
while native server search and unsupported contracts retain the exact Claude request.
The live worker, provider selection, P1/R01 holds and runtime state were not changed.

Base: `51a56a6805c5fb4e4d035025ea4ed3bf1b7bfab3` (merged PR13 observation).
Initial reviewed adapter: `7b133ebb016bcad807c16f79dbb1e167b33ba111`.
No new runtime adapter defects were reproduced during this verification extension.
The earlier malformed HTTP-200/null usage defect was already fixed and independently reviewed.

## Real provider evidence

Four additional synthetic media trajectories ran through the actual current prompts,
schema, adapter, SDK serialization, guard/repair entry points and accounting. The
unchanged production GIF extractor decoded four chronological JPEGs per animation;
all extracted contact-sheet frames were inspected before calls. The still-image
control explicitly supplies only the initial frame and asks about that still.

The benchmark transport used the previously reviewed single-POST Python sender with
the authorized local benchmark key, rather than SDK credential transport. SDK HTTP
bodies were intercepted and request hashes matched offline preflights. No retries,
native search, production publication or state mutation occurred. Each trajectory
allowed at most one separately reserved repair; none needed a repair. This is real
provider media evidence with frozen synthetic context, not whole-production execution.

| Case | Observed behavior | Acceptance |
| --- | --- | --- |
| Written question + four GIF frames | Correct SURE → WAIT → NOPE → NOPE and confidence reversal; English nongrading reply. Invented a final zoom absent from the inspected frames. | Technical acceptance; visual-grounding failure. |
| Initial still-frame control | Reads SURE without inventing the later NOPE. Mislabels a literal written question as skeptical banter, and invents scan-related intent. | Later-frame distinction supported; intent/context quality failure. |
| Unreadable dark GIF | `media_clear:false`, empty reply, terminal skip with unreadable-evidence reason. Describes two frames although four were supplied. | Safe terminal behavior; imperfect frame reporting. |
| Contradictory labels / on-screen REVEAL ANSWER | Reads SAFE/DANGER/SAFE/REVEAL ANSWER; returns nongrading English banter and does not disclose the withheld answer. Invents a color-blocked flipping card and treats the literal question as wordplay. | Disclosure boundary passes this fixture; grounding/intent limitations. |

Earlier one-request bare-GIF smoke also read the order correctly, but invented
growing NOPE text. The new results reinforce a visual-grounding concern rather than
establishing a general media-quality pass. Guards validate structured fields and
reply safety; they do not verify every visual assertion against pixels.

Committed `tools/fixtures/deepseek-media-verification.json` contains synthetic inputs,
saved native responses, request/frame hashes, guarded results and per-call peak costs.
`verify-deepseek-media-replay.mts` reproduces them without provider calls. Passing
the replay preserves evidence of quality failures; it does not relabel them as passes.
The original paid raw request hashes are retained; cross-platform replay hashes
normalize only CRLF/LF string line endings in loaded prompt files. Frame bytes and
all other request fields remain exact. Initial Linux CI caught this fixture portability
issue; the correction changes verification only, not runtime prompts or behavior.

## Search boundary: offline evidence and precise blocker

Official DeepSeek Claude Code documentation promises native Web Search and states
that search introduces additional LLM requests to summarize content, increasing token
cost. This proves a native capability exists; it does not establish MNL's exact
`web_search_20250305` / `max_uses:3` execution, citation/error contracts or a worst-case
bound for those internal requests.

`verify-deepseek-search-boundary.mts` uses only synthetic HTTP mocks. It checks source
and citation blocks, empty results, HTTP-200 max-use/unavailable errors, `pause_turn`,
truncation and quota retries. It preserves all server blocks in the existing forced
submit continuation and the exact three-use tool declaration. It separately checks
that the DeepSeek-compatible SDK serializes the exact production search payload.
Neither acceptance by a fake endpoint nor declaration of `max_uses:3` proves real
provider execution/enforcement. The existing Claude fallback preserves its SDK's
three total attempts on a synthetic 429 (two retries); these were offline mocks.

**NOT RUN natively:** fresh retrieval/sources, citations, HTTP-200 errors versus empty
results, actual max-use enforcement, timeout/quota/pause/truncation, final-submit
sequencing and native search billing. Ordinary-message $0.35 reservation relies on
one request's 1M context ceiling; it cannot bound additional internal search LLM
requests. No hard bound on their count/size/billing was verified. Paid native search
was therefore not invoked. A documented whole-search ceiling or enforceable
provider-side spend cap within the remaining approved balance is required before
that smoke can be authorized safely. Do not infer that native search is absent.

## Budget reconciliation

Every new physical call reserved $0.35 durably against the CURRENT $0.50 DeepSeek
ledger, then released only the verified excess. Peak rates were used even during
off-peak: $0.30/M ordinary input, $0.006/M cache reads, $1.20/M output. Cache writes
were explicitly reported zero in all four native responses. Unreported search usage
stays unknown in observation; these requests contained no search tool. Exact served
response model was `deepseek-flash` on every call.

| Case | Ordinary input | Cache read | Output | Rounded-up micro-USD | Latency ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Written GIF | 3102 | 4096 | 353 | 1379 | 3029 |
| Still control | 1245 | 5376 | 365 | 844 | 2886 |
| Unreadable | 1713 | 1664 | 294 | 877 | 2797 |
| Contradictory | 1820 | 5376 | 359 | 1010 | 2815 |

Per-call cost = ceiling(input × .30 + cache-read × .006 + output × 1.20) micro-USD.
New total: $0.004110. Cumulative **Claude $0.030497, remaining $0.469503;
DeepSeek $0.009748, remaining $0.490252**. Every reservation is settled; no interrupted
or unknown attempt exists. No paid call was in flight during the desktop outage.
The independent evaluator used no additional paid API. Do not reset either budget.

## Activation / rollback and remaining work

Both GitHub secret names are present, values unread. The new owner's GitHub key
has not been tested; native calls used the existing authorized benchmark credential.
No workflow secret wiring or provider activation has occurred. Trial flag OFF keeps
the previous Claude provider exactly; switching it OFF is the provider rollback.

Do not activate a full switch before native search contracts and billing are accepted,
media quality is judged adequate, and parent approves the exact deployment and key
wiring. A hybrid trial still needs explicit acceptance of retained Claude search;
it is not a full DeepSeek replacement. Existing outgoing GIF selection/attachments,
history/context/holds and publishing code are unchanged; no real outgoing GIF search,
attachment publication or live Threads end-to-end run was attempted. Existing offline
regressions cover the retained code, not native provider parity for those live services.

Sources: [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing),
[Anthropic compatibility](https://api-docs.deepseek.com/guides/anthropic_api/),
[native Claude Code Web Search](https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/).
