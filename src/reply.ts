// Classify a single comment and draft a reply in the brand voice.
// Uses the Anthropic Messages API with structured outputs (guaranteed-valid JSON).
// Every result passes through sanitize() as defense-in-depth before it can be posted.

import Anthropic from "@anthropic-ai/sdk";
import { config, requireEnv } from "./config";
import { SYSTEM_PROMPT } from "./voice";

export type Category =
  | "banter"
  | "affirm"
  | "correct"
  | "teach"
  | "empathize"
  | "personal_medical"
  | "complaint"
  | "spam"
  | "other";

export interface Decision {
  decision: "reply" | "skip";
  category: Category;
  reply_text: string;
  reason: string;
}

// JSON schema for structured outputs. additionalProperties:false is required.
const REPLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: { type: "string", enum: ["reply", "skip"] },
    category: {
      type: "string",
      enum: ["banter", "affirm", "correct", "teach", "empathize", "personal_medical", "complaint", "spam", "other"],
    },
    reply_text: { type: "string" },
    reason: { type: "string" },
  },
  required: ["decision", "category", "reply_text", "reason"],
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
}

export async function classifyAndDraft(input: ClassifyInput): Promise<Decision> {
  const { postText, commentText, answer, facts, images, recentReplies, commentImages, commentMediaKind, inAnswerThread, priorExchange } = input;
  const factsBlock =
    facts && facts.length
      ? `VETTED FACTS (owner-reviewed, source of truth):\n- ${facts.join("\n- ")}`
      : "VETTED FACTS: none";
  const recentBlock =
    recentReplies && recentReplies.length
      ? `ALREADY POSTED on this post (do NOT reuse these openings, sentence shapes, jokes, or punchlines — write something clearly different):\n- ${recentReplies.slice(-40).join("\n- ")}`
      : "";
  const mediaNote =
    commentMediaKind === "video"
      ? "NOTE: the commenter sent a GIF/video you cannot see. React to their words and the playful gesture of sending one."
      : commentMediaKind === "video-frame"
        ? "NOTE: the commenter sent a GIF/video; ONE still frame from it is shown above (you see a single frame, not the motion). React to what is in the frame and the gesture."
        : commentImages && commentImages.length
          ? "NOTE: the commenter attached the image shown above. React to what is actually in it and tie it to the case."
          : "";
  const answerLine = inAnswerThread
    ? `CORRECT ANSWER (already revealed publicly in this answer thread, so you MAY name and discuss it): ${answer && answer.trim() ? answer.trim() : "unknown"}`
    : `CORRECT ANSWER (private, never reveal): ${answer && answer.trim() ? answer.trim() : "unknown"}`;
  const threadNote = inAnswerThread
    ? "NOTE: this comment is a reply under your pinned Answer post, where the diagnosis is already public. Answer follow-up questions about the case directly (prognosis, mechanism, what to read next) and react to reactions. No need to stay coy about the diagnosis here."
    : "";
  const followUpNote = priorExchange
    ? `THIS IS A FOLLOW-UP under your own reply. Earlier the commenter said "${priorExchange.commenter}" and you replied "${priorExchange.bot}". The COMMENT below is their reply back to you. Reply ONLY if it is a genuine question or adds something worth answering — answer it directly, in the context of what was already said. If it is just thanks, agreement, or light banter, decision "skip" (do not extend the thread). Either way this is your LAST reply in this thread: give a complete answer, do NOT ask anything back or invite more back-and-forth.`
    : "";
  const userText = [
    `POST:\n${postText || "(unknown)"}`,
    answerLine,
    threadNote,
    followUpNote,
    factsBlock,
    recentBlock,
    mediaNote,
    `COMMENT:\n${commentText || "(no text — just the attached image)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  // Labelled image blocks (X-ray, then any comment attachment), then the text.
  const content: Array<Anthropic.ImageBlockParam | Anthropic.TextBlockParam> = [];
  if (images && images.length) {
    content.push({ type: "text", text: "THE X-RAY ON THE POST:" });
    images.forEach((img, i) => {
      const block: Anthropic.ImageBlockParam = { type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } };
      // Cache the X-ray so every comment on the same post reuses it (cheap reads, less rate pressure).
      if (i === images.length - 1) block.cache_control = { type: "ephemeral", ttl: "1h" };
      content.push(block);
    });
  }
  if (commentImages && commentImages.length) {
    content.push({
      type: "text",
      text: commentMediaKind === "video-frame" ? "A STILL FRAME FROM THE GIF/VIDEO THIS COMMENTER SENT:" : "THE IMAGE THIS COMMENTER ATTACHED:",
    });
    for (const img of commentImages) content.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } });
  }
  content.push({ type: "text", text: userText });

  // The submit_reply tool gives guaranteed-structured output; web_search (optional)
  // lets the model look up references it does not recognize. With web search off we
  // FORCE submit_reply for a deterministic single call. With it on we let the model
  // choose to search first (server-side, auto-run), then submit.
  const tools: unknown[] = [
    {
      name: "submit_reply",
      description: "Submit your final decision and reply for this one comment. Call this exactly once, last.",
      input_schema: REPLY_SCHEMA,
    },
  ];
  let toolChoice: unknown = { type: "tool", name: "submit_reply" };
  if (config.webSearch) {
    tools.unshift({ type: "web_search_20250305", name: "web_search", max_uses: 3 });
    toolChoice = { type: "auto" };
  }

  try {
    const res = await getClient().messages.create({
      model: config.model,
      max_tokens: 1024,
      // System prompt is static -> cache it for 1h (survives the gaps between 10-min cycles).
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral", ttl: "1h" } }],
      messages: [{ role: "user", content }],
      tools,
      tool_choice: toolChoice,
    } as unknown as Anthropic.MessageCreateParamsNonStreaming);

    if (res.content.some((b) => (b as { type: string }).type === "web_search_tool_result")) {
      console.log(`    (web search used for: "${commentText.slice(0, 40).replace(/\s+/g, " ")}")`);
    }
    const submit = res.content.find(
      (b) => (b as { type: string; name?: string }).type === "tool_use" && (b as { name?: string }).name === "submit_reply",
    ) as { input?: unknown } | undefined;
    if (!submit?.input) {
      return { decision: "skip", category: "other", reply_text: "", reason: "no submit_reply produced" };
    }
    return sanitize(submit.input as Decision);
  } catch (err) {
    // Any failure (API error, bad output) -> stay silent. Never post on uncertainty.
    const msg = err instanceof Error ? err.message : String(err);
    return { decision: "skip", category: "other", reply_text: "", reason: `error: ${msg.slice(0, 140)}` };
  }
}

// Only these emojis are allowed in replies (the account owner's set).
// Everything else (😳, 🦴, 👀, 🤘, ...) is stripped before posting.
const ALLOWED_EMOJI = new Set(["🤣", "✅", "💯", "👏"]);
const EMOJI_SEQ = /\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic}️?)*/gu;

// Worn-out house one-liners. The model still reaches for these as a lazy dry topper
// despite the voice rules, so if a WHOLE reply is just one of them, we skip it.
const RETIRED_LINES = /^(radiologically confirmed|radiology confirms|literally|confirmed)$/i;

// Phrases that read as medical advice. If any slip into a draft, we force a skip.
const ADVICE_PATTERN =
  /\b(you should|i (would |really )?recommend|see (a|your) (doctor|physician|gp|specialist|dentist)|get (it|that|this) (checked|looked at|scanned|seen)|consult|seek medical|go to the (er|a&e|hospital|doctor)|you (might|may|could) have|sounds like you (have|might))\b/i;

// AI-style preambles the model sometimes adds despite the voice rules. Stripped
// from the start of any reply ("Great question.", "Thanks for sharing", ...).
const PREAMBLE =
  /^\s*(?:(?:great|good|nice|excellent|interesting|amazing|solid|fair)\s+(?:question|point|catch|eye|observation|guess|call|thinking|instinct|insight)s?(?:\s+(?:on|to|about|for|with)(?:\s+\w+){1,3})?|thank(?:s| you)\s+for\s+(?:sharing|asking|that))[\s.,!:;—-]*/i;

// Keep teaching/correcting replies tight: the first `n` sentences, under maxChars,
// always ending on a complete sentence (never a mid-word "…" cut).
function firstSentences(s: string, n: number, maxChars = 240): string {
  const parts = s.match(/[^.!?]+[.!?]+(?:\s|$)/g);
  if (!parts) return s;
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

export function sanitize(d: Decision): Decision {
  // Strip hashtags, links, mentions; collapse whitespace; cap length.
  let text = (d.reply_text || "")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "") // strip any HTML/citation tags (e.g. web-search <cite>)
    .replace(/#[\p{L}\p{N}_]+/gu, "")
    .replace(/https?:\/\/\S+/gi, "")
    // bare domains too (no http://), e.g. a promo link like "rare.example.com/x"
    .replace(/\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|me|app|dev|ai|xyz|info|biz|gg|tv|link|page|site|online|store|shop)\b(?:\/\S*)?/gi, "")
    .replace(/(^|\s)@[\p{L}\p{N}_.]+/gu, "$1")
    .replace(/\s*[—–]\s*/g, ", ") // no em/en dashes; keep it in their voice
    .replace(/,\s+(but|so|yet|not|though|although|whereas|while)\b/gi, " $1") // casual voice: no comma before a contrast word
    .replace(EMOJI_SEQ, (m) => (ALLOWED_EMOJI.has([...m][0]) ? m : "")) // only the allowed emojis
    .replace(/\s+/g, " ")
    .trim();

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

  // Backstop length cap: cut at a word boundary (never mid-word, no trailing "…").
  // Teach answers (esp. multi-part questions) get more room; everything else stays tight.
  const maxLen = d.category === "teach" ? 480 : 280;
  if (text.length > maxLen) text = text.slice(0, maxLen).replace(/\s\S*$/, "").trimEnd();

  const looksLikeAdvice = ADVICE_PATTERN.test(text);
  const personal = d.category === "personal_medical";
  // Whole reply is just a retired stock topper (ignore punctuation/emoji)?
  const isRetired = RETIRED_LINES.test(text.replace(/[^\p{L} ]+/gu, "").trim());

  // Force skip: personal-medical category, advice-like wording, retired stock line, or empty draft.
  if (d.decision === "reply" && (personal || looksLikeAdvice || isRetired || text.length === 0)) {
    return {
      decision: "skip",
      category: personal || looksLikeAdvice ? "personal_medical" : "other",
      reply_text: "",
      reason: `${d.reason}${isRetired ? " | retired stock line" : ""} | guard:forced-skip`,
    };
  }

  return { ...d, reply_text: d.decision === "skip" ? "" : text };
}
