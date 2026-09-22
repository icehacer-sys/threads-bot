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

/** Congenital onset does not establish age at presentation or a recorded functional outcome. */
export function unsupportedPatientHistory(text: string, caption: string): boolean {
  const neonatal = /\b(?:newborn|neonat\w*|infant|baby)\b/i;
  if (!neonatal.test(caption) && (neonatal.test(text) || /\b(?:at this age|caught at birth|catching it at birth|detected at birth|diagnosed at birth)\b/i.test(text))) return true;
  return /\b(?:they|he|she|the patient) (?:couldn't|could not|can't|cannot|was unable to|were unable to) walk\b|\bwalking wasn't on the table\b/i.test(text) && !/\b(?:couldn't|could not|can't|cannot|unable to) walk\b/i.test(caption);
}

// Time spans, sizes and dates the reply states as fact. Added after the 2026-09-15 Guinea worm
// night: with no life-cycle facts supplied, the bot improvised "worked its way out through the
// skin over weeks" about fifteen times (a CALCIFIED worm died before it could emerge), plus
// "centuries of eradication work" and "metres" of worm. Every one carried a unit like these.
const SPECIFIC_UNIT = /\b(?:\d+(?:\.\d+)?\s*)?(days?|weeks?|months?|years?|decades?|centur(?:y|ies)|met(?:re|er)s?|feet|foot|inch(?:es)?|cm|mm|centimet(?:re|er)s?|millimet(?:re|er)s?|(?:1[89]|20)\d\d)\b/gi;
const unitRoot = (u: string) => u.toLowerCase().replace(/^centur.*/, 'centur').replace(/^met(?:re|er)s?$/, 'metre').replace(/^(?:feet|foot)$/, 'foot').replace(/^inch(?:es)?$/, 'inch').replace(/^(centi|milli)met(?:re|er)s?$/, '$1metre').replace(/s$/, '');
// Common numeric abbreviations in personal stories are evidence, not invented units.
const expandTimeUnits = (text: string) => text.replace(/(\d)\s*(yrs?|wks?|mos?)\b/gi, (_match, number: string, unit: string) => `${number} ${/^yr/i.test(unit) ? 'years' : /^wk/i.test(unit) ? 'weeks' : 'months'}`);
const units = (text: string) => {
  const expanded = expandTimeUnits(text);
  return [...expanded.matchAll(SPECIFIC_UNIT)].filter(m =>
    !/^(?:foot|feet)$/i.test(m[1]) || /\d/.test(m[0]) || /\b(?:one|two|three|four|five|six|several)\s*$/i.test(expanded.slice(0, m.index)) || /^[- ](?:long|wide|tall)\b/i.test(expanded.slice(m.index! + m[0].length))
  ).map(m => unitRoot(m[1]));
};

/** A timeline, size or date that neither the supplied facts nor the conversation mention. */
export function unsupportedSpecifics(text: string, support: string): string[] {
  const supported = new Set(units(support));
  return [...new Set(units(text))].filter(u => !supported.has(u));
}
