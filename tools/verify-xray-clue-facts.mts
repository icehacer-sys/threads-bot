// The publisher's clueFacts (xray-cases PR #22) join the bridged case facts, so the reply guards treat a
// caption-hinted mechanism as case support. Older cases without clueFacts keep working. Mocked HTTP only.
import assert from 'node:assert/strict';
process.env.ANTHROPIC_API_KEY = 'offline-fixture';
process.env.BOT_XRAY_CASES_BASE = 'https://fixture.invalid/xray-cases';
const files: Record<string, unknown> = {
  '/xray-cases/state.json': { stages: { '00199-new': { threadsPostId: 'post-new' }, '00150-old': { threadsPostId: 'post-old' }, '00151-bad': { threadsPostId: 'post-bad' } } },
  '/xray-cases/cases/00199-new/case.json': { diagnosis: 'Traumatic pneumocephalus', whatYouSee: 'Dark pockets of air sit inside the skull.', whyItMatters: 'Air means the skull base is broken.', treatment: 'Most air reabsorbs on its own.',
    clueFacts: [{ clue: 'His nose would not stop running', fact: 'A skull base fracture can tear the dura so CSF leaks out through the nose.' }, { clue: 'He walked into a door frame', fact: 'Head trauma is the most common cause of air inside the skull.' }] },
  '/xray-cases/cases/00150-old/case.json': { diagnosis: 'Sigmoid diverticulosis', whatYouSee: 'Many small pouches line the sigmoid colon.' },
  '/xray-cases/cases/00151-bad/case.json': { diagnosis: 'Odd case', whatYouSee: 'One finding.', clueFacts: [null, { clue: 'x' }, { fact: 7 }, { fact: '  ' }, 'text'] },
};
globalThis.fetch = async (url) => {
  const body = files[new URL(String(url)).pathname];
  return body ? new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }) : new Response('missing', { status: 404 });
};
const { resolveXrayAnswer } = await import('../src/xray');
const { affirmsCommenterOnlyFinding } = await import('../src/deepseek-media-policy');

const fresh = await resolveXrayAnswer('post-new');
assert.ok(fresh);
assert.equal(fresh.facts.length, 5, 'three sections plus two clue facts');
assert.ok(fresh.facts.includes('A skull base fracture can tear the dura so CSF leaks out through the nose.'));
assert.ok(!fresh.facts.some((f) => f.includes('door frame')), 'only the fact is used, never the clue text');
const old = await resolveXrayAnswer('post-old');
assert.deepEqual(old?.facts, ['Many small pouches line the sigmoid colon.'], 'a case without clueFacts still works');
const bad = await resolveXrayAnswer('post-bad');
assert.deepEqual(bad?.facts, ['One finding.'], 'malformed clue entries are ignored');

// The guards read case support from these facts: a caption-hinted CSF leak is no longer commenter-only.
const reply = 'The leak part is right and the air came in through the break.';
const withClues = ['post', ...fresh.facts, fresh.answer].join(' ');
const withoutClues = ['post', ...fresh.facts.slice(0, 3), fresh.answer].join(' ');
assert.equal(affirmsCommenterOnlyFinding(reply, 'Skull fracture with a CSF leak', withClues, 'affirm'), null);
assert.equal(affirmsCommenterOnlyFinding(reply, 'Skull fracture with a CSF leak', withoutClues, 'affirm'), 'leak');
console.log('PASS clueFacts join the bridged case facts and policy case support; older and malformed cases are safe.');
