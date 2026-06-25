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
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export class State {
  private replied: Set<string>;
  private answered: Set<string>;
  private postCounts: Record<string, number>;
  private daily: { date: string; count: number };
  private pinnedResolved: Record<string, string>;

  constructor() {
    let loaded: StateShape | null = null;
    if (existsSync(config.stateFile)) {
      try {
        loaded = JSON.parse(readFileSync(config.stateFile, "utf8")) as StateShape;
      } catch {
        loaded = null;
      }
    }
    this.replied = new Set(loaded?.repliedCommentIds ?? []);
    this.answered = new Set(loaded?.answeredPostIds ?? []);
    this.postCounts = loaded?.postCounts ?? {};
    this.pinnedResolved = loaded?.pinnedResolved ?? {};
    this.daily =
      loaded?.daily && loaded.daily.date === today() ? loaded.daily : { date: today(), count: 0 };
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
    };
    writeFileSync(config.stateFile, JSON.stringify(out, null, 2));
  }
}
