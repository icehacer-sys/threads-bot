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

/** Before publishing in CI, make the container recoverable by the next checkout. */
export function checkpointState(file: string): void {
  if (process.env.GITHUB_ACTIONS !== "true") return;
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: "pipe", timeout: 60_000 });
  try {
    const branch = process.env.GITHUB_REF_NAME;
    if (!branch) throw new Error("GITHUB_REF_NAME is missing");
    const path = resolve(file);
    const expected = readFileSync(path, "utf8");
    if (git("status", "--porcelain", "--", path).trim()) {
      git("add", "--", path);
      git("commit", "--only", "-m", "fix(state): checkpoint publication [skip ci]", "--", path);
    }
    git("pull", "--rebase", "--autostash", "origin", branch);
    if (git("ls-files", "--unmerged").trim() || readFileSync(path, "utf8") !== expected) {
      throw new Error("Git sync changed publication state or left a conflict; reload before continuing");
    }
    git("push", "origin", `HEAD:${branch}`);
  } catch (err) {
    try { git("rebase", "--abort"); } catch { /* no rebase in progress */ }
    throw new PersistenceError(`Publication checkpoint failed; stopping public writes: ${String(err)}`);
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
