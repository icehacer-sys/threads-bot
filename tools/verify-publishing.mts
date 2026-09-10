// Offline regressions. No real API calls, public replies, or repository state writes.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import type { Publication, PublicationStore } from "../src/persistence";

process.env.GITHUB_ACTIONS = "false";
process.env.THREADS_ACCESS_TOKEN = "offline-test-token";
globalThis.fetch = async () => { throw new Error("Unexpected HTTP call in offline test"); };
const { config } = await import("../src/config");
const { State } = await import("../src/state");
const { postReply } = await import("../src/threads");
const { parseDecision } = await import("../src/reply");
const { atomicJson, PersistenceError } = await import("../src/persistence");
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), "reply-publishing-test-"));
config.stateFile = join(dir, "state.json");
config.confirmLive = true;
config.activeWindows = [[0, 24]];
config.pinnedPostIds = [];
config.answerEnabled = false;
atomicJson(config.stateFile, { repliedCommentIds: [], answeredPostIds: [], postCounts: {}, daily: { date: "2020-01-01", count: 0 } });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

if (process.argv.includes("--failure-cli")) {
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes("/me?")) return response({ id: "owner", username: "fixture-owner" });
    if (path.includes("/threads?")) return response({ data: [{ id: "post", text: "fixture", timestamp: new Date().toISOString() }] });
    if (path.includes("/post/replies?") || path.includes("/post/conversation?")) return response({ error: { message: "Conversation unavailable" } }, 400);
    throw new Error(`Unexpected fixture URL: ${path}`);
  };
  process.argv = [process.execPath, join(root, "src/index.ts"), "--live"];
  await import("../src/index");
} else {
  const valid = { intent: "joke", decision: "reply", category: "banter", reply_text: "A fixture reply", reason: "fixture", needs_lookup: false, promo_product: "none", promo_explicit: false,
    ...(config.gifReplies ? { gif_tag: "none" } : {}) };
  assert.equal(parseDecision(valid).reply_text, valid.reply_text);
  for (const bad of [null, [], {}, { ...valid, needs_lookup: "false" }, { ...valid, promo_explicit: "false" },
    { ...valid, promo_product: "invented-product" }, { ...valid, decision: "publish" }, { ...valid, category: "invented" },
    { ...valid, reply_text: 123 }, { ...valid, reply_text: " " }, { ...valid, reason: null },
    { ...valid, extra: true }, { ...valid, promo_explicit: true }]) assert.throws(() => parseDecision(bad), /Invalid reply verdict/);
  console.log("PASS reply schema types, enums, required fields, and contradictory link flags");

  const state = new State();
  const backing = state.publication("comment:one");
  const events: string[] = [];
  const store: PublicationStore = { get: backing.get, set: (p) => { events.push("save"); backing.set(p); } };
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/threads_publish")) {
      events.push("publish");
      assert.equal(new State().publication("comment:one").get()?.creationId, "container");
      return response({ id: "media" });
    }
    events.push("create"); return response({ id: "container" });
  };
  assert.equal(await postReply("one", "original", undefined, undefined, store), "media");
  assert.ok(events.indexOf("save") < events.indexOf("publish"));
  globalThis.fetch = async () => { throw new Error("Completed receipt must not call HTTP"); };
  assert.equal(await postReply("one", "redrafted", undefined, undefined, new State().publication("comment:one")), "media");
  state.markReplied("one", "post");
  state.markReplied("one", "post");
  assert.equal(state.repliedToPost("post"), 1);
  const pending = state.publication("comment:lost");
  pending.set({ creationId: "lost-container", createdAt: new Date().toISOString(), params: { text: "original", reply_to_id: "lost" } });
  let creates = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/threads")) { creates++; throw new Error("Duplicate container"); }
    assert.equal(new URLSearchParams(String(init?.body)).get("creation_id"), "lost-container");
    return response({ error: { message: "Container has already been published" } }, 400);
  };
  assert.equal(await postReply("lost", "different draft", undefined, undefined, pending), "lost-container");
  assert.equal(creates, 0);
  assert.equal(new State().publication("comment:lost").get()?.confirmedPublished, true);
  globalThis.fetch = async () => { throw new Error("Confirmed publication must not call HTTP"); };
  assert.equal(await postReply("lost", "new", undefined, undefined, new State().publication("comment:lost")), "lost-container");

  let publicWrites = 0;
  globalThis.fetch = async (url) => { if (String(url).endsWith("/threads_publish")) publicWrites++; return response({ id: "container" }); };
  await assert.rejects(postReply("two", "text", undefined, undefined, { get: () => undefined, set: () => { throw new PersistenceError("checkpoint unavailable"); } }), PersistenceError);
  assert.equal(publicWrites, 0);
  let pendingAfterAck: Publication | undefined;
  const failedAck: PublicationStore = {
    get: () => pendingAfterAck,
    set: (p) => { if (p.publishedId) throw new PersistenceError("completion checkpoint unavailable"); pendingAfterAck = p; },
  };
  await assert.rejects(postReply("three", "text", undefined, undefined, failedAck), PersistenceError);
  assert.equal(publicWrites, 1, "must not retry a public write after its completion checkpoint fails");
  assert.equal(pendingAfterAck?.creationId, "container");
  console.log("PASS persistence ordering, restart reuse, lost response, idempotent count, and failed checkpoint");

  const snapshot = readFileSync(config.stateFile, "utf8");
  assert.throws(() => atomicJson(config.stateFile, { value: BigInt(1) }), PersistenceError);
  assert.equal(readFileSync(config.stateFile, "utf8"), snapshot);
  for (const corrupt of ["{", "null", "{}", JSON.stringify({ ...JSON.parse(snapshot), publications: { broken: {} } }), JSON.stringify({ ...JSON.parse(snapshot), spend: { date: "2026-09-10", usd: "broken" } }), JSON.stringify({ ...JSON.parse(snapshot), gifPostCounts: { p: -1 } })]) {
    writeFileSync(config.stateFile, corrupt);
    assert.throws(() => new State(), PersistenceError);
    assert.equal(readFileSync(config.stateFile, "utf8"), corrupt);
  }
  console.log("PASS atomic write failure preserves old state; corrupt state never resets");
  const child = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), "--failure-cli"], { cwd: root, encoding: "utf8", timeout: 60_000 });
  assert.equal(child.status, 1, child.stderr + child.stdout + String(child.error ?? ""));
  assert.match(child.stderr, /1 operation\(s\)/);
  console.log("PASS reply CLI returns nonzero when conversation fetching fails");
}
