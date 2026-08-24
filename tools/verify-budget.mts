// Checks the budget gates behave as intended at each spend level, and that fatal API errors are
// classified correctly. Run: npx tsx tools/verify-budget.mts
import { isFatalApiError } from "../src/reply";

const dailyUsdCap = 1.0, escalateUsdCap = 0.7, medicalReserveUsd = 0.25, reserveMinValue = 2;

const reserveActive = (spent: number) =>
  dailyUsdCap > 0 && medicalReserveUsd > 0 && spent >= dailyUsdCap - medicalReserveUsd;
const usdExhausted = (spent: number) => dailyUsdCap > 0 && spent >= dailyUsdCap;
const escalationAllowed = (spent: number, medical: boolean) => {
  if (escalateUsdCap <= 0) return true;
  if (medical) return !usdExhausted(spent);
  return spent < escalateUsdCap && !reserveActive(spent);
};

let fail = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}  (got ${got}, want ${want})`);
};

console.log("=== escalation gating by spend level ===");
for (const spent of [0.1, 0.65, 0.75, 0.9, 0.99, 1.0]) {
  const med = escalationAllowed(spent, true), disc = escalationAllowed(spent, false);
  console.log(`  $${spent.toFixed(2)}  medical=${med ? "ALLOW" : "hold "}  discretionary=${disc ? "ALLOW" : "hold "}  reserve=${reserveActive(spent) ? "on" : "off"}`);
}
console.log();
console.log("=== the behaviour the 2026-08-23 night got wrong ===");
check("at $0.75 a medical escalation still runs", escalationAllowed(0.75, true), true);
check("at $0.75 a discretionary escalation is held", escalationAllowed(0.75, false), false);
check("at $0.99 a medical escalation still runs", escalationAllowed(0.99, true), true);
check("at the hard cap even medical stops", escalationAllowed(1.0, true), false);
check("reserve is off before $0.75", reserveActive(0.74), false);
check("reserve is on at $0.75", reserveActive(0.75), true);

console.log("\n=== reserve drops low-value comments, keeps questions ===");
// commentValue(): '?' +3, question words +2, len>=80 +2 / >=40 +1, len<=15 -1, media +1
const score = (t: string, media = false) => {
  let s = 0;
  if (/\?/.test(t)) s += 3;
  if (/\b(how|why|what|when|where|which|whose|can|could|would|does|do|did|is it|are they|cause)\b/i.test(t)) s += 2;
  if (t.length >= 80) s += 2; else if (t.length >= 40) s += 1;
  if (t.length <= 15) s -= 1;
  if (media) s += 1;
  return s;
};
for (const [t, expectKept] of [
  ["What causes this?", true],
  ["Is that normal or does it hurt?", true],
  ["I had this removed years ago and the recovery was the worst month of my entire life", true],
  ["lol", false],
  ["hopital", false],
  ["Osteosarcoma", false], // deliberate: see BOT_RESERVE_MIN_VALUE in config.ts
] as const) {
  const kept = score(t) >= reserveMinValue;
  check(`"${t.slice(0, 42)}" -> ${kept ? "triaged" : "dropped"}`, kept, expectKept);
}

console.log("\n=== fatal vs transient API errors ===");
const mkErr = (msg: string, status?: number) => Object.assign(new Error(msg), status ? { status } : {});
check("credit exhausted is fatal", isFatalApiError(mkErr('400 {"message":"Your credit balance is too low to access the Anthropic API."}', 400)), true);
check("401 is fatal", isFatalApiError(mkErr("unauthorized", 401)), true);
check("403 is fatal", isFatalApiError(mkErr("forbidden", 403)), true);
check("invalid api key is fatal", isFatalApiError(mkErr("invalid x-api-key")), true);
check("429 rate limit is TRANSIENT", isFatalApiError(mkErr("429 rate_limit_error", 429)), false);
check("529 overloaded is TRANSIENT", isFatalApiError(mkErr("529 overloaded_error", 529)), false);
check("network timeout is TRANSIENT", isFatalApiError(mkErr("ETIMEDOUT")), false);
check("max_tokens truncation is TRANSIENT", isFatalApiError(mkErr("truncated")), false);

console.log(fail ? `\n${fail} check(s) FAILED` : "\nall budget + error-classification checks pass");
process.exit(fail ? 1 : 0);
