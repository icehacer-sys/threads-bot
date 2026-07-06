// Tiny file-backed state: which comments we've replied to, and today's count.
// Good enough for a prototype / cron-on-a-box. For serverless (Vercel) swap this
// for a real store (Vercel KV, Supabase) — same interface.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "./config";

interface StateShape {
  repliedCommentIds: string[];
  answeredPostIds: string[];
  postCounts: Record<string, number>;
  daily: { date: string; count: number };
  /** Resolved pinned-post shortcode -> media id, so a URL is only matched against the post list once. */
  pinnedResolved?: Record<string, string>;
  /** Comments we classified and chose to SKIP, so we never re-classify them (the main cost leak). */
  skippedCommentIds?: string[];
  /** Consecutive "soft" skip counts per comment, before it graduates to skippedCommentIds. */
  skipStrikes?: Record<string, number>;
  /** Curated-GIF rarity tracking: GIFs attached per post, per cap-day, and recently-used ids. */
  gifPostCounts?: Record<string, number>;
  gifDaily?: { date: string; count: number };
  recentGifIds?: string[];
  /** Product-plug rarity tracking: promos per post and per cap-day (mirrors the GIF caps). */
  promoPostCounts?: Record<string, number>;
  promoDaily?: { date: string; count: number };
}

function today(): string {
  // "Cap day" = the bot's local day shifted to roll at MIDDAY, not midnight. The active window is
  // 9 PM-9 AM Cairo and crosses midnight, so a midnight rollover would split one night across two
  // cap-days (letting the daily cap reset mid-shift). Subtracting 12h moves the rollover to ~noon
  // Cairo, when the bot is idle, so the whole overnight shift always sits on ONE cap-day.
  return new Intl.DateTimeFormat("en-CA", { timeZone: config.activeTz || "UTC" }).format(
    new Date(Date.now() - 12 * 60 * 60 * 1000),
  );
}

export class State {
  private replied: Set<string>;
  private answered: Set<string>;
  private postCounts: Record<string, number>;
  private daily: { date: string; count: number };
  private pinnedResolved: Record<string, string>;
  private skipped: Set<string>;
  private skipStrikes: Record<string, number>;
  private gifPostCounts: Record<string, number>;
  private gifDaily: { date: string; count: number };
  private recentGifIds: string[];
  private promoPostCounts: Record<string, number>;
  private promoDaily: { date: string; count: number };
  private file: string;

  // stateFile defaults to the Threads state; the Facebook reply loop passes its own path
  // (config.fbStateFile) so the two never share a replied-log or daily counter.
  constructor(stateFile: string = config.stateFile) {
    this.file = stateFile;
    let loaded: StateShape | null = null;
    if (existsSync(this.file)) {
      try {
        loaded = JSON.parse(readFileSync(this.file, "utf8")) as StateShape;
      } catch {
        loaded = null;
      }
    }
    this.replied = new Set(loaded?.repliedCommentIds ?? []);
    this.answered = new Set(loaded?.answeredPostIds ?? []);
    this.postCounts = loaded?.postCounts ?? {};
    this.pinnedResolved = loaded?.pinnedResolved ?? {};
    this.skipped = new Set(loaded?.skippedCommentIds ?? []);
    this.skipStrikes = loaded?.skipStrikes ?? {};
    this.gifPostCounts = loaded?.gifPostCounts ?? {};
    this.gifDaily =
      loaded?.gifDaily && loaded.gifDaily.date === today() ? loaded.gifDaily : { date: today(), count: 0 };
    this.recentGifIds = loaded?.recentGifIds ?? [];
    this.promoPostCounts = loaded?.promoPostCounts ?? {};
    this.promoDaily =
      loaded?.promoDaily && loaded.promoDaily.date === today() ? loaded.promoDaily : { date: today(), count: 0 };
    this.daily =
      loaded?.daily && loaded.daily.date === today() ? loaded.daily : { date: today(), count: 0 };
  }

  hasSkipped(commentId: string): boolean {
    return this.skipped.has(commentId);
  }

  markSkipped(commentId: string): void {
    this.skipped.add(commentId);
    delete this.skipStrikes[commentId];
    this.save();
  }

  /**
   * A "soft" skip in a category a cheap-model misread could flip (banter/affirm/empathize): count
   * consecutive identical skips and only mark the comment permanently skipped once it repeats
   * `threshold` polls in a row — so a one-off Haiku misread of a genuine question still gets
   * re-checked next poll instead of being silenced forever.
   */
  recordSoftSkip(commentId: string, threshold: number): void {
    const n = (this.skipStrikes[commentId] ?? 0) + 1;
    if (n >= threshold) {
      this.skipped.add(commentId);
      delete this.skipStrikes[commentId];
    } else {
      this.skipStrikes[commentId] = n;
    }
    this.save();
  }

  // --- curated GIF rarity (mirrors the reply per-post/per-day caps) ---
  gifsOnPost(postId: string): number {
    return this.gifPostCounts[postId] ?? 0;
  }

  gifsToday(): number {
    return this.gifDaily.date === today() ? this.gifDaily.count : 0;
  }

  recentGifs(): string[] {
    return this.recentGifIds;
  }

  markGifPosted(postId: string, gifId: string): void {
    this.gifPostCounts[postId] = (this.gifPostCounts[postId] ?? 0) + 1;
    this.gifDaily = { date: today(), count: this.gifsToday() + 1 };
    this.recentGifIds = [...this.recentGifIds, gifId].slice(-8);
    this.save();
  }

  // --- product-plug rarity (mirrors the GIF caps) ---
  promosOnPost(postId: string): number {
    return this.promoPostCounts[postId] ?? 0;
  }

  promosToday(): number {
    return this.promoDaily.date === today() ? this.promoDaily.count : 0;
  }

  markPromoPosted(postId: string): void {
    this.promoPostCounts[postId] = (this.promoPostCounts[postId] ?? 0) + 1;
    this.promoDaily = { date: today(), count: this.promosToday() + 1 };
    this.save();
  }

  resolvedPinned(key: string): string | undefined {
    return this.pinnedResolved[key];
  }

  setResolvedPinned(key: string, id: string): void {
    this.pinnedResolved[key] = id;
    this.save();
  }

  hasReplied(commentId: string): boolean {
    return this.replied.has(commentId);
  }

  markReplied(commentId: string, postId: string): void {
    this.replied.add(commentId);
    this.postCounts[postId] = (this.postCounts[postId] ?? 0) + 1;
    this.daily.count += 1;
    this.save();
  }

  repliedToPost(postId: string): number {
    return this.postCounts[postId] ?? 0;
  }

  hasAnswered(postId: string): boolean {
    return this.answered.has(postId);
  }

  markAnswered(postId: string): void {
    this.answered.add(postId);
    this.save();
  }

  repliedToday(): number {
    return this.daily.date === today() ? this.daily.count : 0;
  }

  remainingToday(): number {
    return Math.max(0, config.dailyCap - this.repliedToday());
  }

  private save(): void {
    const out: StateShape = {
      repliedCommentIds: [...this.replied],
      answeredPostIds: [...this.answered],
      postCounts: this.postCounts,
      daily: this.daily,
      pinnedResolved: this.pinnedResolved,
      skippedCommentIds: [...this.skipped],
      skipStrikes: this.skipStrikes,
      gifPostCounts: this.gifPostCounts,
      gifDaily: this.gifDaily,
      recentGifIds: this.recentGifIds,
      promoPostCounts: this.promoPostCounts,
      promoDaily: this.promoDaily,
    };
    writeFileSync(this.file, JSON.stringify(out, null, 2));
  }
}
