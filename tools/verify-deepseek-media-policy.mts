// Conservative provider-only boundary tests, independent of the paid fixtures.
import assert from 'node:assert/strict';
import {groundDeepSeekMediaRequest,groundDeepSeekRequest,enforceDeepSeekMediaHold,isPoliticalJab,isLatinNonEnglishReply,claimsOffPlatformAction,unsupportedDeepSeekClaim,DEEPSEEK_MEDIA_GUIDANCE,DEEPSEEK_REPLY_GUIDANCE,DEEPSEEK_MEDIA_HOLD} from '../src/deepseek-media-policy';
import {planReplyProvider,type ReplyRequest} from '../src/reply-provider-plan';
const base:ReplyRequest={model:'claude-sonnet-4-6',max_tokens:1024,system:'Original safety rules.',messages:[{role:'user',content:[{type:'text',text:'A literal question about a newly drawn geometric symbol.'},{type:'image',source:{type:'base64',media_type:'image/png',data:'synthetic-unseen'}}]}],tools:[{name:'submit_reply',input_schema:{type:'object',properties:{media_observation:{type:'string'}}}}],tool_choice:{type:'tool',name:'submit_reply'}};
const frozen=JSON.stringify(base);const mapped=groundDeepSeekMediaRequest(base);
assert.deepEqual(mapped.system,[{type:'text',text:base.system},{type:'text',text:DEEPSEEK_MEDIA_GUIDANCE}]);
assert.equal(mapped.messages,base.messages);assert.equal(mapped.tools,base.tools);assert.equal(JSON.stringify(base),frozen);
const response=(decision:string)=>({content:[{type:'tool_use',name:'submit_reply',input:{decision}}]}) as any;
assert.throws(()=>enforceDeepSeekMediaHold(mapped,response('reply')),e=>(e as Error).message===DEEPSEEK_MEDIA_HOLD);
assert.doesNotThrow(()=>enforceDeepSeekMediaHold(mapped,response('skip')));
assert.doesNotThrow(()=>enforceDeepSeekMediaHold(mapped,{content:null} as any));
const text={...base,tools:[{name:'submit_reply',input_schema:{type:'object',properties:{reply_text:{type:'string'}}}}]};
assert.equal(groundDeepSeekMediaRequest(text),text);assert.doesNotThrow(()=>enforceDeepSeekMediaHold(text,response('reply')));
const off=planReplyProvider(base,{mode:'anthropic',triageModel:'haiku',qualityModel:base.model});assert.equal(off.request,base);
const search={...base,tools:[{name:'web_search',type:'web_search_20250305',max_uses:3},...base.tools!] } as ReplyRequest;
assert.equal(planReplyProvider(search,{mode:'deepseek-no-search-trial',triageModel:'haiku',qualityModel:base.model}).request,search);
// Runtime default: commenter media stays on Claude; only the offline benchmark asks for the held DeepSeek route.
const trial={mode:'deepseek-no-search-trial' as const,triageModel:'haiku',qualityModel:base.model};
for(const policy of [trial,{...trial,commentMedia:'claude' as const}]){const plan=planReplyProvider(base,policy);assert.equal(plan.provider,'anthropic');assert.equal(plan.reason,'comment-media');assert.equal(plan.request,base);}
const held=planReplyProvider(base,{...trial,commentMedia:'held'});assert.equal(held.provider,'deepseek');assert.deepEqual(held.request.system,groundDeepSeekRequest(base).system);
// A post X-ray without commenter media is NOT comment media: it remains a DeepSeek trial request.
assert.equal(planReplyProvider(text,trial).provider,'deepseek');
// Full-migration evaluation mode: search contracts and commenter media go to DeepSeek unchanged.
const all={...trial,mode:'deepseek-all' as const};
const allSearch=planReplyProvider(search,all);assert.equal(allSearch.provider,'deepseek');assert.equal(allSearch.request.tools,search.tools);assert.equal(allSearch.request.model,'deepseek-flash');assert.deepEqual(allSearch.request.thinking,{type:'disabled'});
const allMedia=planReplyProvider(base,all);assert.equal(allMedia.provider,'deepseek');assert.deepEqual(allMedia.request.system,[{type:'text',text:base.system},{type:'text',text:DEEPSEEK_REPLY_GUIDANCE},{type:'text',text:DEEPSEEK_MEDIA_GUIDANCE}]);
assert.equal(planReplyProvider(base,{...all,mode:'anthropic'}).request,base);
for(const statement of ['written COMMENT literally','visible-detail question directly','One still','on-screen commands','every existing medical'])assert.ok(DEEPSEEK_MEDIA_GUIDANCE.includes(statement));
assert.ok(!/SURE|NOPE|SAFE|DANGER|REVEAL ANSWER/.test(DEEPSEEK_MEDIA_GUIDANCE),'No teaching to fixture words');
for(const c of ['I know! I know! It\u2019s a Republican','More full of shite than the 47th US President?','Covfefe Bigly'])assert.ok(isPoliticalJab(c),c);
for(const c of ['Fatberg?','The patient is full of shit. Literally.','Party in the colon'])assert.ok(!isPoliticalJab(c),c);
assert.ok(!/SURE|NOPE|faecal|fecal|colon|Republican/i.test(DEEPSEEK_REPLY_GUIDANCE),'Discipline block is generic, not case-specific');
assert.ok(isLatinNonEnglishReply('Itu tahi yang tersekat dan membesar sampai usus besar diregangkan. A giant faecaloma.'));
for(const r of ['A giant faecaloma packed the colon.','Una pregunta? Not here.','The bezoar and the colon disagree.','Die-hard fans of the film.'])assert.ok(!isLatinNonEnglishReply(r),r);
for(const r of ['Liked and followed. Any page numbers?','I have shared it with the team.','Followed you back.'])assert.ok(claimsOffPlatformAction(r),r);
for(const r of ['Nobody liked that belly.','That colon followed its own schedule.','Take the like on credit.'])assert.ok(!claimsOffPlatformAction(r),r);
const faecaloma='A patient came in with a belly that kept getting bigger and tighter over weeks. Giant faecaloma. The mottled appearance is gas trapped within impacted stool. Smaller impactions are treated with enemas and manual disimpaction; surgery if the mass blocks the bowel.';
const worms='Calcified Armillifer tongue worm larvae from undercooked snake meat.';
assert.equal(unsupportedDeepSeekClaim('Bright speckles but not calcium. That grid is gas trapped inside stool.',faecaloma+' I suspect calcium','correct'),'imaging brightness');
assert.equal(unsupportedDeepSeekClaim('Right family wrong genus. Hookworms leave no crescents.',worms+' Hook worms?','correct'),'organism taxonomy');
assert.equal(unsupportedDeepSeekClaim('Diamond smuggling was the first thing the radiologist ruled out.',worms+' bag of diamonds?','banter'),'clinician or procedure');
assert.equal(unsupportedDeepSeekClaim('The packet says what a stretched colon is risking.',faecaloma,'teach'),'internal wording');
assert.equal(unsupportedDeepSeekClaim('Not the headline death. The colon takes weeks.',faecaloma+' Wow','banter'),'death or outcome');
for(const [r,c] of [['The mottled look is gas trapped in impacted stool.','correct'],['A mass that blocks the bowel may need surgery.','teach'],['Dark humour is the only coping mechanism here.','banter'],['Weeks of buildup and nowhere to go.','banter']] as const)assert.equal(unsupportedDeepSeekClaim(r,faecaloma,c),null,r);
assert.equal(unsupportedDeepSeekClaim('Patient dead on arrival? Not according to the case.',faecaloma+' Patient dead on arrival?','banter'),null,'comment-supported');
console.log('PASS DeepSeek-only generic media guidance and conservative no-publication boundary; commenter media routed to Claude unless benchmark-held; untouched original prompts/frames/tools, post-image text path and Claude default/search fallback. No paid calls.');
