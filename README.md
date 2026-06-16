# Threads Auto-Reply Bot (@mdnoteslab)

Finds comments on your recent Threads posts that you have not replied to yet — top-level comments, sub-replies under your pinned **Answer:**, and one follow-up if someone replies back to the bot — reads the X-ray (plus any image or GIF a commenter attaches), drafts a reply in your voice, and (in live mode) posts it. It **never** auto-answers personal medical questions — those are silently skipped.

This is self-contained. It does not touch the Med Notes Lab website. It has its own `package.json` and is excluded from the site's TypeScript/ESLint, so it cannot affect your Vercel build.

## What it does, in order

1. Pull your newest post (with `BOT_NEWEST_ONLY=on`), or the last `BOT_MAX_POSTS` posts otherwise.
2. Look up the case answer and any vetted facts for the post (from `data/answers.json`, or your pinned "Answer:" reply if you've already posted it).
3. List **all** the comments — it follows pagination, so it sees every comment, not just the first ~25 — and works out which ones to answer: every top-level comment, every sub-reply under your pinned **Answer:** comment, and **one** follow-up if someone replies back to a bot reply with a question (capped at a single follow-up per chain, so it never gets into a long back-and-forth). It trusts the live thread, so it never double-replies, and if you delete one of its replies that comment is answered again.
4. Send each comment to the model **with the answer, the vetted facts, and the images as context** — the post's X-ray, plus any image the commenter attached or a still frame pulled from their GIF/video — so a correct guess gets "Spot on ✅", a wrong guess gets a kind fact-based nudge, a question gets a short accurate answer, and a joke (or a meme image) gets one back.
5. Skip anything risky (personal medical question, complaint, spam, or any uncertainty), and stay humble — it won't lecture an obvious clinician or double down when challenged.
6. Post the safe replies, up to `BOT_PER_POST_CAP` per post (200 in the shipped cloud config, counted across runs) and a daily backstop (`BOT_DAILY_CAP`, 240).

## Two things to know about behavior

- **How it runs (perpetual chain):** GitHub's scheduled cron is too flaky to rely on, so the bot **keeps itself alive** — every run launches the next one before it ends, forming a chain that is *always running* (the `workflow_dispatch` self-launch works with the built-in token; verified). Each run polls every 10 min and **posts only inside the active window** (`BOT_ACTIVE_WINDOWS`, Cairo — currently `22-10` = **10 PM–10 AM**; comma-separated windows like `20-2,4-10` also work and wrap past midnight), up to `BOT_PER_POST_CAP` (**200**) per post; outside the window it just no-ops. Progress (`state.json`) is committed every cycle, so a restart never double-replies. Concurrency keeps it a single chain, and the `*/30` cron restarts it only if a hand-off ever fails. **Start it once** (Actions → Run workflow) and it runs forever; **disable the workflow** to stop it.
- **How it learns the answer:** it reads your own on-thread `Answer: <diagnosis>` reply automatically. The spoiler blur is display-only, so the bot still reads the real text — affirmations ("Spot on ✅") are then exact. Wrong-guess *corrections* lean on the answer + the X-ray + general knowledge; for a tricky case you can make them bulletproof by adding `facts` to `data/answers.json`, otherwise you never touch the file.

## Three ways to run

| Command | What it does | Needs |
|---|---|---|
| `npm run demo` | Runs the bundled real-comment samples through Claude and prints the drafts. Posts nothing, no Threads token needed. **Start here.** | `ANTHROPIC_API_KEY` |
| `npm run dry` | Reads your **real** recent comments and prints what it *would* post. Posts nothing. | both keys |
| `npm run live` | Same as dry, but actually posts. | both keys + `BOT_CONFIRM_LIVE=yes` |

## Quick start (check the voice first)

```bash
cd threads-bot
npm install
cp .env.example .env        # then put your ANTHROPIC_API_KEY in .env
npm run demo
```

You will see each sample comment with the draft reply or the skip reason. Tune the voice in `src/voice.ts` and re-run until it sounds like you. Nothing is posted.

## Knowing the case answer (so it can say "Spot on ✅")

Early on, before you've posted your public answer reply, the bot can't read it from the thread. You can tell it instead — one line per post in `data/answers.json`:

```json
{
  "DZX4-v_k7lT": { "answer": "Nail-Patella Syndrome", "aliases": ["iliac horns", "Fong disease"] }
}
```

The key is the post's **shortcode** — the code at the end of its URL (`threads.com/@mdnoteslab/post/DZX4-v_k7lT`). `aliases` are other ways people might phrase the right answer. When a comment matches, the bot affirms it ("Spot on ✅" / "You nailed it ✅"); when it's a joke, it jokes back; it never reveals the answer to a wrong guess.

Add an optional **`facts`** array (your own vetted bullet points) and the bot will use *those* — not invented specifics — when it nudges a wrong guess or answers a question. This is the main lever for accuracy in educational mode:

```json
{
  "DZStLYBgRAE": {
    "answer": "Eagle Syndrome",
    "aliases": ["elongated styloid"],
    "facts": [
      "Bilateral elongated styloid processes extend down from the skull base.",
      "Usually asymptomatic; can cause throat or ear pain and swallowing difficulty."
    ]
  }
}
```

If you've already posted your pinned "Answer: ..." reply, the bot reads it from there automatically — so this file only matters for the early window. If no answer is known for a post, the bot still banters and empathizes, it just won't affirm medical correctness.

## Auto-posting the answer

**Optional, and off in practice unless you opt in per post.** This only fires for a post that has a `breakdown` in `data/answers.json`. If you post and pin the daily answer yourself (the usual flow), it never triggers and you can ignore this section. When a `breakdown` exists, about an hour after the post goes up (`BOT_ANSWER_DELAY_HOURS`, default 1) the bot posts it as a reply, in full and visible by default (`BOT_ANSWER_SPOILER=off`):

```json
{
  "DZStLYBgRAE": {
    "answer": "Eagle Syndrome",
    "aliases": ["elongated styloid"],
    "breakdown": "Answer: Eagle Syndrome\n\n👀 What you see:\n...\n\n📝 Takeaway:\n..."
  }
}
```

Use `\n` for line breaks. **You write the breakdown** — the bot does not generate the medical content, so it stays accurate. After it posts, **you tap "Pin" once** in the app (the Threads API has no pin endpoint). Turn the whole feature off with `BOT_ANSWER=off`.

Prefer to hide the answer behind a tap instead? Set `BOT_ANSWER_SPOILER=on`: only the `Answer:` label stays visible and the diagnosis + the whole explanation are blurred until tapped. Just start your breakdown with `Answer: <diagnosis>` (the normal format) — no teaser line needed.

Caveat: the spoiler boundary is computed by character position. Check your first real answer post looks right; if the blur starts a character or two off because of an emoji, it's a one-line fix in `answerSpoiler()` (switch to code-point counting).

## One-time setup to go live (the part only you can do)

You need a Threads access token for @mdnoteslab. I cannot create this or enter it for you.

1. Go to https://developers.facebook.com/ and create an app (type: **Business**).
2. Add the **Threads API** use case and enable these permissions/scopes:
   - `threads_basic`
   - `threads_content_publish`
   - `threads_manage_replies` (read + reply to comments)
3. Connect the @mdnoteslab Threads account and generate a **long-lived access token**.
4. Put it in `.env` as `THREADS_ACCESS_TOKEN=...`
5. `npm run dry` to confirm it reads your real comments correctly.
6. When the drafts look right: set `BOT_CONFIRM_LIVE=yes` in `.env`, then `npm run live`.

Long-lived tokens expire (about 60 days) and need refreshing — note that for later.

## Running it on a schedule (cloud, 24/7)

`npm run live` is one pass. A ready-to-use **GitHub Actions** workflow ships at `.github/workflows/reply.yml` — it polls every ~10 minutes but only acts during your active window (currently **10 PM–10 AM Cairo**, set by `BOT_ACTIVE_WINDOWS`). The shipped workflow also enables vision and web search and uses caps of 200/post and 240/day. It runs on GitHub's servers, so your PC does not need to be on.

To turn it on:

1. Create a **private** GitHub repo and push this project to it:
   ```bash
   cd threads-bot
   git init && git add . && git commit -m "threads bot"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
   `.env` is gitignored, so your secrets are **not** pushed. `state.json` **is** pushed — that is intentional, so the bot remembers what it answered.
2. In the repo: **Settings → Secrets and variables → Actions → New repository secret**, add two secrets: `ANTHROPIC_API_KEY` and `THREADS_ACCESS_TOKEN`.
3. Done. Watch runs under the **Actions** tab; each run commits the updated `state.json` back so it never double-replies. You can also trigger one manually with **Run workflow**.

Two things to know:
- Runs that fall outside the active Cairo window no-op immediately (no API cost). Change the hours in the workflow's `env` block (`BOT_ACTIVE_WINDOWS`, e.g. `22-10`, and `BOT_ACTIVE_TZ`).
- Your Threads token expires (~60 days). When the workflow starts failing with an auth error, regenerate it (`npm run token`) and update the `THREADS_ACCESS_TOKEN` secret.

**Prefer your own PC?** Use **Windows Task Scheduler**: create a task that runs `npm` with arguments `run live`, "Start in" set to the project folder, on a 10-minute repeat trigger during your active window. It only runs while your PC is on and awake — which is why the cloud option above is the better fit for "100% automated."

## Tuning (all in `.env`)

- `BOT_MODEL` — `claude-sonnet-4-6` (default). Cheaper: `claude-haiku-4-5`. For maximum medical accuracy in educational mode: `claude-opus-4-8`. See "Which model" below.
- `BOT_WINDOW_HOURS` — only reply within the first N hours of a post (default 0 = no limit; rely on the per-post cap).
- `BOT_NEWEST_ONLY` — `on` to act only on your single newest post (recommended for the daily challenge). Default off.
- `BOT_MAX_POSTS` — how many recent posts to scan when not in newest-only mode (default 5).
- `BOT_DAILY_CAP` — max replies per 24h backstop (default 200). Threads allows ~250 published/day and replies count, so stay under.
- `BOT_PER_POST_CAP` — hard cap on total replies per post, counted across runs (default 100).
- `BOT_EDUCATIONAL` — `on` (default): once the answer is known, it corrects wrong guesses and answers questions using the vetted `facts`. `off` leaves those for you.
- `BOT_VISION` — `on` (default): send the post's X-ray image to the model so it can see the case.
- `BOT_WEB_SEARCH` — `off` in code by default, but **on** in the shipped cloud workflow. Lets the model web-search a reference it doesn't recognize (e.g. a brand-new movie); it decides when, so only the stumped comments trigger a search; adds a small per-search cost.
- `BOT_ANSWER` / `BOT_ANSWER_DELAY_HOURS` — auto-post the answer breakdown after N hours (default on, 1h), but **only for posts that have a `breakdown` in `data/answers.json`** — otherwise you post and pin the answer yourself. Either way you pin it manually.
- `BOT_ACTIVE_WINDOWS` — the active posting window(s) in `BOT_ACTIVE_TZ`, as comma-separated `start-end` hour pairs that may wrap past midnight (currently `22-10` = 10 PM–10 AM Cairo; e.g. `20-2,4-10` for two windows). This is the canonical setting.
- `BOT_ACTIVE_TZ` / `BOT_ACTIVE_START` / `BOT_ACTIVE_END` — timezone (e.g. `Africa/Cairo`) plus a single-window fallback used only when `BOT_ACTIVE_WINDOWS` is unset. Timezone-aware and DST-safe. Empty TZ = always on.

## Which model (Claude vs Gemini)

Recommendation: **Claude Sonnet 4.6.** Your replies' wit is the whole product, so don't go too small; Sonnet nails the voice and the safety calls at a fraction of Opus's cost.

- `claude-sonnet-4-6` — best balance of wit and cost (~$10-15/month at 100 replies/day). Default.
- `claude-haiku-4-5` — cheapest that still works (~$4-6/month), a touch less clever on the jokes.
- `claude-opus-4-8` — overkill for one-line replies; use only to spot-check voice while tuning.

Gemini Flash is cheaper per token, but at this volume the gap is a few dollars a month — not worth splitting your stack or loosening safety control on a medical account. The model call is isolated in `src/reply.ts`, so if your volume ever explodes, swapping in a Gemini provider is a contained change. For now, Claude is the better pick.

## Honest limitations

- **Selection is newest-first.** The Threads replies endpoint does not reliably expose per-comment like counts, so "highest-engagement first" is not implemented (it falls back to newest). If you want engagement ranking, it needs per-reply insights calls, which may not be available for other people's replies.
- **Prompt caching is active.** The system prompt (~5K tokens) and the post's X-ray are cached with a 1-hour TTL, so every comment on the same post reuses them and most of the per-comment cost is a cheap cache read.
- **Endpoint drift.** Meta's Threads API changes. All API calls live in `src/threads.ts`; if a field or path changes, that is the only file to update. Verify against https://developers.facebook.com/docs/threads.
- **Backfilling old posts is intentionally off.** Widen `BOT_WINDOW_HOURS` to reach older posts, but mass-replying to old comments looks like spam and burns the daily cap fast.

## Safety model

- Personal medical questions ("could I have this", "should I get scanned") -> **always skipped**, in two layers: the model classifies them as `personal_medical`, and `sanitize()` in `src/reply.ts` force-skips anything that still reads like advice.
- Complaints and spam -> skipped (a human handles complaints).
- Any error or unparseable response -> skipped. The bot defaults to silence, never to a risky reply.
- It stays humble: replies peer-to-peer to obvious clinicians instead of lecturing, never over-claims anatomy beyond the vetted facts, and concedes in one line or skips rather than arguing when a comment challenges it.

## Files

- `src/voice.ts` — the brand voice + few-shot examples (edit this to tune replies).
- `src/reply.ts` — Claude call + safety sanitizer.
- `src/threads.ts` — all Threads API calls.
- `src/index.ts` — orchestration + the three run modes.
- `src/state.ts` — local replied-log + daily counter.
- `data/sample-comments.json` — real comments for `npm run demo`.
