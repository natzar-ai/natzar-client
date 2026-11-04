// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import {AgentThread, AgentWelcome} from './AgentWelcome';
import {ChatComposer, MAX_UPLOAD_BYTES} from './ChatComposer';
import {chatCopy} from './chat-copy';
import {GuestSingleSelect} from './GuestSingleSelect';
import {useCallback, useEffect, useRef, useState} from 'react';
import type {GuestClient} from '../guest/index';
import type {GuestAccount, GuestAction, GuestIdentity, GuestRequest, GuestResult, GuestView, GuestMessage} from '../contract/guest';
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
import {HistoryDialog, type HistoryAction} from './HistoryDialog';
import {historyCopy} from './history-copy';
import {loginCopy} from './login-copy';
import {GuestAccountFrame} from './GuestAccountFrame';
import {signupCopy} from './signup-copy';

const fillTrackers = new WeakMap<Window, ReturnType<typeof createFillTracker>>();

export interface GuestJourneyProps {
  client: GuestClient; locale?: string; clinicName?: string;
  getAccountToken?: () => Promise<string | null>;
  onSignIn?: () => void;
  onReady?: (care: NonNullable<GuestView['care']>) => void;
}

function safeGuestNavigation(value?: string): string | null {
  if (!value) return null;
  try {const url = new URL(value, typeof location === 'undefined' ? 'https://natzar.ai' : location.href); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;} catch {return null;}
}

