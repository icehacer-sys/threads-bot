// Self-improving voice loop. Fable 5 audits the account's own comment->reply pairs (weighting the
// ones that SPARKED A HUMAN REPLY BACK as "landed"), then consolidates a bounded set of learned
// voice notes into data/voice-learned.md. reply.ts injects that file into every reply's system
// prompt, so the voice sharpens itself over time. Git-tracked = every update is a reviewable diff.
//
//   npx tsx src/voicelearn.ts            # recent window (BOT_LEARN_DAYS, default 3)
//   npx tsx src/voicelearn.ts --backfill # seed from ALL past posts (capped)
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config, requireEnv } from "./config";
import { SYSTEM_PROMPT } from "./voice";
import { getRecentPosts, getAllMyPosts, getConversation, getMyUsername, type ThreadsReply, type ThreadsPost } from "./threads";

const HERE = dirname(fileURLToPath(import.meta.url));
const NOTES = join(HERE, "..", "data", "voice-learned.md");
const CHANGELOG = join(HERE, "..", "data", "voice-changelog.md");
// Sonnet 5 is the chosen audit model (the workflow sets BOT_LEARN_MODEL=claude-sonnet-5). Default
// to it too, so a local `npm run learn` without the env var doesn't silently bill Fable 5 at ~4.5x.
const MODEL = process.env.BOT_LEARN_MODEL ?? "claude-sonnet-5";
const MAX_PAIRS = Number(process.env.BOT_LEARN_MAX_PAIRS ?? 150);
const DAYS = Number(process.env.BOT_LEARN_DAYS ?? 3);

interface Pair { post: string; comment: string; reply: string; landed: boolean }

