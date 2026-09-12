// Paid staging evaluation of synthetic comments. Never calls a publishing endpoint.
import { readFileSync, writeFileSync } from 'node:fs';
import { classifyAndDraft } from '../src/reply';
import { config } from '../src/config';
import { diagnosticContext, unsupportedConfirmation, overstatesImagingLimit } from '../src/case-evidence';
import { replyStyleIssue } from '../src/reply-style';
import { drainSpend } from '../src/spend';
if (!process.argv.includes('--live')) throw new Error('Use --live for paid staging evaluation; nothing is published');
const output = process.argv.find(a => a.startsWith('--output='))?.slice(9);
if (!output) throw new Error('An explicit --output=FILE is required');
const jaw = JSON.parse(readFileSync('D:/Projects/xray-poster/cases/00147-odontogenic-keratocyst/case.json', 'utf8'));
const shoulder = JSON.parse(readFileSync('D:/Projects/xray-poster/cases/00152-luxatio-erecta/case.json', 'utf8'));
const cases = [
  { name: 'supported differential', c: jaw, text: 'Ameloblastoma but need path confirmation', public: true },
  { name: 'missing biopsy result', c: jaw, text: 'What did the biopsy show?', public: true },
  { name: 'pre-reveal guess', c: shoulder, text: 'Inferior shoulder dislocation?', public: false },
  { name: 'new clinical question', c: shoulder, text: 'Why do the nerves and blood vessels need checking?', public: true },
  { name: 'completed story', c: shoulder, text: 'This happened to me after a fall years ago. It was terrifying.', public: true },
  { name: 'specific joke', c: shoulder, text: 'When you have a question but the teacher never calls on you', public: true },
];
const results = [];
for (const f of cases) {
  const context = diagnosticContext({ acceptedDifferentials: f.c === jaw ? ['ameloblastoma'] : [] }, true);
  const input = { postText: f.c.generated.threadsCaption, commentText: f.text, answer: f.c.diagnosis,
    facts: [f.c.whatYouSee, f.c.whyItMatters, f.c.treatment, f.c.takeaway], diagnosticContext: context,
    answerPublic: f.public, recentReplies: ['The least convenient way to raise a hand 😭'], allowSearch: false };
  let d = await classifyAndDraft({ ...input, modelOverride: config.triageModel });
  if (d.decision === 'reply' && ['correct', 'teach'].includes(d.category)) d = await classifyAndDraft({ ...input, modelOverride: config.model });
  const passed = !/error:|fatal:/i.test(d.reason) && !unsupportedConfirmation(d.reply_text, context) && !overstatesImagingLimit(d.reply_text) && !replyStyleIssue(d.reply_text) &&
    !(f.name === 'specific joke' && /\b(?:breaks?|broken|fractur\w*)\b/i.test(d.reply_text)) &&
    (f.name !== 'pre-reveal guess' || d.decision === 'skip') &&
    (!['completed story', 'specific joke', 'supported differential', 'new clinical question'].includes(f.name) || d.decision === 'reply');
  results.push({ name: f.name, input: f.text, passed, decision: d });
  console.log(JSON.stringify(results.at(-1)));
}
writeFileSync(output, JSON.stringify({ at: new Date().toISOString(), scope: 'Synthetic staging comments only. No public writes.', spend: drainSpend(), results }, null, 2));
if (results.some(r => !r.passed)) process.exitCode = 1;
