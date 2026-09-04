// The caption signature that identifies a "guess the diagnosis" CASE post.
//
// The /threads edge returns challenges, answer replies, seed replies and banter in ONE stream,
// so every engagement ratio computed over the raw edge is wrong. Both countcases.ts and
// engagementaudit.ts have to filter with the same definition or their numbers silently disagree,
// which is why this lives here instead of being copied into each.
//
// No /g flag on purpose: a global regex carries lastIndex between .test() calls and would skip
// every other match when reused across a loop.
export const CHALLENGE =
  /then the .{0,30}loaded|patient came in|quick[^.\n]{0,25}challenge|diagnosis challenge|spot the diagnosis|out of place|badly out of place|senior med student|5th-year med student|guess the/i;
