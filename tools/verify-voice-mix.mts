// Owner voice update (2026-10-17, Phase 1 of the 2026-10-12 voice research): freer sentence shape, very short
// replies, an occasional question back or "!", and about one reply in five with ONE allowed emoji, never on
// serious replies. A synthetic night of model drafts runs through the real classifier pipeline (mocked HTTP)
// and the posted mix is measured with voiceMix(), the same counts the audits use. The 2026-10-17 audit baseline
// was 77% single sentences, 0% emoji and 0% "?" or "!".
import assert from 'node:assert/strict';
process.env.ANTHROPIC_API_KEY = 'offline-fixture';
process.env.BOT_WEB_SEARCH = 'off';
process.env.BOT_USAGE_LOG = 'off';
const { voiceMix } = await import('../src/reply-metrics');
const { restrainEmoji, ALLOWED_EMOJI } = await import('../src/reply-variety');
const { replyStyleIssue } = await import('../src/reply-style');
const { sanitize, classifyAndDraft } = await import('../src/reply');
const { VOICE_LEAN } = await import('../src/voice-lean');
const { config } = await import('../src/config');
Object.assign(config, { gifReplies: false, deepSeekTrial: false, voiceVariant: 'lean' });

let queue: any[] = [];
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body)); const next = queue.shift(); assert.ok(next, 'unexpected extra paid call');
  return new Response(JSON.stringify({ id: 'f', type: 'message', role: 'assistant', model: body.model, stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 },
    content: [{ type: 'tool_use', id: 't', name: 'submit_reply', input: next }] }), { headers: { 'content-type': 'application/json' } });
};
const night: Array<[string, string, string]> = [
  ['Nope nope nope', 'banter', 'Nope. Not today colon.'],
  ['Plug his head into a 1980s cassette player', 'banter', 'That cassette is never rewinding 🤣'],
  ['Thanos snapped it', 'banter', 'Half the colon went to dust. The other half kept every pouch it had.'],
  ['It gave him the ability to break the sound barrier.', 'banter', 'Fast forward has never been that literal!'],
  ['My dad passed away from this last year', 'empathize', 'I am sorry you lost him. That is a lot to carry. 🤍'],
  ['He heard the news and his heart dropped.', 'banter', 'The aorta did the opposite 😭'],
  ['Give that tangle a pencil', 'banter', 'Who gave the tangle a pencil in the first place?'],
  ['What would cause that?', 'teach', 'Air gets in when a break in the skull base tears the dura.'],
  ['Truly empty headed.', 'banter', 'Finally a case where that insult is accurate. 🤣'],
  ['That caption is a lot', 'banter', 'Brutal. The caption warned you though.'],
  ['I yelled when I saw this', 'banter', 'Same and I posted it 😭'],
  ['AVM', 'affirm', 'Spot on'],
  ['Look at that vein go', 'banter', 'That vein has main character energy. It knows.'],
  ['Took me a second to get it', 'banter', 'Okay that one got me! 🤣'],
  ['My gut said colon', 'banter', 'Your gut feeling was literal this time. Respect.'],
  ['Imagine that at airport security', 'banter', 'Imagine the airport scanner. It would quit on the spot.'],
  ['How do those pouches form?', 'teach', 'Those pouches push out through weak spots in the colon wall.'],
  ['Plot twist', 'banter', 'Plot twist nobody ordered 🤣'],
  ['Road trip with this colon', 'banter', 'Would you trust that colon with a road trip?'],
  ['His skull let some air in', 'banter', 'The skull got a sunroof. Nobody asked for it.'],
];
const post = { postText: 'He thought it was just gas.', answer: 'Sigmoid diverticulosis / AVM', facts: ['Many small pouches push out through weak spots in the colon wall.', 'Air can enter the skull through a break in the skull base that tears the dura.'], answerPublic: true, replyAll: true, modelOverride: config.triageModel, allowSearch: false, learnedNotesOverride: '' };
const posted: string[] = [];
const serious: string[] = [];
for (const [commentText, category, reply_text] of night) {
  queue = [{ intent: 'voice mix fixture', decision: 'reply', category, reply_text, reason: 'fixture', needs_lookup: false, promo_product: 'none', promo_explicit: false }];
  const d = await classifyAndDraft({ ...post, commentText, recentReplies: [...posted] } as never);
  assert.equal(d.decision, 'reply', `${reply_text} -> ${d.reason}`);
  assert.equal(queue.length, 0, 'one draft per comment, no repair needed for an allowed shape');
  posted.push(d.reply_text);
  if (['empathize', 'teach', 'correct'].includes(category)) serious.push(d.reply_text);
}
const mix = voiceMix(posted);
console.log(JSON.stringify(mix));
assert.ok(mix.singleSentence <= 0.70, `single sentences ${mix.singleSentence} (audit baseline 0.77)`);
assert.ok(mix.short >= 0.10, `short replies ${mix.short}`);
assert.ok(mix.withEmoji >= 0.10 && mix.withEmoji <= 0.25, `emoji share ${mix.withEmoji} (target about one in five)`);
assert.equal(mix.maxEmojiPerReply, 1, 'never more than one emoji in a reply');
assert.ok(mix.questionOrExclaim >= 0.10, `question or exclamation share ${mix.questionOrExclaim}`);
assert.ok(posted.every((r) => !r.includes(',')), 'no commas');
assert.ok(posted.every((r) => !/[—–;]/.test(r)), 'no dashes or semicolons');
assert.ok(serious.every((r) => !/\p{Extended_Pictographic}/u.test(r)), 'no emoji on grief, teaching or corrections');
for (const r of posted) for (const glyph of r.match(/\p{Extended_Pictographic}/gu) ?? []) assert.ok(ALLOWED_EMOJI.has(glyph), glyph);

