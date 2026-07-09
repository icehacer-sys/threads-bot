// Orchestrator + CLI.
//
//   npm run demo   -> classify the bundled sample comments, print drafts. No network beyond Anthropic. Posts nothing.
//   npm run dry    -> read REAL recent comments via Threads API, print what it WOULD post. Posts nothing.
//   npm run live   -> same as dry, but actually posts (requires BOT_CONFIRM_LIVE=yes).

import { readFileSync } from "node:fs";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const execFileAsync = promisify(execFile);
import { config } from "./config";
import { classifyAndDraft, isBotQuestion, type Decision, type InlineImage, type ImageMediaType } from "./reply";
import { pickGif } from "./gifs";
import { getProduct } from "./products";
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

// Detect the answer already being live even when it was pinned WITHOUT the "Answer:" prefix
// (e.g. "The reveal: ..."). Matches an owner comment that contains a distinctive chunk of the
// breakdown text, so a manual pin in any wording still blocks a duplicate auto-post — the
// ^answer: regex + state.hasAnswered alone would miss it and post a second public answer.
function answerAlreadyPosted(convo: ThreadsReply[], me: string, breakdown: string): boolean {
  const norm = (s?: string) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const key = norm(breakdown).replace(/^answer\s*:\s*/, "").slice(0, 50);
  if (key.length < 20) return false;
  return convo.some((c) => c.username === me && norm(c.text).includes(key));
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
  if (c.media_type === "IMAGE" || c.media_type === "VIDEO" || c.gif_url) score += 1; // attached media (incl. a GIPHY GIF) to react to
  return score;
}

// `committed` holds ids that belong to a thread we are already invested in: a genuine
// multi-turn follow-up under one of our replies, or a sub under our pinned answer. Those get
// a ranking bonus so a slow back-and-forth survives the per-post cap instead of being sliced
// out behind fresh first-touch banter on a viral post (which would orphan a real conversation).
const COMMITTED_BONUS = 5;
function selectCandidates(replies: ThreadsReply[], committed?: Set<string>): ThreadsReply[] {
  const sorted = [...replies];
  const valueOf = (c: ThreadsReply): number => commentValue(c) + (committed?.has(c.id) ? COMMITTED_BONUS : 0);
  // Rank by value first so questions/substantive comments win the limited budget;
  // tie-break newest-first so the bot still feels responsive to the live conversation.
  // (Per-reply like counts are not reliably exposed by the replies edge, so we score
  // the text itself rather than engagement.)
  sorted.sort((a, b) => {
    const dv = valueOf(b) - valueOf(a);
    if (dv !== 0) return dv;
    return (b.timestamp ?? "").localeCompare(a.timestamp ?? "");
  });
  return sorted.slice(0, config.perPostCap);
}

// --- Mechanical voice enforcement -------------------------------------------------------------
// The exhaustive whole-history audit (4589 replies) found the PROSE rules for these two do not
// hold on their own: 🤣 rides ~1 in 3 replies despite voice.ts telling it to cut to ~1 in 6, and
// "genuinely" leaks as an intensifier ~82x despite being retired. So enforce them in code.

// Strip "genuinely" used as an intensifier — the stickiest verbal tic. Removing it always leaves
// valid text ("genuinely wild" -> "wild"); restore a leading capital if it was sentence-initial.
function stripTics(text: string): string {
  let t = text.replace(/\bgenuinely\s+/gi, "").replace(/[ \t]{2,}/g, " ").trim();
  const first = text.trim().charAt(0);
  if (t && first && first === first.toUpperCase() && /[a-z]/.test(t.charAt(0))) {
    t = t.charAt(0).toUpperCase() + t.slice(1);
  }
  return t || text;
}

// Drop a TRAILING 🤣 (the auto-appended laugh-track) when 🤣 already appeared in the recent posted
// replies, enforcing ~1-in-6 spacing. Dry lines land harder (the audit found LANDED replies skew
// emoji-free). Only ever touches a trailing 🤣, never one used mid-sentence, and only judges once
// there is enough history — so an occasional genuine laugh still gets through.
function throttleLaugh(text: string, recent: string[]): string {
  if (!/🤣\s*$/u.test(text)) return text;
  const window = recent.slice(-5);
  if (window.length < 3) return text;
  if (window.some((r) => /🤣/u.test(r))) return text.replace(/\s*🤣\s*$/u, "").trimEnd() || text;
  return text;
}

