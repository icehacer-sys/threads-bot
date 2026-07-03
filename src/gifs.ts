// Curated reaction GIFs for the RARE gif-attachment reply (Threads `gif_attachment`).
// Every entry is owner-vetted; the bot NEVER searches GIPHY live — an off-tone GIF next to a
// disease case is a screenshot-able brand incident. data/gifs.json is a hand-picked list of
// GIPHY ids (the alphanumeric id at the end of a giphy.com/gifs/<slug>-<ID> URL). An empty or
// missing file leaves the whole feature inert (the classifier can only ever pick "none").
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export interface CuratedGif {
  tag: string; // mood vocabulary the classifier emits (dead / mind_blown / applause / ...)
  gif_id: string; // GIPHY id
  url: string; // human-review link (not used at runtime)
  desc: string; // shown in logs + dry-run output
}

function loadGifs(): CuratedGif[] {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const arr = JSON.parse(readFileSync(join(here, "..", "data", "gifs.json"), "utf8"));
    return Array.isArray(arr) ? (arr as CuratedGif[]) : [];
  } catch {
    return []; // no / invalid file -> feature inert
  }
}

export const GIFS = loadGifs();

// The mood tags the classifier may emit, "none" first. Computed ONCE at load so the reply
// tool schema (and with it the cached prompt prefix) stays identical across a run.
export const GIF_TAGS: string[] = ["none", ...new Set(GIFS.map((g) => g.tag))];

/**
 * Pick a curated GIF for an approved banter reply by mood tag, excluding recently-used ids.
 * Returns null when no on-tag GIF is available — the caller then posts text only. NEVER
 * substitutes a different mood (a wrong-mood GIF is the exact brand risk this design prevents).
 */
export function pickGif(tag: string | undefined, recentIds: string[]): CuratedGif | null {
  if (!tag || tag === "none") return null;
  const pool = GIFS.filter((g) => g.tag === tag && !recentIds.includes(g.gif_id));
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}
