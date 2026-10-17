import { emojiProfile, nearDuplicates, sharedShapeCount } from './reply-metrics';

const EMOJI = /\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic}️?)*/gu;

// The account owner's emoji set. Everything else is stripped before posting (reply.ts sanitize).
export const ALLOWED_EMOJI = new Set(["🤣", "😭", "🤍", "🫡", "✅", "💯", "👏"]);
const isAllowedEmoji = (glyph: string) => ALLOWED_EMOJI.has([...glyph][0]);

/**
 * Decoration can be removed without another model call or withholding a useful reply.
 * Owner voice update (2026-10-17): roughly one reply in five may carry ONE allowed emoji. The ceiling:
 * none on serious replies (grief, fear, corrections, medical answers), none when two of the last ten
 * replies already had one or any of the last four did, and never more than one per reply. Only an
 * allowed glyph can take the single slot, so a stripped glyph never uses up the allowance.
 */
export function restrainEmoji(text: string, recent: string[], serious = false): string {
  const window = recent.slice(-10);
  if (serious || emojiProfile(window).withEmoji >= 2 || emojiProfile(window.slice(-4)).withEmoji > 0) {
    return text.replace(EMOJI, '').replace(/\s+/g, ' ').trim();
  }
  let used = false;
  return text.replace(EMOJI, glyph => { if (used || !isAllowedEmoji(glyph)) return ''; used = true; return glyph; }).replace(/\s+/g, ' ').trim();
}

// 2026-10-17 audit: "...and the is doing a lot of work in that sentence." An emoji used as a noun between
// a determiner and a verb cannot be removed without breaking the sentence.
const EMOJI_AS_WORD = new RegExp(String.raw`\b(?:the|that|this|these|those|your|my|his|her|their|our|a|an|one)\s+(${EMOJI.source})\s+(?:is|are|was|were|has|have|had|does|did|do|says|said|looks|seems|feels|doing|just|really|already|can|could|would|will)\b`, 'giu');
/** True when an emoji the draft used as a word was removed from the posted text. */
export function emojiRemovalBreaksText(original: string, kept: string): boolean {
  for (const m of original.matchAll(EMOJI_AS_WORD)) if (!kept.includes(m[1])) return true;
  // A bare determiner before a verb is never grammatical; after any emoji removal treat it as broken.
  return /\p{Extended_Pictographic}/u.test(original) && /\b(?:the|a|an|your|my)\s+(?:is|are|was|were|does|did)\b/i.test(kept);
}

// 2-6 word confirmations for a correct guess whose fuller draft kept repeating the post's earlier replies.
// Every entry matches index.ts STAMP_RE so its dedupeStamp rotation and duplicate exemption apply.
export const SHORT_CONFIRMATIONS = ["That's the one", "Yep that's it", "Spot on", "You got it", "Dead on", "Bang on", "Exactly right", "Called it", "You are correct", "Textbook"];
const confirmationKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
/** First short confirmation not already used on the post (by normalized text). */
export function shortConfirmation(recent: string[]): string {
  const used = new Set(recent.map(confirmationKey));
  return SHORT_CONFIRMATIONS.find(s => !used.has(confirmationKey(s))) ?? SHORT_CONFIRMATIONS[recent.length % SHORT_CONFIRMATIONS.length];
}

export function varietyNote(recent: string[]): string {
  const window = recent.slice(-10);
  const pairs = nearDuplicates(window);
  const shapes = [...new Set(pairs.map(p => p.example))].slice(0, 3);
  return [
    'Words carry the reply. An emoji is optional and never a default ending. Do not replace one repeated emoji with another.',
    emojiProfile(window).withEmoji >= 2 ? 'Emoji is already frequent in the recent replies. Write this reply without emoji.' : '',
    window.length >= 4 && emojiProfile(window.slice(-6)).withEmoji === 0 ? 'None of the recent replies used an emoji. If this one is light banter and one emoji from the allowed set (🤣 😭 🤍 🫡 ✅ 💯 👏) adds real tone you may use it. Never on sad, scared, serious or medical replies.' : '',
    shapes.length ? `Recent replies repeated these phrases: ${JSON.stringify(shapes)}. Use a fresh construction when possible without changing medical meaning. Shared medical terms are fine. Do not skip a useful answer merely because its topic repeats.` : '',
  ].filter(Boolean).join('\n');
}

// Words too common to make a phrase distinctive. A repeated pair of CONTENT words is the tell:
// the 2026-09-15 night reused "exit strategy" four times and "slow-motion horror wrapped up in
// one calcified line" twice, none of which the exact-duplicate backstop could see.
const STOP = new Set("a an the and or but so to of in on at by for with from as is are was were be been being it its this that these those there their they them you your i me my we our us he she his her not no yes yep just really very way one ones what who how why when where which than then too also only even still more most much some any all can could would should will do does did done have has had get got make made like about into out up down over off here now back once again that's it's".split(' '));
const words = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z' ]+/g, ' ').split(/\s+/).filter(Boolean);
function contentPairs(s: string): Set<string> {
  const w = words(s);
  const out = new Set<string>();
  for (let i = 0; i + 1 < w.length; i++) {
    if (STOP.has(w[i]) || STOP.has(w[i + 1]) || w[i].length < 3 || w[i + 1].length < 3) continue;
    out.add(`${w[i]} ${w[i + 1]}`);
  }
  return out;
}

