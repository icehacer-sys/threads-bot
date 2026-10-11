export function isPriorityCommenter(username: string | undefined, names: readonly string[]): boolean {
  return !!username && names.includes(username.trim().replace(/^@/, '').toLowerCase());
}

export const SUPPORTER_NOTE = 'OWNER REPLY PRIORITY: This commenter is a regular supporter selected by the owner. Reply to each new harmless comment, including a brief reaction, thanks or friendly follow-up that would normally be treated as low engagement. Skip comments consisting only of emoji. Be warm and specific without mentioning this priority, membership or inventing familiarity. Do not upsell. Never ignore them just because somebody else asked the same question. Keep diagnosis guesses held until reveal. All medical, uncertainty, image-review, authenticity, spam and hostility rules still apply. This does not authorize unsafe answers or repeat replies to the same comment.';

export function isLowEngagementSkip(decision: string, category: string, reason: string): boolean {
  return decision === 'skip' && ['banter', 'empathize', 'other'].includes(category) &&
    !/guard|error:|fatal:|owner|medical|reveal|diagnos|unclear|uncertain|unreadable|hostil|spam|non-English/i.test(reason) &&
    /noise|low[- ](?:value|engagement)|nothing (?:new|to)|no (?:new|substantive|meaningful)|(?:lone|single) emoji|bare thanks|already (?:answered|explained)/i.test(reason);
}

/** Targeted failures found in the September 20 and October 11 reply audits. */
export function conversationReplyIssue(comment: string, category: string, draft: string, isCase: boolean): string | undefined {
  // Emoji give tone to written comments. Only discuss their meaning when asked.
  const emojiQuestion = /\b(?:what|why|how|which|explain)\b[^.!?]{0,60}\b(?:emojis?|emoticons?)\b|\b(?:emojis?|emoticons?)\b[^.!?]{0,40}\b(?:mean|means|meaning)\b/i.test(comment) ||
    /\bwhat\s+(?:does|do)\s+[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\s\u200D\uFE0E\uFE0F]+\s+mean\b/iu.test(comment);
  const reactionCommentary = /\b(?:face|reaction|expression)\s+(?:says?|tells?|shows?|gives?)\b|\b(?:reaction|response)\s+(?:is|was)\s+(?:fair|perfect|correct|appropriate|accurate|proportionate)\b|\b(?:laugh(?:ing)?|smil(?:e|ing))\s+(?:is|was)\s+(?:(?:the|a|an|only|fair|correct|sensible|perfect|appropriate)\s+){0,4}(?:response|reaction|reflex)\b/i.test(draft);
  if (!emojiQuestion && (/\b(?:emojis?|emoticons?)\b/i.test(draft) ||
      (reactionCommentary && (category === 'banter' || /\p{Extended_Pictographic}/u.test(comment))))) {
    return 'emoji commentary: respond to the meaning without describing the emoji or reaction';
  }
  if (['banter', 'affirm'].includes(category) && /\byou (?:went|skipped|jumped) (?:straight )?to (?:the )?(?:abbreviation|shorthand|Latin name)\b|\byou (?:used|chose|picked) (?:the )?(?:abbreviation|shorthand|Latin name)\b/i.test(draft)) {
    return 'comment wording: acknowledge the guess itself without commenting on its abbreviation or spelling';
  }
  if (/^nailed it[.!\s]*$/i.test(draft) || (category === 'banter' && /\bthat['’]s a new way to describe\b/i.test(draft))) return 'stock praise or commentary instead of responding to the comment';
  if (/\bself[- ]inflicted\b|\bdenial and adaptation\b/i.test(draft)) return 'unsupported blame or patient motivation';
  if (isCase && !/\b(?:i|i['’]m|my|me|we|our)\b/i.test(comment) && /\byour (?:lungs?|symptoms?|medical history|exposure|risk)\b/i.test(draft)) return 'assumed personal medical history';
  if (isCase && comment.length <= 80 && ['correct', 'affirm'].includes(category) && !/\b(?:why|how|explain|treat\w*|risk|mean\w*)\b/i.test(comment) && draft.trim().split(/\s+/).length > 24) return 'overlong response to a short guess';
  return undefined;
}
