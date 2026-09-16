// GENERATED FILE — do not edit.
//
// Copied verbatim from provider-portal's shared/partner-api by
// scripts/sync-contract.mjs. Edit the source there; this copy exists only so
// the published package is self-contained.
/**
 * # Physician availability — the schedule engine
 *
 * How a physician's published availability is STORED, how it is READ into a
 * calendar, and how a calendar EDIT maps back onto storage. One pure module,
 * shared verbatim by the platform (slot generation, the portal resolvers, the
 * REST routes), the provider portal's calendar, the `@natzar/client` package
 * and every partner surface built on it — so a partner's calendar and the
 * booking engine agree to the minute, with no reimplementation.
 *
 * ## The model
 *
 * Availability is stored as INTENT, never as slots or as a materialized
 * calendar:
 *
 * - {@link ScheduleRule} — a recurring window: "Tuesdays 09:00–12:00", every
 *   week or every N weeks, optionally only between two dates. Times are
 *   minutes from local midnight in an IANA zone, never instants — that is what
 *   makes a rule survive daylight saving instead of sliding by an hour twice a
 *   year.
 * - {@link ScheduleException} — a dated change to the pattern, on one day or
 *   across a range of days: `block` (time off) or `open` (extra hours),
 *   optionally restricted to a time window. Blocks ALWAYS beat opens.
 *
 * Because nothing is materialized, changing the consultation length, adding a
 * rule or taking a month off reshapes every future day at once, and a year of
 * availability is a handful of rows however far ahead it reaches.
 *
 * ## Reading it
 *
 * {@link intervalsForDay} turns rules + exceptions into the intervals a
 * physician is available for on ONE local date; {@link resolveDays} does it
 * for a range. The order is fixed and is the only one a physician can reason
 * about without reading code: weekly rules first, dated `open` exceptions
 * added on top, dated `block` exceptions subtracted from the union.
 *
 * ## Editing it
 *
 * A calendar edit is expressed against a DATE, not against a row ("remove
 * 14:00–16:00 on the 14th"), and the operations here translate that into the
 * smallest storage change that produces it: {@link openWindow},
 * {@link closeWindow}, {@link blockDates}. {@link diffSchedule} then turns
 * the edited document into the upserts and deletes the write routes take.
 *
 * Everything in this module is PURE: no clock, no zone conversion, no I/O.
 * Local dates are `YYYY-MM-DD` strings compared lexically.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Minutes in a day — the unit availability windows are expressed in. */
export const MINUTES_PER_DAY = 24 * 60;

/**
 * The longest a single exception may span (`date` → `endDate`, inclusive). A
 * year covers any leave; the bound is what lets the platform read exceptions
 * for a window without scanning the whole table (a spanning exception starts
 * at most this many days before the window).
 */
export const MAX_EXCEPTION_SPAN_DAYS = 366;

/** "Every N weeks" — the largest N a rule may repeat at. */
export const MAX_RULE_INTERVAL_WEEKS = 12;

/**
 * The widest date range one schedule read returns exceptions and resolved
 * days for. Page by range (`to` + 1 day → next `from`) to go further; rules
 * are always returned whole.
 */
export const MAX_SCHEDULE_RANGE_DAYS = 400;

/** How many rules one physician may hold — a rota is a few dozen, never hundreds. */
export const MAX_RULES_PER_PHYSICIAN = 200;

/** How many exceptions one write may carry. */
export const MAX_EXCEPTIONS_PER_WRITE = 400;

/** Longest `reason` a physician may attach to an exception. Never shown to patients. */
export const MAX_EXCEPTION_REASON_LENGTH = 200;

/**
 * Gap tolerance of {@link coverageHorizon}: a normal Mon–Fri week has 2-day
 * holes, and they must not read as "the rota stops here".
 */
export const DEFAULT_COVERAGE_GAP_DAYS = 2;

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

/** A tenant specialty slug, or null for "whatever the physician covers". */
export type ScheduleSpecialty = string | null;

/**
 * One recurring availability window.
 *
 * `weekday` is 0 = Sunday … 6 = Saturday (JS `getDay()`), read in the
 * physician's calendar zone. `startMinute`/`endMinute` are minutes from local
 * midnight; a window that would cross midnight is entered as two rules.
 */
