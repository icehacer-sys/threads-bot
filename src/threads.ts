// Thin Threads Graph API client.
// Docs: https://developers.facebook.com/docs/threads
// Host + version are pinned in config (graph.threads.net / v1.0).
//
// Auth: the access token is sent as an Authorization: Bearer header (keeps it
// out of URLs/logs). If an endpoint rejects the header, the alternative is the
// ?access_token= query param documented by Meta.

import { config, requireEnv } from "./config";

export interface ThreadsPost {
  id: string;
  text?: string;
  permalink?: string;
  timestamp?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  children?: { data?: { id: string; media_type?: string; media_url?: string }[] };
}

export interface ThreadsReply {
  id: string;
  text?: string;
  username?: string;
  timestamp?: string;
  has_replies?: boolean;
  hide_status?: string;
  replied_to?: { id: string };
  media_type?: string; // TEXT_POST | IMAGE | VIDEO | CAROUSEL_ALBUM
  media_url?: string;
  thumbnail_url?: string;
}

interface ListResponse<T> {
  data?: T[];
  paging?: { cursors?: unknown; next?: string };
}

async function api<T>(
  path: string,
  opts: { method?: "GET" | "POST"; query?: Record<string, string | number | undefined>; body?: Record<string, string> } = {},
): Promise<T> {
  const token = requireEnv("THREADS_ACCESS_TOKEN");
  const url = new URL(config.graphBase + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  }

  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers: { Authorization: `Bearer ${token}` },
  };
  if (opts.body) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(opts.body).toString();
  }

  const res = await fetch(url, init);
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Threads API ${init.method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  }
  return json as T;
}

/**
 * GET an edge and follow `paging.next` until exhausted, returning every item.
 * The Threads replies/conversation edges page at ~25, so without this the bot
 * only ever sees the first page of comments. Guarded at 25 pages (~2500 items).
 */
