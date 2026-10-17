// Owner-review auto-expiry (owner approved 2026-10-17). Temp state only; never production state.json.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.ANTHROPIC_API_KEY = 'offline-fixture';
const { config } = await import('../src/config');
const { State } = await import('../src/state');
assert.equal(config.ownerReviewExpiryHours, 48, 'default window is 48 hours');
const now = new Date('2026-10-17T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const review = (postId: string, reason: string, h: number, extra: object = {}) => JSON.stringify({ postId, reason, commentText: 'x', username: 'u', queuedAt: hoursAgo(h), ...extra });
const dir = mkdtempSync(join(tmpdir(), 'review-expiry-'));
config.stateFile = join(dir, 'state.json');
const base = {
  repliedCommentIds: ['kept'], answeredPostIds: [], postCounts: {}, daily: { date: '2020-01-01', count: 0 },
  ownerReviews: {
    old1: review('p-old', 'owner review: AI-provenance comment', 72),
    old2: review('p-old', 'owner review: personal medical concern', 49),
    oldImage: review('p-img', 'owner review: image/anatomy inconsistency', 60),
    fresh: review('p-new', 'owner review: image/anatomy inconsistency', 5),
    resolved: review('p-old', 'owner review: x', 200, { resolvedAt: hoursAgo(100), resolution: 'owner note' }),
  },
  imageHeldComments: { heldOld: 'p-img', heldNew: 'p-new' },
};
writeFileSync(config.stateFile, JSON.stringify(base));
const state = new State();
assert.equal(state.pendingOwnerReviews().length, 4);
assert.equal(state.releasedImageHoldPosts().length, 0, 'both image posts are still under review');
assert.equal(state.expireOwnerReviews(0, now), 0, '0 disables expiry');
assert.equal(state.expireOwnerReviews(48, now), 3, 'three items older than 48h expire');
assert.deepEqual(state.pendingOwnerReviews().map((r) => r.commentId), ['fresh'], 'the fresh item stays');
assert.equal(state.hasImageReview('p-img'), false); assert.equal(state.hasImageReview('p-new'), true);
assert.deepEqual(state.releasedImageHoldPosts(), [], 'an expired image review drops its held comments instead of releasing them for a revisit');
assert.equal(state.isWaitingForImageReview('heldNew', 'p-new'), true, 'holds on posts still under review are kept');
assert.equal(state.expireOwnerReviews(48, now), 0, 'idempotent');
const saved = JSON.parse(readFileSync(config.stateFile, 'utf8'));
const expired = JSON.parse(saved.ownerReviews.old1);
assert.equal(expired.expired, true); assert.match(expired.resolution, /^auto-expired/); assert.equal(expired.queuedAt, hoursAgo(72), 'original fields kept');
assert.equal(JSON.parse(saved.ownerReviews.resolved).resolution, 'owner note', 'owner resolutions are untouched');
assert.deepEqual(saved.repliedCommentIds, ['kept'], 'other history preserved');
assert.equal(state.hasOwnerReview('old1'), true, 'expired items still count as reviewed for the late sweep');
console.log('PASS owner-review expiry: items queued more than 48h ago resolve as auto-expired, fresh and owner-resolved items untouched, expired image holds dropped not revisited, configurable and idempotent.');
