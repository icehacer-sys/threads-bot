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
}

export async function classifyAndDraft(input: ClassifyInput): Promise<Decision> {
  const { postText, commentText, answer, facts, images, recentReplies } = input;
  const factsBlock =
    facts && facts.length
      ? `VETTED FACTS (owner-reviewed, source of truth):\n- ${facts.join("\n- ")}`
      : "VETTED FACTS: none";
  const recentBlock =
    recentReplies && recentReplies.length
      ? `ALREADY POSTED on this post (do NOT reuse these openings, sentence shapes, or jokes — write something clearly different):\n- ${recentReplies.slice(-15).join("\n- ")}`
      : "";
  const userText = [
    `POST:\n${postText || "(unknown)"}`,
    `CORRECT ANSWER (private, never reveal): ${answer && answer.trim() ? answer.trim() : "unknown"}`,
    factsBlock,
    recentBlock,
    `COMMENT:\n${commentText}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  // Image blocks first (so the model sees the X-ray), then the text.
  const content: Array<Anthropic.ImageBlockParam | Anthropic.TextBlockParam> = [];
  for (const img of images ?? []) {
    content.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } });
  }
  content.push({ type: "text", text: userText });

  try {
    const res = await getClient().messages.create({
      model: config.model,
      max_tokens: 1024,
      // System prompt is static -> cache it. (Caching only kicks in once the
      // prefix passes the model's minimum; see README. The marker is harmless otherwise.)
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
      // Structured outputs: the response text is guaranteed to match REPLY_SCHEMA.
      // Cast keeps us compatible across SDK minor versions that may not type output_config yet.
      output_config: { format: { type: "json_schema", schema: REPLY_SCHEMA } },
    } as unknown as Anthropic.MessageCreateParamsNonStreaming);

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    const parsed = JSON.parse(text) as Decision;
    return sanitize(parsed);
  } catch (err) {
    // Any failure (API error, malformed JSON) -> stay silent. Never post on uncertainty.
    const msg = err instanceof Error ? err.message : String(err);
    return { decision: "skip", category: "other", reply_text: "", reason: `error: ${msg.slice(0, 140)}` };
  }
}

// Only these emojis are allowed in replies (the account owner's set).
// Everything else (😳, 🦴, 👀, 🤘, ...) is stripped before posting.
const ALLOWED_EMOJI = new Set(["🤣", "✅", "💯", "👏"]);
const EMOJI_SEQ = /\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic}️?)*/gu;

// Phrases that read as medical advice. If any slip into a draft, we force a skip.
const ADVICE_PATTERN =
  /\b(you should|i (would |really )?recommend|see (a|your) (doctor|physician|gp|specialist|dentist)|get (it|that|this) (checked|looked at|scanned|seen)|consult|seek medical|go to the (er|a&e|hospital|doctor)|you (might|may|could) have|sounds like you (have|might))\b/i;

// AI-style preambles the model sometimes adds despite the voice rules. Stripped
// from the start of any reply ("Great question.", "Thanks for sharing", ...).
const PREAMBLE =
  /^\s*(?:(?:great|good|nice|excellent|interesting)\s+(?:question|point|catch|eye|observation|guess)|thank(?:s| you)\s+for\s+(?:sharing|asking|that))\b[\s.,!:;—-]*/i;

// Keep teaching/correcting replies tight: at most the first `n` sentences.
function firstSentences(s: string, n: number): string {
  const parts = s.match(/[^.!?]+[.!?]+(?:\s|$)/g);
  if (!parts || parts.length <= n) return s;
  return parts.slice(0, n).join("").trim();
}

export function sanitize(d: Decision): Decision {
  // Strip hashtags, links, mentions; collapse whitespace; cap length.
  let text = (d.reply_text || "")
    .replace(/#[\p{L}\p{N}_]+/gu, "")
    .replace(/https?:\/\/\S+/gi, "")
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
  if (d.category === "teach" || d.category === "correct") text = firstSentences(text, 2);

  if (text.length > 280) text = text.slice(0, 277).trimEnd() + "…";

  const looksLikeAdvice = ADVICE_PATTERN.test(text);
  const personal = d.category === "personal_medical";

  // Force skip: personal-medical category, advice-like wording, or empty draft.
  if (d.decision === "reply" && (personal || looksLikeAdvice || text.length === 0)) {
    return {
      decision: "skip",
      category: personal || looksLikeAdvice ? "personal_medical" : "other",
      reply_text: "",
      reason: `${d.reason} | guard:forced-skip`,
    };
  }

  return { ...d, reply_text: d.decision === "skip" ? "" : text };
}
