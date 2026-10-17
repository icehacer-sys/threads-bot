// A finite verb (or contraction) marks a sentence that stands on its own. A three-plus word sentence without
// one, placed before the last sentence, is a joke setup split from its punchline.
const FINITE_VERB = /\b(?:is|are|was|were|be|been|am|has|have|had|do|does|did|can|could|will|would|should|may|might|must|shall|got|gets|get|goes|go|went|came|comes|come|made|makes|make|took|takes|take|kept|keeps|knew|know|knows|said|says|say|saw|sees|see|ate|eats|let|lets|put|puts|need|needs|want|wants|look|looks|think|thinks|feel|feels|tried|tries|try|ran|runs|won|wins|lost|found|told|heard|left|stays|stayed|wins|owes|owe|works|worked|turns|turned|sounds|sounded|seems|seemed|belongs|belonged|lives|lived|moved|moves|grew|grows|showed|shows|means|meant|beat|beats|hit|hits|wait|waits|happened|happens|counts|counted|checks|checked|imagine|give|tell|keep|stop|watch|hold|trust|blame|ask|meet|call|bring|rang|sang|ran|fell|broke|bit|blew|built|bought|caught|chose|drank|drove|fed|felt|fought|flew|forgot|froze|gave|hid|hung|held|hurt|laid|led|lent|lit|met|paid|quit|rode|rose|sold|sent|set|shook|shot|shut|slept|slid|spoke|spent|spun|stood|stole|stuck|struck|swam|swung|taught|tore|threw|wore|woke|wrote|sat|sank|dug|began|begun|became|become|brought|thought|sought|fought|meant|dealt|cost|cut|read|lay|lie|lies|sit|sits|stand|stands|wins|win)\b|\w+(?:'|’)(?:s|re|ve|ll|d|m|t)\b|\b\w{2,}ed\b/i;
const CONNECTOR_FRAGMENT = /^(?:still|and yeah|so yeah|anyway|meanwhile|plot twist|fun fact|imagine|picture this|spoiler|update|twist|honestly)[.!?]*$/i;

/** Conservative list recognition. Ambiguous prose must be redrafted, not split mechanically. */
export function replyStyleIssue(text: string, category?: string): string | undefined {
  if (/[;；؛]/u.test(text)) return 'semicolon';
  if (/[—–]/u.test(text)) return 'prose dash';
  if (/[.!?]\s*["“(]*\s*(?:and|which)\b/i.test(text)) return 'fragmented sentence transition';
  if (category === 'banter') {
    // Owner voice update (2026-10-17): banter may use one to three short sentences and very short
    // replies ("Nope." is a complete reply). What stays banned is the setup fragment plus punchline
    // ("Dial tone first then the receiver. This one came with..."), a pile of choppy fragments and
    // anything longer than three sentences.
    const prose = text.replace(/\b(?:Mr|Mrs|Ms|Dr|Prof|St|e\.g|i\.e)\./gi, word => word.replace(/\./g, ''));
    const sentences = prose.split(/(?<=[.!?])\s+|\n+/u).filter(sentence => /\p{L}/u.test(sentence));
    if (sentences.length > 1) {
      const wordCount = (s: string) => (s.match(/[\p{L}\p{N}'’]+/gu) ?? []).length;
      const setupFragment = sentences.slice(0, -1).some(s => wordCount(s) >= 3 && !FINITE_VERB.test(s));
      const choppy = sentences.length >= 3 && sentences.every(s => wordCount(s) <= 3);
      const connectorFragment = sentences.some(s => CONNECTOR_FRAGMENT.test(s.trim()));
      if (sentences.length > 3 || setupFragment || choppy || connectorFragment) return 'split banter';
    }
  }
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