// The audit's #1 residual tell: bare check-mark stamps ("You nailed it ✅") posted verbatim, even
// twice on one post (the "You nailed it ✅ ×2" the owner flagged). When a reply is ONLY a bare stamp
// AND that exact phrasing already appeared in the recent replies, rotate it to an unused one so the
// same stamp never repeats on a post. A confirmation that ADDED a specific detail is left untouched
// (it is not a bare stamp, so it never matches). voice.ts still pushes for crowning their phrasing.
const STAMP_RE = /^(spot on|you nailed it|nailed it|that'?s the one|exactly( right)?|100%( correct)?|textbook( perfect)?|dead on|called it|you got it|bang on|yep,? that'?s it|you are correct|correct)\s*[\p{Extended_Pictographic}\p{Emoji_Modifier}️]*$/iu;
const STAMP_ROTATION = ["Spot on ✅", "Nailed it ✅", "You got it ✅", "Dead on ✅", "Called it ✅", "That's the one ✅", "Exactly ✅", "Bang on ✅", "Textbook ✅", "100% ✅", "Yep that's it ✅"];
const stampKey = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
function dedupeStamp(text: string, recent: string[]): string {
  if (!STAMP_RE.test(text.trim())) return text; // not a bare stamp -> leave it
  const used = new Set(recent.map(stampKey));
  if (!used.has(stampKey(text))) return text; // first use on this post -> fine
  return STAMP_ROTATION.find((s) => !used.has(stampKey(s))) ?? text; // rotate to an unused stamp
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
  // A VIDEO post (e.g. an X-ray clip) has no still media_url, but Threads exposes a
  // thumbnail_url — feed that representative frame so the model can still see the case.
  if (post.thumbnail_url) return [post.thumbnail_url];
  return [];
}

// Download one image URL and base64-encode it. We fetch the bytes ourselves
// (rather than handing Anthropic the URL) because the Threads CDN blocks
// Anthropic's URL fetcher via robots.txt.
async function fetchInlineImage(url: string): Promise<InlineImage | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
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

// Probe ffmpeg ONCE at startup. Without it loadCommentVideoFrame swallows ENOENT exactly
// like a real extraction failure, so a runner missing ffmpeg silently blinds the bot to ALL
// motion media. This logs one clear warning instead. Cached so we never re-shell per comment.
let ffmpegOk: boolean | null = null;
async function ensureFfmpeg(): Promise<boolean> {
  if (ffmpegOk !== null) return ffmpegOk;
  try {
    await execFileAsync("ffmpeg", ["-version"], { timeout: 10000 });
    ffmpegOk = true;
  } catch {
    ffmpegOk = false;
    console.error("  ! ffmpeg not found — GIF/video comment frames will be skipped (install ffmpeg on the runner).");
  }
  return ffmpegOk;
}

