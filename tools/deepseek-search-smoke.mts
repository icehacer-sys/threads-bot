// Owner-approved ONE-request DeepSeek native web search smoke test (2026-10-01).
// 1) Builds the bot's real production search request offline (actual classifier, synthetic
//    comment, no real user content, every network call intercepted).
// 2) Sends it ONCE to deepseek-flash: max_uses lowered 3 -> 1, thinking disabled, no SDK
//    retries, 90 s timeout. No continuation call, no publication, no state.
// 3) Prints the response shape, citations, usage and a peak-rate token cost. Search billing is
//    reported as observed; DeepSeek does not document a per-search price or summarization cap.
import Anthropic from '@anthropic-ai/sdk';

const realFetch = globalThis.fetch;
let captured: Record<string, any> | undefined;
globalThis.fetch = async (_url, init) => {
  captured = JSON.parse(String(init?.body));
  return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'capture only' } }), { status: 400, headers: { 'content-type': 'application/json' } });
};
process.env.ANTHROPIC_API_KEY ||= 'capture-only';
const { config } = await import('../src/config');
Object.assign(config, { deepSeekTrial: false, webSearch: true, gifReplies: false, voiceVariant: 'lean' });
const { classifyAndDraft } = await import('../src/reply');
await classifyAndDraft({
  postText: 'Synthetic teaching case: an abdominal X-ray with a large mottled mass.',
  commentText: process.env.SMOKE_COMMENT || 'Is this related to the "Rapunzel syndrome" case that was in the news? What exactly is that?',
  answerPublic: true, replyAll: true, modelOverride: config.model, allowSearch: true,
} as Parameters<typeof classifyAndDraft>[0]);
globalThis.fetch = realFetch;
if (!captured) throw Error('No production request was built');
const search = captured.tools?.find((t: any) => t.type === 'web_search_20250305');
if (!search || captured.tool_choice?.type !== 'auto') throw Error('Captured request is not the production search contract');
console.log(`Captured production request: tools=${captured.tools.map((t: any) => t.name).join(',')} max_uses=${search.max_uses} tool_choice=${captured.tool_choice.type}`);

const { output_config: _effort, ...body } = captured;
const request = { ...body, model: 'deepseek-flash', thinking: { type: 'disabled' },
  tools: captured.tools.map((t: any) => t.type === 'web_search_20250305' ? { ...t, max_uses: 1 } : t) };
const key = process.env.DEEPSEEK_API_KEY;
if (!key) throw Error('DEEPSEEK_API_KEY missing');
const client = new Anthropic({ apiKey: key, authToken: null, baseURL: 'https://api.deepseek.com/anthropic', maxRetries: 0, timeout: 90_000 });
const started = Date.now();
let response: any;
try {
  response = await client.messages.create(request as never);
} catch (err: any) {
  console.log(JSON.stringify({ outcome: 'error', ms: Date.now() - started, status: err?.status ?? null, type: err?.error?.error?.type ?? err?.name, message: String(err?.message ?? err).slice(0, 300) }));
  process.exit(0);
}
const blocks = (response?.content ?? []) as any[];
const results = blocks.filter(b => b.type === 'web_search_tool_result');
const citations = blocks.flatMap(b => (b.citations ?? []) as any[]);
const u = response?.usage ?? {};
const tokenUsd = ((u.input_tokens ?? 0) * 0.30 + (u.cache_read_input_tokens ?? 0) * 0.006 + (u.output_tokens ?? 0) * 1.20) / 1_000_000;
console.log(JSON.stringify({
  outcome: 'response', ms: Date.now() - started, model: response?.model, stop_reason: response?.stop_reason,
  blockTypes: blocks.map(b => b.type),
  searchQueries: blocks.filter(b => b.type === 'server_tool_use').map(b => b.input?.query),
  searchResults: results.map(r => Array.isArray(r.content) ? { count: r.content.length, sample: r.content.slice(0, 3).map((x: any) => ({ title: x.title, url: x.url, age: x.page_age })) } : { error: r.content?.error_code ?? r.content }),
  citations: citations.length, citationSample: citations.slice(0, 2).map(c => ({ type: c.type, url: c.url, title: c.title })),
  submitReply: blocks.filter(b => b.type === 'tool_use').map(b => ({ name: b.name, decision: b.input?.decision, category: b.input?.category, reply_text: b.input?.reply_text })),
  text: blocks.filter(b => b.type === 'text').map(b => String(b.text).slice(0, 400)),
  usage: u, peakTokenUsdExcludingSearchFees: Number(tokenUsd.toFixed(6)),
}, null, 1));
