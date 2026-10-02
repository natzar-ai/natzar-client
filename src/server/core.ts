// The `natzar()` middleware's core: every rule of plan §4.7, once, framework
// free. The adapters in ./index turn Express/Connect/Node, Fetch runtimes and
// the Next.js App Router into a CoreRequest and write the CoreResponse back.
//
// What this file guarantees, in the plan's numbering (§4.7 built-in rules):
//
//  1. Routes: `POST /session`, `POST /start` (only with `onStart`), `GET
//     /embed.js`, `GET /config`, `POST /webhook` (only with `onEvent`); the
//     route is the LAST path segment below the mount. Everything else is 404.
//  2. `POST` + `application/json` + body ≤ 4 KB + `X-Natzar-Request: 1`. Same
//     origin is proven by `Sec-Fetch-Site: same-origin`, else by the `Origin`
//     host equalling `Host`; cross-origin only from `origins`, with CORS only
//     for them; no `Origin` only for surface `native` with a bearer.
//  3. The body is exactly the M0 endpoint schema, and its surface must be in
//     `surfaces`.
//  4. `identify`'s answer for the other audience is 403; an `ask.patient`
//     that differs from the returned `externalId` is 403.
//  5. `loginRef = sha256('natzar-login:' + login)` (the raw login stays here).
//  6. `parentOrigin` is the VERIFIED `Origin` (null for `native`).
//  7. No browser header is ever forwarded: the Natzar call is built fresh.
//  8. Every answer carries `no-store`, `nosniff` and `X-Natzar-Endpoint: 1`;
//     errors are `{error: <allowlisted code>}` and never echo a body.
//  9. Logs carry codes only (no ids, tokens, bodies or PHI).
// 10. A best-effort in-memory limit per `loginRef` (Natzar's are authoritative).
// 11. Webhooks: HMAC over the RAW body, 5 min tolerance, at-least-once with an
//     optional `dedupe`, a throwing handler answers 500, a body some parser
//     already consumed fails loudly with the fix.
// 12. (./browser + package.json) a browser bundle fails at build.
// 13. `GET /v1/embed/config` cached per instance for 5 minutes.
//
// A misplaced middleware (after a body parser, a CSRF guard or a login
// redirect) is answered WITHOUT `X-Natzar-Endpoint`, so the element reports
// `endpoint_misconfigured` in the browser console, and the server logs the
// fix once.

import {NatzarClient} from '../client';
import {isNatzarApiError} from '../errors';
import type {FetchLike} from '../http';
import {NatzarSessionError} from '../session-error';
import {verifyWebhook, DEFAULT_TOLERANCE_SECONDS} from '../webhooks';
import {WEBHOOK_SIGNATURE_HEADER, type WebhookEvent} from '../contract/webhooks';
import {
  ENDPOINT_CONFIG_CACHE_SECONDS,
  ENDPOINT_ERROR_HTTP_STATUS,
  ENDPOINT_HEADER_VALUE,
  ENDPOINT_LOADER_CACHE_CONTROL,
  ENDPOINT_MAX_BODY_BYTES,
  ENDPOINT_REQUEST_HEADER,
  ENDPOINT_RESPONSE_HEADER,
  ENDPOINT_RESPONSE_HEADERS,
  MIDDLEWARE_DEFAULT_SURFACES,
  SESSION_RATE_LIMITS,
  SESSION_SURFACES,
  endpointErrorFor,
  isEndpointPath,
  type ClinicianCapability,
  type EndpointErrorCode,
  type ProviderView,
  type SessionAudience,
  type SessionConsultKind,
  type SessionSurface,
} from '../contract/sessions';
import {
  createSessionRequestSchema,
  embedConfigSchemaFor,
  endpointSessionRequestSchema,
  endpointStartRequestSchema,
  sessionConsultRefSchema,
  sessionGrantSchema,
  type CreateSessionRequest,
  type EmbedConfig,
  type SessionClinicianRef,
  type SessionConsultRef,
  type SessionGrant,
} from '../contract/sessions-schemas';
import {NATIVE_SHELL_ORIGINS, isCanonicalParentOrigin} from '../contract/sessions-origins';
import {loginRefFor} from '../contract/sessions-crypto';
import {upsertPatientSchema} from '../contract/schemas';
import type {AsyncConsultResource, TelehealthConsultResource} from '../contract/resources';
import type {CreateAsyncConsultRequest} from '../contract/endpoints';

// --------------------------------------------------------------------- types

/**
 * Your framework's request object — an Express/Connect/Node `req`, or a Fetch
 * `Request` (Hono's `c.req.raw`, Workers, Bun, Deno, Remix, SvelteKit,
 * Next.js). Typed loosely on purpose: your framework's own request type (with
 * `req.user` from passport, `req.session` from express-session) is what your
 * `identify` works with; pass it as the type parameter to `natzar<Req>()`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRequest = any;

/** What the element (or `connect*`) asks for; handed to `identify` as `ask`. */
export interface IdentifyAsk {
  /** `patient` or `clinician`: check it against YOUR user's role. */
  audience: SessionAudience;
  /** The surface asked for (already in your `surfaces`). */
  surface: SessionSurface;
  /** The element's `consult` attribute: veto it (return nothing) if this login may not see it. */
  consult?: SessionConsultRef;
  /** The `patient` attribute (guardian, family): return that patient only if this login may act for it. */
  patient?: string;
  /** The bearer from `window.natzarConfig.auth` (or `connect*({auth})`): verify it yourself. */
  token?: string;
  /** `<natzar-provider view>`: the provider module asked for. */
  view?: ProviderView;
}

/**
 * A patient, by YOUR id. `externalId` alone means the patient must already
 * exist; with `phone` (and any of the rest) it is an idempotent upsert,
 * skipped when nothing changed. `null`/`undefined` fields are dropped.
 *
 * Prefer a `'YYYY-MM-DD'` string for `birthdate`. A `Date` is accepted only
 * when it is unambiguous: midnight UTC (its UTC date is used) or midnight in
 * this server's time zone, as node-postgres parses a `DATE` column (its local
 * date is used). Any other time of day is refused rather than guessed: a
 * birthdate off by one day reaches eRx matching, referral documents and the
 * date-of-birth gate.
 *
 * Typed as plain strings so your own user type fits as it is; the values are
 * validated before anything is sent (`phone` E.164, `birthdate`
 * `YYYY-MM-DD`, `sex` `male`/`female`, `lang` `en_US`/`es_US`/`de_CH`/
 * `fr_CH`/`it_CH`). A value that fails is logged by FIELD name
 * (`identify_result_invalid:patient.sex`) and answered `unavailable`.
 */
export interface PatientIdentity {
  externalId: string;
  phone?: string | null;
  email?: string | null;
  givenName?: string | null;
  familyName?: string | null;
  birthdate?: string | Date | null;
  sex?: string | null;
  lang?: string | null;
  state?: string | null;
  country?: string | null;
}

