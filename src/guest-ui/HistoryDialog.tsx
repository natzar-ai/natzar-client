// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import {GuestSingleSelect} from './GuestSingleSelect';
import {useEffect, useId, useRef, useState} from 'react';
import {formatPhoneNumberIntl} from 'react-phone-number-input';
import type {GuestRequest, GuestResult, GuestSignup, GuestView} from '../contract/guest';
import {guestPhoneNumber} from './guest-phone';
import {smsLoginAllowed} from './login-policy';
import {GuestPhoneInput} from './PhoneInput';
import {historyCopy} from './history-copy';
import {loginCopy} from './login-copy';
import {revealWithin} from './form-focus';
import {RequiredMark} from './RequiredMark';
import {GuestDialog} from './GuestDialog';
import {guestCopy} from './copy';
import {guestConsentCopy} from './consent-copy';
import {SignupFields} from './SignupFields';
import {signupCopy} from './signup-copy';
import {GuestSignupError, normalizeGuestSignup} from './guest-signup';

import type {HistoryAction} from './history-actions';

/** An optional, contained dialog. The website outside the chat remains usable. */
export function HistoryDialog({open, history, locale, busy, awaitingReply = false, onRequest, onClose, onSwitchToLogin, onSwitchToSignup, purpose = 'history', initialPhone, phoneLocked = false, country = 'US', initialProfile, clinicName = '', privacyUrl, termsUrl}: {
  open: boolean; history: NonNullable<GuestView['history']> & Pick<NonNullable<GuestView['login']>, 'signupVerification'>; locale: string; busy: boolean;
  onRequest(action: HistoryAction, input: Omit<GuestRequest, 'action' | 'credential'>): Promise<GuestResult>; onClose(): void;
  onSwitchToLogin?(): void;
  onSwitchToSignup?(phone: string): void;
  awaitingReply?: boolean;
  purpose?: 'history' | 'login' | 'signup' | 'care';
  initialProfile?: Partial<GuestSignup>; clinicName?: string; privacyUrl?: string; termsUrl?: string; country?: 'US' | 'CA';
  initialPhone?: string;
  phoneLocked?: boolean;
}) {
  const requestBusy = busy || awaitingReply;
  const isSignup = purpose === 'signup';
  const isProfile = purpose === 'signup' || purpose === 'care';
  const careCopy = guestCopy(locale), consents = guestConsentCopy(locale);
  const login = loginCopy(locale);
  const brand = (text: string) => text.replace(/\{\{brand\}\}/g, () => clinicName);
  const copy = purpose === 'care' ? {...signupCopy(locale), title: careCopy.details, why: careCopy.detailsBody, send: careCopy.next} : isSignup ? signupCopy(locale) : purpose === 'login' ? login : historyCopy(locale), id = useId();
  const [signup, setSignup] = useState<Partial<GuestSignup>>({...initialProfile, email: initialProfile?.email ?? ''}), [invalidSignup, setInvalidSignup] = useState<keyof GuestSignup>();
  const [calendarOpen, setCalendarOpen] = useState(false), [healthConsent, setHealthConsent] = useState(false), [messagingConsent, setMessagingConsent] = useState(false);
  const [submittedSignup, setSubmittedSignup] = useState<{profile: GuestSignup; messagingConsent: boolean}>();
  const panel = useRef<HTMLDivElement>(null), scroll = useRef<HTMLDivElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const phoneField = useRef<HTMLInputElement>(null), codeField = useRef<HTMLInputElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  const [phone, setPhone] = useState((isSignup ? initialPhone : history.verification?.phone ?? initialPhone) ?? '');
  const [code, setCode] = useState(''), [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState(false), [channel, setChannel] = useState<'sms' | 'whatsapp'>(history.verification?.channel ?? 'whatsapp');
  const [now, setNow] = useState(Date.now()), [retryAt, setRetryAt] = useState(0);
  const signupVerification = submittedSignup && history.signupVerification;
  const pending = isSignup ? signupVerification && {...signupVerification, phone} : history.verification;
  const appendCopy = historyCopy(locale);
  const step = history.saved ? 'saved' : history.appendConfirmation ? 'append' : pending && !editing ? 'code' : 'phone';
  const sharedVerification = step === 'code' && (isSignup || purpose === 'login');
  const verificationCopy = sharedVerification ? login : copy;
  const normalized = guestPhoneNumber(phone);
  const smsAllowed = !phone.trim() || !normalized && phone.trim().startsWith('+1') || !!normalized && smsLoginAllowed(normalized);
  const delivery = smsAllowed ? channel : 'whatsapp';
  const resendAt = Math.max(retryAt, pending ? Date.parse(pending.sentAt) + 60_000 : 0);
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const verificationPhone = pending?.phone ?? '';
  const displayPhone = formatPhoneNumberIntl(verificationPhone) || verificationPhone;
  const title = step === 'saved' ? copy.saved : step === 'append' ? appendCopy.appendTitle : step === 'code' ? verificationCopy.codeTitle : copy.title;
  const explanation = step === 'saved' ? copy.savedWhy : step === 'append' ? appendCopy.appendWhy
    : step !== 'code' ? copy.why
    : purpose === 'login' ? <>{login.conditionalCodeWhy.replace('{{phone}}', displayPhone)}{' '}
      <button type="button" className="guest-link" disabled={requestBusy} onClick={() => onSwitchToSignup?.(verificationPhone)}>
        {login.registerHere}
      </button>.</>
    : copy.codeWhy.replace('{{phone}}', isSignup ? displayPhone : verificationPhone.replace(/\d(?=\d{4})/g, '•'));

  function focus(element: HTMLElement | null) {element?.focus({preventScroll: true}); revealWithin(scroll.current, element, 10);}
  useEffect(() => {
    if (!open) return;
    if (!phone && initialPhone) setPhone(initialPhone);
    const node = panel.current, root = node?.getRootNode() as Document | ShadowRoot | undefined;
    const active = root?.activeElement ?? node?.ownerDocument.activeElement;
    previous.current = active instanceof HTMLElement ? active : null;
    setError(''); setNow(Date.now()); heading.current?.focus({preventScroll: true});
    return () => {if (previous.current?.isConnected) previous.current.focus({preventScroll: true});};
    // Preserve an unfinished entry while the server updates the challenge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open || step !== 'code') return;
    focus(codeField.current);
  }, [open, step, pending?.sentAt]);
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer);
  }, [open]);
  useEffect(() => {if (!open || step !== 'phone') {setPickerOpen(false); setCalendarOpen(false);}}, [open, step]);
  useEffect(() => {if (open && (step === 'saved' || step === 'append')) heading.current?.focus({preventScroll: true});}, [open, step]);

  async function send(resend = false) {
    if (requestBusy || remaining) return;
    const value = resend ? pending?.phone : guestPhoneNumber(phone);
    let profile: GuestSignup | undefined;
    if (isProfile) {
      try {profile = normalizeGuestSignup(signup, country); setInvalidSignup(undefined);}
      catch (error) {
        if (!(error instanceof GuestSignupError)) throw error;
        setInvalidSignup(error.field);
        const text = signupCopy(locale);
        setError(error.field === 'zipCode' || error.field === 'email' ? '' : error.field === 'birthdate' ? text.invalidDate : text.invalid);
        focus(panel.current?.querySelector<HTMLElement>('[name="' + error.field + '"]') ?? null);
        return;
      }
    }
    if (isProfile && !healthConsent) {setError(consents.required); focus(panel.current?.querySelector<HTMLInputElement>('[data-health-consent]') ?? null); return;}
    if (!value) {setError(copy.invalidPhone); focus(phoneField.current); return;}
    setError('');
    const result = await onRequest('sendHistoryCode', {phone: value, verificationChannel: resend ? pending?.channel : delivery, consent: true, ...(profile ? {signup: profile} : {}), ...(isProfile ? {healthConsent, messagingConsent} : {})});
    setNow(Date.now());
    if (result.ok) {
      setPhone(value); setCode(''); setEditing(false);
      if (isSignup && profile) setSubmittedSignup({profile, messagingConsent});
    }
    else {
      if (result.retryAfterSeconds) setRetryAt(Date.now() + result.retryAfterSeconds * 1000);
      setError(result.error === 'invalid_phone' ? copy.invalidPhone : result.error === 'verification_delivery_failed' ? copy.delivery
        : result.error === 'rate_limited' ? copy.limited : copy.failed);
    }
  }
  async function verify() {
    if (requestBusy || code.length !== 6) return;
    setError('');
    const result = await onRequest('verifyHistoryCode', {code,
      ...(isSignup && submittedSignup ? {phone: pending?.phone, signup: submittedSignup.profile,
        healthConsent: true, messagingConsent: submittedSignup.messagingConsent} : {})});
    if (!result.ok && result.error === 'signup_details_changed' && isSignup) {
      setEditing(true); setSubmittedSignup(undefined); setCode(''); setError(copy.expiredCode); return;
    }
    if (!result.ok && result.error === 'email_already_associated' && isProfile) {setInvalidSignup('email'); setEditing(true); setError(signupCopy(locale).emailTaken); return;}
    if (!result.ok) {setError(result.error === 'account_clinic_mismatch' ? copy.clinicMismatch : result.error === 'code_expired' ? copy.expiredCode : /code|verification/.test(result.error) ? copy.invalidCode : copy.failed); focus(codeField.current);}
  }

  async function changeNumber() {
    if (requestBusy) return;
    if (sharedVerification) {
      const result = await onRequest('cancelLoginCode', {});
      if (!result.ok) {setError(copy.failed); return;}
    }
    setPhone(pending?.phone ?? phone);
    setEditing(true); setSubmittedSignup(undefined); setCode(''); setError(''); setRetryAt(0);
    requestAnimationFrame(() => focus(phoneField.current));
  }

  async function resolveHistory(action: 'appendHistory' | 'deleteHistory' | 'declineHistory') {
    if (requestBusy) return;
    setError('');
    const result = await onRequest(action, {});
    if (!result.ok && result.error === 'email_already_associated' && isProfile) {setInvalidSignup('email'); setEditing(true); setError(signupCopy(locale).emailTaken); return;}
    if (!result.ok) setError(result.error === 'code_expired' ? copy.expiredCode : copy.failed);
  }

  if (!open) return null;
  const blocked = pickerOpen || calendarOpen;
  const formError = error && invalidSignup !== 'email' && <p className="guest-history-error" id={id + '-error'} role="alert">{error}</p>;
  const symbol = step === 'saved'
    ? <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m5 12 4 4L19 6"/></svg>
    : purpose !== 'history' ? <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg>
    : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 3h12v18l-6-4-6 4V3Z"/></svg>;
  return <GuestDialog id={id} purpose={sharedVerification ? 'login' : isProfile ? 'signup' : purpose} step={step} title={title} why={explanation} fitWhy={isSignup && step === 'phone'} closeLabel={copy.close} onClose={step === 'append' ? () => void resolveHistory('declineHistory') : onClose}
    panel={panel} scroll={scroll} heading={heading} blocked={blocked} symbol={symbol}
    footer={isProfile && step === 'phone' && <div className="guest-signup-footer" inert={blocked} aria-hidden={blocked || undefined}>
      <button type="submit" form={id + '-form'} className="guest-history-primary" disabled={requestBusy || remaining > 0}>{careCopy.next}{remaining > 0 && ' (' + remaining + 's)'}</button>
    </div>}>
    {step === 'phone' && onSwitchToLogin && <p className="guest-signup-login">
      {signupCopy(locale).existingAccount}{' '}
      <button type="button" className="guest-link" onClick={onSwitchToLogin}>{loginCopy(locale).action}</button>
    </p>}
    {step === 'phone' && <form id={id + '-form'} noValidate onSubmit={event => {event.preventDefault(); void send();}}>
      {isProfile && <SignupFields id={id} values={signup} onChange={(field, value) => {setSignup(previous => ({...previous, [field]: value})); setInvalidSignup(undefined); setError('');}} country={country} locale={locale} invalid={invalidSignup} busy={busy}
        container={() => panel.current} onCalendarOpen={setCalendarOpen} emailError={invalidSignup === 'email' && error ? error : undefined}/>}
      <label htmlFor={id + '-phone'}>{copy.phone}<RequiredMark/></label>
      <div className={isProfile ? 'guest-phone-delivery' : undefined}>
        <GuestPhoneInput ref={phoneField} id={id + '-phone'} value={phone} locale={locale} disabled={busy} readOnly={phoneLocked} invalid={!!error && !invalidSignup && !normalized} describedBy={error && !invalidSignup && !normalized ? id + '-error' : undefined}
          onChange={value => {setPhone(value); setError(''); setRetryAt(0);}} pickerOpen={pickerOpen} onPickerOpen={setPickerOpen} container={() => panel.current}/>
        <div className={isProfile ? 'guest-delivery-inline' : 'guest-delivery-full'}>
          <GuestSingleSelect compact={isProfile} className="guest-delivery-select" aria-label={copy.send} value={delivery} disabled={busy || !smsAllowed} onChange={event => setChannel(event.target.value as 'sms' | 'whatsapp')}>
            <option value="whatsapp">{copy.whatsapp}</option>{smsAllowed && <option value="sms">{copy.sms}</option>}
          </GuestSingleSelect>
        </div>
      </div>
      {isProfile && error !== consents.required && formError}
      {isProfile && <div className="guest-profile-consents">
        <label className="guest-check"><input data-health-consent type="checkbox" disabled={busy} required aria-invalid={!healthConsent && error === consents.required || undefined} aria-describedby={!healthConsent && error === consents.required ? id + '-error' : undefined} checked={healthConsent} onChange={event => setHealthConsent(event.target.checked)}/><span>{brand(consents.health)}<RequiredMark/></span></label>
        {error === consents.required && formError}
        <label className="guest-check"><input data-messaging-consent type="checkbox" disabled={busy} checked={messagingConsent} onChange={event => setMessagingConsent(event.target.checked)}/><span>{brand(consents.messaging)}</span></label>
        {(privacyUrl || termsUrl) && <p className="guest-hint guest-profile-links">{privacyUrl && <a href={privacyUrl} target="_blank" rel="noopener noreferrer">{consents.privacy}</a>}{privacyUrl && termsUrl && ' · '}{termsUrl && <a href={termsUrl} target="_blank" rel="noopener noreferrer">{consents.terms}</a>}</p>}
      </div>}
      {!isProfile && formError}
      {!isProfile && <button type="submit" className="guest-history-primary" disabled={requestBusy || remaining > 0}>{copy.send}{remaining > 0 && ' (' + remaining + 's)'}</button>}
    </form>}
    {step === 'code' && <form noValidate onSubmit={event => {event.preventDefault(); void verify();}}>
      <label htmlFor={id + '-code'}>{copy.code}<RequiredMark/></label>
      <input ref={codeField} id={id + '-code'} aria-label={copy.code} className="guest-history-code" type="text" inputMode="numeric" autoComplete="one-time-code" required maxLength={6} pattern="[0-9]{6}" value={code} disabled={busy} aria-invalid={!!error || undefined} aria-describedby={error ? id + '-error' : undefined}
        onChange={event => {setCode(event.target.value.replace(/\D/g, '')); setError('');}}/>
      {error && <p className="guest-history-error" id={id + '-error'} role="alert">{error}</p>}
      <button type="submit" className="guest-history-primary" disabled={requestBusy || code.length !== 6}>{verificationCopy.verify}</button>
      <div className="guest-history-code-actions"><button type="button" disabled={requestBusy || remaining > 0} onClick={() => void send(true)}>{remaining ? copy.resendIn.replace('{{seconds}}', String(remaining)) : copy.resend}</button>
        <button type="button" disabled={requestBusy} onClick={() => void changeNumber()}>{copy.change}</button></div>
    </form>}
    {step === 'append' && <>
      {error && <p className="guest-history-error" role="alert">{error}</p>}
      <button type="button" className="guest-history-primary" disabled={requestBusy} onClick={() => void resolveHistory('appendHistory')}>{appendCopy.appendYes}</button>
      <button type="button" className="guest-history-later" disabled={requestBusy} onClick={() => void resolveHistory('deleteHistory')}>{appendCopy.appendDelete}</button>
      <button type="button" className="guest-history-later" disabled={requestBusy} onClick={() => void resolveHistory('declineHistory')}>{appendCopy.appendNo}</button>
    </>}
    {step === 'saved' ? <button type="button" className="guest-history-primary" onClick={onClose}>{copy.continue}</button>
      : step !== 'append' && (!isProfile || sharedVerification) && <button type="button" className="guest-history-later" onClick={onClose}>{copy.notNow}</button>}
  </GuestDialog>;
}
