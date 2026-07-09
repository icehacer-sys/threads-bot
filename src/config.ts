// Central configuration. Tunables come from env vars with safe defaults.
// Secrets are read lazily via requireEnv() so `npm run demo` works with only ANTHROPIC_API_KEY.

// Load threads-bot/.env into process.env before reading any config below,
// regardless of which directory the process was started from.
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env"), quiet: true });

export type Selection = "recent" | "engagement";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

// Active windows as [startHour, endHour) pairs in activeTz, from BOT_ACTIVE_WINDOWS
// (e.g. "20-2,4-10"). Each may wrap past midnight (start > end). Falls back to the
// single BOT_ACTIVE_START/END window when BOT_ACTIVE_WINDOWS is unset.
function parseActiveWindows(): Array<[number, number]> {
  const raw = (process.env.BOT_ACTIVE_WINDOWS ?? "").trim();
  if (raw) {
    const out: Array<[number, number]> = [];
    for (const part of raw.split(",")) {
      const m = part.trim().match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
      if (m) out.push([Number(m[1]), Number(m[2])]);
    }
    if (out.length) return out;
  }
  return [[num("BOT_ACTIVE_START", 0), num("BOT_ACTIVE_END", 24)]];
}

export const config = {
  // Two-tier models. The cheap triageModel drafts/classifies EVERY comment; only
  // accuracy-critical categories (escalateCategories) are re-drafted by the pricier,
  // higher-quality `model`. Set BOT_TRIAGE_MODEL=<same as model> to disable two-tier.
  model: process.env.BOT_MODEL ?? "claude-sonnet-4-6",
  triageModel: process.env.BOT_TRIAGE_MODEL ?? "claude-haiku-4-5-20251001",
  // Web search depends on 'reference' being present (search is gated to that category).
  escalateCategories: (process.env.BOT_ESCALATE ?? "correct,teach,reference")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // How many of our recent replies to feed back in as the "don't repeat these" list.
  // Sent uncached on every call, so smaller = cheaper; 15 is plenty for variety.
  antiRepeatWindow: num("BOT_ANTIREPEAT", 30),

  // Let the model web-search a reference it doesn't recognize (it decides when;
  // most comments won't trigger one). Adds a small per-search cost. Off by default.
  webSearch: (process.env.BOT_WEB_SEARCH ?? "off").toLowerCase() === "on",

  // Reply to posts within this many hours. 0 = no time limit (rely on the per-post cap).
  windowHours: num("BOT_WINDOW_HOURS", 0),
  maxPostsScanned: num("BOT_MAX_POSTS", 5),

  // Only act on the single newest post (cleanest for a once-a-day challenge).
  newestOnly: (process.env.BOT_NEWEST_ONLY ?? "off").toLowerCase() === "on",

  // Posts the bot ALWAYS scans on top of the daily post (e.g. a pinned intro thread).
  // It replies to any comment there that has no reply yet, every run, and bypasses
  // newest-only, the time window, and the cumulative per-post cap (bounded only by the
  // daily cap). Comma-separated: media IDs or post URLs/shortcodes. Empty = off.
  // Find a post's media id with: npm run dry -- --list
  pinnedPostIds: (process.env.BOT_PINNED_POSTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // Selection + budget
  selection: (process.env.BOT_SELECTION as Selection) ?? "recent",
  dailyCap: num("BOT_DAILY_CAP", 250), // Threads' ~250/day ceiling is the hard backstop
  perPostCap: num("BOT_PER_POST_CAP", 220), // hard cap on total replies per post; sits below the daily cap

  // Ignore trivially short comments (single emoji, "👍", etc.)
  minCommentLength: num("BOT_MIN_COMMENT_LEN", 3),

  // Reply behaviour. With educationalReplies off, "correct" and "teach" comments
  // (which generate medical statements) are left for you to handle by hand.
  educationalReplies: (process.env.BOT_EDUCATIONAL ?? "on").toLowerCase() !== "off",

  // Answer post: posts your written breakdown as a reply, with the explanation
  // spoiler-blurred, once a post is answerDelayHours old. You pin it manually.
  answerEnabled: (process.env.BOT_ANSWER ?? "on").toLowerCase() !== "off",
  answerDelayHours: num("BOT_ANSWER_DELAY_HOURS", 1),

  // Blur the answer breakdown as a spoiler. Off (default) = post the answer in full, visible.
  answerUseSpoiler: (process.env.BOT_ANSWER_SPOILER ?? "off").toLowerCase() === "on",

  // Send the post's X-ray image to the model so replies can "see" the case.
  visionEnabled: (process.env.BOT_VISION ?? "on").toLowerCase() !== "off",

  // Active-hours gate for live mode. The cloud runner is UTC, so this is TZ-aware:
  // only run when local time in activeTz is within [activeStart, activeEnd).
  // Empty activeTz = always active.
  activeTz: process.env.BOT_ACTIVE_TZ ?? "",
  activeStart: num("BOT_ACTIVE_START", 0),
  activeEnd: num("BOT_ACTIVE_END", 24),
  // One or more active windows (overrides start/end). E.g. "20-2,4-10".
  activeWindows: parseActiveWindows(),

  // Threads API
  graphBase: "https://graph.threads.net/v1.0",
  threadsUserId: process.env.THREADS_USER_ID ?? "me",

  // Read-only bridge to the xray-cases publisher repo: lets the bot look up the live
  // case's diagnosis (to judge guesses) before the answer is publicly posted. Empty
  // disables the bridge. Fully guarded — any failure falls back to answers.json/pinned.
  xrayCasesRawBase: (process.env.BOT_XRAY_CASES_BASE ?? "https://raw.githubusercontent.com/icehacer-sys/xray-cases/main").replace(/\/+$/, ""),

  // --- Facebook Page comment replies ---
  // The xray-poster cross-posts the daily case to the FB Page; this bot replies to its
  // comments (npm run fb:live). Reuses the same FB_PAGE_ID + FB_PAGE_ACCESS_TOKEN the poster
  // uses. Off by default; flip BOT_FACEBOOK_REPLY=on once the token is in place.
  fbGraphBase: process.env.FB_GRAPH_BASE ?? "https://graph.facebook.com/v21.0",
  facebookReply: (process.env.BOT_FACEBOOK_REPLY ?? "off").toLowerCase() === "on",
  fbMaxPosts: num("BOT_FB_MAX_POSTS", 5),
  // Separate state file so FB's replied-log + daily counter never share the Threads budget.
  fbStateFile: process.env.BOT_FB_STATE_FILE ?? "./fb-state.json",

  // --- Curated GIF replies (Threads only) ---
  // Rarely attach a curated reaction GIF (Threads `gif_attachment` + a hand-picked GIPHY id
  // from data/gifs.json) to a top-tier banter reply. Off by default: curate data/gifs.json
  // first (copy data/gifs.example.json), then flip BOT_GIF_REPLIES=on. A rejected GIF container
  // degrades to a plain-text reply, so this can never break a reply. Threads-only (not FB).
  gifReplies: (process.env.BOT_GIF_REPLIES ?? "off").toLowerCase() === "on",
  gifChance: num("BOT_GIF_CHANCE", 0.5), // probability gate on a model-flagged banger
  gifMaxPerPost: num("BOT_GIF_MAX_PER_POST", 1), // hard: never a second GIF on one post
  gifMaxPerDay: num("BOT_GIF_MAX_PER_DAY", 2),

  // RARE product plug (catalog in data/products.json) woven into a reply when the comment gives a
  // genuine opening ("is there a book?", superfan gushing). The model picks the product; CODE appends
  // the URL (never model-written). Hard caps below keep it from ever reading as spam. On by default —
  // an empty products.json leaves it inert. Set BOT_PROMO=off to disable.
  promoReplies: (process.env.BOT_PROMO ?? "on").toLowerCase() !== "off",
  promoMaxPerPost: num("BOT_PROMO_PER_POST", 1), // hard: never a second LINK on one post
  promoMaxPerDay: num("BOT_PROMO_PER_DAY", 2), // link-frequency is the main spam signal; kept low (owner, 2/day). Product MENTIONS (no link) are not capped here.

  // Local state file (replied-comment log + daily counter)
  stateFile: process.env.BOT_STATE_FILE ?? "./state.json",

  // Live posting safety latch
  confirmLive: (process.env.BOT_CONFIRM_LIVE ?? "").toLowerCase() === "yes",
};

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required env var ${name}. Copy .env.example to .env and fill it in.`);
  }
  return v;
}
