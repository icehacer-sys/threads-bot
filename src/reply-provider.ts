import Anthropic from '@anthropic-ai/sdk';
import { config, requireEnv } from './config';
import { createProviderObservation, observedReplyFetch, observeReplyUsage, replyProviderSnapshot } from './provider-observation';
import { recordPricedCall, recordUsage } from './spend';
import { createDeepSeekReplyClient, deepSeekSearchCost, deepSeekTokenCost } from './deepseek-reply-client';
import { planReplyProvider, type ReplyProviderMode, type ReplyRequest } from './reply-provider-plan';
import { enforceDeepSeekMediaHold } from './deepseek-media-policy';

let claude: Anthropic | null = null;
let deepseek: Anthropic | null = null;
let halted = false;
let tripPending = false;
let deepSeekAll = false;
let disclosed = false;
let fallbackDisclosed = false;
let deepSeekAuthFailed = false;
const deepSeekObservation = createProviderObservation();
const UNCERTAIN_FLASH_CALL_USD = 0.35; // 1M context + 1024 output at verified peak rates, rounded conservatively.
// 2026-10-17 audit: one transport blip at 04:17 Cairo tripped the cap-day breaker and handed six hours
// (29 replies, $1.11) to Claude. A retryable failure (429, 408, 409, 5xx, network or timeout) is now
// retried with exponential backoff before the comment falls back, and a comment that still fails is
// answered on the fallback. In deepseek-all the fallback then covers only the rest of that poll and
// nothing is persisted. In the legacy deepseek/hybrid modes the cap-day breaker trips only after this many
// failed comments in one poll (one process = one poll on the worker).
const TRIP_AFTER_FAILURES = Math.max(1, Math.min(3, Math.floor(Number(process.env.BOT_DEEPSEEK_TRIP_FAILURES ?? 2) || 2)));
const RETRY_BACKOFF_MS = Math.max(0, Number(process.env.BOT_DEEPSEEK_RETRY_MS ?? 1500) || 0);
// Retries per comment after the first attempt. Two retries at 1.5 s and 4.5 s add a few seconds (plus at
// most two 45 s client timeouts) to the one comment that meets an outage; the rest of that poll skips DeepSeek.
const RETRIES = Math.max(0, Math.min(3, Math.floor(Number(process.env.BOT_DEEPSEEK_RETRIES ?? 2) || 0)));
let failedComments = 0;
let lastServed: string | undefined;

/** deepseek-all: Claude is an idle fallback for the rest of one poll, never a cap-day handover. */
function onePollFallback(): boolean {
  return config.replyProvider === 'deepseek-all';
}

/**
 * The provider that answers when DeepSeek is off, failed or cannot serve a request. Claude today; kept
 * behind this interface so a non-Claude fallback can be plugged in later without touching the breaker.
 */
export interface ReplyFallback {
  readonly name: string;
  send(request: ReplyRequest): Promise<Anthropic.Message>;
}
// In deepseek-all the logical model label is replaced by the configured fallback model (Haiku 5.5), so a
// fallback never reaches Sonnet whatever BOT_MODEL says. The legacy modes keep the requested model.
const claudeFallback: ReplyFallback = {
  get name() { return onePollFallback() ? `claude (${config.fallbackModel})` : 'claude'; },
  send: (request) => claudeMessage(onePollFallback() ? { ...request, model: config.fallbackModel } as ReplyRequest : request),
};
let fallback: ReplyFallback = claudeFallback;
/** Swap the fallback provider (tests, or a future non-Claude fallback). Returns the previous one. */
export function setReplyFallback(next: ReplyFallback | null): ReplyFallback {
  const previous = fallback;
  fallback = next ?? claudeFallback;
  return previous;
}
/** The model that served the most recent reply call in this process, for honest logs. */
export function lastServedModel(): string | undefined {
  return lastServed;
}

function getClaude(): Anthropic {
  // Preserve the existing Claude constructor and PR13 wrapper exactly once.
  return claude ??= new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY'), fetch: observedReplyFetch() });
}
function getDeepSeek(): Anthropic {
  if (!deepseek) {
    const key = requireEnv('DEEPSEEK_API_KEY');
    let observed = globalThis.fetch;
    try { observed = deepSeekObservation.wrapFetch(globalThis.fetch); }
    catch { try { deepSeekObservation.installationFailed(); } catch { /* Optional diagnostics. */ } }
    deepseek = createDeepSeekReplyClient(key, observed);
  }
  return deepseek;
}

