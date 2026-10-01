// Zero-cost fixtures prove serialization/fallback contracts only, NEVER native search execution.
import assert from 'node:assert/strict';
process.env.ANTHROPIC_API_KEY='synthetic-claude';process.env.DEEPSEEK_API_KEY='synthetic-deepseek';
delete process.env.ANTHROPIC_AUTH_TOKEN;
let handler:typeof fetch=async()=>{throw Error('Unexpected HTTP');};globalThis.fetch=(...args)=>handler(...args);
const {config}=await import('../src/config');const {classifyAndDraft}=await import('../src/reply');
const {createDeepSeekReplyClient}=await import('../src/deepseek-reply-client');
Object.assign(config,{deepSeekTrial:true,webSearch:true,gifReplies:false,voiceVariant:'lean'});
const input={postText:'A synthetic teaching puzzle.',commentText:'What does this unfamiliar fictional term mean?',answer:'Synthetic answer',answerPublic:true,replyAll:true,modelOverride:config.model,allowSearch:true,learnedNotesOverride:''};
const usage={input_tokens:10,output_tokens:20,cache_creation_input_tokens:0,cache_read_input_tokens:0,server_tool_use:{web_search_requests:1}};
const verdict={intent:'Synthetic reference',decision:'reply',category:'banter',reply_text:'That is a fictional term in this example.',reason:'Synthetic only',needs_lookup:false,promo_product:'none',promo_explicit:false};
const submit=(model:string)=>({id:'synthetic',type:'message',role:'assistant',model,usage,stop_reason:'tool_use',content:[{type:'tool_use',id:'submit',name:'submit_reply',input:verdict}]});
let captured:any;
for(const scenario of ['source-citation','empty','error-max-uses','error-unavailable','pause-turn','truncated','quota']){
 const requests:any[]=[];let initial:any;
 handler=async(url,init)=>{
  assert.equal(new URL(String(url)).hostname,'api.anthropic.com','Search remains explicitly Claude-owned');
  const body=JSON.parse(String(init?.body));requests.push(body);
  assert.equal(body.tools[0].type,'web_search_20250305');assert.equal(body.tools[0].max_uses,3);
  if(scenario==='quota')return new Response(JSON.stringify({type:'error',error:{type:'rate_limit_error',message:'Synthetic quota'}}),{status:429,headers:{'content-type':'application/json','retry-after':'0'}});
  let response:any=submit(body.model);
  if(requests.length===1){
   const result=scenario==='empty'?[]:scenario.startsWith('error')?{type:'web_search_tool_result_error',error_code:scenario==='error-max-uses'?'max_uses_exceeded':'unavailable'}:[{type:'web_search_result',url:'https://fixture.invalid/source',title:'Synthetic source; not freshly retrieved',encrypted_content:'synthetic'}];
   response={...response,stop_reason:scenario==='truncated'?'max_tokens':scenario==='pause-turn'?'pause_turn':'end_turn',content:[{type:'server_tool_use',id:'search-1',name:'web_search',input:{query:'synthetic'}},{type:'web_search_tool_result',tool_use_id:'search-1',content:result}]};
   if(scenario==='source-citation')response.content.push({type:'text',text:'Synthetic cited text.',citations:[{type:'web_search_result_location',url:'https://fixture.invalid/source',title:'Synthetic source',encrypted_index:'synthetic',cited_text:'Synthetic cited text.'}]});
   initial=response;captured??=body;
  }else{assert.deepEqual(body.tool_choice,{type:'tool',name:'submit_reply'});assert.deepEqual(body.messages[1].content,initial.content,'Exact server blocks/citations/errors retained');}
  return new Response(JSON.stringify(response),{headers:{'content-type':'application/json'}});
 };
 const result=await classifyAndDraft(input);
 assert.equal(requests.length,scenario==='quota'?3:scenario==='truncated'?1:2,scenario);
 if(scenario==='quota'||scenario==='truncated')assert.equal(result.decision,'skip');
 console.log(`PASS offline search ${scenario}: ${requests.length} physical HTTP mocks; exact payload and final-submit sequencing.`);
}
// Direct SDK boundary accepts serialization of the EXACT production search contract.
// A fake HTTP 200 cannot establish that DeepSeek executes it, honours max_uses, or bills it.
const {output_config:_effort,...rest}=captured;const expected={...rest,model:'deepseek-flash',thinking:{type:'disabled'}};
let nativeCalls=0;
const client=createDeepSeekReplyClient('synthetic-only',async(url,init)=>{nativeCalls++;assert.equal(String(url),'https://api.deepseek.com/anthropic/v1/messages');assert.deepEqual(JSON.parse(String(init?.body)),expected);return new Response(JSON.stringify(submit('deepseek-flash')),{headers:{'content-type':'application/json'}});});
await client.messages.create(expected);assert.equal(nativeCalls,1);
console.log('PASS native-compatible SDK serialization boundary ONLY. Native fresh retrieval, citations, errors, max-use enforcement and internal billing NOT VERIFIED. No paid calls.');
