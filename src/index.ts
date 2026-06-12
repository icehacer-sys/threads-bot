// Orchestrator + CLI.
//
//   npm run demo   -> classify the bundled sample comments, print drafts. No network beyond Anthropic. Posts nothing.
//   npm run dry    -> read REAL recent comments via Threads API, print what it WOULD post. Posts nothing.
//   npm run live   -> same as dry, but actually posts (requires BOT_CONFIRM_LIVE=yes).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "./config";
import { classifyAndDraft, type Decision, type InlineImage, type ImageMediaType } from "./reply";
import {
  getMyUsername,
  getRecentPosts,
  getReplies,
  getConversation,
  postReply,
  type ThreadsPost,
  type ThreadsReply,
  type SpoilerEntity,
} from "./threads";

type Mode = "demo" | "dry-run" | "live";

function parseMode(argv: string[]): Mode {
  if (argv.includes("--demo")) return "demo";
  if (argv.includes("--live")) return "live";
  return "dry-run";
}

// Optional positional arg: a post URL or shortcode to target just that one post.
function targetShortcode(argv: string[]): string | null {
  const a = argv.find((x) => !x.startsWith("--"));
  if (!a) return null;
  return shortcodeFromPermalink(a) ?? a;
}

function clip(s: string, n = 60): string {
  const one = (s || "").replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}

function printRow(comment: string, d: Decision): void {
  const tag = `${d.category.padEnd(16)} ${d.decision.padEnd(5)}`;
  if (d.decision === "reply") {
    console.log(`  [${tag}] "${clip(comment)}"\n        -> "${d.reply_text}"`);
  } else {
    console.log(`  [${tag}] "${clip(comment)}"  (skip: ${d.reason})`);
  }
}

// ---- demo mode -------------------------------------------------------------

interface SampleComment {
  post: string;
  answer?: string;
  comment: string;
  note?: string;
}

async function runDemo(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const samples = JSON.parse(readFileSync(join(here, "..", "data", "sample-comments.json"), "utf8")) as SampleComment[];

  console.log(`\nDEMO — ${samples.length} sample comments, model ${config.model}. Nothing is posted.\n`);
  const counts: Record<string, number> = {};
  for (const s of samples) {
    const d = await classifyAndDraft({ postText: s.post, commentText: s.comment, answer: s.answer });
    counts[d.decision] = (counts[d.decision] ?? 0) + 1;
    printRow(s.comment, d);
  }
  console.log(`\nSummary: ${counts["reply"] ?? 0} would reply, ${counts["skip"] ?? 0} skipped.\n`);
}

// ---- live / dry-run --------------------------------------------------------

// --- knowing the case answer ------------------------------------------------

interface AnswerEntry {
  answer: string;
  aliases?: string[];
  breakdown?: string;
  /** Owner-reviewed distinguishing facts, fed to the model for accurate corrections. */
  facts?: string[];
}

function loadAnswers(): Record<string, AnswerEntry> {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(join(here, "..", "data", "answers.json"), "utf8")) as Record<string, AnswerEntry>;
  } catch {
    return {};
  }
}

