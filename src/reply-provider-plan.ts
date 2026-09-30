// Fully constructed request boundary; never discard media or search.
// No credentials, transport, metering, fallback calls or runtime state live here.
import type Anthropic from '@anthropic-ai/sdk';

export type ReplyProviderMode = 'anthropic' | 'deepseek-text-trial' | 'deepseek-no-search-trial';
export type ReplyRequest = Anthropic.MessageCreateParamsNonStreaming;
export interface ReplyProviderPolicy {
  mode: ReplyProviderMode;
  triageModel: string;
  qualityModel: string;
}
export interface ReplyProviderPlan {
  provider: 'anthropic' | 'deepseek';
  logicalModel: string;
  requestedModel: string;
  reason: 'default' | 'quality' | 'media-or-unsupported-block' | 'tool-contract' | 'text-triage' | 'no-search-trial';
  baseURL: 'https://api.anthropic.com' | 'https://api.deepseek.com/anthropic';
  request: ReplyRequest;
}

function textContent(content: unknown): boolean {
  return typeof content === 'string' ||
    (Array.isArray(content) && content.every(block => block && block.type === 'text' && typeof block.text === 'string'));
}

/** Route the actual fully constructed request; never remove media or search tools. */
export function planReplyProvider(request: ReplyRequest, policy: ReplyProviderPolicy): ReplyProviderPlan {
  if (!['anthropic', 'deepseek-text-trial', 'deepseek-no-search-trial'].includes(policy.mode)) throw Error('Unknown reply provider mode');
  const original = (reason: ReplyProviderPlan['reason']): ReplyProviderPlan => ({
    provider: 'anthropic', logicalModel: request.model, requestedModel: request.model,
    baseURL: 'https://api.anthropic.com', reason, request,
  });
  if (policy.mode === 'anthropic') return original('default');
  // Retain logical tier routing even if an operator configured both tiers identically.
  if (policy.mode === 'deepseek-text-trial' && (request.model !== policy.triageModel || request.model === policy.qualityModel)) return original('quality');
  const contentSupported = (content: unknown) => textContent(content) || (policy.mode === 'deepseek-no-search-trial' && Array.isArray(content) && content.every(block =>
    (block?.type === 'text' && typeof block.text === 'string') ||
    (block?.type === 'image' && block.source?.type === 'base64' && ['image/jpeg', 'image/png', 'image/webp'].includes(block.source.media_type) && typeof block.source.data === 'string')));
  if (!textContent(request.system ?? '') || !request.messages.every(message => contentSupported(message.content))) {
    return original('media-or-unsupported-block');
  }
  const submit = request.tools?.[0];
  if (request.tools?.length !== 1 || !submit || submit.name !== 'submit_reply' ||
      !('input_schema' in submit) || ('type' in submit && submit.type !== undefined && submit.type !== 'custom') ||
      request.tool_choice?.type !== 'tool' || request.tool_choice.name !== 'submit_reply') {
    return original('tool-contract');
  }
  // DeepSeek ignores cache_control; retain it so prompt/context blocks are untouched.
  // Do not send Claude's effort setting to a different model. Thinking is explicit.
  const { output_config: _claudeEffort, ...body } = request;
  const mapped: ReplyRequest = { ...body, model: 'deepseek-flash', thinking: { type: 'disabled' } };
  return {
    provider: 'deepseek', logicalModel: request.model, requestedModel: 'deepseek-flash',
    baseURL: 'https://api.deepseek.com/anthropic', reason: policy.mode === 'deepseek-text-trial' ? 'text-triage' : 'no-search-trial', request: mapped,
  };
}

/** Native Anthropic-compatible fields only; absent or malformed counters remain unknown. */
export function projectDeepSeekUsage(raw: unknown) {
  const usage = raw as Record<string, unknown> | null | undefined;
  const integer = (value: unknown): number | null => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
  return {
    provider: 'deepseek' as const,
    scope: 'top-level-message-response' as const,
    inputTokens: integer(usage?.input_tokens),
    outputTokens: integer(usage?.output_tokens),
    cacheReadTokens: integer(usage?.cache_read_input_tokens),
    cacheCreationTokens: integer(usage?.cache_creation_input_tokens),
    // Do not infer zero because no search was requested. Native usage is evidence.
    serverWebSearchRequests: integer((usage?.server_tool_use as { web_search_requests?: unknown } | undefined)?.web_search_requests),
  };
}
