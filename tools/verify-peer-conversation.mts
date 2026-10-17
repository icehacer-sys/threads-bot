// Owner-reported 2026-10-17: the bot answered commenters who were talking to EACH OTHER. A realistic nested
// thread runs through the real worker (dry run, mocked Threads and model HTTP, no state writes) and the test
// asserts exactly which comments reach the model. Pure addressee checks are covered first.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.ANTHROPIC_API_KEY = 'offline-fixture';
process.env.THREADS_ACCESS_TOKEN = 'offline-fixture';
process.env.BOT_WEB_SEARCH = 'off';
process.env.BOT_USAGE_LOG = 'off';
process.env.BOT_XRAY_CASES_BASE = '';
const { addresseeVerdict, addressesUs, isFriendTagOnly, taggedOthers } = await import('../src/peer-conversation');
const { pickClinicianNod } = await import('../src/clinician-nod');
const { selectLateSweep } = await import('../src/late-sweep');

const me = 'mdnoteslab';
const t0 = Date.parse('2026-10-16T19:30:00Z');
const at = (min: number) => new Date(t0 + min * 60_000).toISOString();
const c = (id: string, username: string, parent: string, text: string, min: number) => ({ id, username, replied_to: { id: parent }, text, timestamp: at(min), hide_status: 'NOT_HUSHED' });
const conversation = [
  c('ANS', me, 'post', 'Answer: Arteriovenous malformation', 20),
  c('A1', 'usera', 'post', 'Looks like an AVM to me', 25),
  c('BOT1', me, 'A1', 'AVM is right and that big vein drains the tangle.', 30),
  c('B1', 'userb', 'A1', 'No way it is an aneurysm', 31),
  c('A2', 'usera', 'B1', '@userb read the caption again', 32),
  c('C1', 'userc', 'post', '@sarah this is you 😂', 33),
  c('C2', 'userc2', 'post', '@mike AVM? that is my guess', 34),
  c('B2', 'userb', 'BOT1', '@usera told you so', 35),
  c('D1', 'userd', 'BOT1', 'Wait so how big does it get?', 36),
  c('A3', 'usera', 'BOT1', 'Thanks! How rare is it?', 37),
  c('E1', 'usere', 'B1', '@mdnoteslab who is right here?', 38),
  c('F1', 'userf', 'ANS', 'Knew it from the tangle', 39),
  c('G1', 'userg', 'F1', 'same here honestly', 40),
  c('H1', 'userh', 'B1', 'Doc, is it an aneurysm or not?', 41),
];
const byId = new Map(conversation.map((x) => [x.id, x]));
const ctx = { postId: 'post', me, byId, answerCommentId: 'ANS' };
const verdicts = Object.fromEntries(conversation.map((x) => [x.id, addresseeVerdict(x as never, ctx) ?? 'us']));
assert.deepEqual(verdicts, {
  ANS: 'us', A1: 'us', BOT1: 'us', B1: 'peer_conversation', A2: 'peer_conversation', C1: 'friend_tag_only', C2: 'us',
  B2: 'peer_conversation', D1: 'us', A3: 'us', E1: 'us', F1: 'us', G1: 'peer_conversation', H1: 'us',
});
for (const yes of ['@mdnoteslab what is this?', 'Doc, how rare is this?', 'OP: is it real?', 'Hey Mr M is this an AVM?', 'Question for OP is this genetic?']) assert.equal(addressesUs(yes, me), true, yes);
for (const no of ['@sarah look', 'my doc said the same thing', 'I opted out', 'Mr Bean would love this', 'That is not what the documentation says']) assert.equal(addressesUs(no, me), false, no);
for (const tag of ['@sarah this is you', '@john look', '@a @b lol', '@kim 😂😂', '@sam remember this', '@jo you next']) assert.equal(isFriendTagOnly(tag, me), true, tag);
for (const real of ['@mike AVM?', '@sarah is that a brain aneurysm', '@john what even is this', 'Looks like an AVM', '@mdnoteslab this is you', '@kim I think it is a kidney stone']) assert.equal(isFriendTagOnly(real, me), false, real);
assert.deepEqual(taggedOthers('@mike AVM? @MDNotesLab', me), ['mike']);

