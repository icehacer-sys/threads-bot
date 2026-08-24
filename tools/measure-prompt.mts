// Measures the CACHED PREFIX the bot sends on every classification — the tool schema plus the
// system prompt — under each BOT_VOICE / BOT_GIF_REPLIES combination. That prefix is re-sent on
// every model call, so its token count is the single biggest multiplier on the API bill.
//
//   npx tsx tools/measure-prompt.mts
//
// Uses the real count_tokens endpoint when ANTHROPIC_API_KEY is available (that endpoint is
// free), falling back to a chars/4.1 estimate. Each combination runs in its own child process
// because config.ts reads the env once at module load.

import Anthropic from "@anthropic-ai/sdk";
import { config as loadEnv } from "dotenv";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(here, "..", ".env"), quiet: true });

// Calibrated against a real count_tokens run on this exact prompt (45,920 chars -> 12,596
// tokens = 3.65 chars/token). The old 4.1 divisor under-counted by ~11%, which made a
// measured number look like prompt drift when nothing had actually changed.
const est = (s: string) => Math.round(s.length / 3.65);

// --- child mode: report the prefix size for whatever env this process was given -------------
if (process.env.MEASURE_ONE) {
  const { SYSTEM_PROMPT } = await import("../src/voice");
  const { PRODUCTS_BLOCK } = await import("../src/products");
  const { REPLY_TOOLS } = await import("../src/reply");
  const system = SYSTEM_PROMPT + PRODUCTS_BLOCK;
  let out: number | null = null;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const r = await new Anthropic().messages.countTokens({
        model: "claude-haiku-4-5",
        system,
        tools: REPLY_TOOLS as never,
        messages: [{ role: "user", content: "x" }],
      });
      out = r.input_tokens;
    } catch {
      out = null;
    }
  }
  const measured = out !== null;
  console.log(JSON.stringify({ tokens: out ?? est(system) + est(JSON.stringify(REPLY_TOOLS)), measured }));
  process.exit(0);
}

// --- parent mode ----------------------------------------------------------------------------
const run = promisify(execFile);
const combos: Array<[string, string, string]> = [
  ["full voice, gifs on  (original)", "full", "on"],
  ["full voice, gifs off", "full", "off"],
  ["lean voice, gifs on", "lean", "on"],
  ["lean voice, gifs off (shipping)", "lean", "off"],
];

let baseline = 0;
for (const [label, voice, gifs] of combos) {
  const { stdout } = await run(
    process.execPath,
    [join(here, "..", "node_modules", "tsx", "dist", "cli.mjs"), fileURLToPath(import.meta.url)],
    { env: { ...process.env, MEASURE_ONE: "1", BOT_VOICE: voice, BOT_GIF_REPLIES: gifs } },
  );
  const { tokens, measured } = JSON.parse(stdout.trim().split("\n").pop() as string);
  if (!baseline) baseline = tokens;
  const delta = tokens === baseline ? "" : `   ${(100 * (tokens / baseline - 1)).toFixed(1)}%`;
  console.log(`${label.padEnd(34)} ${String(tokens).padStart(6)} tok${measured ? "" : " (est)"}${delta}`);
}
