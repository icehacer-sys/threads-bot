# Start here

Before doing any work in this repo, read these in order:

1. `docs/HANDOUT-2026-10-10.md` — full project handout: the three systems (publisher, reply bot,
   products), current state, owner rules, and operational gotchas.
2. `OPERATOR.md` — reply policy and runbook.
3. The memory index `MEMORY.md` (auto-loaded) and any memory file relevant to the task.

The handout's "current state" section is a snapshot from 2026-10-10. Verify live state with
`git fetch && git log origin/main -5` and `gh run list --limit 5` before acting on it.

## Non-negotiables

- Never run `npm run live` locally. The GitHub Actions worker is the only publisher.
- Never hand-edit `state.json` holds, skips, receipts or checkpoints without the owner's OK.
- Check `gh run list` before cancelling or dispatching any workflow.
- No commas in public content or bot replies (except genuine 3+ item lists).
- Ask before anything that spends money, posts publicly, or regenerates images.