export interface ScheduleRule {
  /** Server id. Absent on a rule that has not been stored yet. */
  id?: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
  /**
   * Legacy. Every rule of a physician is read in ONE zone — the physician's
   * calendar zone (`schedulingTimezone`, else the clinic's), set with
   * `timezone` on the schedule itself — so leave this absent. A value equal
   * to that zone is accepted and stored as null; any other value is refused
   * (`rule_zone_mismatch`).
   */
  timezone?: string | null;
  /**
   * Inclusive local-date validity range. Absent = open-ended. Ending a
   * pattern with `effectiveUntil` rather than deleting it keeps the rule the
   * past appointments were booked against.
   */
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  /**
   * Repeat every N weeks (default 1 = every week). For N > 1 the rule needs
   * `effectiveFrom`: the first occurrence is the first `weekday` on or after
   * it, and the pattern repeats every N × 7 days from there — a fortnightly
   * Tuesday clinic is `{weekday: 2, intervalWeeks: 2, effectiveFrom: <its
   * first date>}`.
   */
  intervalWeeks?: number | null;
  /** Restrict this window to ONE specialty slug (a dedicated clinic). */
  specialty?: ScheduleSpecialty;
  /** Soft off-switch: an inactive rule publishes nothing but is kept. */
  active?: boolean | null;
}

/**
 * A dated change to the weekly pattern — time off, or extra hours.
 *
 * `date` is a local calendar date; `endDate` (inclusive) makes it a range —
 * "away 2026-12-20 → 2027-01-04" is ONE exception. Both minute fields absent
 * = the whole of each day; present = that window on each day of the range.
 */
export interface ScheduleException {
  /** Server id. Absent on an exception that has not been stored yet. */
  id?: string;
  /** First (or only) local date, YYYY-MM-DD. */
  date: string;
  /** Last local date, inclusive. Absent = `date` alone. */
  endDate?: string | null;
  /** `block` removes time (wins over everything); `open` adds it. */
  kind: 'block' | 'open';
  /** Minutes from local midnight. BOTH or NEITHER. */
  startMinute?: number | null;
  endMinute?: number | null;
  /**
   * For an `open` exception: restrict the extra hours to one specialty slug,
   * as a rule's `specialty` does. Ignored on a `block` — time off is time
   * off, whichever clinic the window belonged to.
   */
  specialty?: ScheduleSpecialty;
  /** Shown to the physician only — never to patients. */
  reason?: string | null;
}

/** The whole of one physician's stored availability. */
export interface ScheduleDocument {
  rules: ScheduleRule[];
  exceptions: ScheduleException[];
}

/**
 * A stretch of one local day a physician is available for, in minutes from
 * local midnight. `specialty` narrows the stretch to a single specialty slug
 * (a dedicated clinic); null means it serves whatever the physician covers.
 */
export interface LocalInterval {
  start: number;
  end: number;
  specialty: ScheduleSpecialty;
}

/** One resolved calendar day. */
export interface ResolvedDay {
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** Available intervals, sorted, non-overlapping within a specialty. */
  intervals: LocalInterval[];
}

/**
 * What a write route takes: rows with an `id` are updated, rows without are
 * created, and the two id lists are deleted. Produced by {@link diffSchedule}.
 */
export interface ScheduleChangeSet {
  rules: ScheduleRule[];
  exceptions: ScheduleException[];
  deletedRuleIds: string[];
  deletedExceptionIds: string[];
}

// ---------------------------------------------------------------------------
// Local-date arithmetic (proleptic Gregorian, zone-free)
// ---------------------------------------------------------------------------

/** Parse "YYYY-MM-DD" into its numeric parts; null when malformed. */
export function parseLocalDate(date: string): {year: number; month: number; day: number} | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Reject 2026-02-31 and friends: the Date round trip normalizes them away.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return {year, month, day};
}

