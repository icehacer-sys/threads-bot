// Per-call cost accounting.
//
// Nothing in the bot used to know what it had spent, so a night could quietly drain the API
// balance and the first sign was a billing page. Every messages.create() now reports its usage
// here; index.ts reads the running total to degrade gracefully (stop escalating, then stop
// replying) instead of spending past the budget.
//
// Rates are $ per MILLION tokens, from the Anthropic pricing table. The cache multipliers are
// derived from the base input rate and were verified against a real 18-day usage export:
// read = 0.1x, 5m write = 1.25x, 1h write = 2x.

interface ModelPrice {
  input: number;
  output: number;
}

const PRICES: Record<string, ModelPrice> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-fable-5": { input: 10, output: 50 },
};

// Sonnet 5 launched on introductory pricing ($2/$10) through 2026-08-31, after which it goes to
// the standard $3/$15 above. Without this the meter over-charged the weekly voice audit by ~40%
// (caught by tools/verify-spend.mts against the real August export). The cutover is by date, so
// this correctly stops applying on its own — no follow-up edit needed.
const SONNET_5_INTRO_UNTIL = Date.parse("2026-09-01T00:00:00Z");
function introOverride(model: string, now: number): ModelPrice | null {
  if (model.startsWith("claude-sonnet-5") && now < SONNET_5_INTRO_UNTIL) return { input: 2, output: 10 };
  return null;
}

// Model ids may carry a date suffix (claude-haiku-4-5-20251001). Match the longest known
// prefix so a dated snapshot prices the same as its base model.
function priceFor(model: string, now: number = Date.now()): ModelPrice {
  const intro = introOverride(model, now);
  if (intro) return intro;
  let best: ModelPrice | null = null;
  let bestLen = 0;
  for (const [key, price] of Object.entries(PRICES)) {
    if (model.startsWith(key) && key.length > bestLen) {
      best = price;
      bestLen = key.length;
    }
  }
  // Unknown model -> price it as Sonnet. Over-estimating an unknown is the safe direction:
  // the budget gate trips early rather than letting an unpriced model spend invisibly.
  return best ?? { input: 3, output: 15 };
}

// Structural shape rather than the SDK's Usage type: the cache_creation split is a newer
// field and we want this to keep compiling (and pricing) across SDK versions.
export interface CallUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: {
    ephemeral_1h_input_tokens?: number | null;
    ephemeral_5m_input_tokens?: number | null;
  } | null;
}

const n = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Exact USD cost of one API call, from the usage block the API returns. */
export function costOf(model: string, usage: CallUsage | null | undefined, now: number = Date.now()): number {
  if (!usage) return 0;
  const p = priceFor(model, now);
  const write1h = n(usage.cache_creation?.ephemeral_1h_input_tokens);
  const write5m = n(usage.cache_creation?.ephemeral_5m_input_tokens);
  // Older SDKs report only the total, with no 5m/1h split. Since 2026-08-27 the bot writes at
  // BOTH TTLs (Haiku 1h, Sonnet 5m — see cacheTtl in reply.ts), so an unsplit total is
  // ambiguous; price it at the higher 1h rate. Over-estimating an unknown is the safe
  // direction: the budget gate trips early rather than letting spend run past the cap.
  const split = write1h + write5m;
  const total = n(usage.cache_creation_input_tokens);
  const unsplit = split > 0 ? 0 : total;

  const inputUsd =
    (n(usage.input_tokens) * p.input +
      n(usage.cache_read_input_tokens) * p.input * 0.1 +
      (write1h + unsplit) * p.input * 2.0 +
      write5m * p.input * 1.25) /
    1_000_000;
  const outputUsd = (n(usage.output_tokens) * p.output) / 1_000_000;
  return inputUsd + outputUsd;
}

// --- process-local accumulator -------------------------------------------------------------
// reply.ts records into this; index.ts drains it after each classification and folds the
// amount into the persisted per-day total. Keeping reply.ts free of state.ts keeps the
// classifier a pure function of its input (demo mode has no state file).

let pending = 0;
let calls = 0;

export function recordUsage(model: string, usage: CallUsage | null | undefined): void {
  pending += costOf(model, usage);
  calls += 1;
}

/** Take everything recorded since the last drain: { usd, calls }. Resets the accumulator. */
export function drainSpend(): { usd: number; calls: number } {
  const out = { usd: pending, calls };
  pending = 0;
  calls = 0;
  return out;
}

export const usd = (v: number): string => `$${v.toFixed(4)}`;
