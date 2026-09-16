// GENERATED FILE — do not edit.
//
// Copied verbatim from provider-portal's shared/partner-api by
// scripts/sync-contract.mjs. Edit the source there; this copy exists only so
// the published package is self-contained.
/**
 * # Time zones — the helpers every zone picker and zone label needs
 *
 * Scheduling runs on IANA zone ids (`Europe/Zurich`, `America/Los_Angeles`),
 * never on offsets: an offset slides by an hour twice a year, an id does not.
 * Three zones meet on a booking — the CLINIC's (`ConsultSettings.timezone`),
 * the PHYSICIAN's calendar zone (`schedulingTimezone`, defaulting to the
 * clinic's) and the PATIENT's (the device zone of whatever surface they book
 * from, or the `patientTimezone` a partner sends) — and every payload says
 * which one it is expressed in. What a surface then needs is small and the
 * same everywhere: the list of ids to choose from, a way to tell a real id
 * from a typo before it is sent, the device's own zone, a human label per id
 * ("UTC+02:00 · Central European Summer Time") and the difference between two
 * zones in words ("9 h ahead"). That is this module.
 *
 * Everything here is PURE and runtime-agnostic: only `Intl`, no DOM, no
 * clock beyond the `at` instant a caller passes. It runs identically in Node,
 * in a Lambda and in every supported browser, and the platform's own
 * surfaces use it — so a partner's zone picker and ours offer the same ids
 * and print the same labels.
 *
 * @module
 */

/**
 * The shape of an IANA zone id as the API accepts it: `Area/Location`,
 * letters, digits, `_`, `+`, `-` and `/` only, at most 64 characters. Shape
 * only — the server checks the id against the tz database and answers
 * `400 invalid_request` ("timezone: unknown IANA zone") when it is not one
 * (an abbreviation like `CEST` fits the shape and fails there). Offsets
 * (`+02:00`) are deliberately outside the shape.
 */
export const IANA_ZONE_REGEX = /^[A-Za-z0-9_+\-/]+$/;

/** Longest zone id the API accepts. The tz database's longest is 32. */
export const MAX_ZONE_ID_LENGTH = 64;

/**
 * A representative list for runtimes without `Intl.supportedValuesOf`
 * (Node < 18, older WebViews): the zones a clinic or a patient is likely to
 * be in, one or two per region, every UTC offset covered. Never the source
 * of truth — {@link listTimeZoneIds} prefers the runtime's own table — and
 * never the validator: {@link isKnownTimeZone} asks `Intl`, so an id outside
 * this list that the runtime knows is still accepted.
 */
export const FALLBACK_TIME_ZONE_IDS: readonly string[] = [
  'UTC',
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Vancouver',
  'America/Denver',
  'America/Edmonton',
  'America/Phoenix',
  'America/Chicago',
  'America/Winnipeg',
  'America/Mexico_City',
  'America/New_York',
  'America/Toronto',
  'America/Halifax',
  'America/St_Johns',
  'America/Bogota',
  'America/Lima',
  'America/Santiago',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'Atlantic/Azores',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/Paris',
  'Europe/Brussels',
  'Europe/Amsterdam',
  'Europe/Berlin',
  'Europe/Zurich',
  'Europe/Vienna',
  'Europe/Rome',
  'Europe/Madrid',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Athens',
  'Europe/Helsinki',
  'Europe/Kyiv',
  'Europe/Istanbul',
  'Europe/Moscow',
  'Africa/Casablanca',
  'Africa/Lagos',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Nairobi',
  'Asia/Tehran',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Manila',
  'Asia/Seoul',
  'Asia/Tokyo',
  'Australia/Perth',
  'Australia/Adelaide',
  'Australia/Sydney',
  'Pacific/Auckland',
];

type IntlWithSupportedValues = {supportedValuesOf?: (key: string) => string[]};

/**
 * Is this a zone the runtime knows? Shape first ({@link IANA_ZONE_REGEX}),
 * then the tz database via `Intl` — the same two checks the API applies, so
 * a picker that validates with this never sends an id the server refuses.
 *
 * A type guard, so an `unknown` from a form or a query string narrows to a
 * string in one step.
 */
