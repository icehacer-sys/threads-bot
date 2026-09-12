// Audit metrics for a night of replies. Pure functions: no network, no state, no model calls.
//
// Both detectors here exist because the 2026-09-12 audit found two real failures that the
// existing metrics block reported as clean:
//
//   1. Eleven of 72 replies were the same correction reskinned ("Close but it's an odontogenic
//      keratocyst. Both wrap around an impacted tooth ... histology is what separates them").
//      The old check compared replies for EXACT equality, so it printed "exact duplicate
//      replies: none" and was technically right. Near-duplicates are the actual tell.
//
//   2. 🤣 sat at 0.0% against its 31.7% historical baseline and looked fixed, while 😭 had
//      taken over at 36.1% with 34.7% of replies ending on it. The old check was pinned to the
//      🤣 glyph by name, so the same behaviour wearing a new face was invisible. Measuring the
//      glyph rather than the BEHAVIOUR is what let it run for two months.
//
// The lesson shaping both: measure the shape, not the instance.

/** Lowercased alphanumeric words. Punctuation and case are noise when comparing reply shapes. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/**
 * Word n-grams of a reply. A shared 4-gram means the same run of four words in the same order,
 * which catches a reused SENTENCE SHAPE rather than merely reused vocabulary -- two replies about
 * the same diagnosis will obviously share nouns, and that is not the failure we are hunting.
 */
export function shapeGrams(text: string, n = 4): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

/** How many n-gram shapes two replies have in common. */
export function sharedShapeCount(a: string, b: string, n = 4): number {
  const ga = shapeGrams(a, n);
  let shared = 0;
  for (const g of shapeGrams(b, n)) if (ga.has(g)) shared++;
  return shared;
}

export interface NearDuplicate {
  /** 1-based indices, matching how the audit prints the reply list. */
  a: number;
  b: number;
  shared: number;
  example: string;
}

/**
 * Reply pairs that reuse the same shape. `minShared` of 2 was calibrated on the 2026-09-11 night:
 * it surfaces the whole correction cluster while leaving ordinary shared phrasing alone.
 *
 * Replies shorter than `n` words produce no grams and can never be flagged here. That is
 * deliberate -- two replies of "That's it." are a real repetition but a SHORT one, and the exact
 * duplicate check already owns that case. The two detectors are complementary, not redundant.
 */
export function nearDuplicates(replies: string[], minShared = 2, n = 4): NearDuplicate[] {
  const grams = replies.map((r) => shapeGrams(r, n));
  const out: NearDuplicate[] = [];
  for (let i = 0; i < replies.length; i++) {
    for (let j = i + 1; j < replies.length; j++) {
      const shared: string[] = [];
      for (const g of grams[j]) if (grams[i].has(g)) shared.push(g);
      if (shared.length >= minShared) out.push({ a: i + 1, b: j + 1, shared: shared.length, example: shared[0] });
    }
  }
  return out.sort((x, y) => y.shared - x.shared);
}

/**
 * Groups of replies transitively linked by shared shapes. A reader scrolling the thread does not
 * experience "28 similar pairs", they experience "the bot said the same thing eleven times", so
 * the cluster is the number worth reporting.
 *
 * Linking IS transitive, so a cluster can chain two formulas that share a bridging reply without
 * the far ends resembling each other. Read the cluster as "this many replies are formulaic" and
 * the pair list for which exact shapes repeat. On 2026-09-11 this grouped 17 replies: the
 * 11-reply histology correction plus the "dark cavity here" and "quietly for years" families.
 */
export function shapeClusters(replies: string[], minShared = 2, n = 4): number[][] {
  const parent = replies.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (const { a, b } of nearDuplicates(replies, minShared, n)) parent[find(a - 1)] = find(b - 1);
  const groups = new Map<number, number[]>();
  for (let i = 0; i < replies.length; i++) {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), i + 1]);
  }
  return [...groups.values()].filter((g) => g.length > 1).sort((x, y) => y.length - x.length);
}

// One emoji as a user sees it: base pictograph plus any variation selector, skin tone, or
// ZWJ-joined continuation. Counting raw code points would split 🧚‍♀️ into several "emoji" and
// inflate every rate. Mirrors the sequence handling in reply.ts.
const EMOJI_SEQ = /\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic}️?)*/gu;

export interface EmojiProfile {
  /** Replies containing at least one emoji. */
  withEmoji: number;
  /** Replies ENDING on an emoji -- the specific shape that reads as a tic. */
  trailing: number;
  /** Glyph -> count of replies containing it, most frequent first. */
  byGlyph: { glyph: string; replies: number; trailing: number }[];
}

/**
 * Glyph-agnostic emoji usage. Deliberately reports whatever the top glyph IS rather than asking
 * about one named in advance, so the next crutch is visible the first night it appears instead of
 * after someone thinks to add a regex for it.
 */
export function emojiProfile(replies: string[]): EmojiProfile {
  const counts = new Map<string, { replies: number; trailing: number }>();
  let withEmoji = 0;
  let trailing = 0;
  for (const reply of replies) {
    const found = reply.match(EMOJI_SEQ) ?? [];
    if (found.length) withEmoji++;
    const trailingMatch = reply.trim().match(new RegExp(`(?:${EMOJI_SEQ.source})$`, "u"));
    if (trailingMatch) trailing++;
    for (const glyph of new Set(found)) {
      const entry = counts.get(glyph) ?? { replies: 0, trailing: 0 };
      entry.replies++;
      if (trailingMatch?.[0] === glyph) entry.trailing++;
      counts.set(glyph, entry);
    }
  }
  const byGlyph = [...counts.entries()]
    .map(([glyph, v]) => ({ glyph, ...v }))
    .sort((a, b) => b.replies - a.replies);
  return { withEmoji, trailing, byGlyph };
}
