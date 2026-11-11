// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import {AgentThread, AgentWelcome} from './AgentWelcome';
import {ChatComposer, MAX_UPLOAD_BYTES} from './ChatComposer';
import {LinkActionRow, LinkPrimaryButton} from './LinkPrimaryButton';
import {chatCopy} from './chat-copy';
import {GuestSingleSelect} from './GuestSingleSelect';
import {useCallback, useEffect, useRef, useState} from 'react';
import type {GuestClient} from '../guest/index';
import type {GuestAccount, GuestAction, GuestCareOffer, GuestIdentity, GuestRequest, GuestResult, GuestView, GuestMessage} from '../contract/guest';
import {guestCopy} from './copy';
import {GuestCareOptions} from './GuestCareOptions';
import {guestStyles} from './styles';
import {IdentityForm} from './IdentityForm';
import {QuickIntake} from './QuickIntake';
import {GuestCheckout} from './GuestCheckout';
import {GuestOverlay} from './GuestOverlay';
import {smsLoginAllowed} from './login-policy';
import {renderEmphasis} from './emphasis';
import {createFillTracker} from './frame-fill';
import {focusFormField} from './form-focus';
import {HistoryDialog} from './HistoryDialog';
import {isHistoryConfirmation, type HistoryAction} from './history-actions';
import {loginCopy} from './login-copy';
import {GuestAccountFrame} from './GuestAccountFrame';
import {signupCopy} from './signup-copy';

const fillTrackers = new WeakMap<Window, ReturnType<typeof createFillTracker>>();
const inPersonCare = {modality: 'inPerson', mode: 'book'} as const;

export interface GuestJourneyProps {
  client: GuestClient; locale?: string; clinicName?: string;
  initialCareOfferId?: string;
  getAccountToken?: () => Promise<string | null>;
  onSignIn?: () => void;
  onReady?: (care: NonNullable<GuestView['care']>) => void;
}

function safeGuestNavigation(value?: string): string | null {
  if (!value) return null;
  try {const url = new URL(value, typeof location === 'undefined' ? 'https://natzar.ai' : location.href); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;} catch {return null;}
}

function safeClinicContact(value?: string): string | null {
  return value && /^tel:\+[1-9]\d{6,14}$/.test(value) ? value : safeGuestNavigation(value);
}