const clip = (s: string | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

function pairsFromConvo(convo: ThreadsReply[], me: string, postLabel: string): Pair[] {
  const byId = new Map(convo.map((c) => [c.id, c]));
  // A bot reply "landed" if a human replied back under it (free engagement signal — no extra API calls).
  const humanRepliedTo = new Set(
    convo.filter((c) => c.username !== me && c.replied_to?.id).map((c) => c.replied_to!.id),
  );
  const out: Pair[] = [];
  for (const c of convo) {
    if (c.username !== me || !c.replied_to?.id) continue;
    const parent = byId.get(c.replied_to.id);
    if (!parent || parent.username === me) continue; // reply to a real user comment (skip the pinned "Answer:")
    if (/^\s*answer\s*:/i.test(c.text ?? "")) continue;
    out.push({ post: postLabel, comment: clip(parent.text, 180), reply: clip(c.text, 220), landed: humanRepliedTo.has(c.id) });
  }
  return out;
}

async function collect(backfill: boolean): Promise<Pair[]> {
  const me = await getMyUsername();
  let posts: ThreadsPost[];
  if (backfill) {
    posts = await getAllMyPosts(300);
  } else {
    posts = (await getRecentPosts()).filter((p) => {
      const age = p.timestamp ? (Date.now() - new Date(p.timestamp).getTime()) / 86_400_000 : 0;
      return age <= DAYS;
    });
  }
  console.log(`scanning ${posts.length} post(s) as @${me} (${backfill ? "backfill" : `last ${DAYS}d`})`);
  const all: Pair[] = [];
  for (const p of posts) {
    try {
      const convo = await getConversation(p.id);
      all.push(...pairsFromConvo(convo, me, clip(p.text, 40)));
    } catch (e) {
      console.error(`  skip post ${p.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (all.length >= MAX_PAIRS * 3) break; // enough raw material; newest posts first
  }
  // Newest-ish (posts came newest-first); keep a representative cap, preserving landed/not mix.
  return all.slice(0, MAX_PAIRS);
}

function loadNotes(): string {
  try { return readFileSync(NOTES, "utf8"); } catch { return ""; }
}

function buildPrompt(pairs: Pair[], existing: string): string {
  const landed = pairs.filter((p) => p.landed).length;
  const block = pairs
    .map((p, i) => `#${i + 1} [${p.landed ? "LANDED (sparked a reply back)" : "no reply back"}]\n  THEM: ${p.comment}\n  BOT:  ${p.reply}`)
    .join("\n");
  return `You are the voice coach for the @mdnoteslab Threads reply bot. Your job: study the bot's OWN recent replies and maintain a SMALL living set of "learned notes" that make future replies sound more human, warm, and varied — WITHOUT reinventing the established voice. Refine, never replace.

Below is (1) the account's core voice standard, (2) the current learned notes, (3) recent real comment->reply pairs. Pairs marked LANDED sparked a human reply back (a signal the reply connected); pairs with "no reply back" ended the thread (weaker signal, though many are fine).

Study what the LANDED replies do that the others don't (specific, human, matched the commenter's energy, real reaction before the joke) and what makes replies fall flat (templated, repetitive openers, robotic phrasing, over-🤣, generic toppers). Then OUTPUT the FULL updated learned-notes file — consolidated, deduped, and BOUNDED to at most 16 bullets total across the three sections. Keep the strongest, most repeated lessons; drop stale or one-off ones. Every bullet must be concrete and voice-specific (name the phrasing to add or kill), not generic advice. Do not restate rules already hard-coded in the core voice unless the data shows they are still being broken.

Output EXACTLY this markdown structure and nothing else:

# Learned voice notes
_Auto-updated by the daily voice self-audit. Refine the established voice, never reinvent it._

## Do more (what the landed replies do)
- ...

## Do less / sounds robotic
- ...

## Retire these phrasings (overused in the real replies)
- ...

Then, on the VERY LAST line, output exactly:
CHANGE: <one plain sentence naming what you ADDED, sharpened, or DROPPED versus the current notes this run — e.g. "Added a lesson on topping reactions with a fresh detail; dropped the stale 'brutal' retire." If nothing materially changed, write "no material change.">

=== CORE VOICE STANDARD ===
${SYSTEM_PROMPT}

=== CURRENT LEARNED NOTES ===
${existing || "(none yet — create the first version)"}

=== RECENT REPLIES (${pairs.length} pairs, ${landed} landed) ===
${block}`;
}

async function main(): Promise<void> {
  const backfill = process.argv.includes("--backfill");
  const pairs = await collect(backfill);
  if (pairs.length < 5) { console.log(`only ${pairs.length} pairs — too few to learn from, leaving notes unchanged.`); return; }
  const landed = pairs.filter((p) => p.landed).length;
  console.log(`auditing ${pairs.length} reply pairs (${landed} landed) with ${MODEL} ...`);

  const client = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  const res = await client.messages.create({
    model: MODEL, max_tokens: 12000, // Fable 5 reasons before answering — needs headroom for thinking + the notes
    messages: [{ role: "user", content: buildPrompt(pairs, loadNotes()) }],
  });
  let text = res.content.map((b: any) => (b.type === "text" ? b.text : "")).join("").trim();
  text = text.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/i, "").trim(); // strip code fences if any
  // Anchor on the "Do more" section (the reliable marker); keep from the H1 if present, else synthesize it.
  // Pull the one-line change summary Fable appends, then strip it from the notes body.
  const changeMatch = text.match(/^CHANGE:\s*(.+)$/im);
  const change = changeMatch ? changeMatch[1].trim() : "updated";
  const h1 = text.search(/#\s*Learned voice notes/i);
  const dm = text.search(/##\s*Do more/i);
  let body = h1 >= 0 ? text.slice(h1) : dm >= 0 ? `# Learned voice notes\n\n${text.slice(dm)}` : "";
  body = body.replace(/^CHANGE:.*$/im, "").trim(); // keep the change line out of the notes file
  // Guard: never overwrite good notes with an empty/garbled result.
  if (!body || body.length < 120 || dm < 0) {
    console.error(`audit produced no usable notes (stop=${res.stop_reason}, len=${text.length}) — leaving the file unchanged.`);
    console.error("--- raw head ---\n" + text.slice(0, 600));
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const scope = backfill ? "all past posts" : `last ${DAYS} days`;
  const header = `<!-- audited ${pairs.length} replies (${landed} landed) across ${scope} on ${stamp} -->\n`;
  mkdirSync(dirname(NOTES), { recursive: true });
  writeFileSync(NOTES, header + body.trim() + "\n");
  console.log(`updated ${NOTES} (${body.length} chars)`);

  // Running changelog so the voice's evolution is skimmable at a glance (and in git log). Rebuild from
  // a fixed intro + all entry lines (newest first) so ordering is robust across runs.
  const INTRO = "# Voice self-audit changelog\n\n_What the Fable 5 self-audit changed each run, newest first._\n\n";
  const logLine = `- **${stamp}** (${pairs.length} replies, ${landed} landed, ${scope}): ${change}`;
  let priorEntries: string[] = [];
  try { priorEntries = readFileSync(CHANGELOG, "utf8").split("\n").filter((l) => l.startsWith("- **")); } catch { /* first run */ }
  writeFileSync(CHANGELOG, INTRO + [logLine, ...priorEntries].join("\n") + "\n");
  console.log(`CHANGE_SUMMARY: ${change}`); // the workflow greps this for the commit message
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
