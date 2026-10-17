// Addressee-aware eligibility (owner-reported bug, 2026-10-17). People reply to EACH OTHER under the
// posts and BOT_REPLY_ALL puts every comment in the flattened conversation into the pool, so the bot
// answered messages that were never meant for it. These pure checks decide, before any model call,
// whether a comment is addressed to the account. Conservative: when in doubt a comment stays eligible
// only if it is top-level, under our pinned answer, or under one of our replies by the person we answered.
import type { ThreadsReply } from './threads';
import { MEDICAL_TERM } from './supporter-replies';

export type PeerVerdict = 'peer_conversation' | 'friend_tag_only';

export interface AddresseeContext {
  postId: string;
  me: string;
  /** Every comment in the conversation by id, including our own replies. */
  byId: Map<string, ThreadsReply>;
  /** Our pinned "Answer:" comment, whose direct replies are addressed to us. */
  answerCommentId?: string | null;
}

const MENTION = /(?:^|[^\w@.])@([A-Za-z0-9_.]{1,40})/g;
const norm = (s: string | undefined) => (s ?? '').trim().replace(/^@/, '').toLowerCase();

/** @-handles in a comment, lowercased, without the @. */
export function mentions(text: string | undefined): string[] {
  return [...(text ?? '').matchAll(MENTION)].map((m) => m[1].replace(/\.+$/, '').toLowerCase());
}

/** The comment explicitly addresses the account: our @handle, or a direct "OP / doc / Mr M" address. */
export function addressesUs(text: string | undefined, me: string): boolean {
  const t = text ?? '';
  if (mentions(t).includes(norm(me))) return true;
  return /^\s*(?:hey\s+|hi\s+|dear\s+|ok(?:ay)?\s+|so\s+)?(?:op|doc|doctor|mr\.?\s?m|admin)\b\s*[,:!?-]/i.test(t) ||
    /\b(?:hey|hi|dear|question for(?: the)?|asking(?: the)?)\s+(?:op|doc|mr\.?\s?m|admin)\b/i.test(t) ||
    /\b(?:op|doc|mr\.?\s?m)\s*,?\s+(?:what|why|how|is|are|was|did|does|can|could|would|will)\b[^.!]*\?/i.test(t);
}

// Short filler that commonly rides with a friend tag ("@sarah this is you", "@john look lol").
const FRIEND_FILLER = /^(?:this is you|that'?s you|it'?s you|you|u|look|lookit|look at this|see|see this|omg|lol|lmao|haha\w*|remember|remember this|this|this one|yours|your x-?ray|your scan|literally you|me|us|same|check this|check this out|did you see|wow|bruh|dude|girl|sis|bro|you next|next time|told you|i told you|we need to talk|for you|thought of you|tag yourself)$/i;

/**
 * A top-level comment that only tags other people with no guess or question for us. A tag plus a real
 * guess or question stays eligible (index.ts tells the model the tag is not for the account).
 */
export function isFriendTagOnly(text: string | undefined, me: string): boolean {
  const t = text ?? '';
  const tagged = mentions(t).filter((m) => m !== norm(me));
  if (!tagged.length || addressesUs(t, me)) return false;
  const rest = t.replace(MENTION, ' ').replace(/[\p{Extended_Pictographic}‍️]/gu, ' ').replace(/[^\p{L}\p{N}'\s?-]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!rest) return true;
  if (/\?/.test(rest) || MEDICAL_TERM.test(rest)) return false;
  if (FRIEND_FILLER.test(rest.replace(/[?.!]+$/, ''))) return true;
  return rest.split(/\s+/).length <= 3;
}

/** Other people a top-level comment tags, for the drafting note. */
export function taggedOthers(text: string | undefined, me: string): string[] {
  return [...new Set(mentions(text).filter((m) => m !== norm(me)))];
}

/**
 * Who a comment is addressed to. undefined = the account (eligible); otherwise the skip reason.
 * 1. A reply to another user's comment (not the post, not our reply, not our pinned answer) is peer talk
 *    unless it explicitly addresses us.
 * 2. A reply under one of OUR replies by someone other than the person we answered, who is talking to
 *    that person (starts with or mentions their @handle, or starts with another @handle), is peer talk.
 * 3. A top-level comment that only tags friends is skipped as friend_tag_only.
 */
export function addresseeVerdict(c: ThreadsReply, ctx: AddresseeContext): PeerVerdict | undefined {
  const me = norm(ctx.me);
  if (norm(c.username) === me) return undefined;
  const parentId = c.replied_to?.id;
  const text = c.text ?? '';
  if (!parentId || parentId === ctx.postId) return isFriendTagOnly(text, ctx.me) ? 'friend_tag_only' : undefined;
  if (ctx.answerCommentId && parentId === ctx.answerCommentId) return undefined;
  const parent = ctx.byId.get(parentId);
  // Unknown parent: the existing ancestry checks own that case; never guess it is peer talk.
  if (!parent) return undefined;
  if (norm(parent.username) !== me) return addressesUs(text, ctx.me) ? undefined : 'peer_conversation';
  // Under one of our replies.
  if (addressesUs(text, ctx.me)) return undefined;
  const answered = parent.replied_to?.id ? ctx.byId.get(parent.replied_to.id) : undefined;
  const answeredUser = norm(answered?.username);
  if (!answeredUser || norm(c.username) === answeredUser) return undefined;
  const tags = mentions(text);
  const leadingTag = /^\s*@([A-Za-z0-9_.]{1,40})/.exec(text)?.[1]?.toLowerCase();
  if (tags.includes(answeredUser) || (leadingTag && leadingTag !== me)) return 'peer_conversation';
  return undefined;
}
