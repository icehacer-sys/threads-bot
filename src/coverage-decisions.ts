// Pure lifecycle contract. Hook installation belongs to callers, not this ledger.
// No I/O, timers, configuration, provider calls or reply-policy decisions here.

export const COVERAGE_REASONS = [
  'observed', 'policy_eligible', 'self', 'hidden', 'insufficient_content',
  'policy_excluded', 'legacy_unknown', 'unclassified', 'already_replied',
  'already_skipped', 'image_review_hold', 'reveal_hold', 'owner_review',
  'budget', 'per_post_cap', 'participant_turn_limit', 'incomplete_ancestry',
  'admitted', 'initial', 'repair', 'escalation', 'forced_tool', 'retry',
  'resume', 'accepted', 'validation_rejected', 'provider_error',
  'publication_confirmed', 'publication_failed', 'publication_unknown',
  'durability_unknown', 'terminal_skip',
  'classified_reply', 'classified_skip',
] as const;
export type CoverageReason = typeof COVERAGE_REASONS[number];
export const COVERAGE_CATEGORIES = ['banter', 'affirm', 'correct', 'teach', 'reference', 'empathize', 'personal_medical', 'complaint', 'spam', 'other'] as const;
export type CoverageCategory = typeof COVERAGE_CATEGORIES[number];
export type CoverageIdentity = { platform: 'threads'; postId: string; commentId: string };
type BaseEvent = CoverageIdentity & { eventId: string; pollId: string; at: string; reason: CoverageReason };
export type CoverageEvent = BaseEvent & (
  | { stage: 'discovery' }
  | { stage: 'eligibility'; verdict: 'eligible' | 'excluded' | 'UNKNOWN' }
  | { stage: 'classification'; verdict: 'reply' | 'skip'; category: CoverageCategory }
  | { stage: 'admission'; verdict: 'admitted' | 'deferred' | 'excluded' | 'UNKNOWN' }
  | { stage: 'drafting'; attemptId: string; kind: 'initial' | 'repair' | 'escalation' | 'forced_tool' | 'retry'; verdict: 'started' | 'accepted' | 'rejected' | 'provider_error' | 'UNKNOWN' }
  | { stage: 'validation'; verdict: 'accepted' | 'rejected' | 'UNKNOWN' }
  | { stage: 'publication'; attemptId: string; kind: 'initial' | 'retry' | 'resume'; verdict: 'confirmed' | 'failed' | 'UNKNOWN'; evidence?: { publishedId?: string; confirmedPublished?: true } }
  | { stage: 'durable_outcome'; verdict: 'confirmed' | 'failed' | 'skipped' | 'deferred' | 'UNKNOWN'; publicationEventId?: string }
);
export interface CoverageCohort {
  id: string;
  startedAt: string;
  endedAt: string;
  discovery: 'partial' | 'complete_in_scope' | 'UNKNOWN';
  maxComments: number;
  maxEvents: number;
}
export interface CoverageSnapshot {
  schema: 1;
  cohort: CoverageCohort;
  events: CoverageEvent[];
  truncated: boolean;
  /** Rejected recorder calls, NOT unique missed comments. */
  droppedEvents: number;
}

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Invalid coverage object');
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unexpected coverage field');
}
function id(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(value)) throw new Error('Invalid coverage identifier');
}
function time(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Invalid coverage timestamp');
}
function choice(value: unknown, allowed: readonly string[]): void {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new Error('Invalid coverage enum');
}
function bound(value: unknown, max: number): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > max) throw new Error('Invalid coverage bound');
}
function cohort(value: unknown): CoverageCohort {
  object(value);
  keys(value, ['id', 'startedAt', 'endedAt', 'discovery', 'maxComments', 'maxEvents']);
  id(value.id); time(value.startedAt); time(value.endedAt);
  if (value.startedAt >= value.endedAt) throw new Error('Invalid coverage window');
  choice(value.discovery, ['partial', 'complete_in_scope', 'UNKNOWN']);
  bound(value.maxComments, 10_000); bound(value.maxEvents, 100_000);
  return { id: value.id, startedAt: value.startedAt, endedAt: value.endedAt, discovery: value.discovery as CoverageCohort['discovery'], maxComments: value.maxComments, maxEvents: value.maxEvents };
}
function event(value: unknown): CoverageEvent {
  object(value);
  id(value.eventId); id(value.pollId); id(value.postId); id(value.commentId); time(value.at);
  choice(value.reason, COVERAGE_REASONS);
  if (value.platform !== 'threads') throw new Error('Unsupported coverage platform');
  const fields = ['platform', 'postId', 'commentId', 'eventId', 'pollId', 'at', 'reason', 'stage'];
  switch (value.stage) {
    case 'discovery': break;
    case 'eligibility':
      fields.push('verdict'); choice(value.verdict, ['eligible', 'excluded', 'UNKNOWN']); break;
    case 'classification':
      fields.push('verdict', 'category'); choice(value.verdict, ['reply', 'skip']); choice(value.category, COVERAGE_CATEGORIES); break;
    case 'admission':
      fields.push('verdict'); choice(value.verdict, ['admitted', 'deferred', 'excluded', 'UNKNOWN']); break;
    case 'drafting':
      fields.push('verdict', 'attemptId', 'kind'); id(value.attemptId);
      choice(value.kind, ['initial', 'repair', 'escalation', 'forced_tool', 'retry']);
      choice(value.verdict, ['started', 'accepted', 'rejected', 'provider_error', 'UNKNOWN']); break;
    case 'validation':
      fields.push('verdict'); choice(value.verdict, ['accepted', 'rejected', 'UNKNOWN']); break;
    case 'publication':
      fields.push('verdict', 'attemptId', 'kind', 'evidence'); id(value.attemptId);
      choice(value.kind, ['initial', 'retry', 'resume']); choice(value.verdict, ['confirmed', 'failed', 'UNKNOWN']);
      if (value.evidence !== undefined) {
        object(value.evidence); keys(value.evidence, ['publishedId', 'confirmedPublished']);
        if (value.evidence.publishedId !== undefined) id(value.evidence.publishedId);
        if (value.evidence.confirmedPublished !== undefined && value.evidence.confirmedPublished !== true) throw new Error('Invalid confirmation evidence');
      }
      if (value.verdict === 'confirmed' && (!value.evidence || !(value.evidence as Record<string, unknown>).publishedId && !(value.evidence as Record<string, unknown>).confirmedPublished)) throw new Error('Confirmation requires publisher evidence');
      if (value.verdict !== 'confirmed' && value.evidence !== undefined) throw new Error('Unconfirmed event cannot contain confirmation evidence');
      break;
    case 'durable_outcome':
      fields.push('verdict', 'publicationEventId');
      choice(value.verdict, ['confirmed', 'failed', 'skipped', 'deferred', 'UNKNOWN']);
      if (value.verdict === 'confirmed') id(value.publicationEventId);
      else if (value.publicationEventId !== undefined) throw new Error('Unexpected publication reference');
      break;
    default: throw new Error('Invalid coverage stage');
  }
  keys(value, fields);
  // Explicit projection makes canonical identity independent of incoming key order.
  const result: Record<string, unknown> = {};
  for (const field of fields) if (own(value, field) && value[field] !== undefined) result[field] = value[field];
  if (result.evidence) {
    const evidence = result.evidence as Record<string, unknown>;
    result.evidence = { ...(evidence.publishedId ? { publishedId: evidence.publishedId } : {}), ...(evidence.confirmedPublished ? { confirmedPublished: true } : {}) };
  }
  return result as CoverageEvent;
}

