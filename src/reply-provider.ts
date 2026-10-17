import Anthropic from '@anthropic-ai/sdk';
import { config, requireEnv } from './config';
import { createProviderObservation, observedReplyFetch, observeReplyUsage, replyProviderSnapshot } from './provider-observation';
import { recordPricedCall, recordUsage } from './spend';
import { createDeepSeekReplyClient, deepSeekSearchCost, deepSeekTokenCost } from './deepseek-reply-client';
import { planReplyProvider, type ReplyRequest } from './reply-provider-plan';
import { enforceDeepSeekMediaHold } from './deepseek-media-policy';

let claude: Anthropic | null = null;
let deepseek: Anthropic | null = null;
let halted = false;
let tripPending = false;
let deepSeekAll = false;
let disclosed = false;
let fallbackDisclosed = false;
const deepSeekObservation = createProviderObservation();
const UNCERTAIN_FLASH_CALL_USD = 0.35; // 1M context + 1024 output at verified peak rates, rounded conservatively.
// 2026-10-17 audit: one transport blip at 04:17 Cairo tripped the cap-day breaker and handed six hours
// (29 replies, $1.11) to Claude. A failure is now retried once after a short backoff, a comment that still
// fails is answered on the fallback alone, and the cap-day breaker trips only after this many failed
// comments in one poll (one process = one poll on the worker).
const TRIP_AFTER_FAILURES = Math.max(1, Math.min(3, Math.floor(Number(process.env.BOT_DEEPSEEK_TRIP_FAILURES ?? 2) || 2)));
const RETRY_BACKOFF_MS = Math.max(0, Number(process.env.BOT_DEEPSEEK_RETRY_MS ?? 1500) || 0);
let failedComments = 0;
let retryUsed = false;
let lastServed: string | undefined;

/**
 * The provider that answers when DeepSeek is off, failed or cannot serve a request. Claude today; kept
 * behind this interface so a non-Claude fallback can be plugged in later without touching the breaker.
 */
export interface ReplyFallback {
  readonly name: string;
  send(request: ReplyRequest): Promise<Anthropic.Message>;
}
const claudeFallback: ReplyFallback = { name: 'claude', send: (request) => claudeMessage(request) };
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

