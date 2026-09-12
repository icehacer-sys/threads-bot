// Offline checks for the two 2026-09-12 audit detectors. No network, no model calls.
// Run: npm run repetition:verify
//
// The fixtures are REAL replies from the 2026-09-11 keratocyst night -- the exact batch both
// detectors were built to catch -- so a regression here means the detector stopped catching the
// thing it exists for, not that an invented example drifted.
import assert from "node:assert/strict";
import { emojiProfile, nearDuplicates, shapeClusters, sharedShapeCount, shapeGrams } from "../src/reply-metrics";

// --- near-duplicate detection -------------------------------------------------------------
// #6, #35 and #43 from the night: the same correction reskinned three ways.
const correction6 = "Close but this one came back as an odontogenic keratocyst. Both wrap around an impacted tooth and look nearly identical on the scan so histology is what calls it.";
const correction35 = "Close but it's an odontogenic keratocyst. Both wrap around an impacted tooth and look similar on the scan so histology is what separates them.";
const correction43 = "Close but it's an odontogenic keratocyst. Both can wrap around an impacted tooth so they're easy to mix up on imaging and histology is what separates them.";
// Genuinely different replies from the same night, on the same diagnosis.
const banter = "Tooth Fairy found the job site and just decided to stay";
const clinical = "OKCs are thought to arise from remnants of the dental lamina so they develop independently of the impacted tooth.";

assert.ok(sharedShapeCount(correction6, correction35) >= 10, "reskinned corrections must share many shapes");
assert.equal(sharedShapeCount(banter, clinical), 0, "unrelated replies share no shapes");

// Shared VOCABULARY on one diagnosis must not trip it -- only a shared word ORDER counts.
assert.equal(sharedShapeCount("An odontogenic keratocyst in the mandible.", "The mandible held an odontogenic keratocyst."), 0);

const night = [correction6, correction35, correction43, banter, clinical];
const pairs = nearDuplicates(night);
assert.ok(pairs.length >= 3, "the three corrections pair with each other");
assert.ok(pairs.every((p) => p.a <= 3 && p.b <= 3), "only the corrections are flagged");
assert.equal(pairs[0].shared, sharedShapeCount(correction6, correction35), "pairs sort by shared count, worst first");

const clusters = shapeClusters(night);
assert.equal(clusters.length, 1, "the corrections form one cluster");
assert.deepEqual(clusters[0], [1, 2, 3], "cluster holds exactly the three corrections");

// Short replies produce no grams, so the exact-duplicate check keeps owning them.
assert.equal(shapeGrams("That's it.").size, 0);
assert.equal(nearDuplicates(["That's it.", "That's it."]).length, 0, "short repeats belong to the exact-dup check");

// --- emoji profile ------------------------------------------------------------------------
// The regression that motivated this: 🤣 reads as fixed while 😭 has taken over.
const emojiNight = [
  "That cavity really does look like something punched straight through 😭",
  "Worst place to chill a drink 😭",
  "Nature's recycling program nobody signed up for 😭",
  "That's the one.",
  "Respect 🫡 for the guess",
];
const profile = emojiProfile(emojiNight);
assert.equal(profile.withEmoji, 4);
assert.equal(profile.trailing, 3, "only replies ENDING on an emoji count as trailing");
assert.equal(profile.byGlyph[0].glyph, "😭", "reports the actual top glyph, not one named in advance");
assert.equal(profile.byGlyph[0].replies, 3);
assert.equal(profile.byGlyph[0].trailing, 3);
// 🫡 appears mid-sentence, so it is present but never trailing.
const salute = profile.byGlyph.find((g) => g.glyph === "🫡");
assert.equal(salute?.replies, 1);
assert.equal(salute?.trailing, 0);

// A multi-codepoint emoji is ONE emoji. Counting code points would inflate every rate.
const zwj = emojiProfile(["Impacted pickleball paddle and the last Tooth Fairy 🧚‍♀️"]);
assert.equal(zwj.byGlyph.length, 1, "ZWJ sequence counts as a single glyph");
assert.equal(zwj.byGlyph[0].glyph, "🧚‍♀️");
assert.equal(zwj.trailing, 1);

assert.deepEqual(emojiProfile([]), { withEmoji: 0, trailing: 0, byGlyph: [] }, "empty night is not a crash");

console.log("PASS near-duplicate shapes, clusters, and glyph-agnostic emoji profile");
