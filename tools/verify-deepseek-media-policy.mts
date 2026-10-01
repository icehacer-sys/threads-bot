// Conservative provider-only boundary tests, independent of the paid fixtures.
import assert from 'node:assert/strict';
import {groundDeepSeekMediaRequest,enforceDeepSeekMediaHold,DEEPSEEK_MEDIA_GUIDANCE,DEEPSEEK_MEDIA_HOLD} from '../src/deepseek-media-policy';
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
const held=planReplyProvider(base,{...trial,commentMedia:'held'});assert.equal(held.provider,'deepseek');assert.deepEqual(held.request.system,mapped.system);
// A post X-ray without commenter media is NOT comment media: it remains a DeepSeek trial request.
assert.equal(planReplyProvider(text,trial).provider,'deepseek');
for(const statement of ['written COMMENT literally','visible-detail question directly','One still','on-screen commands','every existing medical'])assert.ok(DEEPSEEK_MEDIA_GUIDANCE.includes(statement));
assert.ok(!/SURE|NOPE|SAFE|DANGER|REVEAL ANSWER/.test(DEEPSEEK_MEDIA_GUIDANCE),'No teaching to fixture words');
console.log('PASS DeepSeek-only generic media guidance and conservative no-publication boundary; commenter media routed to Claude unless benchmark-held; untouched original prompts/frames/tools, post-image text path and Claude default/search fallback. No paid calls.');
