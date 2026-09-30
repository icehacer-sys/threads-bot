// Reply-client transport diagnostics only. No I/O, request decisions or persistence.
type Fetch = typeof globalThis.fetch;
const STATUS = ['200', '400', '401', '403', '408', '409', '429', '500', '502', '503', '504', 'other', 'unknown'] as const;
const RETRY = ['0', '1', '2', 'other', 'unknown'] as const;
const USAGE = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'cacheCreation1hTokens', 'cacheCreation5mTokens', 'serverWebSearchRequests'] as const;
type UsageField = typeof USAGE[number];
type UsageTotal = { reportedTotal: number | null; knownRecords: number; unknownRecords: number };

/** Optional observer/maximum exist for synthetic failure and saturation fixtures. */
export function createProviderObservation(onObserved?: () => unknown, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw Error('Invalid observation bound');
  let installed = false, installationFailures = 0, failedObservations = 0, saturated = false;
  let starts = 0, responses = 0, transportThrows = 0, usageRecords = 0;
  const statuses = Object.fromEntries(STATUS.map(key => [key, 0])) as Record<typeof STATUS[number], number>;
  const retries = Object.fromEntries(RETRY.map(key => [key, 0])) as Record<typeof RETRY[number], number>;
  const totals = Object.fromEntries(USAGE.map(key => [key, { reportedTotal: null, knownRecords: 0, unknownRecords: 0 }])) as Record<UsageField, UsageTotal>;
  const add = (value: number, amount = 1) => {
    if (amount > maximum - value) { saturated = true; return maximum; }
    return value + amount;
  };
  const failed = () => { failedObservations = add(failedObservations); };
  const safely = (work: () => void) => {
    try {
      work();
      const pending = onObserved?.(); // No request, response, usage object or error reaches a sink.
      if (pending && typeof (pending as { then?: unknown }).then === 'function') void Promise.resolve(pending).catch(failed);
    } catch { failed(); }
  };
  const numeric = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
  const usageValue = (key: UsageField, value: unknown) => {
    const total = totals[key];
    if (!numeric(value)) { total.unknownRecords = add(total.unknownRecords); return; }
    total.knownRecords = add(total.knownRecords);
    total.reportedTotal = add(total.reportedTotal ?? 0, value);
  };
  return {
    wrapFetch(baseFetch: Fetch): Fetch {
      if (typeof baseFetch !== 'function') throw Error('Unavailable fetch');
      const wrapped: Fetch = async function (this: unknown, input, init) {
        safely(() => {
          starts = add(starts);
          let raw: string | null = null;
          try { raw = init?.headers instanceof Headers ? init.headers.get('x-stainless-retry-count') : null; } catch { failed(); }
          const ordinal = raw !== null && /^\d{1,6}$/.test(raw) ? Number(raw) : null;
          const bucket = ordinal === null ? 'unknown' : ordinal <= 2 ? String(ordinal) as '0' | '1' | '2' : 'other';
          retries[bucket] = add(retries[bucket]);
        });
        try {
          const response = await Reflect.apply(baseFetch, this, [input, init]);
          safely(() => {
            responses = add(responses);
            let status: unknown;
            try { status = response.status; } catch { failed(); }
            const bucket = !numeric(status) ? 'unknown' : STATUS.find(key => key === String(status)) ?? 'other';
            statuses[bucket] = add(statuses[bucket]);
          });
          return response; // Never clone or consume the body.
        } catch (error) {
          safely(() => { transportThrows = add(transportThrows); });
          throw error; // Preserve the exact value for the SDK's retry/error handling.
        }
      };
      installed = true;
      return wrapped;
    },
    installationFailed() { installationFailures = add(installationFailures); },
    usage(value: unknown) {
      // Each field has its own isolation: one bad getter cannot hide the other unknowns.
      usageRecords = add(usageRecords);
      const usage = value as { input_tokens?: unknown; output_tokens?: unknown; cache_read_input_tokens?: unknown; cache_creation_input_tokens?: unknown; cache_creation?: { ephemeral_1h_input_tokens?: unknown; ephemeral_5m_input_tokens?: unknown }; server_tool_use?: { web_search_requests?: unknown } } | null | undefined;
      const fields: Record<UsageField, () => unknown> = {
        inputTokens: () => usage?.input_tokens, outputTokens: () => usage?.output_tokens,
        cacheReadTokens: () => usage?.cache_read_input_tokens, cacheCreationTokens: () => usage?.cache_creation_input_tokens,
        cacheCreation1hTokens: () => usage?.cache_creation?.ephemeral_1h_input_tokens,
        cacheCreation5mTokens: () => usage?.cache_creation?.ephemeral_5m_input_tokens,
        serverWebSearchRequests: () => usage?.server_tool_use?.web_search_requests,
      };
      for (const key of USAGE) safely(() => {
        let number: unknown;
        try { number = fields[key](); } catch { failed(); }
        usageValue(key, number);
      });
    },
    snapshot() {
      return {
        scope: 'reply_client_process' as const, persistence: 'none' as const,
        // Uninstalled attempts are unavailable, never an invented zero measurement.
        transport: { installed, starts: installed ? starts : null, responses: installed ? responses : null,
          throws: installed ? transportThrows : null, statuses: installed ? { ...statuses } : null, sdkRetryOrdinals: installed ? { ...retries } : null },
        usage: { records: usageRecords, ...Object.fromEntries(USAGE.map(key => [key, { ...totals[key] }])) } as { records: number } & Record<UsageField, UsageTotal>,
        measurement: { installationFailures, failedObservations, saturated },
      };
    },
  };
}

const replyObservation = createProviderObservation();
/** Undefined preserves the SDK's own default fetch after any installation failure. */
export function observedReplyFetch(): Fetch | undefined {
  try { return replyObservation.wrapFetch(globalThis.fetch); }
  catch { try { replyObservation.installationFailed(); } catch { /* Fail open. */ } return undefined; }
}
export function observeReplyUsage(usage: unknown): void {
  try { replyObservation.usage(usage); } catch { /* No observation affects spending or decisions. */ }
}
export function replyProviderSnapshot(): ReturnType<typeof replyObservation.snapshot> | null {
  try { return replyObservation.snapshot(); } catch { return null; }
}
