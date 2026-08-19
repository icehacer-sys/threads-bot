// Checks spend.ts against REAL rows from the Anthropic usage export, so the budget gate is
// pricing calls correctly rather than approximately.
//
//   npx tsx tools/verify-spend.mts
//
// Each case is one model-day lifted from claude_api_tokens_2026_08.csv, with the expected cost
// taken from the matching rows of claude_api_cost_2026_08_01_to_2026_08_19.csv (which are
// rounded to the cent, hence the 1c tolerance).

import { costOf } from "../src/spend";

interface Case {
  label: string;
  model: string;
  usage: Parameters<typeof costOf>[1];
  expected: number;
  /** Pin the clock: Sonnet 5 intro pricing is date-bounded. */
  at?: string;
}

const cases: Case[] = [
  {
    label: "2026-08-06 Haiku 4.5 (busiest night: 0.19+0.04+0.41+0.35)",
    model: "claude-haiku-4-5-20251001",
    usage: {
      input_tokens: 188090,
      cache_creation: { ephemeral_1h_input_tokens: 18134, ephemeral_5m_input_tokens: 0 },
      cache_read_input_tokens: 4117729,
      output_tokens: 69753,
    },
    expected: 0.99,
  },
  {
    label: "2026-08-06 Sonnet 4.6 (0.15+0.03+0.24+0.34+0.27)",
    model: "claude-sonnet-4-6",
    usage: {
      input_tokens: 51403,
      cache_creation: { ephemeral_5m_input_tokens: 6933, ephemeral_1h_input_tokens: 39515 },
      cache_read_input_tokens: 1145475,
      output_tokens: 18001,
    },
    expected: 1.03,
  },
  {
    label: "2026-08-17 Sonnet 5 voice audit (0.07+0.06)",
    model: "claude-sonnet-5",
    usage: { input_tokens: 32787, output_tokens: 5739 },
    expected: 0.13,
    at: "2026-08-17T12:00:00Z", // inside the intro-pricing window
  },
  {
    label: "Sonnet 5 after the intro window reverts to standard $3/$15",
    model: "claude-sonnet-5",
    usage: { input_tokens: 32787, output_tokens: 5739 },
    expected: 0.18,
    at: "2026-09-02T12:00:00Z",
  },
  {
    label: "unsplit cache_creation_input_tokens falls back to the 1h rate",
    model: "claude-haiku-4-5-20251001",
    usage: { cache_creation_input_tokens: 1_000_000 },
    expected: 2.0,
  },
  {
    label: "empty usage is free, not NaN",
    model: "claude-haiku-4-5-20251001",
    usage: {},
    expected: 0,
  },
];

let failed = 0;
for (const c of cases) {
  const got = costOf(c.model, c.usage, c.at ? Date.parse(c.at) : Date.now());
  const ok = Math.abs(got - c.expected) <= 0.011;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.label}\n      expected $${c.expected.toFixed(2)}  got $${got.toFixed(4)}`);
}
console.log(failed ? `\n${failed} case(s) FAILED` : "\nall cases pass — pricing matches the real billing export");
process.exit(failed ? 1 : 0);
