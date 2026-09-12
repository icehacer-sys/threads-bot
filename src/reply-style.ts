/** Conservative list recognition. Ambiguous prose must be redrafted, not split mechanically. */
export function replyStyleIssue(text: string): string | undefined {
  if (/[;；؛]/u.test(text)) return 'semicolon';
  if (/[—–]/u.test(text)) return 'prose dash';
  if (/[.!?]\s*["“(]*\s*(?:and|which)\b/i.test(text)) return 'fragmented sentence transition';
  for (const sentence of text.split(/[.!?\n]+/)) {
    if (!sentence.includes(',')) continue;
    // A list must contain at least three short items and an explicit final and/or.
    const items = sentence.split(',').map(s => s.trim());
    if (/\s+(?:and|or)\s+/i.test(items.at(-1) ?? '')) {
      const last = items.pop()!.split(/\s+(?:and|or)\s+/i);
      items.push(...last);
    } else if (!/^(?:and|or)\s+/i.test(items.at(-1) ?? '')) return 'comma outside a list';
    if (items.length < 3 || items.some(s => !s || s.split(/\s+/).length > 6 || /\b(?:is|are|was|were|would|could|should|will|can|has|have|had|it|this|that|which|though|because|since|but|so|they|you|we)\b/i.test(s))) return 'comma outside a list';
  }
  return undefined;
}

export function needsClinicalReview(text: string): boolean {
  return /\b(?:biopsy|histolog\w*|patholog\w*|differential|confirmed|diagnos\w*|endoscop\w*|surgery|sedation|ana?esthesia|tissue|airway|windpipe|trachea|halo|step.off|double.ring|radiopa\w*|burn\w*|rigid scope|breathing|urgent|emergency|invisible on x.ray)\b/i.test(text);
}

export function isLossStory(text: string): boolean {
  return /\b(?:i|my|our|we)\b/i.test(text) && /\b(?:lost (?:a |my |our )?(?:friend|child|son|daughter|sister|brother|mother|father|mum|mom|dad)|died|passed away)\b/i.test(text);
}

export function clinicalClaimIssue(text: string): boolean {
  return /\bbreathing (?:is |looks )?fine\b|\bcleared the airway\b|\blateral view[^.!?]{0,65}\b(?:halo|double.ring)\b|\b(?:crisp|bright)[^.!?]{0,65}\brules? out (?:a )?(?:button )?battery\b/i.test(text);
}