async function apiGetAll<T>(
  path: string,
  query: Record<string, string | number | undefined> = {},
): Promise<T[]> {
  const token = requireEnv("THREADS_ACCESS_TOKEN");
  const first = new URL(config.graphBase + path);
  for (const [k, v] of Object.entries(query)) {
    if (v != null) first.searchParams.set(k, String(v));
  }

  let next: string | undefined = first.toString();
  const out: T[] = [];
  for (let page = 0; next && page < 25; page++) {
    const res = await fetch(next, { headers: { Authorization: `Bearer ${token}` } });
    const json: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Threads API GET ${path} -> ${res.status}: ${JSON.stringify(json)}`);
    }
    const body = json as ListResponse<T>;
    if (body.data) out.push(...body.data);
    next = body.paging?.next;
  }
  if (next) console.warn(`  ! ${path}: hit the 25-page (~2500 item) fetch cap; items beyond that were not read this run`);
  return out;
}

/** The authenticated account's own username (used to detect our own replies). */
export async function getMyUsername(): Promise<string> {
  const me = await api<{ id: string; username?: string }>(`/me`, { query: { fields: "id,username" } });
  if (!me.username) throw new Error("Could not read own username from /me");
  return me.username;
}

/** Recent posts within the configured time window. */
export async function getRecentPosts(): Promise<ThreadsPost[]> {
  const query: Record<string, string | number | undefined> = {
    fields: "id,permalink,timestamp,text,media_type,media_url,thumbnail_url,children{id,media_type,media_url}",
    limit: config.maxPostsScanned,
  };
  if (config.windowHours > 0) {
    query.since = Math.floor((Date.now() - config.windowHours * 3600 * 1000) / 1000);
  }
  const r = await api<ListResponse<ThreadsPost>>(`/${config.threadsUserId}/threads`, { query });
  return r.data ?? [];
}

/** A single post by its media id — used for pinned posts that sit outside the recent window. */
export async function getPostById(id: string): Promise<ThreadsPost> {
  return api<ThreadsPost>(`/${id}`, {
    query: { fields: "id,permalink,timestamp,text,media_type,media_url,thumbnail_url,children{id,media_type,media_url}" },
  });
}

/** The account's own posts newest-first, ignoring the time window. Powers `--list` and resolves a pinned post URL/shortcode to its media id. */
export async function getAllMyPosts(limit = 150): Promise<ThreadsPost[]> {
  const out = await apiGetAll<ThreadsPost>(`/${config.threadsUserId}/threads`, {
    fields: "id,permalink,timestamp,text",
    limit: 100,
  });
  return out.slice(0, limit);
}

/** Top-level replies (comments) on a post — ALL of them, across pages. */
export async function getReplies(mediaId: string): Promise<ThreadsReply[]> {
  return apiGetAll<ThreadsReply>(`/${mediaId}/replies`, {
    fields: "id,text,username,timestamp,has_replies,hide_status,replied_to,media_type,media_url,thumbnail_url",
    // Newest-first: if a viral thread exceeds the 25-page fetch cap, the items dropped are the OLD
    // already-processed ones, not fresh unanswered comments. (selectCandidates re-sorts anyway.)
    reverse: "true",
    limit: 100,
  });
}

/** Full flattened conversation under a post (used to see what we've already answered). */
export async function getConversation(mediaId: string): Promise<ThreadsReply[]> {
  return apiGetAll<ThreadsReply>(`/${mediaId}/conversation`, {
    fields: "id,text,username,timestamp,has_replies,hide_status,replied_to,media_type,media_url,thumbnail_url",
    // Newest-first so the bot's own recent answers/replies stay visible for dedup even when a huge
    // conversation exceeds the 25-page cap.
    reverse: "true",
    limit: 100,
  });
}

/** A character range to blur as a spoiler. */
export interface SpoilerEntity {
  entity_type: "SPOILER";
  offset: number;
  length: number;
}

/**
 * Post a reply to a comment or post. Two-step: create container, then publish.
 * Pass `spoilers` to blur character ranges (used for the answer breakdown).
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function postReply(targetId: string, text: string, spoilers?: SpoilerEntity[], gifId?: string): Promise<string> {
  const body: Record<string, string> = { media_type: "TEXT", text, reply_to_id: targetId };
  if (spoilers && spoilers.length > 0) body.text_entities = JSON.stringify(spoilers);
  // A curated reaction GIF rides along on the TEXT container (Threads `gif_attachment`). If the
  // container is rejected (bad id, or gif_attachment not accepted on a reply) fall back to the
  // SAME reply as plain text — a GIF must never cost us the reply.
  if (gifId) body.gif_attachment = JSON.stringify({ gif_id: gifId, provider: "GIPHY" });
  let created: { id: string };
  try {
    created = await api<{ id: string }>(`/${config.threadsUserId}/threads`, { method: "POST", body });
  } catch (err) {
    if (!gifId) throw err;
    console.warn(`  ! gif container rejected — posting text-only: ${(err as Error).message.slice(0, 120)}`);
    delete body.gif_attachment;
    created = await api<{ id: string }>(`/${config.threadsUserId}/threads`, { method: "POST", body });
  }

  // The reply container isn't always immediately publishable ("media not found"),
  // so wait briefly and retry the publish a few times before giving up.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(attempt === 0 ? 2000 : 3000);
    try {
      const published = await api<{ id: string }>(`/${config.threadsUserId}/threads_publish`, {
        method: "POST",
        body: { creation_id: created.id },
      });
      return published.id;
    } catch (err) {
      // DOUBLE-REPLY GUARD: a publish can succeed on Meta's side while its HTTP response is lost to
      // a network blip. Re-publishing the SAME creation_id then fails with an "already published"
      // error — but the reply IS live. Treat that as success so the caller records it (markReplied)
      // and never re-posts a duplicate on the next run. Without this, the lost-response reply is
      // re-created every run until it happens to surface in the live thread — the double we saw.
      if (alreadyPublished(err)) {
        console.warn(`  reply already live (recovered a lost publish response) for ${targetId}`);
        return created.id; // the reply exists; id is best-effort (caller uses it only for logging)
      }
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * True when a publish error means the container was ALREADY published — i.e. a prior publish of
 * the same creation_id actually succeeded but we lost its response. Narrow on purpose: a false
 * positive would drop a reply, so match only clear "already published" phrasings.
 */
function alreadyPublished(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (m.includes("already") && m.includes("publish")) || m.includes("has already been published");
}
