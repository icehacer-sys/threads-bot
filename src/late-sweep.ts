// Late sweep (owner approved 2026-10-17). The 2026-10-17 audit found 21% of comments arrive after the
// 10:00 Cairo window closes and are never seen. Once a day, shortly before the next post (default 21:30
// Cairo), the worker looks at the PREVIOUS night's post and answers only genuine case questions and
// personal or family stories that arrived after the window closed, plus in-window ones a guard or model
// skip left unanswered. Pure selection logic lives here so it can be tested offline; index.ts runs it.
import type { ThreadsReply } from './threads';
import { isAiProvenanceComment, isPoliticalJab, isSexualBait } from './deepseek-media-policy';

export const LATE_SWEEP_NOTE = 'LATE SWEEP: This comment arrived after the overnight replies ended and the answer has been public for hours. Reply only if it is a genuine question about the case or a personal or family story. Answer a question from the case facts in one to three plain sentences or say honestly that this case does not show it. Meet a story with brief warmth about the detail they shared and nothing else. Skip jokes, banter, political remarks and anything about AI. No need to mention the delay.';

export type LateSweepKind = 'question' | 'story';

const QUESTION_START = /^\s*(?:so\s+)?(?:what|why|how|when|where|who|which|whose|did|does|do|is|are|was|were|can|could|will|would|has|have|had|should|isn['’]?t|aren['’]?t|wasn['’]?t|doesn['’]?t|didn['’]?t)\b/i;
const RELATION = /\b(?:my|our)\s+(?:late\s+)?(?:mom|mum|mother|mama|dad|father|papa|husband|wife|partner|son|daughter|baby|child|kid|brother|sister|grand(?:ma|pa|mother|father|son|daughter)|aunt|uncle|cousin|friend|nephew|niece|fianc[eé]e?|boyfriend|girlfriend)\b/i;
const FIRST_PERSON_STORY = /\b(?:i|we)\s+(?:had|have had|was diagnosed|were diagnosed|survived|went through|lived with|live with|lost|nearly died|almost died|was born with|had surgery|had one|had this|had that)\b|\b(?:survivor|passed away|diagnosed with|was diagnosed|had surgery|in remission)\b/i;
const LAUGH = /\b(?:lol|lmao|lmfao|rofl|haha\w*|hehe\w*)\b|[🤣😂😆]/u;

/** A genuine case question or a personal story. Jokes, one-word reactions and bare guesses return undefined. */
export function lateSweepKind(text: string | undefined): LateSweepKind | undefined {
  const t = (text ?? '').trim();
  const words = t.split(/\s+/).filter(Boolean).length;
  if (words < 4 || isPoliticalJab(t) || isAiProvenanceComment(t) || isSexualBait(t)) return undefined;
  if ((RELATION.test(t) || FIRST_PERSON_STORY.test(t)) && words >= 6) return 'story';
  if (LAUGH.test(t)) return undefined;
  if (/\?/.test(t) || QUESTION_START.test(t)) return 'question';
  return undefined;
}

function zonedParts(date: Date, timeZone: string): { y: number; m: number; d: number; h: number; min: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
  return { y: parts.year, m: parts.month, d: parts.day, h: parts.hour % 24, min: parts.minute };
}

/** The first moment at `hour`:00 local time strictly after `fromIso` (the window close after a post). */
export function windowCloseAfter(fromIso: string, hour: number, timeZone: string): Date {
  const from = new Date(fromIso);
  const local = zonedParts(from, timeZone);
  for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
    // Two passes correct the zone offset for the target day, including a DST change.
    let guess = Date.UTC(local.y, local.m - 1, local.d + dayOffset, hour, 0);
    for (let i = 0; i < 2; i++) {
      const p = zonedParts(new Date(guess), timeZone);
      const shownAsUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
      guess += Date.UTC(local.y, local.m - 1, local.d + dayOffset, hour, 0) - shownAsUtc;
    }
    if (guess > from.getTime()) return new Date(guess);
  }
  return new Date(from.getTime() + 24 * 3_600_000);
}

/** True from `at` (HH:MM local) until the active window opens at `startHour`:00. */
export function lateSweepWindowOpen(now: Date, at: string, startHour: number, timeZone: string): boolean {
  const m = at.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return false;
  const begin = Number(m[1]) * 60 + Number(m[2]);
  const { h, min } = zonedParts(now, timeZone);
  const minute = h * 60 + min;
  const end = startHour * 60;
  return begin < end ? minute >= begin && minute < end : minute >= begin || minute < end;
}

export interface LateSweepOptions {
  me: string;
  /** When the overnight window closed after this post (windowCloseAfter). */
  windowClose: Date;
  max: number;
  /** Mechanical eligibility from the caller: visible, not replied, no owner review, thread limit, etc. */
  eligible: (c: ThreadsReply) => boolean;
  /** True when an in-window comment was skipped by a guard or the model (skip cache or soft strike). */
  hadSkip: (id: string) => boolean;
}

/**
 * Comments for the sweep, best first: questions before stories, after-window comments before in-window
 * leftovers, then oldest first. In-window comments qualify only with a recorded skip, so anything the
 * overnight run simply has not reached yet is not swept here.
 */
export function selectLateSweep(comments: ThreadsReply[], opts: LateSweepOptions): ThreadsReply[] {
  const close = opts.windowClose.getTime();
  const seen = new Set<string>();
  const picked = comments.flatMap(c => {
    if (seen.has(c.id) || c.username === opts.me) return [];
    seen.add(c.id);
    const kind = lateSweepKind(c.text);
    if (!kind || !opts.eligible(c)) return [];
    const at = c.timestamp ? Date.parse(c.timestamp) : NaN;
    const late = Number.isFinite(at) && at >= close;
    if (!late && !opts.hadSkip(c.id)) return [];
    return [{ c, kind, late, at: Number.isFinite(at) ? at : Infinity }];
  });
  picked.sort((a, b) => Number(a.kind !== 'question') - Number(b.kind !== 'question') || Number(!a.late) - Number(!b.late) || a.at - b.at);
  return picked.slice(0, Math.max(0, opts.max)).map(p => p.c);
}
