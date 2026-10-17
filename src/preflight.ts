// Pre-window credit check: prove the reply provider's key can actually spend BEFORE the night starts.
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
// Neither provider exposes a balance endpoint we rely on, so the only honest probe is a real request:
// the smallest one the API accepts (1 output token, no system prompt, no tools, no cache write).
//
// WHICH key gates the window depends on the provider (owner decision A, 2026-10-17):
//   deepseek-all  DeepSeek answers every reply, so the DeepSeek probe is the gate: 401/402/403 is FATAL.
//                 The Anthropic key only powers the idle Haiku fallback; if it cannot spend, that is a
//                 loud WARN (the fallback is unavailable tonight), never a window-blocking failure.
//   other modes   Claude still answers search or everything, so the Claude probe gates as before and
//                 a DeepSeek failure is a warning.
//
// Exit codes are deliberately the same vocabulary the live path uses, so reply.yml can branch on
// them without a second convention:
//   0  credit is good, or the probe could not reach a verdict (see the transient note below)
//   3  FATAL: billing/auth on the gating provider. A human must fix this before the window opens.
//
// Run: npm run preflight

import Anthropic from "@anthropic-ai/sdk";
import { pathToFileURL } from "node:url";
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

type Verdict = "pass" | "fatal" | "transient";

// DeepSeek reports an empty balance as HTTP 402 and a bad key as 401 (403 for a revoked one).
async function probeDeepSeek(): Promise<Verdict> {
  const started = Date.now();
  let key: string;
  try { key = requireEnv("DEEPSEEK_API_KEY"); }
  catch (err) { console.error(`  FAIL — DeepSeek: ${describe(err)}`); return "fatal"; }
  try {
    await new Anthropic({ apiKey: key, authToken: null, baseURL: "https://api.deepseek.com/anthropic", maxRetries: 2 }).messages.create({
      model: "deepseek-flash", max_tokens: 1, thinking: { type: "disabled" }, messages: [{ role: "user", content: "ok" }],
    } as never);
    console.log(`  PASS — DeepSeek key can spend (${Date.now() - started}ms).`);
    return "pass";
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    if (status === 401 || status === 402 || status === 403) {
      console.error(`  FAIL — DeepSeek ${status === 402 ? "balance exhausted" : "key rejected"}: ${describe(err).slice(0, 200)}`);
      return "fatal";
    }
    console.warn(`  WARN — DeepSeek transient error, not treating as a credit failure: ${describe(err).slice(0, 200)}`);
    return "transient";
  }
}

async function probeClaude(model: string): Promise<Verdict> {
  const started = Date.now();
  let key: string;
  try { key = requireEnv("ANTHROPIC_API_KEY"); }
  catch (err) { console.error(`  FAIL — Anthropic: ${describe(err)}`); return "fatal"; }
  try {
    // max_tokens 1: the response is truncated immediately, so this bills ~10 input + 1 output
    // token. No system prompt and no tools, so it shares no cache prefix with the live path and
    // cannot perturb the night's cache hit rate. Haiku 5.5 thinks by default; turn it off so the
    // single token is not spent on reasoning (accepted at its default medium effort).
    await new Anthropic({ apiKey: key, maxRetries: 2 }).messages.create({
      model,
      max_tokens: 1,
      ...(/^claude-haiku-5-5/.test(model) ? { thinking: { type: "disabled" as const } } : {}),
      messages: [{ role: "user", content: "ok" }],
    });
    console.log(`  PASS — the Anthropic key can spend on ${model} (${Date.now() - started}ms).`);
    return "pass";
  } catch (err) {
    if (isFatalApiError(err)) {
      console.error(`  FAIL — Anthropic billing/auth: ${describe(err).slice(0, 200)}`);
      return "fatal";
    }
    // Transient. Say so plainly and pass: the window opens, and the live path re-checks on every
    // real call anyway.
    console.warn(`  WARN — Anthropic transient error, not treating as a credit failure: ${describe(err).slice(0, 200)}`);
    return "transient";
  }
}

/** Returns the process exit code: 0 clear (or inconclusive), 3 fatal on the gating provider. */
export async function preflight(): Promise<number> {
  const cairoNow = config.activeTz
    ? new Intl.DateTimeFormat("en-GB", { timeZone: config.activeTz, timeStyle: "short" }).format(new Date())
    : new Date().toISOString().slice(11, 16);

  if (config.replyProvider === "deepseek-all") {
    console.log(`Pre-flight credit check — ${cairoNow}${config.activeTz ? ` ${config.activeTz}` : ""}, gate deepseek-flash, fallback ${config.fallbackModel}`);
    if (await probeDeepSeek() === "fatal") return 3;
    const fallback = await probeClaude(config.fallbackModel);
    if (fallback === "fatal") {
      console.warn(`::warning::The Anthropic key cannot spend, so the ${config.fallbackModel} fallback is unavailable tonight. DeepSeek still answers every reply; a DeepSeek failure leaves those comments for the next poll.`);
    }
    console.log("  Window is clear to open.");
    return 0;
  }

  console.log(`Pre-flight credit check — ${cairoNow}${config.activeTz ? ` ${config.activeTz}` : ""}, model ${config.triageModel}`);
  if (await probeClaude(config.triageModel) === "fatal") return 3;
  // While Claude still answers every request DeepSeek cannot, a DeepSeek failure is a loud warning rather
  // than a window-blocking FAIL; the live path then falls back to Claude.
  if (config.deepSeekTrial && await probeDeepSeek() === "fatal") {
    console.warn("  WARN — DeepSeek cannot spend. Replies fall back to Claude until fixed.");
  }
  console.log("  Window is clear to open.");
  return 0;
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  preflight().then((code) => { process.exitCode = code; }).catch((err) => {
    // An unexpected throw here (a bad import, a malformed config) is a bug in this script, not a
    // verdict about the balance. Exit 1, which reply.yml treats as "check inconclusive, carry on".
    console.error(`preflight crashed: ${describe(err)}`);
    process.exitCode = 1;
  });
}
