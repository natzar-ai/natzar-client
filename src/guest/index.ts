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

export function createGuestClient(options: GuestClientOptions): GuestClient {
  if (!options.clinicId || !options.apiKey || /^(?:pp_|pk_(?:test|live)_)/.test(options.apiKey)) throw new TypeError('Pass a clinic id and the public AppSync API key');
  const endpoint = validateGuestUrl(options.graphqlUrl);
  if (endpoint.search) throw new TypeError('The GraphQL endpoint cannot contain a query');
  const send = options.fetch ?? globalThis.fetch;
  const locale = ({en: 'en_US', es: 'es_US', fr: 'fr_CH', de: 'de_CH', it: 'it_CH'} as Record<string, string>)[(options.locale ?? 'en').slice(0, 2).toLowerCase()] ?? 'en_US';
  const key = `natzar.guest.v1:${endpoint.origin}:${options.clinicId}`;
  let accountStore: GuestStorage | null = null;
  try {accountStore = typeof sessionStorage === 'undefined' ? null : sessionStorage;} catch { /* Memory-only login. */ }
  let account: GuestAccount | null = null, proposedAccount = '';
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
  async function invoke(action: GuestAction, input: Omit<GuestRequest, 'action' | 'credential'> = {}, idToken?: string): Promise<GuestResult> {
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
      if (result.ok) {
        try {cookieStore?.setExpiry?.(result.journey.expiresAt);} catch { /* Persistence is optional. */ }
        if (result.credential && result.credential.split('.')[1] !== credential.split('.')[1]) {saveAccount(null); proposedAccount = '';}
        remember(result.credential ?? credential);
        if (result.account) {saveAccount(result.account); proposedAccount = '';}
      }
      if (!result.ok && result.error === 'account_expired') {
        saveAccount(null);
        if (action === 'state' && stateAccount) {const retry = {...input}; delete retry.accountCredential; return invoke('state', retry, idToken);}
      }
      if (action === 'logout' && result.ok) remember('');
      return result;
    } catch {return {ok: false, error: 'service_unavailable'};}
    finally {clearTimeout(timeout);}
  }
  return {
    hasSavedJourney: () => !!credential,
    canRemember: () => !!cookieStore || !!options.rememberStorage,
    isRemembered: () => remembered,
    rememberOnDevice: enabled => {persistencePreference = enabled; remembered = enabled && (!!cookieStore || !!options.rememberStorage); remember(credential);},
    request: (action, input) => invoke(action, input),
    linkAccount: idToken => invoke('linkAccount', {}, idToken),
    handoffUrl: guestPageUrl => {
      const url = validateGuestUrl(guestPageUrl);
      if (url.pathname !== '/guest') throw new TypeError('The handoff must use the hosted guest page');
      url.searchParams.set('clinic', options.clinicId);
      if (credential) url.hash = new URLSearchParams({credential}).toString();
      return url.href;
    },
    forget: () => {remember(''); saveAccount(null); proposedAccount = ''; remembered = !!cookieStore && persistencePreference;},
    account: currentAccount,
    forgetAccount: () => saveAccount(null),
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
