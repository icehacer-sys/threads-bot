import assert from 'node:assert/strict';
process.env.ANTHROPIC_API_KEY = 'offline-fixture';
process.env.BOT_USAGE_LOG = 'off';
process.env.BOT_GIF_REPLIES = 'off';
process.env.BOT_WEB_SEARCH = 'on';
const { classifyAndDraft, parseDecision } = await import('../src/reply');
const { mediaModelRoute, genericMediaReply, mediaReplyIssue, mediaVarietyNote } = await import('../src/media-reply');
const { config } = await import('../src/config');

const bad = [
  "That's the face everyone makes when they see what came back on the X-ray.",
  "That's the exact face for discovering a safety pin was never actually safe.",
];
for (const text of bad) assert.equal(genericMediaReply(text), true);
assert.equal(genericMediaReply('The name really oversold it.'), false);
assert.equal(genericMediaReply("I'd like to unsee it too."), false);
assert.equal(mediaModelRoute('video-frame', 4, 'motion', true), 'quality');
assert.equal(mediaModelRoute('video-frame', 1, 'motion', true), 'quality');
assert.equal(mediaModelRoute('video-frame', 4, 'motion', false), 'hold');
assert.equal(mediaModelRoute('image', 1, 'motion', true), 'triage');
assert.equal(mediaModelRoute('video-frame', 4, 'off', true), 'triage');
assert.match(mediaVarietyNote(['Yeah that one is rough.']), /yeah/);
assert.equal(mediaVarietyNote(['CLINICAL_REPLY_FIXTURE']), '');

const evidence = { media_observation: 'A man speaks while the caption changes.', media_text: "THAT'S NOT SAFE AT ALL", media_meaning: 'He calls out the lack of safety.', media_clear: true };
assert.equal(mediaReplyIssue(evidence, 'An open pin in the oesophagus is about as literal as that phrase gets.', true), 'generic media commentary');
assert.equal(mediaReplyIssue(evidence, 'That oesophageal location explains the concern.', true), 'case narration on reaction GIF');
assert.equal(mediaReplyIssue(evidence, 'The name really oversold it.', true), undefined);
assert.equal(mediaReplyIssue(evidence, 'That escalation is doing a lot of heavy lifting for all of us.', true), 'generic media commentary');
assert.equal(mediaReplyIssue(evidence, 'Pretty much the only proportionate response to an open safety pin in the throat.', true), 'generic media commentary');
assert.equal(mediaReplyIssue(evidence, 'Ironically accurate for something called a safety pin.', true), 'generic media commentary');
assert.equal(mediaReplyIssue(evidence, "Frame four really does capture what happens when you realize it's open.", true), 'generic media commentary');
const verdict = { intent: 'a safety joke', decision: 'reply', category: 'banter', reply_text: 'The name really oversold it.', reason: 'respond to the visible caption', needs_lookup: false, promo_product: 'none', promo_explicit: false };
assert.throws(() => parseDecision(verdict, true), /media_observation/);
assert.throws(() => parseDecision({ ...verdict, ...evidence, media_clear: 'yes' }, true), /media_clear/);
assert.equal(parseDecision(verdict).decision, 'reply'); // Text calls do not acquire extra fields.

let calls = 0;
let queue: unknown[] = [];
const bodies: any[] = [];
globalThis.fetch = async (_url, init) => {
  calls++;
  const body = JSON.parse(String(init?.body)); bodies.push(body);
  assert.equal(body.model, config.model);
  assert.equal(body.tool_choice.type, 'tool', 'GIF drafting must submit without a search detour');
  assert.equal(body.tools.some((t: any) => t.name === 'web_search'), false);
  const schema = body.tools.find((t: any) => t.name === 'submit_reply').input_schema;
  const hasFrames = body.messages[0].content.some((b: any) => b.type === 'image');
  assert.equal(schema.required.includes('media_observation'), hasFrames);
  const next = queue.shift(); assert.ok(next, 'unexpected extra paid retry');
  return new Response(JSON.stringify({ id: 'fixture', type: 'message', role: 'assistant', model: config.model, stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id: 'fixture-tool', name: 'submit_reply', input: next }] }), { headers: { 'content-type': 'application/json' } });
};
const input = { postText: 'Diagnosis challenge', commentText: '', answer: 'Swallowed safety pin', answerPublic: true, modelOverride: config.model, commentMediaKind: 'video-frame' as const, commentImages: [0, 1, 2, 3].map(n => ({ media_type: 'image/jpeg' as const, data: Buffer.from(`frame ${n}`).toString('base64') })) };

