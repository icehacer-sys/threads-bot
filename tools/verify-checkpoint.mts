// Isolated local Git fixtures. No real remotes, model calls, credentials or public writes.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkpointState, PersistenceError, type Publication, type PublicationStore } from "../src/persistence";

process.env.GITHUB_ACTIONS = "true";
process.env.GITHUB_REF_NAME = "main";
process.env.THREADS_ACCESS_TOKEN = "offline-checkpoint-fixture";
globalThis.fetch = async () => { throw new Error("Unexpected HTTP call in checkpoint fixture"); };
const { postReply } = await import("../src/threads");

const fixtureReceipt: Publication = {
  creationId: "saved-container", createdAt: "2026-09-30T00:00:00.000Z",
  params: { media_type: "TEXT", text: "Offline fixture reply", reply_to_id: "fixture-comment" },
};
const run = (cwd: string, ...args: string[]) => execFileSync("git", args, {
  cwd, encoding: "utf8", stdio: "pipe", timeout: 20_000,
});
const writeState = (file: string, value: unknown) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const configure = (dir: string) => {
  run(dir, "config", "user.name", "Checkpoint fixture");
  run(dir, "config", "user.email", "fixture@example.invalid");
  run(dir, "config", "commit.gpgsign", "false");
  run(dir, "config", "core.autocrlf", "false");
  run(dir, "config", "core.hooksPath", join(dir, "empty-hooks"));
};

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "checkpoint-git-"));
  const origin = join(dir, "origin.git");
  const seed = join(dir, "seed");
  const worker = join(dir, "worker");
  const writer = join(dir, "writer");
  mkdirSync(seed);
  run(dir, "init", "--bare", origin);
  run(origin, "symbolic-ref", "HEAD", "refs/heads/main");
  run(seed, "init", "--initial-branch=main");
  configure(seed);
  const baseline = { receipt: null, padding: Array.from({ length: 32 }, (_, i) => i), remoteCounter: 0 };
  writeState(join(seed, "state.json"), baseline);
  writeFileSync(join(seed, "followers-log.json"), "0\n");
  run(seed, "add", ".");
  run(seed, "commit", "-m", "fixture baseline");
  run(seed, "remote", "add", "origin", origin);
  run(seed, "push", "-u", "origin", "main");
  run(dir, "-c", "core.autocrlf=false", "clone", origin, worker);
  run(dir, "-c", "core.autocrlf=false", "clone", origin, writer);
  configure(worker);
  configure(writer);
  assert.equal(run(worker, "status", "--porcelain"), "", "worker checkout must start clean");
  assert.equal(run(writer, "status", "--porcelain"), "", "competing checkout must start clean");
  const file = join(worker, "state.json");
  writeState(file, { ...baseline, receipt: fixtureReceipt });
  const expected = readFileSync(file);
  let commits = 0;
  let pushes = 0;
  let pulls = 0;
  let beforePush: ((attempt: number) => void) | undefined;
  let intercept: ((args: string[]) => string | undefined) | undefined;
  const git = (...args: string[]): string => {
    if (args[0] === "commit") commits++;
    if (args[0] === "pull") pulls++;
    if (args[0] === "push") { pushes++; beforePush?.(pushes); }
    const replacement = intercept?.(args);
    return replacement ?? run(worker, ...args);
  };
  let update = 0;
  const advance = (kind: "unrelated" | "state" | "conflict") => {
    run(writer, "pull", "--rebase", "origin", "main");
    update++;
    if (kind === "unrelated") writeFileSync(join(writer, "followers-log.json"), `${update}\n`);
    else {
      const state = JSON.parse(readFileSync(join(writer, "state.json"), "utf8"));
      if (kind === "state") state.remoteCounter = update;
      else state.receipt = { ...fixtureReceipt, creationId: "competing-container" };
      writeState(join(writer, "state.json"), state);
    }
    run(writer, "add", ".");
    run(writer, "commit", "-m", `fixture update ${update}`);
    run(writer, "push", "origin", "HEAD:main");
  };
  return { origin, worker, file, expected, git, advance,
    beforePush: (hook: typeof beforePush) => { beforePush = hook; },
    intercept: (hook: typeof intercept) => { intercept = hook; },
    counts: () => ({ commits, pushes, pulls }),
    assertReceipt: () => assert.equal(JSON.parse(readFileSync(file, "utf8")).receipt.creationId, fixtureReceipt.creationId),
  };
}