// The ceiling: two in the last ten or one in the last four strips; only an allowed glyph takes the slot.
assert.equal(restrainEmoji('Look 👀 at this 🤣', []), 'Look at this 🤣', 'a stripped glyph never uses up the slot');
assert.equal(restrainEmoji('Ha 🤣 😭', []), 'Ha 🤣', 'one per reply');
assert.equal(restrainEmoji('So sorry 🤍', [], true), 'So sorry', 'serious replies carry none');
assert.equal(restrainEmoji('Ha 🤣', ['a', 'b', 'c', 'd 😭']), 'Ha', 'one in the last four');
assert.equal(restrainEmoji('Ha 🤣', ['x 😭', 'b', 'c', 'd', 'e', 'f 🤣', 'g', 'h', 'i', 'j']), 'Ha', 'two in the last ten');
assert.equal(restrainEmoji('Ha 🤣', ['x 😭', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']), 'Ha 🤣', 'one in ten and none in the last four is allowed');
for (const glyph of ALLOWED_EMOJI) assert.equal(sanitize({ decision: 'reply', category: 'banter', reply_text: `That one got me ${glyph}`, reason: 'x' }, { isPublic: true, terms: [] }).reply_text, `That one got me ${glyph}`, `sanitize keeps ${glyph}`);

// Shapes that stay banned: setup fragment plus punchline, stacked choppy fragments, connector fragments, 4+ sentences.
for (const bad of ['Dial tone first then the receiver. This one came with a corkscrew oesophagus instead.', 'Counterclockwise. Slowly. With a pencil.', 'Plot twist. The colon wins.', 'One. Two. Three. Four.'])
  assert.equal(replyStyleIssue(bad, 'banter'), 'split banter', bad);
for (const ok of ['Nope.', 'The phone rang. Nobody answered.', 'Brutal. The caption warned you though.', 'Who gave the tangle a pencil?', 'That got me!'])
  assert.equal(replyStyleIssue(ok, 'banter'), undefined, ok);
// The prompt now asks for the freer register and lists the emoji set.
for (const phrase of ['one to three short sentences', 'two to six words', 'light question back', 'exclamation mark where a real person would', '(🤣 😭 🤍 🫡 ✅ 💯 👏)'])
  assert.ok(VOICE_LEAN.includes(phrase), phrase);
assert.ok(!VOICE_LEAN.includes('That was my first read too'), 'the copied verbatim example is gone');
console.log('PASS voice mix: freer sentence shape, short replies, occasional ? and !, about one in five with one allowed emoji and none on serious replies, banned shapes still caught.');
