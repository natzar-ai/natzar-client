// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import type {GuestIdentity, GuestResult} from '../contract/guest';
import {guestSignupRegion} from './guest-signup';
import type {GuestCopy} from './copy';
import {HistoryDialog} from './HistoryDialog';

/** Care demographics use the exact same contained profile dialog as sign-up. */
export function IdentityForm({initial, busy, onSubmit, locale = 'en', clinicName, privacyUrl, termsUrl, country, phoneLocked = false, open, onClose}: {
  initial?: Partial<GuestIdentity>; copy: GuestCopy; busy: boolean; locale?: string; clinicName: string;
  privacyUrl?: string | null; termsUrl?: string | null; country: 'US' | 'CA'; phoneLocked?: boolean;
  open: boolean; onClose(): void;
  onSubmit(value: GuestIdentity, consents: {healthConsent: true; messagingConsent: boolean}, verificationChannel?: 'sms' | 'whatsapp'): Promise<GuestResult>;
}) {
  return <HistoryDialog purpose="care" open={open} initialProfile={initial} initialPhone={initial?.phone} phoneLocked={phoneLocked}
    country={country} locale={locale} busy={busy} clinicName={clinicName} privacyUrl={privacyUrl ?? undefined} termsUrl={termsUrl ?? undefined}
    history={{saved: false, offered: true, canOffer: false, canSave: true}} onClose={onClose}
    onRequest={async (action, input) => {
      if (action !== 'sendHistoryCode' || !input.signup || !input.phone || input.healthConsent !== true) return {ok: false, error: 'invalid_step'};
      return onSubmit({...input.signup, email: input.signup.email ?? '', phone: input.phone, country, state: guestSignupRegion(input.signup.zipCode, country)},
        {healthConsent: true, messagingConsent: input.messagingConsent === true}, input.verificationChannel);
    }}/>
}
