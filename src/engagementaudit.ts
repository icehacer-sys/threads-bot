// Read-only engagement audit for @mdnoteslab.
//
// The Threads Insights panel shows reach and interaction TOTALS but not the rates that decide
// whether the account is healthy, and it exposes no history: a post's insights are a cumulative
// snapshot taken now, so "what did this post look like at T+24h" is unrecoverable for anything
// already published. This script derives the rates the panel withholds and writes a DATED
// snapshot, so repeated runs build the time series that does not exist today.
//
// Two things the API genuinely cannot give us, and which the report must say out loud rather
// than approximate:
//   - `viewers` (unique people) is an app-only panel. Only per-VIEW rates are computable here.
//   - daily follows/unfollows are app-only charts. The account's north star (follows per 100K
//     non-follower viewers) has to be read off that chart by hand.
//
// Bot reply latency is likewise absent from state.json (repliedCommentIds is a bare id array
// with no times), so it is reconstructed from API reply timestamps on a sample of posts.
//
// NEVER posts. NEVER touches state.json.
// Run: npx tsx src/engagementaudit.ts [--days=90] [--latency=10] [--no-latency] [--out=.]

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, requireEnv } from "./config.js";
import { CHALLENGE } from "./cases.js";
import { getAllMyPostsWithMedia, getMyUsername, type ThreadsPost, type ThreadsReply } from "./threads.js";

// ---------------------------------------------------------------- args

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (hit == null) return undefined;
  const eq = hit.indexOf("=");
  return eq === -1 ? "" : hit.slice(eq + 1);
}
const DAYS = Number(flag("days") || 90);
const LATENCY_N = flag("no-latency") !== undefined ? 0 : Number(flag("latency") || 10);
const OUT_DIR = flag("out") || ".";

// A post younger than this is still accruing views, so comparing it to a mature post is the
// single easiest way to manufacture a fake finding (today's post at 4.1K views reads as a 2.8%
// engagement rate purely because its views have not landed yet). 72h, not 24h, because the
// per-post history needed for a true T+24h cut does not exist retroactively.
const MATURE_HOURS = 72;

// ---------------------------------------------------------------- http

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(url: string | URL, attempts = 4): Promise<Response> {
  const token = requireEnv("THREADS_ACCESS_TOKEN");
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      // A 90-post insights sweep is exactly where the rate limiter bites, and it shares a token
      // with the live reply bot -- so honour Retry-After and back off rather than burning the run.
      if (res.status === 429 || res.status >= 500) {
        if (i === attempts - 1) return res;
        const ra = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** i + Math.floor(Math.random() * 400));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (i === attempts - 1) throw e;
      await sleep(800 * 2 ** i + Math.floor(Math.random() * 400));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function api<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = new URL(config.graphBase + path);
  for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, String(v));
  const res = await fetchRetry(url);
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json as T;
}

interface InsightItem {
  name?: string;
  values?: { value?: unknown }[];
  total_value?: { value?: unknown };
}

// ---------------------------------------------------------------- insights

const POST_METRICS = ["views", "likes", "replies", "reposts", "quotes", "shares"] as const;
type PostMetric = (typeof POST_METRICS)[number];

/** Per-post insights. A failure degrades to {err} instead of killing the sweep (postviews.ts pattern). */
async function postInsights(id: string): Promise<{ vals: Partial<Record<PostMetric, number>>; err?: string }> {
  try {
    const j = await api<{ data?: InsightItem[] }>(`/${id}/insights`, { metric: POST_METRICS.join(",") });
    const vals: Partial<Record<PostMetric, number>> = {};
    for (const d of j.data ?? []) {
      const v = d.values?.[0]?.value ?? d.total_value?.value;
      if (typeof v === "number" && d.name) vals[d.name as PostMetric] = v;
    }
    return { vals };
  } catch (e) {
    return { vals: {}, err: (e as Error).message.slice(0, 160) };
  }
}

// This endpoint has never been called from this repo, so the metric list is UNVERIFIED. Probe each
// name on its own: one unsupported metric in a comma list fails the whole request, which would
// look like "the endpoint does not work" when in fact five of seven metrics are fine.
const ACCOUNT_METRICS = [
  "views",
  "likes",
  "replies",
  "reposts",
  "quotes",
  "followers_count",
  "follower_demographics",
] as const;

