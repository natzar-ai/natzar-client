// GENERATED FILE — do not edit.
//
// Copied verbatim from provider-portal's shared/partner-api by
// scripts/sync-contract.mjs. Edit the source there; this copy exists only so
// the published package is self-contained.
/**
 * # Languages — the physician-language preference, and the helpers every
 * language picker needs
 *
 * A patient has ONE language (`Patient.lang`, a regional code such as
 * `fr_CH` or `en_US`) and a physician may consult in several
 * (`PhysicianResource.languages`, base codes such as `fr`). Routing compares
 * the two on the BASE code only — `fr_CH`, `fr_CA` and `fr` are all French —
 * because the region says where the patient is, not what they speak, and a
 * Québec patient must land on a French-speaking physician even though the
 * platform stores their language as `fr_CH`.
 *
 * The comparison is a RANKED PREFERENCE, never a filter. Every assigner
 * (the live queue, booking, async) first applies the two hard rules —
 * specialty and state licensure — and then, among the physicians that
 * survive, prefers in this order:
 *
 *   1. a physician who speaks the patient's language;
 *   2. a physician who speaks English ({@link ROUTING_FALLBACK_LANGUAGE});
 *   3. anyone else who is eligible.
 *
 * Within a tier the assigner's own fairness order decides (longest ready,
 * least loaded, fewest open threads). Two consequences worth stating: a
 * physician with NO languages recorded is tier 3 and still receives
 * consults — turning the feature on can never empty a rota, and a colleague
 * who filled the form in is never demoted for English patients by having
 * done so; and a consult whose patient language is unknown is unranked, so
 * it is assigned exactly as it was before this existed.
 *
 * Everything here is PURE and runtime-agnostic — no clients, no clock — so
 * the platform's assigners, its own pickers and a partner's editor all run
 * the same code and agree on the same five codes.
 *
 * @module
 */

/**
 * The languages a physician may declare, as ISO 639-1 base codes, in the
 * order a picker should offer them. Exactly the base codes of the patient
 * languages the platform supports (`en_US`, `es_US`, `de_CH`, `fr_CH`,
 * `it_CH`): a physician code outside this set could never match a patient,
 * so it is refused rather than stored.
 */
export const PHYSICIAN_LANGUAGES = ['en', 'es', 'de', 'fr', 'it'] as const;

/** One of {@link PHYSICIAN_LANGUAGES}. */
export type PhysicianLanguage = (typeof PHYSICIAN_LANGUAGES)[number];

/** The most languages one physician can declare — the whole catalogue. */
export const MAX_PHYSICIAN_LANGUAGES = PHYSICIAN_LANGUAGES.length;

/**
 * The tier-2 fallback: when nobody speaks the patient's language, an
 * English speaker is preferred over a physician who speaks neither.
 */
export const ROUTING_FALLBACK_LANGUAGE: PhysicianLanguage = 'en';

/**
 * Display names per code: `name` in English, `nativeName` as the language
 * calls itself. Autonyms are what a picker should show — they read
 * correctly to the person who speaks the language whatever the UI locale.
 */
export const LANGUAGE_NAMES: Readonly<Record<PhysicianLanguage, {name: string; nativeName: string}>> = {
  en: {name: 'English', nativeName: 'English'},
  es: {name: 'Spanish', nativeName: 'Español'},
  de: {name: 'German', nativeName: 'Deutsch'},
  fr: {name: 'French', nativeName: 'Français'},
  it: {name: 'Italian', nativeName: 'Italiano'},
};

/**
 * A human label for a language code — the autonym by default, the English
 * name with `{native: false}`. Accepts a regional code (`fr_CH`) as well as
 * a base one. Falls back to the raw input for a code the catalogue does not
 * know, so a label is never blank.
 */
export function languageName(code: string | null | undefined, opts: {native?: boolean} = {}): string {
  const base = baseLanguageOf(code);
  if (!base) return (code ?? '').trim();
  const entry = LANGUAGE_NAMES[base];
  return opts.native === false ? entry.name : entry.nativeName;
}

/**
 * Collapse any language code the platform might hold — `fr`, `fr_CH`,
 * `FR-ca`, ` fr ` — to its supported base code, or `null` when it is not one
 * of the five.
 *
 * `null`, not `'en'`, for the unknown case. The messaging helpers that
 * pick copy for a patient default an unknown language to English because
 * SOME copy has to be sent; routing must not, because "we do not know what
 * this patient speaks" and "this patient speaks English" would then rank the
 * roster identically — English speakers first — for a patient who might well
 * be neither.
 */
