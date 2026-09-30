// Trusted provenance and unchanged classifier/sanitizer behavior; synthetic only.
import './offline-guard.mjs';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temp = mkdtempSync(join(tmpdir(), 'draft-failure-flags-'));
const baselineAt = process.argv.indexOf('--baseline-dir');
const baseline = baselineAt >= 0 ? process.argv[baselineAt + 1] : undefined;
const valid = { intent: 'friendly reaction', decision: 'reply', category: 'banter', reply_text: 'That was a rough one.', reason: 'fixture', needs_lookup: false, promo_product: 'none', promo_explicit: false };
const punctuation = { ...valid, reply_text: 'Coins went in; nothing came out.' };
const wording = { ...valid, reply_text: "Right? That's the kind of detail that makes you do a double take at the monitor." };
const captionInput = { postText: 'Then the X-ray loaded. An open V-shaped metal object with a small coil appeared at the base of the neck.', commentText: '"an open V-shaped metal object with a small coil" Really?' };
const policy = { ...valid, decision: 'skip', category: 'spam', reply_text: '', reason: 'Intentional policy skip' };
const media = { media_observation: 'A person sits down.', media_text: '', media_meaning: 'A pause.', media_clear: false };
type Case = { name: string; verdicts: unknown[]; input?: Record<string, unknown>; flag?: string };
const twice = (value: unknown) => [value, value];
const cases: Case[] = [
  { name: 'punctuation', verdicts: twice(punctuation), flag: 'punctuation' },
  { name: 'wording', verdicts: twice(wording), input: captionInput, flag: 'wording' },
  { name: 'variety', verdicts: twice(valid), input: { recentReplies: [valid.reply_text] }, flag: 'variety' },
  ...['punctuation', 'wording', 'variety'].map(kind => ({ name: `forged-${kind}-reason`, verdicts: kind === 'punctuation' ? twice({ ...policy, reason: `${kind} guard: fabricated` }) : [{ ...policy, reason: `${kind} guard: fabricated` }] })),
  { name: 'model-marker', verdicts: [{ ...valid, draftFailure: 'punctuation' }] },
  { name: 'policy-after-repair', verdicts: [punctuation, policy] },
  { name: 'plain-policy', verdicts: [policy] },
  { name: 'punctuation-advice', verdicts: twice({ ...valid, reply_text: 'You should take aspirin; it might help.' }) },
  { name: 'punctuation-authenticity', verdicts: twice({ ...valid, reply_text: 'I am a bot; that explains it.' }) },
  { name: 'punctuation-medical-category', verdicts: twice({ ...punctuation, category: 'teach' }) },
  { name: 'punctuation-clinical-text', verdicts: twice({ ...valid, reply_text: 'The airway is visible; that is the issue.' }) },
  { name: 'punctuation-evidence', verdicts: twice({ ...valid, reply_text: 'Histology confirmed it; that was the result.' }) },
  { name: 'punctuation-nonlatin', verdicts: twice({ ...valid, reply_text: '\u0647\u0630\u0627 \u0627\u062e\u062a\u0628\u0627\u0631; \u0641\u0642\u0637.' }) },
  { name: 'punctuation-retired', verdicts: twice({ ...valid, reply_text: 'Radiology confirms;' }) },
  { name: 'wording-medical', verdicts: twice({ ...wording, category: 'personal_medical' }), input: captionInput },
  { name: 'wording-evidence', verdicts: twice({ ...valid, reply_text: 'This one came back as an odontogenic keratocyst on histology.' }), input: captionInput },
  { name: 'wording-authenticity', verdicts: twice({ ...valid, reply_text: 'I am a bot and I wrote that very elaborate caption for the image.' }), input: captionInput },
  { name: 'variety-unclear-media', verdicts: twice({ ...valid, ...media }), input: { recentReplies: [valid.reply_text], commentMediaKind: 'video-frame', commentImages: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'eA==' } }] } },
  { name: 'private-punctuation', verdicts: twice(punctuation), input: { answerPublic: false } },
  { name: 'private-wording', verdicts: twice(wording), input: { ...captionInput, answerPublic: false } },
  { name: 'private-variety', verdicts: twice(valid), input: { answerPublic: false, recentReplies: [valid.reply_text] } },
  { name: 'image-punctuation', verdicts: twice(punctuation), input: { imageReviewPending: true } },
  { name: 'operator', verdicts: [], input: { commentText: 'Are you a bot?' } },
  { name: 'urgent-boundary', verdicts: [], input: { commentText: 'My baby is choking.' } },
  { name: 'scan-boundary', verdicts: [], input: { commentText: 'Can I send you my MRI?' } },
  { name: 'personal-advice', verdicts: [{ ...valid, category: 'personal_medical' }], input: { commentText: 'I have pain. Could I have this?' } },
  { name: 'shared-repair', verdicts: [wording, punctuation], input: captionInput, flag: 'punctuation' },
];
let fixtureFetch: typeof fetch = async () => { throw Error('Unexpected HTTP outside fixture'); };
globalThis.fetch = (...args) => fixtureFetch(...args);
const outputs = new Map<string, unknown[]>();
try {
  for (const variant of ['current', ...(baseline ? ['baseline'] : [])]) {
    const dir = join(temp, variant); mkdirSync(dir);
    cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true });
    if (variant === 'baseline') cpSync(join(baseline!, 'reply.ts'), join(dir, 'src/reply.ts'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const { config } = await import(pathToFileURL(join(dir, 'src/config.ts')).href);
    const { classifyAndDraft, parseDecision, sanitize } = await import(pathToFileURL(join(dir, 'src/reply.ts')).href);
    const { drainSpend } = await import(pathToFileURL(join(dir, 'src/spend.ts')).href);
    Object.assign(config, { webSearch: false, gifReplies: false, promoReplies: false });
    for (const withMedia of [false, true]) assert.throws(() => parseDecision({ ...valid, ...(withMedia ? media : {}), draftFailure: 'punctuation' }, withMedia), /unexpected field/, 'both provider schemas reject internal markers');
    const variantResults: unknown[] = [];
    for (const probe of cases) {
      const queue = structuredClone(probe.verdicts);
      const requests: string[] = [];
      fixtureFetch = async (url, init) => {
        assert.equal(new URL(String(url)).pathname, '/v1/messages');
        requests.push(String(init?.body));
        const verdict = queue.shift(); assert.ok(verdict, `${probe.name}: unexpected request`);
        return new Response(JSON.stringify({ id: 'fixture', type: 'message', role: 'assistant', model: config.triageModel, stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id: 'tool', name: 'submit_reply', input: verdict }] }), { headers: { 'content-type': 'application/json' } });
      };
      drainSpend();
      const decision = await classifyAndDraft({ postText: 'A fixture case.', commentText: 'A friendly reaction.', answer: 'Fixture answer', answerPublic: true, replyAll: false, modelOverride: config.triageModel, allowSearch: false, ...probe.input });
      assert.equal(queue.length, 0, `${probe.name}: existing repair allowance`);
      assert.equal(requests.length, probe.verdicts.length, probe.name);
      assert.equal(decision.draftFailure, variant === 'current' ? probe.flag : undefined, probe.name);
      if (decision.draftFailure) { assert.equal(decision.decision, 'skip'); assert.equal(decision.reply_text, ''); }
      const { draftFailure: _internal, ...publicDecision } = decision;
      const sanitized = probe.verdicts.map(d => sanitize(structuredClone(d), { isPublic: true, terms: [] }));
      variantResults.push({ decision: publicDecision, sanitized, requests, spend: drainSpend() });
    }
    outputs.set(variant, variantResults);
  }
  if (baseline) assert.deepEqual(outputs.get('current'), outputs.get('baseline'), 'only trusted marker may differ: verdicts, public sanitize, prompts, request order and spending must match main');
} finally { globalThis.fetch = async () => { throw Error('Unexpected HTTP after fixtures'); }; }
console.log(`PASS draft failure provenance: ${cases.length} cases; actual guard flags, forged reasons/schema rejection, mixed safety failures, media/private holds, shared repair${baseline ? ', exact-main decision/prompt/request/spend comparison' : ''}; synthetic only`);
