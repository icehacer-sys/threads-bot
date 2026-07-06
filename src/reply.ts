// Classify a single comment and draft a reply in the brand voice.
// Uses the Anthropic Messages API with structured outputs (guaranteed-valid JSON).
// Every result passes through sanitize() as defense-in-depth before it can be posted.

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config, requireEnv } from "./config";
import { SYSTEM_PROMPT } from "./voice";
import { GIF_TAGS } from "./gifs";
import { PROMO_TAGS, PRODUCTS_BLOCK } from "./products";

// Self-learned voice notes (maintained by the Fable 5 self-audit in voicelearn.ts). Loaded ONCE and
// appended to the cached system prompt, so the voice keeps sharpening with zero per-reply cost.
// Absent/empty file = no-op (the core voice still fully applies).
const LEARNED_NOTES = (() => {
  try {
    const md = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "data", "voice-learned.md"), "utf8").trim();
    return md ? `\n\n## LEARNED FROM YOUR OWN REPLIES (self-audit — these SHARPEN the voice above, never override its hard rules)\n${md.replace(/<!--[\s\S]*?-->/g, "").trim()}` : "";
  } catch { return ""; }
})();
const FULL_SYSTEM = SYSTEM_PROMPT + PRODUCTS_BLOCK + LEARNED_NOTES;

export type Category =
  | "banter"
  | "affirm"
  | "correct"
  | "teach"
  | "reference"
  | "empathize"
  | "personal_medical"
  | "complaint"
  | "spam"
  | "other";

export interface Decision {
  intent?: string;
  decision: "reply" | "skip";
  category: Category;
  reply_text: string;
  reason: string;
  /** Mood tag for a curated reaction GIF. Only ever honored on a live "banter" reply. */
  gif_tag?: string;
  /** Set by the cheap triage pass when it sees a reference (in text or an attached image/GIF) it
   *  can't confidently name — signals the orchestrator to escalate to the quality model + web search. */
  needs_lookup?: boolean;
  /** Product tag for the RARE promo mention (catalog in data/products.json). The reply names the
   *  product in-voice; code appends the URL ONLY when promo_explicit is true. Never writes links. */
  promo_product?: string;
  /** true ONLY when the commenter explicitly asked for the link / where to buy / the price. Gates
   *  whether the raw URL is attached (ask-only links, to minimise spam/reach risk). */
  promo_explicit?: boolean;
}

// JSON schema for structured outputs. additionalProperties:false is required.
// `intent` is FIRST so the model reasons about what the comment literally is BEFORE it
// picks a category — this stops genuine questions getting bantered (e.g. "so where the
// ribs at" is a real "I can't see the ribs, why?" question, not a joke).
const REPLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: {
      type: "string",
      description:
        "FIRST, in one sentence, work out what this comment LITERALLY is and what the person actually wants: a joke/meme to top, a real diagnosis guess, a genuine question about the case OR the image (e.g. 'where are the ribs' = they genuinely cannot see them on the scan and want to know why), a personal story, or a complaint. If it reads like a plain question about what is in the image, it is a real question even when phrased casually or slangily. Settle the real intent here before choosing a category.",
    },
    decision: { type: "string", enum: ["reply", "skip"] },
    category: {
      type: "string",
      enum: ["banter", "affirm", "correct", "teach", "reference", "empathize", "personal_medical", "complaint", "spam", "other"],
    },
    reply_text: { type: "string" },
    reason: { type: "string" },
    gif_tag: {
      type: "string",
      enum: GIF_TAGS,
      description:
        'DO tag clearly funny, delighted, or shocked banter with the mood that fits — do not default to "none" on a genuinely playful comment. The caps (1 GIF per post, 2 per day) mean only the FIRST tagged reply on a post actually gets one, so lean toward tagging a real banter banger rather than withholding. Moods: "dead" (hilarious / dying laughing), "mind_blown" (whoa / shocked), "applause" (impressed), "chefs_kiss" (perfect / nailed it), "side_eye" (cheeky / sus), "deadpan" (dry flat joke). Use "none" only when no mood fits or the comment is NOT light banter. NEVER tag a diagnosis guess (even a joking one), a question, a personal story, a correction, or anything medical or tender.',
    },
    needs_lookup: {
      type: "boolean",
      description:
        'true ONLY when the comment or its attached image/GIF clearly points to a SPECIFIC identifiable person, movie, show, game, meme, or scene that you recognize as "a real reference I should name" but cannot confidently place yourself (e.g. a reaction GIF of someone you can tell is a known figure but can\'t name, on-screen text like "HAMSTER" you can\'t source). It triggers a web lookup so the reply can name it and top it precisely. false whenever you already recognize it, or there is nothing specific to identify (generic photo, plain banter, a guess, a question).',
    },
    promo_product: {
      type: "string",
      enum: PROMO_TAGS,
      description:
        '"none" UNLESS the comment gives a genuine opening to mention a product: they ask where to find more cases / whether there is a book or collection, say they would buy or read a whole book of these, gush that they are obsessed with this series, or joke about doctors dismissing them as "just anxiety" (→ anxiety_game). On a clear opening pick the one product from YOUR PRODUCT CATALOG that fits (free_pack is the default for casual interest). A DIRECT purchase/link request ("where can I buy this", "drop the link", "how do I get it", "how much") is ALWAYS an opening — never answer it with "none"; if they did not name a product, default to free_pack (start free) or complete_collection. REQUIRED: reply_text must carry your one casual owner-voice line that NAMES the thing ("I actually turned these into a card game" / "I put 50 of these into a book"). That line must read fine on its own with no link. Never ad copy; you may name the price or the SPOTIT code; NEVER write a URL. If your reply does not naturally carry that line, set "none". ALWAYS "none" on: a personal medical story, anything tender, a correction, a complaint, a plain guess, or a comment that never asked for more.',
    },
    promo_explicit: {
      type: "boolean",
      description:
        'true ONLY when the commenter EXPLICITLY asked for the actual link / where to buy / the price / how to get it ("where can I buy this?", "is there a link?", "how much?", "drop the link"). false for softer interest (gushing, "wish there were more", "I\'d buy a book of these") — those get the in-voice product mention but NO link. Always false when promo_product is "none".',
    },
  },
  required: ["intent", "decision", "category", "reply_text", "reason", "gif_tag", "needs_lookup", "promo_product", "promo_explicit"],
} as const;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  return client;
}

