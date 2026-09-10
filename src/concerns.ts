import type { Decision } from './reply';

export const ACKNOWLEDGMENTS = {
  personal: "Personal medical advice needs an assessment by a clinician who knows your history.",
  scan: "This account doesn't review personal scans. The clinician handling your care can interpret it with your history.",
  image: "Thanks for flagging that detail.",
  urgent: "If someone is in immediate danger contact local emergency services now. This account cannot assess emergencies.",
} as const;
export type ConcernKind = keyof typeof ACKNOWLEDGMENTS;
export function isRetiredMedicalBoundary(text: string): boolean {
  return /that sounds worrying|a comment (?:can['’]?t|cannot) establish (?:what['’]?s|what is) causing it|a clinician can assess your symptoms/i.test(text);
}
export function requestsPersonalAdvice(text: string): boolean {
  // A medical anecdote, hospital visit or quoted advice is not a current request.
  const request = /\b(?:should|could|can|would|do)\s+(?:i|we|my\s+(?:child|baby|son|daughter|partner))\b|\bwhat\s+(?:medicine|medication|treatment|test)\s+should\b|\bwhat should (?:i|we) do\b|\b(?:please|can you|could you)\s+(?:help|advise|diagnose|tell)\b|\b(?:i|we)\s+(?:need|want)\s+(?:medical\s+)?advice\b/i;
  const personal = /\b(?:i|me|my|we|our|us)\b/i;
  return text.split(/(?<=[.!?])\s+/).some(sentence => {
    if (/\b(?:asked|was told|were told|was advised|were advised|doctor said|doctor told)\b/i.test(sentence) && !/\b(?:now|today|still)\b/i.test(sentence)) return false;
    return personal.test(sentence) && request.test(sentence);
  });
}
export function acknowledgmentKind(text: string): ConcernKind | undefined {
  return (Object.keys(ACKNOWLEDGMENTS) as ConcernKind[]).find(k => ACKNOWLEDGMENTS[k] === text);
}
export function imageConcernKind(text: string): 'anatomy' | 'provenance' | undefined {
  if (/\b(?:i have|i had|i was|my (?:child|baby|son|daughter|own))\b/i.test(text) && !/\b(?:this|the|your) (?:image|x.?ray|scan|picture)\b/i.test(text)) return undefined;
  if (/\b(?:is (?:this|it|that)|are these)\s+(?:an?\s+)?(?:ai|fake|real|generated)\b|(?:fake|ai[- ]generated|artificial|recreat).{0,35}(?:image|x.?ray|scan)|(?:image|x.?ray|scan).{0,35}(?:fake|ai[- ]generated|artificial|real patient)|\b(?:image|scan|x.?ray) provenance\b/i.test(text)) return 'provenance';
  const anatomy = /bone|rib|clavicle|scapula|scapulae|teeth|tooth|finger|anatom|vertebra|jaw|limb/i.test(text);
  if (anatomy && /duplicat|extra|missing|two (?:left|right)|impossible|wrong (?:number|side)|where (?:are|is)|can(?:not|'t) see|garbled|melted/i.test(text)) return 'anatomy';
}
export function concernAcknowledgment(kind: ConcernKind, priorReply?: string): Decision {
  const repeated = !!priorReply && (acknowledgmentKind(priorReply) !== undefined || isRetiredMedicalBoundary(priorReply));
  return { decision: repeated ? 'skip' : 'reply', category: kind === 'image' ? 'complaint' : 'personal_medical',
    reply_text: repeated ? '' : ACKNOWLEDGMENTS[kind], reason: `owner review: ${kind === 'image' ? 'image/anatomy inconsistency' : 'personal medical concern'}${repeated ? '; acknowledgment already given' : ''}` };
}
export function directConcern(text: string, priorReply?: string): Decision | undefined {
  const kind = imageConcernKind(text);
  if (kind === 'provenance') return { decision: 'skip', category: 'complaint', reply_text: '', reason: 'owner response: image provenance question' };
  if (kind === 'anatomy') {
    if (/\b(?:idiot|fraud|stupid|shut up|fuck)\b/i.test(text)) return { decision: 'skip', category: 'complaint', reply_text: '', reason: 'owner review: image/anatomy concern with hostility; no automatic acknowledgment' };
    return concernAcknowledgment('image', priorReply);
  }
  if (/\b(?:i|my (?:child|baby|son|daughter|partner)) (?:can(?:not|'t) breathe|(?:am|is) (?:choking|unconscious))\b/i.test(text)) return concernAcknowledgment('urgent', priorReply);
  if (/\b(?:send|dm|share|upload|review|look at|interpret)\b.{0,45}\b(?:my|our|my child's)\b.{0,20}\b(?:scan|x.?ray|mri|ct|report|results?)\b/i.test(text)) return concernAcknowledgment('scan', priorReply);
}
export function holdForImageReview(d: Decision, held: boolean): Decision {
  if (!held || acknowledgmentKind(d.reply_text) || !['affirm','correct','teach','reference'].includes(d.category)) return d;
  return { decision: 'skip', category: d.category, reply_text: '', reason: 'owner review: image-dependent reply paused until the case concern is resolved' };
}