function providerMode(): ReplyProviderMode {
  if (!config.deepSeekTrial) return 'anthropic';
  if (deepSeekAll || config.replyProvider === 'deepseek-all') return 'deepseek-all';
  return config.replyProvider === 'deepseek' ? 'deepseek-primary' : 'deepseek-no-search-trial';
}

/**
 * deepseek-all: every request, native web search and its continuations included, goes to DeepSeek.
 * Legacy deepseek mode: the exact server-search payload stays on Claude, including forced continuation.
 */
export async function createReplyMessage(request: ReplyRequest): Promise<Anthropic.Message> {
  const plan = planReplyProvider(request, {
    mode: providerMode(),
    triageModel: config.triageModel, qualityModel: config.model, commentMedia: config.deepSeekCommentMedia,
  });
  if (config.deepSeekTrial && !disclosed) {
    disclosed = true;
    console.log(config.replyProvider === 'deepseek-all'
      ? `    DeepSeek provider (deepseek-all): deepseek-flash answers every reply, including web-search lookups and commenter media. Claude ${config.fallbackModel} answers only after DeepSeek fails, and only for the rest of this poll.`
      : config.replyProvider === 'deepseek'
        ? '    DeepSeek provider: deepseek-flash answers every reply except web-search lookups, which use Claude. A DeepSeek failure falls back to Claude for the cap-day.'
        : '    DeepSeek trial: no-search requests use deepseek-flash; search, commenter media and unsupported contracts retain Claude. Full provider parity is unverified.');
  }
  if (plan.provider === 'deepseek') {
    const native = halted ? null : await tryDeepSeek(request, plan.request);
    if (native) { lastServed = native.model; return native; }
  }
  if (config.deepSeekTrial && !fallbackDisclosed) {
    fallbackDisclosed = true;
    console.log(onePollFallback()
      ? `    DeepSeek fallback: ${fallback.name} answers because DeepSeek failed or is off for this poll.`
      : `    DeepSeek trial uses explicit ${fallback.name} fallback for search, commenter media, unsupported request blocks, a failed comment or a disabled trial.`);
  }
  // A DeepSeek-planned request that falls back sends the exact original request to the fallback.
  // In the legacy modes search and other Anthropic-only contracts (plan.provider === 'anthropic') stay on Claude.
  const response = plan.provider === 'anthropic' ? await claudeMessage(plan.request) : await sendFallback(request);
  lastServed = response.model;
  return response;
}

/** Thrown when the idle fallback could not answer a comment DeepSeek already failed. Transient by design. */
export class FallbackUnavailableError extends Error {
  constructor(detail: string) {
    super(`fallback unavailable after a DeepSeek failure (${detail}); left for the next poll`);
    this.name = 'FallbackUnavailableError';
  }
}

// In deepseek-all Claude is idle: its own credit or a Claude outage must not abort a night DeepSeek can
// still serve. Such a failure becomes a transient error (never cached, retried next poll). Only when
// DeepSeek itself rejected the key or balance in this process does the fallback error pass through
// unchanged, so a night with BOTH providers dead still exits 3.
async function sendFallback(request: ReplyRequest): Promise<Anthropic.Message> {
  try { return await fallback.send(request); }
  catch (err) {
    if (!onePollFallback() || deepSeekAuthFailed) throw err;
    console.log(`    ${fallback.name} fallback failed (${errorClass(err)}); comment left for the next poll.`);
    throw new FallbackUnavailableError(errorClass(err));
  }
}

async function sendClaude(request: ReplyRequest): Promise<Anthropic.Message> {
  const response = await getClaude().messages.create(request);
  recordUsage(request.model, response.usage);
  try { observeReplyUsage(response.usage); } catch { /* PR13 observation is optional. */ }
  return response;
}

