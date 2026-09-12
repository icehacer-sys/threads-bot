import { emojiProfile, nearDuplicates } from './reply-metrics';

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
