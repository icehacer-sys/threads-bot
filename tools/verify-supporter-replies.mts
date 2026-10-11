import assert from 'node:assert/strict';
process.env.ANTHROPIC_API_KEY='offline-fixture';
process.env.BOT_WEB_SEARCH='off';
process.env.BOT_USAGE_LOG='off';
const {isPriorityCommenter,isLowEngagementSkip,conversationReplyIssue}=await import('../src/supporter-replies');
const {classifyAndDraft,isPreRevealHold}=await import('../src/reply');
const {config}=await import('../src/config');
for(const name of ['tgeorgekoshy','ruth.werner.9','@RUTH.WERNER.9']) assert.equal(isPriorityCommenter(name,config.priorityUsernames),true);
for(const name of [undefined,'ruth.werner.9.fake','other']) assert.equal(isPriorityCommenter(name,config.priorityUsernames),false);
assert.equal(isLowEngagementSkip('skip','other','A lone emoji with no substantive content'),true);
for(const reason of ['diagnosis before reveal','owner response required','unclear GIF meaning','error: timeout','spam','non-English','guard:forced-skip']) assert.equal(isLowEngagementSkip('skip','other',reason),false);
assert.equal(conversationReplyIssue('It almost looks parasitic','banter','This one is self-inflicted dust doing its work.',true),'unsupported blame or patient motivation');
assert.equal(conversationReplyIssue('Inhaled talcum powder as a baby.','empathize',"That's a worrying start for your lungs.",true),'assumed personal medical history');
assert.equal(conversationReplyIssue('I inhaled powder as a baby.','empathize','That sounds like a frightening experience.',true),undefined);
assert.equal(conversationReplyIssue('Mold','correct','Fungal infections can produce nodular patterns but the upper-lobe conglomerate masses and calcified hilar nodes here point toward progressive massive fibrosis from long-term dust exposure rather than mold.',true),'overlong response to a short guess');

const emojiCommentary = [
 ['DES. 😦','You skipped straight to the abbreviation and that face says you already know the twist.'],
 ['Wow 😮','That face says you were not expecting this.'],
 ['LMAOOOOO','Laughing is the correct response to a chest that decided to be a corkscrew.'],
 ['A cautionary childhood story.','Two of those laugh emojis and the oesophagus is still going.'],
 ['DES. 😦','The reaction is fair.'],
];
for (const [comment,draft] of emojiCommentary) assert.match(conversationReplyIssue(comment,'banter',draft,true) ?? '',/emoji commentary/);
assert.match(conversationReplyIssue('Dracunculus medinensis','affirm','You went straight to the Latin name.',true) ?? '',/comment wording/);
for (const [comment,category,draft] of [
 ['DES. 😦','affirm',"That's the one."],
 ['Wow 😮','banter','That took me by surprise too.'],
 ['What does 😦 mean?','teach','That emoji usually expresses surprise.'],
 ['What does that emoji mean?','teach','That emoji usually expresses surprise.'],
 ['What does DES mean? 😦','teach','DES stands for diffuse oesophageal spasm.'],
 ['Why is the face swollen?','teach','The case does not state the cause of the facial swelling.'],
 ['I had an allergic reaction. 😦','empathize','That sounds like a frightening experience.'],
]) assert.equal(conversationReplyIssue(comment,category,draft,true),undefined,`preserve a meaningful reply: ${comment}`);