export function baseLanguageOf(code: string | null | undefined): PhysicianLanguage | null {
  if (typeof code !== 'string') return null;
  const base = code.trim().toLowerCase().split(/[-_]/)[0];
  return (PHYSICIAN_LANGUAGES as readonly string[]).includes(base) ? (base as PhysicianLanguage) : null;
}

/**
 * Coerce whatever an editor, a REST body or a stored row holds into a clean
 * list of base codes: each entry normalized through {@link baseLanguageOf},
 * unknown entries dropped, duplicates removed (first occurrence wins, so the
 * physician's own order is kept), and nothing that is not an array read as
 * empty. The one normalizer every writer runs, so the table only ever holds
 * values the ranking can match.
 */
export function normalizeLanguages(input: unknown): PhysicianLanguage[] {
  if (!Array.isArray(input)) return [];
  const out: PhysicianLanguage[] = [];
  for (const entry of input) {
    const base = baseLanguageOf(typeof entry === 'string' ? entry : null);
    if (base && !out.includes(base)) out.push(base);
  }
  return out;
}

/** The language-carrying scalar of a clinician, as any reader holds it. */
export type LanguageHolder = {
  languages?: readonly (string | null)[] | null;
};

/** The base codes a clinician has declared, normalized. Empty = nothing recorded. */
export function spokenLanguages(holder: LanguageHolder | null | undefined): PhysicianLanguage[] {
  return normalizeLanguages(holder?.languages ?? []);
}

/** Does this clinician speak `code` (any regional form of it)? */
export function speaksLanguage(holder: LanguageHolder | null | undefined, code: string | null | undefined): boolean {
  const base = baseLanguageOf(code);
  return !!base && spokenLanguages(holder).includes(base);
}

/**
 * Where a clinician ranks for a patient: `1` speaks the patient's language,
 * `2` speaks English, `3` neither. See the module header for why 3 is a
 * rank and not a refusal.
 */
export type LanguageTier = 1 | 2 | 3;

/**
 * Rank ONE clinician for ONE patient.
 *
 * A patient whose language is unknown (absent, or not one of the five) puts
 * everybody in tier 3 — nobody is preferred, and the assigner's own order
 * stands untouched. This is deliberately not "prefer English speakers": see
 * {@link baseLanguageOf}.
 */
export function languageTier(holder: LanguageHolder | null | undefined, patientLang: string | null | undefined): LanguageTier {
  const wanted = baseLanguageOf(patientLang);
  if (!wanted) return 3;
  const spoken = spokenLanguages(holder);
  if (spoken.includes(wanted)) return 1;
  if (spoken.includes(ROUTING_FALLBACK_LANGUAGE)) return 2;
  return 3;
}

/**
 * A comparator for `Array.prototype.sort` that orders clinicians by
 * {@link languageTier} for `patientLang` and leaves equal tiers in their
 * existing order (sort is stable), so it composes in FRONT of an assigner's
 * fairness order rather than replacing it.
 */
export function compareLanguageTier(
  patientLang: string | null | undefined,
): (a: LanguageHolder | null | undefined, b: LanguageHolder | null | undefined) => number {
  return (a, b) => languageTier(a, patientLang) - languageTier(b, patientLang);
}

/**
 * The candidates re-ordered by language tier, best first, ties kept in the
 * order they came in. Pass the list ALREADY in the assigner's fairness order
 * and the result is "best tier, and within it the fairest".
 */
export function rankByLanguage<T extends LanguageHolder>(
  candidates: readonly T[],
  patientLang: string | null | undefined,
): T[] {
  return [...candidates].sort(compareLanguageTier(patientLang));
}

/**
 * Every language at least one of `holders` speaks, in catalogue order — the
 * union a slot offer carries so a grid can say which of its times come with
 * a French speaker.
 */
export function languagesOffered(holders: ReadonlyArray<LanguageHolder | null | undefined>): PhysicianLanguage[] {
  const seen = new Set<PhysicianLanguage>();
  for (const holder of holders) for (const code of spokenLanguages(holder)) seen.add(code);
  return PHYSICIAN_LANGUAGES.filter((code) => seen.has(code));
}
