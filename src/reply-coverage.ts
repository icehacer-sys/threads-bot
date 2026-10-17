import type { ThreadsReply } from './threads';
import type { CoverageReason } from './coverage-decisions';

export const COVERAGE_NOTE = 'OWNER COVERAGE POLICY: Give every new harmless comment a brief relevant reply, including short guesses, thanks and reactions. Skip comments consisting only of emoji. Do not skip because it is brief, lacks a question, offers no new information or repeats a topic another person raised. Read comments in any language you understand and reply in plain English. Write in Mr. M\'s warm playful teaching voice, not like a form accepting entries. Never thank someone for guessing, announce that their guess is recorded or substitute a participation acknowledgment for a reply. Fictional diagnoses, food comparisons and wordplay are jokes: respond to their premise without adding a diagnosis or treatment lesson. Before reveal write a brief non-grading conversational response to a genuine guess; a general invitation to take another look is allowed equally for correct and incorrect guesses, without pointing to a diagnostic feature. Never confirm, reject or reveal a diagnosis before the public answer. After reveal give a wrong guess one supported distinguishing observation and the teaching answer when appropriate; do not invent why an alternative is impossible. A missing fact can receive an honest limitation. Keep it short and vary the shape: a few words or one to three short sentences. An occasional genuine question back is fine but never just to prolong the exchange. A follow-up is your final turn. Personal medical boundaries, uncertain media, authenticity questions, spam, hostility and owner-review holds still apply.';

/** Emoji reactions have no written content, including flags, joined emoji and keycaps. */
export function isEmojiOnlyComment(text: string): boolean {
  const remainder = text.replace(/[0-9#*]\uFE0F?\u20E3|[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}]/gu, '');
  return remainder !== text && !remainder.replace(/[\s\u200D\uFE0E\uFE0F\u{E0020}-\u{E007F}]/gu, '');
}

// 2026-10-12 voice audit: 17 of 30 TB guesses on one post got the same "Not TB..." correction. A person
// answering the 20th identical guess says so instead of writing the first correction again.
// 2026-10-17 audit: the note never fired because its alias list was hard-coded to the Oct 11 post. It is now
// built per post from the answer's own aliases plus whatever short guesses earlier commenters repeated.
const CROWD_MIN = 4;
const CROWD_MAX_WORDS = 8;
const CROWD_STOP = new Set('the and for with this that those these there their they them you your are was were is its it looks look like maybe guess guessing think thinking would could should might just some kind sort what which who how why when where yes yeah nope not sure about from into onto over under then than very really pretty thats it’s it\'s im i\'m xray x-ray scan film image picture patient case answer one two lol wow omg damn god ok okay definitely probably obviously clearly'.split(' '));
const crowdTerms = (text: string): string[] => [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
  .filter(w => (w.length >= 3 || /^[a-z]{2}$/.test(w) && /\b[A-Z]{2}\b/.test(text)) && !CROWD_STOP.has(w))
  .map(w => (w.length > 3 ? w.replace(/(?<!s)s$/, '') : w)))];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phraseRe = (phrase: string) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(phrase.toLowerCase())}(?:es|s)?(?:$|[^\\p{L}\\p{N}])`, 'u');
/**
 * After the reveal: how many earlier audience comments on this post made the same guess. Pure.
 * A guess matching one of the answer's aliases counts every earlier comment that named any alias. Any other
 * short guess counts earlier comments sharing its most repeated content word (for example "TB" or "gunshot").
 */
export function crowdGuessNote(comment: string, earlier: string[], answer = ''): string {
  const words = comment.trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > CROWD_MAX_WORDS) return '';
  const low = comment.toLowerCase();
  const aliases = answer.split('/').map(a => a.trim()).filter(a => a.length >= 3 && a.toLowerCase() !== 'unknown');
  const alias = aliases.find(a => phraseRe(a).test(low));
  let label = '';
  let n = 0;
  if (alias) {
    label = alias;
    n = earlier.filter(text => aliases.some(a => phraseRe(a).test(text.toLowerCase()))).length;
  } else {
    for (const term of crowdTerms(comment)) {
      const count = earlier.filter(text => phraseRe(term).test(text.toLowerCase())).length;
      if (count > n) { n = count; label = /\b[A-Z]{2,}\b/.test(comment) && term.length <= 4 ? term.toUpperCase() : term; }
    }
  }
  return n >= CROWD_MIN ? `CROWD NOTE: ${n} earlier comments on this post also went with ${label}. You may acknowledge that like a person would (you and half the thread). Do not reuse a correction sentence you already gave others. One short sentence is enough.` : '';
}

export function isRetiredGuessReceipt(text: string): boolean {
  return /\bthanks? (?:you )?for (?:putting (?:a|your) guess in|joining the challenge|having a go|taking a shot|(?:your )?guess(?:ing)?)\b|\b(?:your guess is in|got your guess|guess (?:received|recorded|noted))\b/i.test(text);
}

/** Two turns per participant per original thread, including persisted replies not yet visible. */
export function replyCoverage(postId: string, me: string, comments: ThreadsReply[], hasReplied: (id: string) => boolean, limit: number, onBlocked?: (id: string, reason: CoverageReason) => void) {
  const byId = new Map(comments.map(c => [c.id, c]));
  const targets = new Set(comments.filter(c => c.username === me && c.replied_to?.id).map(c => c.replied_to!.id));
  const keys = new Map<string, string>();
  for (const c of comments) {
    if (c.username === me) continue;
    let cur: ThreadsReply | undefined = c;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id) && seen.size < 64) {
      seen.add(cur.id);
      const parent: string | undefined = cur.replied_to?.id;
      // A direct audience reply under a top-level owner comment starts its own thread.
      const ancestor: ThreadsReply | undefined = parent ? byId.get(parent) : undefined;
      if (parent === postId || (ancestor?.username === me && ancestor.replied_to?.id === postId)) {
        keys.set(c.id, JSON.stringify([cur.id, (c.username ?? c.id).toLowerCase()]));
        break;
      }
      cur = ancestor;
    }
  }
  const count = (id: string) => {
    const key = keys.get(id);
    if (!key) return limit; // Missing/cyclic ancestry cannot bypass the limit.
    return [...keys].filter(([target, k]) => k === key && (targets.has(target) || hasReplied(target))).length;
  };
  return {
    count,
    canReply: (id: string) => {
      // Preserve the original short-circuit order and number of state lookups.
      const reason = !keys.has(id) ? 'incomplete_ancestry'
        : targets.has(id) || hasReplied(id) ? 'already_replied'
        : !(count(id) < limit) ? 'participant_turn_limit' : undefined;
      if (reason && onBlocked) { try { onBlocked(id, reason); } catch { /* Observation only. */ } }
      return reason === undefined;
    },
    markReplied: (id: string) => { targets.add(id); },
  };
}
