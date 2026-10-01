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
const {DEEPSEEK_MEDIA_GUIDANCE,DEEPSEEK_MEDIA_HOLD}=await import('../src/deepseek-media-policy');
let roundedTotal=0;
for(const c of [...pack.cases,...recheck.cases]){active=c;const before=attempts;const result=await classifyAndDraft(c.input);assert.equal(attempts-before,1);
 assert.equal(capturedUrl,'https://api.deepseek.com/anthropic/v1/messages');
 // Files loaded into system prompts use CRLF on Windows and LF in Linux checkout.
 // Preserve the paid raw hash in the fixture; normalize ONLY string line endings
 // for this cross-platform full-request hash. Every other field/byte is included.
 assert.equal(captured.system.at(-1).text,DEEPSEEK_MEDIA_GUIDANCE);
 const originalRequest=c.guidancePresentInNativeRequest?captured:{...captured,system:captured.system.slice(0,-1)};
 const canonical=JSON.stringify(originalRequest,(_key,value)=>typeof value==='string'?value.replace(/\r\n/g,'\n'):value);
 assert.equal(hash(canonical),c.normalizedRequestHash,'Full native request parity apart from checkout line endings');
 assert.deepEqual(captured.messages.flatMap((m:any)=>m.content.filter((b:any)=>b.type==='image')).map((b:any)=>hash(Buffer.from(b.source.data,'base64') as any)),c.frameHashes);
 assert.deepEqual(JSON.parse(JSON.stringify(result)),c.final.decision==='reply'?{decision:'skip',category:'other',reply_text:'',reason:`error: ${DEEPSEEK_MEDIA_HOLD}`}:c.final);const spend=drainSpend();assert.equal(spend.calls,1);assert.equal(Math.ceil(spend.usd*1e6),c.costMicroUsd);roundedTotal+=c.costMicroUsd;
 assert.ok(!result.reply_text.includes(c.input.answer),'No private disclosure');
 if(c.id==='unreadable'){assert.equal(result.media_clear,false);assert.equal(result.decision,'skip');}
 if(c.id==='written-gif'){assert.equal(c.final.media_text,'SURE WAIT NOPE NOPE');assert.match(c.final.media_observation,/zooming/,'Preserve evidence of unsupported native claim, not a fabricated passing oracle');}
 if(c.id==='early-frame-control'){assert.equal(c.final.media_text,'SURE');assert.match(c.final.intent,/skeptical/,'Known intent error is a quality limitation');}
 console.log(`PASS saved native replay ${c.id}: full request hash with line endings normalized, exact frame hashes, final guard result, usage-derived cost. Quality conclusions remain separate.`);
}
assert.equal(roundedTotal,7621);console.log('PASS seven saved native media trajectories replayed offline; proposed media replies stopped after known accounting, safe skips retained; no paid calls.');
