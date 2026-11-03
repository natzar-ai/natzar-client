// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import {isPatientSex} from './patient-sex';
import type {GuestSignup} from '../contract/guest';
import {zip3States} from './guest-postal-data';
import {zipExclusions} from './guest-postal-data';

export class GuestSignupError extends Error {
  constructor(readonly field: keyof GuestSignup) {super('invalid_signup');}
}
/** Same validation in the contained form and the server; country comes from the clinic. */
export function normalizeGuestSignup(value: unknown, country: 'US' | 'CA', now = Date.now()): GuestSignup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GuestSignupError('givenName');
  const input = value as Record<string, unknown>;
  const name = (field: 'givenName' | 'familyName') => {
    if (typeof input[field] !== 'string') throw new GuestSignupError(field);
    const text = input[field].trim().replace(/\s+/g, ' ');
    if (!text || text.length > 80 || /[<>]/.test(text) || [...text].some(character => character.charCodeAt(0) < 32)) throw new GuestSignupError(field);
    return text;
  };
  const givenName = name('givenName'), familyName = name('familyName');
  if (!isPatientSex(input.sexAssignedAtBirth)) throw new GuestSignupError('sexAssignedAtBirth');
  const birthdate = typeof input.birthdate === 'string' ? input.birthdate : '', date = new Date(birthdate + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate) || !Number.isFinite(+date) || date.toISOString().slice(0, 10) !== birthdate || +date > now || +date < now - 130 * 366 * 86400000) throw new GuestSignupError('birthdate');
  const zipCode = formatGuestPostal(typeof input.zipCode === 'string' ? input.zipCode : '', country);
  if (!validGuestPostal(zipCode, country)) throw new GuestSignupError('zipCode');
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (input.email !== undefined && !validGuestEmail(email)) throw new GuestSignupError('email');
  return {givenName, familyName, birthdate, sexAssignedAtBirth: input.sexAssignedAtBirth, zipCode, ...(email ? {email} : {})};
}
export function validGuestEmail(value: string): boolean {
  const email = value.trim();
  return !!email && email.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email);
}
export function validGuestPostal(value: string, country: 'US' | 'CA'): boolean {
  const code = formatGuestPostal(value, country);
  return country === 'CA' ? /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] \d[ABCEGHJ-NPRSTV-Z]\d$/.test(code)
    : /^\d{5}(-\d{4})?$/.test(code) && !!(zip3States as Record<string, string>)[code.slice(0, 3)] && !zipExclusions.includes(code.slice(0, 5));
}
export function formatGuestPostal(value: string, country: 'US' | 'CA'): string {
  const compact = value.trim().toUpperCase();
  if (country === 'US') return compact.replace(/^(\d{5})(\d{4})$/, '$1-$2');
  const code = compact.replace(/[ -]/g, '');
  return code.length > 3 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}
export function guestSignupRegion(zipCode: string, country: 'US' | 'CA'): string {
  if (country === 'US') return (zip3States as Record<string, string>)[zipCode.slice(0, 3)];
  const regions: Record<string, string> = {A: 'NL', B: 'NS', C: 'PE', E: 'NB', G: 'QC', H: 'QC', J: 'QC', K: 'ON', L: 'ON', M: 'ON', N: 'ON', P: 'ON', R: 'MB', S: 'SK', T: 'AB', V: 'BC', Y: 'YT'};
  return zipCode[0] === 'X' ? (/^X0[ABC]/.test(zipCode) ? 'NU' : 'NT') : regions[zipCode[0]];
}
