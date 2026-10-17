import { State } from '../src/state';
const state = new State();
const id = process.argv.find(a => a.startsWith('--resolve='))?.slice(10);
if (id) {
  const note = process.argv.find(a => a.startsWith('--note='))?.slice(7) ?? '';
  state.resolveOwnerReview(id, note);
  console.log('Resolved owner review '+id+' locally. Sync this state to main for the cloud worker.');
}
// Items queued longer ago than BOT_OWNER_REVIEW_EXPIRY_HOURS are expired by the worker at its next poll
// (State.expireOwnerReviews). This local listing hides them without writing state.
const { config } = await import('../src/config');
const pending = state.pendingOwnerReviews();
const cutoff = Date.now() - config.ownerReviewExpiryHours * 3_600_000;
const live = config.ownerReviewExpiryHours > 0 ? pending.filter(r => !(Date.parse(r.queuedAt) <= cutoff)) : pending;
if (live.length !== pending.length) console.log(`${pending.length - live.length} item(s) queued more than ${config.ownerReviewExpiryHours}h ago are hidden; the worker expires them at its next poll.`);
console.log(JSON.stringify(live, null, 2));