/** Exact existing server-search payload stays on Claude, including forced continuation. */
export async function createReplyMessage(request: ReplyRequest): Promise<Anthropic.Message> {
  const plan = planReplyProvider(request, {
    mode: !config.deepSeekTrial ? 'anthropic' : deepSeekAll ? 'deepseek-all' : config.replyProvider === 'deepseek' ? 'deepseek-primary' : 'deepseek-no-search-trial',
    triageModel: config.triageModel, qualityModel: config.model, commentMedia: config.deepSeekCommentMedia,
  });
  if (config.deepSeekTrial && !disclosed) {
    disclosed = true;
    console.log(config.replyProvider === 'deepseek'
      ? '    DeepSeek provider: deepseek-flash answers every reply except web-search lookups, which use Claude. A DeepSeek failure falls back to Claude for the cap-day.'
      : '    DeepSeek trial: no-search requests use deepseek-flash; search, commenter media and unsupported contracts retain Claude. Full provider parity is unverified.');
  }
  if (plan.provider === 'deepseek') {
    const native = halted ? null : await tryDeepSeek(request, plan.request);
    if (native) { lastServed = native.model; return native; }
  }
  if (config.deepSeekTrial && !fallbackDisclosed) {
    fallbackDisclosed = true;
    console.log(`    DeepSeek trial uses explicit ${fallback.name} fallback for search, commenter media, unsupported request blocks, a failed comment or a disabled trial.`);
  }
  // A DeepSeek-planned request that falls back sends the exact original request to the fallback.
  // Search and other Anthropic-only contracts (plan.provider === 'anthropic') always stay on Claude.
  const response = plan.provider === 'anthropic' ? await claudeMessage(plan.request) : await fallback.send(request);
  lastServed = response.model;
  return response;
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
const CLAUDE_THINKING_HEADROOM = 4096;
export function adaptClaudeRequest(request: ReplyRequest): { request: ReplyRequest; forcedTool: string | null } {
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

// A DeepSeek reply whose verdict cannot be used (extra or missing field, truncation, no submit_reply)
// published nothing and was already priced, so Claude answers the same comment with the exact original
// request. DeepSeek stays on: the cost is known, and one bad verdict is not an outage. Without this the
// comment became an error: skip, which fails the poll and is re-billed on every later poll.
export async function retryVerdictOnClaude(request: ReplyRequest, problem: string): Promise<Anthropic.Message | null> {
  if (deepSeekAll) return null; // the everything-on-DeepSeek evaluation must see DeepSeek's own failures
  console.log(`    DeepSeek verdict unusable (${problem.slice(0, 80)}); Claude answers this comment.`);
  return claudeMessage(request);
}

// Nothing is published from a failed DeepSeek attempt, so the same request can safely go to Claude.
// Uncertain usage is still charged conservatively, once, and DeepSeek stays off for the cap-day
// (index.ts persists the trip). A DeepSeek blip must never become a Claude outage.
async function tryDeepSeek(original: ReplyRequest, mapped: ReplyRequest): Promise<Anthropic.Message | null> {
  const extras = original as ReplyRequest & { mcp_servers?: unknown; context_management?: unknown; inference_geo?: unknown; speed?: unknown };
  if (original.max_tokens !== 1024 || original.stream || original.service_tier || extras.mcp_servers || original.container || extras.context_management || extras.inference_geo || extras.speed) {
    return disableDeepSeek('request outside the ordinary-call accounting bound', 0);
  }
  let client: Anthropic;
  try { client = getDeepSeek(); } catch { return disableDeepSeek('DeepSeek credential unavailable', 0); }
  let response: Anthropic.Message;
  try { response = await client.messages.create(mapped); }
  catch (err) {
    // Usage of a failed attempt is uncertain: charge it conservatively, exactly as before, per attempt.
    recordPricedCall(UNCERTAIN_FLASH_CALL_USD);
    console.log(`    DeepSeek transport error (${errorClass(err)}); charged ${UNCERTAIN_FLASH_CALL_USD} USD conservatively.`);
    if (!retryUsed) {
      // One retry per poll: a second blip in the same poll goes straight to the fallback.
      retryUsed = true;
      if (RETRY_BACKOFF_MS) await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
      try { response = await client.messages.create(mapped); console.log('    DeepSeek retry succeeded.'); }
      catch (again) {
        recordPricedCall(UNCERTAIN_FLASH_CALL_USD);
        console.log(`    DeepSeek retry failed (${errorClass(again)}); charged ${UNCERTAIN_FLASH_CALL_USD} USD conservatively.`);
        return failComment('transport usage uncertain');
      }
    } else {
      return failComment('transport usage uncertain');
    }
  }
  try { deepSeekObservation.usage(response?.usage); } catch { /* Optional diagnostics. */ }
  let cost: number | null = null;
  // Even an HTTP-200 body can be null/malformed. Projection failure is billing
  // uncertainty, never free usage.
  try { cost = deepSeekAll ? deepSeekSearchCost(response?.model, response?.usage) : deepSeekTokenCost(response?.model, response?.usage); } catch { /* Keep unknown. */ }
  if (cost === null) { recordPricedCall(UNCERTAIN_FLASH_CALL_USD); return failComment('native usage unknown'); }
  recordPricedCall(cost);
  // The everything-on-DeepSeek evaluation must see real media replies to judge them.
  // The media hold is the offline replay's benchmark route only; production media is never held.
  if (config.deepSeekCommentMedia === 'held') enforceDeepSeekMediaHold(mapped, response);
  return response;
}

/** Error class and HTTP status only. Never the message or body: those can echo request content. */
export function errorClass(err: unknown): string {
  const name = (err as { constructor?: { name?: string } } | null)?.constructor?.name || typeof err;
  const status = (err as { status?: unknown } | null)?.status;
  return `class=${String(name).replace(/[^\w.-]/g, '').slice(0, 40) || 'unknown'} status=${typeof status === 'number' ? status : 'none'}`;
}

// One comment failed on DeepSeek (already charged). The fallback answers only this request; the cap-day
// breaker trips once TRIP_AFTER_FAILURES comments have failed in this poll.
function failComment(reason: string): null {
  failedComments += 1;
  if (failedComments >= TRIP_AFTER_FAILURES) return disableDeepSeek(`${reason}; ${failedComments} failed comments this poll`, 0);
  console.log(`    DeepSeek failed for this comment (${reason}); ${fallback.name} answers it. DeepSeek stays on (${failedComments}/${TRIP_AFTER_FAILURES} failures this poll).`);
  return null;
}

function disableDeepSeek(reason: string, chargeUsd: number): null {
  halted = true;
  tripPending = true;
  if (chargeUsd > 0) recordPricedCall(chargeUsd);
  console.log(`    DeepSeek trial disabled for this cap-day (${reason}); ${fallback.name} handles the remaining replies.`);
  return null;
}

/** Offline tests only: reset the per-process breaker counters. */
export function resetDeepSeekBreakerForTests(): void {
  halted = false; tripPending = false; failedComments = 0; retryUsed = false; lastServed = undefined;
}

/** Dry-run evaluation only: route every request, including search and commenter media, to DeepSeek. */
export function enableDeepSeekForEverything(): void {
  deepSeekAll = true;
  console.log('    DeepSeek-ONLY evaluation: search, search continuations and commenter media also use deepseek-flash. No Claude fallback for routing.');
}

/** Seed the process from the durable cap-day breaker before any reply call. */
export function seedDeepSeekHalt(haltedToday: boolean): void {
  if (haltedToday) halted = true;
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
    fallback: config.replyProvider === 'deepseek' ? 'Claude owns native web-search lookups and DeepSeek failures' : 'Claude owns native search, commenter media and unsupported contracts', halted,
    mediaReplies: config.deepSeekCommentMedia === 'held' ? 'held pending grounding and written-intent acceptance' : 'Claude pending DeepSeek grounding acceptance',
    providers: {
      anthropic: { provider: 'anthropic', observation: replyProviderSnapshot() },
      deepseek: { provider: 'deepseek', requestedModel: 'deepseek-flash', observation: deepSeekObservation.snapshot() },
    },
  };
}
