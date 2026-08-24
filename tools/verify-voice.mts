// Guards against the class of bug found on 2026-08-24: the per-call instructions built in
// reply.ts handed the model the exact phrases voice.ts RETIRES, and won — a per-call note sits
// next to the comment while the voice prompt is thousands of tokens back in the cached prefix.
//
// The signal that matters is PRESCRIPTION, not mention: a retired phrase offered to the model as
// an "e.g." example. Listing one in a prohibition ("NEVER say X") or in a blocklist regex is
// correct and must not trip this. Validated below against the real pre-fix source.
//
//   npm run voice:verify        (free — pure string checks, no API calls)
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, "..", p), "utf8");
const voices = [read("src/voice-lean.ts"), read("src/voice-full.ts")].join("\n").toLowerCase();

const RETIRED = [
  "wait for the reveal", "sit tight", "radiologically confirmed",
  "origin story nobody asked for", "officially my new favorite",
  "a logical guess", "a reasonable guess", "a reasonable instinct",
  "honestly fair", "no notes", "big mood",
];

/** Lines where a retired phrase is offered as an example the model should copy. */
function prescriptions(src: string): { phrase: string; line: number; text: string }[] {
  const out: { phrase: string; line: number; text: string }[] = [];
  src.split("\n").forEach((raw, i) => {
    const line = raw.toLowerCase();
    const eg = line.indexOf("e.g.");
    if (eg === -1) return; // only an example list can prescribe
    for (const p of RETIRED) {
      if (!voices.includes(p)) continue; // not actually retired
      const at = line.indexOf(p, eg);
      if (at > -1) out.push({ phrase: p, line: i + 1, text: raw.trim().slice(0, 100) });
    }
  });
  return out;
}

let fail = 0;
console.log("=== reply.ts must not offer a retired phrase as an example ===");
const hits = prescriptions(read("src/reply.ts"));
if (hits.length === 0) console.log("  PASS  no retired phrase is prescribed in reply.ts");
for (const h of hits) { fail++; console.log(`  FAIL  reply.ts:${h.line} prescribes "${h.phrase}"\n        ${h.text}`); }

console.log("\n=== the pre-reveal note tells the model to engage, not stall ===");
const replyTs = read("src/reply.ts");
for (const s of ["NEVER stall", "Vary it every time"]) {
  const ok = replyTs.includes(s);
  if (!ok) fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  contains "${s}"`);
}

// Self-test: the checker must actually catch the real bug it was written for.
console.log("\n=== self-test against the pre-fix source (must detect the original bug) ===");
try {
  const before = execSync("git show 3933e32:src/reply.ts", { encoding: "utf8", maxBuffer: 32e6 });
  const found = prescriptions(before);
  const ok = found.some((h) => h.phrase === "wait for the reveal");
  if (!ok) fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  detects the retired stall in the pre-fix reply.ts (${found.length} hit(s))`);
} catch {
  console.log("  SKIP  pre-fix revision unavailable");
}

console.log(fail ? `\n${fail} check(s) FAILED` : "\nvoice.ts and reply.ts agree — no retired phrase is prescribed");
process.exit(fail ? 1 : 0);
