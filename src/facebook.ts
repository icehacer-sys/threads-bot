// Facebook Page Graph API client for the reply bot: read the page's recent posts and their
// comments, and post replies. Auth is the Page access token (FB_PAGE_ACCESS_TOKEN), sent as
// the access_token query param. Reuses the same token + page the xray-poster publishes with.

import { config, requireEnv } from "./config";

export interface FbPost {
  id: string;
  message?: string;
  created_time?: string;
  permalink_url?: string;
}

export interface FbComment {
  id: string;
  message?: string;
  created_time?: string;
  from?: { id?: string; name?: string };
  is_hidden?: boolean;
}

/** The Page's own numeric id (to recognize the page's own comments and skip them). */
export function myPageId(): string {
  return requireEnv("FB_PAGE_ID");
}

async function fbGet<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = new URL(`${config.fbGraphBase}/${path}`);
  url.searchParams.set("access_token", requireEnv("FB_PAGE_ACCESS_TOKEN"));
  for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, String(v));
  const res = await fetch(url);
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) {
    throw new Error(`Facebook GET ${path} -> ${res.status}: ${json?.error?.message ?? JSON.stringify(json)}`);
  }
  return json as T;
}

/** GET an edge and follow paging.next until exhausted (guarded at 25 pages ~2500 items). */
async function fbGetAll<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T[]> {
  const first = new URL(`${config.fbGraphBase}/${path}`);
  first.searchParams.set("access_token", requireEnv("FB_PAGE_ACCESS_TOKEN"));
  for (const [k, v] of Object.entries(query)) if (v != null) first.searchParams.set(k, String(v));
  let next: string | undefined = first.toString();
  const out: T[] = [];
  for (let page = 0; next && page < 25; page++) {
    const res = await fetch(next);
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) {
      throw new Error(`Facebook GET ${path} -> ${res.status}: ${json?.error?.message ?? JSON.stringify(json)}`);
    }
    if (Array.isArray(json.data)) out.push(...json.data);
    next = json.paging?.next;
  }
  return out;
}

/** The page's recent posts (newest first). */
export async function getPagePosts(limit = 5): Promise<FbPost[]> {
  const r = await fbGet<{ data?: FbPost[] }>(`${myPageId()}/posts`, {
    fields: "id,message,created_time,permalink_url",
    limit,
  });
  return r.data ?? [];
}

/** All top-level comments on a post (paged). filter=stream = full chronological stream. */
export async function getComments(postId: string): Promise<FbComment[]> {
  return fbGetAll<FbComment>(`${postId}/comments`, {
    fields: "id,message,created_time,from,is_hidden",
    filter: "stream",
    limit: 100,
  });
}

/** Reply to a comment (creates a nested comment under it). Returns the new comment id. */
export async function replyToComment(commentId: string, message: string): Promise<string> {
  const url = new URL(`${config.fbGraphBase}/${commentId}/comments`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ message, access_token: requireEnv("FB_PAGE_ACCESS_TOKEN") }).toString(),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) {
    throw new Error(`Facebook reply ${commentId} -> ${res.status}: ${json?.error?.message ?? JSON.stringify(json)}`);
  }
  return String(json.id ?? "");
}