queue = [{ ...verdict, ...evidence }]; calls = 0;
const good = await classifyAndDraft(input);
assert.equal(good.reply_text, verdict.reply_text); assert.equal(good.media_text, evidence.media_text); assert.equal(calls, 1);
assert.match(JSON.stringify(bodies.at(-1)), /on-screen words/);
queue = [{ ...verdict, ...evidence }];
await classifyAndDraft({ ...input, postText: 'CLINICAL_POST_FIXTURE', recentReplies: ['CLINICAL_REPLY_FIXTURE'], facts: ['CLINICAL_FACT_FIXTURE'], images: [{ media_type: 'image/png', data: 'POST_IMAGE_FIXTURE' }] });
assert.ok(!JSON.stringify(bodies.at(-1)).includes('POST_IMAGE_FIXTURE'), 'a bare reaction GIF should not receive a competing X-ray image');
assert.ok(!JSON.stringify(bodies.at(-1)).includes('CLINICAL_FACT_FIXTURE'), 'reaction-only drafting must not be pushed into reciting clinical facts');
assert.ok(!JSON.stringify(bodies.at(-1)).includes('CLINICAL_POST_FIXTURE'));
assert.ok(!JSON.stringify(bodies.at(-1)).includes('CLINICAL_REPLY_FIXTURE'));
assert.match(JSON.stringify(bodies.at(-1).system), /brief English replies to reaction GIFs/);
assert.equal(bodies.at(-1).messages[0].content.filter((b: any) => b.type === 'image').length, 4);
queue = [{ ...verdict, ...evidence }];
await classifyAndDraft({ ...input, commentText: 'What is the clinical risk?', facts: ['CLINICAL_FACT_FIXTURE'], images: [{ media_type: 'image/png', data: 'POST_IMAGE_FIXTURE' }] });
assert.match(JSON.stringify(bodies.at(-1)), /CLINICAL_FACT_FIXTURE/);
assert.match(JSON.stringify(bodies.at(-1)), /POST_IMAGE_FIXTURE/);

queue = [{ ...verdict, ...evidence, reply_text: bad[0] }, { ...verdict, ...evidence }]; calls = 0;
assert.equal((await classifyAndDraft(input)).reply_text, verdict.reply_text); assert.equal(calls, 2);
assert.match(JSON.stringify(bodies.at(-1)), /MEDIA RECHECK/);

queue = bad.map(reply_text => ({ ...verdict, ...evidence, reply_text })); calls = 0;
const repeated = await classifyAndDraft(input);
assert.equal(repeated.decision, 'skip'); assert.equal(repeated.category, 'other'); assert.equal(calls, 2);

queue = [{ ...verdict, ...evidence, media_clear: false }]; calls = 0;
assert.equal((await classifyAndDraft(input)).decision, 'skip'); assert.equal(calls, 1);

queue = []; calls = 0;
assert.equal((await classifyAndDraft({ ...input, commentMediaKind: 'video', commentImages: [] })).decision, 'skip');
assert.equal(calls, 0, 'unavailable GIF with no text must not cost a model call');

queue = [{ ...verdict, ...evidence }, { ...verdict, ...evidence }]; calls = 0;
assert.equal((await classifyAndDraft({ ...input, recentReplies: [verdict.reply_text] })).decision, 'skip');
assert.equal(calls, 2, 'duplicate media replies get one retry and then a cacheable skip');

queue = [{ ...verdict, ...evidence, reply_text: 'Swallowed safety pin.' }]; calls = 0;
assert.equal((await classifyAndDraft({ ...input, answerPublic: false })).decision, 'skip');
assert.equal(calls, 1, 'GIFs do not bypass the reveal guard');

// A style repair cannot then trigger another media repair and a third bill.
queue = [{ ...verdict, ...evidence, reply_text: 'Nope; that is unsafe.' }, { ...verdict, ...evidence, reply_text: bad[1] }]; calls = 0;
assert.equal((await classifyAndDraft(input)).decision, 'skip'); assert.equal(calls, 2);
console.log('PASS GIF evidence, real template regressions, one-pass quality route, no-search drafting, zero-call missing media, shared retry bound and reveal guard');