// Claude Sonnet 5.5 (and Opus 5.5 / Fable 5.1) reject forced tool_choice with a 400 and think by
// default, with thinking counted against max_tokens. The shared request keeps its forced
// submit_reply and 1024-token bound because DeepSeek receives the same body; only the Claude
// boundary adapts. A forced call becomes auto, and if no submit_reply comes back the turn is
// continued once, append-only, asking for it (callers still see a forced-style result).
export const NO_FORCED_TOOL_CHOICE = /^claude-(?:sonnet-5-5|opus-5-5|fable-5-1|mythos-5-1)/;
// Claude Haiku 5.5 (the deepseek-all fallback), verified 2026-10-17 against the docs and one live smoke
// call: it ACCEPTS forced tool_choice (a forced call skips thinking), thinks adaptively by default with
// thinking counted toward max_tokens, accepts thinking disabled at effort low/medium/high (400 at
// xhigh/max), and rejects any non-default temperature/top_p and every top_k with a 400. So the forced
// submit_reply stays, thinking is turned off explicitly so the auto-tool search path cannot spend the
// 1024-token bound on reasoning, effort is pinned to low and sampling parameters are dropped.
export const HAIKU_5_5 = /^claude-haiku-5-5/;
const CLAUDE_THINKING_HEADROOM = 4096;
export function adaptClaudeRequest(request: ReplyRequest): { request: ReplyRequest; forcedTool: string | null } {
  if (HAIKU_5_5.test(request.model)) {
    const { temperature: _t, top_p: _p, top_k: _k, ...rest } = request;
    return {
      forcedTool: null,
      request: { ...rest, thinking: { type: 'disabled' }, output_config: { ...(rest.output_config ?? {}), effort: 'low' } } as ReplyRequest,
    };
  }
  if (!NO_FORCED_TOOL_CHOICE.test(request.model)) return { request, forcedTool: null };
  const choice = request.tool_choice;
  const forcedTool = choice?.type === 'tool' ? choice.name : choice?.type === 'any' ? '*' : null;
  return {
    forcedTool,
    request: {
      ...request,
      max_tokens: Math.max(request.max_tokens, CLAUDE_THINKING_HEADROOM),
      ...(forcedTool ? { tool_choice: { type: 'auto' } } : {}),
    } as ReplyRequest,
  };
}

async function claudeMessage(request: ReplyRequest): Promise<Anthropic.Message> {
  const { request: adapted, forcedTool } = adaptClaudeRequest(request);
  const response = await sendClaude(adapted);
  // Only a first-turn request gets the continuation: reply.ts already re-asks once after a search turn,
  // and a second nested ask would just pay for the same miss twice.
  if (!forcedTool || adapted.messages.length > 1 || response.stop_reason === 'max_tokens' || response.stop_reason === 'refusal') return response;
  const called = response.content.some((b) => b.type === 'tool_use' && (forcedTool === '*' || b.name === forcedTool));
  if (called) return response;
  return sendClaude({
    ...adapted,
    messages: [...adapted.messages, { role: 'assistant', content: response.content },
      { role: 'user', content: `Call the ${forcedTool === '*' ? 'appropriate' : forcedTool} tool now with your decision.` }],
  } as ReplyRequest);
}

const REPAIR_NOTE = (problem: string) => problem === 'truncated'
  ? 'REPAIR (one attempt): your previous submit_reply was cut off at the token limit. Call submit_reply once with every required field and keep reply_text to at most three short sentences.'
  : `REPAIR (one attempt): your previous submit_reply was rejected by the validator (${problem.slice(0, 160)}). Call submit_reply exactly once with every required field of the schema and no other fields. Keep every voice, accuracy and reveal rule.`;

/** Append the repair note to the final user turn without touching the cached prefix blocks before it. */
export function withRepairNote(request: ReplyRequest, problem: string): ReplyRequest {
  const messages = [...request.messages];
  const last = messages[messages.length - 1];
  const note = { type: 'text' as const, text: REPAIR_NOTE(problem) };
  const content = typeof last.content === 'string' ? [{ type: 'text' as const, text: last.content }, note] : [...last.content, note];
  messages[messages.length - 1] = { ...last, content } as ReplyRequest['messages'][number];
  return { ...request, messages };
}

// A DeepSeek reply whose verdict cannot be used (extra or missing field, truncation, no submit_reply)
// published nothing and was already priced. DeepSeek gets ONE repair attempt carrying the validator's
// error; only if that also fails does the fallback answer the same comment with the exact original
// request. DeepSeek stays on either way: the cost is known, and one bad verdict is not an outage.
// `check` returns the problem with a response, or null when its verdict is usable.
export async function repairDeepSeekVerdict(
  request: ReplyRequest, problem: string, check: (response: Anthropic.Message) => string | null,
): Promise<Anthropic.Message> {
  console.log(`    DeepSeek verdict unusable (${problem.slice(0, 80)}); one DeepSeek repair attempt.`);
  const repaired = await createReplyMessage(withRepairNote(request, problem));
  if (repaired.model !== 'deepseek-flash') return repaired; // DeepSeek failed outright; the fallback already answered.
  const still = check(repaired);
  if (!still) { console.log('    DeepSeek repair succeeded.'); return repaired; }
  // The everything-on-DeepSeek evaluation must see DeepSeek's own failures.
  if (deepSeekAll) return repaired;
  console.log(`    DeepSeek repair unusable (${still.slice(0, 80)}); ${fallback.name} answers this comment.`);
  const response = await sendFallback(request);
  lastServed = response.model;
  return response;
}

