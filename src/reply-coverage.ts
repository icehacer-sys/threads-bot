import type { ThreadsReply } from './threads';

export const COVERAGE_NOTE = 'OWNER COVERAGE POLICY: Give every new harmless comment a brief relevant reply, including short guesses, emoji, thanks and reactions. Do not skip because it is brief, lacks a question, offers no new information or repeats a topic another person raised. Read comments in any language you understand and reply in plain English. A clearly stated limitation is useful when the case does not record the requested age, history or outcome; do not invent an answer. Prefer one plain sentence. Do not ask a question back or invite more chatter. A follow-up is your final turn in this conversation. Before reveal identify a diagnosis guess explicitly in intent and acknowledge participation only; never grade it or give a clue. Personal medical boundaries, uncertain media, authenticity questions, spam, hostility and owner-review holds still apply.';

const GUESS_ACKS = ['Thanks for putting a guess in.', 'Your guess is in.', 'Thanks for joining the challenge.', 'Thanks for having a go.', 'Got your guess.', 'Thanks for taking a shot at it.'];
export function neutralGuessAcknowledgment(comment: string): string {
  let hash = 0;
  for (const ch of comment) hash = (Math.imul(hash, 31) + ch.codePointAt(0)!) >>> 0;
  return GUESS_ACKS[hash % GUESS_ACKS.length];
}
export const isNeutralGuessAcknowledgment = (text: string) => GUESS_ACKS.includes(text);

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
