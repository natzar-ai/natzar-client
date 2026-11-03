// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
// The subdivisions a medical licence can be held in — the shared catalogue for
// every surface that has to render or validate one.
//
// Licensure is per JURISDICTION, and a jurisdiction is a (country,
// subdivision) pair rather than a bare "state". That distinction is not
// pedantry: this platform has US and Canadian deployments.
// "CA" means California to one and
// Canada to another, and a licence table that stored only the second half would
// eventually let an Ontario physician take a California patient.
//
// Codes are ISO 3166-2 subdivision codes WITHOUT the country prefix (`CA`, not
// `US-CA`), stored uppercase, always alongside their country. That keeps a
// stored licence readable, keeps the common US case short, and still makes the
// pair unambiguous.

/** A licensable subdivision within one country. */
export type Jurisdiction = {
  /** ISO 3166-1 alpha-2, uppercase. */
  country: string;
  /** ISO 3166-2 subdivision code without the country prefix, uppercase. */
  code: string;
  /** Display name, in English. */
  name: string;
};

/**
 * US states, DC and the inhabited territories.
 *
 * The territories are included deliberately: they issue their own medical
 * licences, and a platform that silently cannot serve Puerto Rico is a platform
 * that quietly drops 3 million people.
 */
export const US_JURISDICTIONS: readonly Jurisdiction[] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
  ['AS', 'American Samoa'], ['GU', 'Guam'], ['MP', 'Northern Mariana Islands'],
  ['PR', 'Puerto Rico'], ['VI', 'U.S. Virgin Islands'],
].map(([code, name]) => ({country: 'US', code, name}));

/** Canadian provinces and territories. */
export const CA_JURISDICTIONS: readonly Jurisdiction[] = [
  ['AB', 'Alberta'], ['BC', 'British Columbia'], ['MB', 'Manitoba'],
  ['NB', 'New Brunswick'], ['NL', 'Newfoundland and Labrador'], ['NS', 'Nova Scotia'],
  ['NT', 'Northwest Territories'], ['NU', 'Nunavut'], ['ON', 'Ontario'],
  ['PE', 'Prince Edward Island'], ['QC', 'Quebec'], ['SK', 'Saskatchewan'],
  ['YT', 'Yukon'],
].map(([code, name]) => ({country: 'CA', code, name}));

export const ALL_JURISDICTIONS: readonly Jurisdiction[] = [
  ...US_JURISDICTIONS,
  ...CA_JURISDICTIONS,
];

/** Countries this catalogue covers, in the order a picker should offer them. */
export const LICENSED_COUNTRIES = ['US', 'CA'] as const;

/**
 * The subdivisions of one country, or the whole catalogue for a country we do
 * not have a list for.
 *
 * Returning EVERYTHING for an unknown country is deliberate: an unlisted
 * country must not present an empty dropdown, which reads as "this feature is
 * broken" rather than "we haven't mapped your country yet". The stored value is
 * validated on the pair, so an odd choice is visible rather than silently wrong.
 */
export function jurisdictionsFor(country?: string | null): readonly Jurisdiction[] {
  const wanted = normalizeCountryCode(country);
  const scoped = ALL_JURISDICTIONS.filter((j) => j.country === wanted);
  return scoped.length > 0 ? scoped : ALL_JURISDICTIONS;
}

/** ISO 3166-1 alpha-2, uppercase. Empty string when unusable. */
export function normalizeCountryCode(country?: string | null): string {
  const trimmed = (country ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : '';
}

/**
 * A subdivision code, uppercase and prefix-stripped.
 *
 * Accepts the full ISO form (`US-CA`) as well as the bare one (`CA`) because
 * both turn up in real intake data, and silently keeping the `US-` prefix on
 * one row would make it never match the other.
 */
export function normalizeStateCode(state?: string | null): string {
  const trimmed = (state ?? '').trim().toUpperCase();
  const bare = trimmed.includes('-') ? trimmed.slice(trimmed.lastIndexOf('-') + 1) : trimmed;
  return /^[A-Z0-9]{2,3}$/.test(bare) ? bare : '';
}

/** Display name for a (country, code) pair, falling back to the raw code. */
export function jurisdictionName(country?: string | null, state?: string | null): string {
  const c = normalizeCountryCode(country);
  const s = normalizeStateCode(state);
  if (!s) return '';
  const match = ALL_JURISDICTIONS.find((j) => j.code === s && (!c || j.country === c));
  return match?.name ?? s;
}

/** Is this a subdivision the catalogue knows, in this country? */
export function isKnownJurisdiction(country?: string | null, state?: string | null): boolean {
  const c = normalizeCountryCode(country);
  const s = normalizeStateCode(state);
  if (!s) return false;
  return ALL_JURISDICTIONS.some((j) => j.code === s && (!c || j.country === c));
}