export function isKnownTimeZone(id: unknown): id is string {
  if (typeof id !== 'string' || !id || id.length > MAX_ZONE_ID_LENGTH || !IANA_ZONE_REGEX.test(id)) return false;
  try {
    new Intl.DateTimeFormat('en-US', {timeZone: id});
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone this runtime is in — a browser's device zone, a server's
 * configured one — or null when `Intl` cannot say. On a patient surface this
 * is what to send as `timezone` on the slots and booking calls; the platform
 * never guesses it, so a grid rendered without it is in the clinic's zone.
 */
export function deviceTimeZone(): string | null {
  try {
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isKnownTimeZone(zone) ? zone : null;
  } catch {
    return null;
  }
}

/**
 * The ids a zone picker offers, sorted, unique, `UTC` included: the runtime's
 * own table (`Intl.supportedValuesOf('timeZone')`) when it has one, else
 * {@link FALLBACK_TIME_ZONE_IDS}. The device zone is always on the list, and
 * so is `current` — the value the picker is showing — when it is a real zone,
 * so a stored id the fallback list does not carry still renders as selected
 * rather than as nothing.
 *
 * @param current - The value currently selected, if any.
 */
export function listTimeZoneIds(current?: string | null): string[] {
  const ids = new Set<string>(['UTC']);
  const supported = (Intl as unknown as IntlWithSupportedValues).supportedValuesOf;
  let fromRuntime: string[] | null = null;
  if (typeof supported === 'function') {
    try {
      fromRuntime = supported.call(Intl, 'timeZone');
    } catch {
      fromRuntime = null;
    }
  }
  for (const id of fromRuntime && fromRuntime.length > 0 ? fromRuntime : FALLBACK_TIME_ZONE_IDS) ids.add(id);
  const device = deviceTimeZone();
  if (device) ids.add(device);
  if (isKnownTimeZone(current)) ids.add(current);
  return [...ids].sort();
}

// One formatter per zone: `Intl.DateTimeFormat` construction is the expensive
// part, and a picker describes hundreds of zones in one render.
const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = partsFormatters.get(timeZone);
  if (cached) return cached;
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  partsFormatters.set(timeZone, dtf);
  return dtf;
}

/**
 * The zone's UTC offset at `at`, in minutes (Zurich in summer → 120,
 * Los Angeles → -420, Kolkata → 330). Computed from the wall-clock reading,
 * which is the one thing every `Intl` build agrees on; throws on an unknown
 * zone, so validate first.
 */
export function offsetMinutes(timeZone: string, at: Date = new Date()): number {
  const map: Record<string, string> = {};
  for (const part of partsFormatterFor(timeZone).formatToParts(at)) map[part.type] = part.value;
  const wall = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    // Some ICU builds render midnight as "24" even under h23.
    Number(map.hour) % 24,
    Number(map.minute),
    Number(map.second),
  );
  // Sub-second parts are not rendered, so compare at second precision.
  return Math.round((wall - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** `UTC+02:00`, `UTC-07:00`, `UTC+05:30`, `UTC±00:00` — the label a picker row carries. */
export function formatOffset(minutes: number): string {
  const sign = minutes > 0 ? '+' : minutes < 0 ? '-' : '±';
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hh}:${mm}`;
}

/** What {@link describeTimeZone} returns: enough to render one picker row. */
export interface TimeZoneDescription {
  /** The id, as given. */
  id: string;
  /** UTC offset at the instant described, in minutes. */
  offsetMinutes: number;
  /** `UTC+02:00` — see {@link formatOffset}. */
  offsetLabel: string;
  /**
   * The zone's long name in `locale` at that instant — "Central European
   * Summer Time", "heure d’été d’Europe centrale". Falls back to the id when
   * the runtime has no name for it.
   */
  longName: string;
}

/**
 * Describe a zone for display: offset and long name at `at` (now by default —
 * both change with daylight saving, so a picker showing today's offset is
 * what a person expects). Throws on an unknown zone; validate first.
 *
 * @param id - IANA zone id.
 * @param at - The instant to describe it at.
 * @param locale - BCP 47 locale for the long name (`'fr-CH'`).
 */
export function describeTimeZone(id: string, at: Date = new Date(), locale = 'en'): TimeZoneDescription {
  const minutes = offsetMinutes(id, at);
  let longName = id;
  try {
    const part = new Intl.DateTimeFormat(locale, {timeZone: id, timeZoneName: 'long'})
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName');
    if (part?.value) longName = part.value;
  } catch {
    /* an ICU without names for this locale: the id is still a truthful label */
  }
  return {id, offsetMinutes: minutes, offsetLabel: formatOffset(minutes), longName};
}

/**
 * How far `a` is AHEAD of `b` at `at`, in minutes — positive when `a`'s
 * clock reads later (Zurich vs Los Angeles in June → 540), negative when
 * earlier, 0 when they agree at that instant (two zones can differ in
 * general and still agree today: London and Lisbon, or Phoenix and Denver in
 * winter). Compare at the appointment's instant, not now: an offset can
 * change between booking and the visit.
 */
export function offsetDifferenceMinutes(a: string, b: string, at: Date = new Date()): number {
  return offsetMinutes(a, at) - offsetMinutes(b, at);
}

/** Languages {@link describeOffsetDifference} has copy for. Anything else reads as English. */
export type OffsetDifferenceLanguage = 'en' | 'fr' | 'de' | 'es' | 'it';

const OFFSET_COPY: Record<OffsetDifferenceLanguage, {same: string; ahead: (n: string) => string; behind: (n: string) => string}> = {
  en: {same: 'same time', ahead: (n) => `${n} ahead`, behind: (n) => `${n} behind`},
  fr: {same: 'même heure', ahead: (n) => `${n} d’avance`, behind: (n) => `${n} de retard`},
  de: {same: 'gleiche Zeit', ahead: (n) => `${n} voraus`, behind: (n) => `${n} zurück`},
  es: {same: 'misma hora', ahead: (n) => `${n} por delante`, behind: (n) => `${n} por detrás`},
  it: {same: 'stessa ora', ahead: (n) => `${n} avanti`, behind: (n) => `${n} indietro`},
};

function offsetLanguage(locale: string | undefined): OffsetDifferenceLanguage {
  const lang = (locale ?? 'en').toLowerCase().split(/[-_]/)[0];
  return lang in OFFSET_COPY ? (lang as OffsetDifferenceLanguage) : 'en';
}

/**
 * A difference from {@link offsetDifferenceMinutes} in words: "9 h ahead",
 * "9 h behind", "5 h 30 ahead", "same time" — in `en`, `fr`, `de`, `es` or
 * `it` (by the locale's language subtag; anything else reads as English).
 * The subject is the zone passed FIRST to `offsetDifferenceMinutes`: "the
 * clinic is 9 h ahead" is `describeOffsetDifference(offsetDifferenceMinutes(
 * clinic, patient, at))`.
 */
export function describeOffsetDifference(minutes: number, locale?: string): string {
  const copy = OFFSET_COPY[offsetLanguage(locale)];
  if (minutes === 0) return copy.same;
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  const amount = rest === 0 ? `${hours} h` : hours === 0 ? `${rest} min` : `${hours} h ${String(rest).padStart(2, '0')}`;
  return minutes > 0 ? copy.ahead(amount) : copy.behind(amount);
}
