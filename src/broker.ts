// The session broker behind the two browser entry points
// (`@natzar/client/patient`, `@natzar/client/physician`).
//
// It follows the element broker's rules (docs/EMBED-INTEGRATION-REDESIGN-PLAN.md
// §4.2) and the contract's failure tables, so a headless integration behaves
// like a tag:
//
// * ONE PLACE ASKS. Your `natzar()` endpoint (`POST {endpoint}/session`, the
//   `X-Natzar-Request: 1` header, `credentials: 'same-origin'`, no redirects
//   followed, `cache: 'no-store'`, `Authorization: Bearer <auth()>` when an
//   auth hook is set), or your own `getSession(ask)` for split-origin setups.
// * ITS OWN DEPLOYMENT. The partner, environment, zone and the API URLs come
//   from the endpoint's `GET {endpoint}/config` (or the `config` you pass with
//   `getSession`), never from a grant: every grant is checked against them
//   (`checkGrantAtClient`), and the credential is only ever sent to those URLs
//   (T16) — a grant naming another API cannot redirect it.
// * SINGLE-FLIGHT. However many calls notice at once that the credential is
//   due, one request goes out; everyone waits on it.
// * RENEWAL BY ITSELF. At `renewAfter` (60 s before the access credential
//   expires), on `visibilitychange` to visible, `focus`, `online`, and when an
//   operation answers `session_expired`. A renewal is allowed after access
//   expiry until the absolute limit, so a throttled background tab recovers;
//   past it the broker asks for a new logical session, which re-runs your
//   `identify`. What happens after a failed ask or operation is the
//   contract's table (`askFailureAction`, `operationFailureAction`): the
//   frames follow the same one.
// * SEALED. In a browser the broker holds a NON-EXTRACTABLE ECDH P-256 key
//   pair; the grant's credential is sealed to it and bound to this page
//   (partner, deployment, surface `headless`, `location.origin`, the key), so
//   your server, your page's other scripts and any fetch recorder only see
//   ciphertext, and a grant sealed for another page or key does not open.
//   `native: true` (React Native, no page, no Origin) takes the plain token of
//   surface `native` and needs a bearer (`auth`): there is no ambient
//   credential to rely on.
// * ANSWERS BY STATUS. 401 → signed out. 403 → the code. 429 → wait
//   `Retry-After`. 5xx or a network error → bounded backoff. A redirect, a
//   non-JSON answer or one without `X-Natzar-Endpoint: 1` →
//   `endpoint_misconfigured`, naming the placement rule: that was not the
//   middleware answering.
//
// Nothing here is a credential store: the `nz1` token lives in this closure,
// never in storage, a URL or a log line.

import {
  API_KEY_ZONES,
  DEPLOYMENT_ENVIRONMENT_REGEX,
  ENDPOINT_DEFAULT_PATH,
  ENDPOINT_ERROR_CODES,
  ENDPOINT_HEADER_VALUE,
  ENDPOINT_REQUEST_HEADER,
  ENDPOINT_RESPONSE_HEADER,
  ELEMENT_ERROR_MESSAGES,
  NZ1_SESSION_ID_REGEX,
  PARTNER_ID_REGEX,
  SESSION_RENEW_LEAD_SECONDS,
  askFailureAction,
  checkGrantAtClient,
  endpointRouteUrl,
  isConfigEndpoint,
  isLocalDevHost,
  operationFailureAction,
  type AskFailureCode,
  type ElementErrorCode,
  type EndpointErrorCode,
  type SessionAskReason,
  type SessionAudience,
  type SessionExpiredReason,
  type SessionZone,
} from './contract/sessions';
import {generateFrameKeyPair, unsealWithPrivateKey, type FrameKeyPair} from './contract/sessions-crypto';
import {NATIVE_SHELL_ORIGINS} from './contract/sessions-origins';
import type {EndpointSessionRequest, SessionConsultRef, SessionGrant} from './contract/sessions-schemas';
import {NatzarSessionError} from './session-error';

/** The `fetch` the broker uses. Injectable so tests need no network. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Returns the bearer your endpoint's `identify` reads as `ask.token` (a
 * Firebase / Auth0 / Supabase ID token). Read at EVERY session request, so a
 * refreshed token is picked up; return nothing when nobody is signed in.
 */
export type AuthHook = () => string | null | undefined | Promise<string | null | undefined>;

/** What the broker asks for: exactly the body of `POST {endpoint}/session`. */
export type SessionAsk = EndpointSessionRequest;

