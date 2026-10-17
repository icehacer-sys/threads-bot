// Saved native responses, actual adapter/classifier/guards. Offline replay only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
process.env.ANTHROPIC_API_KEY='synthetic-claude';process.env.DEEPSEEK_API_KEY='synthetic-deepseek';delete process.env.ANTHROPIC_AUTH_TOKEN;
const hash=(s:string)=>crypto.createHash('sha256').update(s).digest('hex');
const pack=JSON.parse(fs.readFileSync(new URL('./fixtures/deepseek-media-verification.json',import.meta.url),'utf8'));
const recheck=JSON.parse(fs.readFileSync(new URL('./fixtures/deepseek-media-recheck.json',import.meta.url),'utf8'));
let active:any,attempts=0,captured:any,capturedUrl='';
globalThis.fetch=async(url,init)=>{
 attempts++;capturedUrl=String(url);captured=JSON.parse(String(init?.body));
 return new Response(JSON.stringify(active.response),{headers:{'content-type':'application/json'}});
};
const {config}=await import('../src/config');// Benchmark-only route: runtime keeps commenter media on Claude (deepSeekCommentMedia 'claude').
Object.assign(config,{deepSeekTrial:true,deepSeekCommentMedia:'held',webSearch:true,model:'claude-sonnet-4-6',triageModel:'claude-haiku-4-5-20251001',voiceVariant:'lean',visionEnabled:true,gifReplies:false});
const {classifyAndDraft}=await import('../src/reply');const {drainSpend}=await import('../src/spend');
const {COVERAGE_NOTE}=await import('../src/reply-coverage');
const {VOICE_LEAN}=await import('../src/voice-lean');
const {GIF_SYSTEM_PROMPT,MEDIA_REPLY_NOTE}=await import('../src/media-reply');
// Keep paid fixture hashes intact. Reverse only the owner-approved coverage and
// sentence-style and emoji-intent edits when comparing with the historical prompt.
// 2026-10-17 owner voice update (freer sentence shape, question back, "!", one-in-five emoji), reversed first.
const voice1017:Array<[string,string]>=[
 ['Vary the shape the way a real person types: one to three short sentences and sometimes just two to six words.','Prefer one complete sentence for a brief reply.'],
 ['About one reply in five may carry one emoji from the allowed set (🤣 😭 🤍 🫡 ✅ 💯 👏) when it adds real tone to light banter or warmth. Never on grief, fear, corrections or medical answers and never more than one.','Prefer replies without emoji. Use at most one occasional emoji when it adds something to the specific joke.'],
 ["Where a comma would go use a full stop instead of chaining every thought with and. A very short reply such as 'Nope.' is fine but do not stack choppy fragments or use connector fragments such as 'Still.' or 'And yeah.'","Keep connected thoughts in one sentence using and, but, so or because without a comma. Separate genuinely independent thoughts with a full stop. Do not create fragments such as 'Still.' or 'And yeah.'"],
 ['For banter respond directly to what they said in one to three short sentences. A two to six word reply is often the best one.','For banter write one complete sentence that responds directly to what they said.'],
 ['An occasional light question back is fine when you would genuinely want their answer but never as a habit to prolong the exchange. Use an exclamation mark where a real person would and not on every reply.','Do not add a question at the end just to prolong the exchange.'],
 ['react to the scan itself in your own words the way a friend would instead of rating',"react to the scan itself the way a friend would ('That was my first read too') instead of rating"],
];
const coverage1017:[string,string]=['Keep it short and vary the shape: a few words or one to three short sentences. An occasional genuine question back is fine but never just to prolong the exchange.','Prefer one plain sentence. Do not add questions just to prolong the exchange.'];
const variety1017:[string,string]=['Words carry the reply. An emoji is optional and never a default ending. Do not replace one repeated emoji with another.','Prefer words alone. Emoji is optional decoration, never a default ending. Do not replace one repeated emoji with another.'];
assert.ok(COVERAGE_NOTE.includes(coverage1017[0]),'2026-10-17 coverage wording present');
const recordedCoverageNote=COVERAGE_NOTE.replace(...coverage1017).replace('including short guesses, thanks and reactions. Skip comments consisting only of emoji.','including short guesses, emoji, thanks and reactions.');
assert.notEqual(recordedCoverageNote,COVERAGE_NOTE,'Current coverage guidance must exclude emoji-only comments');
const currentVoice=VOICE_LEAN.replace(/\r\n/g,'\n');
for(const [now] of voice1017) assert.ok(currentVoice.includes(now),`2026-10-17 voice wording present: ${now.slice(0,40)}`);
const recordedVoice=voice1017.reduce((t,[now,then])=>t.replace(now,then),currentVoice)
 // 2026-10-12 voice audit edits (owner-approved), reversed first.
 .replace('Obvious fictional diagnoses, food comparisons and everyday-object, animal or injury explanations such as a swallowed phone cord or a gunshot are jokes or lay readings, not clinical guesses: reply to their premise.','Obvious fictional diagnoses and food comparisons are jokes, not clinical guesses: reply to the joke.')
 .replace("When a comment reads the film as an object, animal or injury, start from why it looks that way and land the answer in the same sentence only if it fits. A sincere lay misreading gets the resemblance first: 'They really do look like bullet holes but these opened up from the inside.' Never open by negating their noun with 'No bullet', 'Nobody swallowed' or 'Nothing fired'.\n",'')
 .replace(" Never agree with or echo a wish to die, even as hyperbole such as 'I'd rather die than have that'. React to the scan or the fear instead.",'')
 .replace(" For a bare 'wow', 'dead' or 'yikes' react to the scan itself the way a friend would ('That was my first read too') instead of rating their word as right, fair or about right.",'')
 .replace("Treat emoji as emotional context for the written comment. Respond to the guess, question or joke itself without explaining the emoji, describing the face or announcing what their reaction means. Do not praise a reaction as correct, fair or appropriate. Do not comment on their use of an abbreviation, Latin name or spelling. Discuss an emoji's meaning only when the commenter explicitly asks about it. If there is no clear meaning, skip rather than invent one.\n",'')
 .replace("Correct guess after reveal -> a brief natural acknowledgment of the guess without commenting on its wording: 'Dracunculus medinensis' -> 'That's the one.'","Correct guess after reveal -> affirm with a few words tied to how THEY said it, never a bare stamp: 'Dracunculus medinensis' -> 'You went straight to the Latin name.'")
 .replace('Prefer one complete sentence for a brief reply.','Usually one or two short sentences.')
 .replace('For banter write one complete sentence that responds directly to what they said. Do not split a joke into a setup fragment and a separate punchline. Prefer plain wording you would say aloud. Avoid slogans, elaborate metaphors and clever wording that needs explaining. Do not force the diagnosis or scan description into a joke.','For banter, make one small response to their premise and stop.')
 .replace('You went straight to the Latin name.','Straight to the Latin name.')
 .replace('It took four days to get that euro back.','Four days to get that euro back 😭')
 .replace('You searched for four days just to get one euro back.','Four days of searching just to get one euro back.')
 .replace('They found coins, keys and buttons.','Coins, keys and buttons.');
