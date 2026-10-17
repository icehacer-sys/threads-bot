// Regressions from the 2026-10-17 reply audit (docs/research-2026-10-12/reply-audit-1017, local only).
// Every quoted failing and passing example from the audit that a deterministic check can judge is here.
// Mocked HTTP only: no network, no model calls, no state writes.
import assert from 'node:assert/strict';
process.env.ANTHROPIC_API_KEY = 'offline-fixture';
process.env.DEEPSEEK_API_KEY = 'offline-fixture';
process.env.BOT_WEB_SEARCH = 'off';
process.env.BOT_USAGE_LOG = 'off';
process.env.BOT_DEEPSEEK_RETRY_MS = '0';
delete process.env.ANTHROPIC_AUTH_TOKEN;

const { conversationReplyIssue } = await import('../src/supporter-replies');
const { repeatedPhrasing, restrainEmoji, emojiRemovalBreaksText, shortConfirmation, SHORT_CONFIRMATIONS } = await import('../src/reply-variety');
const { crowdGuessNote } = await import('../src/reply-coverage');
const { isPoliticalJab, isAiProvenanceComment, unsupportedDeepSeekClaim, affirmsCommenterOnlyFinding, policyRecheck } = await import('../src/deepseek-media-policy');
const { requestsPersonalAdvice, thirdPersonSymptomQuestion, ACKNOWLEDGMENTS } = await import('../src/concerns');
const { replyStyleIssue } = await import('../src/reply-style');
const { sanitize, classifyAndDraft } = await import('../src/reply');
const { lastServedModel } = await import('../src/reply-provider');
const { config } = await import('../src/config');
Object.assign(config, { gifReplies: false, voiceVariant: 'lean', webSearch: false });

// --- Section 3 best replies: these shapes must keep passing every deterministic gate. ---
const best: Array<[string, string, string]> = [
  ['Maxell veins... plug your head into a 1980s cassette player', 'banter', 'Give that tangle a pencil and a slow counterclockwise turn and it might play again.'],
  ['Although it did give him the ability to break the sound barrier.', 'banter', 'Fast forward has never been that literal.'],
  ['Just what I would have guessed. If I could spell it...', 'banter', 'Hydroureteronephrosis is one of those words you read top to bottom and hope your mouth arrives at the end.'],
  ['Truly empty headed.', 'banter', 'Finally a case where that insult is anatomically accurate.'],
  ['Lower right shows the beginning of workers learning their rights...', 'banter', 'Collective bargaining clearly started on one side of that colon and then spread.'],
  ['Thanos Snapped it seems', 'banter', 'Half the colon went to dust and the other half kept every pouch it had.'],
  ['He heard the news and his heart dropped.', 'banter', 'His heart dropped and the aorta did the opposite.'],
  ['My late husband passed away with a stroke, but he had ESRD...', 'empathize', 'I am sorry you lost him and sorry you had to learn this picture the hard way. It is a lot to carry.'],
  ['What would cause that?', 'teach', 'Air gets under the skull when a break in the skull base tears the dura and lets air in from the nose or sinuses.'],
];
for (const [comment, category, reply] of best) {
  assert.equal(replyStyleIssue(reply, category), undefined, `style: ${reply}`);
  assert.equal(conversationReplyIssue(comment, category, reply, true), undefined, `conversation: ${reply}`);
  const out = sanitize({ decision: 'reply', category: category as never, reply_text: reply, reason: 'audit fixture' }, { isPublic: true, terms: [] });
  assert.equal(out.decision, 'reply', `sanitize: ${reply}`);
  assert.equal(isPoliticalJab(comment), false, `not political: ${comment}`);
  assert.equal(thirdPersonSymptomQuestion(comment), false, `not a symptom question: ${comment}`);
}

