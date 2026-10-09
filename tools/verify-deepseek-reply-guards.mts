// 2026-10-09 reply audit: DeepSeek-only guards for laterality, case-facts meta talk, drug jokes and invented
// product claims. Real replies from the Oct 2-8 posts are used as fixtures. Mocked HTTP only.
import assert from 'node:assert/strict';
process.env.ANTHROPIC_API_KEY = 'synthetic-claude'; process.env.DEEPSEEK_API_KEY = 'synthetic-deepseek';
delete process.env.ANTHROPIC_AUTH_TOKEN;
const { unsupportedLaterality, unsupportedDeepSeekClaim, claimsOffPlatformAction, DEEPSEEK_REPLY_GUIDANCE } = await import('../src/deepseek-media-policy');

const noSide = 'One side of the chest is black with no lung markings and the collapsed lung has shrunk toward the middle.';
const rightSide = 'The right lung has collapsed and the right side of the chest is black.';
// Real 00192 replies that told correct commenters their right-sided pneumothorax was on the left.
for (const reply of ['The read is right but the side is flipped. The half with no lung markings is on the left in this film.',
  'Pneumothorax is the diagnosis but the side is flipped. That empty half is on the left.',
  'You have the diagnosis but not the side. This film emptied on the left.']) {
  assert.equal(unsupportedLaterality(reply, noSide), true, reply);
  assert.equal(unsupportedLaterality(reply, rightSide), true, `contradicts a right-sided fact: ${reply}`);
}
assert.equal(unsupportedLaterality('Right lung and all. Good read.', rightSide), false, 'a side the facts state is allowed');
assert.equal(unsupportedLaterality('Right lung and all. Good read.', noSide), true, 'no side in the facts means no side in the reply');
assert.equal(unsupportedLaterality('The side is the one detail to flip.', noSide), true, 'side dispute needs a side in the facts');
for (const ok of ['You are right about the air.', 'Nothing left to guess now.', 'The lung has left the chat.', 'Right on.'])
  assert.equal(unsupportedLaterality(ok, noSide), false, `not an anatomical side: ${ok}`);

assert.equal(unsupportedDeepSeekClaim('The case facts do not mention radiation so I cannot claim that here.', '', 'teach'), 'internal wording');
assert.equal(unsupportedDeepSeekClaim('The case does not record which organism was found.', '', 'teach'), 'internal wording');
assert.equal(unsupportedDeepSeekClaim('You and the parent commenter are reading the same film.', '', 'banter'), 'internal wording');
assert.equal(unsupportedDeepSeekClaim('That much smoke would need a bigger bong than the whole chest.', '', 'banter'), 'drug joke');
assert.equal(unsupportedDeepSeekClaim('A chest drain is the way out of this one.', 'chest drain', 'banter'), null, 'ordinary reply passes');
assert.equal(claimsOffPlatformAction('I did put a free pack of six of the wild ones together.'), true, 'invented product claim');
for (const rule of ['right side of the patient appears on the left of the image', 'never the values of this patient', 'never what this film shows', 'side with the patient'])
  assert.ok(DEEPSEEK_REPLY_GUIDANCE.includes(rule), rule);

// End to end through the real classifier: DeepSeek drafts are policed, Claude drafts are not.
let replyText = '';
const queue: string[] = []; let calls = 0; const prompts: string[] = [];
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body));
  calls++; prompts.push(JSON.stringify(body.messages)); if (queue.length) replyText = queue.shift()!;
  return new Response(JSON.stringify({ id: 's', type: 'message', role: 'assistant', model: body.model, stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    content: [{ type: 'tool_use', id: 't', name: 'submit_reply', input: { intent: 'grading', decision: 'reply', category: 'correct', reply_text: replyText, reason: 'synthetic', needs_lookup: false, promo_product: 'none', promo_explicit: false } }] }), { headers: { 'content-type': 'application/json' } });
};
const { config } = await import('../src/config');
Object.assign(config, { gifReplies: false, voiceVariant: 'lean', webSearch: false });
const { classifyAndDraft } = await import('../src/reply');
const input = { postText: 'A patient with sudden sharp chest pain and worsening breathlessness.', commentText: 'Right pneumothorax', answer: 'Tension pneumothorax', answerPublic: true, replyAll: true, modelOverride: config.triageModel, allowSearch: false, learnedNotesOverride: '', facts: [noSide] };
config.deepSeekTrial = true;
replyText = 'Pneumothorax yes but the side is flipped. That empty half is on the left.';
const flipped = await classifyAndDraft(input as never);
assert.equal(flipped.decision, 'skip');
assert.match(flipped.reason, /^unsupported laterality: DeepSeek reply skipped/);
assert.doesNotMatch(flipped.reason, /^(?:error|fatal):/, 'a policy skip, never an API-error skip');
replyText = 'That is the one. The lung gave up and the air moved in.';
assert.equal((await classifyAndDraft(input as never)).decision, 'reply', 'a side-free reply still posts');
config.deepSeekTrial = false;
replyText = 'Pneumothorax yes but the side is flipped. That empty half is on the left.';
assert.doesNotMatch((await classifyAndDraft(input as never)).reason, /unsupported laterality/, 'Claude path unchanged');
// Teaching contrasts: real 00188/00193 replies that invented rules about the guessed condition.
const { unsupportedTeachingContrast } = await import('../src/deepseek-media-policy');
const nephro = 'Both kidneys are packed with clusters of tiny bright calcium deposits. Nephrocalcinosis is calcium deposited in the kidney tissue itself.';
assert.equal(unsupportedTeachingContrast('Stones pass through. This calcium has settled into the kidney tissue itself.', 'Kidney stones .I was told they look like tiny crystals', nephro, 'correct'), true);
assert.equal(unsupportedTeachingContrast('Pneumonia would sit patchy in one spot.', 'Looks like a bad pneumonia.', 'Fluffy white shadowing spreads out from the centre of both lungs.', 'correct'), true);
assert.equal(unsupportedTeachingContrast('Not pneumonia. This is fluid around both hila.', 'Looks like a bad pneumonia.', 'Fluffy white shadowing spreads out from the centre of both lungs.', 'correct'), false, 'a plain correction is fine');
assert.equal(unsupportedTeachingContrast('Stones pass through. This calcium has settled into the kidney tissue itself.', 'Kidney stones?', nephro, 'banter'), false, 'banter is not graded teaching');
assert.equal(unsupportedTeachingContrast('Calcium would settle in the kidney tissue itself.', 'Is it calcium?', nephro, 'affirm'), false, 'terms the case facts state are supported');

