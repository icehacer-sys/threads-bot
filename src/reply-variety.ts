import { emojiProfile, nearDuplicates, sharedShapeCount } from './reply-metrics';

const EMOJI = /\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic}️?)*/gu;

/** Decoration can be removed without another model call or withholding a useful reply. */
export function restrainEmoji(text: string, recent: string[]): string {
  const window = recent.slice(-10);
  if (emojiProfile(window).withEmoji >= 2 || emojiProfile(window.slice(-3)).withEmoji > 0) {
    return text.replace(EMOJI, '').replace(/\s+/g, ' ').trim();
  }
  let used = false;
  return text.replace(EMOJI, glyph => { if (used) return ''; used = true; return glyph; }).replace(/\s+/g, ' ').trim();
}

export function varietyNote(recent: string[]): string {
  const window = recent.slice(-10);
  const pairs = nearDuplicates(window);
  const shapes = [...new Set(pairs.map(p => p.example))].slice(0, 3);
  return [
    'Prefer words alone. Emoji is optional decoration, never a default ending. Do not replace one repeated emoji with another.',
    emojiProfile(window).withEmoji >= 2 ? 'Emoji is already frequent in the recent replies. Write this reply without emoji.' : '',
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

/**
 * Phrases a draft reuses from replies already on the post. Medical vocabulary from the answer and
 * facts is exempt: every correct guess shares "guinea worm" and that is not the failure.
 * A shared run of four words in the same order (two or more) counts as a reused sentence shape.
 */
export function repeatedPhrasing(draft: string, recent: string[], protectedText = ''): string[] {
  const exempt = new Set(words(protectedText));
  const pairs = [...contentPairs(draft)].filter(p => !p.split(' ').some(w => exempt.has(w)) && recent.some(r => contentPairs(r).has(p)));
  const shapes = recent.filter(r => sharedShapeCount(r, draft) >= 2).map(r => r.slice(0, 60));
  return [...pairs.map(p => `"${p}"`), ...shapes.map(s => `the shape of "${s}..."`)];
}