function shortcodeFromPermalink(permalink?: string): string | null {
  if (!permalink) return null;
  const m = permalink.match(/\/post\/([^/?#]+)/);
  return m ? m[1] : null;
}

// Fallback: read the answer from your own pinned "Answer: ..." reply, if you've posted it.
function answerFromConversation(convo: ThreadsReply[], me: string): string | null {
  const own = convo.find((c) => c.username === me && /^\s*answer\s*:/i.test(c.text ?? ""));
  const m = own?.text?.match(/answer\s*:\s*([^\n]+)/i);
  return m ? m[1].trim() : null;
}

interface ResolvedAnswer {
  answer?: string;
  facts?: string[];
}

function resolveAnswer(
  post: ThreadsPost,
  convo: ThreadsReply[],
  me: string,
  answers: Record<string, AnswerEntry>,
): ResolvedAnswer {
  const sc = shortcodeFromPermalink(post.permalink);
  const cfg = sc ? answers[sc] : undefined;
  if (cfg) return { answer: [cfg.answer, ...(cfg.aliases ?? [])].join(" / "), facts: cfg.facts };
  return { answer: answerFromConversation(convo, me) ?? undefined };
}

// Build the answer reply: keep ONLY the "Answer:" label visible and blur the
// diagnosis plus the whole explanation (the spoiler style the account uses).
// If there is no "Answer:" prefix, blur everything to be safe.
// NOTE: offset/length are character positions. If the blur boundary lands wrong
// because of emoji, switch these to code-point counts (use [...str].length).
function answerSpoiler(breakdown: string): { text: string; spoilers: SpoilerEntity[] } {
  const m = breakdown.match(/^\s*answer\s*:\s*/i);
  const offset = m ? m[0].length : 0;
  const length = breakdown.length - offset;
  return { text: breakdown, spoilers: length > 0 ? [{ entity_type: "SPOILER", offset, length }] : [] };
}

function selectCandidates(replies: ThreadsReply[]): ThreadsReply[] {
  const sorted = [...replies];
  // "engagement" is best-effort: the replies edge does not reliably expose per-reply
  // like counts, so we fall back to newest-first. Newest-first is the reliable default.
  sorted.sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
  return sorted.slice(0, config.perPostCap);
}

// The post's X-ray image URL(s), so the model can actually see the case.
// Handles single-image posts and carousels; empty when vision is off or no image.
function imageUrlsForPost(post: ThreadsPost): string[] {
  if (!config.visionEnabled) return [];
  const kids = post.children?.data ?? [];
  if (kids.length) {
    return kids
      .filter((k) => k.media_type === "IMAGE" && k.media_url)
      .map((k) => k.media_url as string)
      .slice(0, 4);
  }
  if (post.media_type === "IMAGE" && post.media_url) return [post.media_url];
  return [];
}

// Download one image URL and base64-encode it. We fetch the bytes ourselves
// (rather than handing Anthropic the URL) because the Threads CDN blocks
// Anthropic's URL fetcher via robots.txt.
async function fetchInlineImage(url: string): Promise<InlineImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    const media_type: ImageMediaType = ct.includes("png")
      ? "image/png"
      : ct.includes("webp")
        ? "image/webp"
        : ct.includes("gif")
          ? "image/gif"
          : "image/jpeg";
    const data = Buffer.from(await res.arrayBuffer()).toString("base64");
    return { media_type, data };
  } catch {
    return null; // an image we can't fetch just means that piece is judged text-only
  }
}

async function loadPostImages(post: ThreadsPost): Promise<InlineImage[]> {
  const out: InlineImage[] = [];
  for (const url of imageUrlsForPost(post)) {
    const img = await fetchInlineImage(url);
    if (img) out.push(img);
  }
  return out;
}

// The image a commenter attached to their OWN comment, if any. GIFs come through
// as VIDEO (which vision can't read), so only IMAGE attachments are fetched.
async function loadCommentImage(c: ThreadsReply): Promise<InlineImage[]> {
  if (!config.visionEnabled || c.media_type !== "IMAGE" || !c.media_url) return [];
  const img = await fetchInlineImage(c.media_url);
  return img ? [img] : [];
}

// Live mode only acts when local time in config.activeTz is within [start, end).
// The cloud runner is UTC, so this keeps the 8-11 PM window correct (incl. DST).
function withinActiveHours(): boolean {
  if (!config.activeTz) return true;
  let hour: number;
  try {
    const hh = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hour12: false,
      timeZone: config.activeTz,
    }).format(new Date());
    hour = parseInt(hh, 10) % 24;
  } catch {
    return true; // unknown timezone -> don't block
  }
  return config.activeWindows.some(([a, b]) => (a <= b ? hour >= a && hour < b : hour >= a || hour < b));
}

