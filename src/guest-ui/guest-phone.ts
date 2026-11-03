// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import {parsePhoneNumberFromString} from 'libphonenumber-js';

/** Contact entry is international and never guesses a patient's country. */
export function guestPhoneNumber(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64 || !value.trim().startsWith('+')) return null;
  const phone = parsePhoneNumberFromString(value.trim());
  return phone?.isValid() ? phone.number : null;
}
