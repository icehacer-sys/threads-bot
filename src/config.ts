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
  // Model (see README for the Claude vs Gemini recommendation)
  model: process.env.BOT_MODEL ?? "claude-sonnet-4-6",

  // Let the model web-search a reference it doesn't recognize (it decides when;
  // most comments won't trigger one). Adds a small per-search cost. Off by default.
  webSearch: (process.env.BOT_WEB_SEARCH ?? "off").toLowerCase() === "on",

  // Reply to posts within this many hours. 0 = no time limit (rely on the per-post cap).
  windowHours: num("BOT_WINDOW_HOURS", 0),
  maxPostsScanned: num("BOT_MAX_POSTS", 5),

  // Only act on the single newest post (cleanest for a once-a-day challenge).
  newestOnly: (process.env.BOT_NEWEST_ONLY ?? "off").toLowerCase() === "on",

  // Selection + budget
  selection: (process.env.BOT_SELECTION as Selection) ?? "recent",
  dailyCap: num("BOT_DAILY_CAP", 200), // safety backstop, stays under Threads' ~250/day
  perPostCap: num("BOT_PER_POST_CAP", 100), // hard cap on total replies per post

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
