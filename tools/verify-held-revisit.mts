// Audit item 4: released image holds are discoverable and clear once answered. Temp state only.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { config } = await import('../src/config');
const { State } = await import('../src/state');
config.stateFile = join(mkdtempSync(join(tmpdir(), 'held-revisit-')), 'state.json');
const review = (postId: string, resolvedAt?: string) => JSON.stringify({ postId, reason: 'owner review: image/anatomy inconsistency', queuedAt: '2026-09-29T00:00:00Z', ...(resolvedAt ? { resolvedAt, resolution: 'checked' } : {}) });
writeFileSync(config.stateFile, JSON.stringify({
  repliedCommentIds: [], answeredPostIds: [], postCounts: {}, daily: { date: '2020-01-01', count: 0 },
  imageHeldComments: { c1: 'open', c2: 'released', c3: 'released' },
  ownerReviews: { r1: review('open'), r2: review('released', '2026-09-30T00:00:00Z') },
}));
const state = new State();
assert.deepEqual(state.releasedImageHoldPosts(), ['released'], 'only posts whose image review is resolved');
assert.equal(state.isImageHeld('c2', 'released'), true);
assert.equal(state.isWaitingForImageReview('c2', 'released'), false, 'released hold no longer blocks the comment');
assert.equal(state.isWaitingForImageReview('c1', 'open'), true, 'open review still blocks');
state.markReplied('c2', 'released');
state.markSkipped('c3');
assert.deepEqual(state.releasedImageHoldPosts(), [], 'answered or skipped holds clear, so the post stops being revisited');
assert.deepEqual(JSON.parse(readFileSync(config.stateFile, 'utf8')).imageHeldComments, { c1: 'open' }, 'open holds untouched');
assert.equal(config.heldRevisitHours, 72);
const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
assert.match(index, /if \(posting && !revisitIds\.has\(post\.id\)\) \{/, 'revisited posts never resume saved containers (P1 duplicate risk)');
assert.match(index, /if \(revisitIds\.has\(post\.id\) && !state\.isImageHeld\(c\.id, post\.id\)\) return false;/, 'revisit limited to held comments');
assert.match(index, /for \(const post of posts\) \{\n      if \(state\.hasImageReview/, 'answer posting stays limited to fresh posts');
console.log('PASS released image holds: resolved-only discovery, cleared on reply/skip, open holds kept, no resume or answer on revisited posts.');