/** A clinician: your `externalId` or our `physicianId`. Must already exist (D6). */
export type ClinicianIdentity = SessionClinicianRef;

/** What `identify` returns for a signed-in user. */
export interface Identity {
  /** For `ask.audience === 'patient'`. */
  patient?: PatientIdentity;
  /** For `ask.audience === 'clinician'`. */
  clinician?: ClinicianIdentity;
  /** Narrow the session to one consult (`{kind, id}`, `'async:<id>'`, or an id of the surface's kind). */
  consult?: SessionConsultRef | string;
  /** `verified` delegation only: the clinician's current Natzar ID token. */
  clinicianToken?: string;
  /**
   * Your login/session id (a non-empty string, at most 1024 characters, or a
   * finite number): renewals must come from the same login, and
   * `revokeLogin(login)` ends them. Anything else (an object, `true`) is
   * refused: it would hash every user into one shared `loginRef`.
   */
  login?: string | number | null;
  /**
   * When your login ends: a `Date`, an ISO string or epoch MILLISECONDS; the
   * session never outlives it. A number below 1e11 (epoch SECONDS, a JWT
   * `exp`) is refused loudly rather than read as 1970: multiply by 1000.
   */
  until?: Date | string | number | null | false;
  /** Clinicians: narrow the capabilities (default: the policy's set for the surface). */
  capabilities?: readonly ClinicianCapability[];
}

/** `identify`'s answer: an {@link Identity}, or anything falsy for "not signed in" (401). */
export type IdentifyResult = Identity | null | undefined | false | 0 | '';

/** The in-widget Start being asked for (D1). */
export interface StartAsk {
  /** What to open. */
  kind: SessionConsultKind;
  /** Telehealth: the waiting room (`queue`, default) or a booking (`scheduled`). */
  mode?: 'queue' | 'scheduled';
  /** The tag asking. */
  surface: 'async' | 'telehealth' | 'agent';
}

/** `onStart`'s answer: `false`/nothing refuses, `true` opens, `{context}` opens with a handoff note. */
export type StartDecision = boolean | {context?: string} | null | undefined;

/** Optional dedupe of webhook deliveries (at-least-once). */
export interface WebhookDedupe {
  /** True when `id` was already processed; mark it as seen in the same step (e.g. `SET NX`). */
  seen(id: string): boolean | Promise<boolean>;
  /** Called when your handler threw after `seen` marked the id, so the retry is not swallowed. */
  forget?(id: string): void | Promise<void>;
}

/** One codes-only log line. */
export interface NatzarLogEntry {
  /** A fixed code, e.g. `identify_failed`, `upstream_session_revoked`, `endpoint_misconfigured`. */
  code: string;
  /** The middleware route, when there is one. */
  route?: string;
  /** An HTTP status, when relevant. */
  status?: number;
}

/** Options of `natzar()`. */
export interface NatzarOptions<Req = AnyRequest> {
  /**
   * Who is asking, by YOUR login: a patient or a clinician, or nothing. Runs
   * on every mint AND renewal (so logout and role loss apply within one
   * access lifetime). Put your role and MFA rule first for clinicians.
   */
  identify: (req: Req, ask: IdentifyAsk) => IdentifyResult | Promise<IdentifyResult>;
  /**
   * In-widget Start, gated and billed by you (D1). Without it there is no
   * `/start` route. The consult is opened with YOUR key, so the key's
   * on-demand switch applies.
   */
  onStart?: (req: Req, start: StartAsk) => StartDecision | Promise<StartDecision>;
  /** Webhooks, verified (`POST {mount}/webhook`). Delivery is at-least-once: dedupe on `event.id`. */
  onEvent?: (event: WebhookEvent, req: Req) => void | Promise<void>;
  /** Optional webhook dedupe (e.g. Redis `SET NX`). */
  dedupe?: WebhookDedupe;
  /** Surfaces this endpoint serves. Default: the frame surfaces; `headless` and `native` must be listed (D10). */
  surfaces?: readonly SessionSurface[];
  /** Page origins allowed to call cross-origin (with CORS), e.g. `['https://app.acme.com']`. Exact origins only. */
  origins?: readonly string[];
  /** Your API key. Default `NATZAR_API_KEY`. Its prefix selects the environment and zone. */
  apiKey?: string;
  /** Webhook signing secret. Default `NATZAR_WEBHOOK_SECRET`. */
  webhookSecret?: string;
  /** The Natzar API through `/v1`. Default `NATZAR_API_URL`, else derived from the key prefix (sandboxes set it). */
  apiUrl?: string;
  /**
   * The full path this middleware is served under (`/natzar`, `/api/natzar`):
   * only `{basePath}/<route>` is answered. Without it, an Express/Connect
   * mount answers only routes directly below the mount, and a Fetch runtime
   * or a bare Node server answers `<any valid path>/<route>` — route only
   * your mount's paths to it (`app.all('/natzar/*', …)`), never the app root.
   */
  basePath?: string;
  /** Advanced: the `fetch` used to call Natzar (a proxy, tests). */
  fetch?: FetchLike;
  /** Advanced: where the codes-only log goes. Default `console.warn`. */
  log?: (entry: NatzarLogEntry) => void;
}

/** Options of `startConsult` (your own flow). */
export interface StartConsultOptions {
  /** `async` (a conversation), `telehealth` (video) or `referral_request` (a non-blocking referral ask). */
  kind: 'async' | 'telehealth' | 'referral_request';
  /** The physician's handoff note (required for `referral_request`). */
  context?: string;
  /** `referral_request`: the one-line label of the ask. */
  subject?: string;
  /** `referral_request`: pre-filled referral drafts. */
  suggestedReferrals?: CreateAsyncConsultRequest['suggestedReferrals'];
  /** Your own Stripe payment (rmc style), per the unchanged rule. */
  paymentId?: string;
  /** Telehealth: `queue` (default) or `scheduled`. */
  mode?: 'queue' | 'scheduled';
  /** Telehealth: route to a specialty slug. */
  specialty?: string;
  /** Async: `embed` (default: the widget asks for consent) or `collected` (you did). */
  consent?: 'embed' | 'collected';
  /** Fetch runtimes: the per-request environment (Workers `env`) holding `NATZAR_API_KEY`. */
  env?: object;
}

/** What `startConsult` opened. The element finds it by itself. */
export type StartConsultResult =
  | {kind: 'async'; consult: AsyncConsultResource}
  | {kind: 'telehealth'; consult: TelehealthConsultResource};

/** @internal the framework-neutral request */
export interface CoreRequest {
  method: string;
  pathname: string;
  header(name: string): string | undefined;
  readBody(limit: number): Promise<BodyRead>;
  /** What `identify` receives. */
  raw: unknown;
  /** Fetch runtimes: the per-request environment (Workers bindings). */
  env?: object;
  /** The request URL's host, when the adapter has one (Fetch). */
  urlHost?: string;
  /**
   * Express/Connect: the router already stripped the mount, so `pathname` is
   * below it; `fullPathname` is the path as the browser sent it.
   */
  mounted?: boolean;
  fullPathname?: string;
}