const base={intent:'friendly reaction',decision:'reply',category:'banter',reply_text:'That one was rough to look at.',reason:'acknowledge their reaction',needs_lookup:false,promo_product:'none',promo_explicit:false};
let queue:any[]=[];let calls=0;let body:any;
globalThis.fetch=async (_url,init)=>{
 calls++;body=JSON.parse(String(init?.body));const next=queue.shift();assert.ok(next,'unexpected extra paid call');
 return new Response(JSON.stringify({id:'fixture',type:'message',role:'assistant',model:config.triageModel,stop_reason:'tool_use',usage:{input_tokens:1,output_tokens:1},content:[{type:'tool_use',id:'tool',name:'submit_reply',input:next}]}),{headers:{'content-type':'application/json'}});
};
const input={postText:'Diagnosis challenge',commentText:'Wow 😮',answer:'Progressive massive fibrosis',answerPublic:true,priorityCommenter:true,modelOverride:config.triageModel};
const emojiInput={...input,commentText:'DES. 😦',answer:'Diffuse oesophageal spasm'};
const narrated={...base,reply_text:emojiCommentary[0][1]};
const natural={...base,category:'affirm',reply_text:"That's the one."};
queue=[narrated,natural];calls=0;
assert.equal((await classifyAndDraft(emojiInput)).reply_text,natural.reply_text);
assert.equal(calls,2,'emoji commentary gets only one rewrite');
assert.match(JSON.stringify(body),/without describing the emoji or reaction/);
queue=[narrated,narrated];calls=0;
const repeatedNarration=await classifyAndDraft(emojiInput);
assert.equal(repeatedNarration.decision,'skip');assert.equal(repeatedNarration.reply_text,'');assert.equal(calls,2);
queue=[natural];calls=0;
assert.equal((await classifyAndDraft(emojiInput)).reply_text,natural.reply_text);assert.equal(calls,1,'text plus emoji remains eligible');
queue=[{...base,reply_text:'The film has another surprise for you.'}];calls=0;
const privateReaction=await classifyAndDraft({...emojiInput,answerPublic:false,replyAll:true});
assert.equal(privateReaction.decision,'reply');assert.equal(calls,1);assert.ok(!JSON.stringify(body).includes(emojiInput.answer),'no private answer sent for a text-plus-emoji comment');
queue=[natural];calls=0;
assert.equal((await classifyAndDraft({...emojiInput,answerPublic:false})).decision,'skip');assert.equal(calls,1,'emoji policy does not permit grading a private guess');
console.log('PASS audited emoji narration, shorthand commentary, direct symbol questions, natural text-plus-emoji replies and bounded rewrite with reveal safeguards');
queue=[base];calls=0;
assert.equal((await classifyAndDraft(input)).decision,'reply');assert.equal(calls,1);
assert.match(JSON.stringify(body),/OWNER REPLY PRIORITY/);
const low={...base,decision:'skip',category:'other',reply_text:'',reason:'A short reaction with no substantive content'};
for(const reason of ['The reveal is private. All diagnosis guesses are held.', 'Diagnosis guess made before the answer is publicly revealed.', 'Diagnosis guess submitted before public reveal.']) {
 assert.equal(isPreRevealHold({...low,reason} as any,false),true);
 assert.equal(isPreRevealHold({...low,reason} as any,true),false);
}
assert.equal(isPreRevealHold(low as any,false),false);
queue=[low,base];calls=0;assert.equal((await classifyAndDraft(input)).decision,'reply');assert.equal(calls,2);
queue=[low,low];calls=0;const held=await classifyAndDraft(input);assert.equal(held.decision,'skip');assert.equal(held.category,'other');assert.equal(calls,2);
queue=[low];calls=0;await classifyAndDraft({...input,priorityCommenter:false});assert.equal(calls,1);assert.ok(!JSON.stringify(body).includes('OWNER REPLY PRIORITY'));
queue=[{...base,category:'affirm',reply_text:"That's the one."}];calls=0;
assert.equal((await classifyAndDraft({...input,commentText:'Progressive massive fibrosis?',answerPublic:false})).decision,'skip');assert.equal(calls,1);
queue=[];calls=0;assert.equal((await classifyAndDraft({...input,commentText:'Are you a bot?'})).decision,'skip');assert.equal(calls,0);
queue=[{...base,category:'personal_medical',reply_text:'You should get a scan.'}];
assert.equal((await classifyAndDraft({...input,commentText:'My child is drooling. Should I get an X-ray?'})).category,'personal_medical');assert.equal(calls,1);
queue=[{...base,reply_text:"That's a worrying start for your lungs."},{...base,reply_text:'The case points to a different kind of dust exposure.'}];calls=0;
assert.equal((await classifyAndDraft({...input,commentText:'Inhaled talcum powder as a baby.'})).decision,'reply');assert.equal(calls,2);
queue=[{...base,reply_text:'This was self-inflicted.'},{...base,reply_text:'This was self-inflicted.'}];calls=0;
assert.equal((await classifyAndDraft({...input,commentText:'It almost looks parasitic'})).decision,'skip');assert.equal(calls,2);
console.log('PASS exact supporter matching, priority prompt, one shared repair, cached failures, reveal/advice/operator safeguards and September 20 reply regressions');
const timeline={...base,category:'teach',reply_text:'The caption describes decades of worsening breathlessness.'};
queue=[timeline];calls=0;
assert.equal((await classifyAndDraft({...input,postText:'A patient came in with decades of worsening breathlessness.',commentText:'How long had the symptoms been worsening?'})).decision,'reply');
assert.equal(calls,1,'the public caption is evidence for its own timeline');
queue=[timeline,timeline];calls=0;
assert.equal((await classifyAndDraft({...input,commentText:'How long had the symptoms been worsening?'})).decision,'skip');
assert.equal(calls,2,'an unsupported duration is still blocked');
console.log('PASS caption-supported duration accepted without retries; invented duration remains blocked');
