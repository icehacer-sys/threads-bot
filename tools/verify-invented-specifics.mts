// Offline checks for the two guards added after the 2026-09-15 Guinea worm audit. No network.
// Run: npx tsx tools/verify-invented-specifics.mts
//
// Fixtures are REAL replies from that night, so a failure means a guard stopped catching the thing
// it was built for.
import assert from 'node:assert/strict';
import { unsupportedSpecifics } from '../src/case-evidence';
import { repeatedPhrasing } from '../src/reply-variety';

const oldFacts = 'A long serpentine soft-tissue calcification suggests a calcified worm remnant. An incidental calcified remnant often needs no removal.';
// Improvised timelines, history and sizes.
assert.deepEqual(unsupportedSpecifics('A guinea worm that calcified after working its way out through the skin over weeks.', oldFacts), ['week']);
assert.deepEqual(unsupportedSpecifics("He'd probably tell you it took centuries of eradication work.", oldFacts), ['centur']);
assert.deepEqual(unsupportedSpecifics('Metres of slow-motion horror wrapped up in one calcified line.', oldFacts), ['metre']);
assert.deepEqual(unsupportedSpecifics("That's one way to describe a months-long exit strategy.", oldFacts), ['month']);
// Supported by the facts or by the commenter's own words.
const newFacts = 'About a year after infection the female worm which can reach about 1 metre moves toward the skin.';
assert.deepEqual(unsupportedSpecifics('The female can reach about a metre and it takes about a year.', newFacts), []);
assert.deepEqual(unsupportedSpecifics('Four days to get that euro back.', 'It took four days to find the euro'), []);
assert.deepEqual(unsupportedSpecifics('He worked in mining for years and died weeks after diagnosis.', 'Worked in coal mines for 6-7yrs and died 9wks after diagnosis.'), []);
assert.deepEqual(unsupportedSpecifics('He died weeks after diagnosis.', 'He worked in coal mines for 6-7yrs.'), ['week']);
assert.deepEqual(unsupportedSpecifics('It took 4wks.', 'No duration supplied.'), ['week']);
assert.deepEqual(unsupportedSpecifics('Symptoms lasted months.', 'Symptoms lasted 2mos.'), []);
assert.deepEqual(unsupportedSpecifics('The foot is outside this image.', 'The ankle is shown.'), []);
assert.deepEqual(unsupportedSpecifics('It was two feet long.', 'No length supplied.'), ['foot']);
assert.deepEqual(unsupportedSpecifics('It was 2 feet long.', 'A foot view was provided.'), ['foot']);
// No specifics at all.
assert.deepEqual(unsupportedSpecifics('Taxonomy officially updated.', oldFacts), []);

const protectedText = 'Dracunculiasis / Guinea worm / Dracunculus medinensis ' + oldFacts;
const posted = [
  "Weeks of slow-motion horror wrapped up in one calcified line.",
  "That's one way to describe a months-long exit strategy.",
  "The good news is it's already dead and calcified so the calf gets to stay put.",
];
assert.ok(repeatedPhrasing('Metres of slow-motion horror wrapped up in one calcified line.', posted, protectedText).length > 0, 'near-verbatim punchline');
assert.ok(repeatedPhrasing('This one definitely had an exit strategy that demanded an audience.', posted, protectedText).some(p => p.includes('exit strategy')), 'reused content phrase');
assert.ok(repeatedPhrasing("That's one way to shorten the consent form.", posted, protectedText).length > 0, "reused 'that's one way to' shape");
// Shared medical vocabulary is not repetition.
assert.deepEqual(repeatedPhrasing('Calcified guinea worm.', ['That is a calcified guinea worm.'], protectedText), []);
assert.deepEqual(repeatedPhrasing('Taxonomy officially updated.', posted, protectedText), []);
console.log('PASS invented time spans and sizes, reused phrases and shapes, medical vocabulary exempt');
