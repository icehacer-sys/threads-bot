// Pre-window credit check: prove the Anthropic key can actually spend BEFORE the night starts.
//
// On 2026-09-08 the credit balance hit zero at 23:12 Cairo, ~70 minutes into the window. The bot
// behaved correctly -- it detected the fatal error, surfaced it, and kept the chain alive -- but
// the only alarm was a failing Actions job, and by then the post had been up long enough to
// collect its comments. 105 of them went unanswered across 9.5 hours and 14 dead runs, and the
// night ended on 30 replies instead of the usual 60-220.
//
// The fix is not better recovery, it is earlier warning. A single cheap call a few minutes before
// the window opens turns "the bot died mid-night and you found out from an email at 02:00" into
// "top up the balance before the post goes up". The failure mode this guards is specifically the
// SLOW one: credit that ran out hours ago and will still be out at 22:00.
//
// Anthropic exposes no balance endpoint, so the only honest probe is a real request. This sends
// the smallest one the API accepts (1 output token to the cheap triage model, no cache write) and
// reads the result the same way the live path does, via isFatalApiError. Cost is ~$0.00002 --
// roughly a thousandth of one reply.
//
// Exit codes are deliberately the same vocabulary the live path uses, so reply.yml can branch on
// them without a second convention:
//   0  credit is good, or the probe could not reach a verdict (see the transient note below)
//   3  FATAL: billing/auth. A human must fix this before the window opens.
//
// Run: npm run preflight

import Anthropic from "@anthropic-ai/sdk";
import { config, requireEnv } from "./config";
import { isFatalApiError } from "./reply";

// Never fail the check on a transient error. A 429/5xx/network blip says nothing about the
// balance, and an alarm that cries wolf on a bad minute is an alarm the owner learns to ignore --
// which would cost more than the outage this exists to catch. Transient means exit 0 with a
// warning: the live path's own fatal detection is still there as the backstop.
function describe(err: unknown): string {
  const status = (err as { status?: number } | null)?.status;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  // The SDK already prefixes its message with the status ("401 {...}"), so only add it when the
  // message does not carry it — otherwise the alarm line reads "401 401 {...}".
  return status && !msg.startsWith(String(status)) ? `${status} ${msg}` : msg;
}

async function main(): Promise<void> {
  const cairoNow = config.activeTz
    ? new Intl.DateTimeFormat("en-GB", { timeZone: config.activeTz, timeStyle: "short" }).format(new Date())
    : new Date().toISOString().slice(11, 16);

  console.log(`Pre-flight credit check — ${cairoNow}${config.activeTz ? ` ${config.activeTz}` : ""}, model ${config.triageModel}`);

  let key: string;
  try {
    key = requireEnv("ANTHROPIC_API_KEY");
  } catch (err) {
    // A missing key is not transient and not recoverable by waiting. Treat it as fatal so the
    // window does not open on a bot that cannot make a single call.
    console.error(`  FAIL — ${describe(err)}`);
    process.exitCode = 3;
    return;
  }

  const started = Date.now();
  try {
    // max_tokens 1: the response is truncated immediately, so this bills ~10 input + 1 output
    // token. No system prompt and no tools, so it shares no cache prefix with the live path and
    // cannot perturb the night's cache hit rate.
    await new Anthropic({ apiKey: key, maxRetries: 2 }).messages.create({
      model: config.triageModel,
      max_tokens: 1,
      messages: [{ role: "user", content: "ok" }],
    });
  } catch (err) {
    if (isFatalApiError(err)) {
      console.error(`  FAIL — billing/auth: ${describe(err).slice(0, 200)}`);
      process.exitCode = 3;
      return;
    }
    // Transient. Say so plainly and pass: the window opens, and the live path re-checks on every
    // real call anyway.
    console.warn(`  WARN — transient error, not treating as a credit failure: ${describe(err).slice(0, 200)}`);
    return;
  }

  console.log(`  PASS — the key can spend (${Date.now() - started}ms). Window is clear to open.`);
}

main().catch((err) => {
  // An unexpected throw here (a bad import, a malformed config) is a bug in this script, not a
  // verdict about the balance. Exit 1, which reply.yml treats as "check inconclusive, carry on".
  console.error(`preflight crashed: ${describe(err)}`);
  process.exitCode = 1;
});
