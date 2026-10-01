import Anthropic from '@anthropic-ai/sdk';
import { config, requireEnv } from './config';
import { createProviderObservation, observedReplyFetch, observeReplyUsage, replyProviderSnapshot } from './provider-observation';
import { recordPricedCall, recordUsage } from './spend';
import { createDeepSeekReplyClient, deepSeekTokenCost } from './deepseek-reply-client';
import { planReplyProvider, type ReplyRequest } from './reply-provider-plan';
import { enforceDeepSeekMediaHold } from './deepseek-media-policy';

let claude: Anthropic | null = null;
let deepseek: Anthropic | null = null;
let halted = false;
let tripPending = false;
let disclosed = false;
let fallbackDisclosed = false;
const deepSeekObservation = createProviderObservation();
const UNCERTAIN_FLASH_CALL_USD = 0.35; // 1M context + 1024 output at verified peak rates, rounded conservatively.

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
    mode: config.deepSeekTrial ? 'deepseek-no-search-trial' : 'anthropic',
    triageModel: config.triageModel, qualityModel: config.model, commentMedia: config.deepSeekCommentMedia,
  });
  if (config.deepSeekTrial && !disclosed) {
    disclosed = true;
    console.log('    DeepSeek trial: no-search requests use deepseek-flash; search, commenter media and unsupported contracts retain Claude. Full provider parity is unverified.');
  }
  if (plan.provider === 'deepseek') {
    const native = halted ? null : await tryDeepSeek(request, plan.request);
    if (native) return native;
  }
  if (config.deepSeekTrial && !fallbackDisclosed) {
    fallbackDisclosed = true;
    console.log('    DeepSeek trial uses explicit Claude fallback for search, commenter media, unsupported request blocks or a disabled trial.');
  }
  // A DeepSeek-planned request that falls back sends the exact original Claude request.
  const response = await getClaude().messages.create(plan.provider === 'anthropic' ? plan.request : request);
  recordUsage(request.model, response.usage);
  try { observeReplyUsage(response.usage); } catch { /* PR13 observation is optional. */ }
  return response;
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
  catch { return disableDeepSeek('transport usage uncertain', UNCERTAIN_FLASH_CALL_USD); }
  try { deepSeekObservation.usage(response?.usage); } catch { /* Optional diagnostics. */ }
  let cost: number | null = null;
  // Even an HTTP-200 body can be null/malformed. Projection failure is billing
  // uncertainty, never free usage.
  try { cost = deepSeekTokenCost(response?.model, response?.usage); } catch { /* Keep unknown. */ }
  if (cost === null) return disableDeepSeek('native usage unknown', UNCERTAIN_FLASH_CALL_USD);
  recordPricedCall(cost);
  enforceDeepSeekMediaHold(mapped, response);
  return response;
}

function disableDeepSeek(reason: string, chargeUsd: number): null {
  halted = true;
  tripPending = true;
  if (chargeUsd > 0) recordPricedCall(chargeUsd);
  console.log(`    DeepSeek trial disabled for this cap-day (${reason}); Claude handles the remaining replies.`);
  return null;
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
    fallback: 'Claude owns native search, commenter media and unsupported contracts', halted,
    mediaReplies: config.deepSeekCommentMedia === 'held' ? 'held pending grounding and written-intent acceptance' : 'Claude pending DeepSeek grounding acceptance',
    providers: {
      anthropic: { provider: 'anthropic', observation: replyProviderSnapshot() },
      deepseek: { provider: 'deepseek', requestedModel: 'deepseek-flash', observation: deepSeekObservation.snapshot() },
    },
  };
}