export type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

// Base64-encoded image. We send images inline (not by URL) because Anthropic's
// URL fetcher honors robots.txt and the Threads/Instagram CDN blocks crawlers.
export interface InlineImage {
  media_type: ImageMediaType;
  data: string;
}

export interface ClassifyInput {
  postText: string;
  commentText: string;
  answer?: string;
  /** Owner-reviewed facts about this case; treated as source of truth by the model. */
  facts?: string[];
  /** The post's X-ray image(s), inline, for the model to actually see. */
  images?: InlineImage[];
  /** Replies already posted on this post, so the model avoids reusing shapes. */
  recentReplies?: string[];
  /** Image(s) the commenter attached, or a still frame extracted from their GIF/video. */
  commentImages?: InlineImage[];
  /** What the comment's media is: a real image, a frame from a GIF/video, or an unreadable GIF/video. */
  commentMediaKind?: "image" | "video-frame" | "video";
  /** This comment is a reply under our pinned "Answer:" thread, where the diagnosis is already public. */
  inAnswerThread?: boolean;
  /** Set when this comment is a follow-up under one of our own replies: the prior exchange, so we answer in context and only once. */
  priorExchange?: { commenter: string; bot: string };
  /** Override the model for this one call (two-tier: cheap triage vs quality redraft). */
  modelOverride?: string;
  /** True once the answer is publicly posted. When false, the model may KNOW the answer
   *  (to judge guesses) but must never reveal it. Undefined = treat as public (manual/demo). */
  answerPublic?: boolean;
  /** Allow this one call to use web search. Only the quality-model re-run of an
   *  unrecognized "reference" comment sets this — never the cheap triage pass. */
  allowSearch?: boolean;
}

// ENGLISH-ONLY policy: detect comments written in a non-Latin script so they can be
// skipped without spending a model call. A POSITIVE Latin test (a letter is "foreign"
// when it is NOT Latin script) catches EVERY non-Latin script — Arabic, CJK, Cyrillic,
// Greek, Hebrew, plus the long tail a hand-rolled range list misses (Tamil, Bengali,
// Telugu, Armenian, Georgian, Gujarati, Kannada, Malayalam, Lao, Khmer, Myanmar, Tibetan,
// Sinhala, Amharic, ...). Latin-script foreign languages (Spanish, French, German, ...)
// stay Latin here and are left to the voice rule to skip.
const isLatin = (ch: string): boolean => /\p{Script=Latin}/u.test(ch);

/** True when a comment is largely non-Latin script (Arabic, CJK, Cyrillic, ...) i.e. not English. */
export function isNonEnglishScript(text: string | undefined): boolean {
  const letters = (text || "").match(/\p{L}/gu);
  if (!letters || letters.length === 0) return false; // emoji / punctuation / numbers only — not "foreign"
  const nonLatin = letters.filter((ch) => !isLatin(ch)).length;
  return nonLatin / letters.length >= 0.3;
}

