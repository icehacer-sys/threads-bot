/** Narrow contextual cue, not a general sarcasm classifier. */
export function isWordingReaction(post: string, comment: string): boolean {
  const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const quoted = comment.match(/^\s*["“]([^"“”]+)["”]\s*[.!?…]*\s*(really|seriously|wow|no kidding|you don['’]t say)\s*[.!?…]*\s*$/i);
  if (quoted) {
    const phrase = normalize(quoted[1]);
    return phrase.split(' ').length >= 4 && normalize(post).includes(phrase);
  }
  return /^(?:that|this|the|your)\s+(?:caption|wording|description|phrasing)\s+(?:(?:is|was)\s+)?(?:so |a bit |way too |really )?(?:dramatic|wordy|overwritten|long-winded|overcomplicated|melodramatic)[.!?…]*$/i.test(comment.trim());
}

export const WORDING_NOTE = 'CONTEXT CUE: The commenter is reacting to how this post is written. A quoted phrase from the caption followed only by Really? can be dry criticism of the wording or obviousness, not surprise at the scan. Address the phrasing with a brief good-humored acknowledgment. Make the wording itself the subject of one plain sentence of at most 12 words. No elaborate metaphor, analogy, second sentence or explanation of what the object really is. Avoid generic agreement such as Yes, Exactly or You are right because it can sound like diagnosis confirmation before the reveal. Do not agree that the image is shocking, restate the medical finding, praise their diagnosis or explain your joke. Do not defend the caption or invent an author backstory. This cue is not proof of sarcasm; if intent remains unclear, skip. Keep all reveal, authenticity and medical boundaries.';

export function wordingReplyIssue(category: string, text: string): boolean {
  return text.trim().split(/\s+/).length > 12 || ['affirm', 'correct', 'teach'].includes(category) || /\b(?:double take|at the monitor|shocking|shocked|surpris(?:e|ing)|scary|terrifying|can['’]t believe|cannot believe|that['’]s the kind of detail)\b/i.test(text);
}