/** @internal */
export type BodyRead =
  | {kind: 'bytes'; bytes: Uint8Array}
  | {kind: 'too_large'}
  /** A body parser read the stream (and kept only a parsed object). */
  | {kind: 'consumed'};

/** @internal */
export interface CoreResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

// ----------------------------------------------------------------- constants

type RouteName = 'session' | 'start' | 'embed.js' | 'config' | 'webhook';
const ROUTE_NAMES: readonly RouteName[] = ['session', 'start', 'embed.js', 'config', 'webhook'];
/** Webhook bodies carry message text; the session routes' 4 KB is far too small for them. */
const WEBHOOK_MAX_BODY_BYTES = 1_048_576;
const LIMITER_WINDOW_MS = 60_000;
const LIMITER_MAX_KEYS = 10_000;
const NATZAR_TIMEOUT_MS = 10_000;
const RETRY_AFTER_MAX_SECONDS = 3_600;
const utf8 = new TextDecoder('utf-8');

const PLACEMENT_FIX =
  "mount natzar() AFTER the middleware that sets the user (session, passport) and BEFORE body parsers " +
  "(express.json(), bodyParser), CSRF middleware (csurf, lusca) and login redirects: app.use('/natzar', natzar({...})) " +
  'above app.use(express.json()). Next.js: exclude /natzar/ from the matcher of middleware.ts (proxy.ts since Next.js 16).';

// --------------------------------------------------------------- the limiter

/** Best effort, per instance (§4.7 rule 10). Natzar's per-subject and per-partner limits are authoritative. */
class LoginLimiter {
  private readonly windows = new Map<string, {start: number; count: number}>();

  take(key: string, now = Date.now()): {ok: true} | {ok: false; retryAfterSeconds: number} {
    let w = this.windows.get(key);
    if (!w || now - w.start >= LIMITER_WINDOW_MS) {
      this.windows.delete(key);
      w = {start: now, count: 0};
      this.windows.set(key, w);
      if (this.windows.size > LIMITER_MAX_KEYS) this.prune(now);
    }
    w.count += 1;
    if (w.count > SESSION_RATE_LIMITS.subjectPerMinute) {
      return {ok: false, retryAfterSeconds: Math.max(1, Math.ceil((w.start + LIMITER_WINDOW_MS - now) / 1000))};
    }
    return {ok: true};
  }

  private prune(now: number): void {
    for (const [k, w] of this.windows) if (now - w.start >= LIMITER_WINDOW_MS) this.windows.delete(k);
    // Still full: drop the oldest windows (a Map iterates in insertion order).
    for (const k of this.windows.keys()) {
      if (this.windows.size <= LIMITER_MAX_KEYS / 2) break;
      this.windows.delete(k);
    }
  }
}

