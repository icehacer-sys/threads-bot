# Audit follow-ups — 2026-10-01

Evidence comes from `state.json` at main `502464f` and the merged code. No state, receipts, holds or
skips were changed.

## P1 / R01 (protected recovery state)

| Item | Evidence | Status |
| --- | --- | --- |
| P1 comment `18137777392726831` | Only unpublished receipt in state: container `17891527806614054`, created 2026-09-29 22:01 UTC, text "Telepath powers would definitely come in handy for this one.", no `publishedId`. Earlier read-only checks: container status FINISHED (Meta reports PUBLISHED after a publish), and no matching reply in complete reply/conversation reads. | UNKNOWN, but publication of this container is unlikely. Not marked confirmed or replied. |
| R01 review `17898039627603779` | Open image/anatomy review on post `18205974196371350`, protecting 24 held comments. The flagged comment remarks on "extra teeth" in a child's X-ray, which reads as normal mixed dentition rather than an image inconsistency. | Open. Owner judgment. |

**Duplicate-risk change shipped:** a post revisited after its image review is released (item 4)
never resumes saved containers. Resolving R01 therefore no longer publishes P1. The post is also
outside the 16h discovery window, so the normal path never resumes P1 either.

**Recommendation:** resolve R01 if you agree the remark is benign. The 24 held comments are then
revisited until 72h after the post (about 2026-10-02 19:00 UTC). Leave P1 as an unconfirmed
receipt: replying two days late adds nothing, and abandoning it cleanly needs the separate
quarantine change (local commit `80f875d`, not on GitHub).

```bash
npm run reviews -- --resolve=17898039627603779 --note="Benign mixed-dentition remark; no image inconsistency"
git add state.json && git commit -m "chore: resolve R01 image review [skip ci]" && git pull --rebase && git push
```

## Item 4 — deferred comments outside the discovery window (shipped)

Measured: 75 image-held comments across 3 posts had never been replied to or skipped, because a
post that leaves the 16h window is never scanned again. 64 owner reviews are open (oldest
2026-09-22) and nothing announces them.

- A post whose image review is resolved is revisited for **its held comments only**, up to
  `BOT_HELD_REVISIT_HOURS` (default 72; 0 disables), at most 2 posts per poll. Missing posts only
  log. Answer posting and saved-container resume never run on revisited posts.
- Holds clear when the comment is replied to or skipped, so revisits stop on their own.
- Each live poll prints the open-review count and oldest date.
- All three currently held posts still have open reviews, so nothing changes until a review is resolved.
- Regression: `tools/verify-held-revisit.mts` (in `concerns:verify`).

## Items 5–8 — status and proposed next change

| # | Finding | Smallest safe next change |
| --- | --- | --- |
| 5 Context/history truncation | Thread reads stop at 25 pages (warning only). Anti-repeat history keeps the last 30 replies. Follow-up context is clipped to 240 characters. No run records when truncation affected a draft. | Carry a `historyTruncated` flag into the prompt input and the coverage observation, and hold medical (`correct`/`teach`) drafts when the thread read was truncated. |
| 6 Durable outcomes and billing reconciliation | Coverage and provider observations are per-process (`persistence: none`). Spend is an estimate in `state.spend`. | Append one JSON line per classified comment (comment, provider, physical attempts, priced cost, decision, publication id) to a per-day file uploaded as a workflow artifact, not committed to `state.json`. Reconcile it weekly against the Anthropic and DeepSeek usage exports. |
| 7 Provenance/resource findings | The original findings list lives in the local audit checkout, not this repository. | Needs that list. Copy it into `docs/` so it can be worked here. |
| 8 Runtime state vs main protection | The worker pushes `state.json` (about 860 KB) to `main` every poll, so protecting `main` would block the worker. | Move worker checkpoints to a dedicated `bot-state` branch (or a small external store), keep `main` code-only, then require PR checks on `main`. This needs a one-time migration while no worker is in flight. |
