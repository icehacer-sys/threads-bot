import assert from 'node:assert/strict';
process.env.ANTHROPIC_API_KEY='offline-fixture';
process.env.BOT_USAGE_LOG='off';
process.env.BOT_WEB_SEARCH='off';
const {replyCoverage,isRetiredGuessReceipt}=await import('../src/reply-coverage');
const {unsupportedPatientHistory}=await import('../src/case-evidence');
const {classifyAndDraft}=await import('../src/reply');
const {resolveXrayAnswer}=await import('../src/xray');
const c=(id:string,user:string,parent:string)=>({id,username:user,replied_to:{id:parent},text:id});
const comments=[c('a','alice','post'),c('b','me','a'),c('a2','alice','b'),c('a3','alice','b'),c('new','bob','b'),c('nested','carol','a'),c('answer','me','post'),c('under','alice','answer'),c('thanks','alice','b'),c('a-new','alice','post'),c('cycle1','alice','cycle2'),c('cycle2','me','cycle1'),c('orphan','alice','absent')];
const persisted=new Set<string>();
const coverage=replyCoverage('post','me',comments,id=>persisted.has(id),2);
assert.equal(coverage.canReply('a'),false,'live reply dedup');
assert.equal(coverage.count('a2'),1);
assert.equal(coverage.canReply('a2'),true);
persisted.add('a2');
assert.equal(coverage.canReply('a3'),false,'persisted reply closes sibling branches before API catches up');
assert.equal(coverage.canReply('thanks'),false,'no third bot turn even for thanks');
assert.equal(coverage.canReply('new'),true,'new participant is not silenced by another participant');
assert.equal(coverage.canReply('nested'),true,'nested audience comment is included');
assert.equal(coverage.count('under'),0,'pinned answer starts a separate audience thread');
assert.equal(coverage.canReply('a-new'),true,'a separate original comment has its own allowance');
coverage.markReplied('nested');assert.equal(coverage.canReply('nested'),false,'dry-run and live receipt dedup');
assert.equal(coverage.canReply('cycle1'),false);assert.equal(coverage.canReply('orphan'),false);
for(const draft of ['Newborn kneecaps are cartilage.','Cartilage at this age so it is invisible here.','Caught at birth like this one was gives them the best chance.','They could not walk on it.']) assert.equal(unsupportedPatientHistory(draft,'A knee that looked wrong from birth.'),true);
assert.equal(unsupportedPatientHistory('The patient is a newborn.','A newborn with a knee deformity.'),false);
assert.equal(unsupportedPatientHistory('The caption does not state the age.','A knee that looked wrong from birth.'),false);

