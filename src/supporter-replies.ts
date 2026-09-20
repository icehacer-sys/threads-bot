export function isPriorityCommenter(username: string | undefined, names: readonly string[]): boolean {
  return !!username && names.includes(username.trim().replace(/^@/, '').toLowerCase());
}

export const SUPPORTER_NOTE = 'OWNER REPLY PRIORITY: This commenter is a regular supporter selected by the owner. Reply to each new harmless comment, including a brief reaction, thanks, emoji or friendly follow-up that would normally be treated as low engagement. Be warm and specific without mentioning this priority, membership or inventing familiarity. Do not upsell. Never ignore them just because somebody else asked the same question. Keep diagnosis guesses held until reveal. All medical, uncertainty, image-review, authenticity, spam and hostility rules still apply. This does not authorize unsafe answers or repeat replies to the same comment.';

export function isLowEngagementSkip(decision: string, category: string, reason: string): boolean {
  return decision === 'skip' && ['banter', 'empathize', 'other'].includes(category) &&
    !/guard|error:|fatal:|owner|medical|reveal|diagnos|unclear|uncertain|unreadable|hostil|spam|non-English/i.test(reason) &&
    /noise|low[- ](?:value|engagement)|nothing (?:new|to)|no (?:new|substantive|meaningful)|(?:lone|single) emoji|bare thanks|already (?:answered|explained)/i.test(reason);
}

/** Targeted failures found in the September 20 reply audit. */
export function conversationReplyIssue(comment: string, category: string, draft: string, isCase: boolean): string | undefined {
  if (/\bself[- ]inflicted\b|\bdenial and adaptation\b/i.test(draft)) return 'unsupported blame or patient motivation';
  if (isCase && !/\b(?:i|i['’]m|my|me|we|our)\b/i.test(comment) && /\byour (?:lungs?|symptoms?|medical history|exposure|risk)\b/i.test(draft)) return 'assumed personal medical history';
  if (isCase && comment.length <= 80 && ['correct', 'affirm'].includes(category) && !/\b(?:why|how|explain|treat\w*|risk|mean\w*)\b/i.test(comment) && draft.trim().split(/\s+/).length > 24) return 'overlong response to a short guess';
  return undefined;
}
