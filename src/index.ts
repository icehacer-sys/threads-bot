// Orchestrator + CLI.
//
//   npm run demo   -> classify the bundled sample comments, print drafts. No network beyond Anthropic. Posts nothing.
//   npm run dry    -> read REAL recent comments via Threads API, print what it WOULD post. Posts nothing.
//   npm run live   -> same as dry, but actually posts (requires BOT_CONFIRM_LIVE=yes).

import { readFileSync, writeFileSync } from "node:fs";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const execFileAsync = promisify(execFile);
import { config } from "./config";
import { classifyAndDraft, type Decision, type InlineImage, type ImageMediaType } from "./reply";
import { resolveXrayAnswer } from "./xray";
import {
  getMyUsername,
  getRecentPosts,
  getPostById,
  getAllMyPosts,
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

// The id of our own pinned "Answer:" comment, if posted, so we can also reply to
// the sub-replies people leave under it (the answer thread).
function answerCommentId(convo: ThreadsReply[], me: string): string | null {
  return convo.find((c) => c.username === me && /^\s*answer\s*:/i.test(c.text ?? ""))?.id ?? null;
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

// Reply ONLY to clearly-visible comments. Anything the owner (or Threads) has hidden,
// covered, blocked, or restricted is left untouched until the owner unhides it. A missing
// status, NOT_HUSHED, or UNHUSHED all mean visible.
function isVisible(c: ThreadsReply): boolean {
  const s = c.hide_status;
  return !s || s === "NOT_HUSHED" || s === "UNHUSHED";
}

// Cheap value heuristic (no API call): when a viral post gets more comments than the
// per-post cap, we want the budget spent on the comments where a reply adds the most —
// genuine questions and substantive guesses/stories — not on one-word jokes. A real
// question that arrives late should still outrank an early "lol". Pure banter is overflow.
function commentValue(c: ThreadsReply): number {
  const t = (c.text ?? "").trim();
  const len = t.length;
  let score = 0;
  if (/\?/.test(t)) score += 3; // a question — highest signal
  if (/\b(how|why|what|when|where|which|whose|can|could|would|does|do|did|is it|are they|cause)\b/i.test(t)) score += 2;
  if (len >= 80) score += 2; // detailed guess / personal story
  else if (len >= 40) score += 1;
  if (len <= 15) score -= 1; // one-word guess or quip
  if (c.media_type === "IMAGE" || c.media_type === "VIDEO") score += 1; // attached media to react to
  return score;
}

function selectCandidates(replies: ThreadsReply[]): ThreadsReply[] {
  const sorted = [...replies];
  // Rank by value first so questions/substantive comments win the limited budget;
  // tie-break newest-first so the bot still feels responsive to the live conversation.
  // (Per-reply like counts are not reliably exposed by the replies edge, so we score
  // the text itself rather than engagement.)
  sorted.sort((a, b) => {
    const dv = commentValue(b) - commentValue(a);
    if (dv !== 0) return dv;
    return (b.timestamp ?? "").localeCompare(a.timestamp ?? "");
  });
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

// The image a commenter attached to their OWN comment, if any (IMAGE only).
async function loadCommentImage(c: ThreadsReply): Promise<InlineImage[]> {
  if (!config.visionEnabled || c.media_type !== "IMAGE" || !c.media_url) return [];
  const img = await fetchInlineImage(c.media_url);
  return img ? [img] : [];
}

// A still frame from a commenter's GIF/video (Threads serves GIFs as VIDEO). We grab
// one representative frame with ffmpeg so vision can at least see it. Returns [] if
// ffmpeg is unavailable (e.g. a local Windows dry run) or extraction fails.
async function loadCommentVideoFrame(c: ThreadsReply): Promise<InlineImage[]> {
  if (!config.visionEnabled || c.media_type !== "VIDEO" || !c.media_url) return [];
  const id = c.id.replace(/[^a-zA-Z0-9]/g, "");
  const vid = join(tmpdir(), `c-${id}.mp4`);
  const frame = join(tmpdir(), `c-${id}.jpg`);
  try {
    const res = await fetch(c.media_url);
    if (!res.ok) return [];
    await writeFile(vid, Buffer.from(await res.arrayBuffer()));
    await execFileAsync("ffmpeg", ["-y", "-loglevel", "error", "-i", vid, "-vf", "thumbnail", "-frames:v", "1", frame], {
      timeout: 25000,
    });
    const data = (await readFile(frame)).toString("base64");
    return data ? [{ media_type: "image/jpeg", data }] : [];
  } catch {
    return []; // no ffmpeg / fetch or extraction failed -> fall back to no frame
  } finally {
    await unlink(vid).catch(() => {});
    await unlink(frame).catch(() => {});
  }
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

function looksLikeMediaId(s: string): boolean {
  return /^\d{6,}$/.test(s);
}

// Resolve BOT_PINNED_POSTS entries (media ids OR post URLs/shortcodes) to live posts,
// skipping any already in the daily scan. A URL/shortcode is matched against the account's
// post list once and the id is cached in state, so later runs cost a single fetch per pin.
async function resolvePinnedPosts(
  state: { resolvedPinned(k: string): string | undefined; setResolvedPinned(k: string, id: string): void },
  daily: ThreadsPost[],
): Promise<ThreadsPost[]> {
  if (!config.pinnedPostIds.length) return [];
  const dailyIds = new Set(daily.map((p) => p.id));
  const out: ThreadsPost[] = [];
  const seen = new Set<string>();
  let listing: ThreadsPost[] | null = null;
  for (const entry of config.pinnedPostIds) {
    try {
      let id: string | undefined;
      if (looksLikeMediaId(entry)) {
        id = entry;
      } else {
        const sc = shortcodeFromPermalink(entry) ?? entry;
        id = state.resolvedPinned(sc);
        if (!id) {
          if (!listing) listing = await getAllMyPosts(2500); // scan deep once; the id is cached after
          const found = listing.find((p) => shortcodeFromPermalink(p.permalink) === sc);
          if (found) {
            id = found.id;
            state.setResolvedPinned(sc, id);
          }
        }
      }
      if (!id) {
        console.error(`  ! pinned post not found (use a media id from --list or a post URL): ${entry}`);
        continue;
      }
      if (dailyIds.has(id) || seen.has(id)) continue; // already scanned / duplicate pin
      seen.add(id);
      out.push(await getPostById(id));
    } catch (err) {
      console.error(`  ! pinned post ${entry} failed: ${(err as Error).message}`);
    }
  }
  return out;
}

// `--list`: print recent posts with their media ids so you can copy a pinned thread's id
// into BOT_PINNED_POSTS. Ignores the active window and the scan time window.
async function runList(): Promise<void> {
  const posts = await getAllMyPosts(100);
  console.log(`\n${posts.length} recent posts (newest first). Copy a pinned thread's id into BOT_PINNED_POSTS:\n`);
  for (const p of posts) {
    const sc = shortcodeFromPermalink(p.permalink) ?? "?";
    console.log(`  ${p.id}  [${sc}]  ${clip(p.text ?? "", 70)}`);
  }
  console.log("");
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

  // Pinned posts (e.g. a pinned intro thread): always scanned on top of the daily post,
  // unless a specific target was requested. They bypass the time window + per-post cap below.
  const pinnedPosts = target ? [] : await resolvePinnedPosts(state, posts);
  const pinnedIds = new Set(pinnedPosts.map((p) => p.id));
  const scanPosts = [...posts, ...pinnedPosts];

  console.log(
    `\n${posting ? "LIVE" : "DRY-RUN"} — @${me}, model ${config.model}. ` +
      `Scanning ${scanPosts.length} post(s)${pinnedPosts.length ? ` (incl. ${pinnedPosts.length} pinned)` : ""}${target ? ` (target ${target})` : ""}. ` +
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

  for (const post of scanPosts) {
    if (budgetLeft() <= 0) {
      console.log("Daily cap reached — stopping.");
      break;
    }
    // Optional time window: only enforced when windowHours > 0 (0 = no limit).
    // Pinned posts are intentionally old, so they skip the age filter.
    if (config.windowHours > 0 && !pinnedIds.has(post.id)) {
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

    // Prefer the xray-cases bridge (auto-posted cases) so the bot knows the diagnosis
    // even before the answer is publicly posted; fall back to answers.json / pinned reply.
    const bridged = await resolveXrayAnswer(post.id);
    const resolved = bridged ?? resolveAnswer(post, conversation, me, answers);
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
      .slice(-config.antiRepeatWindow);
    const postedThisRun: string[] = [];

    // Unanswered = no live reply from us in the thread right now (answeredByMe is
    // built from the current conversation). We trust the LIVE thread, not a local
    // log, so if you delete one of the bot's replies that comment is re-answered.
    const wantsReply = (c: ThreadsReply): boolean =>
      c.username !== me &&
      isVisible(c) &&
      ((c.text ?? "").trim().length >= config.minCommentLength ||
        ((c.media_type === "IMAGE" || c.media_type === "VIDEO") && !!c.media_url)) &&
      !answeredByMe.has(c.id) &&
      !state.hasSkipped(c.id); // already classified+skipped once — don't re-pay to re-classify it every poll

    const unanswered = replies.filter(wantsReply);

    // Also reply to the sub-replies people leave under our pinned "Answer:" comment.
    // Those live in the flattened conversation (not the top-level replies edge), tied
    // to the answer comment via replied_to.id. The answer is public there, so the
    // model may discuss the diagnosis openly (inAnswerThread below).
    const ansId = answerCommentId(conversation, me);
    const answerSubIds = new Set<string>(); // fresh user subs under the answer -> reply candidates
    const answerDirectIds = new Set<string>(); // ALL direct subs under the answer (answered or not) -> chain roots
    if (ansId) {
      for (const c of conversation) {
        if (c.replied_to?.id === ansId) {
          answerDirectIds.add(c.id);
          if (wantsReply(c)) answerSubIds.add(c.id);
        }
      }
    }
    const answerSubs = conversation.filter((c) => answerSubIds.has(c.id));

    // Spoiler gate: never reveal the answer until it is actually pinned in the thread.
    // We may KNOW it (from answers.json) before you post it, but affirming a correct
    // guess or giving a fact-based correction would spoil the challenge for everyone
    // still guessing. So the answer is only fed to the model once the "Answer:" comment
    // is live (ansId set) — before that, every guess is treated as unknown and just gets
    // banter, no confirmation. In the answer thread the answer is already public, so it
    // flows normally there.
    const answerPublic = ansId !== null;
    // Pass the answer to the model whenever we KNOW it (so it can judge guesses), but
    // only allow it to REVEAL once the answer is publicly posted. Facts stay private until
    // then. Pre-public, the model nudges wrong guesses and warmly acknowledges correct ones
    // without ever naming the diagnosis (see voice.ts + the spoiler backstop in reply.ts).
    const knownAnswer = resolved.answer;
    const revealFacts = answerPublic ? resolved.facts : undefined;

    // Reply to follow-ups people leave under one of OUR replies. A follow-up is eligible
    // when its reply chain traces back to an ORIGINAL comment on this post (a top-level
    // comment or an answer-thread sub) at ANY reasonable depth — so a genuine multi-question
    // back-and-forth keeps getting answered instead of dying after the first follow-up.
    // The model only actually replies when the follow-up is a real question/clarification
    // (see followUpNote in reply.ts), so this never turns into endless banter; the hop cap
    // is only a runaway backstop. answeredByMe still prevents re-answering the same one.
    const MAX_FOLLOWUP_HOPS = 12; // ~6 exchanges deep
    const byId = new Map(conversation.map((c) => [c.id, c]));
    const botReplyIds = new Set(conversation.filter((c) => c.username === me).map((c) => c.id));
    const originalIds = new Set<string>([...replies.map((r) => r.id), ...answerDirectIds]);
    // Walk up a reply chain to the id of the original comment it descends from (or null).
    const rootOriginal = (c: ThreadsReply): string | null => {
      let cur: ThreadsReply | undefined = c;
      for (let hop = 0; cur && hop < MAX_FOLLOWUP_HOPS; hop++) {
        const pid = cur.replied_to?.id;
        if (!pid) return null;
        if (originalIds.has(pid)) return pid;
        cur = byId.get(pid);
      }
      return null;
    };
    const followUpContext = new Map<string, { commenter: string; bot: string }>();
    const inAnswerThreadIds = new Set<string>(answerSubIds);
    const followUps = conversation.filter((c) => {
      if (c.username === me || !wantsReply(c)) return false;
      const parentId = c.replied_to?.id;
      if (!parentId || !botReplyIds.has(parentId)) return false; // must reply to one of OUR replies
      const originalId = rootOriginal(c);
      if (!originalId) return false; // chain must trace back to an original on this post
      const ourReply = byId.get(parentId);
      const priorCommentId = ourReply?.replied_to?.id; // the message our reply answered = the immediate context
      followUpContext.set(c.id, {
        commenter: (priorCommentId ? byId.get(priorCommentId)?.text ?? "" : "").slice(0, 240),
        bot: (ourReply?.text ?? "").slice(0, 240),
      });
      if (answerDirectIds.has(originalId)) inAnswerThreadIds.add(c.id);
      return true;
    });

    // Merge top-level comments + answer-thread subs + one-level follow-ups, de-duped by id.
    const seenIds = new Set<string>();
    const pool = [...unanswered, ...answerSubs, ...followUps].filter((c) =>
      seenIds.has(c.id) ? false : (seenIds.add(c.id), true),
    );
    // Pinned posts are not subject to the cumulative per-post cap (it would permanently
    // cap a thread that should run forever) — they are bounded only by the daily cap.
    const perPostRemaining = pinnedIds.has(post.id)
      ? budgetLeft()
      : Math.max(0, config.perPostCap - state.repliedToPost(post.id));
    const candidates = selectCandidates(pool).slice(0, perPostRemaining);

    console.log(
      `Post ${clip(post.text ?? post.id, 40)} [answer: ${resolved.answer ?? "unknown"}${postImages.length ? ", image ✓" : ""}] — ${candidates.length} to reply (${pinnedIds.has(post.id) ? "pinned" : `${state.repliedToPost(post.id)}/${config.perPostCap}`} done):`,
    );
    if (candidates.length === 0) {
      console.log("  (none)\n");
      continue;
    }

    for (const c of candidates) {
      if (budgetLeft() <= 0) break;
      let commentImages: InlineImage[] = [];
      let commentMediaKind: "image" | "video-frame" | "video" | undefined;
      if (c.media_type === "IMAGE") {
        commentImages = await loadCommentImage(c);
        if (commentImages.length) commentMediaKind = "image";
      } else if (c.media_type === "VIDEO") {
        commentImages = await loadCommentVideoFrame(c);
        commentMediaKind = commentImages.length ? "video-frame" : "video";
      }
      const baseInput = {
        postText: post.text ?? "",
        commentText: c.text ?? "",
        answer: knownAnswer,
        facts: revealFacts,
        images: postImages,
        recentReplies: [...recentOwnerReplies, ...postedThisRun],
        commentImages,
        commentMediaKind,
        inAnswerThread: inAnswerThreadIds.has(c.id),
        priorExchange: followUpContext.get(c.id),
        answerPublic,
      };
      // Two-tier: the cheap triage model drafts every comment; only accuracy-critical
      // categories (corrections / teaching) are re-drafted by the pricier quality model.
      let d = await classifyAndDraft({ ...baseInput, modelOverride: config.triageModel });
      if (d.decision === "reply" && config.escalateCategories.includes(d.category)) {
        // Only the "reference" re-run gets web search (to look up an unrecognized
        // movie/show/meme/person); medical correct/teach escalations rely on vetted facts.
        const allowSearch = config.webSearch && d.category === "reference";
        console.log(`        (escalating ${d.category} to ${config.model}${allowSearch ? " + web search" : ""})`);
        d = await classifyAndDraft({ ...baseInput, modelOverride: config.model, allowSearch });
      }
      if (!config.educationalReplies && (d.category === "correct" || d.category === "teach")) {
        d = { ...d, decision: "skip", reply_text: "", reason: `${d.reason} | educational replies off` };
      }
      printRow(c.text ?? "", d);

      if (d.decision === "skip") {
        skipCounts[d.category] = (skipCounts[d.category] ?? 0) + 1;
        // Record the skip so we never re-classify this comment again (the main cost leak) —
        // but NOT transient API-error skips, which should still retry on a later poll.
        const transient = /^error:/.test(d.reason) || d.reason.includes("no submit_reply");
        if (posting && !transient) state.markSkipped(c.id);
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
  if (argv.includes("--list")) {
    await runList();
    return;
  }
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