/** Is this a well-formed, real local date? */
export function isLocalDate(value: unknown): value is string {
  return typeof value === 'string' && parseLocalDate(value) !== null;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Days since 1970-01-01 for a local date (null-safe: 0 when malformed). */
export function dayNumber(date: string): number {
  const p = parseLocalDate(date);
  if (!p) return 0;
  return Math.round(Date.UTC(p.year, p.month - 1, p.day) / 86_400_000);
}

/** "YYYY-MM-DD" `days` after `date`. */
export function addLocalDays(date: string, days: number): string {
  const parsed = parseLocalDate(date);
  if (!parsed) return date;
  const d = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Signed number of days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** 0 = Sunday … 6 = Saturday for a local "YYYY-MM-DD". */
export function weekdayOfLocalDate(date: string): number {
  const parsed = parseLocalDate(date);
  if (!parsed) return 0;
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
}

/** Inclusive list of local dates from `from` to `to`, capped at `maxDays`. */
export function localDateRange(from: string, to: string, maxDays: number): string[] {
  const out: string[] = [];
  let cursor = from;
  for (let i = 0; i < maxDays; i++) {
    if (cursor > to) break;
    out.push(cursor);
    cursor = addLocalDays(cursor, 1);
  }
  return out;
}

/** The first date on or after `date` that falls on `weekday`. */
export function firstWeekdayOnOrAfter(date: string, weekday: number): string {
  const current = weekdayOfLocalDate(date);
  const delta = (weekday - current + 7) % 7;
  return addLocalDays(date, delta);
}

// ---------------------------------------------------------------------------
// Resolution: rules + exceptions → intervals
// ---------------------------------------------------------------------------

/** A well-formed, non-empty window inside a single day. */
export function isSaneWindow(start: number, end: number): boolean {
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= MINUTES_PER_DAY && end > start;
}

/**
 * Does this rule publish anything on `date`? Weekday, validity range, the
 * active flag and — for an every-N-weeks rule — the week parity, counted from
 * the first `weekday` on or after `effectiveFrom`.
 *
 * An every-N-weeks rule WITHOUT `effectiveFrom` has nothing to count from and
 * publishes nothing: the write routes refuse to store one, and guessing an
 * anchor here would put a fortnightly clinic on the wrong fortnight.
 */
export function ruleAppliesOn(rule: ScheduleRule, date: string): boolean {
  if (rule.active === false) return false;
  if (rule.effectiveFrom && date < rule.effectiveFrom) return false;
  if (rule.effectiveUntil && date > rule.effectiveUntil) return false;
  if (rule.weekday !== weekdayOfLocalDate(date)) return false;
  const interval = rule.intervalWeeks ?? 1;
  if (interval > 1) {
    if (!rule.effectiveFrom) return false;
    const first = firstWeekdayOnOrAfter(rule.effectiveFrom, rule.weekday);
    const days = daysBetween(first, date);
    if (days < 0 || days % (7 * interval) !== 0) return false;
  }
  return true;
}

/** The last local date an exception covers. */
export function exceptionEndDate(exception: Pick<ScheduleException, 'date' | 'endDate'>): string {
  return exception.endDate && exception.endDate > exception.date ? exception.endDate : exception.date;
}

/** Does this exception apply on `date`? */
export function exceptionCoversDate(exception: Pick<ScheduleException, 'date' | 'endDate'>, date: string): boolean {
  return exception.date <= date && date <= exceptionEndDate(exception);
}

/** Whole-day exception (no time window)? */
export function isWholeDay(exception: Pick<ScheduleException, 'startMinute' | 'endMinute'>): boolean {
  return exception.startMinute === null || exception.startMinute === undefined || exception.endMinute === null || exception.endMinute === undefined;
}

/**
 * Merge overlapping/adjacent intervals that carry the SAME specialty.
 *
 * Same-specialty only, because two windows with different specialties are
 * genuinely different offers — merging "09:00–12:00 dermatology" with
 * "11:00–14:00 general" would either invent dermatology slots at 13:00 or lose
 * them at 09:00. Different-specialty overlaps are left alone and resolved at
 * slot generation, where the requested specialty picks which ones count.
 */
export function mergeIntervals(intervals: readonly LocalInterval[]): LocalInterval[] {
  const bySpecialty = new Map<string, LocalInterval[]>();
  for (const interval of intervals) {
    const key = interval.specialty ?? '';
    const bucket = bySpecialty.get(key);
    if (bucket) bucket.push(interval);
    else bySpecialty.set(key, [interval]);
  }
  const out: LocalInterval[] = [];
  for (const bucket of bySpecialty.values()) {
    bucket.sort((a, b) => a.start - b.start || a.end - b.end);
    let current: LocalInterval | null = null;
    for (const interval of bucket) {
      if (current && interval.start <= current.end) {
        current.end = Math.max(current.end, interval.end);
        continue;
      }
      if (current) out.push(current);
      current = {...interval};
    }
    if (current) out.push(current);
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * Remove `blocks` from `intervals`. A block splits an interval it lands in the
 * middle of, which is exactly what "I'm out 11:00–11:30" should do to a
 * 09:00–13:00 morning. Blocks apply to EVERY specialty.
 */
export function subtractBlocks(
  intervals: readonly LocalInterval[],
  blocks: ReadonlyArray<{start: number; end: number}>,
): LocalInterval[] {
  if (blocks.length === 0) return [...intervals];
  let current: LocalInterval[] = [...intervals];
  for (const block of blocks) {
    const next: LocalInterval[] = [];
    for (const interval of current) {
      if (block.end <= interval.start || block.start >= interval.end) {
        next.push(interval);
        continue;
      }
      if (block.start > interval.start) {
        next.push({start: interval.start, end: Math.min(block.start, interval.end), specialty: interval.specialty});
      }
      if (block.end < interval.end) {
        next.push({start: Math.max(block.end, interval.start), end: interval.end, specialty: interval.specialty});
      }
    }
    current = next.filter((i) => i.end > i.start);
  }
  return current;
}

/**
 * The intervals ONE physician is available for on ONE local date.
 *
 * Weekly rules first, then dated `open` exceptions added on top, then dated
 * `block` exceptions subtracted from the union — blocks therefore always win.
 * A whole-day block clears the day outright; a whole-day open offers the full
 * 24 hours (the clinic's lead time and horizon still apply).
 */
export function intervalsForDay(args: {
  date: string;
  rules: readonly ScheduleRule[];
  exceptions: readonly ScheduleException[];
}): LocalInterval[] {
  const {date, rules, exceptions} = args;

  const base: LocalInterval[] = [];
  for (const rule of rules) {
    if (!ruleAppliesOn(rule, date)) continue;
    if (!isSaneWindow(rule.startMinute, rule.endMinute)) continue;
    base.push({start: rule.startMinute, end: rule.endMinute, specialty: rule.specialty ?? null});
  }

  const dayExceptions = exceptions.filter((e) => exceptionCoversDate(e, date));
  for (const exception of dayExceptions) {
    if (exception.kind !== 'open') continue;
    const start = exception.startMinute ?? 0;
    const end = exception.endMinute ?? MINUTES_PER_DAY;
    if (!isSaneWindow(start, end)) continue;
    base.push({start, end, specialty: exception.specialty ?? null});
  }

  const merged = mergeIntervals(base);

  const blocks = dayExceptions
    .filter((e) => e.kind === 'block')
    .map((e) => ({start: e.startMinute ?? 0, end: e.endMinute ?? MINUTES_PER_DAY}))
    .filter((b) => isSaneWindow(b.start, b.end));

  return subtractBlocks(merged, blocks);
}

/**
 * Resolve every date from `from` to `to` (inclusive, at most `maxDays`). The
 * calendar view of a schedule document.
 */
export function resolveDays(
  document: {rules: readonly ScheduleRule[]; exceptions: readonly ScheduleException[]},
  from: string,
  to: string,
  maxDays: number = MAX_SCHEDULE_RANGE_DAYS,
): ResolvedDay[] {
  return localDateRange(from, to, maxDays).map((date) => ({
    date,
    intervals: intervalsForDay({date, rules: document.rules, exceptions: document.exceptions}),
  }));
}

/**
 * Everything the stored document says about ONE date, for a calendar's day
 * view: which rules publish it, the extra hours and time off dated on it, and
 * the resolved result. A click on the calendar needs the SOURCES (to offer
 * "remove for this day" vs "edit the weekly pattern"), not just the outcome.
 */
export interface DayBreakdown {
  date: string;
  /** Rules that publish this date (before exceptions are applied). */
  rules: ScheduleRule[];
  /** `open` exceptions covering this date. */
  opens: ScheduleException[];
  /** `block` exceptions covering this date. */
  blocks: ScheduleException[];
  /** The resolved availability — what patients can book against. */
  intervals: LocalInterval[];
  /** A whole-day block covers this date. */
  dayOff: boolean;
}

/** See {@link DayBreakdown}. */
export function describeDay(
  document: {rules: readonly ScheduleRule[]; exceptions: readonly ScheduleException[]},
  date: string,
): DayBreakdown {
  const rules = document.rules.filter((r) => ruleAppliesOn(r, date) && isSaneWindow(r.startMinute, r.endMinute));
  const covering = document.exceptions.filter((e) => exceptionCoversDate(e, date));
  const opens = covering.filter((e) => e.kind === 'open');
  const blocks = covering.filter((e) => e.kind === 'block');
  return {
    date,
    rules,
    opens,
    blocks,
    intervals: intervalsForDay({date, rules: document.rules, exceptions: document.exceptions}),
    dayOff: blocks.some((b) => isWholeDay(b)),
  };
}

/** Total published minutes per local date — what a coverage meter reads. */
export function publishedMinutesByDate(args: {
  dates: readonly string[];
  rules: readonly ScheduleRule[];
  exceptions: readonly ScheduleException[];
}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const date of args.dates) {
    const intervals = intervalsForDay({date, rules: args.rules, exceptions: args.exceptions});
    out[date] = intervals.reduce((sum, i) => sum + (i.end - i.start), 0);
  }
  return out;
}

/**
 * The LAST date, walking forward through `dates`, that a physician has
 * PLANNED without a gap longer than `maxGapDays`.
 *
 * "Without a gap" is the point: a rota with Mondays booked out for a year but
 * nothing else is not a covered schedule, and reporting the far Monday would
 * tell a physician they were done when they had published one day a week.
 *
 * A day is planned when it publishes hours OR carries time off: a deliberate
 * day off is a decision about that date, not a hole in the rota, and a
 * Mon–Fri physician taking a Monday off must not read as "your schedule stops
 * on Friday". Days with neither are the gaps that count.
 */
export function coverageHorizon(args: {
  dates: readonly string[];
  rules: readonly ScheduleRule[];
  exceptions: readonly ScheduleException[];
  maxGapDays?: number;
}): string | null {
  const maxGap = args.maxGapDays ?? DEFAULT_COVERAGE_GAP_DAYS;
  const minutes = publishedMinutesByDate(args);
  const blocks = args.exceptions.filter((e) => e.kind === 'block');
  let last: string | null = null;
  let gap = 0;
  for (const date of args.dates) {
    if ((minutes[date] ?? 0) > 0 || blocks.some((b) => exceptionCoversDate(b, date))) {
      last = date;
      gap = 0;
      continue;
    }
    gap += 1;
    if (gap > maxGap) break;
  }
  return last;
}

// ---------------------------------------------------------------------------
// Validation: what the write routes accept
// ---------------------------------------------------------------------------

/** Why a rule or exception was refused. Stable, machine-readable. */
export type ScheduleValidationProblem =
  | 'invalid_weekday'
  | 'invalid_window'
  | 'invalid_date'
  | 'invalid_range'
  | 'range_too_long'
  | 'invalid_interval'
  | 'interval_needs_anchor'
  | 'invalid_specialty'
  | 'invalid_kind'
  | 'half_window'
  | 'invalid_timezone'
  | 'rule_zone_mismatch';

export type ScheduleValidation<T> = {ok: true; value: T} | {ok: false; problem: ScheduleValidationProblem};

/** Human wording for each problem, for surfaces without their own copy. */
export const SCHEDULE_PROBLEM_MESSAGES: Record<ScheduleValidationProblem, string> = {
  invalid_weekday: 'weekday must be an integer 0 (Sunday) to 6 (Saturday)',
  invalid_window: 'endMinute must be after startMinute, both within 0–1440',
  invalid_date: 'date must be a real calendar date, YYYY-MM-DD',
  invalid_range: 'endDate must be on or after date',
  range_too_long: `an exception may span at most ${MAX_EXCEPTION_SPAN_DAYS} days`,
  invalid_interval: `intervalWeeks must be an integer 1 to ${MAX_RULE_INTERVAL_WEEKS}`,
  interval_needs_anchor: 'a rule repeating every N > 1 weeks needs effectiveFrom (its first date)',
  invalid_specialty: 'specialty must be a lowercase slug',
  invalid_kind: "kind must be 'block' or 'open'",
  half_window: 'startMinute and endMinute must be given together, or neither',
  invalid_timezone: 'timezone is not a known IANA zone',
  rule_zone_mismatch: "rules are read in the physician's calendar zone; set the zone with `timezone` on the schedule, not on the rule",
};

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** Lowercase, hyphenate, strip — a display name or a near-slug into a slug. */
export function normalizeSpecialtySlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function optionalSpecialty(raw: unknown): ScheduleValidation<ScheduleSpecialty> {
  if (raw === null || raw === undefined || raw === '') return {ok: true, value: null};
  if (typeof raw !== 'string') return {ok: false, problem: 'invalid_specialty'};
  const slug = normalizeSpecialtySlug(raw);
  if (!slug || !SLUG.test(slug)) return {ok: false, problem: 'invalid_specialty'};
  return {ok: true, value: slug};
}

function optionalDate(raw: unknown): ScheduleValidation<string | null> {
  if (raw === null || raw === undefined || raw === '') return {ok: true, value: null};
  if (!isLocalDate(raw)) return {ok: false, problem: 'invalid_date'};
  return {ok: true, value: raw};
}

/**
 * Validate and canonicalize one rule as a client sends it. Numbers are
 * rounded to whole minutes; empty strings read as absent; `id` is kept only
 * when it is a non-empty string. `isValidTimeZone` is injected because the
 * check needs `Intl`, which the caller may want to stub or skip.
 */
export function normalizeScheduleRule(
  raw: Record<string, unknown>,
  options: {isValidTimeZone?: (zone: string) => boolean} = {},
): ScheduleValidation<ScheduleRule> {
  const weekday = Number(raw.weekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return {ok: false, problem: 'invalid_weekday'};

  const startMinute = Math.round(Number(raw.startMinute));
  const endMinute = Math.round(Number(raw.endMinute));
  if (!isSaneWindow(startMinute, endMinute)) return {ok: false, problem: 'invalid_window'};

  let timezone: string | null = null;
  if (typeof raw.timezone === 'string' && raw.timezone.trim()) {
    timezone = raw.timezone.trim();
    if (options.isValidTimeZone && !options.isValidTimeZone(timezone)) return {ok: false, problem: 'invalid_timezone'};
  }

  const effectiveFrom = optionalDate(raw.effectiveFrom);
  if (!effectiveFrom.ok) return effectiveFrom;
  const effectiveUntil = optionalDate(raw.effectiveUntil);
  if (!effectiveUntil.ok) return effectiveUntil;
  if (effectiveFrom.value && effectiveUntil.value && effectiveUntil.value < effectiveFrom.value) {
    return {ok: false, problem: 'invalid_range'};
  }

  let intervalWeeks = 1;
  if (raw.intervalWeeks !== null && raw.intervalWeeks !== undefined && raw.intervalWeeks !== '') {
    intervalWeeks = Number(raw.intervalWeeks);
    if (!Number.isInteger(intervalWeeks) || intervalWeeks < 1 || intervalWeeks > MAX_RULE_INTERVAL_WEEKS) {
      return {ok: false, problem: 'invalid_interval'};
    }
  }
  if (intervalWeeks > 1 && !effectiveFrom.value) return {ok: false, problem: 'interval_needs_anchor'};

  const specialty = optionalSpecialty(raw.specialty);
  if (!specialty.ok) return specialty;

  return {
    ok: true,
    value: {
      ...(typeof raw.id === 'string' && raw.id ? {id: raw.id} : {}),
      weekday,
      startMinute,
      endMinute,
      timezone,
      effectiveFrom: effectiveFrom.value,
      effectiveUntil: effectiveUntil.value,
      intervalWeeks,
      specialty: specialty.value,
      active: raw.active !== false,
    },
  };
}

/** Validate and canonicalize one exception as a client sends it. */
export function normalizeScheduleException(raw: Record<string, unknown>): ScheduleValidation<ScheduleException> {
  const date = typeof raw.date === 'string' ? raw.date.trim() : '';
  if (!isLocalDate(date)) return {ok: false, problem: 'invalid_date'};

  const endDate = optionalDate(raw.endDate);
  if (!endDate.ok) return endDate;
  if (endDate.value && endDate.value < date) return {ok: false, problem: 'invalid_range'};
  if (endDate.value && daysBetween(date, endDate.value) + 1 > MAX_EXCEPTION_SPAN_DAYS) {
    return {ok: false, problem: 'range_too_long'};
  }

  if (raw.kind !== 'block' && raw.kind !== 'open') return {ok: false, problem: 'invalid_kind'};
  const kind = raw.kind;

  const hasStart = raw.startMinute !== null && raw.startMinute !== undefined && raw.startMinute !== '';
  const hasEnd = raw.endMinute !== null && raw.endMinute !== undefined && raw.endMinute !== '';
  if (hasStart !== hasEnd) return {ok: false, problem: 'half_window'};
  let startMinute: number | null = null;
  let endMinute: number | null = null;
  if (hasStart) {
    startMinute = Math.round(Number(raw.startMinute));
    endMinute = Math.round(Number(raw.endMinute));
    if (!isSaneWindow(startMinute, endMinute)) return {ok: false, problem: 'invalid_window'};
  }

  const specialty = kind === 'open' ? optionalSpecialty(raw.specialty) : ({ok: true, value: null} as const);
  if (!specialty.ok) return specialty;

  const reason = typeof raw.reason === 'string' && raw.reason.trim() ? raw.reason.trim().slice(0, MAX_EXCEPTION_REASON_LENGTH) : null;

  return {
    ok: true,
    value: {
      ...(typeof raw.id === 'string' && raw.id ? {id: raw.id} : {}),
      date,
      endDate: endDate.value && endDate.value > date ? endDate.value : null,
      kind,
      startMinute,
      endMinute,
      specialty: specialty.value,
      reason,
    },
  };
}

// ---------------------------------------------------------------------------
// Editing: a calendar gesture → the smallest storage change
// ---------------------------------------------------------------------------

/** Two windows on the same day overlap (half-open)? */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** The same row as a NEW one — everything but the server id. */
function withoutId<T extends {id?: string}>(row: T): Omit<T, 'id'> {
  // Rest-destructured rather than deleted: `delete` on a typed property is a
  // type error, and a spread copy is what a "new row" is anyway.
  const {id, ...rest} = row;
  void id;
  return rest;
}

/**
 * Cut `date` out of a multi-day exception: the parts before and after it, as
 * NEW rows (no id — the original is being replaced). Empty when the exception
 * is a single day.
 */
function splitAroundDate(exception: ScheduleException, date: string): ScheduleException[] {
  const end = exceptionEndDate(exception);
  const out: ScheduleException[] = [];
  const rest = withoutId(exception);
  if (exception.date < date) {
    const before = addLocalDays(date, -1);
    out.push({...rest, date: exception.date, endDate: before > exception.date ? before : null});
  }
  if (end > date) {
    const after = addLocalDays(date, 1);
    out.push({...rest, date: after, endDate: end > after ? end : null});
  }
  return out;
}

/**
 * The remainder of a same-day window exception once [start, end) is removed:
 * zero, one or two pieces. The first piece keeps the row's id (an update);
 * a second piece is a new row.
 */
function trimWindow(exception: ScheduleException, start: number, end: number): ScheduleException[] {
  const eStart = exception.startMinute ?? 0;
  const eEnd = exception.endMinute ?? MINUTES_PER_DAY;
  const pieces: Array<{start: number; end: number}> = [];
  if (eStart < start) pieces.push({start: eStart, end: Math.min(start, eEnd)});
  if (eEnd > end) pieces.push({start: Math.max(end, eStart), end: eEnd});
  return pieces
    .filter((p) => p.end > p.start)
    .map((p, index) => ({
      ...(index === 0 && exception.id ? {id: exception.id} : {}),
      ...withoutId(exception),
      date: exception.date,
      endDate: null,
      startMinute: p.start,
      endMinute: p.end,
    }));
}

/**
 * Remove [start, end) on `date` from every exception of `kind`, splitting
 * ranges and trimming windows so nothing else those rows said is lost.
 */
function carveExceptions(
  exceptions: readonly ScheduleException[],
  kind: 'block' | 'open',
  date: string,
  start: number,
  end: number,
): ScheduleException[] {
  const out: ScheduleException[] = [];
  for (const exception of exceptions) {
    if (exception.kind !== kind || !exceptionCoversDate(exception, date)) {
      out.push(exception);
      continue;
    }
    const eStart = exception.startMinute ?? 0;
    const eEnd = exception.endMinute ?? MINUTES_PER_DAY;
    if (!overlaps(eStart, eEnd, start, end)) {
      out.push(exception);
      continue;
    }
    // The other days of a range are untouched; only `date` changes.
    const otherDays = splitAroundDate(exception, date);
    const single: ScheduleException = {...exception, date, endDate: null};
    const remainder = trimWindow(single, start, end);
    if (otherDays.length === 0) {
      out.push(...remainder);
    } else {
      // The range row is replaced outright (its id goes), and every piece is new.
      out.push(...otherDays);
      out.push(...remainder.map(withoutId));
    }
  }
  return out;
}

/** Does some resolved interval fully contain [start, end) for this specialty? */
function covered(intervals: readonly LocalInterval[], start: number, end: number, specialty: ScheduleSpecialty): boolean {
  return intervals.some(
    (i) => i.start <= start && i.end >= end && (i.specialty === null || i.specialty === specialty),
  );
}

/**
 * Make the physician available for [start, end) on `date` — the calendar's
 * "paint availability" gesture.
 *
 * Time off covering the window is cut back first (that is what the gesture
 * means), then an `open` exception is added unless the weekly pattern already
 * publishes the window. Nothing is ever added to the RULES: a one-day change
 * stays a one-day change.
 */
export function openWindow(
  document: ScheduleDocument,
  args: {date: string; start: number; end: number; specialty?: ScheduleSpecialty; reason?: string | null},
): ScheduleDocument {
  const {date, start, end} = args;
  if (!isSaneWindow(start, end) || !isLocalDate(date)) return document;
  const specialty = args.specialty ?? null;
  let exceptions = carveExceptions(document.exceptions, 'block', date, start, end);
  const already = intervalsForDay({date, rules: document.rules, exceptions});
  if (!covered(already, start, end, specialty)) {
    exceptions = [
      ...exceptions,
      {date, endDate: null, kind: 'open', startMinute: start, endMinute: end, specialty, ...(args.reason ? {reason: args.reason} : {})},
    ];
  }
  return {rules: document.rules, exceptions};
}

/**
 * Make the physician unavailable for [start, end) on `date` — the calendar's
 * "remove this window, this day only" gesture.
 *
 * Extra hours inside the window are cut back first; then, if the weekly
 * pattern (or remaining extra hours) still publishes anything in the window,
 * a `block` exception is added over it. The rules are untouched: removing
 * Tuesday the 14th must never remove every Tuesday.
 */
export function closeWindow(
  document: ScheduleDocument,
  args: {date: string; start: number; end: number; reason?: string | null},
): ScheduleDocument {
  const {date, start, end} = args;
  if (!isSaneWindow(start, end) || !isLocalDate(date)) return document;
  let exceptions = carveExceptions(document.exceptions, 'open', date, start, end);
  const remaining = intervalsForDay({date, rules: document.rules, exceptions});
  if (remaining.some((i) => overlaps(i.start, i.end, start, end))) {
    exceptions = [
      ...exceptions,
      {date, endDate: null, kind: 'block', startMinute: start, endMinute: end, specialty: null, ...(args.reason ? {reason: args.reason} : {})},
    ];
  }
  return {rules: document.rules, exceptions};
}

/**
 * Take time off across a date range — a whole-day block per day, or the same
 * window on each day. One exception row however long the leave. Extra hours
 * inside it are left in place (blocks win), so lifting the block later gives
 * them back.
 */
export function blockDates(
  document: ScheduleDocument,
  args: {from: string; to?: string | null; start?: number | null; end?: number | null; reason?: string | null},
): ScheduleDocument {
  const from = args.from;
  const to = args.to && args.to > from ? args.to : null;
  if (!isLocalDate(from) || (to && !isLocalDate(to))) return document;
  const windowed = args.start !== null && args.start !== undefined && args.end !== null && args.end !== undefined;
  if (windowed && !isSaneWindow(args.start as number, args.end as number)) return document;
  return {
    rules: document.rules,
    exceptions: [
      ...document.exceptions,
      {
        date: from,
        endDate: to,
        kind: 'block',
        startMinute: windowed ? (args.start as number) : null,
        endMinute: windowed ? (args.end as number) : null,
        specialty: null,
        reason: args.reason?.trim() ? args.reason.trim().slice(0, MAX_EXCEPTION_REASON_LENGTH) : null,
      },
    ],
  };
}

/**
 * Lift every block that touches `date` — for that day only. A range block
 * keeps its other days; a partial-day block is removed whole (the gesture is
 * "I am working that day after all").
 */
export function unblockDate(document: ScheduleDocument, date: string): ScheduleDocument {
  if (!isLocalDate(date)) return document;
  const exceptions: ScheduleException[] = [];
  for (const exception of document.exceptions) {
    if (exception.kind !== 'block' || !exceptionCoversDate(exception, date)) {
      exceptions.push(exception);
      continue;
    }
    exceptions.push(...splitAroundDate(exception, date));
  }
  return {rules: document.rules, exceptions};
}

/**
 * End a recurring rule the day before `date` instead of deleting it, so past
 * appointments keep the pattern they were booked against. A rule that has
 * not started by then is removed outright. The calendar's "stop repeating
 * from here" gesture.
 */
export function endRuleBefore(document: ScheduleDocument, rule: ScheduleRule, date: string): ScheduleDocument {
  if (!isLocalDate(date)) return document;
  const lastDay = addLocalDays(date, -1);
  const rules: ScheduleRule[] = [];
  // Matched by identity, or by id when the caller holds a copy of the row.
  const isTarget = (r: ScheduleRule) => r === rule || (!!rule.id && r.id === rule.id);
  for (const r of document.rules) {
    if (!isTarget(r)) {
      rules.push(r);
      continue;
    }
    if (r.effectiveFrom && r.effectiveFrom > lastDay) continue;
    rules.push({...r, effectiveUntil: r.effectiveUntil && r.effectiveUntil < lastDay ? r.effectiveUntil : lastDay});
  }
  return {rules, exceptions: document.exceptions};
}

// ---------------------------------------------------------------------------
// Diffing: an edited document → what to write
// ---------------------------------------------------------------------------

function canonicalRule(rule: ScheduleRule): string {
  return JSON.stringify([
    rule.weekday,
    rule.startMinute,
    rule.endMinute,
    rule.timezone ?? null,
    rule.effectiveFrom ?? null,
    rule.effectiveUntil ?? null,
    rule.intervalWeeks ?? 1,
    rule.specialty ?? null,
    rule.active !== false,
  ]);
}

function canonicalException(exception: ScheduleException): string {
  return JSON.stringify([
    exception.date,
    exception.endDate && exception.endDate > exception.date ? exception.endDate : null,
    exception.kind,
    exception.startMinute ?? null,
    exception.endMinute ?? null,
    exception.kind === 'open' ? (exception.specialty ?? null) : null,
    exception.reason ?? null,
  ]);
}

/**
 * Two rules say the same thing? (Ids and representation differences ignored.)
 */
export function sameRule(a: ScheduleRule, b: ScheduleRule): boolean {
  return canonicalRule(a) === canonicalRule(b);
}

/** Two exceptions say the same thing? */
export function sameException(a: ScheduleException, b: ScheduleException): boolean {
  return canonicalException(a) === canonicalException(b);
}

/**
 * What changed between the document as loaded and as edited: rows to create
 * (no id), rows to update (id present, content changed) and ids to delete.
 * Unchanged rows are not sent at all.
 */
export function diffSchedule(before: ScheduleDocument, after: ScheduleDocument): ScheduleChangeSet {
  const beforeRules = new Map(before.rules.filter((r) => r.id).map((r) => [r.id as string, r]));
  const beforeExceptions = new Map(before.exceptions.filter((e) => e.id).map((e) => [e.id as string, e]));
  const afterRuleIds = new Set(after.rules.map((r) => r.id).filter((id): id is string => !!id));
  const afterExceptionIds = new Set(after.exceptions.map((e) => e.id).filter((id): id is string => !!id));

  const rules = after.rules.filter((r) => {
    if (!r.id) return true;
    const prior = beforeRules.get(r.id);
    return !prior || !sameRule(prior, r);
  });
  const exceptions = after.exceptions.filter((e) => {
    if (!e.id) return true;
    const prior = beforeExceptions.get(e.id);
    return !prior || !sameException(prior, e);
  });
  return {
    rules,
    exceptions,
    deletedRuleIds: [...beforeRules.keys()].filter((id) => !afterRuleIds.has(id)),
    deletedExceptionIds: [...beforeExceptions.keys()].filter((id) => !afterExceptionIds.has(id)),
  };
}

/** Nothing to write? */
export function isEmptyChangeSet(change: ScheduleChangeSet): boolean {
  return (
    change.rules.length === 0 &&
    change.exceptions.length === 0 &&
    change.deletedRuleIds.length === 0 &&
    change.deletedExceptionIds.length === 0
  );
}
