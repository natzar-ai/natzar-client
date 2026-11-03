// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import Datepicker, {type DatepickerLocale} from "flowbite-datepicker/Datepicker";
// Avoid the library's dark:text-white utility overriding the light calendar's arrows.
export const BIRTHDATE_PREV_ARROW = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 18-6-6 6-6" stroke="#475569" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
export const BIRTHDATE_NEXT_ARROW = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 6 6 6-6 6" stroke="#475569" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// What consultJoin's `birthdate` argument (an AWSDate) expects, regardless of
// how the picker displays the date to the patient.
export const ISO_FORMAT = "yyyy-mm-dd";

// Sunday-first week used to read weekday names out of Intl: 2021-08-01 was a
// Sunday, and the datepicker's `days` array is Sunday-indexed.
const SUNDAY = Date.UTC(2021, 7, 1);

// The earliest birthdate the field will offer. Nobody alive is older, and it
// bounds the decade view to something walkable.
export const OLDEST = new Date(1900, 0, 1);

const range = (n: number) => Array.from({length: n}, (_, i) => i);

// Weekday/month names in `tag`'s language, in the order the datepicker expects
// (Sunday first, January first). Read from Intl in UTC so a browser west of
// Greenwich doesn't shift every name by a day.
const names = (tag: string, opts: Intl.DateTimeFormatOptions, dates: number[]) => {
  const fmt = new Intl.DateTimeFormat(tag, {...opts, timeZone: "UTC"});
  return dates.map((d) => fmt.format(d));
};

// The locale's own day/month order and separator, as a datepicker format
// string — "dd.mm.yyyy" for de-CH, "mm/dd/yyyy" for en-US, and so on. The
// patient reads the date they're used to; the ISO value goes to the server.
const displayFormat = (tag: string): string => {
  const parts = new Intl.DateTimeFormat(tag, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  }).formatToParts(Date.UTC(2023, 10, 22));

  const format = parts
    .map((p) =>
      p.type === "year" ? "yyyy" : p.type === "month" ? "mm" : p.type === "day" ? "dd" : p.value,
    )
    .join("");
  // A locale whose pattern Intl renders with extra words (rare, but e.g. some
  // East Asian tags append 年/月/日) still round-trips; anything we couldn't
  // recognise at all falls back to ISO.
  return /dd/.test(format) && /mm/.test(format) && /yyyy/.test(format) ? format : ISO_FORMAT;
};

// Which weekday the calendar's first column is. Intl knows (getWeekInfo), but
// it's still unevenly supported, so fall back to Monday — right for every
// language this page ships in except US English.
const weekStart = (tag: string): number => {
  try {
    const first = (new Intl.Locale(tag) as Intl.Locale & {getWeekInfo?(): {firstDay: number}}).getWeekInfo?.().firstDay;
    // getWeekInfo counts Monday=1…Sunday=7; the datepicker counts Sunday=0.
    if (first) return first % 7;
  } catch {
    /* fall through */
  }
  return tag.startsWith("en-US") ? 0 : 1;
};

// Build (and register) the datepicker locale for a BCP-47 tag out of Intl,
// rather than shipping the package's own hand-maintained locale files: those
// only cover the languages someone contributed, are exposed through a subpath
// export that's broken in this version, and would drift from the five
// languages this page actually offers.
export function registerLocale(tag: string): string {
  if (Datepicker.locales[tag]) return tag;

  const days = range(7).map((i) => SUNDAY + i * 86_400_000);
  const months = range(12).map((i) => Date.UTC(2021, i, 1));

  const locale: DatepickerLocale = {
    days: names(tag, {weekday: "long"}, days),
    daysShort: names(tag, {weekday: "short"}, days),
    daysMin: names(tag, {weekday: "narrow"}, days),
    months: names(tag, {month: "long"}, months),
    monthsShort: names(tag, {month: "short"}, months),
    // Both buttons are turned off below; the keys are required by the shape.
    today: "",
    clear: "",
    weekStart: weekStart(tag),
    format: displayFormat(tag),
  };
  Datepicker.locales[tag] = locale;
  return tag;
}