const RETRYABLE = (status: number | undefined) => status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
const AUTH_OR_BALANCE = (status: number | undefined) => status === 401 || status === 402 || status === 403;
function statusOf(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}
function hasSearch(request: ReplyRequest): boolean {
  return !!request.tools?.some(tool => 'type' in tool && typeof tool.type === 'string' && tool.type.startsWith('web_search')) ||
    request.messages.some(message => Array.isArray(message.content) &&
      message.content.some(block => block?.type === 'server_tool_use' || block?.type === 'web_search_tool_result'));
}
function reportedSearches(usage: unknown): number {
  const n = (usage as { server_tool_use?: { web_search_requests?: unknown } } | null)?.server_tool_use?.web_search_requests;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

// Nothing is published from a failed DeepSeek attempt, so the same request can safely go to the fallback.
// An HTTP error response (4xx/5xx) produced no completion and is not charged. A network error or timeout
// may have been processed, so it is charged conservatively, at most once per comment however many
// retries follow. A DeepSeek blip must never become a Claude outage.
async function tryDeepSeek(original: ReplyRequest, mapped: ReplyRequest): Promise<Anthropic.Message | null> {
  const extras = original as ReplyRequest & { mcp_servers?: unknown; context_management?: unknown; inference_geo?: unknown; speed?: unknown };
  if (original.max_tokens !== 1024 || original.stream || original.service_tier || extras.mcp_servers || original.container || extras.context_management || extras.inference_geo || extras.speed) {
    return disableDeepSeek('request outside the ordinary-call accounting bound', 0);
  }
  let client: Anthropic;
  try { client = getDeepSeek(); } catch { return disableDeepSeek('DeepSeek credential unavailable', 0); }
  let response: Anthropic.Message | undefined;
  let uncertainCharged = false;
  for (let attempt = 0; ; attempt++) {
    try {
      response = await client.messages.create(mapped);
      if (attempt > 0) console.log(`    DeepSeek retry ${attempt} succeeded.`);
      break;
    } catch (err) {
      const status = statusOf(err);
      if (status === undefined && !uncertainCharged) {
        uncertainCharged = true;
        recordPricedCall(UNCERTAIN_FLASH_CALL_USD);
        console.log(`    DeepSeek transport error (${errorClass(err)}); usage uncertain, charged ${UNCERTAIN_FLASH_CALL_USD} USD conservatively once for this comment.`);
      } else {
        console.log(`    DeepSeek ${attempt ? `retry ${attempt} ` : ''}error (${errorClass(err)}).`);
      }
      if (AUTH_OR_BALANCE(status)) {
        deepSeekAuthFailed = true;
        console.log(`::warning::DeepSeek ${status === 402 ? 'balance exhausted' : 'key rejected'} (HTTP ${status}). ${fallback.name} answers until it is fixed. Top up or rotate DEEPSEEK_API_KEY.`);
        return failComment('DeepSeek key or balance rejected', 'provider');
      }
      if (!RETRYABLE(status)) return failComment(`request rejected (HTTP ${status})`, 'comment');
      if (attempt >= RETRIES) return failComment(`transport failed after ${attempt + 1} attempt(s)`, 'provider');
      const wait = RETRY_BACKOFF_MS * 3 ** attempt;
      if (wait) await new Promise((r) => setTimeout(r, wait));
    }
  }
  try { deepSeekObservation.usage(response?.usage); } catch { /* Optional diagnostics. */ }
  let cost: number | null = null;
  // Even an HTTP-200 body can be null/malformed. Projection failure is billing uncertainty, never free
  // usage. A search request, or a response that reports searches, is priced by the search pricer FIRST:
  // the strict token pricer returns null for any reported search, which used to charge the flat $0.35
  // uncertain amount and stop DeepSeek on every successful search.
  try {
    cost = deepSeekAll || hasSearch(mapped) || reportedSearches(response?.usage) > 0
      ? deepSeekSearchCost(response?.model, response?.usage)
      : deepSeekTokenCost(response?.model, response?.usage);
  } catch { /* Keep unknown. */ }
  if (cost === null) { recordPricedCall(UNCERTAIN_FLASH_CALL_USD); return failComment('native usage unknown', 'provider'); }
  recordPricedCall(cost);
  // The everything-on-DeepSeek evaluation must see real media replies to judge them.
  // The media hold is the offline replay's benchmark route only; production media is never held.
  if (config.deepSeekCommentMedia === 'held') enforceDeepSeekMediaHold(mapped, response!);
  return response!;
}

/** Error class and HTTP status only. Never the message or body: those can echo request content. */
export function errorClass(err: unknown): string {
  const name = (err as { constructor?: { name?: string } } | null)?.constructor?.name || typeof err;
  const status = (err as { status?: unknown } | null)?.status;
  return `class=${String(name).replace(/[^\w.-]/g, '').slice(0, 40) || 'unknown'} status=${typeof status === 'number' ? status : 'none'}`;
}

// One comment failed on DeepSeek; the fallback answers it. A request-specific rejection (scope 'comment',
// such as a 400 or 422 on one body) leaves DeepSeek on. A provider failure (retries exhausted, key or
// balance rejected, unknown usage) stops DeepSeek for the rest of this poll in deepseek-all; in the legacy
// modes the cap-day breaker trips once TRIP_AFTER_FAILURES comments have failed in this poll.
function failComment(reason: string, scope: 'comment' | 'provider'): null {
  if (scope === 'comment') {
    console.log(`    DeepSeek could not serve this comment (${reason}); ${fallback.name} answers it. DeepSeek stays on.`);
    return null;
  }
  failedComments += 1;
  if (onePollFallback() || failedComments >= TRIP_AFTER_FAILURES) return disableDeepSeek(`${reason}; ${failedComments} failed comment(s) this poll`, 0);
  console.log(`    DeepSeek failed for this comment (${reason}); ${fallback.name} answers it. DeepSeek stays on (${failedComments}/${TRIP_AFTER_FAILURES} failures this poll).`);
  return null;
}

function disableDeepSeek(reason: string, chargeUsd: number): null {
  halted = true;
  if (chargeUsd > 0) recordPricedCall(chargeUsd);
  if (onePollFallback()) {
    console.log(`    DeepSeek off for the rest of this poll (${reason}); ${fallback.name} answers until the next poll, which tries DeepSeek again.`);
    return null;
  }
  tripPending = true;
  console.log(`    DeepSeek trial disabled for this cap-day (${reason}); ${fallback.name} handles the remaining replies.`);
  return null;
}

/** Offline tests only: reset the per-process breaker counters. */
export function resetDeepSeekBreakerForTests(): void {
  halted = false; tripPending = false; failedComments = 0; deepSeekAuthFailed = false; lastServed = undefined;
}

/** Dry-run evaluation only: route every request, including search and commenter media, to DeepSeek. */
export function enableDeepSeekForEverything(): void {
  deepSeekAll = true;
  console.log('    DeepSeek-ONLY evaluation: search, search continuations and commenter media also use deepseek-flash. No Claude fallback for routing.');
}

/** Seed the process from the durable cap-day breaker before any reply call. */
export function seedDeepSeekHalt(haltedToday: boolean): void {
  // deepseek-all never hands a cap-day to Claude, so a breaker left by a legacy mode is ignored.
  if (haltedToday && !onePollFallback()) halted = true;
}

/** True once after DeepSeek was disabled in this process; the caller persists the cap-day breaker. */
export function takeDeepSeekTrip(): boolean {
  const tripped = tripPending;
  tripPending = false;
  return tripped;
}

/** Provider-specific process scope; no request bodies, keys, replies or error text. */
export function replyTrialProviderSnapshot() {
  return {
    scope: 'reply_provider_process', persistence: 'none', trial: config.deepSeekTrial,
    provider: config.replyProvider,
    fallback: config.replyProvider === 'deepseek-all'
      ? `DeepSeek owns every request including native web search; Claude ${config.fallbackModel} answers only after a DeepSeek failure, for the rest of that poll`
      : config.replyProvider === 'deepseek' ? 'Claude owns native web-search lookups and DeepSeek failures' : 'Claude owns native search, commenter media and unsupported contracts',
    halted,
    mediaReplies: config.deepSeekCommentMedia === 'held' ? 'held pending grounding and written-intent acceptance'
      : config.replyProvider === 'deepseek' || config.replyProvider === 'deepseek-all' ? 'deepseek-flash reads commenter images and GIF frames' : 'Claude pending DeepSeek grounding acceptance',
    providers: {
      anthropic: { provider: 'anthropic', observation: replyProviderSnapshot() },
      deepseek: { provider: 'deepseek', requestedModel: 'deepseek-flash', observation: deepSeekObservation.snapshot() },
    },
  };
}