export function GuestJourney({client, locale = 'en', clinicName, getAccountToken, onSignIn, onReady}: GuestJourneyProps) {
  const copy = guestCopy(locale);
  const chatLabels = chatCopy(locale);
  const [view, setView] = useState<GuestView | null>(null);
  const [saved, setSaved] = useState(() => client.hasSavedJourney());
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [composing, setComposing] = useState(false);
  const [sending, setSending] = useState(false);
  const [outgoing, setOutgoing] = useState<{id: string; text: string; sentAt: string; fileName?: string} | null>(null);
  const [code, setCode] = useState('');
  const [channel, setChannel] = useState<'sms' | 'whatsapp'>('whatsapp');
  const [codeSent, setCodeSent] = useState(false);
  const [consent, setConsent] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false), [account, setAccount] = useState<GuestAccount | null>(null);
  const [authPurpose, setAuthPurpose] = useState<'login' | 'signup'>('login');
  const loginLabels = loginCopy(locale);
  const accountExpired = useCallback(() => {
    client.forgetAccount?.(); setAccount(null); setAuthPurpose('login'); setLoginOpen(true);
    void client.request('state').then(result => {
      if (result.ok) setView(result.journey);
      else if (result.error === 'session_expired') {client.forget(); setView(null); setSaved(false); setError(copy.expired);}
    }).catch(() => {});
  }, [client, copy.expired]);
  const historyAttempted = useRef<string | null>(null), restoreHistoryFocus = useRef(false), historyDismissals = useRef(0);
  const live = useRef({id: '', phase: '' as string, text: '', open: false});
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
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
  live.current = {id: view?.id ?? '', phase: phase ?? '', text, open: historyOpen || loginOpen};
  const historyLabels = historyCopy(locale);
  const userMessageCount = view?.messages.filter(message => message.role === 'user').length ?? 0;
  function closeHistory() {historyDismissals.current++; restoreHistoryFocus.current = true; setHistoryOpen(false);}
  async function historyRequest(action: HistoryAction | 'offerHistory', input: Omit<GuestRequest, 'action' | 'credential'> = {}): Promise<GuestResult> {
    if (locked.current) return {ok: false, error: 'journey_busy'};
    const id = view?.id, dismissal = historyDismissals.current;
    locked.current = true; setBusy(true);
    try {
      const result = await client.request(action, input);
      if (result.ok) {
        if (action === 'offerHistory' && input.consent !== true && dismissal === historyDismissals.current && live.current.id === id && live.current.phase === 'chat' && !live.current.text.trim()) setHistoryOpen(true);
        accept(result);
        if (action === 'verifyHistoryCode' && result.account) setHistoryOpen(false);
      }
      return result;
    } catch {return {ok: false, error: 'service_unavailable'};}
    finally {locked.current = false; setBusy(false);}
  }
  useEffect(() => {
    if (historyOpen || loginOpen || account || busy || text.trim() || !view?.history?.canOffer || historyAttempted.current === view.id) return;
    const id = view.id;
    const timer = setTimeout(() => {
      if (locked.current || live.current.id !== id || live.current.text.trim() || live.current.phase !== 'chat' || live.current.open || document.visibilityState === 'hidden') return;
      historyAttempted.current = id;
      void historyRequest('offerHistory');
    }, 2400);
    return () => clearTimeout(timer);
    // The same client and current refs are used when the quiet period ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, historyOpen, loginOpen, account, text, view?.id, view?.history?.canOffer]);
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
    if (result.ok) {
      setView(result.journey); setSaved(client.hasSavedJourney());
      setAccount(result.account ?? client.account?.() ?? null);
      if (result.journey.care && ready.current !== result.journey.care.id) {ready.current = result.journey.care.id; onReady?.(result.journey.care);}
      return true;
    }
    const code = result.error;
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
    if (locked.current) return false;
    locked.current = true; setBusy(true); setError(''); setNotice('');
    try {
      let result = await client.request(action, input);
      if (action === 'state' && !result.ok && /^(session_expired|session_invalid|session_not_found)$/.test(result.error)) {client.forget(); setSaved(false); setAccount(null);}
      // A return can carry a cached pending view after Stripe has already
      // completed. Refresh server proof before mounting that checkout again.
      if (action === 'state' && result.ok && result.journey.phase === 'payment') result = await client.request('paymentStatus');
      // A clinical follow-up belongs in the conversation. Keep the unfinished
      // form available without covering the question the patient needs to answer.
      if (result.ok && ((action === 'checkout' && result.journey.phase === 'offer') || (action === 'complete' && result.journey.phase === 'intake'))) setOverlayOpen(false);
      if (result.ok && action === 'chooseCare' && ['identity', 'verification', 'account', 'offer'].includes(result.journey.phase)) setOverlayOpen(true);
      return accept(result);
    }
    catch {setError(copy.failed); return false;}
    finally {locked.current = false; setBusy(false);}
  }
  useEffect(() => {
    void request(client.hasSavedJourney() ? 'state' : 'begin');
    // Each mounted client restores once; the request lock also handles StrictMode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);
  useEffect(() => {
    setOverlayOpen(phase === 'account' || (!!phase && view?.guestEnabled !== false && !['refunded', 'refund_pending', 'refund_failed'].includes(view?.payment?.status ?? '') && ['identity', 'verification', 'offer', 'intake'].includes(phase)));
    setPaymentOpen(phase === 'payment' && !['failed', 'refunded', 'refund_pending', 'refund_failed'].includes(view?.payment?.status ?? ''));
  }, [phase, view?.guestEnabled, view?.payment?.status]);
  useEffect(() => {
    if (!retryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [retryAt]);
  const pending = (phase === 'payment' && view?.payment?.status === 'pending') || view?.payment?.status === 'refund_pending';
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {if (!locked.current) void request('paymentStatus');}, 5000);
    return () => clearInterval(timer);
    // request reads the same stable client; polling stops as soon as phase changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, client]);
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
  const refunded = view?.payment?.status === 'refunded';
  const refundPending = view?.payment?.status === 'refund_pending';
  const refundFailed = view?.payment?.status === 'refund_failed';
  const formPhase = phase === 'account' || (!!phase && ['identity', 'verification', 'offer', 'intake'].includes(phase) && !refunded && !refundPending && !refundFailed);
  const formVisible = phase !== 'identity' && (guestActive || phase === 'account') && formPhase && overlayOpen;
  useEffect(() => {
    if (!formVisible) thread.current?.scrollTo({top: thread.current.scrollHeight, behavior: 'auto'});
  }, [messageCount, outgoing, phase, formVisible]);
  const choiceUnlocked = guestActive && !!view && !view.care && ['chat', 'identity', 'verification', 'offer', 'payment'].includes(view.phase)
    && (!view.payment || ['failed', 'refunded'].includes(view.payment.status));
  useEffect(() => {
    const surfaceOpen = (formPhase && overlayOpen) || (phase === 'payment' && paymentOpen);
    const closed = surfaceWasOpen.current && !surfaceOpen;
    surfaceWasOpen.current = surfaceOpen;
    if (!closed) return;
    // Return to the selected care option without focusing the composer and
    // changing the welcome background when a care dialog closes.
    const section = frame.current;
    const animation = requestAnimationFrame(() => (pendingAction.current
      ?? section?.querySelector<HTMLButtonElement>('.guest-offer[aria-pressed="true"]')
      ?? composer.current)?.focus({preventScroll: true}));
    return () => cancelAnimationFrame(animation);
  }, [formPhase, overlayOpen, paymentOpen, phase]);
  const smsAllowed = smsLoginAllowed(view?.identity?.phone ?? '');
  const verificationChannel = smsAllowed ? channel : 'whatsapp';
  useEffect(() => {if (phase === 'offer') setConsent(false);}, [phase, view?.payment?.status, quotedAmount, quotedCurrency]);
  async function sendMessage() {
    const value = text.trim();
    if ((!value && !file) || locked.current) return;
    if (file && file.size > MAX_UPLOAD_BYTES) {setError(chatLabels.chat.fileTooLarge); return;}
    const selectedFile = file;
    if (pendingMessage.current?.text !== value || pendingFile.current !== selectedFile) {
      pendingMessage.current = {text: value, requestId: crypto.randomUUID()};
      pendingFile.current = selectedFile;
      stagedAttachment.current = undefined;
    }
    const message = pendingMessage.current!;
    setOutgoing({id: message.requestId, text: value, sentAt: new Date().toISOString(), fileName: selectedFile?.name});
    locked.current = true; setBusy(true); setError('');
    setSending(true); setText(''); setFile(null);
    let sent = false;
    try {
      if (selectedFile && !stagedAttachment.current) {
        const result = await client.request('uploadAttachment', {file: {fileName: selectedFile.name, contentType: selectedFile.type || 'application/octet-stream', contentLength: selectedFile.size}});
        if (!accept(result) || !result.ok || !result.upload) {setOutgoing(null); return;}
        const uploaded = await fetch(result.upload.url, {method: 'PUT', body: selectedFile, headers: {'content-type': selectedFile.type || 'application/octet-stream'}});
        if (!uploaded.ok) throw new Error('upload_failed');
        stagedAttachment.current = result.upload.attachment;
      }
      const ok = accept(await client.request('message', {...message, ...(stagedAttachment.current ? {attachment: stagedAttachment.current} : {})}));
      if (ok) {sent = true; pendingMessage.current = null; pendingFile.current = null; stagedAttachment.current = undefined;}
      setOutgoing(null);
    } catch {setError(chatLabels.chat.sendFailed); setOutgoing(null);}
    finally {
      if (!sent) {setText(current => current || value); setFile(current => current ?? selectedFile);}
      locked.current = false; setBusy(false); setSending(false);
    }
  }
  async function openLogin(purpose: 'login' | 'signup' = 'login') {
    if (busy) return;
    if (!view && !await request(saved ? 'state' : 'begin')) return;
    setHistoryOpen(false); setOverlayOpen(false); setAuthPurpose(purpose); setLoginOpen(true);
  }
  async function loginRequest(action: HistoryAction, input: Omit<GuestRequest, 'action' | 'credential'>): Promise<GuestResult> {
    if (locked.current) return {ok: false, error: 'journey_busy'};
    locked.current = true; setBusy(true);
    try {
      const result = await client.request(action === 'sendHistoryCode' ? 'sendLoginCode' : 'verifyLoginCode', input);
      if (result.ok) accept(result);
      if (result.ok && result.account && action === 'verifyHistoryCode' && authPurpose === 'signup') setLoginOpen(false);
      return result;
    } catch {return {ok: false, error: 'service_unavailable'};}
    finally {locked.current = false; setBusy(false);}
  }
  async function submitIdentity(identity: GuestIdentity, consents: {healthConsent: true; messagingConsent: boolean}, delivery?: 'sms' | 'whatsapp'): Promise<GuestResult> {
    if (locked.current) return {ok: false, error: 'journey_busy'};
    locked.current = true; setBusy(true);
    try {const result = await client.request('identity', {identity, ...consents}); if (result.ok) {accept(result); if (delivery) setChannel(delivery);} return result;}
    catch {return {ok: false, error: 'service_unavailable'};}
    finally {locked.current = false; setBusy(false);}
  }
  async function signOut() {
    if (await request('logout')) {client.forget(); setView(null); setSaved(false); setAccount(null); setLoginOpen(false); setComposing(false); await request('begin');}
  }
  const greeting = account?.firstName?.trim() ? copy.welcomeName.replace('{{name}}', () => account.firstName!.trim())
    : copy.welcomeClinic.replace('{{clinic}}', () => view?.clinicName || clinicName || copy.assistant);
  const signedInSurface = !!account && !loginOpen && (!view?.choice || phase === 'ready');
  const showWelcome = guestActive && !view?.care && phase !== 'ready' && userMessageCount === 0 && !outgoing && !sending;
  const availableOffers = choiceUnlocked && view ? view.offers.filter(offer => !refunded || offer.modality !== view.choice?.modality || offer.mode !== view.choice?.mode) : [];
  const showOffers = showWelcome && availableOffers.length > 0 && !composing;
  const careOptions = <GuestCareOptions
    offers={availableOffers}
    choice={view?.choice} busy={busy || sending} freeLabel={copy.free} messageClinicianLabel={copy.messageClinician} videoNowLabel={copy.videoNow} formatPrice={price}
    onChoose={choice => {setConsent(false); void request('chooseCare', {choice});}}/>;
  const messages: Array<GuestMessage & {fileName?: string}> = [...(view?.messages ?? []), ...(outgoing && !view?.messages.some(message => message.id === outgoing.id) ? [{...outgoing, role: 'user' as const}] : [])];
  return <section ref={frame} className="natzar-guest" data-guest-frame="" data-guest-phase={phase ?? (saved ? 'restoring' : 'welcome')} lang={locale.replace('_', '-')}>
    <style>{guestStyles}</style>
    {signedInSurface && <><header className="guest-header guest-header-login"><span className="guest-brand">{greeting}</span><button type="button" className="guest-login-button" disabled={busy} onClick={() => void signOut()}>{loginLabels.signOut}</button></header>
      {phase === 'ready' && care && <aside className="guest-account-care"><a className="guest-step-action" href={care}>{copy.openCare}<span aria-hidden="true">↗</span></a></aside>}
      <GuestAccountFrame client={client} frameUrl={account!.frameUrl} locale={locale} onExpired={accountExpired} draft={text} onDraftChange={setText}/></>}
    <div className="guest-chat-surface" hidden={formVisible || signedInSurface} inert={formVisible || historyOpen || loginOpen || phase === 'identity' && overlayOpen} aria-hidden={formVisible || historyOpen || loginOpen || phase === 'identity' && overlayOpen || undefined}>
      <header className="guest-header guest-header-login" data-history={!!view?.history && (view.history.saved || view.history.canSave && userMessageCount > 0)}><span className="guest-brand">{greeting}</span><span className="guest-status">{copy.guest}</span>
        {!account && <button type="button" className="guest-signup-button" disabled={busy} onClick={() => void openLogin('signup')}>{signupCopy(locale).action}</button>}
        <button type="button" className="guest-login-button" disabled={busy} onClick={() => {if (account) void signOut(); else void openLogin();}}>{account ? loginLabels.signOut : loginLabels.action}</button>
      </header>
      <main className="guest-main">
        {!view ? <div className="guest-recovery" aria-live="polite"><p role={error ? 'alert' : 'status'}>{error || copy.busy}</p>
          {error && <button className="guest-secondary" disabled={busy || remaining > 0} onClick={() => void request(saved ? 'state' : 'begin')}>{copy.resume}</button>}
        </div> : <>
          <h1 className="guest-chat-title">{copy.assistant}</h1>
          <AgentThread className={guestActive ? 'guest-thread' : 'guest-recovery'} ref={thread} role={guestActive ? 'log' : undefined} aria-live="polite" aria-label={copy.guest} emergencyMessage={chatLabels.agent.urgent}>
            {!guestActive && <p className="guest-notice" role="status">{copy.disabledExisting}</p>}
            {guestActive && <>
              {showWelcome && <div key={showOffers ? 'offers' : 'default'} className="guest-welcome-transition">
                {showOffers ? <div className="guest-entry-welcome">
                  <h1>{copy.title}</h1><p className="guest-description">{copy.intro}</p>
                  {careOptions}
                  <button className="guest-primary guest-text-agent" onClick={() => {setComposing(true); composer.current?.focus({preventScroll: true});}}>{copy.textAgent}</button>
                </div> : <AgentWelcome message={chatLabels.agent.empty}/>}
              </div>}
              {messages.map((message, index) => <div key={message.id} className="guest-message" data-role={message.role}
                data-run-end={messages[index + 1]?.role !== message.role}>{renderEmphasis(message.text)}
                {'attachments' in message && message.attachments?.map(attachment => <a className="guest-message-file" key={attachment.key} href={safeGuestNavigation(attachment.url) ?? undefined} target="_blank" rel="noreferrer">{attachment.fileName}</a>)}
                {'fileName' in message && typeof message.fileName === 'string' && message.fileName && <span className="guest-message-file">{message.fileName}</span>}<time dateTime={message.sentAt}>{new Date(message.sentAt).toLocaleTimeString(locale.replace('_', '-'), {hour: '2-digit', minute: '2-digit'})}</time></div>)}
              {sending && <div className="guest-typing" role="status" aria-label={copy.busy}><span/><span/><span/></div>}
            </>}
            {error && !overlayOpen && !paymentOpen && <p className="guest-error" role="alert">{error}{remaining > 0 && ` (${remaining}s)`}</p>}
            {notice && !overlayOpen && <p className="guest-notice" role="status">{notice}</p>}
            {(guestActive || phase === 'account') && formPhase && !overlayOpen && (!showWelcome || !availableOffers.length) && <aside className="guest-pending-step">
              {phase === 'intake' && <p className="guest-hint">{copy.requiredBeforeCare}</p>}
              <button ref={pendingAction} className="guest-step-action" disabled={busy} onClick={() => setOverlayOpen(true)}>{titles[view.phase]}<span aria-hidden="true">↗</span></button>
            </aside>}
            {phase === 'payment' && !refunded && !refundPending && !refundFailed && <aside className="guest-pending-step">
              <p className="guest-hint">{view.payment?.status === 'failed' ? copy.paymentFailed : copy.paymentPending}</p>
              {guestActive && (view.payment?.status === 'failed'
                ? <button ref={pendingAction} className="guest-step-action" disabled={busy} onClick={() => void request('checkout', {consent: true})}>{copy.paymentRetry}<span aria-hidden="true">↗</span></button>
                : <button ref={pendingAction} className="guest-step-action" disabled={busy} onClick={() => setPaymentOpen(true)}>{copy.openCheckout}<span aria-hidden="true">↗</span></button>)}
              <button className="guest-link" disabled={busy} onClick={() => void request('paymentStatus')}>{copy.checkPayment}</button>
            </aside>}
            {(refunded || refundPending || refundFailed) && <aside className="guest-pending-step">
              <p className="guest-notice" role="status">{refunded ? copy.refunded : refundFailed ? copy.refundFailed : copy.refundPending}</p>
              {(refundPending || refundFailed) && <button className="guest-link" disabled={busy} onClick={() => void request('paymentStatus')}>{copy.refundCheck}</button>}
            </aside>}
            {phase === 'ready' && <aside className="guest-pending-step"><p className="guest-description">{copy.readyBody}</p>
              {care ? <a className="guest-primary" href={care}>{copy.openCare}</a> : <button className="guest-primary" disabled={busy} onClick={() => void request('complete')}>{busy ? copy.busy : copy.complete}</button>}
            </aside>}
            {!showWelcome && careOptions}
          </AgentThread>
          {guestActive && <ChatComposer draft={text} onDraft={setText} file={file} onFile={setFile} busy={busy || sending}
            labels={chatLabels.chat} inputRef={composer} maxLength={2000} placeholder={chatLabels.agent.placeholder}
            onFocus={() => setComposing(true)} onBlur={() => setComposing(false)} onSend={() => void sendMessage()}
            extra={view.history?.canSave && userMessageCount > 0 && <button type="button" className="guest-save-button" aria-label={historyLabels.action} title={historyLabels.action} disabled={busy || sending} onClick={() => {historyAttempted.current = view.id; setHistoryOpen(true); void historyRequest('offerHistory', {consent: true});}}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4V3Z"/></svg></button>}/>}

        </>}
      </main>
    </div>
    {view?.history && phase === 'chat' && <HistoryDialog open={historyOpen} history={view.history} locale={locale} busy={busy}
      onRequest={historyRequest} onClose={closeHistory}/>}
    {view && <HistoryDialog key={authPurpose} purpose={authPurpose} country={view.country} open={loginOpen} history={{saved: !!account, offered: true, canOffer: false, canSave: true, verification: view.login?.verification}} locale={locale} busy={busy}
      clinicName={view.clinicName} privacyUrl={safeGuestNavigation(view.privacyUrl) ?? undefined} termsUrl={safeGuestNavigation(view.termsUrl) ?? undefined} initialPhone={view.identity?.phone} phoneLocked={view.profile === 'patient' && view.phoneVerified} onRequest={loginRequest} onClose={() => setLoginOpen(false)}/>}
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
      {view?.phase === 'intake' && guestActive && <div className="guest-form-panel"><QuickIntake initial={view.intake} identity={view.identity} locale={locale} copy={copy} busy={busy} onSubmit={intake => void request('intake', {intake}).then(ok => {if (ok) void request('complete');})}/></div>}
    </GuestOverlay>}
    {view?.phase === 'payment' && view.payment && paymentOpen && <GuestCheckout payment={view.payment} copy={copy} busy={busy} allowPayment={guestActive}
      onCheck={() => {void request('paymentStatus');}} onComplete={() => {void request('paymentStatus');}} onBack={() => setPaymentOpen(false)}/>}
  </section>;
}
