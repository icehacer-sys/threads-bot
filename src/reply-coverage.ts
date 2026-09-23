import type { ThreadsReply } from './threads';

export const COVERAGE_NOTE = 'OWNER COVERAGE POLICY: Give every new harmless comment a brief relevant reply, including short guesses, emoji, thanks and reactions. Do not skip because it is brief, lacks a question, offers no new information or repeats a topic another person raised. Read comments in any language you understand and reply in plain English. Write in Mr. M\'s warm playful teaching voice, not like a form accepting entries. Never thank someone for guessing, announce that their guess is recorded or substitute a participation acknowledgment for a reply. Fictional diagnoses, food comparisons and wordplay are jokes: respond to their premise without adding a diagnosis or treatment lesson. Before reveal write a brief non-grading conversational response to a genuine guess; a general invitation to take another look is allowed equally for correct and incorrect guesses, without pointing to a diagnostic feature. Never confirm, reject or reveal a diagnosis before the public answer. After reveal give a wrong guess one supported distinguishing observation and the teaching answer when appropriate; do not invent why an alternative is impossible. A missing fact can receive an honest limitation. Prefer one plain sentence. Do not add questions just to prolong the exchange. A follow-up is your final turn. Personal medical boundaries, uncertain media, authenticity questions, spam, hostility and owner-review holds still apply.';

export function isRetiredGuessReceipt(text: string): boolean {
  return /\bthanks? (?:you )?for (?:putting (?:a|your) guess in|joining the challenge|having a go|taking a shot|(?:your )?guess(?:ing)?)\b|\b(?:your guess is in|got your guess|guess (?:received|recorded|noted))\b/i.test(text);
}

/** Two turns per participant per original thread, including persisted replies not yet visible. */
export function replyCoverage(postId: string, me: string, comments: ThreadsReply[], hasReplied: (id: string) => boolean, limit: number) {
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
    canReply: (id: string) => keys.has(id) && !targets.has(id) && !hasReplied(id) && count(id) < limit,
    markReplied: (id: string) => { targets.add(id); },
  };
}