// Template shapes built only from common words, which content pairs cannot see. The 2026-10-09 audit
// counted "would at least have" 11 times and "That is the one" 4 times on single posts.
const STOCK_SHAPES: Array<[string, RegExp]> = [
  ['would at least', /\bwould at least\b/i],
  ['that is the one', /^(?:that is|that's) the one\b/i],
  ['heavy lifting', /\bheavy lifting\b/i],
  ['doing a lot of work', /\bdoing (?:a lot of|most of the|all the) (?:work|talking)\b/i],
  ['is the correct reaction', /\bis the correct (?:response|reaction|unit|move|amount)\b/i],
  // 2026-10-12 audit: after #41 the reaction-grading template moved to words ("Wow is about the right speed").
  ['is about the right', /\bis about (?:the )?right\b/i],
];
// 2026-10-17 audit stock lines, with how many earlier replies on the post may already use them before a
// draft counts as reusing the shape: "Any time and..." x4, "That was my first read too" x3, a bare
// "You're welcome.", "It hits different", "You nailed both", "three letters". 0 means never.
const STOCK_LIMITED: Array<[string, RegExp, number]> = [
  ['any time', /\bany ?time\b/i, 1],
  ['first read too', /\bfirst (?:read|thought|guess) too\b/i, 1],
  ['three letters', /\bthree letters\b/i, 1],
  ["you're welcome", /^\s*(?:you(?:'|’)?re|you are) (?:so |very |most )?welcome[.!\s\p{Extended_Pictographic}]*$/iu, 1],
  ['hits different', /\bhits? (?:different|differently)\b/i, 0],
  ['you nailed', /\byou nailed\b/i, 0],
];
// A facts phrase may repeat across a post, but not become a refrain ("both hila" 15 times, "bat wing" 19).
const FACT_REFRAIN = 6;
// 2026-10-12 audit: "through the blood" sat in 62 of 248 replies on one post. contentPairs drops every pair
// that touches a stopword, so refrains such as "through the blood" or "on its own" were invisible to it.
const RUN_REFRAIN = 5;
function runs(s: string): Set<string> {
  const w = words(s);
  const out = new Set<string>();
  for (let i = 0; i + 3 <= w.length; i++) {
    const gram = w.slice(i, i + 3);
    if (gram.some(x => !STOP.has(x) && x.length >= 4)) out.add(gram.join(' '));
  }
  return out;
}

/**
 * Phrases a draft reuses from replies already on the post. Medical vocabulary from the answer and
 * facts is exempt: every correct guess shares "guinea worm" and that is not the failure.
 * A shared run of four words in the same order (two or more) counts as a reused sentence shape.
 * Facts vocabulary (not the answer itself) stops being exempt once it is a refrain in recent replies,
 * and stock template shapes count once two recent replies already used them.
 */
export function repeatedPhrasing(draft: string, recent: string[], protectedText = '', answerText?: string): string[] {
  const exempt = new Set(words(protectedText));
  const answerWords = new Set(words(answerText ?? protectedText));
  const pairs = [...contentPairs(draft)].filter(p => !p.split(' ').some(w => exempt.has(w)) && recent.some(r => contentPairs(r).has(p)));
  const refrains = [...contentPairs(draft)].filter(p => p.split(' ').some(w => exempt.has(w)) && !p.split(' ').some(w => answerWords.has(w)) &&
    recent.filter(r => contentPairs(r).has(p)).length >= FACT_REFRAIN);
  const runRefrains = [...runs(draft)].filter(g => !g.split(' ').some(w => answerWords.has(w)) &&
    recent.filter(r => runs(r).has(g)).length >= RUN_REFRAIN);
  const stock = [
    ...STOCK_SHAPES.filter(([, re]) => re.test(draft) && recent.filter(r => re.test(r)).length >= 2).map(([name]) => name),
    ...STOCK_LIMITED.filter(([, re, limit]) => re.test(draft) && recent.filter(r => re.test(r)).length >= limit).map(([name]) => name),
  ];
  const shapes = recent.filter(r => sharedShapeCount(r, draft) >= 2).map(r => r.slice(0, 60));
  return [...pairs.map(p => `"${p}"`), ...refrains.map(p => `the refrain "${p}"`), ...runRefrains.map(g => `the refrain "${g}"`), ...stock.map(s => `the stock phrase "${s}"`), ...shapes.map(s => `the shape of "${s}..."`)];
}