// ----------------------------------------------------------------- helpers

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function processEnv(name: string): string | undefined {
  const env = typeof process === 'undefined' ? undefined : (process.env as Record<string, string | undefined> | undefined);
  const v = env?.[name];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function envValue(env: object | undefined, name: string): string | undefined {
  const v = (env as Record<string, unknown> | undefined)?.[name];
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  return processEnv(name);
}

function mediaType(value: string | undefined): string {
  return (value ?? '').split(';')[0].trim().toLowerCase();
}

function bearerOf(req: CoreRequest): string | undefined {
  const m = /^Bearer[ \t]+([^\s]+)[ \t]*$/i.exec(req.header('authorization') ?? '');
  return m ? m[1] : undefined;
}

/** A consult ref from `{kind, id}`, `'kind:id'` or a bare id (the surface's kind). */
function parseConsult(value: unknown, surface: SessionSurface): SessionConsultRef | null {
  if (typeof value === 'string') {
    const at = value.indexOf(':');
    const kind = at >= 0 ? value.slice(0, at) : surface === 'telehealth' ? 'telehealth' : 'async';
    const id = at >= 0 ? value.slice(at + 1) : value;
    const r = sessionConsultRefSchema.safeParse({kind, id});
    return r.success ? r.data : null;
  }
  const r = sessionConsultRefSchema.safeParse(value);
  return r.success ? r.data : null;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/**
 * A birthdate `Date` as `YYYY-MM-DD`, or null when it is ambiguous: midnight
 * UTC → its UTC date; else midnight local (node-postgres `DATE`) → its local
 * date; any other instant is refused (RG5 S1: the UTC date of a local
 * midnight is the day before on servers east of UTC).
 *
 * @internal exported for tests
 */
export function birthdateOf(d: Date): string | null {
  if (!Number.isFinite(d.getTime())) return null;
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0) {
    return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0) {
    return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return null;
}

/** `until` as ISO, `null` for none, `undefined` for a value that cannot be a time. */
function normalizeUntil(value: Identity['until']): string | null | undefined {
  if (value === null || value === undefined || value === false) return null;
  // Epoch SECONDS (a JWT `exp`) would read as January 1970: refused, never guessed.
  if (typeof value === 'number' && (!Number.isFinite(value) || value < 1e11)) return undefined;
  const d = value instanceof Date ? value : typeof value === 'number' || typeof value === 'string' ? new Date(value) : null;
  if (!d || !Number.isFinite(d.getTime())) return undefined;
  return d.toISOString();
}

const LOGIN_MAX_LENGTH = 1_024;

/** The profile branch of the mint's `patient` (the contract's `sessionPatientSchema`, second member). */
const patientProfileSchema = upsertPatientSchema.partial({email: true, givenName: true, familyName: true, birthdate: true, sex: true});

/**
 * A `login` as the string to hash, `null` for none, `undefined` for a value
 * that must be refused (RG5 S2: an object stringifies to one shared value).
 */
function normalizeLogin(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') return value.length <= LOGIN_MAX_LENGTH ? value : undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** The patient as the mint sends it, or the field that cannot be sent. */
function normalizePatient(p: PatientIdentity): {ok: true; value: Record<string, unknown>} | {ok: false; field: string} {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === null || v === undefined) continue;
    if (k === 'birthdate' && v instanceof Date) {
      const date = birthdateOf(v);
      if (date === null) return {ok: false, field: 'patient.birthdate'};
      out[k] = date;
    } else {
      out[k] = v;
    }
  }
  return {ok: true, value: out};
}

type ZodIssueLike = {code?: string; path?: ReadonlyArray<string | number | symbol>; unionErrors?: Array<{issues: ZodIssueLike[]}>; errors?: ZodIssueLike[][]};

/**
 * Field paths of a schema failure, never values (rule 9). A union failure
 * (the patient is `{externalId}` OR a profile) is unwrapped to the fields of
 * the branch that was meant, skipping "unknown key" issues of the other.
 */
function issuePaths(issues: readonly ZodIssueLike[], prefix: ReadonlyArray<string | number | symbol> = []): string[] {
  const out: string[] = [];
  for (const issue of issues) {
    const path = [...prefix, ...(issue.path ?? [])];
    const branches = issue.unionErrors?.map((e) => e.issues) ?? issue.errors;
    if (issue.code === 'invalid_union' && branches) {
      const inner = branches.flatMap((b) => issuePaths(b.filter((i) => i.code !== 'unrecognized_keys'), path));
      out.push(...(inner.length ? inner : [path.map(String).join('.') || '(root)']));
    } else {
      out.push(path.map(String).join('.') || '(root)');
    }
  }
  return [...new Set(out)];
}

function sameConsult(a: SessionConsultRef, b: SessionConsultRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** A code safe to log: the API's codes are a fixed vocabulary, but never log what does not look like one. */
function safeCode(code: unknown): string {
  return typeof code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : 'unknown';
}

// ------------------------------------------------------------------- core

/** @internal */
export interface Core {
  handle(req: CoreRequest): Promise<CoreResponse>;
  client(env?: object): NatzarClient;
  revokeLogin(login: string | number, env?: object): Promise<{revoked: number}>;
  revokePatient(externalId: string, env?: object): Promise<{revoked: number}>;
  revokeClinician(clinician: string | ClinicianIdentity, env?: object): Promise<{revoked: number}>;
  deactivateClinician(clinician: string | ClinicianIdentity, env?: object): Promise<{deactivated: true; revoked: number}>;
  startConsult(req: CoreRequest, options: StartConsultOptions): Promise<StartConsultResult>;
}

/** @internal */
export function createCore<Req>(options: NatzarOptions<Req>): Core {
  if (!options || typeof options.identify !== 'function') {
    throw new TypeError('natzar(): `identify(req, ask)` is required — it maps YOUR login to a patient or a clinician.');
  }
  const surfaces = new Set<SessionSurface>(options.surfaces ?? MIDDLEWARE_DEFAULT_SURFACES);
  for (const s of surfaces) {
    if (!(SESSION_SURFACES as readonly string[]).includes(s)) throw new TypeError(`natzar(): unknown surface "${String(s)}" in \`surfaces\`.`);
  }
  const origins = new Set<string>();
  for (const o of options.origins ?? []) {
    if (!isCanonicalParentOrigin(o)) {
      throw new TypeError(
        `natzar(): \`origins\` entries must be exact origins as the browser sends them (scheme://host[:port], lower case, no path or trailing slash); got "${String(o).slice(0, 80)}".`,
      );
    }
    origins.add(o);
  }
  const limiter = new LoginLimiter();
  const embedConfigSchemaProd = embedConfigSchemaFor({production: true});
  const embedConfigSchemaTest = embedConfigSchemaFor({production: false});
  const clients = new Map<string, NatzarClient>();
  const configs = new Map<string, {value?: EmbedConfig; expiresAt: number; inflight?: Promise<EmbedConfig>}>();
  const warned = new Set<string>();

  const log = (entry: NatzarLogEntry) => {
    try {
      if (options.log) options.log(entry);
      else console.warn(`[natzar] ${entry.code}${entry.route ? ` ${entry.route}` : ''}${entry.status ? ` ${entry.status}` : ''}`);
    } catch {
      /* logging never breaks a request */
    }
  };
  // A configuration mistake is said once per instance, loudly, with the fix.
  const shout = (code: string, message: string) => {
    log({code});
    if (warned.has(code)) return;
    warned.add(code);
    console.error(`[natzar] ${code}: ${message}`);
  };

  // --- settings, client, config ---------------------------------------------

  const settings = (env?: object) => ({
    apiKey: options.apiKey?.trim() || envValue(env, 'NATZAR_API_KEY'),
    webhookSecret: options.webhookSecret || envValue(env, 'NATZAR_WEBHOOK_SECRET'),
    apiUrl: options.apiUrl?.trim() || envValue(env, 'NATZAR_API_URL'),
  });

  const clientFor = (env?: object): {client: NatzarClient; cacheKey: string} => {
    const s = settings(env);
    if (!s.apiKey) {
      throw new NatzarSessionError('natzar(): no API key. Set NATZAR_API_KEY in the server environment (or pass apiKey).');
    }
    const cacheKey = `${s.apiUrl ?? ''}\u0000${s.apiKey}`;
    let client = clients.get(cacheKey);
    if (!client) {
      // A malformed key, a sandbox key without NATZAR_API_URL or a malformed
      // NATZAR_API_URL is a configuration mistake, not an outage: say so.
      try {
        client = new NatzarClient({
          apiKey: s.apiKey,
          ...(s.apiUrl ? {baseUrl: s.apiUrl, embedOrigin: new URL(s.apiUrl).origin} : {}),
          ...(options.fetch ? {fetch: options.fetch} : {}),
          timeoutMs: NATZAR_TIMEOUT_MS,
        });
      } catch (e) {
        throw new NatzarSessionError(`natzar(): ${e instanceof Error ? e.message.replace(/^natzar-client: /, '') : 'invalid API configuration.'}`);
      }
      clients.set(cacheKey, client);
    }
    return {client, cacheKey};
  };

  const configFor = async (env?: object): Promise<EmbedConfig> => {
    const {client, cacheKey} = clientFor(env);
    const now = Date.now();
    const entry = configs.get(cacheKey) ?? {expiresAt: 0};
    if (entry.value && now < entry.expiresAt) return entry.value;
    if (entry.inflight) return entry.inflight;
    // A live key's deployment is production: https only, no local hosts (RG5 N4).
    const schema = client.environment === 'prod' ? embedConfigSchemaProd : embedConfigSchemaTest;
    const inflight = client.embed.config().then((raw) => {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) throw new NatzarSessionError('natzar(): GET /v1/embed/config answered an unexpected shape.');
      configs.set(cacheKey, {value: parsed.data, expiresAt: Date.now() + ENDPOINT_CONFIG_CACHE_SECONDS * 1000});
      return parsed.data;
    });
    configs.set(cacheKey, {...entry, inflight});
    try {
      return await inflight;
    } finally {
      const now2 = configs.get(cacheKey);
      if (now2?.inflight === inflight) configs.set(cacheKey, {...(now2.value ? {value: now2.value} : {}), expiresAt: now2.expiresAt});
    }
  };

  // --- responses ------------------------------------------------------------

  const respond = (status: number, body: unknown, extra: Record<string, string> = {}): CoreResponse => ({
    status,
    headers: {...ENDPOINT_RESPONSE_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extra},
    body: body === undefined ? '' : JSON.stringify(body),
  });
  const fail = (code: EndpointErrorCode, extra: Record<string, string> = {}, retryAfterSeconds?: number): CoreResponse =>
    respond(ENDPOINT_ERROR_HTTP_STATUS[code], {error: code}, {
      ...extra,
      // Capped: an upstream value is relayed, never trusted unbounded (RG5 N2).
      ...(code === 'rate_limited' ? {'Retry-After': String(Math.min(RETRY_AFTER_MAX_SECONDS, Math.max(1, Math.ceil(retryAfterSeconds ?? 1))))} : {}),
    });
  const notFound = (): CoreResponse => respond(404, {});
  // A body we refuse to read to the end: close the connection after answering.
  const closing = (r: CoreResponse): CoreResponse => ({...r, headers: {...r.headers, Connection: 'close'}});
  // Deliberately NOT carrying X-Natzar-Endpoint: the browser side must read
  // this as "the middleware did not answer" → `endpoint_misconfigured`.
  const misplaced = (code: string, message: string): CoreResponse => {
    shout(code, `${message} Fix: ${PLACEMENT_FIX}`);
    return {
      status: 500,
      headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Type': 'text/plain; charset=utf-8'},
      body: `natzar: endpoint_misconfigured. ${PLACEMENT_FIX}`,
    };
  };

  // --- origin & CORS --------------------------------------------------------

  type OriginVerdict = {ok: true; origin: string | null; cors: Record<string, string>} | {ok: false; response: CoreResponse};

  const corsFor = (origin: string): Record<string, string> => ({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Expose-Headers': `${ENDPOINT_RESPONSE_HEADER}, Retry-After`,
    Vary: 'Origin',
  });

  const verifyOrigin = (req: CoreRequest): OriginVerdict => {
    const origin = req.header('origin');
    if (origin === undefined) return {ok: true, origin: null, cors: {}};
    if (!isCanonicalParentOrigin(origin)) return {ok: false, response: fail('forbidden')};
    const site = req.header('sec-fetch-site');
    let same: boolean;
    if (site !== undefined) {
      same = site === 'same-origin';
    } else {
      const host = req.header('host') ?? req.urlHost;
      let originHost: string | null;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      same = !!host && originHost === host.toLowerCase();
    }
    if (same) return {ok: true, origin, cors: {}};
    if (origins.has(origin)) return {ok: true, origin, cors: corsFor(origin)};
    return {ok: false, response: fail('origin_not_allowed')};
  };

  const preflight = (req: CoreRequest, method: 'POST' | 'GET'): CoreResponse => {
    const origin = req.header('origin');
    if (origin === undefined || !origins.has(origin) || req.header('access-control-request-method') !== method) {
      return fail('origin_not_allowed');
    }
    return {
      status: 204,
      headers: {
        ...ENDPOINT_RESPONSE_HEADERS,
        ...corsFor(origin),
        'Access-Control-Allow-Methods': method,
        'Access-Control-Allow-Headers': `Content-Type, ${ENDPOINT_REQUEST_HEADER}, Authorization`,
        'Access-Control-Max-Age': '600',
      },
      body: '',
    };
  };

  // --- request checks shared by /session and /start -------------------------

  type Checked =
    | {ok: true; origin: string | null; cors: Record<string, string>; json: unknown; bearer?: string; ambient: boolean}
    | {ok: false; response: CoreResponse};

  const checkPost = async (req: CoreRequest, route: string): Promise<Checked> => {
    const verdict = verifyOrigin(req);
    if (!verdict.ok) {
      log({code: 'request_refused:origin', route});
      return verdict;
    }
    // Rule 9: why a request was refused, as a code.
    const deny = (reason: string, code: EndpointErrorCode = 'forbidden'): Checked => {
      log({code: `request_refused:${reason}`, route});
      return {ok: false, response: fail(code, verdict.cors)};
    };
    if (req.header(ENDPOINT_REQUEST_HEADER.toLowerCase()) !== ENDPOINT_HEADER_VALUE) return deny('csrf_header');
    if (mediaType(req.header('content-type')) !== 'application/json') return deny('content_type');
    const declared = Number(req.header('content-length'));
    if (Number.isFinite(declared) && declared > ENDPOINT_MAX_BODY_BYTES) {
      log({code: 'request_refused:too_large', route});
      return {ok: false, response: closing(fail('forbidden', verdict.cors))};
    }
    const body = await req.readBody(ENDPOINT_MAX_BODY_BYTES);
    if (body.kind === 'consumed') return {ok: false, response: misplaced('body_consumed', 'the request body was already read by a body parser mounted before natzar().')};
    if (body.kind === 'too_large') {
      log({code: 'request_refused:too_large', route});
      return {ok: false, response: closing(fail('forbidden', verdict.cors))};
    }
    let json: unknown;
    try {
      json = JSON.parse(utf8.decode(body.bytes));
    } catch {
      return deny('json');
    }
    const bearer = bearerOf(req);
    return {ok: true, origin: verdict.origin, cors: verdict.cors, json, ambient: req.header('cookie') !== undefined, ...(bearer ? {bearer} : {})};
  };

  // --- identify → the mint body ---------------------------------------------

  type Built = {ok: true; body: CreateSessionRequest; limitKey: string} | {ok: false; response: CoreResponse};

  const runIdentify = async (raw: unknown, ask: IdentifyAsk, route: string, cors: Record<string, string>):
    Promise<{ok: true; identity: Identity} | {ok: false; response: CoreResponse}> => {
    let result: IdentifyResult;
    try {
      result = await options.identify(raw as Req, ask);
    } catch {
      log({code: 'identify_failed', route});
      return {ok: false, response: fail('unavailable', cors)};
    }
    if (!result) return {ok: false, response: fail('signed_out', cors)};
    if (!isObject(result)) {
      log({code: 'identify_result_invalid', route});
      return {ok: false, response: fail('unavailable', cors)};
    }
    return {ok: true, identity: result as Identity};
  };

  const buildMint = async (
    route: string,
    ask: {audience: SessionAudience; surface: SessionSurface; sessionId: string | null; reason: string; consult?: SessionConsultRef; patient?: string; frameKey?: CreateSessionRequest['frameKey']; view?: ProviderView},
    identity: Identity,
    ctx: {origin: string | null; bearer?: string; ambient: boolean; cors: Record<string, string>; startConsult?: SessionConsultRef},
  ): Promise<Built> => {
    const deny = (code: EndpointErrorCode): Built => ({ok: false, response: fail(code, ctx.cors)});
    const broken = (code: string): Built => {
      log({code, route});
      return {ok: false, response: fail('unavailable', ctx.cors)};
    };
    const hasPatient = identity.patient !== undefined && identity.patient !== null;
    const hasClinician = identity.clinician !== undefined && identity.clinician !== null;
    if (hasPatient && hasClinician) return broken('identify_result_invalid');
    // Rule 4: an answer for the other audience is a refusal, never a mint.
    if (ask.audience === 'patient' ? !hasPatient : !hasClinician) return deny('forbidden');

    const body: Record<string, unknown> = {audience: ask.audience, surface: ask.surface};
    if (ask.reason === 'renew') body.sessionId = ask.sessionId;
    if (ask.reason === 'successor') body.successorOf = ask.sessionId;
    if (ask.frameKey) body.frameKey = ask.frameKey;

    let subject: string;
    if (ask.audience === 'patient') {
      if (!isObject(identity.patient)) return broken('identify_result_invalid');
      const normalized = normalizePatient(identity.patient as PatientIdentity);
      if (!normalized.ok) return broken(`identify_result_invalid:${normalized.field}`);
      const patient = normalized.value;
      // A profile (more than the id) is checked on its own first, so the log
      // names the field (`patient.sex`): zod reports the union's other branch
      // ("unknown keys") otherwise (RG5 N6). Paths only, never values.
      if (Object.keys(patient).length > 1) {
        const profile = patientProfileSchema.safeParse(patient);
        if (!profile.success) {
          const paths = issuePaths(profile.error.issues as ZodIssueLike[], ['patient']).slice(0, 5).join(',');
          return broken(`identify_result_invalid:${paths.replace(/[^A-Za-z0-9_.,()]/g, '')}`);
        }
      }
      if (ask.patient !== undefined && patient.externalId !== ask.patient) return deny('forbidden');
      body.patient = patient;
      // M11: the element named one of the login's patients; Natzar echoes it as
      // `scope.patient`, which the loader and the client check.
      if (ask.patient !== undefined) body.askPatient = ask.patient;
      subject = `p:${String(patient.externalId)}`;
      if (options.onStart) body.partnerStart = true;
    } else {
      body.clinician = identity.clinician;
      if (ask.patient !== undefined) body.patient = {externalId: ask.patient};
      if (identity.clinicianToken) body.clinicianToken = identity.clinicianToken;
      if (identity.capabilities) body.capabilities = [...identity.capabilities];
      const c = identity.clinician as Record<string, unknown>;
      subject = `c:${String(c.externalId ?? c.physicianId)}`;
    }

    let consult = ctx.startConsult ?? ask.consult;
    if (identity.consult !== undefined && identity.consult !== null) {
      const own = parseConsult(identity.consult, ask.surface);
      if (!own) return broken('identify_result_invalid');
      // identify narrows; it may not point the element somewhere it did not ask.
      if (consult && !sameConsult(own, consult)) return deny('forbidden');
      consult = own;
    }
    if (consult) body.consult = consult;
    if (ask.view) body.view = ask.view;
    body.parentOrigin = ask.surface === 'native' ? null : ctx.origin;

    const until = normalizeUntil(identity.until);
    if (until === undefined) return broken('identify_until_invalid');
    if (until !== null) body.until = until;
    const login = normalizeLogin(identity.login);
    if (login === undefined) return broken('identify_result_invalid:login');
    let loginRef: string | undefined;
    if (login !== null) {
      loginRef = await loginRefFor(login);
      body.loginRef = loginRef;
    }
    // Bearer-authenticated only when the request ARRIVED with a bearer AND no
    // ambient credential (no Cookie) could have identified it instead (RG5 S3).
    if (ctx.bearer && !ctx.ambient) body.requestAuth = 'bearer';

    const parsed = createSessionRequestSchema.safeParse(body);
    if (!parsed.success) {
      // The paths name YOUR field names (never values), e.g. `patient.birthdate`.
      const paths = issuePaths(parsed.error.issues as ZodIssueLike[]).slice(0, 5).join(',');
      log({code: `identify_result_invalid:${paths.replace(/[^A-Za-z0-9_.,()]/g, '')}`, route});
      return {ok: false, response: fail('unavailable', ctx.cors)};
    }
    return {ok: true, body: parsed.data, limitKey: loginRef ?? subject};
  };

  const upstream = (e: unknown, route: string, cors: Record<string, string>): CoreResponse => {
    if (isNatzarApiError(e) && e.status > 0) {
      log({code: `upstream_${safeCode(e.code)}`, route, status: e.status});
      const code = endpointErrorFor(e.code);
      return fail(code, cors, e.retryAfterSeconds);
    }
    if (e instanceof NatzarSessionError) shout('misconfigured', e.message);
    else log({code: 'upstream_unreachable', route});
    return fail('unavailable', cors);
  };

  const mint = async (route: string, built: {body: CreateSessionRequest; limitKey: string}, env: object | undefined, cors: Record<string, string>, expect: {sessionId: string | null}): Promise<CoreResponse> => {
    const limit = limiter.take(built.limitKey);
    if (!limit.ok) {
      log({code: 'rate_limited_locally', route});
      return fail('rate_limited', cors, limit.retryAfterSeconds);
    }
    let raw: SessionGrant;
    try {
      raw = await clientFor(env).client.sessions.create(built.body);
    } catch (e) {
      return upstream(e, route, cors);
    }
    // Relay the PARSED grant (unknown keys dropped, RG5 N3), and only one for
    // what was asked. The loader, frame and SDK check it again for real.
    const parsed = sessionGrantSchema.safeParse(raw);
    if (!parsed.success) {
      log({code: 'grant_invalid', route});
      return fail('unavailable', cors);
    }
    const grant = parsed.data;
    if (grant.audience !== built.body.audience || grant.surface !== built.body.surface
      || (expect.sessionId !== null && grant.sessionId !== expect.sessionId)) {
      log({code: 'grant_mismatch', route});
      return fail('unavailable', cors);
    }
    return respond(200, grant, cors);
  };

  // --- routes ---------------------------------------------------------------

  const refused = (reason: string, route: string, code: EndpointErrorCode, cors: Record<string, string>): CoreResponse => {
    log({code: `request_refused:${reason}`, route});
    return fail(code, cors);
  };

  const session = async (req: CoreRequest): Promise<CoreResponse> => {
    const checked = await checkPost(req, 'session');
    if (!checked.ok) return checked.response;
    const {cors} = checked;
    const parsed = endpointSessionRequestSchema.safeParse(checked.json);
    if (!parsed.success) return refused('schema', 'session', 'forbidden', cors);
    const ask = parsed.data;
    if (!surfaces.has(ask.surface)) return refused('surface', 'session', 'surface_not_allowed', cors);
    // Native: no page, so no origin binding and no ambient credential (T23).
    // Only a bearer request with no cookie may ask for it, and only from no
    // Origin or a native shell's: a web page gets the sealed `headless`
    // surface, never the plain token (RG5 S4).
    if (ask.surface === 'native') {
      if (!checked.bearer || checked.ambient) return refused('native_needs_bearer', 'session', 'forbidden', cors);
      if (checked.origin !== null && !(NATIVE_SHELL_ORIGINS as readonly string[]).includes(checked.origin)) {
        return refused('native_from_web_origin', 'session', 'forbidden', cors);
      }
    } else if (checked.origin === null) {
      return refused('no_origin', 'session', 'forbidden', cors);
    }

    const identifyAsk: IdentifyAsk = {audience: ask.audience, surface: ask.surface};
    if (ask.consult) identifyAsk.consult = ask.consult;
    if (ask.patient !== undefined) identifyAsk.patient = ask.patient;
    if (checked.bearer) identifyAsk.token = checked.bearer;
    if (ask.view) identifyAsk.view = ask.view;
    const who = await runIdentify(req.raw, identifyAsk, 'session', cors);
    if (!who.ok) return who.response;
    const built = await buildMint('session', ask, who.identity, {origin: checked.origin, cors, ambient: checked.ambient, ...(checked.bearer ? {bearer: checked.bearer} : {})});
    if (!built.ok) return built.response;
    return mint('session', built, req.env, cors, {sessionId: ask.reason === 'renew' ? ask.sessionId : null});
  };

  const start = async (req: CoreRequest): Promise<CoreResponse> => {
    const onStart = options.onStart!;
    const checked = await checkPost(req, 'start');
    if (!checked.ok) return checked.response;
    const {cors} = checked;
    const parsed = endpointStartRequestSchema.safeParse(checked.json);
    if (!parsed.success) return refused('schema', 'start', 'forbidden', cors);
    const ask = parsed.data;
    if (!surfaces.has(ask.surface)) return refused('surface', 'start', 'surface_not_allowed', cors);
    if (checked.origin === null) return refused('no_origin', 'start', 'forbidden', cors);

    const identifyAsk: IdentifyAsk = {audience: 'patient', surface: ask.surface};
    if (ask.patient !== undefined) identifyAsk.patient = ask.patient;
    if (checked.bearer) identifyAsk.token = checked.bearer;
    const who = await runIdentify(req.raw, identifyAsk, 'start', cors);
    if (!who.ok) return who.response;
    const identity = who.identity;
    if (!isObject(identity.patient) || identity.clinician) return fail('forbidden', cors);
    const externalPatientId = String(identity.patient.externalId);
    if (ask.patient !== undefined && externalPatientId !== ask.patient) return fail('forbidden', cors);

    let decision: StartDecision;
    try {
      decision = await onStart(req.raw as Req, {kind: ask.kind, surface: ask.surface, ...(ask.mode ? {mode: ask.mode} : {})});
    } catch {
      log({code: 'on_start_failed', route: 'start'});
      return fail('unavailable', cors);
    }
    if (!decision) return fail('forbidden', cors);
    const context = isObject(decision) && typeof decision.context === 'string' && decision.context !== '' ? decision.context : undefined;

    const limit = limiter.take(`start:${externalPatientId}`);
    if (!limit.ok) return fail('rate_limited', cors, limit.retryAfterSeconds);

    // Open the visit with YOUR key: the key's on-demand switch, your billing.
    let consultId: string;
    try {
      const client = clientFor(req.env).client;
      if (ask.kind === 'async') {
        try {
          const created = await client.asyncConsults.create({externalPatientId, consent: 'embed', ...(context ? {context} : {})});
          consultId = created.consult.id;
        } catch (e) {
          // One open thread per patient: Start again lands on the open one (idempotent).
          const open = isNatzarApiError(e) && e.code === 'has_open_thread' && isObject(e.details) ? e.details.asyncConsultId : undefined;
          if (typeof open !== 'string') throw e;
          consultId = open;
        }
      } else {
        const created = await client.telehealth.create({externalPatientId, ...(ask.mode ? {mode: ask.mode} : {}), ...(context ? {context} : {})});
        consultId = created.consult.id;
      }
    } catch (e) {
      if (isNatzarApiError(e) && e.status > 0) {
        log({code: `upstream_${safeCode(e.code)}`, route: 'start', status: e.status});
        // A REST refusal (feature off, payment, patient unknown) is a refusal, not an outage.
        if (e.status === 429) return fail('rate_limited', cors, e.retryAfterSeconds);
        return fail(e.status >= 500 ? 'unavailable' : 'forbidden', cors);
      }
      return upstream(e, 'start', cors);
    }

    const built = await buildMint(
      'start',
      {audience: 'patient', surface: ask.surface, sessionId: null, reason: 'rescope', frameKey: ask.frameKey, ...(ask.patient !== undefined ? {patient: ask.patient} : {})},
      {...identity, consult: undefined},
      {origin: checked.origin, cors, ambient: checked.ambient, ...(checked.bearer ? {bearer: checked.bearer} : {}), startConsult: {kind: ask.kind, id: consultId}},
    );
    if (!built.ok) return built.response;
    return mint('start', built, req.env, cors, {sessionId: null});
  };

  const loader = async (req: CoreRequest): Promise<CoreResponse> => {
    let config: EmbedConfig;
    try {
      config = await configFor(req.env);
    } catch (e) {
      return upstream(e, 'embed.js', {});
    }
    return {
      status: 302,
      headers: {
        'Cache-Control': ENDPOINT_LOADER_CACHE_CONTROL,
        'X-Content-Type-Options': 'nosniff',
        [ENDPOINT_RESPONSE_HEADER]: ENDPOINT_HEADER_VALUE,
        Location: config.loaderUrl,
      },
      body: '',
    };
  };

  // The deployment facts plus `apiUrl` — the API this middleware derived from
  // YOUR key — so a browser client (`connectPhysician`) sends its credential
  // only to endpoints your configuration names, never to a grant's (T16).
  const config = async (req: CoreRequest): Promise<CoreResponse> => {
    const origin = req.header('origin');
    const cors = origin !== undefined && origins.has(origin) ? corsFor(origin) : {};
    try {
      const value = await configFor(req.env);
      return respond(200, {...value, apiUrl: clientFor(req.env).client.endpoints.baseUrl}, cors);
    } catch (e) {
      return upstream(e, 'config', cors);
    }
  };

  const webhook = async (req: CoreRequest): Promise<CoreResponse> => {
    const onEvent = options.onEvent!;
    const secret = settings(req.env).webhookSecret;
    if (!secret) {
      shout('webhook_secret_missing', 'onEvent is set but there is no webhook secret: set NATZAR_WEBHOOK_SECRET (or pass webhookSecret).');
      return respond(500, {error: 'unavailable'});
    }
    const body = await req.readBody(WEBHOOK_MAX_BODY_BYTES);
    if (body.kind === 'consumed') {
      shout(
        'webhook_body_consumed',
        'the webhook body was already consumed by a body parser, so its signature cannot be verified over the raw bytes. ' +
          `Fix: ${PLACEMENT_FIX} (express.raw({type: 'application/json'}) before natzar() also works: a Buffer body is used as-is).`,
      );
      return {
        status: 500,
        headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Type': 'text/plain; charset=utf-8'},
        body: 'natzar: webhook body already consumed by a body parser; mount natzar() before it.',
      };
    }
    if (body.kind === 'too_large') return closing(respond(413, {error: 'forbidden'}));
    const result = await verifyWebhook({
      secret,
      rawBody: utf8.decode(body.bytes),
      signature: req.header(WEBHOOK_SIGNATURE_HEADER.toLowerCase()),
      toleranceSeconds: DEFAULT_TOLERANCE_SECONDS,
    });
    if (!result.valid) {
      log({code: `webhook_${result.reason}`, route: 'webhook'});
      return respond(400, {error: 'forbidden'});
    }
    const event = result.event;
    let marked = false;
    if (options.dedupe) {
      try {
        if (await options.dedupe.seen(event.id)) return respond(200, {received: true});
        marked = true;
      } catch {
        log({code: 'webhook_dedupe_failed', route: 'webhook'});
        return respond(500, {error: 'unavailable'});
      }
    }
    try {
      await onEvent(event, req.raw as Req);
    } catch {
      // 500 so Natzar retries (at-least-once); let the retry through the dedupe.
      log({code: 'webhook_handler_failed', route: 'webhook'});
      if (marked && options.dedupe?.forget) {
        try {
          await options.dedupe.forget(event.id);
        } catch {
          log({code: 'webhook_dedupe_forget_failed', route: 'webhook'});
        }
      }
      return respond(500, {error: 'unavailable'});
    }
    return respond(200, {received: true});
  };

  const basePath = options.basePath === undefined ? undefined : options.basePath.replace(/\/+$/, '');
  if (basePath !== undefined && !isEndpointPath(basePath)) {
    throw new TypeError(`natzar(): basePath must be a path such as /natzar; got "${String(options.basePath).slice(0, 80)}".`);
  }

  // Rule 1, tight to the mount (RG5 N1): with `basePath`, exactly
  // `{basePath}/<route>`; under an Express/Connect mount, a route directly
  // below it (so never at the app root, and `/natzar-admin/session` never
  // reaches it); otherwise `<valid path>/<route>`.
  const routeOf = (req: CoreRequest): RouteName | null => {
    const split = (path: string): [string, string] | null => {
      const at = path.lastIndexOf('/');
      return at < 0 ? null : [path.slice(0, at), path.slice(at + 1)];
    };
    const own = split(req.pathname);
    if (!own || !ROUTE_NAMES.includes(own[1] as RouteName)) return null;
    const name = own[1] as RouteName;
    if (basePath !== undefined) {
      const full = split(req.fullPathname ?? req.pathname);
      return full && full[0] === basePath && full[1] === name ? name : null;
    }
    if (req.mounted) return own[0] === '' ? name : null;
    return own[0] === '' || isEndpointPath(own[0]) ? name : null;
  };

  const handle = async (req: CoreRequest): Promise<CoreResponse> => {
    try {
      const route = routeOf(req);
      const method = req.method.toUpperCase();
      switch (route) {
        case 'session':
          if (method === 'POST') return await session(req);
          if (method === 'OPTIONS') return preflight(req, 'POST');
          return notFound();
        case 'start':
          if (!options.onStart) return notFound();
          if (method === 'POST') return await start(req);
          if (method === 'OPTIONS') return preflight(req, 'POST');
          return notFound();
        case 'embed.js':
          return method === 'GET' || method === 'HEAD' ? await loader(req) : notFound();
        case 'config':
          if (method === 'GET' || method === 'HEAD') return await config(req);
          if (method === 'OPTIONS') return preflight(req, 'GET');
          return notFound();
        case 'webhook':
          return options.onEvent && method === 'POST' ? await webhook(req) : notFound();
        default:
          return notFound();
      }
    } catch {
      log({code: 'internal_error'});
      return fail('unavailable');
    }
  };

  // --- helpers for your own routes ------------------------------------------

  const revoke = async (body: Parameters<NatzarClient['sessions']['revoke']>[0], env?: object) => clientFor(env).client.sessions.revoke(body);

  const clinicianRef = (c: string | ClinicianIdentity): ClinicianIdentity => (typeof c === 'string' ? {externalId: c} : c);

  const startConsult = async (req: CoreRequest, opts: StartConsultOptions): Promise<StartConsultResult> => {
    const kind = opts?.kind;
    if (kind !== 'async' && kind !== 'telehealth' && kind !== 'referral_request') {
      throw new TypeError('startConsult(): kind must be async, telehealth or referral_request.');
    }
    const surface: SessionSurface = kind === 'telehealth' ? 'telehealth' : 'async';
    const bearer = bearerOf(req);
    const ask: IdentifyAsk = {audience: 'patient', surface, ...(bearer ? {token: bearer} : {})};
    const result = await options.identify(req.raw as Req, ask);
    if (!result) throw new NatzarSessionError('startConsult(): identify found no signed-in user.', 'signed_out');
    if (!isObject(result) || !isObject(result.patient) || result.clinician) {
      throw new NatzarSessionError('startConsult(): identify must return a patient for this request.', 'forbidden');
    }
    const client = clientFor(opts.env).client;
    const normalized = normalizePatient(result.patient as unknown as PatientIdentity);
    if (!normalized.ok) throw new NatzarSessionError(`startConsult(): identify returned an invalid ${normalized.field}.`, 'forbidden');
    const profile = normalized.value;
    // A complete profile is upserted first, so a patient who never opened the
    // widget exists before the consult does. A partial one must already exist.
    if (upsertPatientSchema.safeParse(profile).success) await client.patients.upsert(profile as Parameters<NatzarClient['patients']['upsert']>[0]);
    const externalPatientId = String(profile.externalId);
    if (kind === 'telehealth') {
      const {consult} = await client.telehealth.create({
        externalPatientId,
        ...(opts.mode ? {mode: opts.mode} : {}),
        ...(opts.context ? {context: opts.context} : {}),
        ...(opts.specialty ? {specialty: opts.specialty} : {}),
      });
      return {kind: 'telehealth', consult};
    }
    const {consult} = await client.asyncConsults.create({
      externalPatientId,
      consent: kind === 'referral_request' ? 'collected' : (opts.consent ?? 'embed'),
      ...(kind === 'referral_request' ? {kind: 'referral_request' as const} : {}),
      ...(opts.subject ? {subject: opts.subject} : {}),
      ...(opts.context ? {context: opts.context} : {}),
      ...(opts.suggestedReferrals ? {suggestedReferrals: opts.suggestedReferrals} : {}),
      ...(opts.paymentId ? {paymentId: opts.paymentId} : {}),
    });
    return {kind: 'async', consult};
  };

  return {
    handle,
    client: (env) => clientFor(env).client,
    revokeLogin: async (login, env) => {
      // The same rule as `identify`'s `login` (RG5 S2): a non-empty string or a
      // finite number, never an object that would hash to everyone's loginRef.
      const value = normalizeLogin(login);
      if (value === undefined || value === null) throw new TypeError('revokeLogin(): pass the login id identify returned as `login` (a string or a number).');
      return revoke({loginRef: await loginRefFor(value)}, env);
    },
    revokePatient: (externalId, env) => revoke({patient: {externalId}}, env),
    revokeClinician: (clinician, env) => revoke({clinician: clinicianRef(clinician)}, env),
    deactivateClinician: async (clinician, env) => {
      const client = clientFor(env).client;
      const ref = clinicianRef(clinician);
      // One call either way: our id, or yours (`POST /v1/physicians/deactivate`).
      return client.physicians.deactivate('physicianId' in ref ? ref.physicianId : {externalId: ref.externalId});
    },
    startConsult,
  };
}
