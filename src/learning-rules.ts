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
  if (stop !== "end_turn" || text.length < 120 || text.length > 6000 || bullets.length < 1 || bullets.length > 16 || bullets.some(l => l.length > 500) ||
      !text.startsWith("# Learned voice notes") || !["## Do more", "## Do less", "## Retire"].every(h => text.includes(h))) throw new Error("Invalid or truncated learned notes; active notes retained");
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