export function GuestJourney({client, locale = 'en', clinicName, initialCareOfferId, getAccountToken, onSignIn, onReady}: GuestJourneyProps) {
  const clientOwner = useRef(client), mounted = useRef(true), restoredClient = useRef<GuestClient | null>(null);
  const initialCareOffer = useRef(initialCareOfferId);
  clientOwner.current = client;
  const isCurrentClient = useCallback(() => mounted.current && clientOwner.current === client, [client]);
  const copy = guestCopy(locale);
  const chatLabels = chatCopy(locale);
  const [view, setView] = useState<GuestView | null>(null);
  const [saved, setSaved] = useState(() => client.hasSavedJourney());
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [surface, setSurface] = useState<'welcome' | 'chat'>();
  const [sending, setSending] = useState(false);
  const [outgoing, setOutgoing] = useState<{id: string; text: string; sentAt: string; fileName?: string} | null>(null);
  const [code, setCode] = useState('');
  const [channel, setChannel] = useState<'sms' | 'whatsapp'>('whatsapp');
  const [codeSent, setCodeSent] = useState(false);
  const [consent, setConsent] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false), [account, setAccount] = useState<GuestAccount | null>(null);
  const [authPurpose, setAuthPurpose] = useState<'login' | 'signup'>('login');
  const loginLabels = loginCopy(locale);
  const accountExpired = useCallback(() => {
    client.forgetAccount?.(); setAccount(null); setProfileOpen(false); setAuthPurpose('login'); setLoginOpen(true);
    void client.request('state').then(result => {
      if (!isCurrentClient()) return;
      if (result.ok) setView(result.journey);
      else if (result.error === 'session_expired') {client.forget(); setView(null); setSaved(false); setError(copy.expired);}
    }).catch(() => {});
  }, [client, copy.expired, isCurrentClient]);
  const historyAttempted = useRef<string | null>(null), restoreHistoryFocus = useRef(false), historyDismissals = useRef(0);
  const live = useRef({id: '', phase: '' as string, text: '', open: false});
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const careOffer: GuestCareOffer | undefined = view?.careOffer ?? (view?.inPersonBooking ? {...view.inPersonBooking, care: inPersonCare} : undefined);
  const offerDeadline = careOffer ? Date.parse(careOffer.expiresAt) : undefined;
  useEffect(() => {
    if (offerDeadline === undefined) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, offerDeadline - Date.now()));
    return () => clearTimeout(timer);
  }, [offerDeadline]);
  const locked = useRef(false);
  const pendingMessage = useRef<{text: string; requestId: string} | null>(null);
  const pendingFile = useRef<File | null>(null);
  const stagedAttachment = useRef<GuestRequest['attachment']>(undefined);
  const frame = useRef<HTMLElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const pendingAction = useRef<HTMLButtonElement>(null);
  const surfaceWasOpen = useRef(false);
  const ready = useRef<string | null>(null);
  const phase = view?.phase;
  const loginDialogOpen = loginOpen || !!view?.login?.appendConfirmation;
  const historyDialogOpen = historyOpen || !!view?.history?.appendConfirmation;
  live.current = {id: view?.id ?? '', phase: phase ?? '', text, open: historyDialogOpen || loginDialogOpen};
  const messagePending = !!view?.pendingMessage;
  const pendingRetryAt = view?.pendingMessage ? Date.parse(view.pendingMessage.startedAt) + 120_000 : undefined;
  useEffect(() => {
    if (pendingRetryAt === undefined) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, pendingRetryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [pendingRetryAt]);
  const userMessageCount = view?.messages.filter(message => message.role === 'user').length ?? 0;
  function closeHistory() {historyDismissals.current++; restoreHistoryFocus.current = true; setHistoryOpen(false);}
  async function historyRequest(action: HistoryAction | 'offerHistory', input: Omit<GuestRequest, 'action' | 'credential'> = {}): Promise<GuestResult> {
    if (locked.current || messagePending) return {ok: false, error: 'journey_busy'};
    const id = view?.id, dismissal = historyDismissals.current;
    locked.current = true; setBusy(true);
    try {
      const result = await client.request(action, input);
      if (!isCurrentClient()) return {ok: false, error: 'request_superseded'};
      if (result.ok) {
        if (action === 'offerHistory' && input.consent !== true && dismissal === historyDismissals.current && live.current.id === id && live.current.phase === 'chat' && !live.current.text.trim() && !live.current.open) showAuth('signup');
        accept(result);
        if (action === 'declineHistory') closeHistory();
        if (action === 'deleteHistory') clearDraftInput();
        if ((action === 'verifyHistoryCode' || isHistoryConfirmation(action)) && result.account) setHistoryOpen(false);
      } else if (isHistoryConfirmation(action) && result.error === 'code_expired') {
        const cleared = await client.request('declineHistory');
        if (cleared.ok) {setHistoryOpen(true); accept(cleared);}
      }
      return result;
    } catch {return {ok: false, error: 'service_unavailable'};}
    finally {if (isCurrentClient()) {locked.current = false; setBusy(false);}}
  }
  useEffect(() => {
    if (historyOpen || loginOpen || account || busy || messagePending || text.trim() || !view?.history?.canOffer || historyAttempted.current === view.id) return;
    const id = view.id;
    const timer = setTimeout(() => {
      if (locked.current || live.current.id !== id || live.current.text.trim() || live.current.phase !== 'chat' || live.current.open || document.visibilityState === 'hidden') return;
      historyAttempted.current = id;
      void historyRequest('offerHistory');
    }, 2400);
    return () => clearTimeout(timer);
    // The same client and current refs are used when the quiet period ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, messagePending, historyOpen, loginOpen, account, text, view?.id, view?.history?.canOffer]);
  useEffect(() => {
    if (!historyOpen && !busy && restoreHistoryFocus.current) {
      restoreHistoryFocus.current = false; composer.current?.focus({preventScroll: true});
    }
  }, [historyOpen, busy]);
  useEffect(() => {if (historyOpen && (view?.guestEnabled === false || phase !== 'chat')) closeHistory();}, [phase, historyOpen, view?.guestEnabled]);
  useEffect(() => {
    if (error && overlayOpen) focusFormField(frame.current?.querySelector<HTMLElement>('.guest-overlay[data-open="true"] [role="alert"]') ?? null);
  }, [error, overlayOpen]);
  const messageCount = view?.messages.length ?? 0;
  useEffect(() => {
    const element = frame.current, win = element?.ownerDocument.defaultView;
    if (!element || !win) return;
    let tracker = fillTrackers.get(win);
    if (!tracker) {tracker = createFillTracker(win); fillTrackers.set(win, tracker);}
    tracker.add(element);
    return () => tracker?.remove(element);
  }, []);
  function accept(result: GuestResult) {
    if (!isCurrentClient() || !result.ok && result.error === 'request_superseded') return false;
    if (result.ok) {
      setView(result.journey); setSaved(client.hasSavedJourney());
      setAccount(result.account ?? client.account?.() ?? null);
      if (result.journey.care && ready.current !== result.journey.care.id) {ready.current = result.journey.care.id; onReady?.(result.journey.care);}
      return true;
    }
    const code = result.error;
    if (code === 'guest_disabled' || code === 'clinic_disabled') setView(previous => previous && {...previous, guestEnabled: false,
      pendingMessage: undefined, recommendedCare: undefined, offers: []});
    if (result.retryAfterSeconds) setRetryAt(Date.now() + result.retryAfterSeconds * 1000);
    setError(code === 'account_clinic_mismatch' ? copy.accountMismatch
      : /disabled|not_available|origin_not_allowed|clinic_unknown/.test(code) ? copy.unavailable
      : /expired|session_invalid|session_not_found/.test(code) ? copy.expired
      : /invalid_code|code_invalid|code_expired|verification_failed/.test(code) ? copy.invalidCode
      : /rate_limit|cooldown/.test(code) ? copy.limited
      : /invalid|incomplete|eligib/.test(code) ? copy.invalid : copy.failed);
    return false;
  }
  async function request(action: GuestAction, input?: Omit<GuestRequest, 'action' | 'credential'>) {
    if (locked.current || messagePending && !['state', 'logout', 'begin'].includes(action)) return false;
    locked.current = true; setBusy(true); setError(''); setNotice('');
    try {
      let result = await client.request(action, input);
      if (!isCurrentClient() || !result.ok && result.error === 'request_superseded') return false;
      if (action === 'profileIntake' && !result.ok && result.error === 'account_expired') {accountExpired(); return false;}
      if (action === 'state' && !result.ok && /^(session_expired|session_invalid|session_not_found)$/.test(result.error)) {client.forget(); setSaved(false); setAccount(null);}
      if ((action === 'chooseCare' || action === 'checkout') && !result.ok && ['care_route_required', 'care_not_available'].includes(result.error)) {
        const current = await client.request('state').catch(() => null);
        if (!isCurrentClient()) return false;
        if (current?.ok) accept(current);
        else setView(previous => previous && {...previous, recommendedCare: undefined,
          careOffer: previous.careOffer && {...previous.careOffer, available: false},
          inPersonBooking: previous.inPersonBooking && {...previous.inPersonBooking, available: false}});
        if (!current?.ok || (userMessageCount > 0 && !current.journey.recommendedCare)) {
          setOverlayOpen(false);
          setSurface('chat');
        }
        setError(copy.careRouteChanged);
        return false;
      }
      // A return can carry a cached pending view after Stripe has already
      // completed. Refresh server proof before mounting that checkout again.
      if (action === 'state' && result.ok && result.journey.phase === 'payment') result = await client.request('paymentStatus');
      if (!isCurrentClient()) return false;
      // A clinical follow-up belongs in the conversation. Keep the unfinished
      // form available without covering the question the patient needs to answer.
      if (result.ok && ((action === 'checkout' && result.journey.phase === 'offer') || (action === 'complete' && result.journey.phase === 'intake'))) {
        setOverlayOpen(false);
        setSurface('chat');
      }
      if (result.ok && action === 'chooseCare' && ['identity', 'verification', 'account', 'offer'].includes(result.journey.phase)) setOverlayOpen(true);
      if (result.ok && action === 'complete' && result.journey.phase === 'ready') {
        setSurface(result.journey.careOffer?.care.mode === 'book' || result.journey.inPersonBooking ? 'chat' : 'welcome');
      }
      return accept(result);
    }
    catch {if (isCurrentClient()) setError(copy.failed); return false;}
    finally {if (isCurrentClient()) {locked.current = false; setBusy(false);}}
  }
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = client.subscribe?.(journey => {
      if (!isCurrentClient()) return;
      setView(journey); setSaved(client.hasSavedJourney()); setAccount(client.account?.() ?? null);
      if (journey.pendingMessage) {setSurface('chat'); setOverlayOpen(false); setPaymentOpen(false);}
    });
    if (restoredClient.current !== client) {
      restoredClient.current = client; locked.current = false; ready.current = null;
      pendingMessage.current = null; pendingFile.current = null; stagedAttachment.current = undefined;
      setView(null); setOutgoing(null); setText(''); setFile(null); setSending(false); setError('');
      setSurface(undefined); setOverlayOpen(false); setPaymentOpen(false); setHistoryOpen(false); setLoginOpen(false);
      setSaved(client.hasSavedJourney()); setAccount(client.account?.() ?? null);
    }
    void request(client.hasSavedJourney() ? 'state' : 'begin');
    return () => {mounted.current = false; unsubscribe?.();};
    // One restore per client; the lock also handles StrictMode's effect replay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);
  useEffect(() => {
    setOverlayOpen(!messagePending && (phase === 'account' || (!!phase && view?.guestEnabled !== false && !['refunded', 'refund_pending', 'refund_failed'].includes(view?.payment?.status ?? '') && ['identity', 'verification', 'offer', 'intake'].includes(phase))));
    setPaymentOpen(!messagePending && phase === 'payment' && !['failed', 'refunded', 'refund_pending', 'refund_failed'].includes(view?.payment?.status ?? ''));
  }, [phase, messagePending, view?.guestEnabled, view?.payment?.status]);
  useEffect(() => {
    const offerId = initialCareOffer.current;
    if (!offerId || !view || busy || messagePending) return;
    initialCareOffer.current = undefined;
    if (view.phase !== 'chat') return;
    if (view.careOfferLink?.messageId !== offerId) {
      setError(copy.careRouteChanged);
      setSurface('chat');
      return;
    }
    void request('chooseCare', {careOfferId: offerId, accountCredential: client.account?.()?.credential});
    // Consume the opened link once, after restoring the authenticated journey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, view, busy, messagePending]);
  useEffect(() => {
    if (!retryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [retryAt]);
  const pending = (phase === 'payment' && view?.payment?.status === 'pending') || view?.payment?.status === 'refund_pending';
  useEffect(() => {
    if (!pending || messagePending) return;
    const timer = setInterval(() => {if (!locked.current) void request('paymentStatus');}, 5000);
    return () => clearInterval(timer);
    // request reads the same stable client; polling stops as soon as phase changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, messagePending, client]);
  const price = (amount: number, currency: string) => {try {return new Intl.NumberFormat(locale.replace('_', '-'), {style: 'currency', currency}).format(amount / 100);} catch {return `${(amount / 100).toFixed(2)} ${currency}`;}};
  const titles = {chat: copy.title, identity: copy.details, verification: copy.verifyTitle, account: copy.accountTitle, offer: copy.offerTitle, payment: copy.paymentTitle, intake: copy.intakeTitle, ready: copy.readyTitle};
  const signIn = safeGuestNavigation(view?.signInUrl);
  const returnsToGuest = !!signIn && new URL(signIn).searchParams.get('guestReturn') === '1';
  const externalAccount = returnsToGuest && !!signIn && typeof location !== 'undefined' && new URL(signIn).origin !== location.origin;
  const accountUrl = externalAccount && signIn ? client.handoffUrl(new URL('/guest', signIn).href) : signIn;
  const care = safeGuestNavigation(view?.care?.url);
  const remaining = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const chosenOffer = view?.offers.find(offer => offer.modality === view.choice?.modality && offer.mode === view.choice.mode);
  const quotedAmount = chosenOffer?.amountCents ?? view?.payment?.amountCents ?? 0;
  const quotedCurrency = chosenOffer?.currency ?? view?.payment?.currency ?? 'USD';
  const guestActive = view?.guestEnabled !== false;
  const offerSelected = !!careOffer && view?.choice?.modality === careOffer.care.modality && view.choice.mode === careOffer.care.mode;
  const resumeOfferPayment = offerSelected && phase === 'payment' && view?.payment?.status === 'pending';
  const offerExpired = offerDeadline !== undefined && offerDeadline <= now;
  const offerAvailable = guestActive && !!careOffer?.available && !offerExpired;
  const completedBooking = offerSelected && careOffer.care.mode === 'book' && phase === 'ready' ? care : null;
  const showWelcome = !guestActive || surface === 'welcome' || (surface === undefined &&
    (userMessageCount === 0 || (!!view?.payment || phase === 'ready') && !completedBooking && !(offerAvailable && resumeOfferPayment)));
  const refunded = view?.payment?.status === 'refunded';
  const refundPending = view?.payment?.status === 'refund_pending';
  const refundFailed = view?.payment?.status === 'refund_failed';
  const formPhase = phase === 'account' || (!!phase && ['identity', 'verification', 'offer', 'intake'].includes(phase) && !refunded && !refundPending && !refundFailed);
  const formVisible = phase !== 'identity' && (guestActive || phase === 'account') && formPhase && overlayOpen;
  useEffect(() => {
    if (!formVisible) thread.current?.scrollTo({top: showWelcome ? 0 : thread.current.scrollHeight, behavior: 'auto'});
  }, [messageCount, outgoing, phase, formVisible, showWelcome]);
  const choiceUnlocked = !messagePending && guestActive && !!view && !view.care && ['chat', 'identity', 'verification', 'offer', 'payment'].includes(view.phase)
    && (!view.payment || ['failed', 'refunded'].includes(view.payment.status));
  const resumeOfferForm = offerSelected && formPhase && phase !== 'intake';
  const offerActionable = !messagePending && offerAvailable && (choiceUnlocked || resumeOfferForm || resumeOfferPayment);
  async function openCareOffer(messageId: string) {
    if (locked.current || !careOffer || careOffer.messageId !== messageId) return false;
    if (completedBooking) {window.location.assign(completedBooking); return true;}
    if (!offerActionable || (offerDeadline !== undefined && Date.now() >= offerDeadline)) return false;
    if (resumeOfferPayment) setPaymentOpen(true);
    else if (resumeOfferForm) setOverlayOpen(true);
    else {
      setConsent(false);
      return request('chooseCare', view?.careOfferLink?.messageId === messageId
        ? {careOfferId: messageId, accountCredential: account?.credential}
        : {choice: careOffer.care, offerMessageId: messageId});
    }
    return true;
  }
  useEffect(() => {
    const surfaceOpen = (formPhase && overlayOpen) || (phase === 'payment' && paymentOpen);
    const closed = surfaceWasOpen.current && !surfaceOpen;
    surfaceWasOpen.current = surfaceOpen;
    if (!closed) return;
    const animation = requestAnimationFrame(() => (pendingAction.current
      ?? thread.current?.querySelector<HTMLButtonElement>('.guest-message-action button:enabled')
      ?? frame.current?.querySelector<HTMLButtonElement>('.guest-offer[aria-pressed="true"]')
      ?? composer.current)?.focus({preventScroll: true}));
    return () => cancelAnimationFrame(animation);
  }, [formPhase, overlayOpen, paymentOpen, phase]);
  const smsAllowed = smsLoginAllowed(view?.identity?.phone ?? '');
  const verificationChannel = smsAllowed ? channel : 'whatsapp';
  useEffect(() => {if (phase === 'offer') setConsent(false);}, [phase, view?.payment?.status, quotedAmount, quotedCurrency]);
  async function sendMessage() {
    const value = text.trim();
    if ((!value && !file) || locked.current || messagePending) return;
    if (file && file.size > MAX_UPLOAD_BYTES) {setError(chatLabels.chat.fileTooLarge); return;}
    const selectedFile = file;
    if (pendingMessage.current?.text !== value || pendingFile.current !== selectedFile) {
      pendingMessage.current = {text: value, requestId: crypto.randomUUID()};
      pendingFile.current = selectedFile;
      stagedAttachment.current = undefined;
    }
    const message = pendingMessage.current!;
    setSurface('chat');
    setOutgoing({id: message.requestId, text: value, sentAt: new Date().toISOString(), fileName: selectedFile?.name});
    locked.current = true; setBusy(true); setError('');
    setSending(true); setText(''); setFile(null);
    let sent = false;
    try {
      if (selectedFile && !stagedAttachment.current) {
        const result = await client.request('uploadAttachment', {file: {fileName: selectedFile.name, contentType: selectedFile.type || 'application/octet-stream', contentLength: selectedFile.size}});
        if (!accept(result) || !result.ok || !result.upload) {setOutgoing(null); return;}
        if (!isCurrentClient()) return;
        const uploaded = await fetch(result.upload.url, {method: 'PUT', body: selectedFile, headers: {'content-type': selectedFile.type || 'application/octet-stream'}});
        if (!isCurrentClient()) return;
        if (!uploaded.ok) throw new Error('upload_failed');
        stagedAttachment.current = result.upload.attachment;
      }
      const result = await client.request('message', {...message, ...(stagedAttachment.current ? {attachment: stagedAttachment.current} : {})});
      if (!isCurrentClient() || !result.ok && result.error === 'request_superseded') {sent = true; return;}
      const ok = accept(result);
      if (ok) {sent = true; pendingMessage.current = null; pendingFile.current = null; stagedAttachment.current = undefined;}
      setOutgoing(null);
    } catch {if (isCurrentClient()) {setError(chatLabels.chat.sendFailed); setOutgoing(null);}}
    finally {
      if (isCurrentClient()) {
        if (!sent) {setText(current => current || value); setFile(current => current ?? selectedFile);}
        locked.current = false; setBusy(false); setSending(false);
      }
    }
  }
  async function retryPendingReply() {
    const pending = view?.pendingMessage;
    if (!pending || !isCurrentClient() || restoredClient.current !== client || locked.current || busy || sending || Date.now() < Date.parse(pending.startedAt) + 120_000) return;
    const accepted = view.messages.find(message => message.id === pending.requestId && message.role === 'user' && message.sentAt === pending.startedAt);
    if (!accepted) return;
    // Retry the already accepted turn, never the patient's unsent draft. The
    // server validates this payload and reuses its stored task and nonce.
    locked.current = true; setBusy(true); setSending(true); setError('');
    try {accept(await client.request('message', {requestId: pending.requestId, text: accepted.text,
      ...(accepted.attachments?.[0] ? {attachment: accepted.attachments[0]} : {})}));}
    catch {if (isCurrentClient()) setError(chatLabels.chat.sendFailed);}
    finally {if (isCurrentClient()) {locked.current = false; setBusy(false); setSending(false);}}
  }
  function showAuth(purpose: 'login' | 'signup') {
    setHistoryOpen(false); setOverlayOpen(false); setAuthPurpose(purpose); setLoginOpen(true);
  }
  async function openLogin(purpose: 'login' | 'signup' = 'login') {
    if (busy || messagePending) return;
    if (!view && !await request(saved ? 'state' : 'begin')) return;
    if (isCurrentClient()) showAuth(purpose);
  }
  function clearDraftInput() {
    setText(''); setFile(null); pendingMessage.current = null; pendingFile.current = null; stagedAttachment.current = undefined;
  }
  async function loginRequest(action: HistoryAction, input: Omit<GuestRequest, 'action' | 'credential'>): Promise<GuestResult> {
    if (locked.current || messagePending) return {ok: false, error: 'journey_busy'};
    locked.current = true; setBusy(true);
    try {
      const result = await client.request(action === 'sendHistoryCode' ? 'sendLoginCode' : action === 'verifyHistoryCode' ? 'verifyLoginCode' : action, input);
      if (result.ok) {
        accept(result);
        if (action === 'deleteHistory') clearDraftInput();
        if (action === 'declineHistory' || result.account && (isHistoryConfirmation(action) || authPurpose === 'signup')) setLoginOpen(false);
      } else if (isHistoryConfirmation(action) && (result.error === 'code_expired' || result.error === 'email_already_associated' && authPurpose === 'signup')) {
        const cleared = await client.request('declineHistory');
        if (cleared.ok) {accept(cleared); setLoginOpen(true);}
      }
      return result;
    } catch {return {ok: false, error: 'service_unavailable'};}
    finally {if (isCurrentClient()) {locked.current = false; setBusy(false);}}
  }
  async function submitIdentity(identity: GuestIdentity, consents: {healthConsent: true; messagingConsent: boolean}, delivery?: 'sms' | 'whatsapp'): Promise<GuestResult> {
    if (locked.current || messagePending) return {ok: false, error: 'journey_busy'};
    locked.current = true; setBusy(true);
    try {const result = await client.request('identity', {identity, ...consents}); if (result.ok) {accept(result); if (delivery) setChannel(delivery);} return result;}
    catch {return {ok: false, error: 'service_unavailable'};}
    finally {if (isCurrentClient()) {locked.current = false; setBusy(false);}}
  }
  async function signOut() {
    if (await request('logout')) {client.forget(); setView(null); setSaved(false); setAccount(null); setLoginOpen(false); setSurface(undefined); await request('begin');}
  }
  const greeting = account?.firstName?.trim() ? copy.welcomeName.replace('{{name}}', () => account.firstName!.trim())
    : copy.welcomeClinic.replace('{{clinic}}', () => view?.clinicName || clinicName || copy.assistant);
  const signedInSurface = !!account && !loginDialogOpen && (!view?.choice || phase === 'ready' || !!careOffer && !view.payment);
  const profileIntake = signedInSurface && (!view?.choice || phase === 'ready') && guestActive && !view?.intake?.confirmed ? account?.profileIntake : undefined;
  const profileVisible = profileOpen && !!profileIntake;
  const accountCovered = profileVisible || (formPhase && overlayOpen) || paymentOpen;
  const recommendation = offerExpired ? undefined : view?.recommendedCare;
  const recommendedOffer = choiceUnlocked && recommendation &&
    (recommendation.modality !== view.choice?.modality || recommendation.mode !== view.choice?.mode)
    ? view.offers.find(offer => offer.modality === recommendation.modality && offer.mode === recommendation.mode) : undefined;
  const welcomeOffers = !choiceUnlocked ? [] : userMessageCount > 0 ? (recommendedOffer ? [recommendedOffer] : [])
    : view.offers.filter(offer => !refunded || offer.modality !== view.choice?.modality || offer.mode !== view.choice?.mode);
  const showEntry = showWelcome && (welcomeOffers.length > 0 || userMessageCount > 0);
  const pricedOffer = careOffer?.price ? price(careOffer.price.amountCents, careOffer.price.currency) : undefined;
  const offerLabel = completedBooking ? chatLabels.agent.linkBook : offerExpired ? chatLabels.agent.linkExpired
    : !offerActionable ? chatLabels.agent.linkUnavailable : careOffer?.care.mode === 'book' ? chatLabels.agent.linkBook
    : careOffer?.care.modality === 'async'
      ? pricedOffer ? chatLabels.agent.inviteAcceptPay.replace('{{amount}}', pricedOffer) : chatLabels.agent.inviteAccept
      : pricedOffer ? chatLabels.agent.linkJoinPay.replace('{{amount}}', pricedOffer) : chatLabels.agent.linkJoin;
  const messages: Array<GuestMessage & {fileName?: string}> = [...(view?.messages ?? []), ...(outgoing && !view?.messages.some(message => message.id === outgoing.id) ? [{...outgoing, role: 'user' as const}] : [])];
  return <section ref={frame} className="natzar-guest" data-guest-frame="" data-guest-phase={phase ?? (saved ? 'restoring' : 'welcome')} lang={locale.replace('_', '-')}>
    <style>{guestStyles}</style>
    {signedInSurface && <><header className="guest-header guest-header-login" inert={accountCovered}>
      {profileIntake && <button type="button" className="guest-signup-button" disabled={busy} onClick={() => {setError(''); setProfileOpen(true);}}>{copy.completeProfile}</button>}
      <span className="guest-brand">{greeting}</span><button type="button" className="guest-login-button" disabled={busy} onClick={() => void signOut()}>{loginLabels.signOut}</button></header>
      {phase === 'ready' && care && (!completedBooking || !view?.careOffer) && <aside className="guest-account-care"><a className="guest-step-action" href={care}>{copy.openCare}<span aria-hidden="true">↗</span></a></aside>}
      <GuestAccountFrame client={client} frameUrl={account!.frameUrl} locale={locale} onExpired={accountExpired} draft={text} onDraftChange={setText} inert={accountCovered}
        careOffer={!view?.care ? careOffer : undefined} onCareOffer={openCareOffer}/></>}
    <div className="guest-chat-surface" hidden={formVisible || signedInSurface} inert={formVisible || historyDialogOpen || loginOpen || phase === 'identity' && overlayOpen} aria-hidden={formVisible || historyDialogOpen || loginOpen || phase === 'identity' && overlayOpen || undefined}>
      <header className="guest-header guest-header-login" hidden={!view && !error}>
        {view && guestActive && !showWelcome && (recommendedOffer || view.choice || view.payment) ? <button type="button" className="guest-brand guest-welcome-link" aria-label={copy.welcomeScreen} disabled={busy} onClick={() => setSurface('welcome')}>{greeting}</button>
          : <span className="guest-brand">{greeting}</span>}<span className="guest-status">{copy.guest}</span>
        {!account && <button type="button" className="guest-signup-button" disabled={busy} onClick={() => void openLogin('signup')}>{signupCopy(locale).action}</button>}
        <button type="button" className="guest-login-button" disabled={busy} onClick={() => {if (account) void signOut(); else void openLogin();}}>{account ? loginLabels.signOut : loginLabels.action}</button>
      </header>
      <main className="guest-main">
        {!view ? error ? <div className="guest-recovery" aria-live="polite"><p role="alert">{error}</p>
          <button className="guest-secondary" disabled={busy || remaining > 0} onClick={() => void request(saved ? 'state' : 'begin')}>{copy.resume}</button>
        </div> : <div className="guest-loading" role="status" aria-live="polite" aria-busy="true" aria-label={copy.busy}>
          <span className="guest-loading-spinner" aria-hidden="true"/>
        </div> : <>
          <h1 className="guest-chat-title">{copy.assistant}</h1>
          <AgentThread className={guestActive ? 'guest-thread' : 'guest-recovery'} ref={thread} role={guestActive ? 'log' : undefined} aria-live="polite" aria-label={copy.guest} emergencyMessage={chatLabels.agent.urgent}>
            {!guestActive && <p className="guest-notice" role="status">{copy.disabledExisting}</p>}
            {guestActive && <>
              {showEntry ? <div className="guest-welcome-transition">
                <div className="guest-entry-welcome">
                  <h1>{copy.title}</h1><p className="guest-description">{copy.intro}</p>
                  <GuestCareOptions offers={welcomeOffers} choice={view.choice} busy={busy || sending || messagePending} freeLabel={copy.free}
                    messageClinicianLabel={copy.messageClinician} videoNowLabel={copy.videoNow} formatPrice={price}
                    onChoose={choice => {
                      setConsent(false);
                      void request('chooseCare', view.careOfferLink ? {careOfferId: view.careOfferLink.messageId, accountCredential: account?.credential} : {choice});
                    }}/>
                  <button className="guest-primary guest-text-agent" onClick={() => {setSurface('chat'); composer.current?.focus({preventScroll: true});}}>{userMessageCount > 0 ? copy.backChat : copy.textAgent}</button>
                </div>
              </div> : messages.map((message, index) => <div key={message.id} className="guest-message" data-role={message.role}
                data-run-end={messages[index + 1]?.role !== message.role}>{renderEmphasis(message.text)}
                {message.role === 'assistant' && message.clinicContactUrl && safeClinicContact(message.clinicContactUrl) &&
                  <a className="guest-message-file" href={safeClinicContact(message.clinicContactUrl) ?? undefined} target="_blank" rel="noopener noreferrer">{message.clinicContactUrl.replace(/^tel:/, '')}</a>}
                {'attachments' in message && message.attachments?.map(attachment => <a className="guest-message-file" key={attachment.key} href={safeGuestNavigation(attachment.url) ?? undefined} target="_blank" rel="noreferrer">{attachment.fileName}</a>)}
                {'fileName' in message && typeof message.fileName === 'string' && message.fileName && <span className="guest-message-file">{message.fileName}</span>}
                {message.role === 'assistant' && careOffer?.messageId === message.id && <LinkActionRow className="guest-message-action">
                  <LinkPrimaryButton label={offerLabel} busy={false} disabled={!(offerActionable || completedBooking) || busy}
                    onClick={() => void openCareOffer(message.id)}/>
                </LinkActionRow>}
                <time dateTime={message.sentAt}>{new Date(message.sentAt).toLocaleTimeString(locale.replace('_', '-'), {hour: '2-digit', minute: '2-digit'})}</time>
              </div>)}
              {!showEntry && !sending && !messagePending && recommendedOffer && !careOffer && <GuestCareOptions offers={[recommendedOffer]}
                busy={busy} freeLabel={copy.free} messageClinicianLabel={copy.messageClinician} videoNowLabel={copy.videoNow}
                formatPrice={price} onChoose={choice => {setConsent(false); void request('chooseCare', {choice});}}/>}
              {!showEntry && !messages.length && phase !== 'ready' && <AgentWelcome message={chatLabels.agent.empty}/>}
              {(sending || messagePending) && <div className="guest-typing" role="status" aria-label={copy.busy}><span/><span/><span/></div>}
              {messagePending && !busy && !sending && pendingRetryAt !== undefined && now >= pendingRetryAt && <div className="guest-pending-retry" role="status">
                <button type="button" className="guest-secondary" onClick={() => void retryPendingReply()}>{copy.retryMessage}</button>
              </div>}
            </>}
            {error && !overlayOpen && !paymentOpen && <p className="guest-error" role="alert">{error}{remaining > 0 && ` (${remaining}s)`}</p>}
            {notice && !overlayOpen && <p className="guest-notice" role="status">{notice}</p>}
            {showWelcome && (guestActive || phase === 'account') && formPhase && !overlayOpen && !welcomeOffers.length && <aside className="guest-pending-step">
              {phase === 'intake' && <p className="guest-hint">{copy.requiredBeforeCare}</p>}
              <button ref={pendingAction} className="guest-step-action" disabled={busy} onClick={() => setOverlayOpen(true)}>{titles[view.phase]}<span aria-hidden="true">↗</span></button>
            </aside>}
            {showWelcome && phase === 'payment' && !refunded && !refundPending && !refundFailed && <aside className="guest-pending-step">
              <p className="guest-hint">{view.payment?.status === 'failed' ? copy.paymentFailed : copy.paymentPending}</p>
              {guestActive && (view.payment?.status === 'failed'
                ? <button ref={pendingAction} className="guest-step-action" disabled={busy} onClick={() => void request('checkout', {consent: true})}>{copy.paymentRetry}<span aria-hidden="true">↗</span></button>
                : <button ref={pendingAction} className="guest-step-action" disabled={busy} onClick={() => setPaymentOpen(true)}>{copy.openCheckout}<span aria-hidden="true">↗</span></button>)}
              <button className="guest-link" disabled={busy} onClick={() => void request('paymentStatus')}>{copy.checkPayment}</button>
            </aside>}
            {showWelcome && (refunded || refundPending || refundFailed) && <aside className="guest-pending-step">
              <p className="guest-notice" role="status">{refunded ? copy.refunded : refundFailed ? copy.refundFailed : copy.refundPending}</p>
              {(refundPending || refundFailed) && <button className="guest-link" disabled={busy} onClick={() => void request('paymentStatus')}>{copy.refundCheck}</button>}
            </aside>}
            {showWelcome && phase === 'ready' && <aside className="guest-pending-step"><p className="guest-description">{copy.readyBody}</p>
              {care ? <a className="guest-primary" href={care}>{copy.openCare}</a> : <button className="guest-primary" disabled={busy} onClick={() => void request('complete')}>{busy ? copy.busy : copy.complete}</button>}
            </aside>}
          </AgentThread>
          {guestActive && <ChatComposer draft={text} onDraft={setText} file={file} onFile={setFile} busy={busy || sending || messagePending}
            labels={chatLabels.chat} inputRef={composer} maxLength={2000} placeholder={chatLabels.agent.placeholder}
            onFocus={() => setSurface('chat')} onBlur={() => {
              if (userMessageCount === 0 && !pendingMessage.current) setSurface(current => current === 'chat' ? undefined : current);
            }} onSend={() => void sendMessage()}/>}

        </>}
      </main>
    </div>
    {view?.history && phase === 'chat' && <HistoryDialog open={historyDialogOpen && !loginDialogOpen} history={view.history} locale={locale} busy={busy}
      onRequest={historyRequest} onClose={closeHistory}/>}
    {view && <HistoryDialog key={authPurpose} purpose={authPurpose} country={view.country} open={loginDialogOpen} history={{saved: !!account, offered: true, canOffer: false, canSave: true, ...view.login}} locale={locale} busy={busy}
      clinicName={view.clinicName} privacyUrl={safeGuestNavigation(view.privacyUrl) ?? undefined} termsUrl={safeGuestNavigation(view.termsUrl) ?? undefined} initialPhone={view.identity?.phone} phoneLocked={view.profile === 'patient' && view.phoneVerified}
      onRequest={loginRequest} onClose={() => setLoginOpen(false)} onSwitchToLogin={authPurpose === 'signup' ? () => showAuth('login') : undefined}/>}
    {profileIntake && account && <GuestOverlay open={profileVisible} title={copy.intakeTitle} closeLabel={copy.backChat} busy={busy} onClose={() => setProfileOpen(false)}>
      {error && <p className="guest-error" role="alert">{error}</p>}
      <QuickIntake identity={profileIntake} locale={locale} copy={copy} busy={busy}
        onSubmit={intake => void request('profileIntake', {intake, accountCredential: account.credential}).then(ok => {if (ok) setProfileOpen(false);})}/>
    </GuestOverlay>}
    {view && guestActive && phase === 'identity' && <IdentityForm country={view.country} key={view.country} initial={view.identity} copy={copy} busy={busy} locale={locale} clinicName={view.clinicName}
      open={overlayOpen} onClose={() => setOverlayOpen(false)} phoneLocked={view.profile === 'patient' && view.phoneVerified}
      privacyUrl={safeGuestNavigation(view.privacyUrl)} termsUrl={safeGuestNavigation(view.termsUrl)} onSubmit={submitIdentity}/>}
    {view && phase !== 'identity' && (guestActive || phase === 'account') && formPhase && <GuestOverlay open={overlayOpen} title={titles[view.phase]} closeLabel={copy.backChat} busy={busy}
      dismissible={phase !== 'intake'} onClose={() => setOverlayOpen(false)}>
      {error && <p className="guest-error" role="alert" tabIndex={-1}>{error}{remaining > 0 && ` (${remaining}s)`}</p>}
      {notice && <p className="guest-notice" role="status">{notice}</p>}
      {view?.phase === 'verification' && guestActive && <div className="guest-form-panel"><p className="guest-description">{copy.verifyBody}</p><p className="guest-hint">{view.identity?.phone?.replace(/\d(?=\d{4})/g, '•')}</p>
        <div className="guest-channel"><GuestSingleSelect className="guest-delivery-select" aria-label={copy.sendCode} value={verificationChannel} disabled={busy || !smsAllowed} onChange={event => setChannel(event.target.value as 'sms' | 'whatsapp')}>
          <option value="whatsapp">{copy.whatsapp}</option>{smsAllowed && <option value="sms">{copy.sms}</option>}
        </GuestSingleSelect></div>
        <button className="guest-secondary" disabled={busy || remaining > 0} onClick={() => void request('sendCode', {verificationChannel}).then(ok => {if (ok) {setCodeSent(true); setRetryAt(Date.now() + 60_000); setNotice(copy.codeSent);}})}>{codeSent ? copy.resend : copy.sendCode}{remaining > 0 ? ` (${remaining}s)` : ''}</button>
        <form className="guest-form" onSubmit={event => {event.preventDefault(); void request('verify', {code});}}><label htmlFor="guest-code">{copy.code}<input id="guest-code" className="guest-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} required onChange={event => setCode(event.target.value.replace(/\D/g, ''))}/></label>
          <button className="guest-primary" style={{marginTop: 22}} disabled={busy || code.length !== 6}>{busy ? copy.busy : copy.verify}</button>
        </form>
      </div>}
      {view?.phase === 'account' && <div className="guest-form-panel"><p className="guest-description">{returnsToGuest ? copy.accountBody : copy.portalAccountBody}</p>
        {accountUrl && <a className="guest-primary" style={{marginTop: 24}} href={accountUrl} onClick={returnsToGuest && !externalAccount ? onSignIn : undefined}>{externalAccount ? copy.secureContinue : copy.signIn}</a>}
        {returnsToGuest && getAccountToken && <button className="guest-secondary" disabled={busy} onClick={() => {
          if (locked.current) return; locked.current = true; setBusy(true); setError('');
          void getAccountToken().then(async token => {if (token) accept(await client.linkAccount(token)); else setError(copy.accountBody);}).catch(() => setError(copy.failed)).finally(() => {locked.current = false; setBusy(false);});
        }}>{copy.linkAccount}</button>}
      </div>}
      {view.phase === 'offer' && <div className="guest-form-panel"><p className="guest-description">{copy.offerBody}</p>
        <div className="guest-price"><span>{chosenOffer?.label || copy.price}</span><strong>{quotedAmount ? price(quotedAmount, quotedCurrency) : copy.free}</strong></div>
        <label className="guest-check"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)}/>{copy.consent}</label>
        <button className="guest-primary" disabled={busy || !consent} onClick={() => void request('checkout', {consent: true})}>{busy ? copy.busy : quotedAmount ? copy.pay : copy.freeContinue}</button>
      </div>}
      {view?.phase === 'intake' && guestActive && <QuickIntake initial={view.intake} identity={view.identity} locale={locale} copy={copy} busy={busy} onSubmit={intake => void request('intake', {intake}).then(ok => {if (ok) void request('complete');})}/>}
    </GuestOverlay>}
    {view?.phase === 'payment' && view.payment && paymentOpen && <GuestCheckout payment={view.payment} copy={copy} busy={busy} allowPayment={guestActive}
      onCheck={() => {void request('paymentStatus');}} onComplete={() => {void request('paymentStatus');}} onBack={() => setPaymentOpen(false)}/>}
  </section>;
}
