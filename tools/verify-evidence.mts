import assert from 'node:assert/strict';
import { diagnosticContext, unsupportedConfirmation, rejectsAcceptedDifferential, overstatesImagingLimit } from '../src/case-evidence';
import { restrainEmoji, varietyNote } from '../src/reply-variety';
const context = diagnosticContext({ acceptedDifferentials: ['ameloblastoma'] }, true);
for (const text of [
  'Right neighborhood but this one came back as an odontogenic keratocyst on histology since imaging alone can\'t separate the two.',
  'Close but this one came back as an odontogenic keratocyst.',
  'The biopsy confirmed an odontogenic keratocyst.',
  'It was confirmed on histology.',
  'The patient recovered after surgery.',
]) assert.equal(unsupportedConfirmation(text, context), true, text);
for (const text of ['Histology is needed for confirmation.', 'Ameloblastoma is a reasonable differential here.', 'No biopsy result is recorded.', 'A biopsy could establish the diagnosis.']) assert.equal(unsupportedConfirmation(text, context), false, text);
assert.equal(diagnosticContext({ certainty: 'confirmed', confirmationEvidence: ['Biopsy confirmed OKC.'] }, true).confirmationEvidence.length, 0);
assert.equal(diagnosticContext({ certainty: 'confirmed', confirmationEvidence: [] }).certainty, 'imaging-supported');
assert.equal(rejectsAcceptedDifferential('Close but it is an odontogenic keratocyst.', 'Ameloblastoma but need path confirmation', context), true);
assert.equal(rejectsAcceptedDifferential('Ameloblastoma belongs in the differential.', 'Ameloblastoma?', context), false);
assert.equal(overstatesImagingLimit("Imaging alone can't separate them without histology."), true);
assert.equal(overstatesImagingLimit('This image alone does not establish a tissue diagnosis.'), false);
assert.equal(restrainEmoji('The least convenient piggy bank 😭', ['A joke 😭']), 'The least convenient piggy bank');
assert.equal(restrainEmoji('A fresh joke 😭', []), 'A fresh joke 😭');
assert.equal(restrainEmoji('A joke 😭 😭', []), 'A joke 😭');
assert.match(varietyNote(['A 😭', 'B 😂']), /without emoji/);
console.log('PASS invented results, differential respect and free emoji restraint');

process.env.ANTHROPIC_API_KEY = 'offline-fixture';
process.env.BOT_USAGE_LOG = 'off';
const { config } = await import('../src/config');
const { classifyAndDraft } = await import('../src/reply');
let calls = 0;
let alwaysInvent = false;
globalThis.fetch = async (_url, init) => {
  calls++;
  const body = JSON.parse(String(init?.body));
  if (calls === 2) assert.match(JSON.stringify(body.messages), /EVIDENCE RECHECK/);
  const text = alwaysInvent || calls === 1 ? 'This one came back as an odontogenic keratocyst on histology.' : 'Ameloblastoma is a reasonable differential here.';
  return new Response(JSON.stringify({ id: 'fixture', type: 'message', role: 'assistant', model: config.triageModel, stop_reason: 'tool_use', stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id: 'fixture-tool', name: 'submit_reply', input: {
      intent: 'diagnosis differential', decision: 'reply', category: 'correct', reply_text: text, reason: 'fixture', needs_lookup: false, promo_product: 'none', promo_explicit: false, ...(config.gifReplies ? { gif_tag: 'none' } : {}),
    } }],
  }), { headers: { 'content-type': 'application/json' } });
};
const input = { postText: 'Jaw swelling', commentText: 'Ameloblastoma but need path confirmation', answer: 'Odontogenic keratocyst', answerPublic: true, diagnosticContext: context, modelOverride: config.triageModel };
const repaired = await classifyAndDraft(input);
assert.equal(calls, 2);
assert.equal(repaired.reply_text, 'Ameloblastoma is a reasonable differential here.');
calls = 0; alwaysInvent = true;
const held = await classifyAndDraft(input);
assert.equal(calls, 2, 'never keep paying to repair the same failure');
assert.equal(held.decision, 'skip');
assert.match(held.reason, /owner review/);
console.log('PASS real draft pipeline repairs once then holds persistent invented evidence');
