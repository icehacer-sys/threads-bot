// Reproducible offline audit of a saved conversation. No credentials or API calls.
import { readFileSync } from 'node:fs';
import { emojiProfile, nearDuplicates, shapeClusters } from '../src/reply-metrics';
import { replyStyleIssue } from '../src/reply-style';
import { unsupportedConfirmation } from '../src/case-evidence';
const file = process.argv[2];
if (!file) throw new Error('Usage: npx tsx tools/audit-replies.mts conversation.json [owner username]');
const data = JSON.parse(readFileSync(file, 'utf8'));
const comments = Array.isArray(data) ? data : data.comments;
if (!Array.isArray(comments)) throw new Error('Expected comments array');
const owner = process.argv[3] ?? 'mdnoteslab';
const rows = comments.filter(c => c.username === owner && typeof c.text === 'string' && !c.text.startsWith('Answer:'));
const replies = rows.map(c => c.text as string);
console.log(JSON.stringify({ replies: replies.length, emoji: emojiProfile(replies),
  styleIssues: rows.flatMap(c => replyStyleIssue(c.text) ? [{ id: c.id, issue: replyStyleIssue(c.text) }] : []),
  confirmationClaimsNeedingEvidence: rows.filter(c => unsupportedConfirmation(c.text)).map(c => ({ id: c.id, text: c.text })),
  nearDuplicateCandidates: nearDuplicates(replies), connectedReviewGroups: shapeClusters(replies),
  note: 'Shared clinical language is not automatically bad. Connected groups are review candidates. This audit does not establish clinical accuracy.'
}, null, 2));