// --- Fix 2: deflating-opener false positives. Sincere hedged guesses and real questions are exempt. ---
const sincere = [
  'Blood clot maybe?', 'Bowel obstruction', 'Toxic megacolon', 'Chiari malformation?', 'Brain aneurism?', 'Some kind of blockage',
  'Triple A???', 'Kidney transplant gone wrong?', 'CSF leak', 'could this be a complication of BPH?',
  'So what did the ct scan show? Where was the fx?', 'Patient didn\'t have any pain?', 'I think it is a vein thing',
  'Not a doctor but I would say a burst pipe in there', 'Regardless of the hydronephrisis, where\'s the blockage coming from?',
];
for (const comment of sincere) assert.equal(conversationReplyIssue(comment, 'correct', 'Not that one and this is an arteriovenous malformation.', true), undefined, comment);
// Jokes and lay object readings still get the guard (the 2026-10-12 fix holds).
for (const comment of ['GSW', 'He got shot', 'Telephone cord?']) assert.match(conversationReplyIssue(comment, 'correct', 'No gun involved here and this is an arteriovenous malformation.', true) ?? '', /deflating correction/, comment);

// --- Fix 4: deterministic political and AI-provenance skips, before any model call, for every provider. ---
for (const c of ['A touch of the MAGAs?', 'Patient is a White House. Spokesperson?', 'Too much Fox News', 'MSNBC did this', 'Politicians have this', 'Congress has been like this for years'])
  assert.equal(isPoliticalJab(c), true, c);
for (const c of ['Conservative treatment first?', 'Sounds like a trumpet', 'Liberal use of contrast', 'Party in the colon', 'I read it in a magazine'])
  assert.equal(isPoliticalJab(c), false, c);
for (const c of ['AI slop', 'This is ai generated', 'more AI art', 'did chatgpt make this', 'slop'])
  assert.equal(isAiProvenanceComment(c), true, c);
for (const c of ['Air in the skull', 'Pain in the abdomen', 'Said every patient ever']) assert.equal(isAiProvenanceComment(c), false, c);

let queue: any[] = []; let calls = 0; let bodies: any[] = []; let servedBy = 'claude';
globalThis.fetch = async (url, init) => {
  calls++; const body = JSON.parse(String(init?.body)); bodies.push(body);
  const next = queue.shift(); assert.ok(next, 'unexpected extra paid call');
  const deep = new URL(String(url)).hostname === 'api.deepseek.com';
  return new Response(JSON.stringify({ id: 'fixture', type: 'message', role: 'assistant', model: deep ? 'deepseek-flash' : body.model, stop_reason: 'tool_use',
    usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    content: [{ type: 'tool_use', id: 'tool', name: 'submit_reply', input: next }] }), { headers: { 'content-type': 'application/json' } });
};
const draft = (reply_text: string, category = 'banter', decision = 'reply') => ({ intent: 'audit fixture', decision, category, reply_text, reason: 'audit fixture', needs_lookup: false, promo_product: 'none', promo_explicit: false });
const AVM_FACTS = ['A tangle of abnormal vessels in the brain with an enlarged draining vein.', 'Arteries connect straight to veins with no capillary bed in between.'];
const PNEUMO_FACTS = ['Dark pockets of air sit inside the skull after a fracture of the skull base.', 'Air enters from the sinuses through the break.'];
const avm = { postText: 'He thought it was a migraine.', answer: 'Arteriovenous malformation / AVM', facts: AVM_FACTS, answerPublic: true, replyAll: true, modelOverride: config.triageModel, allowSearch: false, learnedNotesOverride: '' };
const pneumo = { ...avm, postText: 'He walked into the door frame.', answer: 'Traumatic pneumocephalus', facts: PNEUMO_FACTS };

