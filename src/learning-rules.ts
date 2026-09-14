export type Signal = "positive" | "question" | "correction" | "complaint" | "neutral" | "no-followup";
/** Coarse sampling labels, not proof of reply quality. The coach receives the actual follow-ups. */
export function followupSignal(texts: string[]): Signal {
  if (!texts.length) return "no-followup";
  const text = texts.join(" ");
  if (/wrong|incorrect|actually|not true|mistake/i.test(text)) return "correction";
  if (/fake|bot|spam|annoy|stop|mislead|nonsense/i.test(text)) return "complaint";
  if (/\?/.test(text)) return "question";
  if (/thank|helpful|makes sense|appreciate|haha|😂|🤣/i.test(text)) return "positive";
  return "neutral";
}
export function validateNotes(text: string, stop: string | null): void {
  const bullets = text.split("\n").filter(l => /^- /.test(l));
  const issues: string[] = [];
  if (stop !== "end_turn") issues.push(`stop_reason=${stop ?? 'null'} (expected end_turn)`);
  if (text.length < 120 || text.length > 6000) issues.push(`characters=${text.length} (expected 120-6000)`);
  if (bullets.length < 1 || bullets.length > 16) issues.push(`bullets=${bullets.length} (expected 1-16)`);
  const longest = Math.max(0, ...bullets.map(l => l.length));
  if (longest > 500) issues.push(`longest bullet=${longest} characters (maximum 500)`);
  if (!text.startsWith("# Learned voice notes")) issues.push('missing title');
  for (const heading of ["## Do more", "## Do less", "## Retire"]) if (!text.includes(heading)) issues.push(`missing heading: ${heading}`);
  if (issues.length) throw new Error(`Invalid or truncated learned notes; active notes retained: ${issues.join('; ')}`);
}
export function balancedSample<T>(items: T[], key: (item: T) => string, limit: number): T[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) { const k = key(item); buckets.set(k, [...(buckets.get(k) ?? []), item]); }
  const result: T[] = [];
  while (result.length < limit && [...buckets.values()].some(b => b.length)) for (const bucket of buckets.values()) {
    if (bucket.length && result.length < limit) result.push(bucket.shift()!);
  }
  return result;
}
