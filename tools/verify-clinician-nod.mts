// Clinician nod: detector, single pick per post, prompt note gating and state marker. Mocked HTTP only.
// The 2026-10-17 audit describes clinicians posting full reads every night but quotes none verbatim, so the
// reads below are synthetic and modelled on that week's five cases.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.ANTHROPIC_API_KEY = 'offline-fixture';
process.env.BOT_WEB_SEARCH = 'off';
process.env.BOT_USAGE_LOG = 'off';
const { isClinicianRead, clinicianReadScore, pickClinicianNod, CLINICIAN_NOD_NOTE } = await import('../src/clinician-nod');

const reads = [
  'Radiologist here. CT angiogram shows a tangle of vessels with an enlarged draining vein and no nidus haemorrhage. Impression: AVM.',
  'RN here. Plain film AP view of the abdomen with massively distended loops of sigmoid colon and multiple diverticula. Likely sigmoid diverticulosis.',
  'ER doc. Axial CT with dark intracranial air pockets and a skull base fracture. Diagnosis traumatic pneumocephalus, watch for CSF rhinorrhoea.',
  'Bilateral hydroureteronephrosis on the IVP with dilated calyces and tortuous ureters. Findings consistent with distal obstruction, probably the bladder outlet. - MD',
  'Infrarenal aortic aneurysm on CT with calcified wall and mural thrombus, roughly 6 cm. Impression: AAA needing repair. Radiology resident',
];
for (const r of reads) assert.equal(isClinicianRead(r), true, `${clinicianReadScore(r)}: ${r}`);
const notReads = [
  'Maxell veins... plug your head into a 1980s cassette player',
  'Truly empty headed.',
  'Triple A???',
  'My late husband passed away with a stroke, but he had ESRD and dialysis for years and I miss him',
  'Sigmoid diverticulosis',
  'Radiologist here lol this is obviously fake AI slop',
  'Do us a favour and post a normal one next time please, this one is too much for me',
  'A touch of the MAGAs? The president would know about distended colons',
  'I am a nurse and I love this page so much, please keep posting these every night!',
];
for (const n of notReads) assert.equal(isClinicianRead(n), false, `${clinicianReadScore(n)}: ${n}`);

// One pick per post: the strongest top-level read; replies under other threads never qualify.
const top = (id: string, text: string, parent = 'post') => ({ id, text, replied_to: { id: parent } });
const pick = pickClinicianNod([top('a', reads[1]), top('b', reads[0]), top('c', reads[3], 'bot-reply'), top('d', 'Wow')] as never, 'post');
assert.ok(pick === 'a' || pick === 'b');
assert.equal(pick, clinicianReadScore(reads[0]) >= clinicianReadScore(reads[1]) ? 'b' : 'a', 'highest score wins');
assert.equal(pickClinicianNod([top('c', reads[3], 'bot-reply')] as never, 'post'), undefined, 'a reply under another thread (often a dispute) is not nodded');
assert.equal(pickClinicianNod([top('d', 'Wow')] as never, 'post'), undefined);

// The note is facts-only and only rides after the reveal.
assert.match(CLINICIAN_NOD_NOTE, /Confirm only what the case states/);
let body: any; let calls = 0;
globalThis.fetch = async (_url, init) => {
  calls++; body = JSON.parse(String(init?.body));
  return new Response(JSON.stringify({ id: 'f', type: 'message', role: 'assistant', model: body.model, stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 },
    content: [{ type: 'tool_use', id: 't', name: 'submit_reply', input: { intent: 'clinician read', decision: 'reply', category: 'affirm', reply_text: 'That draining vein is exactly what the case names.', reason: 'fixture', needs_lookup: false, promo_product: 'none', promo_explicit: false } }] }), { headers: { 'content-type': 'application/json' } });
};
const { classifyAndDraft } = await import('../src/reply');
const { config } = await import('../src/config');
Object.assign(config, { gifReplies: false, deepSeekTrial: false });
const input = { postText: 'He thought it was a migraine.', commentText: reads[0], answer: 'Arteriovenous malformation / AVM', facts: ['A tangle of abnormal vessels with an enlarged draining vein.'], answerPublic: true, replyAll: true, modelOverride: config.triageModel, allowSearch: false, learnedNotesOverride: '' };
await classifyAndDraft({ ...input, clinicianNod: true } as never);
assert.match(JSON.stringify(body.messages), /CLINICIAN READ/);
await classifyAndDraft({ ...input, clinicianNod: false } as never);
assert.doesNotMatch(JSON.stringify(body.messages), /CLINICIAN READ/);
await classifyAndDraft({ ...input, clinicianNod: true, answerPublic: false, facts: undefined } as never);
assert.doesNotMatch(JSON.stringify(body.messages), /CLINICIAN READ/, 'never before the reveal');
assert.equal(config.clinicianNod, false, 'off unless BOT_CLINICIAN_NOD=on (reply.yml turns it on)');

// One nod per post, persisted.
const dir = mkdtempSync(join(tmpdir(), 'clinician-nod-'));
config.stateFile = join(dir, 'state.json');
writeFileSync(config.stateFile, JSON.stringify({ repliedCommentIds: [], answeredPostIds: [], postCounts: {}, daily: { date: '2020-01-01', count: 0 } }));
const { State } = await import('../src/state');
const state = new State();
assert.equal(state.hasClinicianNod('p1'), false);
state.markClinicianNod('p1', 'c1'); state.markClinicianNod('p1', 'c2');
const again = new State();
assert.equal(again.hasClinicianNod('p1'), true); assert.equal(again.hasClinicianNod('p2'), false);
console.log('PASS clinician nod: structured reads detected (credential, modality, findings, impression), jokes, stories, praise and disputes rejected, one top-level pick per post, facts-only note after the reveal only, persisted once per post.');