async function runLiveOrDry(mode: Mode, target: string | null): Promise<void> {
  const posting = mode === "live";
  if (posting && !config.confirmLive) {
    console.error("\nLIVE mode refused: set BOT_CONFIRM_LIVE=yes in .env to allow posting.\n");
    process.exitCode = 1;
    return;
  }

  if (posting && !withinActiveHours()) {
    // Marker the polling loop reads to know it's outside all windows.
    try {
      writeFileSync(".bot-idle", "outside-window");
    } catch {
      /* best effort */
    }
    const windows = config.activeWindows.map(([a, b]) => `${a}-${b}`).join(", ");
    console.log(`Outside active hours (${windows} ${config.activeTz}). Nothing to do.`);
    return;
  }

  // Lazy import so demo mode never needs the state file or Threads token.
  const { State } = await import("./state");
  const state = new State();

  const me = await getMyUsername();
  let posts = await getRecentPosts();
  if (target) posts = posts.filter((p) => shortcodeFromPermalink(p.permalink) === target);
  // Newest post only: posts come back newest-first, so keep just the first.
  if (!target && config.newestOnly && posts.length > 1) posts = posts.slice(0, 1);
  console.log(
    `\n${posting ? "LIVE" : "DRY-RUN"} — @${me}, model ${config.model}. ` +
      `Scanning ${posts.length} post(s)${target ? ` (target ${target})` : ""}. ` +
      `Per-post cap ${config.perPostCap}, daily left ${state.remainingToday()}/${config.dailyCap}.` +
      (posting ? "" : " Nothing will be posted.") +
      "\n",
  );

  const convByPost = new Map<string, ThreadsReply[]>();
  const answers = loadAnswers();
  let replied = 0;
  const skipCounts: Record<string, number> = {};
  // In live mode markReplied() updates remainingToday(); in dry mode state is not
  // touched, so track the intended count against the cap directly.
  const budgetLeft = () => (posting ? state.remainingToday() : config.dailyCap - replied);

  for (const post of posts) {
    if (budgetLeft() <= 0) {
      console.log("Daily cap reached — stopping.");
      break;
    }
    // Optional time window: only enforced when windowHours > 0 (0 = no limit).
    if (config.windowHours > 0) {
      const ageHours = post.timestamp ? (Date.now() - new Date(post.timestamp).getTime()) / 3_600_000 : 0;
      if (ageHours > config.windowHours) continue;
    }

    let replies: ThreadsReply[];
    let conversation: ThreadsReply[];
    try {
      [replies, conversation] = await Promise.all([getReplies(post.id), getConversation(post.id)]);
    } catch (err) {
      console.error(`  ! skipping post ${post.id}: ${(err as Error).message}`);
      continue;
    }
    convByPost.set(post.id, conversation);

    const resolved = resolveAnswer(post, conversation, me, answers);
    const postImages = await loadPostImages(post);

    // Comment ids we (the brand) have already replied to.
    const answeredByMe = new Set(
      conversation.filter((c) => c.username === me && c.replied_to?.id).map((c) => c.replied_to!.id),
    );

    // Short replies we've already posted on this post, so the model can vary its
    // wording instead of reusing the same shapes. Grows as this run posts more.
    const recentOwnerReplies = conversation
      .filter((c) => c.username === me && (c.text ?? "").trim().length > 0 && (c.text ?? "").length <= 280)
      .sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""))
      .map((c) => c.text as string)
      .slice(-12);
    const postedThisRun: string[] = [];

    // Filter to genuinely-unanswered comments first, THEN apply the per-post cap,
    // so older unanswered comments aren't dropped by a cap full of answered ones.
    const unanswered = replies.filter(
      (r) =>
        r.username !== me &&
        r.hide_status !== "HIDDEN" &&
        ((r.text ?? "").trim().length >= config.minCommentLength || (r.media_type === "IMAGE" && !!r.media_url)) &&
        !answeredByMe.has(r.id) &&
        !state.hasReplied(r.id),
    );
    const perPostRemaining = Math.max(0, config.perPostCap - state.repliedToPost(post.id));
    const candidates = selectCandidates(unanswered).slice(0, perPostRemaining);

    console.log(
      `Post ${clip(post.text ?? post.id, 40)} [answer: ${resolved.answer ?? "unknown"}${postImages.length ? ", image ✓" : ""}] — ${candidates.length} to reply (${state.repliedToPost(post.id)}/${config.perPostCap} done):`,
    );
    if (candidates.length === 0) {
      console.log("  (none)\n");
      continue;
    }

    for (const c of candidates) {
      if (budgetLeft() <= 0) break;
      const commentImages = await loadCommentImage(c);
      let d = await classifyAndDraft({
        postText: post.text ?? "",
        commentText: c.text ?? "",
        answer: resolved.answer,
        facts: resolved.facts,
        images: postImages,
        recentReplies: [...recentOwnerReplies, ...postedThisRun],
        commentImages,
        commentHasVideo: c.media_type === "VIDEO",
      });
      if (!config.educationalReplies && (d.category === "correct" || d.category === "teach")) {
        d = { ...d, decision: "skip", reply_text: "", reason: `${d.reason} | educational replies off` };
      }
      printRow(c.text ?? "", d);

      if (d.decision === "skip") {
        skipCounts[d.category] = (skipCounts[d.category] ?? 0) + 1;
        continue;
      }
      postedThisRun.push(d.reply_text);
      if (posting) {
        try {
          await postReply(c.id, d.reply_text);
          state.markReplied(c.id, post.id);
          replied += 1;
        } catch (err) {
          console.error(`    ! post failed for ${c.id}: ${(err as Error).message}`);
        }
      } else {
        replied += 1; // count intended replies for the dry-run summary
      }
    }
    console.log("");
  }

  // Post the day's answer breakdown (a separate job from replying to comments).
  if (config.answerEnabled) {
    for (const post of posts) {
      const sc = shortcodeFromPermalink(post.permalink);
      const entry = sc ? answers[sc] : undefined;
      if (!entry?.breakdown) continue;
      // Don't double-post the answer if you already posted it (a pinned "Answer:" reply).
      const conv = convByPost.get(post.id);
      if (conv && answerFromConversation(conv, me)) {
        state.markAnswered(post.id);
        continue;
      }
      const ageH = post.timestamp ? (Date.now() - new Date(post.timestamp).getTime()) / 3_600_000 : 0;
      if (ageH < config.answerDelayHours || state.hasAnswered(post.id)) continue;

      const { text, spoilers } = config.answerUseSpoiler
        ? answerSpoiler(entry.breakdown)
        : { text: entry.breakdown, spoilers: [] as SpoilerEntity[] };
      if (posting) {
        try {
          await postReply(post.id, text, spoilers);
          state.markAnswered(post.id);
          console.log(`Answer posted for ${sc}${config.answerUseSpoiler ? " (explanation blurred)" : ""}. Now pin it in the app.`);
        } catch (err) {
          console.error(`  ! answer post failed for ${sc}: ${(err as Error).message}`);
        }
      } else {
        console.log(`Would post the answer for ${sc} now${config.answerUseSpoiler ? " (explanation blurred)" : ""}, then you pin it.`);
      }
    }
  }

  const skipSummary =
    Object.entries(skipCounts)
      .map(([k, v]) => `${k}:${v}`)
      .join(", ") || "none";
  console.log(
    `Summary: ${posting ? "posted" : "would post"} ${replied} repl${replied === 1 ? "y" : "ies"}. ` +
      `Skipped by category: ${skipSummary}.\n`,
  );

  // Live: write a marker when the newest post has hit the per-post cap, so the
  // workflow's 10-minute polling loop knows to stop.
  if (posting && posts.some((p) => state.repliedToPost(p.id) >= config.perPostCap)) {
    try {
      writeFileSync(".bot-stop", "done");
    } catch {
      /* best effort */
    }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const mode = parseMode(argv);
  if (mode === "demo") {
    await runDemo();
  } else {
    await runLiveOrDry(mode, targetShortcode(argv));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
