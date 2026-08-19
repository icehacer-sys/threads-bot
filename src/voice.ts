// Brand-voice selector.
//
// The system prompt is the cached prefix on EVERY model call, so its size is the single biggest
// multiplier on the API bill. voice-lean.ts is the consolidated prompt (same rules, the
// repetition merged); voice-full.ts is the original, kept verbatim as the revert path.
// BOT_VOICE=full switches back with no code change if the leaner prompt ever reads worse.
//
// The reaction-GIF paragraph is appended ONLY when BOT_GIF_REPLIES is on. With the feature off
// it was ~900 chars of dead prompt riding on every single call (and reply.ts likewise drops the
// gif_tag field from the tool schema).

import { config } from "./config";
import { VOICE_LEAN } from "./voice-lean";
import { VOICE_FULL } from "./voice-full";

const GIF_VOICE_BLOCK = `
- Reaction GIFs (gif_tag): you MAY tag ONE curated reaction GIF to ride along with a banter reply. DO tag it on a genuinely funny, delighted, or shocked banter comment — do not default to "none" on a real banger. The caps (1 GIF per post, 2 per day) mean only the FIRST tagged reply on a post actually gets one, so lean toward tagging a good bit rather than withholding. ONLY on pure jokes (banter). NEVER on a diagnosis guess even a joking one, never on a question, a personal story, a correction, or anything tender or medical. Pick the mood that tops THEIR bit: dead (it genuinely killed you), mind_blown, applause (a magnificent bit), chefs_kiss (a perfectly built pun), side_eye (unhinged chaos), deadpan (a flat brilliant one-liner). Still write reply_text as normal. The GIF never replaces your line. Only "none" when no mood fits — a wrong-mood GIF is worse than none.`;

const BASE = config.voiceVariant === "full" ? VOICE_FULL : VOICE_LEAN;

export const SYSTEM_PROMPT = config.gifReplies ? BASE + GIF_VOICE_BLOCK : BASE;