function failure(stderr: string, status = 1) {
  return Object.assign(new Error("PRIVATE_ERROR https://secret.invalid/token"), { stderr, status, signal: null });
}
const contention = " ! [remote rejected] HEAD -> main (cannot lock ref 'refs/heads/main': is at " + "a".repeat(40) + " but expected " + "b".repeat(40) + ")\nerror: failed to push some refs to 'https://secret.invalid/token'\n";
const checkFailure = (f: ReturnType<typeof fixture>, reason: RegExp) => {
  assert.throws(() => checkpointState(f.file, f.git), (err: unknown) => {
    assert.ok(err instanceof PersistenceError);
    assert.match(err.message, reason);
    assert.doesNotMatch(err.message, /PRIVATE_ERROR|https?:|secret\.invalid|token/);
    return true;
  });
  f.assertReceipt();
};

{
  const f = fixture();
  checkpointState(f.file, f.git);
  assert.deepEqual(f.counts(), { commits: 1, pushes: 1, pulls: 1 });
  assert.ok(readFileSync(f.file).equals(f.expected));
  assert.equal(run(f.origin, "show", "main:state.json"), f.expected.toString("utf8"));
  checkpointState(f.file, f.git);
  assert.equal(f.counts().commits, 1, "clean checkpoint must not create another commit");
  console.log("PASS uncontended checkpoint, exact bytes and already committed receipt");
}
{
  const f = fixture();
  f.beforePush(attempt => { if (attempt === 1) f.advance("unrelated"); });
  checkpointState(f.file, f.git);
  assert.deepEqual(f.counts(), { commits: 1, pushes: 2, pulls: 2 });
  assert.ok(readFileSync(f.file).equals(f.expected));
  assert.equal(run(f.origin, "show", "main:state.json"), f.expected.toString("utf8"));
  console.log("PASS actual competing unrelated writer retries one state commit safely");
}
{
  const f = fixture();
  f.beforePush(attempt => { if (attempt === 1) f.advance("state"); });
  checkFailure(f, /stage=state-check attempt=2\/3 reason=state-changed/);
  assert.deepEqual(f.counts(), { commits: 1, pushes: 1, pulls: 2 });
  console.log("PASS successful rebase that changes state aborts before another push");
}
{
  const f = fixture();
  f.beforePush(attempt => { if (attempt === 1) f.advance("conflict"); });
  checkFailure(f, /stage=rebase attempt=2\/3/);
  assert.ok(readFileSync(f.file).equals(f.expected), "aborting conflict retains original receipt bytes");
  assert.equal(run(f.worker, "ls-files", "--unmerged").trim(), "");
  assert.deepEqual(f.counts(), { commits: 1, pushes: 1, pulls: 2 });
  console.log("PASS conflicting state writer aborts and retains the pending receipt");
}
for (const [label, stderr, status] of [
  ["authentication", "fatal: Authentication failed for 'https://secret.invalid/token'", 128],
  ["network", "fatal: unable to access 'https://secret.invalid/token': Could not resolve host", 128],
  ["unknown rejection", " ! [remote rejected] HEAD -> main (pre-receive hook declined)", 1],
  ["wrong target", " ! [rejected] HEAD -> another-branch (non-fast-forward)", 1],
  ["mixed rejection", contention + " ! [remote rejected] HEAD -> another-branch (permission denied)", 1],
  ["contention plus RPC error", contention + "error: RPC failed; curl 56 Failure when receiving data", 1],
  ["contention plus unknown error", contention + "error: Unclassified failure", 1],
  ["contention plus prefix-free transport failure", contention + "Connection reset by peer", 1],
] as const) {
  const f = fixture();
  f.intercept(args => { if (args[0] === "push") throw failure(stderr, status); });
  checkFailure(f, /stage=push attempt=1\/3 reason=push-not-retryable/);
  assert.deepEqual(f.counts(), { commits: 1, pushes: 1, pulls: 1 });
  console.log(`PASS ${label} fails immediately with sanitized diagnostics`);
}
{
  const f = fixture();
  f.intercept(args => { if (args[0] === "push" && f.counts().pushes === 1) throw failure(contention); });
  checkpointState(f.file, f.git);
  assert.deepEqual(f.counts(), { commits: 1, pushes: 2, pulls: 2 });
  console.log("PASS observed expected-branch ref-lock signature receives bounded retry");
}
{
  const f = fixture();
  f.beforePush(() => f.advance("unrelated"));
  checkFailure(f, /stage=push attempt=3\/3 reason=contention-exhausted/);
  assert.deepEqual(f.counts(), { commits: 1, pushes: 3, pulls: 3 });
  assert.ok(readFileSync(f.file).equals(f.expected));
  console.log("PASS three actual main races exhaust the bound and preserve receipt bytes");
}
for (const stage of ["status", "add", "commit", "pull"] as const) {
  const f = fixture();
  f.intercept(args => { if (args[0] === stage) throw failure("PRIVATE_ERROR operation failure", 128); });
  checkFailure(f, new RegExp(`stage=${stage === "pull" ? "rebase" : stage}`));
  assert.equal(f.counts().pushes, 0);
  console.log(`PASS ${stage} failure never reaches a push`);
}
{
  const f = fixture();
  f.intercept(args => args[0] === "ls-files" ? "unmerged fixture\n" : undefined);
  checkFailure(f, /stage=conflict-check attempt=1\/3 reason=unmerged-state/);
  assert.equal(f.counts().pushes, 0);
  console.log("PASS explicit unmerged-file invariant stops before pushing");
}
{
  const f = fixture();
  assert.throws(() => checkpointState(join(f.worker, "missing-state.json"), f.git), /stage=read-state attempt=0\/3/);
  assert.deepEqual(f.counts(), { commits: 0, pushes: 0, pulls: 0 });
  f.assertReceipt();
  console.log("PASS unreadable state never commits, rebases or pushes");
}

