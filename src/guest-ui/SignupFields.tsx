// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import {sortSelectionOptions} from './selection-order';
import {PATIENT_SEX_VALUES} from './patient-sex';
import {GuestSingleSelect} from './GuestSingleSelect';
import {useState} from 'react';
import type {GuestSignup} from '../contract/guest';
import {formatGuestPostal, validGuestEmail, validGuestPostal} from './guest-signup';
import {signupCopy} from './signup-copy';
import {RequiredMark} from './RequiredMark';
import {BirthdateInput} from './BirthdateInput';

export function SignupFields({id, values, onChange, country, locale, invalid, busy, container, onCalendarOpen, emailError}: {
  id: string; values: Partial<GuestSignup>; onChange(field: keyof GuestSignup, value: string): void;
  country: 'US' | 'CA'; locale: string; invalid?: keyof GuestSignup; busy: boolean;
  container(): HTMLElement | null; onCalendarOpen(value: boolean): void;
  emailError?: string;
}) {
  const [postalTouched, setPostalTouched] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const copy = signupCopy(locale), set = (field: keyof GuestSignup, value: string) => onChange(field, value);
  const postalError = (postalTouched || invalid === 'zipCode') && !validGuestPostal(values.zipCode ?? '', country);
  const invalidEmail = !!emailError || (emailTouched || invalid === 'email') && !validGuestEmail(values.email ?? '');
  const field = (name: 'givenName' | 'familyName' | 'zipCode' | 'email', type: string, autoComplete: string) => <div className="guest-profile-field">
    <label htmlFor={id + '-' + name}>{name === 'zipCode' ? country === 'CA' ? copy.zipCA : copy.zipUS : copy[name]}<RequiredMark/></label>
    <input id={id + '-' + name} name={name} aria-label={name === 'zipCode' ? country === 'CA' ? copy.zipCA : copy.zipUS : copy[name]} type={type} autoComplete={autoComplete} disabled={busy} required value={values[name] ?? ''}
      aria-invalid={name === 'zipCode' ? postalError || undefined : name === 'email' ? invalidEmail || undefined : invalid === name || undefined}
      aria-describedby={name === 'zipCode' && postalError ? id + '-postal-error' : name === 'email' && invalidEmail ? id + '-email-error' : invalid === name ? id + '-error' : undefined}
      maxLength={name === 'zipCode' ? 10 : name === 'email' ? 254 : 80}
      {...(name === 'zipCode' ? {inputMode: country === 'CA' ? 'text' as const : 'numeric' as const, autoCapitalize: 'characters', spellCheck: false, placeholder: country === 'CA' ? 'A1A 1A1' : '12345'} : {})}
      onBlur={() => {if (name === 'zipCode') setPostalTouched(true); if (name === 'email') setEmailTouched(true);}}
      onChange={event => set(name, name === 'zipCode' ? formatGuestPostal(event.target.value, country) : event.target.value)}/>
    {name === 'zipCode' && postalError && <p className="guest-field-error" id={id + '-postal-error'} role="alert">{country === 'CA' ? copy.invalidZipCA : copy.invalidZipUS}</p>}
    {name === 'email' && invalidEmail && <p className="guest-field-error" id={id + '-email-error'} role="alert">{emailError || copy.invalidEmail}</p>}
  </div>;
  return <div className="guest-signup-fields">
    <div className="guest-signup-row">{field('givenName', 'text', 'given-name')}{field('familyName', 'text', 'family-name')}</div>
    <div className="guest-signup-row guest-signup-demographics"><div className="guest-profile-field"><label htmlFor={id + '-birthdate'}>{copy.birthdate}<RequiredMark/></label>
      <BirthdateInput id={id + '-birthdate'} value={values.birthdate ?? ''} onChange={value => set('birthdate', value)} disabled={busy} locale={locale} label={copy.birthdate}
        invalid={invalid === 'birthdate'} describedBy={invalid === 'birthdate' ? id + '-error' : undefined} container={container} onOpenChange={onCalendarOpen}/></div>
      <div className="guest-profile-field guest-profile-sex"><label htmlFor={id + '-sexAssignedAtBirth'}>{copy.sexAssignedAtBirth}<RequiredMark/></label>
        <GuestSingleSelect id={id + '-sexAssignedAtBirth'} name="sexAssignedAtBirth" aria-label={copy.sexAssignedAtBirth} value={values.sexAssignedAtBirth ?? ''} required disabled={busy} autoComplete="sex"
          aria-invalid={invalid === 'sexAssignedAtBirth' || undefined} aria-describedby={invalid === 'sexAssignedAtBirth' ? id + '-error' : undefined} onChange={event => set('sexAssignedAtBirth', event.target.value)}>
          <option value="" disabled>{copy.choose}</option>{sortSelectionOptions(PATIENT_SEX_VALUES.map(sexAssignedAtBirth => ({value: sexAssignedAtBirth, label: copy[sexAssignedAtBirth]})), {locale}).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </GuestSingleSelect>
      </div>
    </div>
    <div className="guest-signup-row guest-signup-contact">{field('zipCode', 'text', 'postal-code')}{field('email', 'email', 'email')}</div>
  </div>;
}
