import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.GITHUB_ACTIONS = 'false';
process.env.ANTHROPIC_API_KEY = 'offline-fixture';
process.env.BOT_USAGE_LOG = 'off';
let calls = 0;
let unexpectedNetworkCalls = 0;
globalThis.fetch = async () => { unexpectedNetworkCalls++; throw new Error('Unexpected network call'); };
const { ACKNOWLEDGMENTS, acknowledgmentKind, directConcern, imageConcernKind, holdForImageReview, requestsPersonalAdvice, isRetiredMedicalBoundary } = await import('../src/concerns');
const { classifyAndDraft, sanitize } = await import('../src/reply');
const { config } = await import('../src/config');
const { State } = await import('../src/state');
const { atomicJson } = await import('../src/persistence');
const input = { postText: 'X-ray challenge', commentText: 'Why are there two left clavicles?', answerPublic: false };
const image = await classifyAndDraft(input);
assert.equal(image.reply_text, ACKNOWLEDGMENTS.image);
assert.match(image.reason, /owner review/);
assert.equal((await classifyAndDraft({ ...input, commentText: 'Is this AI?' })).decision, 'skip');
assert.equal((await classifyAndDraft({ ...input, commentText: "Is this a real patient's scan?" })).decision, 'skip');
assert.equal((await classifyAndDraft({ ...input, commentText: 'You idiot, why are there two left clavicles?' })).decision, 'skip');
assert.equal((await classifyAndDraft({ ...input, commentText: 'Can I send you my MRI?' })).reply_text, ACKNOWLEDGMENTS.scan);
assert.equal((await classifyAndDraft({ ...input, commentText: 'My baby is choking' })).reply_text, ACKNOWLEDGMENTS.urgent);
assert.equal((await classifyAndDraft({ ...input, priorExchange: { commenter: input.commentText, bot: ACKNOWLEDGMENTS.image } })).decision, 'skip');
assert.equal(directConcern('I had surgery years ago. That was scary.'), undefined);
assert.equal(directConcern('My child has an extra finger. What should I do?'), undefined, 'personal anatomy concerns must reach personal-medical classification rather than holding the posted image');
console.log('PASS anatomy acknowledgment, provenance/hostility skip, scan boundary, urgent boundary and no repeated exchange');
// R01 preserves the full reported multi-intent comment, without account or patient identifiers.
const r01 = `Force Lightning scarring. The Emperor REALLY didn't like this guy and certainly had no qualms about 'shooting' him in the back!

On another note, it's always so peculiar to see children's X-rays with all of those extra teeth. The fact that they're already there at the start: evolution is an amazing thing - except for when our jaws get shorter and our wisdom teeth get horribly impacted (speaking from experience). Bet you've got a few doozies of those in your collection?`;
const benignAnatomyComments = [
  r01,
  "Children's X-rays with all those extra teeth look peculiar.",
  'Extra teeth can look fascinating.',
  'Extra teeth are fascinating.',
  'Extra teeth are normal in children’s X-rays.',
  'This picture explains why people sometimes have missing teeth.',
  'This image shows why children normally have extra teeth.',
  'I had extra teeth as a child. My wisdom teeth were impacted years later.',
  'Extra funny caption. Those teeth are striking.',
  'Extraordinary case. Can ribs be affected?',
  'How can an extra rib cause symptoms?',
  'Can missing teeth affect bone?',
  'Missing ribs can change breathing mechanics.',
  'This X-ray does not have duplicated ribs.',
  'No extra scapula in this image.',
  'Someone once said "that old scan has duplicated ribs". Do you have more cases?',
  'I had an AI-generated scan years ago',
];
for (const text of benignAnatomyComments) {
  assert.equal(imageConcernKind(text), undefined, `ordinary observation must not hold the posted image: ${text}`);
  assert.equal(directConcern(text), undefined, 'ordinary observations must reach contextual drafting');
}
assert.equal(requestsPersonalAdvice(r01), false, 'a past experience and a collection question are not a request for personal advice');
const genuineAnatomyComments = [
  'This image has duplicated clavicles.',
  'This image has duplicated clavicles in this syndrome.',
  'This picture is missing a rib.',
  'This scan has impossible jaw anatomy.',
  'This image has two right scapulae.',
  'This scan has extra teeth in an impossible arrangement.',
  'Why are there two left clavicles?',
  'That looks like an extra scapula.',
  'I had surgery years ago. This scan has two left clavicles.',
  'Force Lightning strikes again. This picture is missing a rib.',
  'I had extra teeth as a child but this image has duplicated clavicles.',
  'This image has no extra ribs and a duplicated clavicle.',
  'That looks like an extra scapula which usually causes symptoms.',
  'Why are there two left clavicles, is that common?',
  'The ribs are missing.',
  'The clavicle is duplicated.',
  'The jaw is impossible.',
  'Ribs are missing here.',
  'An extra scapula.',
  'Missing ribs here.',
  'Two left clavicles?',
];
for (const text of genuineAnatomyComments) {
  assert.equal(imageConcernKind(text), 'anatomy', `a genuine image challenge still needs review: ${text}`);
  assert.equal(directConcern(text)?.reply_text, ACKNOWLEDGMENTS.image);
  assert.match(directConcern(text)!.reason, /owner review: image\/anatomy inconsistency/);
  const routed = await classifyAndDraft({...input,commentText:text});
  assert.equal(routed.category,'complaint');
  assert.equal(routed.reply_text,ACKNOWLEDGMENTS.image);
}
assert.equal(unexpectedNetworkCalls,0,'genuine anatomy concerns take the existing direct path without a model request');
console.log('PASS R01, benign and negated observations avoid review while genuine mixed anatomy concerns retain it');
for (const text of Object.values(ACKNOWLEDGMENTS)) {
  const clean = sanitize({ decision: 'reply', category: 'personal_medical', reply_text: text, reason: 'approved acknowledgment', promo_product: 'fixture', promo_explicit: true, gif_tag: 'applause' }, { isPublic: false, terms: ['coin'] });
  assert.equal(clean.reply_text, text);
  assert.equal(clean.promo_product, undefined);
  assert.equal(clean.gif_tag, undefined);
}
assert.equal(sanitize({ decision: 'reply', category: 'personal_medical', reply_text: 'You should take medication.', reason: 'unsafe' }).decision, 'skip');
let mockModel: typeof fetch;
globalThis.fetch = (...args) => mockModel(...args);
mockModel = async (url) => {
  assert.match(String(url), /api\.anthropic\.com/); calls++;
  return new Response(JSON.stringify({ id: 'fixture', type: 'message', role: 'assistant', model: config.triageModel, stop_reason: 'tool_use', stop_sequence: null,
    usage: {input_tokens:1,output_tokens:1}, content:[{type:'tool_use',id:'tool-fixture',name:'submit_reply',input:{intent:'personal advice',decision:'reply',category:'personal_medical',reply_text:'You should take medication.',reason:'personal symptoms',needs_lookup:false,promo_product:'none',promo_explicit:false,...(config.gifReplies?{gif_tag:'none'}:{})}}] }), { headers: {'content-type':'application/json'} });
};
const medical = await classifyAndDraft({ ...input, commentText: 'My child is drooling. Should I get an X-ray?', modelOverride: config.triageModel });
assert.equal(medical.reply_text, ACKNOWLEDGMENTS.personal);
assert.equal(medical.promo_product, undefined);
assert.equal(calls, 1);
const followup = await classifyAndDraft({ ...input, commentText: 'But what medicine should I use?', priorExchange:{commenter:'My child is drooling',bot:ACKNOWLEDGMENTS.personal},modelOverride:config.triageModel });
assert.equal(followup.decision,'skip');
console.log('PASS unsafe model advice is replaced with approved copy; no promo, GIF or medical follow-up');
let contextualCalls = 0;
let leakPrivateAnswer = false;
const privateAnswer = 'Hidden diagnosis sentinel';
const privateFact = 'PRIVATE_FACT_SENTINEL';
mockModel = async (url, init) => {
  assert.match(String(url), /api\.anthropic\.com/);
  contextualCalls++;
  const body = JSON.parse(String(init?.body));
  const messages = JSON.stringify(body.messages);
  assert.ok(body.messages.some((message: { content: { type: string; text?: string }[] }) =>
    message.content.some(part => part.type === 'text' && part.text?.includes(r01))), 'the complete multi-intent comment reaches the model');
  assert.ok(!messages.includes(privateAnswer), 'the private diagnosis stays out of model context');
  assert.ok(!messages.includes(privateFact), 'unrevealed case facts stay out of model context');
  const verdict = {intent:'fictional joke with a completed personal anecdote and a collection question',decision:'reply',category:'banter',
    reply_text:leakPrivateAnswer ? `${privateAnswer}.` : 'The Emperor skipped diplomacy. I cannot promise which tooth cases are in the collection.',
    reason:'respond to the mixed comment without inventing inventory or personal medical advice',needs_lookup:false,promo_product:'none',promo_explicit:false,...(config.gifReplies?{gif_tag:'none'}:{})};
  return new Response(JSON.stringify({id:'r01-fixture',type:'message',role:'assistant',model:config.triageModel,stop_reason:'tool_use',stop_sequence:null,
    usage:{input_tokens:1,output_tokens:1},content:[{type:'tool_use',id:'r01-tool',name:'submit_reply',input:verdict}]}), {headers:{'content-type':'application/json'}});
};
const contextualInput = {...input,commentText:r01,answer:privateAnswer,facts:[privateFact],replyAll:true,modelOverride:config.triageModel,allowSearch:false};
const contextual = await classifyAndDraft(contextualInput);
assert.equal(contextualCalls,1,'R01 reaches normal drafting instead of a fixed acknowledgment');
assert.equal(contextual.decision,'reply');
assert.notEqual(contextual.reply_text,ACKNOWLEDGMENTS.image);
assert.doesNotMatch(contextual.reason,/owner review: image\/anatomy/);
assert.equal(contextual.promo_product,undefined);
assert.equal(contextual.promo_explicit,undefined);
assert.doesNotMatch(contextual.reply_text,/https?:\/\/|you should|i have \d/i);
leakPrivateAnswer = true; contextualCalls = 0;
const blockedSpoiler = await classifyAndDraft(contextualInput);
assert.equal(contextualCalls,2,'private-answer repair stays bounded to one attempt');
assert.equal(blockedSpoiler.decision,'skip');
assert.equal(blockedSpoiler.reply_text,'');
assert.equal(blockedSpoiler.promo_product,undefined);
console.log('PASS full R01 reaches mocked contextual drafting without a promotion and existing private-answer guards remain bounded');
const story = 'Little sister of my friend swallowed a coin of 1 fim. At hospital the family was advised to thoroughly keep an eye on her poops. So, the next day they found two 50 penny coins 😀.';
for (const text of [story, 'I swallowed a coin when I was little.', 'My child had surgery years ago. That was terrifying.', 'I asked the doctor if I should get an X-ray. They said no.']) assert.equal(requestsPersonalAdvice(text), false, text);
for (const text of ['My child is drooling. Should I get an X-ray?', 'I have pain. Could I have this?', 'What medicine should I use?', 'I need medical advice']) assert.equal(requestsPersonalAdvice(text), true, text);
const retired = "That sounds worrying. A comment can't establish what's causing it. A clinician can assess your symptoms.";
assert.equal(isRetiredMedicalBoundary(retired), true);
assert.equal(sanitize({decision:'reply',category:'empathize',reply_text:retired,reason:'story'}).decision,'skip');
let storyCalls = 0;
let alwaysPersonal = false;
mockModel = async (_url, init) => {
  storyCalls++;
  const body = JSON.parse(String(init?.body));
  if (storyCalls === 2) assert.match(JSON.stringify(body.messages), /CLASSIFICATION RECHECK/);
  const verdict = {intent:'personal story',decision:'reply',category:alwaysPersonal || storyCalls === 1 ? 'personal_medical' : 'banter',reply_text:alwaysPersonal || storyCalls === 1 ? retired : "That's one way to get change.",reason:'completed anecdote with a punchline',needs_lookup:false,promo_product:'none',promo_explicit:false,...(config.gifReplies?{gif_tag:'none'}:{})};
  return new Response(JSON.stringify({id:'story-fixture',type:'message',role:'assistant',model:config.triageModel,stop_reason:'tool_use',stop_sequence:null,usage:{input_tokens:1,output_tokens:1},content:[{type:'tool_use',id:'story-tool',name:'submit_reply',input:verdict}]}), {headers:{'content-type':'application/json'}});
};
const storyReply = await classifyAndDraft({...input,commentText:story,modelOverride:config.triageModel});
assert.equal(storyCalls,2);
assert.equal(storyReply.category,'banter');
assert.equal(storyReply.reply_text,"That's one way to get change.");
assert.equal(isRetiredMedicalBoundary(storyReply.reply_text),false);
alwaysPersonal = true; storyCalls = 0;
const ambiguous = await classifyAndDraft({...input,commentText:story,modelOverride:config.triageModel});
assert.equal(storyCalls,2,'recheck must be bounded');
assert.equal(ambiguous.decision,'skip');
assert.equal(ambiguous.reply_text,'');
console.log('PASS exact reported story receives one classification recheck and relevant banter; retired line is blocked');
for (const category of ['affirm','correct','teach','reference'] as const) {
  const d = {decision:'reply' as const,category,reply_text:'A claim about this image',reason:'fixture'};
  assert.equal(holdForImageReview(d,true).decision,'skip');
  assert.equal(holdForImageReview(d,false).decision,'reply');
}
assert.equal(holdForImageReview({decision:'reply',category:'banter',reply_text:'A harmless joke',reason:'fixture'},true).decision,'reply');
const dir=mkdtempSync(join(tmpdir(),'reply-concerns-'));
config.stateFile=join(dir,'state.json');
atomicJson(config.stateFile,{repliedCommentIds:[],answeredPostIds:[],postCounts:{},daily:{date:'2020-01-01',count:0}});
const state=new State();
for (const [i,text] of benignAnatomyComments.entries()) {
  if (imageConcernKind(text) === 'anatomy') state.queueOwnerReview(`benign-${i}`,'benign-post','owner review: image/anatomy inconsistency',text,'fixture-reader');
}
assert.equal(new State().hasImageReview('benign-post'),false,'the shared visible-concern classifier must not create a post-wide hold for R01 or benign contrasts');
assert.equal(new State().pendingOwnerReviews().length,0,'benign observations must not create owner-review entries');
state.queueOwnerReview('image-1','post','owner review: image/anatomy inconsistency',input.commentText,'reader');
state.queueOwnerReview('image-2','post','owner review: image/anatomy inconsistency','A missing rib','another');
assert.equal(new State().hasImageReview('post'),true);
state.holdUntilImageReview('waiting-comment','post');
assert.equal(new State().isWaitingForImageReview('waiting-comment','post'),true,'blocked comments do not pay for another review each poll');
assert.equal(new State().pendingOwnerReviews()[0].commentText,input.commentText);
state.resolveOwnerReview('image-1','Owner checked the finding');
assert.equal(state.hasImageReview('post'),true,'all relevant concerns must be resolved');
state.resolveOwnerReview('image-2','Owner corrected the image');
state.queueOwnerReview('image-2','post','owner review: image/anatomy inconsistency');
assert.equal(new State().hasImageReview('post'),false,'the same resolved comment must not reopen a hold');
assert.equal(new State().isWaitingForImageReview('waiting-comment','post'),false,'resolving the review automatically releases its waiting comments');
assert.equal(state.claimConcernAcknowledgment('post','reader','personal','comment-1'),true);
assert.equal(new State().claimConcernAcknowledgment('post','READER','personal','comment-1'),true,'same comment may recover an interrupted publication');
assert.equal(new State().claimConcernAcknowledgment('post','reader','personal','comment-2'),false,'another comment must not repeat the acknowledgment');
assert.equal(new State().claimConcernAcknowledgment('post','another','personal','comment-3'),true);
assert.equal(acknowledgmentKind(ACKNOWLEDGMENTS.personal),'personal');
for (const [i,text] of genuineAnatomyComments.entries()) {
  const postId = `genuine-post-${i}`;
  if (imageConcernKind(text) === 'anatomy') state.queueOwnerReview(`genuine-${i}`,postId,'owner review: image/anatomy inconsistency',text,'fixture-reader');
  assert.equal(new State().hasImageReview(postId),true,'the shared visible-concern classifier must retain a post-wide hold for genuine anatomy concerns');
}
console.log('PASS persistent review details, selective holds, explicit resolution and restart-safe acknowledgment claims');
