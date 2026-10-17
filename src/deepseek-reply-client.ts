// Explicit selected-client construction and native token accounting.
import Anthropic from '@anthropic-ai/sdk';
import { projectDeepSeekUsage } from './reply-provider-plan';

/** Caller supplies the selected provider's fetch, already observed exactly once. */
export function createDeepSeekReplyClient(apiKey: string, observedFetch: typeof globalThis.fetch): Anthropic {
  if (!apiKey.trim()) throw Error('Missing DeepSeek credential');
  return new Anthropic({
    apiKey, authToken: null,
    baseURL: 'https://api.deepseek.com/anthropic',
    maxRetries: 0, timeout: 45_000, fetch: observedFetch,
  });
}

/** Peak-rate token component only. Missing native counters are not free usage. */
// DeepSeek web search through the Anthropic-compatible endpoint is billed at $0.75 per 1,000 successful
// search requests from 2026-11-01 (empty results and errors are not billed). The reserve charged per
// reported search is about four times that ($0.003), so the meter stays conservative without a
// successful search ever looking like an outage. Before 2026-11-01 the reserve simply over-counts.
export const DEEPSEEK_SEARCH_RESERVE_USD = 0.003;

/** Search-enabled cost: reported tokens plus a conservative reserve per reported search. */
// Cache-creation tokens, if DeepSeek ever reports them, are charged at the full input rate.
export function deepSeekSearchCost(model: string, rawUsage: unknown): number | null {
  if (model !== 'deepseek-flash') return null;
  const u = projectDeepSeekUsage(rawUsage);
  if (u.inputTokens === null || u.outputTokens === null) return null;
  const searches = u.serverWebSearchRequests ?? 0;
  return ((u.inputTokens * 0.30 + (u.cacheCreationTokens ?? 0) * 0.30 + (u.cacheReadTokens ?? 0) * 0.006 + u.outputTokens * 1.20) / 1_000_000) + searches * DEEPSEEK_SEARCH_RESERVE_USD;
}

export function deepSeekTokenCost(model: string, rawUsage: unknown): number | null {
  if (model !== 'deepseek-flash') return null;
  const u = projectDeepSeekUsage(rawUsage);
  if (u.inputTokens === null || u.outputTokens === null || u.cacheReadTokens === null || u.cacheCreationTokens !== 0) return null;
  // Server-search billing has not been bounded or mapped. Never price it as free.
  if (u.serverWebSearchRequests !== null && u.serverWebSearchRequests !== 0) return null;
  return (u.inputTokens * 0.30 + u.cacheReadTokens * 0.006 + u.outputTokens * 1.20) / 1_000_000;
}