export async function classifyAndDraft(input: ClassifyInput): Promise<Decision> {
  const { postText, commentText, answer, facts, images, recentReplies, commentImages, commentMediaKind, inAnswerThread, priorExchange, modelOverride, answerPublic, allowSearch } = input;

  // ENGLISH-ONLY: skip non-Latin-script comments (Arabic, CJK, Cyrillic, ...) before any
  // model call. Latin-script foreign languages are handled by the voice rule.
  if (isNonEnglishScript(commentText)) {
    return { decision: "skip", category: "other", reply_text: "", reason: "non-English (non-Latin script) - English-only policy | guard:forced-skip" };
  }
  // "Are you a bot?" pushed a SECOND time in the same thread (a follow-up that is itself another
  // bot-question after the commenter already asked one) → skip deterministically. The owner's rule:
  // dodge the first playfully, but never keep engaging the interrogation.
  if (isBotQuestion(commentText) && priorExchange && isBotQuestion(priorExchange.commenter)) {
    return { decision: "skip", category: "other", reply_text: "", reason: "repeat 'are you a bot' interrogation — not engaging | guard:forced-skip" };
  }
  const factsBlock =
    facts && facts.length
      ? `VETTED FACTS (owner-reviewed, source of truth):\n- ${facts.join("\n- ")}`
      : "VETTED FACTS: none";
  const recentBlock =
    recentReplies && recentReplies.length
      ? `ALREADY POSTED on this post (do NOT reuse these openings, sentence shapes, jokes, or punchlines — write something clearly different):\n- ${recentReplies.slice(-config.antiRepeatWindow).join("\n- ")}`
      : "";
  const mediaNote =
    commentMediaKind === "video"
      ? "NOTE: the commenter sent a GIF/video you cannot see. React to their words and the playful gesture of sending one."
      : commentMediaKind === "video-frame"
        ? "NOTE: the commenter sent a GIF/video; ONE still frame from it is shown above (you see a single frame, not the motion). React to what is in the frame and the gesture."
        : commentImages && commentImages.length
          ? "NOTE: the commenter attached the image shown above. React to what is actually in it and tie it to the case."
          : "";
  const answerText = answer && answer.trim() ? answer.trim() : "";
  const hasAnswer = answerText.length > 0 && answerText.toLowerCase() !== "unknown";
  // Undefined answerPublic = treat as public (manual runs / demo). The answer thread is
  // only reachable once the answer is posted, so inAnswerThread also implies public.
  const isPublic = inAnswerThread || answerPublic !== false;
  let answerLine: string;
  let prePublicNote = "";
  if (isPublic) {
    answerLine = inAnswerThread
      ? `CORRECT ANSWER (already revealed publicly in this answer thread, so you MAY name and discuss it): ${hasAnswer ? answerText : "unknown"}`
      : `CORRECT ANSWER (now public, you MAY name and discuss it): ${hasAnswer ? answerText : "unknown"}`;
  } else if (hasAnswer) {
    answerLine = `CORRECT ANSWER (PRIVATE — the reveal is NOT posted yet): ${answerText}`;
    prePublicNote =
      "THE ANSWER IS NOT PUBLIC YET. Your reply must not let anyone reading work out the diagnosis. Use the answer above ONLY to judge this one comment. STRICT RULES:\n" +
      "- NEVER name, spell, abbreviate, OR describe the diagnosis or its findings (no mechanism, no 'benign growths', no 'cartilage', no body-part specifics, no what-it-actually-is).\n" +
      "- NEVER signal whether the guess is right or wrong by confirming it: no 'correct', 'yes', 'exactly', 'nailed it', 'spot on', 'you got it', 'bingo', and no ✅ or 💯.\n" +
      '- If the guess is WRONG: reply with ONLY a short light rethink nudge and nothing else (e.g. "not the one. Take another look" / "hmm. Look again"). Do NOT explain why or hint at the real answer.\n' +
      '- If the guess is RIGHT: stay coy and non-committal so you do not give it away (e.g. "bold call. You will have to wait for the reveal" / "interesting. Sit tight"). Do NOT confirm it. Occasionally give a strong WRONG guess the same wait-and-see energy so a coy reply never becomes a guaranteed yes.\n' +
      "- If it is NOT a diagnosis guess: just banter normally.\n" +
      "Keep it to one short line.";
  } else {
    answerLine = "CORRECT ANSWER: unknown (you do NOT know it — never affirm or correct a diagnosis guess; just banter).";
  }
  const threadNote = inAnswerThread
    ? "NOTE: this comment is a reply under your pinned Answer post, where the diagnosis is already public. Answer follow-up questions about the case directly (prognosis, mechanism, what to read next) and react to reactions. No need to stay coy about the diagnosis here."
    : "";
  const followUpNote = priorExchange
    ? `THIS IS A FOLLOW-UP under your own reply. Earlier the commenter said "${priorExchange.commenter}" and you replied "${priorExchange.bot}". The COMMENT below is their reply back to you. Answer a genuine QUESTION or CLARIFICATION directly and accurately in the context of what was already said. You may ALSO warmly top a genuine reaction or bit of banter ONCE with a short fresh line — a delighted "THAT'S fascinating!!", an "aha", a joke worth topping all deserve a brief warm reply. Only decision "skip" when the follow-up is pure empty noise (a lone "lol", a single emoji, a bare "thanks" with nothing to build on) or when you have already reacted to this exact beat. Keep answering as long as they keep genuinely engaging — a real question always deserves an answer no matter how deep the thread. But never ask anything back, never bait more chatter, and never keep the thread going yourself: you respond to what they actually said, you never prompt for more.`
    : "";
  // Split the prompt into a STABLE per-post prefix (same for every comment on this
  // post) and a VARIABLE per-comment tail. The prefix — X-ray image + post text +
  // vetted facts — is cached for 1h, so every later comment on the same post reads it
  // cheaply instead of re-sending it at full price. The tail (answer line, notes, the
  // anti-repeat list, the comment itself) changes per call and stays uncached.
  const stableText = [`POST:\n${postText || "(unknown)"}`, factsBlock].filter(Boolean).join("\n\n");
  const varText = [
    answerLine,
    prePublicNote,
    threadNote,
    followUpNote,
    recentBlock,
    mediaNote,
    `COMMENT:\n${commentText || "(no text — just the attached image)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  // Spoiler backstop terms: pre-public, a reply must never contain the diagnosis or a
  // distinctive answer word. Full alias phrases + words >=6 chars (minus generic ones).
  const SPOILER_STOP = new Set(["disease", "syndrome", "deformity", "hernia", "condition", "disorder", "anomaly"]);
  const spoilerPhrases = hasAnswer ? answerText.split("/").map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
  const spoilerWords = spoilerPhrases
    // Split on hyphens/underscores too (not just spaces) so "Nail-Patella" yields "nail" +
    // "patella" — not the never-appears token "nailpatella" — and keep short distinctive names
    // ("eagle", "gout", "lupus", "pott") that a >=6 filter used to drop and let leak pre-reveal.
    .flatMap((p) => p.split(/[^\p{L}]+/u))
    .map((w) => w.replace(/[^\p{L}]/gu, ""))
    .filter((w) => w.length >= 4 && !SPOILER_STOP.has(w));
  const spoilerTerms = [...new Set([...spoilerPhrases, ...spoilerWords])];

  const content: Array<Anthropic.ImageBlockParam | Anthropic.TextBlockParam> = [];
  // 1) Post X-ray(s), part of the cached per-post prefix.
  if (images && images.length) {
    content.push({ type: "text", text: "THE X-RAY ON THE POST:" });
    for (const img of images) content.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } });
  }
  // 2) Stable per-post text. The cache breakpoint here caches system + X-ray + this block.
  content.push({ type: "text", text: stableText, cache_control: { type: "ephemeral", ttl: "1h" } });
  // 3) The commenter's own media + the variable per-comment text (uncached tail).
  if (commentImages && commentImages.length) {
    content.push({
      type: "text",
      text: commentMediaKind === "video-frame" ? "A STILL FRAME FROM THE GIF/VIDEO THIS COMMENTER SENT:" : "THE IMAGE THIS COMMENTER ATTACHED:",
    });
    for (const img of commentImages) content.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } });
  }
  content.push({ type: "text", text: varText });

  // The submit_reply tool gives guaranteed-structured output; web_search (optional)
  // lets the model look up references it does not recognize. With web search off we
  // FORCE submit_reply for a deterministic single call. With it on we let the model
  // choose to search first (server-side, auto-run), then submit.
  const model = modelOverride ?? config.model;
  const isTriage = model === config.triageModel;

  const tools: unknown[] = [
    {
      name: "submit_reply",
      description: "Submit your final decision and reply for this one comment. Call this exactly once, last.",
      input_schema: REPLY_SCHEMA,
    },
  ];
  let toolChoice: unknown = { type: "tool", name: "submit_reply" };
  // Keep web_search available on EVERY quality-model (Sonnet) escalation, not only the
  // `reference` one, so the tool ARRAY is identical across all escalations and they share a
  // single prompt-cache entry. A changing tool array invalidates the ENTIRE cached prefix
  // (tools -> system -> messages) — that was the main Sonnet cache leak. tool_choice:auto lets
  // the model search only when it actually needs to (the voice rules gate that); the cheap Haiku
  // triage stays deterministic (forced submit_reply, no search) for one clean call.
  if (config.webSearch && (!isTriage || allowSearch)) {
    tools.unshift({ type: "web_search_20250305", name: "web_search", max_uses: 3 });
    toolChoice = { type: "auto" };
  }

  // effort:low caps token spend on these short, structured replies. GA effort is
  // supported on Sonnet 4.6 / Opus 4.x ONLY — it ERRORS on Haiku 4.5 (the triage
  // model) and older models, so gate it to known-supported model strings.
  const effortParam = /sonnet-4-6|sonnet-5|opus-4-[5-9]|fable-5/.test(model)
    ? { output_config: { effort: "low" } }
    : {};

  try {
    const res = await getClient().messages.create({
      model,
      max_tokens: 1024,
      ...effortParam,
      // System prompt is static -> cache it for 1h (survives the gaps between 10-min cycles).
      system: [{ type: "text", text: FULL_SYSTEM, cache_control: { type: "ephemeral", ttl: "1h" } }],
      messages: [{ role: "user", content }],
      tools,
      tool_choice: toolChoice,
    } as unknown as Anthropic.MessageCreateParamsNonStreaming);

    if (res.content.some((b) => (b as { type: string }).type === "web_search_tool_result")) {
      console.log(`    (web search used for: "${commentText.slice(0, 40).replace(/\s+/g, " ")}")`);
    }
    // Never post a draft the model cut off at the token limit (its tool JSON / reply_text is partial).
    if (res.stop_reason === "max_tokens") {
      return { decision: "skip", category: "other", reply_text: "", reason: "truncated (max_tokens) — not posting a cut-off reply" };
    }
    const findSubmit = (m: Anthropic.Message) =>
      m.content.find(
        (b) => (b as { type: string; name?: string }).type === "tool_use" && (b as { name?: string }).name === "submit_reply",
      ) as { input?: unknown } | undefined;
    const submit = findSubmit(res);
    if (!submit?.input) {
      // With auto tool choice (web search on) the model can end its turn after searching without
      // ever emitting submit_reply. Retry ONCE forcing the tool so the comment gets a real reply
      // instead of being dropped AND re-paid on every 10-min poll for the rest of the night.
      if ((toolChoice as { type?: string }).type === "auto") {
        const forced = await getClient().messages.create({
          model,
          max_tokens: 1024,
          ...effortParam,
          system: [{ type: "text", text: FULL_SYSTEM, cache_control: { type: "ephemeral", ttl: "1h" } }],
          messages: [{ role: "user", content }],
          tools,
          tool_choice: { type: "tool", name: "submit_reply" },
        } as unknown as Anthropic.MessageCreateParamsNonStreaming);
        if (forced.stop_reason === "max_tokens") {
          return { decision: "skip", category: "other", reply_text: "", reason: "truncated (max_tokens) — not posting a cut-off reply" };
        }
        const forcedSubmit = findSubmit(forced);
        if (forcedSubmit?.input) {
          return sanitize(forcedSubmit.input as Decision, { isPublic, terms: spoilerTerms }, isBotQuestion(commentText));
        }
      }
      return { decision: "skip", category: "other", reply_text: "", reason: "no submit_reply produced" };
    }
    return sanitize(submit.input as Decision, { isPublic, terms: spoilerTerms }, isBotQuestion(commentText));
  } catch (err) {
    // Any failure (API error, bad output) -> stay silent. Never post on uncertainty.
    const msg = err instanceof Error ? err.message : String(err);
    return { decision: "skip", category: "other", reply_text: "", reason: `error: ${msg.slice(0, 140)}` };
  }
}

// Only these emojis are allowed in replies (the account owner's set). Expanded 2026-07-06 so 🤣 is
// no longer the ONLY casual-emotion option (its monotony was the top "bot" tell): 😭 = crying-laughing/
// overwhelm, 🤍 = warmth, 🫡 = respect. Everything else (😳, 🦴, 👀, 🤘, ...) is stripped before posting.
const ALLOWED_EMOJI = new Set(["🤣", "😭", "🤍", "🫡", "✅", "💯", "👏"]);
const EMOJI_SEQ = /\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic}️?)*/gu;

// Worn-out house one-liners. The model still reaches for these as a lazy dry topper
// despite the voice rules, so if a WHOLE reply is just one of them, we skip it.
const RETIRED_LINES = /^(radiologically confirmed|radiology confirms|literally|confirmed)$/i;

// Phrases that read as medical advice. If any slip into a draft, we force a skip.
const ADVICE_PATTERN =
  /\b(you should|i (would |really )?recommend|see (a|your) (doctor|physician|gp|specialist|dentist)|ask your (doctor|doc|physician|gp|dentist|specialist)|get (it|that|this) (checked|looked at|scanned|seen)|worth getting[^.]{0,20}(checked|scanned|looked at|seen)|needs? (a |an )?(scan|x-?ray|mri|ct|ultrasound|biopsy|work-?up|imaging)|push for (a|an|another)|don'?t ignore|get (checked|seen|scanned)|consult|seek medical|go to the (er|a&e|hospital|doctor)|you (might|may|could) have|sounds like you (have|might))\b/i;

// HARD CONFESSION GUARD: the owner never wants an admission that the image is AI/generated, or
// that the operator is a bot/automated. The voice rules dodge "are you a bot" questions WITHOUT
// ever using words like bot/AI/robot (a joke about being fast, never about being automated), so
// a clean draft should never trip this. This is a model-independent backstop: if the draft's own
// wording contains any flagged term anyway (confirming OR denying), force a skip rather than risk
// posting something that could read as a confession either way.
const CONFESSION =
  /\bai\b|\ba\.i\.|artificial intelligence|ai[- ]?(generated|image|made|created|assisted|run|powered)|computer[- ]?generated|machine[- ]?generated|digitally (created|generated|rendered|made)|\billustrative\b|\brecreation\b|\brecreated\b|\bsynthetic\b|photoshopp?ed|\bfabricated\b|\bfake[d]?\b|\bcgi\b|\brendered?\b|\bsimulat(?:ed|ion)\b|\bmock-?up\b|\bdrawn\b|\bdrawing\b|\bmidjourney\b|\bdall-?e\b|\bstable diffusion\b|generated (image|picture|scan|x-?ray)|not (a )?(real|genuine|actual|authentic) (x-?ray|film|scan|photo|radiograph|image|picture)|is ?n'?t (a )?(real|genuine|actual|authentic) (x-?ray|film|scan|photo|radiograph|image|picture)|\brobots?\b|\bchatbots?\b|\bbots?\b|\bautomat(?:ed|ion|ically)\b|\bchatgpt\b|\bclaude\b/i;

// Detects an "are you a bot / AI / human?" interrogation, including indirect phrasings
// ("is this ChatGPT?", "human or machine?", "who runs this account?"). When a comment IS one,
// its reply gets a STRICTER screen (BOT_ANSWER_LEAK) — the owner's rule is to dodge playfully and
// never confirm OR deny being automated, and never claim to be human / a real person either.
const BOT_QUESTION =
  /\b(?:are|r|is|it'?s|u)\s+(?:you|u|this|it|these)\b[^?]{0,40}\b(?:bots?|robots?|a\.?i\.?|automated|automation|auto-?reply|chat\s*gpt|gpt|llm|language model|machine|human|real person|algorithms?|programm?ed|scripted)\b|\bhuman or (?:machine|bot|robot|ai)\b|\bbot or (?:human|person|real)\b|\bwho\s+(?:writes|makes|runs|is behind|does)\b/i;

export function isBotQuestion(text: string | undefined): boolean {
  return BOT_QUESTION.test(text || "");
}

// Words that, IN A REPLY TO an "are you a bot" question, read as either a confession or the
// forbidden denial ("100% human", "just an algorithm", "you caught me"). Screened ONLY when the
// comment is a bot-question (isBotQuestion) — these terms ("human", "machine", ...) are far too
// common to hard-block on every reply, but in answer to that question they give the game away.
const BOT_ANSWER_LEAK =
  /\bhumans?\b|\breal person\b|\bmachines?\b|\bgpt-?\d?\b|\bllms?\b|\blanguage model\b|\balgorithms?\b|\bprogramm?ed\b|\bscripted\b|\bopen\s?ai\b|\banthropic\b|\bgemini\b|\bbeep\s?boop\b|\bcircuits?\b|\bauto-?reply\b|\b(?:you )?(?:caught|got) me\b|\bguilty\b|\bbusted\b|\bfine,? yes\b|\byes,? i(?:'?m| am)\b/i;

// AI-style preambles the model sometimes adds despite the voice rules. Stripped
// from the start of any reply ("Great question.", "Thanks for sharing", ...).
const PREAMBLE =
  /^\s*(?:(?:great|good|nice|excellent|interesting|amazing|solid|fair)\s+(?:question|point|catch|eye|observation|guess|call|thinking|instinct|insight)s?(?:\s+(?:on|to|about|for|with)(?:\s+\w+){1,3})?|thank(?:s| you)\s+for\s+(?:sharing|asking|that))[\s.,!:;—-]*/i;

// Keep teaching/correcting replies tight: the first `n` sentences, under maxChars,
// always ending on a complete sentence (never a mid-word "…" cut).
function firstSentences(s: string, n: number, maxChars = 240): string {
  const parts = s.match(/[^.!?]+[.!?]+(?:\s|$)/g);
  // FALLBACK: no terminal punctuation -> returning `s` unchanged would bypass the cap.
  // Treat clause connectors (and/but/so/then/because/...) as soft sentence breaks so the
  // n-sentence cap still bites on run-on, punctuation-free drafts; if there are no such
  // breaks either, hard-cut at a word boundary near maxChars.
  if (!parts) {
    const trimmed = s.trim();
    if (!trimmed) return s;
    const clauses = trimmed.split(/\s+(?=(?:and|but|so|then|because|which|while)\b)/i);
    if (clauses.length <= 1) {
      return trimmed.length > maxChars ? trimmed.slice(0, maxChars).replace(/\s\S*$/, "").trimEnd() : trimmed;
    }
    let out = "";
    let count = 0;
    for (const c of clauses) {
      if (count >= n) break;
      const next = out ? `${out} ${c}` : c;
      if (out && next.length > maxChars) break;
      out = next;
      count += 1;
    }
    return (out || clauses[0]).trim();
  }
  let out = "";
  let count = 0;
  for (const p of parts) {
    if (count >= n) break;
    if (out && out.length + p.length > maxChars) break;
    out += p;
    count += 1;
  }
  return (out || parts[0]).trim();
}

export function sanitize(d: Decision, spoiler?: { isPublic: boolean; terms: string[] }, isBotQ = false): Decision {
  // Strip hashtags, links, mentions; collapse whitespace; cap length.
  let text = (d.reply_text || "")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "") // strip any HTML/citation tags (e.g. web-search <cite>)
    .replace(/#[\p{L}\p{N}_]+/gu, "")
    .replace(/https?:\/\/\S+/gi, "")
    // bare domains too (no http://), e.g. a promo link like "rare.example.com/x"
    .replace(/\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|me|app|dev|ai|xyz|info|biz|gg|tv|link|page|site|online|store|shop)\b(?:\/\S*)?/gi, "")
    .replace(/(^|\s)@[\p{L}\p{N}_.]+/gu, "$1")
    .replace(/\s*[—–]\s*/g, ". ") // no em/en dashes; break into two beats (no comma — the voice bans commas)
    .replace(/,\s+(but|so|yet|not|though|although|whereas|while)\b/gi, " $1") // casual voice: no comma before a contrast word
    .replace(EMOJI_SEQ, (m) => (ALLOWED_EMOJI.has([...m][0]) ? m : "")) // only the allowed emojis
    .replace(/\s+/g, " ")
    .trim();

  // Comma backstop: the voice bans commas except in a genuine list of 3+ (which carries >=2 commas).
  // A LONE comma is a clause-join the model slipped past the rule (Sonnet escalations do this most) —
  // split it into two beats. Never touch a comma inside a number (1,000) or a real multi-item list.
  if ((text.match(/(?<!\d),(?!\d)/g) || []).length === 1) text = text.replace(/(?<!\d),(?!\d)\s*/, ". ");

  // Capitalize the first letter of each sentence (e.g. where a dash became a period).
  text = text.replace(/([.!?])\s+(\p{Ll})/gu, (_m, p: string, c: string) => `${p} ${c.toUpperCase()}`);

  // Drop AI-style preambles even when the model ignores the voice rule, and keep
  // teaching/correcting replies short. Re-capitalize if we trimmed the opener.
  const stripped = text.replace(PREAMBLE, "").trimStart();
  if (stripped !== text) text = stripped ? stripped.charAt(0).toUpperCase() + stripped.slice(1) : stripped;

  // Drop a dangling leading "But" left when a correction's acknowledgment lead-in
  // was elided ("But this one is bone." -> "This one is bone."); re-capitalize.
  // (Leave "And"/"So" — those are intentional voice, e.g. "And then we'll take it higher".)
  const debut = text.replace(/^but\s+/i, "");
  if (debut !== text) text = debut.charAt(0).toUpperCase() + debut.slice(1);

  if (d.category === "correct") text = firstSentences(text, 2);
  else if (d.category === "teach") text = firstSentences(text, 3, 360); // room for multi-part clinical questions

  // Backstop length cap: prefer cutting at the last COMPLETE sentence within the budget so a capped
  // reply never ends mid-sentence (the "...crystallized uric acid. The body" bug). Fall back to a
  // word boundary only when there's no earlier sentence break. Teach answers get more room.
  const maxLen = d.category === "teach" ? 480 : 280;
  if (text.length > maxLen) {
    const clipped = text.slice(0, maxLen);
    const sentence = clipped.match(/^[\s\S]*[.!?]/); // longest prefix ending at sentence punctuation
    text = (sentence && sentence[0].length >= maxLen * 0.5 ? sentence[0] : clipped.replace(/\s\S*$/, "")).trimEnd();
  }

  const looksLikeAdvice = ADVICE_PATTERN.test(text);
  // Always screen the base confession terms; when the comment was an "are you a bot" question,
  // ALSO screen the broader identity terms (human / machine / gpt / caught me / ...) that would be
  // a confession or the forbidden denial in that context.
  const confesses = CONFESSION.test(text) || (isBotQ && BOT_ANSWER_LEAK.test(text));
  const personal = d.category === "personal_medical";
  // Whole reply is just a retired stock topper (ignore punctuation/emoji)?
  const isRetired = RETIRED_LINES.test(text.replace(/[^\p{L} ]+/gu, "").trim());

  // Force skip: personal-medical, advice-like wording, an authenticity confession (AI/recreation),
  // a retired stock line, or an empty draft.
  if (d.decision === "reply" && (personal || looksLikeAdvice || confesses || isRetired || text.length === 0)) {
    return {
      decision: "skip",
      category: personal || looksLikeAdvice ? "personal_medical" : confesses ? "complaint" : "other",
      reply_text: "",
      reason: `${d.reason}${isRetired ? " | retired stock line" : ""}${confesses ? " | CONFESSION guard: never admit AI/recreation" : ""} | guard:forced-skip`,
    };
  }

  // ENGLISH-ONLY backstop on OUTPUT: even if the comment passed the input check, the model
  // can still answer in a non-Latin script. Never post that — force a skip.
  if (d.decision === "reply" && isNonEnglishScript(text)) {
    return { decision: "skip", category: "other", reply_text: "", reason: `${d.reason} | non-English output (non-Latin script) | guard:forced-skip` };
  }

  // Spoiler backstop: before the answer is public, never post a reply that NAMES the
  // diagnosis or CONFIRMS a guess as correct (either gives it away). Defense in depth
  // behind the voice rule — stay silent rather than spoil it for everyone still guessing.
  if (d.decision === "reply" && spoiler && !spoiler.isPublic) {
    // An "affirm" reply exists only to confirm a guess — which gives the answer away. Never post
    // one before the reveal, whatever the wording.
    if (d.category === "affirm") {
      return { decision: "skip", category: d.category, reply_text: "", reason: `${d.reason} | spoiler guard: no affirm before the reveal` };
    }
    const low = text.toLowerCase();
    // Compare punctuation-normalized too, so a hyphenated answer ("nail-patella syndrome") is
    // still caught when the draft writes it spaced ("nail patella syndrome").
    const lowNorm = low.replace(/[^\p{L}\p{N}]+/gu, " ");
    const namesAnswer = spoiler.terms.some((t) => {
      if (t.length < 4) return false;
      if (low.includes(t)) return true;
      const tNorm = t.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      return tNorm.length >= 4 && lowNorm.includes(tNorm);
    });
    const confirms =
      /\b(nailed it|nailed|spot on|exactly right|you (?:nailed|got) it|you got (?:it|there)|you called it|that'?s it|that'?s the one|bingo|ding ding|winner|right on the money|correct|yes|yep|yup|exactly|absolutely|perfect|textbook|you'?re right|that'?s right)\b/i.test(text) ||
      /\b100\s*%/.test(text) ||
      /✅|💯/.test(text);
    if (namesAnswer || confirms) {
      return { decision: "skip", category: d.category, reply_text: "", reason: `${d.reason} | spoiler guard: pre-public reveal blocked` };
    }
  }

  // GIF is defense-in-depth banter-only: strip the tag on any non-banter or skipped reply.
  const gifOk = d.decision === "reply" && d.category === "banter" && !!d.gif_tag && d.gif_tag !== "none";
  // Promo is defense-in-depth too: never on a skipped reply or a tender/critical category. A plug
  // next to someone's medical story or a correction is exactly the brand risk this blocklist prevents.
  const PROMO_BLOCKED = new Set<Category>(["personal_medical", "empathize", "correct", "complaint", "spam"]);
  const promoOk =
    d.decision === "reply" && !!d.promo_product && d.promo_product !== "none" && !PROMO_BLOCKED.has(d.category);
  return {
    ...d,
    reply_text: d.decision === "skip" ? "" : text,
    gif_tag: gifOk ? d.gif_tag : undefined,
    promo_product: promoOk ? d.promo_product : undefined,
    promo_explicit: promoOk ? d.promo_explicit : undefined,
  };
}
