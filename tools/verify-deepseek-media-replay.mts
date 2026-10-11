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
const recordedCoverageNote=COVERAGE_NOTE.replace('including short guesses, thanks and reactions. Skip comments consisting only of emoji.','including short guesses, emoji, thanks and reactions.');
assert.notEqual(recordedCoverageNote,COVERAGE_NOTE,'Current coverage guidance must exclude emoji-only comments');
const currentVoice=VOICE_LEAN.replace(/\r\n/g,'\n');
const recordedVoice=currentVoice
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
 const expectedVoice=c.input.commentText.trim()?'For banter write one complete sentence that responds directly to what they said.':'Write one complete conversational sentence without a setup fragment or a separate punchline.';
 assert.ok(captured.system.some((b:any)=>b.text.includes(expectedVoice)),'Actual text and bare-GIF requests use the new sentence guidance');
 if(c.input.commentText.trim()) assert.ok(captured.system.some((b:any)=>b.text.includes('Treat emoji as emotional context for the written comment.')),'Actual text requests use the new emoji-intent guidance');
 const canonical=JSON.stringify(originalRequest,(_key,value)=>typeof value==='string'?value.replace(/\r\n/g,'\n').replace(COVERAGE_NOTE,recordedCoverageNote).replace(currentVoice,recordedVoice).replace(currentGifVoice,recordedGifVoice).replace(currentMediaNote,recordedMediaNote):value);
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
