// Tiny file-backed state: which comments we've replied to, and today's count.
// Good enough for a prototype / cron-on-a-box. For serverless (Vercel) swap this
// for a real store (Vercel KV, Supabase) — same interface.

import { existsSync, readFileSync } from "node:fs";
import { config } from "./config";
import { atomicJson, checkpointState, PersistenceError, validPublications, type Publication, type PublicationStore } from "./persistence.js";

interface StateShape {
  revealHeldComments?: Record<string, string>;
  concernAcknowledgments?: Record<string, string>;
  ownerReviews?: Record<string, string>;
  publications?: Record<string, Publication>;
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
  /** Anthropic spend for the current cap-day, so the bot can budget itself across a night. */
  spend?: { date: string; usd: number };
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
  private revealHeldComments: Record<string, string>;
  private ownerReviews: Record<string, string>;
  private concernAcknowledgments: Record<string, string>;
  private publications: Record<string, Publication>;
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
  private spend: { date: string; usd: number };
  private file: string;

  // stateFile defaults to the Threads state; the Facebook reply loop passes its own path
  // (config.fbStateFile) so the two never share a replied-log or daily counter.
  constructor(stateFile: string = config.stateFile) {
    this.file = stateFile;
    if (config.confirmLive && !existsSync(this.file)) {
      throw new PersistenceError(`Missing ${this.file}; restore reply history before running live`);
    }
    let loaded: StateShape | null = null;
    if (existsSync(this.file)) {
      try {
        loaded = JSON.parse(readFileSync(this.file, "utf8")) as StateShape;
        const strings = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === "string");
        if (loaded?.revealHeldComments !== undefined && (!loaded.revealHeldComments || typeof loaded.revealHeldComments !== 'object' || Array.isArray(loaded.revealHeldComments) || !Object.values(loaded.revealHeldComments).every(v => typeof v === 'string'))) throw new Error('invalid reveal holds');
        if (loaded?.concernAcknowledgments !== undefined && (!loaded.concernAcknowledgments || typeof loaded.concernAcknowledgments !== 'object' || Array.isArray(loaded.concernAcknowledgments) || !Object.values(loaded.concernAcknowledgments).every(v => typeof v === 'string'))) throw new Error('invalid concern acknowledgments');
        if (loaded?.ownerReviews !== undefined && (!loaded.ownerReviews || typeof loaded.ownerReviews !== "object" || Array.isArray(loaded.ownerReviews) || !Object.values(loaded.ownerReviews).every(v => typeof v === "string"))) throw new Error("invalid owner review queue");
        const counts = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((n) => Number.isInteger(n) && n >= 0);
        const daily = (v: any) => !!v && typeof v.date === "string" && Number.isFinite(Date.parse(v.date)) && Number.isInteger(v.count) && v.count >= 0;
        for (const v of [loaded?.skipStrikes, loaded?.gifPostCounts, loaded?.promoPostCounts]) {
          if (v !== undefined && !counts(v)) throw new Error("invalid optional counters");
        }
        for (const v of [loaded?.gifDaily, loaded?.promoDaily]) {
          if (v !== undefined && !daily(v)) throw new Error("invalid optional daily counters");
        }
        if (loaded?.spend !== undefined && (!loaded.spend || typeof loaded.spend.date !== "string" || !Number.isFinite(Date.parse(loaded.spend.date)) || typeof loaded.spend.usd !== "number" || !Number.isFinite(loaded.spend.usd) || loaded.spend.usd < 0)) throw new Error("invalid spend");
        if (loaded?.recentGifIds !== undefined && !strings(loaded.recentGifIds)) throw new Error("invalid GIF history");
        if (loaded?.pinnedResolved !== undefined && (!loaded.pinnedResolved || typeof loaded.pinnedResolved !== "object" || Array.isArray(loaded.pinnedResolved) || !Object.values(loaded.pinnedResolved).every((v) => typeof v === "string"))) throw new Error("invalid pinned map");
        if (!loaded || !strings(loaded.repliedCommentIds) || !strings(loaded.answeredPostIds) ||
            !loaded.postCounts || typeof loaded.postCounts !== "object" || Array.isArray(loaded.postCounts) ||
            !Object.values(loaded.postCounts).every((n) => Number.isInteger(n) && n >= 0) ||
            !loaded.daily || typeof loaded.daily.date !== "string" || !Number.isInteger(loaded.daily.count) || loaded.daily.count < 0 ||
            (loaded.skippedCommentIds !== undefined && !strings(loaded.skippedCommentIds)) ||
            (loaded.publications !== undefined && !validPublications(loaded.publications))) throw new Error("invalid state fields");
      } catch {
        throw new PersistenceError(`Cannot read ${this.file}; refusing to reset reply history`);
      }
    }
    this.replied = new Set(loaded?.repliedCommentIds ?? []);
    this.revealHeldComments = loaded?.revealHeldComments ?? {};
    this.ownerReviews = loaded?.ownerReviews ?? {};
    this.concernAcknowledgments = loaded?.concernAcknowledgments ?? {};
    this.publications = loaded?.publications ?? {};
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
    this.spend =
      loaded?.spend && loaded.spend.date === today() ? loaded.spend : { date: today(), usd: 0 };
  }

  // --- Anthropic spend for this cap-day ---
  // Shares today()'s midday rollover with the reply counter, so one overnight shift always
  // sits on ONE budget day instead of resetting at midnight halfway through the window.
  spentToday(): number {
    return this.spend.date === today() ? this.spend.usd : 0;
  }

  addSpend(usd: number): void {
    if (!(usd > 0)) return;
    this.spend = { date: today(), usd: this.spentToday() + usd };
    this.save();
  }

  hasSkipped(commentId: string): boolean {
    return this.skipped.has(commentId);
  }

  holdUntilReveal(commentId: string, commentText: string): void {
    this.revealHeldComments[commentId] = commentText;
    this.save();
  }

  isWaitingForReveal(commentId: string, commentText: string, answerPublic: boolean): boolean {
    return !answerPublic && this.revealHeldComments[commentId] === commentText;
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
  queueOwnerReview(commentId: string, postId: string, reason: string, commentText?: string, username?: string): void {
    if (this.ownerReviews[commentId]) return;
    this.ownerReviews[commentId] = JSON.stringify({ postId, reason, commentText, username, queuedAt: new Date().toISOString() });
    this.save();
  }
  pendingOwnerReviews(): Array<{ commentId: string; postId: string; reason: string; commentText?: string; username?: string; queuedAt: string }> {
    return Object.entries(this.ownerReviews).flatMap(([commentId, raw]) => {
      const review = JSON.parse(raw);
      return review.resolvedAt ? [] : [{ ...review, commentId }];
    });
  }
  hasImageReview(postId: string): boolean {
    return this.pendingOwnerReviews().some(r => r.postId === postId && /image\/anatomy/i.test(r.reason));
  }
  resolveOwnerReview(commentId: string, note: string): void {
    if (!note.trim() || !this.ownerReviews[commentId]) throw new Error('Existing review and resolution note are required');
    const review = JSON.parse(this.ownerReviews[commentId]);
    this.ownerReviews[commentId] = JSON.stringify({ ...review, resolvedAt: new Date().toISOString(), resolution: note.trim() });
    this.save();
  }
  claimConcernAcknowledgment(postId: string, username: string, kind: string, commentId: string): boolean {
    const key = JSON.stringify([postId, username.toLowerCase(), kind]);
    if (this.concernAcknowledgments[key]) return this.concernAcknowledgments[key] === commentId;
    this.concernAcknowledgments[key] = commentId; this.save(); return true;
  }

  publication(key: string): PublicationStore {
    return {
      get: () => this.publications[key],
      set: (value) => {
        this.publications[key] = value;
        this.save();
        checkpointState(this.file);
      },
    };
  }

  markReplied(commentId: string, postId: string): void {
    if (this.replied.has(commentId)) return;
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
      revealHeldComments: this.revealHeldComments,
      ownerReviews: this.ownerReviews,
      concernAcknowledgments: this.concernAcknowledgments,
      publications: this.publications,
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
      spend: this.spend,
    };
    atomicJson(this.file, out);
  }
}