// A still frame from a commenter's GIF/video (Threads serves GIFs as VIDEO). Prefer the
// thumbnail_url Threads already exposes (no download/ffmpeg needed); otherwise grab one
// representative frame with ffmpeg so vision can at least see it. Returns [] if ffmpeg is
// unavailable (e.g. a local Windows dry run) or extraction fails.
async function loadCommentVideoFrame(c: ThreadsReply): Promise<InlineImage[]> {
  if (!config.visionEnabled || c.media_type !== "VIDEO") return [];
  // Cheapest path: Threads gives us a representative thumbnail for most motion media.
  if (c.thumbnail_url) {
    const thumb = await fetchInlineImage(c.thumbnail_url);
    if (thumb) return [thumb];
  }
  if (!c.media_url) return [];
  if (!(await ensureFfmpeg())) return []; // no ffmpeg -> already warned once at probe
  const id = c.id.replace(/[^a-zA-Z0-9]/g, "");
  const vid = join(tmpdir(), `c-${id}.mp4`);
  const frame = join(tmpdir(), `c-${id}.jpg`);
  try {
    const res = await fetch(c.media_url, { signal: AbortSignal.timeout(15_000) });
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

// A commenter's GIPHY GIF (arrives as gif_url). Extract SEVERAL frames across its length, not one.
// Reaction GIFs put the payoff — the punchline or on-screen TEXT — in a LATER frame: a "shocked
// face" first frame becomes "I WON" by the end (a real miss the owner caught). Reading only the
// first frame misreads the whole meaning, so sample start/middle/end and let the model see the arc.
// Falls back to a single fetch when ffmpeg/ffprobe is unavailable (e.g. a local dry run).
async function loadCommentGifFrames(url: string, cid: string): Promise<InlineImage[]> {
  if (!config.visionEnabled) return [];
  if (!(await ensureFfmpeg())) {
    const one = await fetchInlineImage(url);
    return one ? [one] : [];
  }
  const key = cid.replace(/[^a-zA-Z0-9]/g, "");
  const src = join(tmpdir(), `g-${key}.bin`);
  const outs: string[] = [];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    await writeFile(src, Buffer.from(await res.arrayBuffer()));
    let dur = NaN;
    try {
      const { stdout } = await execFileAsync(
        "ffprobe",
        ["-v", "error", "-show_entries", "format=duration", "-of", "default=nokey=1:noprint_wrappers=1", src],
        { timeout: 10000 },
      );
      dur = parseFloat(stdout.trim());
    } catch {
      /* no ffprobe -> use fixed second offsets below */
    }
    const fracs = [0.1, 0.5, 0.92]; // start / middle / end — catches text that only appears late
    const frames: InlineImage[] = [];
    for (let i = 0; i < fracs.length; i++) {
      const out = join(tmpdir(), `g-${key}-${i}.jpg`);
      outs.push(out);
      const t = Number.isFinite(dur) && dur > 0 ? (dur * fracs[i]).toFixed(2) : (i * 0.5).toFixed(2);
      try {
        await execFileAsync("ffmpeg", ["-y", "-loglevel", "error", "-ss", t, "-i", src, "-frames:v", "1", out], { timeout: 20000 });
        const data = (await readFile(out)).toString("base64");
        if (data) frames.push({ media_type: "image/jpeg", data });
      } catch {
        /* this frame failed -> skip it, the others still give the arc */
      }
    }
    if (frames.length) return frames;
    const one = await fetchInlineImage(url); // extraction gave nothing -> at least the first frame
    return one ? [one] : [];
  } catch {
    return [];
  } finally {
    await unlink(src).catch(() => {});
    for (const o of outs) await unlink(o).catch(() => {});
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
  let processed = 0; // comments we got a final decision for (a live model verdict, not a fetch skip)
  let errorSkips = 0; // of those, how many were API-error skips — used for the outage dead-man's-switch
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
    const allOwnerReplies = conversation
      .filter((c) => c.username === me && (c.text ?? "").trim().length > 0 && (c.text ?? "").length <= 280)
      .sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""))
      .map((c) => c.text as string);
    // The anti-repeat PROMPT block is windowed (token cost); the bare-stamp dedup uses the FULL list.
    const recentOwnerReplies = allOwnerReplies.slice(-config.antiRepeatWindow);
    const postedThisRun: string[] = [];

    // Unanswered = we have NO local record of replying AND no live reply from us in the
    // thread. state.hasReplied is the hard backstop against double-posting: once we have
    // posted to a comment we NEVER reply to it again, even if our reply has not surfaced in
    // the live conversation yet — it may be lagging on the API, or HELD because the commenter's
    // account requires comment approval. Relying on answeredByMe alone made the bot reply 2-3
    // times to those (it never saw its own pending reply). (Trade-off: if the owner deletes a
    // bot reply it will not be re-answered automatically — clearing the comment id from
    // state.json's repliedCommentIds re-enables that, which is the right place for it.)
    const wantsReply = (c: ThreadsReply): boolean =>
      c.username !== me &&
      isVisible(c) &&
      ((c.text ?? "").trim().length >= config.minCommentLength ||
        ((c.media_type === "IMAGE" || c.media_type === "VIDEO") && !!c.media_url) ||
        !!c.gif_url) && // a bare GIF (no text) is still worth reacting to
      !state.hasReplied(c.id) && // local record — never post twice, even if our reply is pending/lagging
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
    // Threads we're already committed to (multi-turn follow-ups + answer-thread subs) get a
    // ranking bonus inside selectCandidates so they survive the per-post cap instead of being
    // sliced out behind fresh banter on a viral post.
    const committed = new Set<string>([...followUpContext.keys(), ...inAnswerThreadIds]);
    const candidates = selectCandidates(pool, committed).slice(0, perPostRemaining);

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
      } else if (c.gif_url) {
        // A GIF attached via the Threads GIPHY picker comes back as media_type TEXT_POST with the
        // GIF only in gif_url (no VIDEO type, no media_url). Extract SEVERAL frames so vision reads
        // the whole reaction arc, not just frame 1 — the punchline/on-screen text often lands in a
        // LATER frame (the "shocked face" -> "I WON" miss the owner caught).
        commentImages = await loadCommentGifFrames(c.gif_url, c.id);
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
      let escalated = false;
      // Escalate to the quality model when the category is accuracy-critical (corrections/teaching/
      // reference), OR triage flagged an unidentifiable reference (needs_lookup), OR the comment
      // carries a GIF/image we can show it. Reaction GIFs are usually pop-culture references (a
      // person, a movie scene) and the cheap Haiku triage names them poorly; the quality model has
      // stronger vision AND web search (Sonnet escalations always have it available), so it identifies
      // the reference and tops it precisely instead of a generic reaction. Bounded to image/GIF
      // comments only, which are a small fraction of the volume (owner accepted the per-GIF cost).
      const hasVisibleMedia = commentImages.length > 0;
      const wantsLookup = d.decision === "reply" && config.webSearch && (d.needs_lookup === true || hasVisibleMedia);
      if (d.decision === "reply" && (config.escalateCategories.includes(d.category) || wantsLookup)) {
        // Web search on the "reference" re-run and on any lookup escalation (to identify an
        // unrecognized movie/show/meme/person); medical correct/teach escalations rely on vetted facts.
        const allowSearch = config.webSearch && (d.category === "reference" || wantsLookup);
        console.log(`        (escalating ${d.category}${wantsLookup ? " +lookup" : ""} to ${config.model}${allowSearch ? " + web search" : ""})`);
        d = await classifyAndDraft({ ...baseInput, modelOverride: config.model, allowSearch });
        escalated = true;
      }
      if (!config.educationalReplies && (d.category === "correct" || d.category === "teach")) {
        d = { ...d, decision: "skip", reply_text: "", reason: `${d.reason} | educational replies off` };
      }
      processed += 1;
      if (d.decision === "skip" && /^error:/.test(d.reason)) errorSkips += 1;
      printRow(c.text ?? "", d);

      if (d.decision === "skip") {
        skipCounts[d.category] = (skipCounts[d.category] ?? 0) + 1;
        // Cache the skip so we don't re-classify this comment on every 10-min poll all night (the
        // main cost leak), with two carve-outs that MUST stay re-checkable: transient API-error
        // skips (retry later) and spoiler-guard skips (a correct guess held pre-reveal has to be
        // re-judged once the answer is public so it can finally get its "nailed it"). Everything
        // else: cache immediately if the category is clearly final OR the pricier quality model
        // already saw it (escalation IS the second opinion); a plain Haiku skip in a soft category
        // (banter/affirm/empathize) might be a cheap-model misread, so only cache it after it
        // repeats the same skip a few polls in a row.
        // Only a true API error is worth retrying next poll. "no submit_reply" is NOT transient
        // (reply.ts already retries it once with a forced tool) — leaving it re-checkable made an
        // escalation that never submits re-run its pricey Sonnet+search call every poll all night.
        const transient = /^error:/.test(d.reason);
        const spoilerHeld = d.reason.includes("spoiler guard");
        const final = ["spam", "complaint", "personal_medical", "other"].includes(d.category);
        // Follow-ups + answer-thread subs are the owner's engagement threads. A clearly-final
        // skip (spam/other noise like a lone emoji) still caches, but a SOFT skip on one of these
        // stays re-checkable instead of soft-caching: a single cheap-model misread of a warm
        // reaction must never permanently silence a thread the owner cares about.
        const committedThread = committed.has(c.id);
        if (posting && !transient && !spoilerHeld) {
          if (final || escalated) state.markSkipped(c.id);
          else if (!committedThread) state.recordSoftSkip(c.id, 3);
        }
        continue;
      }
      // Mechanical voice enforcement (audit: the prose rules for these are not holding on their
      // own) — strip the "genuinely" tic, space the 🤣 laugh-track to ~1 in 6, and rotate a bare
      // check-mark stamp so the same one never posts twice on a post. stripTics/throttleLaugh only
      // remove characters and dedupeStamp only swaps a bare stamp, so the length/spoiler checks stay valid.
      const recent = [...recentOwnerReplies, ...postedThisRun];
      // Bare-stamp dedup checks the WHOLE post's replies (not just the anti-repeat window) so the
      // same check-mark never repeats even on a 100+ reply night (the "That's the one ✅ ×3" case);
      // the 🤣 throttle stays on the recent window since it is a recency-spacing thing.
      d = { ...d, reply_text: dedupeStamp(throttleLaugh(stripTics(d.reply_text), recent), [...allOwnerReplies, ...postedThisRun]) };
      postedThisRun.push(d.reply_text);
      // Curated GIF gate: banter-only (sanitize already enforced that), never on a bot-question or a
      // follow-up thread, probability + hard per-post/per-day caps. A reaction GIF is not a spoiler,
      // so it is allowed during the guessing window too (owner, 2026-07-04 — moderate loosening: the
      // funniest banter lands before the reveal). Any miss -> a normal text reply. pickGif returns
      // null if no on-tag GIF is available (never substitutes).
      // RARE product plug. The in-voice product MENTION already lives in reply_text (the model wrote
      // it; sanitize blocked tender/critical categories). ASK-ONLY LINKS: the raw URL (owned by code,
      // never model-written) is appended ONLY when the commenter explicitly asked for it
      // (promo_explicit) AND the link caps allow (1/post, 2/day) — this keeps external-link frequency
      // low, the main spam/reach signal. Softer openings just name the product, no link. Never with a GIF.
      const product = config.promoReplies && d.promo_product ? getProduct(d.promo_product) : null;
      const attachLink =
        product &&
        d.promo_explicit &&
        !isBotQuestion(c.text) &&
        state.promosOnPost(post.id) < config.promoMaxPerPost &&
        state.promosToday() < config.promoMaxPerDay &&
        d.reply_text.length + product.url.length + 2 <= 495;
      const promo = attachLink ? product : null; // "promo" now means "a LINK is being posted"
      const replyText = attachLink ? `${d.reply_text}\n${product!.url}` : d.reply_text;
      const gif =
        config.gifReplies &&
        d.gif_tag &&
        !promo && // a plug and a GIF in one reply is too loud — the link wins
        !followUpContext.has(c.id) &&
        !isBotQuestion(c.text) &&
        state.gifsOnPost(post.id) < config.gifMaxPerPost &&
        state.gifsToday() < config.gifMaxPerDay &&
        Math.random() < config.gifChance
          ? pickGif(d.gif_tag, state.recentGifs())
          : null;
      if (posting) {
        try {
          await postReply(c.id, replyText, undefined, gif?.gif_id);
          state.markReplied(c.id, post.id);
          if (gif) {
            state.markGifPosted(post.id, gif.gif_id);
            console.log(`        (+ GIF ${gif.tag}: ${gif.desc})`);
          }
          if (promo && replyText !== d.reply_text) {
            state.markPromoPosted(post.id); // cap tracks LINKS, not mentions
            console.log(`        (+ promo LINK ${promo.tag}: ${promo.url})`);
          } else if (product) {
            console.log(`        (+ mentioned ${product.tag}, no link — not an explicit ask${d.promo_explicit ? " (cap hit)" : ""})`);
          }
          replied += 1;
        } catch (err) {
          console.error(`    ! post failed for ${c.id}: ${(err as Error).message}`);
        }
      } else {
        if (gif) console.log(`        (+ would attach GIF ${gif.tag}: ${gif.desc})`);
        if (promo) console.log(`        (+ would attach LINK ${promo.tag}: ${promo.url})`);
        else if (product) console.log(`        (+ would mention ${product.tag}, no link)`);
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
      // convByPost is only populated after a successful conversation fetch in the comment loop;
      // if that fetch errored (or this post was skipped) conv is undefined and the duplicate
      // guard below would be silently skipped, leaving only state.hasAnswered — so a manually
      // pinned answer plus a fetch error could double-post. Fetch the conversation now so the
      // guard always runs; if even this fetch fails, fall back to the state guard alone.
      let conv = convByPost.get(post.id);
      if (!conv) {
        try {
          conv = await getConversation(post.id);
          convByPost.set(post.id, conv);
        } catch (err) {
          console.error(`  ! answer dup-check fetch failed for ${sc}: ${(err as Error).message}`);
        }
      }
      // Fail CLOSED: if we could not read the conversation we cannot tell whether the answer is
      // already up (e.g. a manually pinned "Answer:" the state file doesn't know about), so skip
      // this run rather than risk a duplicate public answer — a later poll retries.
      if (!conv) continue;
      if (answerFromConversation(conv, me) || answerAlreadyPosted(conv, me, entry.breakdown)) {
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

  // Outage dead-man's-switch: if EVERY comment we classified this run error-skipped (dead API key,
  // billing lapse, Anthropic outage) the bot posted nothing while every poll still exits 0 and the
  // job stays green. Exit non-zero so the workflow's 6-consecutive-failure alarm fires instead of
  // the outage hiding for days. Requires processed > 0 so a normal quiet poll never trips it.
  if (posting && processed > 0 && errorSkips === processed) {
    console.error(`All ${processed} classification(s) errored — likely an API outage. Failing the run so it surfaces.`);
    process.exitCode = 1;
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
