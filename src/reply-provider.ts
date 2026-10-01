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
  if (config.deepSeekTrial && halted) throw Error('billing: DeepSeek trial halted after uncertain usage; no further reply calls');
  if (plan.provider === 'anthropic') {
    if (config.deepSeekTrial && !fallbackDisclosed) {
      fallbackDisclosed = true;
      console.log('    DeepSeek trial uses explicit Claude fallback for search, commenter media or unsupported request blocks.');
    }
    const response = await getClaude().messages.create(plan.request);
    recordUsage(request.model, response.usage);
    try { observeReplyUsage(response.usage); } catch { /* PR13 observation is optional. */ }
    return response;
  }
  // Missing credentials fail before the attempt and incur no invented usage.
  const client = getDeepSeek();
  const extras = request as ReplyRequest & { mcp_servers?: unknown; context_management?: unknown; inference_geo?: unknown; speed?: unknown };
  if (request.max_tokens !== 1024 || request.stream || request.service_tier || extras.mcp_servers || request.container || extras.context_management || extras.inference_geo || extras.speed) {
    throw Error('billing: DeepSeek trial request outside its ordinary-call accounting bound');
  }
  let response: Anthropic.Message;
  try { response = await client.messages.create(plan.request); }
  catch {
    halted = true;
    recordPricedCall(UNCERTAIN_FLASH_CALL_USD);
    throw Error('billing: DeepSeek transport usage uncertain; conservative call charged and trial halted');
  }
  try { deepSeekObservation.usage(response?.usage); } catch { /* Optional diagnostics. */ }
  let cost: number | null = null;
  // Even an HTTP-200 body can be null/malformed. Projection failure is billing
  // uncertainty, never a free transient error that permits another request.
  try { cost = deepSeekTokenCost(response?.model, response?.usage); } catch { /* Keep unknown. */ }
  if (cost === null) {
    halted = true;
    recordPricedCall(UNCERTAIN_FLASH_CALL_USD);
    throw Error('billing: DeepSeek native usage unknown; conservative call charged and trial halted');
  }
  recordPricedCall(cost);
  enforceDeepSeekMediaHold(plan.request, response);
  return response;
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