async function accountInsights(sinceSec: number, untilSec: number): Promise<{ ok: Record<string, unknown>; failed: string[] }> {
  const ok: Record<string, unknown> = {};
  const failed: string[] = [];
  for (const m of ACCOUNT_METRICS) {
    const q: Record<string, string | number | undefined> = { metric: m };
    // followers_count and follower_demographics are lifetime/snapshot metrics and reject a window.
    if (m !== "follower_demographics" && m !== "followers_count") {
      q.since = sinceSec;
      q.until = untilSec;
    }
    if (m === "follower_demographics") q.breakdown = "country";
    try {
      const j = await api<{ data?: InsightItem[] }>(`/${config.threadsUserId}/threads_insights`, q);
      ok[m] = j.data ?? [];
    } catch (e) {
      failed.push(`${m} -> ${(e as Error).message.slice(0, 180)}`);
    }
  }
  return { ok, failed };
}

// ---------------------------------------------------------------- conversation (latency)

/**
 * Full conversation under a post, OLDEST-first.
 *
 * threads.ts getConversation() hardcodes reverse:"true" so that a viral thread's newest comments
 * survive the 25-page cap -- correct for the bot, wrong here: reply latency lives in the EARLIEST
 * comments, which are precisely the ones a newest-first fetch drops.
 */
async function conversationOldestFirst(mediaId: string, maxPages = 25): Promise<{ replies: ThreadsReply[]; capped: boolean }> {
  const first = new URL(`${config.graphBase}/${mediaId}/conversation`);
  first.searchParams.set("fields", "id,text,username,timestamp,replied_to");
  first.searchParams.set("reverse", "false");
  first.searchParams.set("limit", "100");

  let next: string | undefined = first.toString();
  const out: ThreadsReply[] = [];
  for (let page = 0; next && page < maxPages; page++) {
    const res = await fetchRetry(next);
    const json = (await res.json().catch(() => ({}))) as { data?: ThreadsReply[]; paging?: { next?: string } };
    if (!res.ok) throw new Error(`conversation ${mediaId} -> ${res.status}`);
    if (Array.isArray(json.data)) out.push(...json.data);
    next = json.paging?.next;
  }
  return { replies: out, capped: Boolean(next) };
}

// ---------------------------------------------------------------- helpers

function cairo(iso: string): { hour: number; weekday: string; date: string } {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    weekday: "short",
    hourCycle: "h23",
    hour: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(new Date(iso))) p[part.type] = part.value;
  return { hour: Number(p.hour ?? 0), weekday: p.weekday ?? "?", date: `${p.year}-${p.month}-${p.day}` };
}

const num = (n: number | null | undefined): string => (n == null ? "-" : n.toLocaleString("en-US"));
const dec = (n: number | null | undefined, d = 2): string => (n == null ? "-" : n.toFixed(d));

function pct(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, Math.round(p * (sortedAsc.length - 1))))];
}
/** True median: averages the two middle values on an even count. pct() is nearest-rank, which on
 *  a 2-post sample reported the larger value as "the median" and overstated the rate by 70%. */
function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length / 2;
  return s.length % 2 ? s[Math.floor(mid)] : (s[mid - 1] + s[mid]) / 2;
}

// ---------------------------------------------------------------- rows

interface PostRow {
  id: string;
  permalink?: string;
  timestamp: string;
  mediaType?: string;
  isChallenge: boolean;
  textLen: number;
  /** Raw-dump only (never printed to the committed report): lets a regex miss be diagnosed
   *  instead of silently shrinking the challenge-post denominator. */
  textHead: string;
  ageHours: number;
  cairoHour: number;
  cairoWeekday: string;
  cairoDate: string;
  views: number | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  quotes: number | null;
  shares: number | null;
  interactions: number | null;
  per1kViews: number | null;
  replyToLike: number | null;
  insightsError?: string;
}

interface LatencyRow {
  postId: string;
  parentId: string;
  ourReplyId: string;
  parentUser: string;
  latencyMin: number;
  repliedBack: boolean;
}