// Late sweep and clinician nod see the same addressee rule.
const read = 'Radiologist here. CT angiogram shows a tangle of vessels with an enlarged draining vein. Impression: AVM.';
const peerRead = c('R1', 'rad', 'B1', read, 50);
const topRead = c('R2', 'rad2', 'post', read, 51);
assert.equal(pickClinicianNod([peerRead, topRead] as never, 'post'), 'R2', 'a clinician read sent to another commenter never gets the nod');
const sweepPool = [c('S1', 'u1', 'post', 'How long can someone live with this?', 900), c('S2', 'u2', 'A1', 'How long can someone live with this?', 901), c('S3', 'u3', 'post', '@friend this is you', 902)];
const swept = selectLateSweep(sweepPool as never, { me, windowClose: new Date(t0 + 600 * 60_000), max: 15, eligible: (x) => !addresseeVerdict(x, { ...ctx, byId: new Map([...byId, ...sweepPool.map((s) => [s.id, s] as const)]) }), hadSkip: () => false });
assert.deepEqual(swept.map((x) => x.id), ['S1'], 'the sweep skips peer replies and friend tags');

// End to end through the worker: only comments addressed to the account reach the model.
const { config } = await import('../src/config');
Object.assign(config, { answerEnabled: false, pinnedPostIds: [], windowHours: 0, newestOnly: true, deepSeekTrial: false, gifReplies: false, webSearch: false, visionEnabled: false, replyAll: true, maxThreadReplies: 3, heldRevisitHours: 0, xrayCasesRawBase: '' });
const classified: string[] = [];
const prompts: string[] = [];
const ok = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init) => {
  const u = new URL(String(url));
  if (u.hostname === 'api.anthropic.com') {
    const body = JSON.parse(String(init?.body)); const text = JSON.stringify(body.messages);
    const comment = conversation.find((x) => text.includes(`COMMENT:\\n${x.text}`));
    classified.push(comment?.id ?? 'unknown'); prompts.push(text);
    return ok({ id: 'f', type: 'message', role: 'assistant', model: body.model, stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'tool_use', id: 't', name: 'submit_reply', input: { intent: 'fixture', decision: 'skip', category: 'other', reply_text: '', reason: 'fixture skip', needs_lookup: false, promo_product: 'none', promo_explicit: false } }] });
  }
  if (u.pathname.endsWith('/me/threads')) return ok({ data: [{ id: 'post', text: 'He thought it was a migraine.', timestamp: at(0) }] });
  if (u.pathname.endsWith('/me')) return ok({ id: 'owner', username: me });
  if (u.pathname.endsWith('/post/replies')) return ok({ data: conversation.filter((x) => x.replied_to.id === 'post') });
  if (u.pathname.endsWith('/post/conversation')) return ok({ data: conversation });
  throw new Error(`Unexpected fixture URL: ${u.hostname}${u.pathname}`);
};
const logs: string[] = [];
const origLog = console.log;
let finished!: () => void;
const done = new Promise<void>((resolve) => { finished = resolve; });
console.log = (...args: unknown[]) => { const line = args.map(String).join(' '); logs.push(line); if (line.startsWith('Summary:')) finished(); };
const root = dirname(dirname(fileURLToPath(import.meta.url)));
process.argv = [process.execPath, join(root, 'src/index.ts')];
await import('../src/index');
await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error(`worker did not finish:\n${logs.join('\n')}`)), 20_000))]);
console.log = origLog;
assert.deepEqual([...classified].sort(), ['A3', 'C2', 'D1', 'E1', 'F1', 'H1'], `classified: ${classified.join(',')}\n${logs.join('\n')}`);
assert.ok(logs.some((l) => /5 comment\(s\) skipped as peer conversation/.test(l)), logs.join('\n'));
const c2Prompt = prompts[classified.indexOf('C2')];
assert.match(c2Prompt, /TAGGED FRIENDS: This comment also tags @mike/, 'a guess with a friend tag is answered without treating the tag as ours');
assert.doesNotMatch(prompts[classified.indexOf('D1')], /TAGGED FRIENDS/);
assert.equal(process.exitCode ?? 0, 0, 'peer skips are never errors');
console.log('PASS peer conversation: replies between commenters, peer talk under our replies and friend-only tags never reach the model; direct addresses, the answered user, our answer thread and tagged guesses do; late sweep and clinician nod follow the same rule.');