config.deepSeekTrial = true;
const nephroInput = { ...input, postText: 'A patient with frequent trips to the bathroom at night.', commentText: 'Kidney stones .I was told they look like tiny crystals', answer: 'Nephrocalcinosis', facts: [nephro] };
queue.push('Stones pass through. This calcium has settled into the kidney tissue itself.', 'Not stones. This calcium has settled into the kidney tissue itself which is nephrocalcinosis.');
calls = 0; prompts.length = 0;
const rewritten = await classifyAndDraft(nephroInput as never);
assert.equal(rewritten.decision, 'reply');
assert.equal(rewritten.reply_text, 'Not stones. This calcium has settled into the kidney tissue itself which is nephrocalcinosis.', 'one rewrite limited to the case facts');
assert.equal(calls, 2, 'exactly one rewrite');
assert.match(prompts[1], /Do not describe how the guessed condition usually looks/, 'the rewrite carries the teaching-contrast instruction');
queue.push('Stones pass through.', 'Stones usually pass through.');
calls = 0;
const stillWrong = await classifyAndDraft(nephroInput as never);
assert.equal(stillWrong.decision, 'skip');
assert.match(stillWrong.reason, /^unsupported teaching contrast: DeepSeek reply skipped/);
assert.equal(calls, 2, 'no loop: one rewrite then skip');

// Repeated phrasing: facts refrains and stock template shapes (2026-10-09 audit).
const { repeatedPhrasing } = await import('../src/reply-variety');
const hila = Array.from({ length: 6 }, (_, i) => `Reply ${i} mentions fluid around both hila again.`);
const oedemaFacts = 'Fluffy white shadowing spreads out from the centre of both lungs. Fluid floods the air spaces around both hila.';
assert.ok(repeatedPhrasing('More fluid around both hila here.', hila, oedemaFacts, 'Acute pulmonary oedema').some((p) => p.includes('refrain "both hila"')), 'a facts phrase used in 6 recent replies is a refrain');
assert.deepEqual(repeatedPhrasing('More fluid around both hila here.', hila.slice(0, 3), oedemaFacts, 'Acute pulmonary oedema').filter((p) => p.includes('refrain')), [], 'occasional facts reuse stays exempt');
assert.deepEqual(repeatedPhrasing('Acute pulmonary oedema it is.', Array(8).fill('Acute pulmonary oedema it is not.'), oedemaFacts, 'Acute pulmonary oedema').filter((p) => p.includes('refrain')), [], 'the answer itself is never a refrain');
const gummy = ['A gummy bear would at least have dissolved.', 'Dentures would at least have kept their shape.'];
assert.ok(repeatedPhrasing('A thimble would at least have fit.', gummy).some((p) => p.includes('stock phrase "would at least"')), 'stock shape reused twice already');
assert.deepEqual(repeatedPhrasing('A thimble would at least have fit.', gummy.slice(0, 1)).filter((p) => p.includes('stock')), [], 'one earlier use is fine');
console.log('PASS DeepSeek reply guards: laterality (incl. real 00192 flips), case-facts meta talk, drug jokes, invented product claims, teaching contrasts with one bounded rewrite, facts refrains and stock shapes, prompt rules; Claude unchanged.');