async function main(): Promise<void> {
  const started = Date.now();
  const me = await getMyUsername();
  console.log(`account: @${me} | window: ${DAYS}d | latency sample: ${LATENCY_N} posts\n`);

  const cutoff = Date.now() - DAYS * 24 * 3600 * 1000;
  const all: ThreadsPost[] = await getAllMyPostsWithMedia(600);
  const inWindow = all.filter((p) => p.timestamp != null && new Date(p.timestamp).getTime() >= cutoff);
  console.log(`posts on the edge: ${all.length} | inside ${DAYS}d: ${inWindow.length}`);

  const challenges = inWindow.filter((p) => CHALLENGE.test(p.text ?? ""));
  console.log(`challenge posts: ${challenges.length} | other (answers/banter/promo): ${inWindow.length - challenges.length}\n`);

  // ---- per-post insights
  const rows: PostRow[] = [];
  for (const [i, p] of inWindow.entries()) {
    const { vals, err } = await postInsights(p.id);
    const ts = p.timestamp ?? new Date().toISOString();
    const c = cairo(ts);
    const views = vals.views ?? null;
    const likes = vals.likes ?? null;
    const replies = vals.replies ?? null;
    const reposts = vals.reposts ?? null;
    const quotes = vals.quotes ?? null;
    const shares = vals.shares ?? null;
    // Threads counts likes + replies + reposts + quotes as "Interactions"; shares are reported
    // alongside but tracked separately here so the number stays comparable to the panel.
    const interactions =
      likes == null && replies == null && reposts == null && quotes == null
        ? null
        : (likes ?? 0) + (replies ?? 0) + (reposts ?? 0) + (quotes ?? 0);
    rows.push({
      id: p.id,
      permalink: p.permalink,
      timestamp: ts,
      mediaType: p.media_type,
      isChallenge: CHALLENGE.test(p.text ?? ""),
      textLen: (p.text ?? "").length,
      textHead: (p.text ?? "").replace(/\s+/g, " ").slice(0, 140),
      ageHours: (Date.now() - new Date(ts).getTime()) / 3600000,
      cairoHour: c.hour,
      cairoWeekday: c.weekday,
      cairoDate: c.date,
      views,
      likes,
      replies,
      reposts,
      quotes,
      shares,
      interactions,
      per1kViews: interactions != null && views ? (interactions / views) * 1000 : null,
      replyToLike: replies != null && likes ? replies / likes : null,
      insightsError: err,
    });
    if ((i + 1) % 20 === 0) console.log(`  insights ${i + 1}/${inWindow.length}`);
  }
  const failed = rows.filter((r) => r.insightsError);
  if (failed.length) console.log(`\n! ${failed.length} posts returned no insights (first: ${failed[0].insightsError})`);

  // ---- account level
  const untilSec = Math.floor(Date.now() / 1000);
  const sinceSec = Math.floor(cutoff / 1000);
  console.log(`\nprobing account-level threads_insights metrics...`);
  const acct = await accountInsights(sinceSec, untilSec);
  console.log(`  available: ${Object.keys(acct.ok).join(", ") || "(none)"}`);
  for (const f of acct.failed) console.log(`  unavailable: ${f}`);

  // ---- reply latency, reconstructed from API timestamps
  const latency: LatencyRow[] = [];
  const ourEarlyReplies: { postId: string; cairoDate: string; offsetsMin: number[] }[] = [];
  const cappedPosts: string[] = [];
  const sample = challenges.slice(0, LATENCY_N);
  if (sample.length) console.log(`\nreconstructing reply latency over ${sample.length} posts...`);
  for (const p of sample) {
    let conv: ThreadsReply[];
    try {
      const r = await conversationOldestFirst(p.id);
      conv = r.replies;
      if (r.capped) cappedPosts.push(p.id);
    } catch (e) {
      console.log(`  ! ${p.id}: ${(e as Error).message.slice(0, 90)}`);
      continue;
    }
    const byId = new Map(conv.map((r) => [r.id, r]));
    const mine = conv.filter((r) => r.username === me);
    const postT = new Date(p.timestamp ?? 0).getTime();

    // Q7: our own replies inside the first 90 minutes, as minute offsets from the post. Two answer
    // mechanisms exist (+20 min from xray-poster, +1h from this bot) -- this shows whether both fire.
    ourEarlyReplies.push({
      postId: p.id,
      cairoDate: cairo(p.timestamp ?? new Date().toISOString()).date,
      offsetsMin: mine
        .map((r) => (new Date(r.timestamp ?? 0).getTime() - postT) / 60000)
        .filter((m) => m >= 0 && m <= 90)
        .sort((a, b) => a - b)
        .map((m) => Math.round(m)),
    });

    for (const r of mine) {
      const parentId = r.replied_to?.id;
      if (!parentId) continue;
      const parent = byId.get(parentId);
      if (!parent || parent.username === me || !parent.timestamp || !r.timestamp) continue;
      const ourT = new Date(r.timestamp).getTime();
      const latMin = (ourT - new Date(parent.timestamp).getTime()) / 60000;
      if (latMin < 0) continue;
      latency.push({
        postId: p.id,
        parentId,
        ourReplyId: r.id,
        parentUser: parent.username ?? "?",
        latencyMin: latMin,
        // Did the person come back AFTER we answered? That return reply is the free engagement
        // signal the whole cadence experiment turns on.
        repliedBack: conv.some((x) => x.username === parent.username && new Date(x.timestamp ?? 0).getTime() > ourT),
      });
    }
  }

  // ---- report
  const stamp = new Date().toISOString().slice(0, 10);
  const mature = rows.filter((r) => r.isChallenge && r.ageHours >= MATURE_HOURS && r.views != null);
  const views = mature.map((r) => r.views as number).sort((a, b) => a - b);
  const totalViews = views.reduce((a, b) => a + b, 0);
  const top2 = views.slice(-2).reduce((a, b) => a + b, 0);
  const rates = mature.map((r) => r.per1kViews).filter((x): x is number => x != null);

  const L: string[] = [];
  L.push(`# Engagement audit — @${me}`, "");
  L.push(`Generated ${new Date().toISOString()} · window ${DAYS}d · maturity cutoff ${MATURE_HOURS}h`, "");
  L.push(`- posts on the edge: **${all.length}**, inside window: **${inWindow.length}**`);
  L.push(`- challenge posts: **${challenges.length}**, other: **${inWindow.length - challenges.length}**`);
  L.push(`- mature challenge posts used for every rate below: **${mature.length}**`);
  if (failed.length) L.push(`- posts with no insights returned: **${failed.length}**`);
  if (cappedPosts.length)
    L.push(`- **${cappedPosts.length} post(s) hit the 25-page conversation cap** — their latency rows are partial: ${cappedPosts.join(", ")}`);
  L.push("");
  L.push(`> \`viewers\` and daily follows/unfollows are app-only. Every rate here is per **view**,`);
  L.push(`> not per viewer, and the follows north star is not computable from this data.`, "");

  L.push(`## Account-level metrics`, "");
  L.push(`available: ${Object.keys(acct.ok).join(", ") || "(none)"}`);
  if (acct.failed.length) {
    L.push("", "unavailable:");
    for (const f of acct.failed) L.push(`- \`${f}\``);
  }
  L.push("");

  L.push(`## Reach distribution (mature challenge posts)`, "");
  L.push(`| stat | views |`, `|---|---|`);
  L.push(`| median | ${num(median(views))} |`);
  L.push(`| p90 | ${num(pct(views, 0.9))} |`);
  L.push(`| max | ${num(views[views.length - 1] ?? null)} |`);
  L.push(`| total | ${num(totalViews)} |`);
  L.push(`| top 2 posts' share | ${totalViews ? dec((top2 / totalViews) * 100, 1) : "-"}% |`);
  L.push("", `median interactions per 1,000 views: **${dec(median(rates))}**`, "");

  L.push(`## Publish hour (Cairo)`, "");
  const byHour = new Map<number, number>();
  for (const r of rows.filter((x) => x.isChallenge)) byHour.set(r.cairoHour, (byHour.get(r.cairoHour) ?? 0) + 1);
  L.push(`| hour | challenge posts |`, `|---|---|`);
  for (const [h, n] of [...byHour.entries()].sort((a, b) => a[0] - b[0])) L.push(`| ${String(h).padStart(2, "0")}:00 | ${n} |`);
  L.push("");

  L.push(`## Per-post (mature challenge posts, newest first)`, "");
  L.push(`| date (Cairo) | day | hr | views | likes | repl | rt | qt | sh | inter | /1k views | repl:like | chars |`);
  L.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const r of [...mature].sort((a, b) => b.timestamp.localeCompare(a.timestamp))) {
    L.push(
      `| ${r.cairoDate} | ${r.cairoWeekday} | ${String(r.cairoHour).padStart(2, "0")} | ${num(r.views)} | ${num(r.likes)} | ${num(r.replies)} | ${num(r.reposts)} | ${num(r.quotes)} | ${num(r.shares)} | ${num(r.interactions)} | ${dec(r.per1kViews)} | ${dec(r.replyToLike)} | ${r.textLen} |`,
    );
  }
  L.push("");

  L.push(`## Follow-spike cross-reference (22–24 Aug)`, "");
  L.push(`The one observed instance of the follow mechanism firing (~245/day vs a ~35/day baseline).`);
  L.push(`If these posts are NOT also reach outliers, something in them converted independent of reach.`, "");
  const spike = rows.filter((r) => r.isChallenge && r.cairoDate >= "2026-08-21" && r.cairoDate <= "2026-08-25");
  if (spike.length === 0) L.push(`_No challenge posts found in that date range inside the ${DAYS}d window._`);
  else {
    L.push(`| date | views | vs median | interactions | /1k views |`, `|---|---|---|---|---|`);
    const med = median(views);
    for (const r of spike.sort((a, b) => a.cairoDate.localeCompare(b.cairoDate))) {
      L.push(
        `| ${r.cairoDate} | ${num(r.views)} | ${med && r.views ? dec(r.views / med, 1) + "x" : "-"} | ${num(r.interactions)} | ${dec(r.per1kViews)} |`,
      );
    }
  }
  L.push("");

  L.push(`## Answer mechanisms — our own replies in the first 90 min`, "");
  L.push(`Two exist: +20 min (xray-poster \`BOT_ANSWER_DELAY_MIN\`) and +1h (this bot \`BOT_ANSWER_DELAY_HOURS\`).`, "");
  L.push(`| post date | our reply offsets (min) |`, `|---|---|`);
  for (const e of ourEarlyReplies) L.push(`| ${e.cairoDate} | ${e.offsetsMin.length ? e.offsetsMin.join(", ") : "(none)"} |`);
  L.push("");

  L.push(`## Reply latency vs reply-back rate`, "");
  if (latency.length === 0) L.push(`_No latency pairs reconstructed._`);
  else {
    const buckets: [string, (m: number) => boolean][] = [
      ["0-5 min", (m) => m <= 5],
      ["5-15 min", (m) => m > 5 && m <= 15],
      ["15-30 min", (m) => m > 15 && m <= 30],
      ["30-60 min", (m) => m > 30 && m <= 60],
      ["1-3 h", (m) => m > 60 && m <= 180],
      [">3 h", (m) => m > 180],
    ];
    L.push(`pairs: **${latency.length}** · median latency: **${dec(median(latency.map((x) => x.latencyMin)), 1)} min**`, "");
    L.push(`| latency | replies | replied back | rate |`, `|---|---|---|---|`);
    for (const [label, test] of buckets) {
      const b = latency.filter((x) => test(x.latencyMin));
      if (!b.length) continue;
      const back = b.filter((x) => x.repliedBack).length;
      L.push(`| ${label} | ${b.length} | ${back} | ${dec((back / b.length) * 100, 1)}% |`);
    }
  }
  L.push("");

  const mdPath = join(OUT_DIR, "data", `audit-${stamp}.md`);
  const rawPath = join(OUT_DIR, `_audit-raw-${stamp}.json`);
  writeFileSync(mdPath, L.join("\n"), "utf8");
  // Raw dump carries commenter usernames, so it goes to the `_*` gitignore pattern the repo
  // already uses for scratch analysis. This repo is PUBLIC -- it must never become tracked.
  writeFileSync(
    rawPath,
    JSON.stringify(
      { account: me, generated: new Date().toISOString(), days: DAYS, rows, latency, ourEarlyReplies, accountInsights: acct, cappedPosts },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`\nwrote ${mdPath}`);
  console.log(`wrote ${rawPath}  (gitignored: carries usernames)`);
  console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
