export function isPriorityCommenter(username: string | undefined, names: readonly string[]): boolean {
  return !!username && names.includes(username.trim().replace(/^@/, '').toLowerCase());
}

export const SUPPORTER_NOTE = 'OWNER REPLY PRIORITY: This commenter is a regular supporter selected by the owner. Reply to each new harmless comment, including a brief reaction, thanks or friendly follow-up that would normally be treated as low engagement. Skip comments consisting only of emoji. Be warm and specific without mentioning this priority, membership or inventing familiarity. Do not upsell. Never ignore them just because somebody else asked the same question. Keep diagnosis guesses held until reveal. All medical, uncertainty, image-review, authenticity, spam and hostility rules still apply. This does not authorize unsafe answers or repeat replies to the same comment.';

export function isLowEngagementSkip(decision: string, category: string, reason: string): boolean {
  return decision === 'skip' && ['banter', 'empathize', 'other'].includes(category) &&
    !/guard|error:|fatal:|owner|medical|reveal|diagnos|unclear|uncertain|unreadable|hostil|spam|non-English/i.test(reason) &&
    /noise|low[- ](?:value|engagement)|nothing (?:new|to)|no (?:new|substantive|meaningful)|(?:lone|single) emoji|bare thanks|already (?:answered|explained)/i.test(reason);
}

export const MEDICAL_TERM = /\b(?:tb|tuberc\w*|cancer|tumou?r\w*|malignan\w*|pneumo\w*|fibrosis|emphysema|copd|chf|oedema|edema|effusion|abscess\w*|sepsis|septic|infection|fungal|mou?ld|lupus|achalasia|stricture\w*|spasm|hernia|torsion|embol\w*|gout|arthritis|stones?|haemo\w*|hemo\w*|collapse\w*|cyst\w*|mets|aneurysm\w*|aneuris\w*|fracture\w*|parasit\w*|worms?|clots?|bleed\w*|blood\w*|bowels?|impact\w*|megacolon|obstruct\w*|constipat\w*|chiari|malformation\w*|block\w*|urethr\w*|kidneys?|bladder\w*|transplant\w*|fluid\w*|csf|leak\w*|triple a|aaa|avm)\b|\w+(?:itis|osis|oma|omas|aemia|emia)\b/i;

/** Targeted failures found in the September 20 and October 11 and 12 reply audits. */
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
  // 2026-10-12 audit: after #41 the template moved to the commenter's own word ("Wow is about the right speed").
  const echoWord = (comment.toLowerCase().match(/\p{L}+/u) ?? [''])[0];
  const gradesReaction = /\b(?:is|was) (?:about )?(?:the |a )?(?:right|correct|fair|honest) (?:amount|word|unit|volume|size|speed|noise|review|first word|summary|response|reaction)\b|\babout (?:covers|sums up) (?:it|how)\b|^\S+(?: \S+){0,2} (?:is|was) (?:about )?(?:a |the )?(?:right|fair)\b/i.test(draft);
  const bareReaction = comment.trim().split(/\s+/).length <= 4 && !/\?/.test(comment) && !/^\s*(?:what|why|how|is|are|can|does|did)\b/i.test(comment);
  if (bareReaction && gradesReaction && (!echoWord || draft.toLowerCase().includes(echoWord) || /\babout (?:covers|sums up)\b/i.test(draft))) {
    return 'grading the reaction: respond to what they reacted to instead of rating their word';
  }
  // 2026-10-12 audit: 45 joke or lay comments got "No X here. It's Y." (16 of 43 gun jokes on Oct 11).
  // A comment naming a medical condition is a real guess and may get "Not TB..."; an honest "No idea" stays.
  // 2026-10-17 audit: 13 of 18 forced-skips here were sincere guesses. A hedged guess ("maybe", "I'd say",
  // "not a doctor but"), a question of three or more words ending in "?" or a "So what/where" question is
  // not a joke to be deflated. Short object readings with a question mark ("Telephone cord?") still count.
  const hedged = /\b(?:maybe|guess|i think|think it|thinking|i(?:'|’)?d say|not a doctor|probably|perhaps|possibly|my bet|could be|might be)\b/i.test(comment);
  const longQuestion = /\?\s*$/.test(comment.trim()) && comment.trim().split(/\s+/).length >= 3;
  if (isCase && ['correct', 'teach', 'banter'].includes(category) && !MEDICAL_TERM.test(comment) && !hedged && !longQuestion &&
      !/^\s*(?:so\s+(?:what|where)|what|why|how|when|where|who|which|did|does|do|is|are|was|were|can|could|will|would|has|have|should)\b/i.test(comment) &&
      /^(?:no|not|nothing|nobody|none)\b/i.test(draft.trim()) && !/^(?:no idea|not sure|no way to (?:know|tell))\b/i.test(draft.trim())) {
    return 'deflating correction of a joke or lay reading: start from why it looks that way, then the answer only if it fits';
  }
  if (/^nailed it[.!\s]*$/i.test(draft) || (category === 'banter' && /\bthat['’]s a new way to describe\b/i.test(draft))) return 'stock praise or commentary instead of responding to the comment';
  if (/\bself[- ]inflicted\b|\bdenial and adaptation\b/i.test(draft)) return 'unsupported blame or patient motivation';
  if (isCase && !/\b(?:i|i['’]m|my|me|we|our)\b/i.test(comment) && /\byour (?:lungs?|symptoms?|medical history|exposure|risk)\b/i.test(draft)) return 'assumed personal medical history';
  if (isCase && comment.length <= 80 && ['correct', 'affirm'].includes(category) && !/\b(?:why|how|explain|treat\w*|risk|mean\w*)\b/i.test(comment) && draft.trim().split(/\s+/).length > 24) return 'overlong response to a short guess';
  return undefined;
}
