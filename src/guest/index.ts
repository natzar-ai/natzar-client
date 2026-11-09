/**
 * Public guest onboarding. Anonymous cookies grant access to ONE temporary
 * conversation. Phone verification issues a separate signed-in chat credential.
 *
 * `createGuestClient({clinicId, graphqlUrl, apiKey})` supports custom UIs.
 * `<NatzarGuest>` from the React entry and the separate `guest/elements`
 * entry render the same form and chat on the customer's actual origin.
 */
import {createGuestCookieStorage, type GuestCookieStorage} from './cookie';
export {createGuestCookieStorage, type GuestCookieStorage} from './cookie';
import type {GuestAccount, GuestAction, GuestRequest, GuestResult, GuestView} from '../contract/guest';
export type {GuestAttachment, GuestFile, GuestMessage, GuestPendingMessage, GuestUpload, GuestAccount, GuestAction, GuestRequest, GuestResult, GuestView, GuestIntake, GuestIntakeSelections, GuestIdentity, GuestSignup, GuestCare, GuestOffer, GuestPayment} from '../contract/guest';

export type GuestStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export interface GuestClientOptions {
  clinicId: string;
  graphqlUrl: string;
  /** AppSync's PUBLIC API key. Never pass a partner server key. */
  apiKey: string;
  locale?: string;
  fetch?: typeof fetch;
  storage?: GuestStorage | null;
  /** Legacy persistent device store; new browser sessions use a scoped host cookie. */
  rememberStorage?: GuestStorage | null;
  /** Defaults to a host-only browser cookie. Pass null to disable persistence. */
  cookieStorage?: GuestCookieStorage | null;
  credential?: string;
}
export interface GuestClient {
  hasSavedJourney(): boolean;
  canRemember(): boolean;
  isRemembered(): boolean;
  rememberOnDevice(enabled: boolean): void;
  request(action: GuestAction, input?: Omit<GuestRequest, 'action' | 'credential'>): Promise<GuestResult>;
  /** Accepted chat turns and read-only progress observations for a custom UI. */
  subscribe?(listener: (journey: GuestView) => void): () => void;
  /** Call only after normal patient sign-in; a guest OTP never unlocks a chart. */
  linkAccount(idToken: string): Promise<GuestResult>;
  /** Explicit user handoff to the clinic's hosted guest page. Bearer stays in the fragment. */
  handoffUrl(guestPageUrl: string): string;
  forget(): void;
  account?(): GuestAccount | null;
  forgetAccount?(): void;
  /** Uses only the separately verified account credential, never the anonymous cookie. */
  accountOperation?(operation: string, input?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export function validateGuestUrl(value: string): URL {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.hash) throw new TypeError('A secure guest endpoint URL is required');
  return url;
}

function validResult(value: unknown): value is GuestResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<GuestResult>;
  if (result.ok === false) return typeof result.error === 'string';
  if (result.ok !== true || !('journey' in result) || !result.journey) return false;
  const view = result.journey as Partial<GuestView>;
  const pending = view.pendingMessage;
  if (pending !== undefined && (!pending || typeof pending !== 'object' || Object.keys(pending).length !== 3 ||
    typeof pending.requestId !== 'string' || !pending.requestId.trim() || pending.requestId.length > 200 ||
    typeof pending.startedAt !== 'string' || !Number.isFinite(Date.parse(pending.startedAt)) ||
    !['queued', 'processing'].includes(pending.status))) return false;
  if ('account' in result && result.account && !validAccount(result.account)) return false;
  return typeof view.id === 'string' && typeof view.clinicId === 'string' && typeof view.phase === 'string' && Array.isArray(view.messages) && Array.isArray(view.offers);
}
function validAccount(value: unknown): value is GuestAccount {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<GuestAccount>;
  if (typeof v.credential !== 'string' || !/^nac1\.[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(v.credential) || typeof v.frameUrl !== 'string' || !Number.isFinite(Date.parse(v.expiresAt ?? '')) || v.firstName !== undefined && typeof v.firstName !== 'string') return false;
  try {return validateGuestUrl(v.frameUrl).pathname === '/guest/account';} catch {return false;}
}

type CheckoutSnapshot = {id: string; clinicId: string; phase: string; choice: GuestView['choice']; payment: string; assistantIds: Set<string>};
const checkoutSnapshot = (view: GuestView): CheckoutSnapshot => ({id: view.id, clinicId: view.clinicId, phase: view.phase,
  choice: view.choice && {...view.choice}, payment: JSON.stringify(view.payment ?? null), assistantIds: new Set(view.messages.filter(m => m.role === 'assistant').map(m => m.id))});
function checkoutProgress(before: CheckoutSnapshot, view: GuestView): boolean {
  if (view.id !== before.id || view.clinicId !== before.clinicId || view.guestEnabled === false || !before.choice ||
    !view.choice || view.choice.modality !== before.choice.modality || view.choice.mode !== before.choice.mode) return false;
  // A clinical follow-up stays an offer. It must never be presented as payment
  // or clinical clearance merely because an earlier request lost its response.
  if (view.phase === 'offer') return view.messages.some(m => m.role === 'assistant' && typeof m.id === 'string' && !before.assistantIds.has(m.id) && typeof m.text === 'string' && !!m.text.trim());
  const p = view.payment;
  if (!p || !Number.isSafeInteger(p.amountCents) || p.amountCents < 0 || !/^[a-z]{3}$/i.test(p.currency)) return false;
  const paidId = typeof p.id === 'string' && !!p.id;
  const actionable = view.phase === 'payment' && p.status === 'pending' && paidId && !!(p.clientSecret || p.checkoutUrl)
    || view.phase === 'intake' && (p.status === 'paid' && paidId || p.status === 'free' && p.id === null && p.amountCents === 0);
  return !!actionable && (view.phase !== before.phase || JSON.stringify(p) !== before.payment);
}
const ambiguousCheckout = new Set(['service_unavailable', 'temporarily_unavailable', 'demo_unavailable']);

export function createGuestClient(options: GuestClientOptions): GuestClient {
  if (!options.clinicId || !options.apiKey || /^(?:pp_|pk_(?:test|live)_)/.test(options.apiKey)) throw new TypeError('Pass a clinic id and the public AppSync API key');
  const endpoint = validateGuestUrl(options.graphqlUrl);
  if (endpoint.search) throw new TypeError('The GraphQL endpoint cannot contain a query');
  const send = options.fetch ?? globalThis.fetch;
  const locale = ({en: 'en', es: 'es', fr: 'fr', de: 'de', it: 'it'} as Record<string, string>)[(options.locale ?? 'en').slice(0, 2).toLowerCase()] ?? 'en';
  const key = `natzar.guest.v1:${endpoint.origin}:${options.clinicId}`;
  let accountStore: GuestStorage | null = null;
  try {accountStore = typeof sessionStorage === 'undefined' ? null : sessionStorage;} catch { /* Memory-only login. */ }
  let account: GuestAccount | null = null, proposedAccount = '';
  let lastView: GuestView | null = null, requestGeneration = 0;
  const listeners = new Set<(journey: GuestView) => void>();
  let pendingObservation: AbortController | undefined;
  const messageFlights = new Map<string, {signature: string; promise: Promise<GuestResult>}>();
  const accountKey = key + ':account';
  const historyProposalKey = key + ':history-proposal';
  try {const raw = accountStore?.getItem(accountKey); if (raw) account = JSON.parse(raw) as GuestAccount;} catch { /* Invalid/blocked session storage. */ }
  if (!validAccount(account)) account = null;
  function saveAccount(value: GuestAccount | null) {
    account = value;
    try {
      if (value) accountStore?.setItem(accountKey, JSON.stringify({...value, profileIntake: undefined}));
      else accountStore?.removeItem(accountKey);
    } catch { /* Continue in memory. */ }
  }
  function currentAccount() {if (account && Date.parse(account.expiresAt) <= Date.now()) saveAccount(null); return account;}
  let cookieStore = options.cookieStorage;
  if (cookieStore === undefined) {try {cookieStore = typeof document === 'undefined' ? null : createGuestCookieStorage(document);} catch {cookieStore = null;}}
  let persistent = '', cookie = '';
  try {persistent = options.rememberStorage?.getItem(key) ?? '';} catch { /* Persistence is optional. */ }
  try {cookie = cookieStore?.getItem(key) ?? '';} catch { /* Continue in the tab. */ }
  let credential = options.credential ?? '';
  if (!credential) {try {credential = options.storage?.getItem(key) ?? '';} catch { /* Storage is optional. */ }}
  if (!credential) credential = cookie || persistent;
  let remembered = !!cookieStore || (!!credential && credential === persistent);
  let persistencePreference = remembered;
  function remember(value: string) {
    credential = value;
    try {if (value) options.storage?.setItem(key, value); else options.storage?.removeItem(key);} catch { /* Continue in memory. */ }
    try {if (value && remembered && cookieStore) cookieStore.setItem(key, value); else cookieStore?.removeItem(key);} catch { /* Continue in the tab. */ }
    // Retain the legacy adapter for clients without cookie support; avoid redundant browser storage.
    try {if (value && remembered && !cookieStore) options.rememberStorage?.setItem(key, value); else options.rememberStorage?.removeItem(key);} catch { /* Continue in the tab. */ }
  }
  if (options.credential) remember(options.credential);
  function saveHistoryProposal(value: string) {
    try {
      if (value) accountStore?.setItem(historyProposalKey, JSON.stringify({value, expiresAt: Date.now() + 5 * 60_000}));
      else accountStore?.removeItem(historyProposalKey);
    } catch { /* The current tab can still verify in memory. */ }
  }
  function historyProposal(): string | undefined {
    try {
      const raw = accountStore?.getItem(historyProposalKey);
      if (!raw) return;
      const proposal = JSON.parse(raw) as {value?: string; expiresAt?: number};
      if (proposal.value?.split('.')[1] === credential.split('.')[1] && (proposal.expiresAt ?? 0) > Date.now()) return proposal.value;
      saveHistoryProposal('');
    } catch { /* Invalid or unavailable session storage. */ }
  }
  function rememberResult(result: Extract<GuestResult, {ok: true}>) {
    try {cookieStore?.setExpiry?.(result.journey.expiresAt);} catch { /* Persistence is optional. */ }
    if (result.credential && result.credential.split('.')[1] !== credential.split('.')[1]) {saveAccount(null); proposedAccount = ''; saveHistoryProposal('');}
    remember(result.credential ?? credential);
    if (result.account) {saveAccount(result.account); proposedAccount = ''; saveHistoryProposal('');}
    const changed = JSON.stringify(lastView) !== JSON.stringify(result.journey);
    lastView = result.journey;
    if (changed) for (const listener of listeners) {
      try {listener(result.journey);} catch { /* A custom view cannot change transport ownership. */ }
    }
  }
  async function invoke(action: GuestAction, input: Omit<GuestRequest, 'action' | 'credential'> = {}, idToken?: string, observation?: AbortSignal): Promise<GuestResult> {
    const stateAccount = action === 'state' ? input.accountCredential ?? currentAccount()?.credential : undefined;
    const confirmsHistory = action === 'appendHistory' || action === 'deleteHistory';
    if (confirmsHistory || action === 'state' && !stateAccount) {
      const proposal = historyProposal() ?? (confirmsHistory ? proposedAccount : '');
      if (proposal && !input.newAccountCredential) input = {...input, newAccountCredential: proposal};
    }
    if (['verifyLoginCode', 'verifyHistoryCode', 'verify', 'linkAccount'].includes(action) && !input.newAccountCredential) {
      const id = credential.split('.')[1];
      if (action === 'verifyHistoryCode' || action === 'verifyLoginCode') proposedAccount ||= historyProposal() ?? '';
      if (!proposedAccount) {
        const secret = new Uint8Array(32); globalThis.crypto.getRandomValues(secret);
        proposedAccount = `nac1.${id}.${btoa(String.fromCharCode(...secret)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
      }
      input = {...input, newAccountCredential: proposedAccount};
    }
    if ((action === 'verifyHistoryCode' || action === 'verifyLoginCode') && input.newAccountCredential) saveHistoryProposal(input.newAccountCredential);
    const field = idToken ? 'guestJourneyAccount' : 'guestJourney';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    const abandonObservation = () => {clearTimeout(timeout); controller.abort();};
    observation?.addEventListener('abort', abandonObservation, {once: true});
    if (observation?.aborted) abandonObservation();
    try {
      const response = await send(endpoint.href, {
        method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal,
        headers: {'content-type': 'application/json', ...(idToken ? {Authorization: idToken} : {'x-api-key': options.apiKey})},
        body: JSON.stringify({query: `mutation GuestJourney($action: String!, $input: String) { ${field}(action: $action, input: $input) }`,
          variables: {action, input: JSON.stringify({...input, requestId: input.requestId ?? globalThis.crypto.randomUUID(), clinicId: options.clinicId, locale,
            ...(stateAccount ? {accountCredential: stateAccount} : {}),
            ...(credential ? {credential} : {})})}}),
      });
      if (response.status === 429) {
        const seconds = Number(response.headers.get('retry-after'));
        return {ok: false, error: 'rate_limited', retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? Math.min(3600, Math.ceil(seconds)) : 300};
      }
      if (!response.ok) return {ok: false, error: 'service_unavailable'};
      const body = await response.json() as {data?: Record<string, unknown>; errors?: unknown[]};
      if (body.errors?.length) return {ok: false, error: 'service_unavailable'};
      let result = body.data?.[field];
      if (typeof result === 'string') {try {result = JSON.parse(result);} catch {return {ok: false, error: 'service_unavailable'};}}
      if (!validResult(result) || (result.ok && result.journey.clinicId !== options.clinicId)) return {ok: false, error: 'service_unavailable'};
      // Recovery observations are inert until the caller verifies progress and
      // its generation. A late poll cannot restore a forgotten/newer session.
      if (observation) return result;
      if (result.ok) rememberResult(result);
      if (result.ok && ['declineHistory', 'sendHistoryCode', 'sendLoginCode', 'logout'].includes(action)) {saveHistoryProposal(''); proposedAccount = '';}
      if (!result.ok && result.error === 'account_expired') {
        saveAccount(null);
        if (action === 'state' && stateAccount) {const retry = {...input}; delete retry.accountCredential; return invoke('state', retry, idToken);}
      }
      if (action === 'logout' && result.ok) remember('');
      return result;
    } catch {return {ok: false, error: 'service_unavailable'};}
    finally {clearTimeout(timeout); observation?.removeEventListener('abort', abandonObservation);}
  }
  const superseded = (): GuestResult => ({ok: false, error: 'request_superseded'});
  function pause(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      if (signal.aborted) {resolve(); return;}
      const done = () => {clearTimeout(timer); signal.removeEventListener('abort', done); resolve();};
      const timer = setTimeout(done, ms); signal.addEventListener('abort', done, {once: true});
    });
  }
  async function observeMessage(original: GuestResult, target: {journeyId: string; requestId: string; startedAt?: string},
    current: () => boolean, signal: AbortSignal, deadline: number): Promise<GuestResult> {
    let latest = original;
    const accountCredential = currentAccount()?.credential;
    while (current() && !signal.aborted && Date.now() < deadline) {
      await pause(Math.min(1500, Math.max(0, deadline - Date.now())), signal);
      if (!current() || signal.aborted) return superseded();
      const remaining = deadline - Date.now(); if (remaining <= 0) break;
      const controller = new AbortController(), abandon = () => controller.abort();
      signal.addEventListener('abort', abandon, {once: true});
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<GuestResult>(resolve => {timer = setTimeout(() => {controller.abort(); resolve({ok: false, error: 'service_unavailable'});}, Math.min(5000, remaining));});
      let observed: GuestResult;
      try {observed = await Promise.race([invoke('state', {requestId: target.requestId}, undefined, controller.signal), expired]);}
      finally {clearTimeout(timer); signal.removeEventListener('abort', abandon); controller.abort();}
      if (!current() || signal.aborted) return superseded();
      if (!observed.ok) {
        if (observed.error === 'account_expired') {saveAccount(null); continue;}
        if (['session_expired', 'session_invalid', 'session_not_found', 'clinic_disabled', 'guest_disabled'].includes(observed.error)) return observed;
        continue; // Observations never repeat the clinical message or care actions.
      }
      const view = observed.journey;
      if (view.id !== target.journeyId || view.clinicId !== options.clinicId ||
        observed.credential && observed.credential !== credential ||
        observed.account && observed.account.credential !== accountCredential) return superseded();
      const pending = view.pendingMessage;
      if (pending && (pending.requestId !== target.requestId || target.startedAt && pending.startedAt !== target.startedAt)) return superseded();
      const user = view.messages.findIndex(message => message.id === target.requestId && message.role === 'user');
      // Clinic availability/refund recovery is terminal state, not a clinical
      // reply. Cancellation retains this exact accepted user report.
      if (!pending && view.guestEnabled === false && user >= 0 && (!target.startedAt || view.messages[user].sentAt === target.startedAt)) {
        rememberResult(observed); return observed;
      }
      const completed = !pending && user >= 0 && (!target.startedAt || view.messages[user].sentAt === target.startedAt)
        && view.messages[user + 1]?.role === 'assistant';
      if (pending || completed) {
        target.startedAt ??= pending?.startedAt;
        rememberResult(observed); latest = observed;
        if (completed) return observed;
      }
    }
    return current() && !signal.aborted ? latest : superseded();
  }
  async function performRequest(action: GuestAction, input: Omit<GuestRequest, 'action' | 'credential'> = {}, idToken?: string): Promise<GuestResult> {
    pendingObservation?.abort();
    const observation = new AbortController(); pendingObservation = observation;
    const generation = ++requestGeneration;
    let expectedCredential = credential;
    const current = () => generation === requestGeneration && credential === expectedCredential;
    const beforeView = lastView, before = action === 'checkout' && lastView ? checkoutSnapshot(lastView) : null;
    const requestId = input.requestId ?? globalThis.crypto.randomUUID(), messageDeadline = Date.now() + 120_000;
    const accountBeforeState = action === 'state' && (input.accountCredential ?? currentAccount()?.credential);
    try {
      let original = await invoke(action, {...input, requestId}, idToken, observation.signal);
      if (!current() || observation.signal.aborted) return superseded();
      if (!original.ok && original.error === 'account_expired') {
        saveAccount(null);
        if (accountBeforeState) {const retry = {...input}; delete retry.accountCredential; original = await invoke('state', {...retry, requestId}, idToken, observation.signal);}
      }
      if (!current() || observation.signal.aborted) return superseded();
      // An explicit enqueue failure is safe to retry once with the SAME durable id.
      // Ambiguous network errors instead use read-only state recovery below.
      if (action === 'message' && !original.ok && original.error === 'message_queue_unavailable') {
        await pause(500, observation.signal);
        if (!current() || observation.signal.aborted) return superseded();
        original = await invoke(action, {...input, requestId}, idToken, observation.signal);
      }
      if (!current() || observation.signal.aborted) return superseded();
      if (original.ok) {
        if (original.journey.pendingMessage) {
          const scopedCredential = original.credential ?? expectedCredential;
          if (scopedCredential.split('.')[1] !== original.journey.id ||
            !['begin', 'resume'].includes(action) && expectedCredential && scopedCredential !== expectedCredential) return superseded();
        }
        if (action === 'message' && beforeView && original.journey.id !== beforeView.id) return superseded();
        if (original.journey.pendingMessage && action === 'message' && original.journey.pendingMessage.requestId !== requestId) return superseded();
        rememberResult(original); expectedCredential = credential;
        if (['declineHistory', 'sendHistoryCode', 'sendLoginCode', 'logout'].includes(action)) {saveHistoryProposal(''); proposedAccount = '';}
        if (action === 'logout') {remember(''); expectedCredential = credential;}
        if (original.journey.pendingMessage && ['message', 'state', 'resume', 'begin'].includes(action)) {
          const pending = original.journey.pendingMessage;
          return await observeMessage(original, {journeyId: original.journey.id, requestId: pending.requestId, startedAt: pending.startedAt}, current, observation.signal,
            action === 'message' ? messageDeadline : Math.min(messageDeadline, Date.parse(pending.startedAt) + 120_000));
        }
      } else if (action === 'message' && expectedCredential && beforeView &&
        ['service_unavailable', 'temporarily_unavailable', 'demo_unavailable', 'message_queue_unavailable'].includes(original.error)) {
        return await observeMessage(original, {journeyId: beforeView.id, requestId}, current, observation.signal, messageDeadline);
      }
    if (action !== 'checkout' || original.ok || !ambiguousCheckout.has(original.error) || !expectedCredential || !before ||
      !['offer', 'payment'].includes(before.phase) || !current()) return original;
    // Four short read-only observations: <=10s overall, without widening the
    // original 25s request or ever resubmitting checkout/consent.
    const deadline = Date.now() + 10_000;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (deadline - Date.now() <= 500) return original;
      await new Promise<void>(resolve => setTimeout(resolve, 500));
      if (!current() || Date.now() >= deadline) return original;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<GuestResult>(resolve => {timer = setTimeout(() => {controller.abort(); resolve({ok: false, error: 'service_unavailable'});}, Math.min(2000, deadline - Date.now()));});
      let observed: GuestResult;
      try {observed = await Promise.race([invoke('state', {requestId}, undefined, controller.signal), expired]);}
      finally {clearTimeout(timer); controller.abort();}
      if (!current() || Date.now() >= deadline) return original;
      if (!observed.ok) {
        if (observed.error === 'journey_busy' || ambiguousCheckout.has(observed.error)) continue;
        return original;
      }
      if (observed.journey.id !== before.id || observed.journey.clinicId !== before.clinicId ||
        observed.credential && observed.credential !== expectedCredential || observed.account && observed.account.credential.split('.')[1] !== before.id) return original;
      if (checkoutProgress(before, observed.journey)) {rememberResult(observed); return observed;}
    }
    return original;
    } finally {if (pendingObservation === observation) pendingObservation = undefined;}
  }
  function request(action: GuestAction, input: Omit<GuestRequest, 'action' | 'credential'> = {}): Promise<GuestResult> {
    if (action !== 'message') return performRequest(action, input);
    const requestId = input.requestId ?? globalThis.crypto.randomUUID(), key = credential + ':' + requestId;
    const signature = JSON.stringify({...input, requestId});
    const existing = messageFlights.get(key);
    if (existing) return existing.signature === signature ? existing.promise : Promise.resolve({ok: false, error: 'invalid_request_id'});
    const promise = performRequest(action, {...input, requestId}); messageFlights.set(key, {signature, promise});
    const clear = () => {if (messageFlights.get(key)?.promise === promise) messageFlights.delete(key);};
    void promise.then(clear, clear);
    return promise;
  }

  return {
    hasSavedJourney: () => !!credential,
    canRemember: () => !!cookieStore || !!options.rememberStorage,
    isRemembered: () => remembered,
    rememberOnDevice: enabled => {persistencePreference = enabled; remembered = enabled && (!!cookieStore || !!options.rememberStorage); remember(credential);},
    request,
    subscribe: listener => {listeners.add(listener); return () => {listeners.delete(listener);};},
    linkAccount: idToken => performRequest('linkAccount', {}, idToken),
    handoffUrl: guestPageUrl => {
      const url = validateGuestUrl(guestPageUrl);
      if (url.pathname !== '/guest') throw new TypeError('The handoff must use the hosted guest page');
      url.searchParams.set('clinic', options.clinicId);
      if (credential) url.hash = new URLSearchParams({credential}).toString();
      return url.href;
    },
    forget: () => {requestGeneration++; pendingObservation?.abort(); messageFlights.clear(); lastView = null; remember(''); saveAccount(null); proposedAccount = ''; saveHistoryProposal(''); remembered = !!cookieStore && persistencePreference;},
    account: currentAccount,
    forgetAccount: () => {requestGeneration++; pendingObservation?.abort(); saveAccount(null);},
    accountOperation: async (operation, input = {}) => {
      const login = currentAccount();
      if (!login) return {ok: false, error: 'account_expired'};
      try {
        const response = await send(endpoint.href, {method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
          headers: {'content-type': 'application/json', 'x-api-key': options.apiKey}, signal: AbortSignal.timeout(30_000),
          body: JSON.stringify({query: 'mutation GuestPatientEmbed($credential:String!,$operation:String!,$input:AWSJSON){guestPatientEmbed(credential:$credential,operation:$operation,input:$input)}',
            variables: {credential: login.credential, operation, input: JSON.stringify(input)}})});
        const payload = await response.json() as {data?: {guestPatientEmbed?: unknown}; errors?: unknown[]};
        if (!response.ok || payload.errors?.length || !payload.data?.guestPatientEmbed) return {ok: false, error: 'service_unavailable'};
        const raw = payload.data.guestPatientEmbed;
        const value = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
        if (value.error === 'account_expired') saveAccount(null);
        return value;
      } catch {return {ok: false, error: 'service_unavailable'};}
    },
  };
}
