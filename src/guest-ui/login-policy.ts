// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import {parsePhoneNumberFromString} from 'libphonenumber-js';
// Shared by the browser and Cognito triggers. This is a delivery request,
// never a successful answer to an authentication challenge.
export const LOGIN_RESEND_RESPONSE = 'RESEND_LOGIN_CODE';
export const LOGIN_RESEND_SECONDS = 30;
export type LoginChannel = 'sms' | 'whatsapp';

export function loginChannel(value: unknown): LoginChannel | undefined {
  return value === 'sms' || value === 'whatsapp' ? value : undefined;
}

export function intakeHref(search: string, intent: 'new' | 'update' = 'new'): string {
  const params = new URLSearchParams(search);
  params.delete('next');
  params.set('start', intent);
  // Vite's intake base is /form/; the trailing slash also works on Hosting.
  return `/form/?${params}`;
}

/** Login SMS is available only for US and Canadian numbers, including +1. */
export function smsLoginAllowed(phone: string): boolean {
  if (!phone.startsWith('+1')) return false;
  const country = parsePhoneNumberFromString(phone)?.country;
  return country === 'US' || country === 'CA';
}

/** Prefer SMS unless WhatsApp is selected or SMS is unavailable for the number. */
export function preferredLoginChannel(phone: string, messageChannel?: string | null): LoginChannel {
  return smsLoginAllowed(phone) && messageChannel !== 'whatsapp' ? 'sms' : 'whatsapp';
}
