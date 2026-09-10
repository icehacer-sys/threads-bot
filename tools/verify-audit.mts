import assert from "node:assert/strict";
import { costOf, priceFor } from "../src/spend";
import { followupSignal, balancedSample, validateNotes } from "../src/learning-rules";
import { sanitize, isImageConcern } from "../src/reply";
assert.equal(isImageConcern("Why does this child have two left clavicles?"), true);
assert.equal(isImageConcern("Why is drooling important?"), false);
for (const text of ["Educational illustration.", "This is an illustration.", "These illustrations show the finding.", "An AI-generated image.", "A synthetic radiograph.", "This image is simulated."]) {
  const result = sanitize({ decision: "reply", category: "teach", reply_text: text, reason: "test" }, { isPublic: true, terms: [] });
  assert.equal(result.decision, "skip", text);
  assert.equal(result.reply_text, "", text);
}
assert.equal(sanitize({ decision: "reply", category: "banter", reply_text: "The world's least convenient piggy bank.", reason: "test" }, { isPublic: true, terms: [] }).decision, "reply");
console.log("PASS disclosure drafts are skipped and ordinary banter remains eligible");
assert.equal(costOf("claude-haiku-4-5", { server_tool_use: { web_search_requests: 3 } }), 0.03);
assert.throws(() => priceFor("unknown-model"), /No configured price/);
assert.equal(followupSignal(["Actually that is incorrect"]), "correction");
assert.equal(followupSignal(["Stop spamming"]), "complaint");
assert.equal(followupSignal([]), "no-followup");
assert.deepEqual(balancedSample([{ k: "a", n: 1 }, { k: "a", n: 2 }, { k: "b", n: 3 }], r => r.k, 2).map(r => r.n), [1, 3]);
const notes = "# Learned voice notes\n## Do more\n- Respond to the specific comment with a fresh opening and only supported details.\n## Do less\n- Avoid repeated templates.\n## Retire\n- Bare confirmed.";
validateNotes(notes, "end_turn");
assert.throws(() => validateNotes(notes, "max_tokens"));
assert.throws(() => validateNotes(notes + "\n- x".repeat(17), "end_turn"));
for (const category of ["affirm", "correct", "teach"] as const) assert.equal(sanitize({ decision: "reply", category, reply_text: "Take another guess", reason: "test" }, { isPublic: false, terms: [] }).decision, "skip");
console.log("PASS search billing, unknown prices, balanced learning, bounded notes and uniform pre-reveal holds");
