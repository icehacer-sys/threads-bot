// Facebook Page comment reply loop. Mirrors the Threads reply bot but for the Facebook page
// the xray-poster cross-posts to. Reuses the same classifier (reply.ts) + voice, with its own
// state file (fb-state.json) and the shared daily/per-post caps + active-hours window.
//
//   npm run fb:dry   -> read REAL comments, print what it WOULD reply. Posts nothing.
//   npm run fb:live  -> same, but actually replies (requires BOT_CONFIRM_LIVE=yes).
//
// v1 scope: banter, genuine questions, and "are you a bot?" comments (all handled by the
// existing voice + guards). It does NOT yet judge diagnosis guesses — there is no Facebook
// answer bridge, so `answerPublic:false` keeps it from ever affirming/denying a guess, which
// matches the safe pre-answer behaviour on Threads. Follow-up chains + vision are Threads-only
// for now and can be ported later.

import { config } from "./config";
import { classifyAndDraft, type Decision } from "./reply";
import { getPagePosts, getComments, replyToComment, myPageId, type FbComment } from "./facebook";

function withinActiveHours(): boolean {
  if (!config.activeTz) return true;
  let hour: number;
  try {
    const hh = new Intl.DateTimeFormat("en-US", { hour: "2-digit", hour12: false, timeZone: config.activeTz }).format(new Date());
    hour = parseInt(hh, 10) % 24;
  } catch {
    return true;
  }
  return config.activeWindows.some(([a, b]) => (a <= b ? hour >= a && hour < b : hour >= a || hour < b));
}

function clip(s: string, n = 60): string {
  const one = (s || "").replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}

function printRow(comment: string, d: Decision): void {
  const tag = `${d.category.padEnd(16)} ${d.decision.padEnd(5)}`;
  if (d.decision === "reply") console.log(`  [${tag}] "${clip(comment)}"\n        -> "${d.reply_text}"`);
  else console.log(`  [${tag}] "${clip(comment)}"  (skip: ${d.reason})`);
}

async function main(): Promise<void> {
  if (!config.facebookReply) {
    console.log("Facebook replies disabled (set BOT_FACEBOOK_REPLY=on). Nothing to do.");
    return;
  }
  const posting = process.argv.includes("--live");
  if (posting && !config.confirmLive) {
    console.error("\nLIVE refused: set BOT_CONFIRM_LIVE=yes to allow posting.\n");
    process.exitCode = 1;
    return;
  }
  if (posting && !withinActiveHours()) {
    const windows = config.activeWindows.map(([a, b]) => `${a}-${b}`).join(", ");
    console.log(`Outside active hours (${windows} ${config.activeTz}). Nothing to do.`);
    return;
  }

  const { State } = await import("./state");
  const state = new State(config.fbStateFile);
  const page = myPageId();

  const posts = await getPagePosts(config.fbMaxPosts);
  console.log(
    `\n${posting ? "LIVE" : "DRY-RUN"} — FB page ${page}, model ${config.model}. ` +
      `Scanning ${posts.length} post(s). Per-post cap ${config.perPostCap}, daily left ${state.remainingToday()}/${config.dailyCap}.` +
      (posting ? "" : " Nothing will be posted.") +
      "\n",
  );

  let replied = 0;
  const skipCounts: Record<string, number> = {};
  const budgetLeft = () => (posting ? state.remainingToday() : config.dailyCap - replied);

  for (const post of posts) {
    if (budgetLeft() <= 0) {
      console.log("Daily cap reached — stopping.");
      break;
    }

    let comments: FbComment[];
    try {
      comments = await getComments(post.id);
    } catch (err) {
      console.error(`  ! skipping post ${post.id}: ${(err as Error).message}`);
      continue;
    }

    // The page's own replies are NESTED comments (each carries a parent = the comment it answers).
    // Those parent ids are comments we've ALREADY answered live — a backstop behind fb-state.json
    // so a lost or stale state file can't cause mass double-replies (mirrors the Threads loop).
    const answeredByMe = new Set(
      comments.filter((c) => c.from?.id === page && c.parent?.id).map((c) => c.parent!.id!),
    );

    // Reply candidates: a TOP-LEVEL comment (filter=stream also returns nested replies, which we
    // skip — no follow-up handling in v1), not the page's own, not hidden, long enough, not already
    // answered live, and neither already-replied nor already-skipped in state (the hard backstop).
    const wants = (c: FbComment): boolean =>
      c.from?.id !== page &&
      !c.parent &&
      c.is_hidden !== true &&
      (c.message ?? "").trim().length >= config.minCommentLength &&
      !answeredByMe.has(c.id) &&
      !state.hasReplied(c.id) &&
      !state.hasSkipped(c.id);

    const perPostRemaining = Math.max(0, config.perPostCap - state.repliedToPost(post.id));
    const candidates = comments.filter(wants).slice(0, perPostRemaining);

    const postedThisRun: string[] = [];
    console.log(
      `Post ${clip(post.message ?? post.id, 40)} — ${candidates.length} to reply (${state.repliedToPost(post.id)}/${config.perPostCap} done):`,
    );
    if (!candidates.length) {
      console.log("  (none)\n");
      continue;
    }

    for (const c of candidates) {
      if (budgetLeft() <= 0) break;
      const baseInput = {
        postText: post.message ?? "",
        commentText: c.message ?? "",
        recentReplies: postedThisRun,
        // No FB answer bridge yet, so there is no diagnosis to protect: leave answerPublic unset
        // (public), which drops the ~200-token pre-public spoiler block from every FB call. With no
        // answer known the classifier still never affirms/denies a guess (the safe banter branch).
      };
      // Two-tier: cheap triage drafts every comment; accuracy-critical categories redraft on the quality model.
      let d = await classifyAndDraft({ ...baseInput, modelOverride: config.triageModel });
      if (d.decision === "reply" && config.escalateCategories.includes(d.category)) {
        const allowSearch = config.webSearch && d.category === "reference";
        console.log(`        (escalating ${d.category} to ${config.model}${allowSearch ? " + web search" : ""})`);
        d = await classifyAndDraft({ ...baseInput, modelOverride: config.model, allowSearch });
      }
      if (!config.educationalReplies && (d.category === "correct" || d.category === "teach")) {
        d = { ...d, decision: "skip", reply_text: "", reason: `${d.reason} | educational replies off` };
      }
      printRow(c.message ?? "", d);

      if (d.decision === "skip") {
        skipCounts[d.category] = (skipCounts[d.category] ?? 0) + 1;
        const transient = /^error:/.test(d.reason) || d.reason.includes("no submit_reply");
        const final = ["spam", "complaint", "personal_medical", "other"].includes(d.category);
        if (posting && !transient && final) state.markSkipped(c.id);
        continue;
      }

      postedThisRun.push(d.reply_text);
      if (posting) {
        try {
          await replyToComment(c.id, d.reply_text);
          state.markReplied(c.id, post.id);
          replied += 1;
        } catch (err) {
          console.error(`    ! reply failed for ${c.id}: ${(err as Error).message}`);
        }
      } else {
        replied += 1;
      }
    }
    console.log("");
  }

  const skipSummary = Object.entries(skipCounts).map(([k, v]) => `${k}:${v}`).join(", ") || "none";
  console.log(`Summary: ${posting ? "posted" : "would post"} ${replied} repl${replied === 1 ? "y" : "ies"}. Skipped by category: ${skipSummary}.\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