const identity = (value: CoverageIdentity) => JSON.stringify([value.platform, value.postId, value.commentId]);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Bounded, idempotent recorder. Callers own persistence; record() never saves. */
export class CoverageLedger {
  private readonly scope: CoverageCohort;
  private readonly events = new Map<string, CoverageEvent>();
  private readonly comments = new Set<string>();
  private readonly attemptKinds = new Map<string, string>();
  private truncated = false;
  private droppedEvents = 0;

  constructor(scope: CoverageCohort) { this.scope = cohort(scope); }

  record(input: CoverageEvent): 'recorded' | 'duplicate' | 'limit' {
    const next = event(input);
    if (next.at < this.scope.startedAt || next.at >= this.scope.endedAt) throw new Error('Event outside coverage window');
    const previous = this.events.get(next.eventId);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(next)) throw new Error('Conflicting coverage event identity');
      return 'duplicate';
    }
    const key = identity(next);
    if (next.stage !== 'discovery' && !this.comments.has(key)) throw new Error('Coverage decision requires observed discovery');
    const attemptKey = next.stage === 'drafting' || next.stage === 'publication' ? JSON.stringify([key, next.stage, next.attemptId]) : undefined;
    if (attemptKey && (next.stage === 'drafting' || next.stage === 'publication')) {
      const previousKind = this.attemptKinds.get(attemptKey);
      if (previousKind !== undefined && previousKind !== next.kind) throw new Error('Conflicting coverage attempt kind');
    }
    if (next.stage === 'durable_outcome' && next.verdict === 'confirmed') {
      const publication = this.events.get(next.publicationEventId!);
      if (!publication || identity(publication) !== key || publication.stage !== 'publication' || publication.verdict !== 'confirmed' || publication.at > next.at) throw new Error('Durable confirmation requires matching prior publisher evidence');
    }
    if (this.events.size >= this.scope.maxEvents || !this.comments.has(key) && this.comments.size >= this.scope.maxComments) {
      this.truncated = true; this.droppedEvents++;
      return 'limit';
    }
    this.events.set(next.eventId, next);
    if (attemptKey && (next.stage === 'drafting' || next.stage === 'publication')) this.attemptKinds.set(attemptKey, next.kind);
    if (next.stage === 'discovery') this.comments.add(key);
    return 'recorded';
  }

  snapshot(): CoverageSnapshot {
    return clone({ schema: 1, cohort: this.scope, events: [...this.events.values()], truncated: this.truncated, droppedEvents: this.droppedEvents });
  }

  static restore(input: unknown): CoverageLedger {
    object(input); keys(input, ['schema', 'cohort', 'events', 'truncated', 'droppedEvents']);
    if (input.schema !== 1 || !Array.isArray(input.events) || typeof input.truncated !== 'boolean' || !Number.isSafeInteger(input.droppedEvents) || (input.droppedEvents as number) < 0 || input.truncated !== ((input.droppedEvents as number) > 0)) throw new Error('Invalid coverage snapshot');
    const result = new CoverageLedger(cohort(input.cohort));
    if (input.events.length > result.scope.maxEvents) throw new Error('Oversized coverage snapshot');
    for (const raw of input.events) if (result.record(raw as CoverageEvent) !== 'recorded') throw new Error('Invalid coverage event history');
    result.truncated = input.truncated;
    result.droppedEvents = input.droppedEvents as number;
    return result;
  }

  report() {
    const rows = new Map<string, CoverageEvent[]>();
    for (const e of this.events.values()) {
      const key = identity(e);
      const list = rows.get(key) ?? [];
      list.push(e); rows.set(key, list);
    }
    let encounters = 0, eligible = 0, confirmedEligible = 0, excluded = 0, unknownEligibility = 0;
    let deferred = 0, draftRejected = 0, providerErrors = 0, publicationFailed = 0, unknownPublication = 0, unknownDurability = 0;
    const classifications = { completedInvocations: 0, replies: 0, skips: 0, categories: {} as Partial<Record<CoverageCategory, number>> };
    const reasons: Partial<Record<CoverageReason, number>> = {};
    const draftAttempts = new Set<string>(), publicationAttempts = new Set<string>();
    const kinds: Record<string, number> = {};
    const observations: Array<CoverageIdentity & { firstObservedAt: string; lastObservedAt: string; encounters: number; stages: Record<CoverageEvent['stage'], string> }> = [];
    for (const [key, list] of rows) {
      list.sort((a, b) => a.at.localeCompare(b.at));
      const latest = (stage: CoverageEvent['stage']) => list.findLast(e => e.stage === stage);
      const discovered = list.filter(e => e.stage === 'discovery');
      const rowEncounters = new Set(discovered.map(e => e.pollId)).size;
      encounters += rowEncounters;
      const stages = {} as Record<CoverageEvent['stage'], string>;
      for (const stage of ['discovery', 'eligibility', 'classification', 'admission', 'drafting', 'validation', 'publication', 'durable_outcome'] as const) {
        const last = latest(stage);
        stages[stage] = last && 'verdict' in last ? last.verdict : stage === 'discovery' ? 'observed' : 'UNKNOWN';
      }
      observations.push({ platform: 'threads', postId: list[0].postId, commentId: list[0].commentId, firstObservedAt: discovered[0].at, lastObservedAt: discovered[discovered.length - 1].at, encounters: rowEncounters, stages });
      const wasEligible = list.some(e => e.stage === 'eligibility' && e.verdict === 'eligible');
      const eligibility = latest('eligibility');
      if (wasEligible) eligible++;
      else if (eligibility?.stage === 'eligibility' && eligibility.verdict === 'excluded') excluded++;
      else unknownEligibility++;
      const durablyConfirmed = list.some(e => e.stage === 'durable_outcome' && e.verdict === 'confirmed');
      if (wasEligible && durablyConfirmed) confirmedEligible++;
      const admission = latest('admission');
      if (admission?.stage === 'admission' && admission.verdict === 'deferred') deferred++;
      const validation = latest('validation');
      if (validation?.stage === 'validation' && validation.verdict === 'rejected') draftRejected++;
      if (list.some(e => e.stage === 'drafting' && e.verdict === 'provider_error')) providerErrors++;
      const publication = latest('publication');
      if (!durablyConfirmed && publication?.stage === 'publication' && publication.verdict === 'failed') publicationFailed++;
      if (!durablyConfirmed && publication?.stage === 'publication' && publication.verdict === 'UNKNOWN') unknownPublication++;
      const durable = latest('durable_outcome');
      if (!durablyConfirmed && (!durable || durable.stage === 'durable_outcome' && durable.verdict === 'UNKNOWN')) unknownDurability++;
      const rowReasons = new Set(list.map(e => e.reason));
      for (const reason of rowReasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
      for (const e of list) {
        if (e.stage === 'classification') {
          classifications.completedInvocations++;
          if (e.verdict === 'reply') classifications.replies++; else classifications.skips++;
          classifications.categories[e.category] = (classifications.categories[e.category] ?? 0) + 1;
        }
        if (e.stage !== 'drafting' && e.stage !== 'publication') continue;
        const attemptKey = JSON.stringify([key, e.attemptId]);
        const attempts = e.stage === 'drafting' ? draftAttempts : publicationAttempts;
        if (!attempts.has(attemptKey)) {
          attempts.add(attemptKey);
          const kind = `${e.stage}:${e.kind}`;
          kinds[kind] = (kinds[kind] ?? 0) + 1;
        }
      }
    }
    return {
      cohort: clone(this.scope), observations, uniqueObserved: rows.size, encounters,
      repeatedEncounters: encounters - rows.size,
      denominator: { uniqueObservedEverEligible: eligible, unknownEligibility, intentionalExclusions: excluded },
      numerator: { uniqueEligibleWithRecordedDurableConfirmation: confirmedEligible },
      outcomes: { deferred, draftRejected, providerErrors, publicationFailed, unknownPublication, unknownDurability },
      attempts: { drafting: draftAttempts.size, publication: publicationAttempts.size, kinds },
      classifications,
      /** Each reason counts unique comments; these overlapping buckets do not sum to the denominator. */
      reasons,
      measurement: { liveHooksInstalled: 'UNKNOWN' as const, publicationDurability: 'unverified_caller_evidence', truncated: this.truncated, droppedRecorderCalls: this.droppedEvents, accountCoveragePercent: null },
    };
  }
}
