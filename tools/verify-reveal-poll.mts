// Reveal poll timing and the voice gate's DeepSeek reveal-hold case (2026-10-26). Pure functions plus a temp file only.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.ANTHROPIC_API_KEY = 'offline-fixture';
process.env.BOT_USAGE_LOG = 'off';
const { revealPollAt, writeRevealPoll } = await import('../src/reveal-poll');
const { VOICE_CASES, voiceCasePassed } = await import('../src/voice-evaluation');
const { config } = await import('../src/config');

// 2026-10-26: post at 19:00:15 UTC, answer at 19:20:38, polls at 19:16 and 19:31. The poll after 19:16 now lands at 19:21:15.
const post = '2026-10-26T19:00:15+0000';
const at = (iso: string) => Date.parse(iso);
assert.equal(config.revealDelayMin, 20, 'default mirrors the publisher answer delay');
assert.equal(revealPollAt(post, at('2026-10-26T19:16:00Z'), 20), at('2026-10-26T19:21:15Z') / 1000, 'one minute after the expected reveal');
assert.equal(revealPollAt(post, at('2026-10-26T19:00:30Z'), 20), at('2026-10-26T19:21:15Z') / 1000, 'same target from the first poll');
// The publisher is late: short rechecks for 30 min after the expected reveal, then the normal cadence.
assert.equal(revealPollAt(post, at('2026-10-26T19:22:00Z'), 20), at('2026-10-26T19:25:00Z') / 1000);
assert.equal(revealPollAt(post, at('2026-10-26T19:49:00Z'), 20), at('2026-10-26T19:52:00Z') / 1000);
assert.equal(revealPollAt(post, at('2026-10-26T19:50:15Z'), 20), null, 'gives up 50 min after posting');
assert.equal(revealPollAt(post, at('2026-10-26T19:16:00Z'), 0), null, '0 turns it off');
assert.equal(revealPollAt('not a time', Date.now(), 20), null);
console.log('PASS reveal poll lands just after the answer, rechecks a late publisher and gives up');

const dir = mkdtempSync(join(tmpdir(), 'reveal-poll-'));
const file = join(dir, '.reveal-poll-at');
writeRevealPoll([1800, 1500], file);
assert.equal(readFileSync(file, 'utf8'), '1500\n', 'earliest due time with a newline for bash read');
writeRevealPoll([], file);
assert.equal(existsSync(file), false, 'no pending reveal removes the file');
writeRevealPoll([], file);
writeRevealPoll([1], join(dir, 'missing', 'x'));
console.log('PASS reveal poll file is written, cleared and never throws');

// Voice gate: DeepSeek holds every pre-reveal reply on a case post. That hold is the live outcome for the
// third-party story, so it passes there. It never passes a public case and a Claude draft still needs banter.
const story = VOICE_CASES.find(c => c.name === 'completed third-party story with joke')!;
const banter = VOICE_CASES.find(c => c.name === 'banter')!;
const hold = { decision: 'skip', category: 'other', reply_text: '', reason: 'spoiler guard: DeepSeek pre-reveal reply held until the answer is public | guard:forced-skip' } as const;
const otherSkip = { decision: 'skip', category: 'other', reply_text: '', reason: 'conversation guard: receipt or unrepaired pre-reveal grading | guard:forced-skip' } as const;
const joke = { decision: 'reply', category: 'banter', reply_text: 'Two for the price of one.', reason: 'joke' } as const;
assert.equal(voiceCasePassed(story, hold), true, '2026-10-19 and 2026-10-26 failures');
assert.equal(voiceCasePassed(story, joke), true);
assert.equal(voiceCasePassed(story, otherSkip), false, 'only the DeepSeek reveal hold, not any skip');
assert.equal(voiceCasePassed(banter, hold), false, 'a public case never accepts the hold');
assert.equal(voiceCasePassed(story, { ...hold, reason: 'error: DeepSeek timeout' }), false);
assert.equal(VOICE_CASES.filter(c => 'revealHold' in c).length, 1, 'no other case silently loosened');
console.log('PASS voice gate accepts the DeepSeek reveal hold only on the pre-reveal story case');
