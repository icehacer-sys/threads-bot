// Reveal poll (owner 2026-10-26). The publisher posts the answer about 20 min after the case goes up, and
// every pre-reveal comment is held until then. With a 15 min cadence the held comments could wait up to
// 15 more min after the reveal (2026-10-26: answer at 22:20, next poll at 22:31). After each poll the bot
// leaves the time the answer is due in REVEAL_POLL_FILE and reply.yml shortens its nap to land on it.
// The workflow ignores a missing, empty or past time, so a crashed poll falls back to the normal cadence.
import { rmSync, writeFileSync } from "node:fs";

export const REVEAL_POLL_FILE = ".reveal-poll-at";

/** Epoch seconds for the next poll of a case post whose answer is not public yet, or null. */
export function revealPollAt(postTimestamp: string, nowMs: number, delayMin: number, graceSec = 60, retrySec = 180, giveUpMin = 30): number | null {
  const posted = Date.parse(postTimestamp);
  if (!Number.isFinite(posted) || delayMin <= 0) return null;
  const due = posted + delayMin * 60_000 + graceSec * 1000;
  if (nowMs < due) return Math.ceil(due / 1000);
  // The publisher is late: recheck on a short interval for a bounded time, then the normal cadence resumes.
  if (nowMs < posted + (delayMin + giveUpMin) * 60_000) return Math.ceil((nowMs + retrySec * 1000) / 1000);
  return null;
}

/** Write the earliest due time, or remove the file. Never fails the poll. */
export function writeRevealPoll(times: number[], file = REVEAL_POLL_FILE): void {
  try {
    if (times.length) writeFileSync(file, `${Math.min(...times)}\n`);
    else rmSync(file, { force: true });
  } catch (err) {
    console.error(`  ! reveal poll hint not written: ${(err as Error).message}`);
  }
}