for (const commentText of ['A touch of the MAGAs?', 'Patient is a White House. Spokesperson?']) {
  for (const trial of [false, true]) {
    config.deepSeekTrial = trial; calls = 0; queue = [draft('Wrong branch of medicine.')];
    const d = await classifyAndDraft({ ...avm, commentText } as never);
    assert.equal(d.decision, 'skip'); assert.match(d.reason, /^political jab: brand skip/); assert.equal(calls, 0, `no model call: ${commentText}`);
  }
}
config.deepSeekTrial = false; calls = 0; queue = [];
const slop = await classifyAndDraft({ ...avm, commentText: 'AI slop' } as never);
assert.equal(slop.decision, 'skip'); assert.match(slop.reason, /^owner review: AI-provenance/); assert.equal(calls, 0);

// --- Fix 3 + Fix 1: guards run for every provider and repairable guards get one concrete rewrite. ---
const leak = 'The case facts only mention raccoon eyes so the leak cannot be confirmed.';
assert.equal(unsupportedDeepSeekClaim(leak, PNEUMO_FACTS.join(' '), 'teach'), 'internal wording');
assert.match(policyRecheck('unsupported internal wording: reply skipped (x) | guard:forced-skip') ?? '', /story stops at the film/);
assert.ok(policyRecheck('unsupported imaging brightness: reply skipped'));
assert.ok(policyRecheck('unsupported organism taxonomy: reply skipped'));
assert.equal(policyRecheck('unsupported laterality: reply skipped'), undefined, 'laterality stays a straight skip');
for (const trial of [false, true]) {
  config.deepSeekTrial = trial; calls = 0; bodies = [];
  queue = [draft(leak, 'teach'), draft('The story stops at the film so one X-ray cannot say whether fluid leaked.', 'teach')];
  const repaired = await classifyAndDraft({ ...pneumo, commentText: 'Do I want to know why his nose was constantly running? Please tell me it wasn\'t CSF' } as never);
  assert.equal(repaired.decision, 'reply', `internal wording repaired on ${trial ? 'DeepSeek' : 'Claude'}`);
  assert.equal(calls, 2, 'exactly one rewrite');
  assert.match(JSON.stringify(bodies[1].messages), /the story stops at the film/i, 'the rewrite carries the concrete instruction');
  calls = 0; queue = [draft(leak, 'teach'), draft(leak, 'teach')];
  const still = await classifyAndDraft({ ...pneumo, commentText: 'Did the patient remember fracturing the base of his skull?' } as never);
  assert.equal(still.decision, 'skip'); assert.match(still.reason, /^unsupported internal wording: reply skipped/); assert.equal(calls, 2, 'no loop');
}
assert.equal(lastServedModel(), 'deepseek-flash', 'the served model is reported for honest escalation logs');
// Brightness and taxonomy rewrite once.
config.deepSeekTrial = true; calls = 0;
queue = [draft('The bright white tangle is the AVM.', 'teach'), draft('That tangle of vessels is the AVM with one big draining vein.', 'teach')];
assert.equal((await classifyAndDraft({ ...avm, commentText: 'What is that blob?' } as never)).decision, 'reply'); assert.equal(calls, 2);
calls = 0;
queue = [draft('That is a nematode from the Ascaris genus.', 'teach'), draft('It is the AVM and no worm is involved.', 'teach')];
assert.equal((await classifyAndDraft({ ...avm, commentText: 'Is that a worm?' } as never)).decision, 'reply'); assert.equal(calls, 2);

