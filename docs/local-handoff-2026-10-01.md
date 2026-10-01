# Local handoff, 2026-10-01 (cloud session stopped at 18:31 UTC)

Cloud work stopped at a clean point. Everything is merged and pushed. No local-only changes.
Nothing was left half-done in production.

## Snapshot at handoff

| Item | State |
|---|---|
| `main` | `907f9c2` (PR #30, DeepSeek accuracy guard, CI green at exact head) |
| Live worker | run `36869264496`, started from old commit `5ab42e5`, Claude only. Hands off at about 19:01 UTC |
| Next worker | Picks up `reply.yml` from `main`: `BOT_REPLY_PROVIDER: "hybrid"`. First DeepSeek night |
| Rollback | Set `BOT_REPLY_PROVIDER: "claude"` in `.github/workflows/reply.yml`. Takes effect at the next handoff (env is fixed at each run's trigger SHA; `src` is pulled every poll) |
| Evals in flight | `36907000952` (faecaloma `18133515574657616`) and `36907004789` (tongue worm `18097639436415272`). Post-reveal, provider `deepseek`, dry run, $0.50 cap each, on `907f9c2` |
| Stale queued reply runs | None (old pending run `36874518870` was cancelled earlier so the handoff uses the new YAML) |

### What hybrid means tonight
- DeepSeek (`deepseek-flash`) answers the everyday no-search triage replies.
- Claude keeps search escalations, corrections and teaching that need lookups, commenter GIFs/images, and anything DeepSeek fails on.
- DeepSeek-only guards in `src/reply.ts` `deepSeekPolicy()`: pre-reveal hold on case posts, political jab, Latin-script non-English, off-platform action claims, unsupported claim families (`src/deepseek-media-policy.ts` `unsupportedDeepSeekClaim`).
- Breaker: a DeepSeek failure is charged $0.35 once, Claude answers that request, DeepSeek is off for the process, and `state.deepSeekHalt` keeps it off for the cap-day.

## Do these next, in order

1. **Confirm the 19:01 UTC handoff.** The new `reply.yml` run should be on `main` (`907f9c2` or later). In its log check for: the DeepSeek trial disclosure line, preflight DeepSeek PASS (402/401/403 is a warning, not fatal), pre-reveal hold skips, and no fatal or billing lines.
2. **Review the two evals.** Compare each DeepSeek draft with the published Claude reply printed beside it. Look for invented specifics, wrong corrections, pre-reveal hints, and guard skips that dropped a reply that was fine. Note the total spend line.
3. **Fix what they find** with the loop: reproduce offline in a `tools/verify-deepseek-*.mts` test, fix, run the full suite, PR, exact-head CI, merge.
4. **R01 owner decision (time sensitive).** The 24 held comments on post `18205974196371350` are only revisited until about **2026-10-02 19:00 UTC**. Analysis and the exact command are in `docs/audit-followups-2026-10-01.md`. P1 stays UNKNOWN; never mark it confirmed or replied.
5. **Backlog:**
   - Gate 3: more real commenter GIF/image samples before DeepSeek ever handles media.
   - Voice learning gate on DeepSeek is 11/13 (pre-reveal hold policy conflicts with one case; one banter case labelled teach). Weekly learning stays on Claude until 13/13.
   - Audit items 5 to 8: see `docs/audit-followups-2026-10-01.md`.
   - Full `deepseek` mode (Claude only for search) only after post-reveal accuracy is clean on several real cases.

## Sonnet 5.5 (decided: not now)

- $2/$10 per MTok vs Sonnet 4.6 $3/$15, but ~1.3x tokens for the same text, so about 13% cheaper on Claude escalations only.
- Breaks the current code: forced `tool_choice` submit_reply (400), `thinking: disabled` (400, use `between_tools`), prefers `web_search_20260209`. Needs a `spend.ts` entry and a dry-run eval.
- Side finding: `src/spend.ts` prices `claude-sonnet-5` at $3/$15 after 2026-09-01; the current reference says $2/$10. Over-estimate only (safe). Verify against the September usage export before changing.

## Boundaries (unchanged)

- Do not run `npm run live` locally. The GitHub worker is the only publisher; a local live run can double-post.
- No secrets locally needed for review work. Model calls go through the `deepseek-eval` workflow (dry run, posts nothing).
- Do not edit `state.json` holds, skips, receipts, or checkpoints except the owner-approved R01 command.
- Do not cancel the live worker or dispatch `reply.yml` without checking the current run list first.
- Small changes only: reproduce, fix, tests, review, exact-head CI, guarded merge, observe.
