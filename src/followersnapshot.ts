// Daily follower snapshot — the measurement arm of the FOLLOW-CTA experiment.
//
// Threads' Insights panel shows daily Follows/Unfollows as CHARTS ONLY; the API exposes no
// follows metric at all. What it does expose is `followers_count` as a bare snapshot, so the
// daily series has to be BUILT by snapshotting it once a day. Consecutive deltas give net
// follower change, and since unfollows sit on a flat ~135-150/day floor (audit 2026-09-04),
// net + that floor is a usable proxy for gross follows.
//
// Net change is dominated by reach, so account-level daily `views` is captured alongside it --
// that one IS a real time series and comes back retroactively, which is what makes it possible
// to control for a 2.4M-view night swamping a ~20/night CTA effect.
//
// Runs at 18:00 UTC, exactly one hour before the 19:00 UTC challenge post, so the delta between
// two snapshots brackets one post's entire response window. Both times are fixed in UTC, so the
// gap survives the late-October Cairo DST shift.
//
// Read-only against the API. Appends to data/followers-log.json, one entry per date, idempotent.
// Run: npx tsx src/followersnapshot.ts

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config, requireEnv } from "./config.js";

const LOG = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "followers-log.json");

interface Entry {
  /** UTC date of the snapshot, YYYY-MM-DD. */
  date: string;
  takenAt: string;
  followersCount: number | null;
  /** Net change since the previous snapshot; null on the first entry. */
  netChange: number | null;
  /** Account-wide views for the day, from the daily series. Null when the day is not yet closed. */
  viewsThatDay: number | null;
}

interface InsightItem {
  name?: string;
  values?: { value?: unknown; end_time?: string }[];
  total_value?: { value?: unknown };
}

async function api<T>(path: string, query: Record<string, string | number>): Promise<T> {
  const token = requireEnv("THREADS_ACCESS_TOKEN");
  const url = new URL(config.graphBase + path);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json as T;
}

async function main(): Promise<void> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const fc = await api<{ data?: InsightItem[] }>(`/${config.threadsUserId}/threads_insights`, {
    metric: "followers_count",
  });
  const raw = fc.data?.[0]?.total_value?.value;
  const followersCount = typeof raw === "number" ? raw : null;
  if (followersCount == null) throw new Error(`followers_count missing: ${JSON.stringify(fc).slice(0, 200)}`);

  // Daily views for the past week, so a re-run backfills any day a snapshot was missed.
  const viewsByDate = new Map<string, number>();
  try {
    const v = await api<{ data?: InsightItem[] }>(`/${config.threadsUserId}/threads_insights`, {
      metric: "views",
      since: Math.floor(now.getTime() / 1000) - 8 * 86400,
      until: Math.floor(now.getTime() / 1000),
    });
    for (const d of v.data?.[0]?.values ?? []) {
      if (typeof d.value === "number" && d.end_time) viewsByDate.set(d.end_time.slice(0, 10), d.value);
    }
  } catch (e) {
    console.warn(`! daily views unavailable this run: ${(e as Error).message.slice(0, 120)}`);
  }

  const log: Entry[] = existsSync(LOG) ? (JSON.parse(readFileSync(LOG, "utf8")) as Entry[]) : [];
  const prev = log.filter((e) => e.date < today).sort((a, b) => a.date.localeCompare(b.date)).pop();

  const entry: Entry = {
    date: today,
    takenAt: now.toISOString(),
    followersCount,
    netChange: prev?.followersCount != null ? followersCount - prev.followersCount : null,
    viewsThatDay: viewsByDate.get(today) ?? null,
  };

  // Idempotent: a same-day re-run replaces today's entry rather than appending a second one,
  // which would make the next delta zero and silently corrupt the series.
  const i = log.findIndex((e) => e.date === today);
  if (i >= 0) log[i] = entry;
  else log.push(entry);

  // Backfill views for earlier days once their day closes.
  for (const e of log) {
    if (e.viewsThatDay == null && viewsByDate.has(e.date)) e.viewsThatDay = viewsByDate.get(e.date)!;
  }

  log.sort((a, b) => a.date.localeCompare(b.date));
  writeFileSync(LOG, JSON.stringify(log, null, 2), "utf8");

  console.log(
    `${today}: followers=${followersCount.toLocaleString()} ` +
      `net=${entry.netChange == null ? "n/a (first snapshot)" : (entry.netChange > 0 ? "+" : "") + entry.netChange} ` +
      `views=${entry.viewsThatDay?.toLocaleString() ?? "n/a"} | ${log.length} entries`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