// --- Fix 5: a finding only the commenter named is never affirmed. ---
const caseAvm = [avm.postText, ...AVM_FACTS, avm.answer].join(' ');
const casePneumo = [pneumo.postText, ...PNEUMO_FACTS, pneumo.answer].join(' ');
assert.equal(affirmsCommenterOnlyFinding('Yes and that round outpouching on the feeding vessel is the aneurysm part you spotted.', 'AVM with an aneurysm on the feeding artery', caseAvm, 'affirm'), 'feeding', 'feeding vessel and aneurysm are commenter-only');
assert.equal(affirmsCommenterOnlyFinding('The leak part is right and the air came in through the break.', 'Basal skull fracture with a CSF leak', casePneumo, 'affirm'), 'leak');
assert.equal(affirmsCommenterOnlyFinding('Yes that tangle is the AVM with an enlarged draining vein.', 'AVM', caseAvm, 'affirm'), null, 'supported affirmation');
assert.equal(affirmsCommenterOnlyFinding('You spotted the draining vein too.', 'AVM with a big draining vein', caseAvm, 'affirm'), null, 'finding the case names');
assert.equal(affirmsCommenterOnlyFinding('Aneurysm is a fair thought but this is a tangle of vessels.', 'Aneurysm', caseAvm, 'correct'), null, 'no affirmation cue');
calls = 0;
queue = [draft('That round outpouching on the feeding vessel is the aneurysm part you spotted.', 'affirm'), draft('AVM is right and the big draining vein is part of it.', 'affirm')];
const avmFixed = await classifyAndDraft({ ...avm, commentText: 'AVM with an aneurysm on the feeding artery' } as never);
assert.equal(avmFixed.decision, 'reply'); assert.equal(calls, 2); assert.doesNotMatch(avmFixed.reply_text, /aneurysm/i);

// --- Fix 5: third-person symptom questions get the approved boundary line, with no model call. ---
for (const c of ['Could this happen to a child? My 11 year old has been complaining of headaches for weeks.',
  'Can this happen to my son? He keeps getting headaches',
  'My daughter has been having nosebleeds, could it be this?',
  'Is it possible for this to happen to my husband? He has had bad headaches']) {
  assert.equal(thirdPersonSymptomQuestion(c), true, c);
  assert.equal(requestsPersonalAdvice(c), true, c);
  calls = 0; queue = [];
  const d = await classifyAndDraft({ ...avm, commentText: c } as never);
  assert.equal(d.reply_text, ACKNOWLEDGMENTS.personal, c); assert.equal(calls, 0);
}
for (const c of ['My late husband passed away with a stroke, but he had ESRD...', 'Would something like this cause cluster migraines? My brother has them...',
  'My husband has had this, he survived. Isn\'t it amazing?', 'Could this happen from a car crash?', 'My son wants to be a radiologist after this one'])
  assert.equal(thirdPersonSymptomQuestion(c), false, c);
assert.equal(sanitize({ decision: 'reply', category: 'teach', reply_text: 'Headaches at eleven are worth having checked by a doctor.', reason: 'x' }).decision, 'skip', 'the leaked advice wording is caught');

// --- Fix 1: the overlong-short-guess rule keeps a short first sentence instead of silence. ---
const long1 = draft('Arteriovenous malformation is right and it is a tangle where arteries hand blood straight to veins with no capillary bed in between which is why the draining vein balloons up over the years.', 'correct');
const long2 = draft('AVM is the answer. The tangle sends arterial blood straight into veins with no capillary bed in between so the draining vein grows into that big loop you can see on the film.', 'correct');
config.deepSeekTrial = true; calls = 0; queue = [long1, long2];
const kept = await classifyAndDraft({ ...avm, commentText: 'Aneurysm' } as never);
assert.equal(kept.decision, 'reply', kept.reason); assert.equal(kept.reply_text, 'AVM is the answer.'); assert.equal(calls, 2);
calls = 0; queue = [long1, draft('The tangle sends arterial blood straight into veins with no capillary bed in between so the draining vein grows into that big loop you can see on the film every time.', 'correct')];
assert.equal((await classifyAndDraft({ ...avm, commentText: 'Aneurysm' } as never)).decision, 'skip', 'a first sentence without the answer is not posted');

// --- Fix 1: a repeated affirm of a correct guess gets a short rotated confirmation, not silence. ---
const recent = ['That tangle is the AVM and the vein is huge.', 'That tangle is the AVM and the vein is huge again.', 'Another one for the tangle is the AVM club.'];
calls = 0; queue = [draft('Yes that tangle is the AVM and the vein is huge.', 'affirm'), draft('Yes that tangle is the AVM and the vein is huge here.', 'affirm')];
const confirm = await classifyAndDraft({ ...avm, commentText: 'AVM', recentReplies: recent } as never);
assert.equal(confirm.decision, 'reply'); assert.ok(SHORT_CONFIRMATIONS.includes(confirm.reply_text), confirm.reply_text); assert.match(confirm.reason, /variety fallback/);
assert.equal(shortConfirmation(["That's the one", 'Yep that\'s it']), 'Spot on', 'rotation skips confirmations already on the post');
for (const s of SHORT_CONFIRMATIONS) { const n = s.split(/\s+/).length; assert.ok(n >= 1 && n <= 6, s); }

