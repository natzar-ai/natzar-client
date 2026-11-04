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
export type {GuestAttachment, GuestFile, GuestMessage, GuestUpload, GuestAccount, GuestAction, GuestRequest, GuestResult, GuestView, GuestIntake, GuestIntakeSelections, GuestIdentity, GuestSignup, GuestCare, GuestOffer, GuestPayment} from '../contract/guest';

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
  const accountKey = key + ':account';
  try {const raw = accountStore?.getItem(accountKey); if (raw) account = JSON.parse(raw) as GuestAccount;} catch { /* Invalid/blocked session storage. */ }
  if (!validAccount(account)) account = null;
  function saveAccount(value: GuestAccount | null) {
    account = value;
    try {if (value) accountStore?.setItem(accountKey, JSON.stringify(value)); else accountStore?.removeItem(accountKey);} catch { /* Continue in memory. */ }
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
  function rememberResult(result: Extract<GuestResult, {ok: true}>) {
    try {cookieStore?.setExpiry?.(result.journey.expiresAt);} catch { /* Persistence is optional. */ }
    if (result.credential && result.credential.split('.')[1] !== credential.split('.')[1]) {saveAccount(null); proposedAccount = '';}
    remember(result.credential ?? credential);
    if (result.account) {saveAccount(result.account); proposedAccount = '';}
    lastView = result.journey;
  }
  async function invoke(action: GuestAction, input: Omit<GuestRequest, 'action' | 'credential'> = {}, idToken?: string, observation?: AbortSignal): Promise<GuestResult> {
    const stateAccount = action === 'state' ? input.accountCredential ?? currentAccount()?.credential : undefined;
    if (['verifyLoginCode', 'verifyHistoryCode', 'verify', 'linkAccount'].includes(action) && !input.newAccountCredential) {
      const id = credential.split('.')[1];
      if (!proposedAccount) {
        const secret = new Uint8Array(32); globalThis.crypto.getRandomValues(secret);
        proposedAccount = `nac1.${id}.${btoa(String.fromCharCode(...secret)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
      }
      input = {...input, newAccountCredential: proposedAccount};
    }
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
      if (!result.ok && result.error === 'account_expired') {
        saveAccount(null);
        if (action === 'state' && stateAccount) {const retry = {...input}; delete retry.accountCredential; return invoke('state', retry, idToken);}
      }
      if (action === 'logout' && result.ok) remember('');
      return result;
    } catch {return {ok: false, error: 'service_unavailable'};}
    finally {clearTimeout(timeout); observation?.removeEventListener('abort', abandonObservation);}
  }
  async function request(action: GuestAction, input: Omit<GuestRequest, 'action' | 'credential'> = {}): Promise<GuestResult> {
    const generation = ++requestGeneration, expectedCredential = credential;
    const before = action === 'checkout' && lastView ? checkoutSnapshot(lastView) : null;
    const requestId = input.requestId ?? globalThis.crypto.randomUUID();
    const original = await invoke(action, {...input, requestId});
    const current = () => generation === requestGeneration && credential === expectedCredential;
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
  }
  return {
    hasSavedJourney: () => !!credential,
    canRemember: () => !!cookieStore || !!options.rememberStorage,
    isRemembered: () => remembered,
    rememberOnDevice: enabled => {persistencePreference = enabled; remembered = enabled && (!!cookieStore || !!options.rememberStorage); remember(credential);},
    request,
    linkAccount: idToken => {requestGeneration++; return invoke('linkAccount', {}, idToken);},
    handoffUrl: guestPageUrl => {
      const url = validateGuestUrl(guestPageUrl);
      if (url.pathname !== '/guest') throw new TypeError('The handoff must use the hosted guest page');
      url.searchParams.set('clinic', options.clinicId);
      if (credential) url.hash = new URLSearchParams({credential}).toString();
      return url.href;
    },
    forget: () => {requestGeneration++; lastView = null; remember(''); saveAccount(null); proposedAccount = ''; remembered = !!cookieStore && persistencePreference;},
    account: currentAccount,
    forgetAccount: () => {requestGeneration++; saveAccount(null);},
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
