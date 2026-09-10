import assert from 'node:assert/strict';
import { sanitize } from '../src/reply';

const clean = (text: string) => sanitize({ decision: 'reply', category: 'banter', reply_text: text, reason: 'punctuation fixture' }, { isPublic: true, terms: [] }).reply_text;
for (const text of [
  'Four days of searching, all for one euro.',
  'Still, that is a long wait.',
  'The coin came back, which is more than most investments manage.',
  'Four days, and the euro finally returned.',
  'She said "explain this one, Doc".',
  'That is 1,000 coins, not one.',
  'Coins, keys, and buttons.',
  'One euro. And a story for life.',
]) assert.equal(clean(text), text);
assert.equal(clean('Four days of searching — all for one euro.'), 'Four days of searching, all for one euro.');
assert.equal(clean('A 2–3 day wait.'), 'A 2-3 day wait.');
console.log('PASS natural commas, connected clauses, quotations, numbers and complete sentences survive formatting');