// --- Fix 6: emoji removal that breaks the sentence gets a words-only rewrite. ---
const broken = '... and the 💀 is doing a lot of work in that sentence.';
assert.equal(emojiRemovalBreaksText(broken, '... and the is doing a lot of work in that sentence.'), true);
assert.equal(emojiRemovalBreaksText('Brutal 💀', 'Brutal'), false, 'a trailing emoji can go');
assert.equal(emojiRemovalBreaksText('That 😭 is doing the talking', 'That is doing the talking'), true, 'that is doing');
calls = 0; config.deepSeekTrial = true;
queue = [draft('Your caption and the 💀 is doing a lot of work in that sentence.'), draft('That caption is working overtime.')];
const rewritten = await classifyAndDraft({ ...avm, commentText: 'This caption 💀' } as never);
assert.equal(rewritten.reply_text, 'That caption is working overtime.'); assert.equal(calls, 2);

// --- Fix 6: stock shapes from the audit. ---
assert.ok(repeatedPhrasing('That was my first read too.', ['That was my first read too and it stuck.']).some(r => r.includes('first read too')));
assert.ok(repeatedPhrasing('Three letters and done.', ['Three letters and you had it.']).some(r => r.includes('three letters')));
assert.ok(repeatedPhrasing("You're welcome.", ["You're welcome."]).some(r => r.includes("you're welcome")));
assert.ok(repeatedPhrasing('It hits different at night.', []).some(r => r.includes('hits different')), 'never');
assert.ok(repeatedPhrasing('You nailed both.', []).some(r => r.includes('you nailed')), 'never');
assert.ok(repeatedPhrasing('Any time and the tangle will still be there.', ['Any time and come back tomorrow.']).some(r => r.includes('any time')), 'any time counted per post');
assert.deepEqual(repeatedPhrasing('Any time and the tangle will still be there.', []).filter(r => r.includes('stock')), [], 'first any time is fine');
assert.deepEqual(repeatedPhrasing("You're welcome to come back tomorrow for another one.", ["You're welcome."]).filter(r => r.includes('stock')), [], 'only a bare you\'re welcome');

// --- Fix 6: the crowd note is built per post from answer aliases and repeated guesses. ---
const tb = ['TB', 'TB?', 'Looks like TB', 'I say TB'];
assert.match(crowdGuessNote('TB?', tb), /^CROWD NOTE: 4 earlier comments on this post also went with TB\./);
assert.equal(crowdGuessNote('TB?', tb.slice(0, 3)), '');
assert.match(crowdGuessNote('AVM', ['avm', 'AVM!', 'arteriovenous malformation', 'Its an AVM'], avm.answer), /4 earlier comments on this post also went with AVM/);
assert.match(crowdGuessNote('Kidney stones', ['kidney stone', 'stones', 'Kidney stones?', 'big kidney stones', 'stones again'], 'Bilateral hydroureteronephrosis'), /went with stone/);
assert.equal(crowdGuessNote('Beautiful film', tb), '');
assert.equal(crowdGuessNote('This is a very long comment that keeps going about many different things and TB', tb), '', 'long comments are not crowd guesses');

console.log('PASS 2026-10-17 audit: best replies kept, hedged guesses exempt, political and AI skips before any call, guards on every provider with one concrete rewrite, commenter-only findings, third-person symptom boundary, overlong trim, short confirmation fallback, emoji text integrity, stock shapes and per-post crowd note.');
