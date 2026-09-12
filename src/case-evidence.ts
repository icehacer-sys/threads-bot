/** Case labels and explanatory facts are not patient test results. */
export interface DiagnosticContext {
  certainty: 'illustrative' | 'imaging-supported' | 'confirmed';
  confirmationEvidence: string[];
  acceptedDifferentials: string[];
}

export function diagnosticContext(value?: Partial<DiagnosticContext>, generated = false): DiagnosticContext {
  const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && !!s.trim()) : [];
  const evidence = generated ? [] : strings(value?.confirmationEvidence);
  return {
    certainty: generated ? 'illustrative' : value?.certainty === 'confirmed' && evidence.length ? 'confirmed' : 'imaging-supported',
    confirmationEvidence: evidence,
    acceptedDifferentials: strings(value?.acceptedDifferentials),
  };
}

/** Catch the actual failure even if triage labels it as banter or affirmation.
 * General statements about what histology can establish remain allowed.
 * Even a confirmed case may quote only a recorded result sentence, not improvise one.
 */
export function unsupportedConfirmation(text: string, context?: DiagnosticContext): boolean {
  const claims = text.split(/(?<=[.!?])\s+/).filter(s =>
    /\b(?:came back (?:as|positive|negative)|(?:biopsy|histology|pathology|histopathology|test|results?|report)\b[^.!?]{0,70}\b(?:confirmed|showed|revealed|proved|was positive|was negative)|(?:confirmed|diagnosed|proven|verified)\b[^.!?]{0,50}\b(?:biopsy|histology|pathology)|(?:surgery|operation|procedure)\b[^.!?]{0,50}\b(?:successful|went well)|(?:patient|they|he|she)\b[^.!?]{0,35}\b(?:recovered|was discharged|were discharged))\b/i.test(s)
    );
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return claims.some(s => context?.certainty !== 'confirmed' || !context.confirmationEvidence.some(e => norm(e) === norm(s)));
}

export function rejectsAcceptedDifferential(text: string, comment: string, context?: DiagnosticContext): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const mentioned = context?.acceptedDifferentials.some(d => (` ${norm(comment)} `).includes(` ${norm(d)} `));
  return !!mentioned && /\b(?:wrong|incorrect|close but|right neighborhood but|actually it'?s|but (?:it'?s|this (?:is|one))|not (?:an? )?\w+)\b/i.test(text);
}

export function overstatesImagingLimit(text: string): boolean {
  return /\bimaging(?: alone)? (?:cannot|can't|can not) (?:separate|distinguish|differentiate)\b/i.test(text);
}