/**
 * Your own session source, for setups where the browser cannot reach a
 * `natzar()` middleware (rmc's split origin): take the ask (it carries the
 * `frameKey` for mint and renew alike), have your server call
 * `POST /v1/sessions`, return the grant unchanged. Throw an error whose `code`
 * is `signed_out` (or whose `status` is 401) when the user is signed out.
 */
export type GetSession = (ask: SessionAsk) => SessionGrant | Promise<SessionGrant>;

/**
 * The deployment a client talks to, from YOUR configuration (the middleware's
 * `GET {endpoint}/config`, or `nz.client.embed.config()` on your server plus
 * the API URL). A grant must match it; the credential goes only to its URLs.
 */
export interface ClientConfig {
  partnerId: string;
  environment: string;
  zone: SessionZone;
  /** The patient surface (AppSync). Required for `connectPatient`. */
  graphqlUrl?: string;
  /** The REST API through `/v1`. Required for `connectPhysician`. */
  apiUrl?: string;
}

/** Where sessions come from. */
export type SessionSource =
  | {
      /**
       * Your `natzar()` mount: a same-origin path (default `/natzar`), or an
       * absolute https URL for a cross-origin API (list the page origin in the
       * middleware's `origins`).
       */
      endpoint?: string;
      /** Bearer for `identify` (`ask.token`). Required with `native: true`. */
      auth?: AuthHook;
      /** Surface `native`: no page, no Origin, the plain token. Opt-in on both sides (D10). */
      native?: boolean;
      getSession?: undefined;
      config?: undefined;
    }
  | {
      /** Your own session source (see {@link GetSession}). */
      getSession: GetSession;
      /** The deployment your grants must belong to (see {@link ClientConfig}). */
      config: ClientConfig;
      /** Surface `native` (plain token) instead of `headless` (sealed). */
      native?: boolean;
      endpoint?: undefined;
      auth?: undefined;
    };

/** Why a session ended for good (`onExpired`); renewal already failed or was impossible. */
export type ExpiredReason = SessionExpiredReason;

/** The live session, as the entry points use it. */
export interface LiveSession {
  /** The `nz1` credential. Never log, store or put it in a URL. */
  token: string;
  /** The grant it came from (metadata only; its secret is already unsealed). */
  grant: SessionGrant;
  /** YOUR deployment's patient surface (never the grant's). */
  graphqlUrl?: string;
  /** YOUR deployment's REST API (never the grant's). */
  apiUrl?: string;
}

/** Public, credential-free facts about the current session. */
export interface SessionInfo {
  sessionId: string;
  surface: 'headless' | 'native';
  expiresAt: string;
  absoluteExpiresAt: string;
  scope: SessionGrant['scope'];
  capabilities: SessionGrant['capabilities'];
}

/** @internal */
export interface BrokerConfig {
  audience: SessionAudience;
  source: SessionSource;
  consult?: SessionConsultRef;
  patient?: string;
  fetch?: FetchLike;
  /** Per-request timeout of a session request. @defaultValue 15000 */
  timeoutMs?: number;
  onExpired?: (info: {reason: ExpiredReason; code: ElementErrorCode}) => void;
  /**
   * Revoke a session with ITS OWN credential (`SESSION_SELF_REVOKE`): called
   * with the previous session after a switch to a fresh one, so it does not
   * stay live unheld. Errors are ignored.
   */
  selfRevoke?: (previous: LiveSession) => Promise<unknown>;
}

const INITIAL_ATTEMPTS = 4;
const ROUND_ATTEMPTS = 4;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 60_000;
const RETRY_AFTER_CAP_S = 300;
const MAX_TIMER_MS = 2_147_483_647;

// The element code an operation's terminal answer ends the session with.
const OPERATION_END_CODES: Readonly<Record<string, ElementErrorCode>> = {
  session_invalid: 'session_revoked',
  session_revoked: 'session_revoked',
  session_ended: 'session_expired',
  session_locked: 'session_locked',
  embedding_disabled: 'embedding_disabled',
};

// Ask failures that mean "this user or page may not have a session".
const REFUSALS: ReadonlySet<ElementErrorCode> = new Set(['forbidden', 'origin_not_allowed', 'embedding_disabled', 'surface_not_allowed']);

type RoundReason = 'initial' | 'renew' | 'reconnect' | 'fresh';

type Outcome =
  | {kind: 'grant'; grant: unknown}
  | {kind: 'failure'; code: AskFailureCode; element: ElementErrorCode; waitMs?: number};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    unref(t);
  });

function unref(timer: unknown): void {
  (timer as {unref?: () => void} | null)?.unref?.();
}

function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt) * (0.5 + Math.random() / 2);
}

