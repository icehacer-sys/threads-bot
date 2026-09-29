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
  const personalWithoutImage = /\b(?:i have|i had|i was|my (?:child|baby|son|daughter|own))\b/i.test(text) && !/\b(?:this|the|your) (?:image|x.?ray|scan|picture)\b/i.test(text);
  if (!personalWithoutImage && /\b(?:is (?:this|it|that)|are these)\s+(?:an?\s+)?(?:ai|fake|real|generated)\b|(?:fake|ai[- ]generated|artificial|recreat).{0,35}(?:image|x.?ray|scan)|(?:image|x.?ray|scan).{0,35}(?:fake|ai[- ]generated|artificial|real patient)|\b(?:image|scan|x.?ray) provenance\b/i.test(text)) return 'provenance';
  // A general anatomy fact or personal story is not a defect in the posted image.
  // Match the allegation within one clause, including a concise/deictic complaint.
  const anatomy = /bone|rib|clavicle|scapula|scapulae|teeth|tooth|finger|anatom|vertebra|jaw|limb/i;
  const defect = /\b(?:duplicat\w*|extra|missing|two (?:left|right)|impossible|wrong (?:number|side)|where (?:are|is)|can(?:not|['\u2019]t) see|garbled|melted)\b/i;
  const currentImage = /\b(?:this|that|the|your|posted|current)\s+(?:image|x.?ray|scan|picture|radiograph)\b/i;
  const deicticObservation = /\b(?:this|that|it)\s+(?:looks?|seems?|appears?|has|shows?|contains?)\b|\b(?:why|how)\s+(?:does|do|is|are)\s+(?:this|that|it)\b/i;
  const observation = /\b(?:why|how)\s+(?:does|do|is|are)\s+the\b|\b(?:is|are)\s+there\b|\bthere\s+(?:is|are)\b|\bwhere\s+(?:are|is)\b|\b(?:i|we)\s+can(?:not|['\u2019]t)\s+see\b/i;
  const genericPeople = /\b(?:children(?:['\u2019]s)?|people|patients)\b/i;
  const genericEducation = /\b(?:can|could|may|sometimes|generally|usually|syndrome|causes?|symptoms?)\b/i;
  const negated = /\b(?:no|not|never|isn['\u2019]t|aren['\u2019]t|(?:doesn['\u2019]t|don['\u2019]t|does not|do not)\s+have)\s+(?:(?:a|an|any|single)\s+){0,2}(?:duplicat\w*|extra|missing|two (?:left|right)|wrong (?:number|side)|impossible|garbled|melted)\b/gi;
  const clauses = text.split(/(?<=[.!?;])\s+|\s+(?:but|however|yet)\s+/i);
  if (clauses.some(clause => {
    const allegation = clause.replace(negated, '');
    if (!anatomy.test(allegation) || !defect.test(allegation)) return false;
    const observed = deicticObservation.test(allegation) || observation.test(allegation);
    if (currentImage.test(allegation)) {
      // Mentioning the image as a reminder/comparison does not allege a defect.
      const explanatory = /\b(?:explains?|illustrates?|shows?|demonstrates?)\s+(?:why|how)\b/i.test(allegation);
      const explicitDefect = /\b(?:image|x.?ray|scan|picture|radiograph)\s+(?:has|contains?|is)\b/i.test(allegation);
      if (explanatory && !explicitDefect && !deicticObservation.test(allegation)) return false;
      const imagePredicate = /\b(?:image|x.?ray|scan|picture|radiograph)\s+(?:has|shows?|contains?|is|looks?|seems?)\b/i.test(allegation);
      return !/\b(?:reminds?\s+(?:me|us)\s+of|(?:i|we)\s+(?:had|have)|my|our)\b/i.test(allegation) || observed || imagePredicate;
    }
    if (genericPeople.test(allegation) && !deicticObservation.test(allegation)) return false;
    if (genericEducation.test(allegation) && !observed) return false;
    const conciseDefect = /^\s*(?:(?:a|an|the)\s+)?(?:duplicat\w*|extra|missing|two (?:left|right)|wrong (?:number|side)(?:\s+of)?|impossible|garbled|melted)\s+(?:(?:left|right)\s+)?(?:bones?|ribs?|clavicles?|scapula(?:e|s)?|teeth|tooth|fingers?|anatomy|vertebra(?:e|s)?|jaws?|limbs?)(?:\s+(?:here|there|(?:in|on)\s+(?:this|that|the|your)\s+(?:image|x.?ray|scan|picture|radiograph)))?[.!?]?\s*$/i.test(allegation);
    const anatomyFirst = /^\s*(?:the\s+)?(?:bones?|ribs?|clavicles?|scapulae?|teeth|tooth|fingers?|anatomy|vertebrae?|jaw|limbs?)\s+(?:is|are|looks?|seems?)\b/i.test(allegation);
    return observed || conciseDefect || anatomyFirst;
  })) return 'anatomy';
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
