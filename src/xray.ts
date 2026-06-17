// Read-only bridge to the xray-cases publisher repo.
//
// When the auto-poster publishes a daily challenge it commits state.json (folder ->
// { threadsPostId, ... }) and the case.json (diagnosis + vetted facts). This lets the
// reply bot look up the live case's answer BY MATCHING the Threads post id, so it can
// judge guesses (right vs wrong) during the window BEFORE the answer is publicly posted.
//
// Everything here is best-effort and fully guarded: any network/parse failure returns
// null and the caller falls back to answers.json or the pinned "Answer:" reply. It never
// throws and never blocks a reply run.

import { config } from "./config";

interface XrayState {
  stages?: Record<string, { threadsPostId?: string }>;
}
interface XrayCase {
  diagnosis?: string;
  aliases?: string[];
  whatYouSee?: string;
  whyItMatters?: string;
  treatment?: string;
  takeaway?: string;
}

export interface BridgedAnswer {
  answer: string;
  facts: string[];
}

// undefined = not fetched yet; null = fetched and failed (don't retry this run).
let stateCache: XrayState | null | undefined;
const caseCache = new Map<string, XrayCase | null>();

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Resolve the diagnosis + facts for a Threads post id from the publisher repo, or null. */
export async function resolveXrayAnswer(postId: string): Promise<BridgedAnswer | null> {
  if (!config.xrayCasesRawBase) return null;
  if (stateCache === undefined) {
    stateCache = await getJson<XrayState>(`${config.xrayCasesRawBase}/state.json`);
  }
  const stages = stateCache?.stages;
  if (!stages) return null;

  const folder = Object.keys(stages).find((f) => stages[f]?.threadsPostId === postId);
  if (!folder) return null;

  if (!caseCache.has(folder)) {
    caseCache.set(folder, await getJson<XrayCase>(`${config.xrayCasesRawBase}/cases/${folder}/case.json`));
  }
  const c = caseCache.get(folder);
  if (!c?.diagnosis) return null;

  const answer = [c.diagnosis, ...(c.aliases ?? [])].filter(Boolean).join(" / ");
  const facts = [c.whatYouSee, c.whyItMatters, c.treatment, c.takeaway].filter((x): x is string => !!x && x.trim().length > 0);
  return { answer, facts };
}