function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(RETRY_AFTER_CAP_S, Math.max(1, seconds)) * 1000;
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.min(RETRY_AFTER_CAP_S * 1000, Math.max(1000, at - Date.now())) : undefined;
}

// `AbortSignal.timeout` is missing on some React Native runtimes; no timeout
// beats a TypeError that would read as a network failure forever.
function timeoutSignal(ms: number): {signal?: AbortSignal} {
  const withTimeout = AbortSignal as unknown as {timeout?: (ms: number) => AbortSignal};
  return typeof withTimeout.timeout === 'function' ? {signal: withTimeout.timeout(ms)} : {};
}

function isJson(response: Response): boolean {
  const type = response.headers.get('content-type') ?? '';
  return type.split(';')[0].trim().toLowerCase() === 'application/json';
}

function deploymentUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2_048) return false;
  try {
    const u = new URL(value);
    if (u.username !== '' || u.password !== '' || u.hash !== '') return false;
    return u.protocol === 'https:' || (u.protocol === 'http:' && isLocalDevHost(u.hostname));
  } catch {
    return false;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A {@link ClientConfig} from untrusted JSON (the endpoint's `/config`), or
 * null. Checked by hand: this entry ships to browsers without zod.
 *
 * @internal exported for tests
 */
export function parseClientConfig(raw: unknown): ClientConfig | null {
  if (!isObject(raw)) return null;
  const {partnerId, environment, zone, graphqlUrl, apiUrl} = raw;
  if (typeof partnerId !== 'string' || !PARTNER_ID_REGEX.test(partnerId)) return null;
  if (typeof environment !== 'string' || !DEPLOYMENT_ENVIRONMENT_REGEX.test(environment)) return null;
  if (!(API_KEY_ZONES as readonly unknown[]).includes(zone)) return null;
  if (graphqlUrl !== undefined && !deploymentUrl(graphqlUrl)) return null;
  if (apiUrl !== undefined && !deploymentUrl(apiUrl)) return null;
  return {
    partnerId,
    environment,
    zone: zone as SessionZone,
    ...(graphqlUrl !== undefined ? {graphqlUrl} : {}),
    ...(apiUrl !== undefined ? {apiUrl: apiUrl.replace(/\/+$/, '')} : {}),
  };
}

// The minimal shape `checkGrantAtClient` may safely read (it expects a
// schema-parsed grant; this entry does not bundle zod).
function grantShape(raw: unknown): raw is SessionGrant {
  if (!isObject(raw) || !isObject(raw.scope)) return false;
  if (typeof raw.sessionId !== 'string' || !NZ1_SESSION_ID_REGEX.test(raw.sessionId)) return false;
  const renew = Date.parse(String(raw.renewAfter));
  const expires = Date.parse(String(raw.expiresAt));
  const absolute = Date.parse(String(raw.absoluteExpiresAt));
  if (!(Number.isFinite(renew) && Number.isFinite(expires) && Number.isFinite(absolute) && renew <= expires && expires <= absolute)) return false;
  return Array.isArray(raw.capabilities) && Array.isArray(raw.unavailable);
}

/**
 * The broker. One per connected client.
 *
 * @internal used by `connectPatient` / `connectPhysician`
 */
export class SessionBroker {
  private readonly surface: 'headless' | 'native';
  private readonly endpoint: string | null;
  private readonly doFetch: FetchLike;
  private deployment: ClientConfig | null = null;
  private keyPair: FrameKeyPair | null = null;
  private live: LiveSession | null = null;
  private renewAfterMs = 0;
  private expiresAtMs = 0;
  private absoluteMs = 0;
  private inflight: {reason: RoundReason; promise: Promise<LiveSession>; generation: number} | null = null;
  private generation = 0;
  private ended: {reason: ExpiredReason; code: ElementErrorCode} | null = null;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failedRounds = 0;
  private waiters: Array<() => void> = [];
  private readonly detach: Array<() => void> = [];

  private constructor(private readonly config: BrokerConfig) {
    this.surface = config.source.native ? 'native' : 'headless';
    const source = config.source;
    if (source.getSession !== undefined) {
      if (typeof source.getSession !== 'function') throw new NatzarSessionError('getSession must be a function.', 'attribute_invalid');
      const deployment = parseClientConfig(source.config);
      if (!deployment) {
        throw new NatzarSessionError(
          'getSession needs `config`: {partnerId, environment, zone, graphqlUrl (patient) / apiUrl (clinician)} — your deployment, from nz.client.embed.config() on your server.',
          'attribute_invalid',
        );
      }
      this.deployment = deployment;
      this.endpoint = null;
    } else {
      const endpoint = source.endpoint ?? ENDPOINT_DEFAULT_PATH;
      if (!isConfigEndpoint(endpoint, {production: false})) {
        throw new NatzarSessionError(
          `endpoint must be a same-origin path such as ${ENDPOINT_DEFAULT_PATH} or an absolute https URL without a trailing slash; got "${String(endpoint).slice(0, 80)}".`,
          'endpoint_invalid',
        );
      }
      if (this.surface === 'native' && typeof source.auth !== 'function') {
        throw new NatzarSessionError(
          'native: true needs an auth hook: a native request has no Origin and no ambient credential, so your endpoint accepts it only with a bearer.',
          'attribute_invalid',
        );
      }
      this.endpoint = endpoint;
    }
    const f = config.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!f) throw new NatzarSessionError('No fetch implementation available.', 'network_error');
    this.doFetch = (input, init) => f(input, init);
  }

  /** Create a broker, learn its deployment and obtain its first session (bounded retries). */
  static async start(config: BrokerConfig): Promise<SessionBroker> {
    const broker = new SessionBroker(config);
    // A web page gets the sealed `headless` surface, never the plain token
    // (RG5 S4, T4): `native` is for apps with no page or a native shell's.
    const page = broker.pageOrigin();
    if (broker.surface === 'native' && page !== null && !(NATIVE_SHELL_ORIGINS as readonly string[]).includes(page)) {
      throw new NatzarSessionError(
        'native: true is for apps without a web page (React Native, a Capacitor/Ionic shell). In a browser use the default headless mode: the session is sealed to this page.',
        'attribute_invalid',
      );
    }
    if (broker.surface === 'headless') {
      if (broker.pageOrigin() === null) {
        throw new NatzarSessionError(
          'A headless session is bound to the page origin, and there is no page here. Outside a browser use native: true (with an auth hook).',
          'origin_rejected',
        );
      }
      try {
        broker.keyPair = await generateFrameKeyPair();
      } catch {
        throw new NatzarSessionError('WebCrypto (ECDH P-256) is unavailable, so the session cannot be sealed to this page.', 'unseal_failed');
      }
    }
    if (!broker.deployment) broker.deployment = await broker.loadConfig();
    const need = config.audience === 'patient' ? 'graphqlUrl' : 'apiUrl';
    if (!broker.deployment[need]) {
      throw new NatzarSessionError(
        `The deployment configuration has no ${need}; ${config.audience === 'patient' ? 'connectPatient' : 'connectPhysician'} cannot know where to send the session.`,
        'session_grant_invalid',
      );
    }
    await broker.refresh('initial');
    broker.installTriggers();
    return broker;
  }

  /** Credential-free facts about the current session, or null before one exists. */
  info(): SessionInfo | null {
    const g = this.live?.grant;
    if (!g) return null;
    return {
      sessionId: g.sessionId,
      surface: this.surface,
      expiresAt: g.expiresAt,
      absoluteExpiresAt: g.absoluteExpiresAt,
      scope: g.scope,
      capabilities: g.capabilities,
    };
  }

  /** The live session without renewing (null once ended). For synchronous accessors only. */
  peek(): LiveSession | null {
    return this.isEnded() ? null : this.live;
  }

  /** Whether the broker gave up (until `reconnect()`). */
  isEnded(): boolean {
    return this.ended !== null || this.closed;
  }

  /**
   * A usable session: the current one while its access credential is valid,
   * otherwise a renewal (or, past the absolute limit, a new logical session).
   * Rejects with a {@link NatzarSessionError} once the broker has ended.
   */
  async current(): Promise<LiveSession> {
    this.assertUsable();
    if (this.live && Date.now() < this.expiresAtMs) return this.live;
    return this.refresh(this.live && Date.now() < this.absoluteMs ? 'renew' : 'reconnect');
  }

  /**
   * What to do after an operation failed with `code`, per the contract's
   * `operationFailureAction`: a session to retry ONCE with, or null (rethrow).
   * `session_expired` renews; `session_renewal_required` (a video join that
   * needs more session time, §4.11) switches to a fresh session; the
   * terminal codes end the broker with `onExpired`. A fresh switch that fails
   * leaves the current session in place (the contract's `fresh` row): signed
   * out on your site, the call rejects with `signed_out` ("sign in again");
   * otherwise the join's own refusal reaches the caller. Join anyway comes
   * only from that refusal (`joinAnywayOf`), never from a failed switch.
   */
  async recover(code: unknown, failedToken?: string, details?: unknown): Promise<LiveSession | null> {
    if (this.isEnded()) return null;
    const action = operationFailureAction(code);
    // D12: when YOUR login is the limit a fresh session could not help; the
    // caller offers "Join anyway" (`acceptShortSession`) instead (joinAnywayOf).
    if (action.action === 'fresh' && isObject(details) && details.joinAnywayAllowed === true) return null;
    if (action.action === 'expired') {
      this.end(action.reason, OPERATION_END_CODES[String(code)] ?? 'session_revoked');
      return null;
    }
    if (action.action !== 'renew' && action.action !== 'fresh') return null;
    // Another caller already replaced the credential this one failed with.
    if (action.action === 'renew' && failedToken !== undefined && this.live && this.live.token !== failedToken && Date.now() < this.expiresAtMs) {
      return this.live;
    }
    const reason: RoundReason = action.action === 'fresh' ? 'fresh' : this.live && Date.now() < this.absoluteMs ? 'renew' : 'reconnect';
    return this.refresh(reason).catch((e: unknown) => {
      // The contract's `fresh` × `signed_out`: a state for the caller, not an end of the broker.
      if (reason === 'fresh' && e instanceof NatzarSessionError && e.code === 'signed_out' && !this.isEnded()) throw e;
      return null;
    });
  }

  /** Resolves once the broker is live again (after `reconnect()`); rejects on abort. */
  untilLive(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.isEnded()) return resolve();
      if (signal.aborted) return reject(signal.reason ?? new Error('aborted'));
      const wake = () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        this.waiters = this.waiters.filter((w) => w !== wake);
        reject(signal.reason ?? new Error('aborted'));
      };
      this.waiters.push(wake);
      signal.addEventListener('abort', onAbort, {once: true});
    });
  }

  /**
   * Start over with a NEW logical session (your `identify` runs again) —
   * after `onExpired`, typically once the user signed back in. Wakes parked
   * subscriptions on success.
   */
  async reconnect(): Promise<void> {
    if (this.closed) throw new NatzarSessionError(ELEMENT_ERROR_MESSAGES.not_connected, 'not_connected');
    this.ended = null;
    this.failedRounds = 0;
    await this.refresh('reconnect');
    const waiting = this.waiters;
    this.waiters = [];
    waiting.forEach((wake) => wake());
  }

  /** Stop renewing and drop the credential. The client is unusable afterwards. */
  close(): void {
    this.closed = true;
    this.live = null;
    this.generation += 1;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.detach.splice(0).forEach((off) => off());
  }

  // ------------------------------------------------------------------ rounds

  private assertUsable(): void {
    if (this.closed) throw new NatzarSessionError(ELEMENT_ERROR_MESSAGES.not_connected, 'not_connected');
    if (this.ended) throw new NatzarSessionError(ELEMENT_ERROR_MESSAGES[this.ended.code], this.ended.code);
  }

  // Single-flight: a request of the same kind joins the one in flight; a
  // reconnect or fresh session supersedes a renewal still backing off (the
  // operation that asked knows the session is gone or too short).
  private refresh(reason: RoundReason): Promise<LiveSession> {
    const running = this.inflight;
    if (running && (running.reason === reason || running.reason !== 'renew' || reason === 'renew')) return running.promise;
    const generation = ++this.generation;
    const promise = this.round(reason, generation).finally(() => {
      if (this.inflight?.generation === generation) this.inflight = null;
    });
    this.inflight = {reason, promise, generation};
    return promise;
  }

  private async round(reason: RoundReason, generation: number): Promise<LiveSession> {
    const attempts = reason === 'initial' ? INITIAL_ATTEMPTS : ROUND_ATTEMPTS;
    // A renewal cannot outlive the absolute limit: past it, ask for a new session.
    let kind: SessionAskReason = reason === 'renew' && !(this.live && Date.now() < this.absoluteMs) ? 'reconnect' : reason;
    let reconnected = kind === 'reconnect';
    let last: ElementErrorCode = 'unavailable';
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (this.closed || generation !== this.generation) return this.superseded();
      const ask = this.ask(kind);
      let outcome = await this.request(ask);
      if (this.closed || generation !== this.generation) return this.superseded();
      if (outcome.kind === 'grant') {
        const previous = this.live;
        const installed = await this.install(outcome.grant, ask);
        if (installed.ok) {
          this.failedRounds = 0;
          // The pre-join switch leaves the old session live: revoke it with its own credential.
          if (reason === 'fresh' && previous && previous.grant.sessionId !== installed.live.grant.sessionId && this.config.selfRevoke) {
            void this.config.selfRevoke(previous).catch(() => undefined);
          }
          return installed.live;
        }
        outcome = {kind: 'failure', code: 'grant_rejected', element: installed.code};
      }
      last = outcome.element;
      const action = askFailureAction(kind, outcome.code, {idleLocked: false});
      switch (action.action) {
        case 'retry':
          if (attempt + 1 < attempts) await sleep(outcome.waitMs ?? backoffMs(attempt));
          continue;
        case 'reconnect':
          // The renewed session is dead or refused: ONE new logical session decides.
          if (reconnected) throw this.end('revoked', outcome.element);
          reconnected = true;
          kind = 'reconnect';
          attempt = -1;
          continue;
        case 'signed_out':
          // A first connect rejects; a failed `fresh` switch is the "sign in
          // again on <site>" state while the current session keeps working
          // (the contract's row, RG4B N4); anything else ends the broker.
          if (reason === 'initial' || reason === 'fresh') throw new NatzarSessionError(ELEMENT_ERROR_MESSAGES.signed_out, 'signed_out');
          throw this.end('signed_out', 'signed_out');
        case 'expired':
          throw this.end(action.reason, outcome.element);
        default:
          // `error` (and `keep_call`/`join_anyway`, which no SDK ask gets):
          // stop. A refusal of the user or the page reads as `revoked`.
          if (reason === 'initial' || reason === 'fresh') throw new NatzarSessionError(ELEMENT_ERROR_MESSAGES[outcome.element], outcome.element);
          throw this.end(
            this.live && Date.now() >= this.absoluteMs ? 'absolute' : REFUSALS.has(outcome.element) ? 'revoked' : 'access',
            outcome.element,
          );
      }
    }
    // Bounded: this round gave up. A first connect rejects; a fresh session
    // leaves the current one in place; a running client tries again later
    // (the next round asks for a new session).
    if (reason === 'initial' || reason === 'fresh') throw new NatzarSessionError(ELEMENT_ERROR_MESSAGES[last], last);
    // Transient: try the SAME kind again later. A renewal stays a renewal
    // until the absolute limit (RG5 S5): no new logical session, no mint
    // budget spent, no orphaned session.
    this.failedRounds += 1;
    this.schedule(backoffMs(this.failedRounds + 2));
    throw new NatzarSessionError(ELEMENT_ERROR_MESSAGES[last], last);
  }

  // A round overtaken by a newer one hands its waiters the newer round.
  private superseded(): Promise<LiveSession> {
    if (this.closed) throw new NatzarSessionError(ELEMENT_ERROR_MESSAGES.connect_aborted, 'connect_aborted');
    if (this.inflight) return this.inflight.promise;
    return this.current();
  }

  private ask(reason: SessionAskReason): SessionAsk {
    const ask: SessionAsk = {
      audience: this.config.audience,
      surface: this.surface,
      sessionId: reason === 'renew' && this.live ? this.live.grant.sessionId : null,
      reason,
    };
    if (this.keyPair) ask.frameKey = this.keyPair.publicJwk;
    if (this.config.consult) ask.consult = this.config.consult;
    if (this.config.patient !== undefined) ask.patient = this.config.patient;
    return ask;
  }

  private end(reason: ExpiredReason, code: ElementErrorCode): NatzarSessionError {
    if (!this.ended && !this.closed) {
      this.ended = {reason, code};
      if (this.timer !== undefined) clearTimeout(this.timer);
      this.timer = undefined;
      // Only a session that existed can expire; a failed first connect rejects instead.
      if (this.live) {
        try {
          this.config.onExpired?.({reason, code});
        } catch {
          /* a throwing callback must not break the broker */
        }
      }
    }
    return new NatzarSessionError(ELEMENT_ERROR_MESSAGES[code], code);
  }

  private async install(raw: unknown, ask: SessionAsk): Promise<{ok: true; live: LiveSession} | {ok: false; code: ElementErrorCode}> {
    const d = this.deployment!;
    if (!grantShape(raw)) return {ok: false, code: 'session_grant_invalid'};
    const pageOrigin = this.surface === 'headless' ? this.pageOrigin() : null;
    const checked = checkGrantAtClient(raw, {
      audience: this.config.audience,
      surface: this.surface,
      environment: d.environment,
      zone: d.zone,
      partnerId: d.partnerId,
      pageOrigin,
      sessionId: ask.reason === 'renew' ? ask.sessionId : null,
      consult: this.config.consult ?? null,
      patient: this.config.patient ?? null,
    });
    if (!checked.ok) return {ok: false, code: checked.code};
    const grant = raw;
    let token: string;
    if (this.surface === 'native') {
      token = grant.sessionToken as string;
    } else {
      try {
        // The binding is rebuilt from OUR facts: a grant sealed for another
        // page, surface, deployment or key does not open (RG0 F1, T5).
        token = await unsealWithPrivateKey(grant.sealedToken!, this.keyPair!, {
          partnerId: d.partnerId,
          environment: d.environment,
          zone: d.zone,
          audience: this.config.audience,
          surface: 'headless',
          sessionId: grant.sessionId,
          parentOrigin: pageOrigin!,
          frameUrl: null,
        });
      } catch {
        return {ok: false, code: 'unseal_failed'};
      }
    }
    this.live = {
      token,
      grant,
      ...(d.graphqlUrl ? {graphqlUrl: d.graphqlUrl} : {}),
      ...(d.apiUrl ? {apiUrl: d.apiUrl} : {}),
    };
    this.renewAfterMs = Date.parse(grant.renewAfter);
    this.expiresAtMs = Date.parse(grant.expiresAt);
    this.absoluteMs = Date.parse(grant.absoluteExpiresAt);
    this.scheduleNext();
    return {ok: true, live: this.live};
  }

  // ----------------------------------------------------------------- timers

  private scheduleNext(): void {
    // Renew at `renewAfter`; within a lead of the absolute limit renewal can
    // no longer help, so the next step is a new session just before it.
    const lead = SESSION_RENEW_LEAD_SECONDS * 1000;
    const at = this.renewAfterMs < this.absoluteMs - lead ? this.renewAfterMs : this.absoluteMs - lead;
    this.schedule(at - Date.now());
  }

  private schedule(delayMs: number): void {
    if (this.closed || this.ended) return;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.onDue();
    }, Math.min(MAX_TIMER_MS, Math.max(0, delayMs)));
    unref(this.timer);
  }

  private onDue(): void {
    if (this.closed || this.ended) return;
    // Renew until the absolute limit; only in its last minute is the next step
    // a new session (renewal cannot extend it). Never after a transient failure.
    const lead = SESSION_RENEW_LEAD_SECONDS * 1000;
    const reason: RoundReason = this.live && Date.now() < this.absoluteMs - lead ? 'renew' : 'reconnect';
    this.refresh(reason).catch(() => {
      /* scheduled again by the round, or ended with onExpired */
    });
  }

  // Renewal triggers besides the timer: a tab coming back, focus, network.
  private installTriggers(): void {
    const onWake = () => {
      if (this.closed || this.ended || !this.live) return;
      if (Date.now() >= this.renewAfterMs) this.onDue();
    };
    const doc = (globalThis as {document?: {visibilityState?: string; addEventListener?: EventTarget['addEventListener']; removeEventListener?: EventTarget['removeEventListener']}}).document;
    if (doc?.addEventListener && doc.removeEventListener) {
      const onVisible = () => {
        if (doc.visibilityState === 'visible') onWake();
      };
      doc.addEventListener('visibilitychange', onVisible);
      this.detach.push(() => doc.removeEventListener!('visibilitychange', onVisible));
    }
    const win = globalThis as {addEventListener?: EventTarget['addEventListener']; removeEventListener?: EventTarget['removeEventListener']};
    if (typeof win.addEventListener === 'function' && typeof win.removeEventListener === 'function') {
      for (const type of ['focus', 'online']) {
        win.addEventListener(type, onWake);
        this.detach.push(() => win.removeEventListener!(type, onWake));
      }
    }
  }

  private pageOrigin(): string | null {
    const origin = (globalThis as {location?: {origin?: unknown}}).location?.origin;
    return typeof origin === 'string' && origin !== 'null' ? origin : null;
  }

  // ---------------------------------------------------------------- request

  private endpointFetch(route: 'session' | 'config', init: RequestInit): Promise<Response> {
    return this.doFetch(endpointRouteUrl(this.endpoint!, route), {
      ...init,
      // Native is bearer-only: no cookie may ride along (RG5 S3).
      credentials: this.surface === 'native' ? 'omit' : 'same-origin',
      // Not followed: a login redirect is a misplaced middleware, and must
      // say so rather than parse a login page (the plan's `redirect:'error'`
      // hides that as a network error; `manual` lets us name it).
      redirect: 'manual',
      cache: 'no-store',
      ...timeoutSignal(this.config.timeoutMs ?? 15_000),
    });
  }

  // `GET {endpoint}/config`: the deployment this client belongs to.
  private async loadConfig(): Promise<ClientConfig> {
    let last: ElementErrorCode = 'unavailable';
    for (let attempt = 0; attempt < INITIAL_ATTEMPTS; attempt++) {
      let response: Response;
      try {
        response = await this.endpointFetch('config', {method: 'GET', headers: {Accept: 'application/json'}});
      } catch {
        last = 'network_error';
        if (attempt + 1 < INITIAL_ATTEMPTS) await sleep(backoffMs(attempt));
        continue;
      }
      if (response.status >= 500 || response.status === 429) {
        last = response.status === 429 ? 'rate_limited' : 'unavailable';
        if (attempt + 1 < INITIAL_ATTEMPTS) await sleep(retryAfterMs(response.headers.get('retry-after')) ?? backoffMs(attempt));
        continue;
      }
      if (response.status !== 200 || response.headers.get(ENDPOINT_RESPONSE_HEADER) !== ENDPOINT_HEADER_VALUE || !isJson(response)) {
        this.misconfigured();
        throw new NatzarSessionError(ELEMENT_ERROR_MESSAGES.endpoint_misconfigured, 'endpoint_misconfigured');
      }
      const config = parseClientConfig(await response.json().catch(() => null));
      if (!config) throw new NatzarSessionError(ELEMENT_ERROR_MESSAGES.session_grant_invalid, 'session_grant_invalid');
      return config;
    }
    throw new NatzarSessionError(ELEMENT_ERROR_MESSAGES[last], last);
  }

  private async request(ask: SessionAsk): Promise<Outcome> {
    const source = this.config.source;
    if (source.getSession !== undefined) {
      try {
        return {kind: 'grant', grant: await source.getSession(ask)};
      } catch (e) {
        const err = e as {code?: unknown; status?: unknown} | null;
        if (err?.code === 'signed_out' || err?.status === 401) return {kind: 'failure', code: 'signed_out', element: 'signed_out'};
        if (typeof err?.code === 'string' && (ENDPOINT_ERROR_CODES as readonly string[]).includes(err.code)) {
          const code = err.code as EndpointErrorCode;
          return {kind: 'failure', code, element: code};
        }
        return {kind: 'failure', code: 'session_callback_failed', element: 'session_callback_failed'};
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      [ENDPOINT_REQUEST_HEADER]: ENDPOINT_HEADER_VALUE,
    };
    if (source.auth) {
      let bearer: string | null | undefined;
      try {
        bearer = await source.auth();
      } catch {
        bearer = null;
      }
      if (typeof bearer === 'string' && bearer !== '') headers.Authorization = `Bearer ${bearer}`;
    }
    let response: Response;
    try {
      response = await this.endpointFetch('session', {method: 'POST', headers, body: JSON.stringify(ask)});
    } catch {
      return {kind: 'failure', code: 'network_error', element: 'network_error'};
    }
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) return this.misconfigured();
    if (response.headers.get(ENDPOINT_RESPONSE_HEADER) !== ENDPOINT_HEADER_VALUE || !isJson(response)) {
      // A 502–504 from a proxy in front of a healthy middleware is an outage, not a placement mistake.
      if (response.status >= 502 && response.status <= 504) return {kind: 'failure', code: 'unavailable', element: 'unavailable'};
      return this.misconfigured();
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return this.misconfigured();
    }
    if (response.status === 200 || response.status === 201) return {kind: 'grant', grant: body};
    const code: EndpointErrorCode = isObject(body) && typeof body.error === 'string' && (ENDPOINT_ERROR_CODES as readonly string[]).includes(body.error)
      ? (body.error as EndpointErrorCode)
      : 'unavailable';
    if (response.status === 401) return {kind: 'failure', code: 'signed_out', element: 'signed_out'};
    if (response.status === 429) {
      return {kind: 'failure', code: 'rate_limited', element: 'rate_limited', waitMs: retryAfterMs(response.headers.get('retry-after')) ?? BACKOFF_BASE_MS};
    }
    if (response.status >= 500) return {kind: 'failure', code: 'unavailable', element: 'unavailable'};
    if (response.status === 403) {
      const refused = code === 'unavailable' || code === 'rate_limited' || code === 'signed_out' ? 'forbidden' : code;
      return {kind: 'failure', code: refused, element: refused};
    }
    return this.misconfigured();
  }

  private misconfigured(): Outcome {
    const log = (globalThis as {console?: {error?: (...a: unknown[]) => void}}).console?.error;
    log?.(
      `[natzar] ${ELEMENT_ERROR_MESSAGES.endpoint_misconfigured} ` +
        "Express: app.use('/natzar', natzar({...})) after your session middleware and before express.json(), csurf/lusca and login redirects; " +
        'Next.js: exclude /natzar/ from the matcher of middleware.ts (proxy.ts since Next.js 16).',
    );
    return {kind: 'failure', code: 'endpoint_misconfigured', element: 'endpoint_misconfigured'};
  }
}