assert.notEqual(recordedVoice,currentVoice,'Current voice must use the approved complete-sentence style');
const currentGifVoice=GIF_SYSTEM_PROMPT.replace(/\r\n/g,'\n');
const recordedGifVoice=currentGifVoice.replace(' Write one complete conversational sentence without a setup fragment or a separate punchline.','');
const currentMediaNote=MEDIA_REPLY_NOTE.replace(/\r\n/g,'\n');
const recordedMediaNote=currentMediaNote.replace(' Use one complete conversational sentence for a simple reaction.','');
// Weird X-Ray Case Files catalog switch (owner-approved, 2026-10-13). The saved requests carry the
// 2026-09-30 catalog, so rebuild that block and promo enum and reverse the promo wording edits.
const {PRODUCTS_BLOCK,PROMO_TAGS,catalogBlock}=await import('../src/products');
const recordedProducts=JSON.parse(fs.readFileSync(new URL('./fixtures/products-recorded-2026-09-30.json',import.meta.url),'utf8'));
const recordedProductsBlock=catalogBlock(recordedProducts);
const recordedPromoTags=['none',...recordedProducts.map((p:any)=>p.tag)];
assert.notEqual(PRODUCTS_BLOCK,recordedProductsBlock,'Current catalog must be the new product line');
const promoEdits:Array<[string,string]>=[
 ['whether there is a book or a game','whether there is a book or collection'],
 [', ask how to support you (→ support), or joke',', or joke'],
 ['(free_round is the default for casual interest)','(free_pack is the default for casual interest)'],
 ['default to free_round (start free) or every_file when they want everything.','default to free_pack (start free) or complete_collection.'],
 ['("I made a free round of these you can play on your phone" / "I put 10 of the weirdest into a book")','("I actually turned these into a card game" / "I put 50 of these into a book")'],
 ['you may name the price from the catalog but never a discount code;','you may name the price or the SPOTIT code;'],
];
// Learned notes: voicelearn.yml activates new notes after its fixed evaluation and they ride in the
// system prompt, so each activation (e.g. 2026-10-12 18:34 UTC) changed the paid hashes. Swap the
// active notes for the copy that was live when the requests were recorded (activated 2026-09-28).
const learnedBody=(md:string)=>md.replace(/\r\n/g,'\n').trim().replace(/<!--[\s\S]*?-->/g,'').trim();
const activeNotes=learnedBody(fs.readFileSync(new URL('../data/voice-learned.md',import.meta.url),'utf8'));
const recordedNotes=learnedBody(fs.readFileSync(new URL('./fixtures/voice-learned-recorded-2026-09-28.md',import.meta.url),'utf8'));
const recordNotes=(s:string)=>activeNotes&&activeNotes!==recordedNotes?s.replace(`\n${activeNotes}`,`\n${recordedNotes}`):s;
const recordPromo=(s:string)=>recordNotes(promoEdits.reduce((t,[now,then])=>t.replace(now,then),s.replace(PRODUCTS_BLOCK,recordedProductsBlock)));
const sameTags=(v:unknown)=>Array.isArray(v)&&JSON.stringify(v)===JSON.stringify(PROMO_TAGS);
const {DEEPSEEK_MEDIA_GUIDANCE,DEEPSEEK_MEDIA_HOLD,DEEPSEEK_REPLY_GUIDANCE}=await import('../src/deepseek-media-policy');
let roundedTotal=0;
for(const c of [...pack.cases,...recheck.cases]){active=c;const before=attempts;const result=await classifyAndDraft(c.input);assert.equal(attempts-before,1);
 assert.equal(capturedUrl,'https://api.deepseek.com/anthropic/v1/messages');
 // Files loaded into system prompts use CRLF on Windows and LF in Linux checkout.
 // Preserve the paid fixture hashes; normalize line endings and reverse only the
 // approved policy edits above. Every other request field/byte is included.
 assert.equal(captured.system.at(-1).text,DEEPSEEK_MEDIA_GUIDANCE);assert.equal(captured.system.at(-2).text,DEEPSEEK_REPLY_GUIDANCE);
 // Saved paid requests predate the discipline block; compare them without it only.
 const paid={...captured,system:captured.system.filter((b:any)=>b.text!==DEEPSEEK_REPLY_GUIDANCE)};
 const originalRequest=c.guidancePresentInNativeRequest?paid:{...paid,system:paid.system.slice(0,-1)};
 const expectedVoice=c.input.commentText.trim()?'For banter respond directly to what they said in one to three short sentences.':'Write one complete conversational sentence without a setup fragment or a separate punchline.';
 assert.ok(captured.system.some((b:any)=>b.text.includes(expectedVoice)),'Actual text and bare-GIF requests use the new sentence guidance');
 if(c.input.commentText.trim()) assert.ok(captured.system.some((b:any)=>b.text.includes('Treat emoji as emotional context for the written comment.')),'Actual text requests use the new emoji-intent guidance');
 const canonical=JSON.stringify(originalRequest,(_key,value)=>sameTags(value)?recordedPromoTags:typeof value==='string'?recordPromo(value.replace(/\r\n/g,'\n').replace(...variety1017).replace(COVERAGE_NOTE,recordedCoverageNote).replace(currentVoice,recordedVoice).replace(currentGifVoice,recordedGifVoice).replace(currentMediaNote,recordedMediaNote)):value);
 assert.equal(hash(canonical),c.normalizedRequestHash,'Historical native request parity apart from line endings and approved owner policy edits');
 assert.deepEqual(captured.messages.flatMap((m:any)=>m.content.filter((b:any)=>b.type==='image')).map((b:any)=>hash(Buffer.from(b.source.data,'base64') as any)),c.frameHashes);
 assert.deepEqual(JSON.parse(JSON.stringify(result)),c.final.decision==='reply'?{decision:'skip',category:'other',reply_text:'',reason:`error: ${DEEPSEEK_MEDIA_HOLD}`}:c.final);const spend=drainSpend();assert.equal(spend.calls,1);assert.equal(Math.ceil(spend.usd*1e6),c.costMicroUsd);roundedTotal+=c.costMicroUsd;
 assert.ok(!result.reply_text.includes(c.input.answer),'No private disclosure');
 if(c.id==='unreadable'){assert.equal(result.media_clear,false);assert.equal(result.decision,'skip');}
 if(c.id==='written-gif'){assert.equal(c.final.media_text,'SURE WAIT NOPE NOPE');assert.match(c.final.media_observation,/zooming/,'Preserve evidence of unsupported native claim, not a fabricated passing oracle');}
 if(c.id==='early-frame-control'){assert.equal(c.final.media_text,'SURE');assert.match(c.final.intent,/skeptical/,'Known intent error is a quality limitation');}
 console.log(`PASS saved native replay ${c.id}: full request hash with line endings normalized, exact frame hashes, final guard result, usage-derived cost. Quality conclusions remain separate.`);
}
assert.equal(roundedTotal,7621);console.log('PASS seven saved native media trajectories replayed offline; proposed media replies stopped after known accounting, safe skips retained; no paid calls.');