const base={intent:'friendly reaction',decision:'reply',category:'banter',reply_text:'That was a rough one.',reason:'acknowledge reaction',needs_lookup:false,promo_product:'none',promo_explicit:false};
let queue:any[]=[];let calls=0;let body:any;
globalThis.fetch=async (_url,init)=>{
 calls++;body=JSON.parse(String(init?.body));const next=queue.shift();assert.ok(next,'unexpected extra model call');
 return new Response(JSON.stringify({id:'fixture',type:'message',role:'assistant',model:'fixture',stop_reason:'tool_use',usage:{input_tokens:1,output_tokens:1},content:[{type:'tool_use',id:'tool',name:'submit_reply',input:next}]}),{headers:{'content-type':'application/json'}});
};
const input={postText:'A knee that looked wrong from birth.',commentText:'😮',answer:'Congenital knee dislocation',answerPublic:true,replyAll:true};
queue=[{...base,decision:'skip',category:'other',reply_text:'',reason:'A lone emoji with no substantive content'},base];calls=0;
assert.equal((await classifyAndDraft(input)).decision,'reply');assert.equal(calls,2);assert.match(JSON.stringify(body),/OWNER COVERAGE POLICY/);
for(const secret of ['Congenital knee dislocation','An unrelated diagnosis']) {
 queue=[{...base,intent:'diagnosis guess',category:'affirm',reply_text:'Exactly right!'},{...base,intent:'diagnosis guess',reply_text:'Give that shoulder another look before you settle on it.'}];calls=0;
 const result=await classifyAndDraft({...input,answer:secret,answerPublic:false,commentText:'Dislocation?'});
 assert.equal(result.reply_text,'Give that shoulder another look before you settle on it.');assert.equal(calls,2);
 assert.equal(isRetiredGuessReceipt(result.reply_text),false);assert.equal(JSON.stringify(body).includes(secret),false,'secret answer is not sent before reveal');
}
queue=[{...base,intent:'diagnosis guess',decision:'skip',reply_text:'',reason:'Diagnosis guess before reveal'},base];
assert.equal((await classifyAndDraft({...input,answerPublic:false})).reply_text,base.reply_text);
for(const text of ['Thanks for putting a guess in.','Your guess is in.','Got your guess.','Thanks for having a go.','Thanks for taking a shot at it.','Thanks for joining the challenge.']) {
 assert.equal(isRetiredGuessReceipt(text),true);
 queue=[{...base,reply_text:text},base];calls=0;assert.equal((await classifyAndDraft(input)).reply_text,base.reply_text);assert.equal(calls,2);
}
queue=[{...base,reply_text:'Your guess is in.'},{...base,reply_text:'Got your guess.'}];calls=0;
assert.equal((await classifyAndDraft(input)).decision,'skip');assert.equal(calls,2,'receipt repair is bounded');
for(const [comment,text] of [['Silly Putty Shoulder.','Please keep it off the carpet.'],['A slice of pepperoni pizza on the x-ray table?','Radiology is getting very close to a lunch break.'],['His shoulder turned into a boulder.','Carrying the weight of the world a little too literally.']]) {
 queue=[{...base,intent:'fictional diagnosis guess used as a joke',reply_text:text}];calls=0;
 assert.equal((await classifyAndDraft({...input,commentText:comment,answerPublic:false})).reply_text,text);assert.equal(calls,1,'joke draft must not be replaced with a receipt');
}
queue=[{...base,category:'correct',reply_text:'The teaching answer is chondrosarcoma with rings and arcs of calcium in the mass.'}];calls=0;
assert.equal((await classifyAndDraft({...input,commentText:'Osteosarcoma?',answer:'Chondrosarcoma',facts:['Rings and arcs of calcium in a mass.']})).category,'correct');assert.equal(calls,1,'public-answer correction remains available');
queue=[{...base,category:'affirm',reply_text:'Nailed it.'},{...base,category:'affirm',reply_text:'Chondrosarcoma is the teaching answer here.'}];calls=0;
assert.equal((await classifyAndDraft({...input,answer:'Chondrosarcoma',commentText:'Chondrosarcoma?'})).reply_text,'Chondrosarcoma is the teaching answer here.');assert.equal(calls,2);
queue=[{...base,intent:'diagnosis guess',decision:'skip',reply_text:'',reason:'owner review: image-dependent reply paused'}];
assert.equal((await classifyAndDraft({...input,answerPublic:false,imageReviewPending:true})).decision,'skip');
queue=[{...base,category:'teach',reply_text:'The patient is a newborn.'},{...base,category:'teach',reply_text:'The caption does not state the age.'}];calls=0;
assert.equal((await classifyAndDraft({...input,commentText:'What is the age?'})).reply_text,'The caption does not state the age.');assert.equal(calls,2);
queue=[{...base,category:'teach',reply_text:'The patient is a newborn.'},{...base,category:'teach',reply_text:'The patient is a newborn.'}];calls=0;
assert.equal((await classifyAndDraft({...input,commentText:'What is the age?'})).decision,'skip');assert.equal(calls,2);
queue=[base];calls=0;assert.equal((await classifyAndDraft({...input,commentText:'شكراً'})).decision,'reply');assert.equal(calls,1,'coverage does not discard non-Latin comments');
queue=[];calls=0;assert.equal((await classifyAndDraft({...input,commentText:'Are you a bot?'})).decision,'skip');assert.equal(calls,0);

globalThis.fetch=async url=>new Response(JSON.stringify(String(url).endsWith('/state.json') ? {stages:{fixture:{threadsPostId:'post'}}} : {diagnosis:'Knee dislocation',whatYouSee:'Tibial displacement',whyItMatters:'Needs assessment',treatment:'Specialist care',takeaway:'A newborn mnemonic'}));
const bridged=await resolveXrayAnswer('post');assert.deepEqual(bridged?.facts,['Tibial displacement','Needs assessment','Specialist care']);
console.log('PASS coverage, participant limits, sibling races, receipts, nested/answer comments, bounded repair, private-answer independence, holds, age evidence and mnemonic exclusion');
