import { State } from '../src/state';
const state = new State();
const id = process.argv.find(a => a.startsWith('--resolve='))?.slice(10);
if (id) {
  const note = process.argv.find(a => a.startsWith('--note='))?.slice(7) ?? '';
  state.resolveOwnerReview(id, note);
  console.log('Resolved owner review '+id+' locally. Sync this state to main for the cloud worker.');
}
console.log(JSON.stringify(state.pendingOwnerReviews(), null, 2));
