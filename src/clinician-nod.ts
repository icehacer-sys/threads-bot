// Clinician nod (owner approved 2026-10-17). Clinicians post full structured reads every night and the
// audit found several got silence. Once per post, after the reveal, the strongest clinician read gets a
// short warm facts-only nod. Detection is deterministic and offline-testable; every guard still applies.
import type { ThreadsReply } from './threads';
import { isAiProvenanceComment, isPoliticalJab } from './deepseek-media-policy';

export const CLINICIAN_NOD_NOTE = 'CLINICIAN READ: This commenter gave a full structured read of the film. Give one short warm nod in one or two sentences that names the specific part of their read the published answer or case facts support. Confirm only what the case states. If they named a finding the case never mentions leave it alone rather than confirming it. No grading of anything outside the case and no lecture back.';

const CREDENTIAL = /\b(?:rn|bsn|md|mbbs|mbchb|np|pa-c|frcr|facr|radiologist|radiology|radiographer|rad tech|sonographer|nurse|resident|registrar|attending|consultant|physician|paramedic|emt|surgeon|er doc|ed doc|med student|medical student|doctor here|nurse here|clinician)\b/i;
// Short credentials and views only count in capitals ("do", "us" and "pa" are ordinary words).
const CREDENTIAL_CAPS = /\bDO\b|\bRT\(R\)|\bPA\b/;
const MODALITY = /\b(?:ct|cta|mri|mra|x-?ray|radiograph|kub|ivp|urogram|angiogram|angiography|ultrasound|lateral view|axial|coronal|sagittal|contrast|frontal|supine|erect|plain film)\b/i;
const MODALITY_CAPS = /\b(?:AP|PA|US|CT)\b/;
const FINDING = /\b(?:dilat\w*|distend\w*|enlarg\w*|opacit\w*|lucen\w*|densit\w*|calcif\w*|mass(?:es)?|lesions?|nodules?|effusions?|fractur\w*|air[- ]fluid|pneumo\w*|hydro\w*|bilateral|unilateral|proximal|distal|infrarenal|suprarenal|aneurysm\w*|stenos\w*|obstruct\w*|consolidat\w*|cavitat\w*|herniat\w*|displac\w*|sclerotic|lytic|diverticul\w*|tortuous|ectatic|thrombus|thrombos\w*|collateral\w*|draining vein|feeding arter\w*|nidus|ureter\w*|renal pelvis|calyc\w*|cortical|intracranial|extra-?axial|skull base|sinus\w*|aort\w*|sigmoid|colon\w*|wall thickening|fat stranding)\b/gi;
const STRUCTURE = /\b(?:impression|dx|ddx|diagnosis|differential|consistent with|suggestive of|likely|probable|findings?|r\/o|rule out|favou?r)\b/i;
const NOT_A_READ = /\b(?:lol|lmao|haha\w*|misinformation|fake|fraud|scam)\b|[🤣😂]/iu;

export const CLINICIAN_MIN_SCORE = 7;

/** How strongly a comment reads like a clinician's structured read of the film. */
export function clinicianReadScore(text: string | undefined): number {
  const t = (text ?? '').trim();
  const words = t.split(/\s+/).filter(Boolean).length;
  if (words < 8 || NOT_A_READ.test(t) || isPoliticalJab(t) || isAiProvenanceComment(t)) return 0;
  let score = 0;
  if (CREDENTIAL.test(t) || CREDENTIAL_CAPS.test(t)) score += 3;
  if (MODALITY.test(t) || MODALITY_CAPS.test(t)) score += 2;
  score += Math.min(4, new Set((t.match(FINDING) ?? []).map(w => w.toLowerCase())).size);
  if (STRUCTURE.test(t)) score += 2;
  if (words >= 15) score += 1;
  if (words >= 30) score += 1;
  return score;
}

export function isClinicianRead(text: string | undefined): boolean {
  return clinicianReadScore(text) >= CLINICIAN_MIN_SCORE;
}

/**
 * The single comment that gets tonight's nod: the highest-scoring top-level clinician read among this
 * poll's candidates. Replies under other threads (often disputes with the bot) never qualify.
 */
export function pickClinicianNod(candidates: ThreadsReply[], postId: string): string | undefined {
  let best: { id: string; score: number } | undefined;
  for (const c of candidates) {
    if (c.replied_to?.id && c.replied_to.id !== postId) continue;
    const score = clinicianReadScore(c.text);
    if (score >= CLINICIAN_MIN_SCORE && (!best || score > best.score)) best = { id: c.id, score };
  }
  return best?.id;
}
