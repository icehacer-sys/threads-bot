import assert from 'node:assert/strict';
import { replyStyleIssue, needsClinicalReview, clinicalClaimIssue, isLossStory } from '../src/reply-style';
import { sanitize } from '../src/reply';
for (const text of ['Four days to get one euro back.', 'Coins, keys and buttons.', 'Coins, keys, and buttons.', 'Coins, keys, buttons and pins.', 'A coin and a story for life.', 'That cost 1000 euros.']) assert.equal(replyStyleIssue(text), undefined, text);
for (const text of ['Coin, it turned out.', 'This is a coin. And yeah.', 'Coin.And a story.', 'It was bright. Which is why.', 'Fine; they said.', 'Fine； they said.', 'Nickel, it is a coin, yep.', 'She said "explain this one, Doc".', 'A 1,000 euro bill.', 'Coins, which are metal, and buttons.', 'Four days — all for a euro.']) {
  assert.ok(replyStyleIssue(text), text);
  assert.equal(sanitize({ decision: 'reply', category: 'banter', reply_text: text, reason: 'test' }).decision, 'skip', text);
}
for (const text of ['The lateral view shows a halo sign.', 'It cleared the airway.', 'Breathing is fine.', 'The crisp disc rules out a battery.']) assert.equal(clinicalClaimIssue(text), true, text);
assert.equal(clinicalClaimIssue('The halo is on the AP view and the step-off is on the lateral view.'), false);
assert.equal(needsClinicalReview('Endoscopy is the main move.'), true);
assert.equal(sanitize({decision:'reply',category:'banter',reply_text:'Endoscopy is the main move.',reason:'test'}).category, 'teach');
assert.equal(needsClinicalReview("That's the one."), false);
assert.equal(isLossStory('As a child I lost a friend who choked on a penny. It is seared in my memory.'), true);
assert.equal(isLossStory('I lost a coin under the sofa.'), false);
console.log('PASS lists-only commas, no semicolons or fragmented transitions, clinical safeguards and loss-story priority');
