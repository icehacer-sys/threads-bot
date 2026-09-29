import { execFileSync } from "node:child_process";
import { writeFileSync, renameSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export class PersistenceError extends Error {}

export function atomicJson(file: string, value: unknown): void {
  try {
    writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2) + "\n");
    renameSync(`${file}.tmp`, file);
  } catch (err) {
    throw new PersistenceError(`Cannot persist ${file}: ${String(err)}`);
  }
}

function isBranchContention(err: unknown, branch: string): boolean {
  const failure = err as { status?: number; signal?: unknown; stderr?: unknown } | null;
  if (!failure || failure.status !== 1 || failure.signal) return false;
  const stderr = typeof failure.stderr === "string" ? failure.stderr : Buffer.isBuffer(failure.stderr) ? failure.stderr.toString("utf8") : "";
  if (/fatal:|authentication failed|permission denied|could not resolve|connection (?:was )?(?:failed|refused|timed out|reset|closed|aborted)|RPC failed|(?:recv|send) failure|unexpected disconnect|remote end hung up|failed to connect|could not connect|(?:SSL|TLS) (?:connect|certificate|handshake)/i.test(stderr)) return false;
  const lines = stderr.split(/\r?\n/);
  if (lines.some(line => /^(?:remote:\s*)?(?:error|fatal):/i.test(line.trim()) && !/^error: failed to push some refs to /i.test(line.trim()))) return false;
  const rejections = lines.filter(line => /\[(?:remote )?rejected\]/.test(line));
  if (rejections.length !== 1) return false;
  const target = branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*!?\\s*\\[rejected\\]\\s+HEAD\\s+->\\s+${target}\\s+\\((?:fetch first|non-fast-forward)\\)\\s*$`).test(rejections[0]) ||
    new RegExp(`^\\s*!?\\s*\\[remote rejected\\]\\s+HEAD\\s+->\\s+${target}\\s+\\(cannot lock ref 'refs/heads/${target}': is at [a-f0-9]{40,64} but expected [a-f0-9]{40,64}\\)\\s*$`).test(rejections[0]);
}

/** Before publishing in CI, make the container recoverable by the next checkout. */
export function checkpointState(file: string, git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: "pipe", timeout: 60_000 })): void {
  if (process.env.GITHUB_ACTIONS !== "true") return;
  let stage = "context";
  let attempt = 0;
  let reason = "operation-failed";
  try {
    const branch = process.env.GITHUB_REF_NAME;
    if (!branch) throw new Error("GITHUB_REF_NAME is missing");
    const path = resolve(file);
    stage = "read-state";
    const expected = readFileSync(path);
    stage = "status";
    if (git("status", "--porcelain", "--", path).trim()) {
      stage = "add";
      git("add", "--", path);
      stage = "commit";
      git("commit", "--only", "-m", "fix(state): checkpoint publication [skip ci]", "--", path);
    }
    for (attempt = 1; attempt <= 3; attempt++) {
      stage = "rebase";
      git("pull", "--rebase", "--autostash", "origin", branch);
      stage = "conflict-check";
      if (git("ls-files", "--unmerged").trim()) {
        reason = "unmerged-state";
        throw new Error("Unmerged files");
      }
      stage = "state-check";
      if (!readFileSync(path).equals(expected)) {
        reason = "state-changed";
        throw new Error("Publication state changed");
      }
      stage = "push";
      try {
        git("push", "origin", `HEAD:${branch}`);
        return;
      } catch (err) {
        if (!isBranchContention(err, branch)) {
          reason = "push-not-retryable";
          throw err;
        }
        if (attempt === 3) {
          reason = "contention-exhausted";
          throw err;
        }
        console.warn(`Publication checkpoint retry: stage=push attempt=${attempt}/3 reason=branch-contention`);
      }
    }
  } catch {
    try { git("rebase", "--abort"); } catch { /* no rebase in progress */ }
    throw new PersistenceError(`Publication checkpoint failed; stopping public writes: stage=${stage} attempt=${attempt}/3 reason=${reason}`);
  }
}

export interface Publication {
  creationId: string;
  createdAt: string;
  params: Record<string, string>;
  publishedId?: string;
  publishedAt?: string;
  confirmedPublished?: boolean;
}

export interface PublicationStore {
  get(): Publication | undefined;
  set(value: Publication): void;
}

export function validPublications(value: unknown): value is Record<string, Publication> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((p) => p && typeof p === "object" &&
    typeof p.creationId === "string" && p.creationId.length > 0 &&
    typeof p.createdAt === "string" && Number.isFinite(Date.parse(p.createdAt)) &&
    p.params && typeof p.params === "object" && !Array.isArray(p.params) &&
    Object.values(p.params).every((v) => typeof v === "string") &&
    (p.publishedId === undefined || (typeof p.publishedId === "string" && p.publishedId.length > 0)) &&
    (p.publishedAt === undefined || (typeof p.publishedAt === "string" && Number.isFinite(Date.parse(p.publishedAt)))) &&
    (p.confirmedPublished === undefined || typeof p.confirmedPublished === "boolean"));
}