// Exercise the real publication boundary with an existing receipt and a local-Git store.
for (const exhausted of [false, true]) {
  const f = fixture();
  f.beforePush(attempt => { if (exhausted || attempt === 1) f.advance("unrelated"); });
  let published = 0;
  const store: PublicationStore = {
    get: () => JSON.parse(readFileSync(f.file, "utf8")).receipt,
    set: receipt => {
      writeState(f.file, { ...JSON.parse(readFileSync(f.file, "utf8")), receipt });
      checkpointState(f.file, f.git);
    },
  };
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).endsWith("/threads_publish"), "saved receipt must not create a new container");
    assert.equal(new URLSearchParams(String(init?.body)).get("creation_id"), fixtureReceipt.creationId);
    assert.equal(JSON.parse(run(f.origin, "show", "main:state.json")).receipt.creationId, fixtureReceipt.creationId,
      "receipt must reach origin before the publication HTTP call");
    published++;
    return new Response(JSON.stringify({ id: "offline-publication" }));
  };
  if (exhausted) {
    await assert.rejects(postReply("fixture-comment", "ignored new text", undefined, undefined, store), PersistenceError);
    assert.equal(published, 0);
    f.assertReceipt();
    assert.ok(readFileSync(f.file).equals(f.expected));
    console.log("PASS exhausted checkpoint prevents publication and retains recovery receipt");
  } else {
    assert.equal(await postReply("fixture-comment", "ignored new text", undefined, undefined, store), "offline-publication");
    assert.equal(published, 1);
    assert.equal(JSON.parse(readFileSync(f.file, "utf8")).receipt.publishedId, "offline-publication");
    console.log("PASS recovered receipt publishes once after checkpoint success");
  }
}
globalThis.fetch = async () => { throw new Error("Unexpected HTTP call after checkpoint fixtures"); };
console.log("PASS isolated checkpoint regression fixtures completed");
