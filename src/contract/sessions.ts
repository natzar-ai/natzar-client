// GENERATED FILE — do not edit.
//
// Copied verbatim from natzar-core's shared/partner-api by
// scripts/sync-contract.mjs. Edit the source there; this copy exists only so
// the published package is self-contained.
/**
 * Sessions contract of the embed integration redesign (protocol v2): ONE
 * credential (`nz1`), ONE mint API (`POST /v1/sessions`), the customer
 * endpoint that the `natzar()` middleware mounts (`/natzar`), the grant and
 * the checks run on it before use, surfaces with their lifetimes and
 * capability presets, the modular provider views, key prefixes and the
 * error-code allowlists. The design is docs/EMBED-INTEGRATION-REDESIGN-PLAN.md
 * §4 (decisions D1–D13, §9); this module family is the single source of truth
 * the session service, the patient backend, the loader and frames and the SDK
 * build on.
 *
 * ## Module map
 *
 * - `./sessions` (this module): constants, vocabularies and pure helpers. No
 *   zod, no DOM types, no I/O, so the loader (32 KB budget) can import it.
 * - `./sessions-schemas`: the zod schemas of every body, response, grant,
 *   `postMessage` envelope and event detail, and the types inferred from them.
 * - `./sessions-origins`: the embedding-origin rules (§4.8): entry
 *   validation, the public-suffix subset, matching.
 * - `./sessions-crypto`: sealing the credential to the frame key
 *   (ECDH-ES P-256 + HKDF-SHA256 + A256GCM), the frame key pair, the RFC 7638
 *   thumbprint and `loginRef` (WebCrypto only).
 *
 * ## The flow in one paragraph
 *
 * The page's element asks its own origin's endpoint (`POST /natzar/session`,
 * {@link ENDPOINT_REQUEST_HEADER} set) for a session, sending the frame's
 * public key. The customer's server runs `identify`, then calls
 * `POST /v1/sessions` with its key. Natzar answers with a grant whose secret is
 * sealed to the frame key, so the customer's server and page only ever see
 * ciphertext. The loader checks the grant ({@link checkGrantAtLoader}) and
 * posts it to the frame, which checks it again ({@link checkGrantAtFrame}),
 * unseals the `nz1` credential and uses it in `Authorization`. Renewal is the
 * same round trip with the `sessionId`.
 *
 * @packageDocumentation
 */

import {EMBED_EVENT_NAMES, EMBED_TAG_AGENT, EMBED_TAG_ASYNC, EMBED_TAG_TELEHEALTH, type EmbedLocale} from './embed';
import type {Route} from './endpoints';
import {
  PROVIDER_EMBED_CAPABILITIES,
  PROVIDER_EMBED_CONSULT_KINDS,
  PROVIDER_EMBED_DOM_EVENT_PREFIX,
  PROVIDER_EMBED_ELEMENT_TAG,
  PROVIDER_EMBED_FRAME_PATH_PREFIX,
  PROVIDER_EMBED_IDLE_TIMEOUT_SECONDS,
  PROVIDER_EMBED_MAX_MESSAGE_BYTES,
  PROVIDER_EMBED_MODE_CAPABILITIES,
  PROVIDER_EMBED_PREVIOUS_SECRET_OVERLAP_SECONDS,
  PROVIDER_EMBED_RENEW_LEAD_SECONDS,
  type ProviderEmbedCapability,
  type ProviderEmbedConsultKind,
  type ProviderEmbedRoute,
} from './provider-embed';
import type {
  CreateSessionRequest,
  DeactivatePhysicianByExternalIdRequest,
  DeactivatePhysicianRequest,
  DeactivatePhysicianResponse,
  EmbedConfig,
  EndpointSessionRequest,
  EndpointStartRequest,
  PutEmbedOriginsRequest,
  PutEmbedOriginsResponse,
  RevokeSessionsRequest,
  RevokeSessionsResponse,
  SessionConsultRef,
  SessionGrant,
} from './sessions-schemas';

// ------------------------------------------------------ audiences, surfaces
// (Module-level calls carry `/* @__PURE__ */` so a bundle that does not use
// their result drops them: the loader's 32 KB budget, RG0 N11.)

/** Who a session is for. Patient and clinician frames live on separate origins. */
export const SESSION_AUDIENCES = ['patient', 'clinician'] as const;
/** A session audience. */
export type SessionAudience = (typeof SESSION_AUDIENCES)[number];

/**
 * Patient surfaces: the three tags, plus `headless` (the browser SDK,
 * `connectPatient`) and `native` (apps without an `Origin`, plain token).
 */
export const PATIENT_SURFACES = ['async', 'telehealth', 'agent', 'headless', 'native'] as const;
/** A patient surface. */
export type PatientSurface = (typeof PATIENT_SURFACES)[number];
/**
 * Clinician surfaces: the `<natzar-provider>` workspace, one consultation
 * (`consult="kind:id"`), plus `headless` (browser SDK, `connectPhysician`) and
 * `native`, which get the `physician-rest` preset.
 */
export const CLINICIAN_SURFACES = ['workspace', 'consultation', 'headless', 'native'] as const;
/** A clinician surface. */
export type ClinicianSurface = (typeof CLINICIAN_SURFACES)[number];
/** Every surface name (`headless` and `native` exist for both audiences). */
export const SESSION_SURFACES = ['async', 'telehealth', 'agent', 'workspace', 'consultation', 'headless', 'native'] as const;
/** Any surface. */
export type SessionSurface = (typeof SESSION_SURFACES)[number];
/** The surfaces of each audience. */
export const SURFACES_BY_AUDIENCE: {readonly patient: readonly PatientSurface[]; readonly clinician: readonly ClinicianSurface[]} = {
  patient: PATIENT_SURFACES,
  clinician: CLINICIAN_SURFACES,
};
/**
 * Off by default for both audiences (D10): minted only when the policy, the
 * middleware's `surfaces` option AND `identify` all allow it.
 */
export const OPT_IN_SURFACES = ['headless', 'native'] as const satisfies readonly SessionSurface[];
/** The middleware's default `surfaces` option; `headless` and `native` must be listed explicitly. */
export const MIDDLEWARE_DEFAULT_SURFACES = ['async', 'telehealth', 'agent', 'workspace', 'consultation'] as const satisfies readonly SessionSurface[];
/** Surfaces that take no frame key, no parent origin and carry the plain token in the grant. */
export const PLAIN_TOKEN_SURFACES = ['native'] as const satisfies readonly SessionSurface[];

/** Whether `surface` belongs to `audience`. */
export function isSurfaceOf(audience: SessionAudience, surface: unknown): surface is SessionSurface {
  const surfaces = (SURFACES_BY_AUDIENCE as Partial<Record<string, readonly string[]>>)[audience];
  return typeof surface === 'string' && surfaces !== undefined && surfaces.includes(surface);
}

/** Whether sessions of `surface` carry the plain `nz1` token instead of a sealed one. */
export function isPlainTokenSurface(surface: SessionSurface): boolean {
  return (PLAIN_TOKEN_SURFACES as readonly string[]).includes(surface);
}

/** Consult kinds a session scope can name (the provider embed's two, reused). */
export const SESSION_CONSULT_KINDS = PROVIDER_EMBED_CONSULT_KINDS;
/** A consult kind: written (`async`) or video (`telehealth`). */
export type SessionConsultKind = ProviderEmbedConsultKind;

/** Element tags and the surface each one asks for (the provider tag asks `consultation` when `consult` is set). */
export const SESSION_TAGS = [EMBED_TAG_ASYNC, EMBED_TAG_TELEHEALTH, EMBED_TAG_AGENT, PROVIDER_EMBED_ELEMENT_TAG] as const;
/** One of the four tags. */
export type SessionTag = (typeof SESSION_TAGS)[number];

/** The audience and surface an element of `tag` asks for. */
export function surfaceForTag(tag: SessionTag, opts: {consult: boolean}): {audience: SessionAudience; surface: SessionSurface} {
  switch (tag) {
    case EMBED_TAG_ASYNC: return {audience: 'patient', surface: 'async'};
    case EMBED_TAG_TELEHEALTH: return {audience: 'patient', surface: 'telehealth'};
    case EMBED_TAG_AGENT: return {audience: 'patient', surface: 'agent'};
    default: return {audience: 'clinician', surface: opts.consult ? 'consultation' : 'workspace'};
  }
}

/** Surfaces rendered in a frame (the loader's `hello` names one); `headless` and `native` have none. */
export const FRAME_SURFACES = {
  patient: ['async', 'telehealth', 'agent'],
  clinician: ['workspace', 'consultation'],
} as const satisfies {readonly patient: readonly PatientSurface[]; readonly clinician: readonly ClinicianSurface[]};

/** Surfaces the in-widget Start (`POST {endpoint}/start`) can be asked from (D1). */
export const START_SURFACES = ['async', 'telehealth', 'agent'] as const satisfies readonly PatientSurface[];
/** Telehealth modes a Start may open: the waiting room or a booking. */
export const START_TELEHEALTH_MODES = ['queue', 'scheduled'] as const;

// ----------------------------------------------------------- credential nz1

/** First segment of every session credential. Replaces the provider embed's `pe1`. */
export const NZ1_TOKEN_PREFIX = 'nz1' as const;
/**
 * A public session id: 128 random bits, base64url without padding. 22
 * characters whose last one carries only 2 bits, so it is one of `AQgw`.
 */
export const NZ1_SESSION_ID_REGEX = /^[A-Za-z0-9_-]{21}[AQgw]$/;
/** A session secret: 256 random bits, base64url without padding (43 characters, the last one of 16). */
export const NZ1_SECRET_REGEX = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
/** `nz1.<sessionId>.<secret>`: exactly 70 ASCII characters. */
export const NZ1_TOKEN_REGEX = /^nz1\.[A-Za-z0-9_-]{21}[AQgw]\.[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
/** Length of every `nz1` credential, in bytes. */
export const NZ1_TOKEN_LENGTH = 70;

/** The two halves of a well-formed `nz1` credential, or null. The server stores only a hash of the secret. */
export function parseNz1Token(token: unknown): {sessionId: string; secret: string} | null {
  if (typeof token !== 'string' || !NZ1_TOKEN_REGEX.test(token)) return null;
  return {sessionId: token.slice(4, 26), secret: token.slice(27)};
}

/** `nz1.<sessionId>.<secret>`; throws on a malformed half, so a bad credential is never minted. */
export function formatNz1Token(sessionId: string, secret: string): string {
  if (!NZ1_SESSION_ID_REGEX.test(sessionId) || !NZ1_SECRET_REGEX.test(secret)) throw new Error('nz1: malformed session id or secret');
  return `${NZ1_TOKEN_PREFIX}.${sessionId}.${secret}`;
}

/** `loginRef = sha256_hex(LOGIN_REF_PREFIX + login)`: the raw login id never leaves the customer's server (§4.7 rule 5). */
export const LOGIN_REF_PREFIX = 'natzar-login:' as const;
/** A `loginRef`: 64 lower-case hex characters. */
export const LOGIN_REF_REGEX = /^[0-9a-f]{64}$/;

// ------------------------------------------------------- lifetimes, limits

/** Lifetimes of one surface (§4.5 table). */
export interface SurfaceLifetime {
  /** Lifetime of one access credential, in seconds; renewal rotates it. A policy may only shorten it. */
  readonly accessSeconds: number;
  /** Default absolute lifetime of the logical session, in seconds; renewal never extends it. */
  readonly absoluteSeconds: number;
  /** The most a policy may raise the absolute lifetime to, in seconds. */
  readonly absoluteMaxSeconds: number;
  /** Default inactivity lock, in seconds; null means none (a waiting room must not lock). */
  readonly idleSeconds: number | null;
  /** Whether a policy may set or shorten an inactivity lock ({@link SESSION_IDLE_MIN_SECONDS}–{@link SESSION_IDLE_MAX_SECONDS}). */
  readonly idleConfigurable: boolean;
}

const PATIENT_FRAME_LIFETIME: SurfaceLifetime = {accessSeconds: 900, absoluteSeconds: 28_800, absoluteMaxSeconds: 43_200, idleSeconds: null, idleConfigurable: false};
const CLINICIAN_FRAME_LIFETIME: SurfaceLifetime = {
  accessSeconds: 300, absoluteSeconds: 28_800, absoluteMaxSeconds: 28_800, idleSeconds: PROVIDER_EMBED_IDLE_TIMEOUT_SECONDS, idleConfigurable: true,
};
const CLINICIAN_REST_LIFETIME: SurfaceLifetime = {accessSeconds: 300, absoluteSeconds: 28_800, absoluteMaxSeconds: 28_800, idleSeconds: null, idleConfigurable: true};

/**
 * Lifetimes per audience and surface (§4.5): patients 900 s access, 8 h
 * absolute (a policy may raise it to 12 h), no idle lock; native patients
 * 300 s access; clinicians 300 s access, 8 h absolute, a 15 min idle lock in
 * the frames and none on headless/native (a policy may set one).
 */
export const SESSION_LIFETIMES: {
  readonly patient: {readonly [S in PatientSurface]: SurfaceLifetime};
  readonly clinician: {readonly [S in ClinicianSurface]: SurfaceLifetime};
} = {
  patient: {
    async: PATIENT_FRAME_LIFETIME,
    telehealth: PATIENT_FRAME_LIFETIME,
    agent: PATIENT_FRAME_LIFETIME,
    headless: PATIENT_FRAME_LIFETIME,
    native: {...PATIENT_FRAME_LIFETIME, accessSeconds: 300},
  },
  clinician: {
    workspace: CLINICIAN_FRAME_LIFETIME,
    consultation: CLINICIAN_FRAME_LIFETIME,
    headless: CLINICIAN_REST_LIFETIME,
    native: CLINICIAN_REST_LIFETIME,
  },
};

/** The lifetimes of `surface` for `audience`, or null when the surface is not one of the audience's. */
export function lifetimeOf(audience: SessionAudience, surface: SessionSurface): SurfaceLifetime | null {
  if (!isSurfaceOf(audience, surface)) return null;
  return audience === 'patient'
    ? SESSION_LIFETIMES.patient[surface as PatientSurface]
    : SESSION_LIFETIMES.clinician[surface as ClinicianSurface];
}

/** Shortest configurable inactivity lock, in seconds. */
export const SESSION_IDLE_MIN_SECONDS = 60;
/** Longest configurable inactivity lock, in seconds. */
export const SESSION_IDLE_MAX_SECONDS = PROVIDER_EMBED_IDLE_TIMEOUT_SECONDS;
/** The broker renews this many seconds before `expiresAt` (`renewAfter`). */
export const SESSION_RENEW_LEAD_SECONDS = PROVIDER_EMBED_RENEW_LEAD_SECONDS;
/** After a renewal the previous secret stays valid this long, so in-flight calls survive (F60). */
export const SESSION_SECRET_OVERLAP_SECONDS = PROVIDER_EMBED_PREVIOUS_SECRET_OVERLAP_SECONDS;
/**
 * `absoluteExpiresAt = min(policy absolute, until)`; when fewer than this many
 * seconds would remain the mint answers `401 login_expired`.
 */
export const SESSION_MIN_REMAINING_SECONDS = 300;
/** Step-up (M2): choosing or adding a pharmacy requires `identifiedAt` within this many seconds. */
export const SESSION_STEP_UP_MAX_AGE_SECONDS = 300;

/**
 * Default rate budgets (§4.5 rules, M4). Per-partner budgets are
 * fixed-window counters raised per partner; every limit fails closed with
 * `429` and `Retry-After`. The gateway throttle is only a backstop.
 */
export const SESSION_RATE_LIMITS = {
  /** Mints per second per partner. */
  partnerMintPerSecond: 20,
  /** Renewals (and successor mints) per second per partner, sized for about 50k open elements. */
  partnerRenewPerSecond: 60,
  /** Mints and renewals per minute per subject. */
  subjectPerMinute: 30,
  /** Starts per hour per patient. */
  patientStartsPerHour: 5,
  /** Agent messages per patient per day (D8), adjustable per partner. */
  agentMessagesPerDay: 200,
  /** API Gateway method throttle on `/v1/sessions`, requests per second (backstop only). */
  gatewayRatePerSecond: 500,
  /** API Gateway burst on `/v1/sessions` (backstop only). */
  gatewayBurst: 1000,
} as const;

// ----------------------------------------------- call continuity (§4.11, D12)

/** Pre-join margin added to a scheduled appointment's length, in seconds (owner-set: 15 min). */
export const PREJOIN_SCHEDULED_MARGIN_SECONDS = 900;
/** Pre-join threshold of an on-demand or live call, in seconds (owner-set: 30 min). */
export const PREJOIN_ON_DEMAND_SECONDS = 1_800;
/** The mid-call handover to a successor session starts this many seconds before `absoluteExpiresAt`. */
export const HANDOVER_LEAD_SECONDS = 300;
/** A successor's absolute limit must exceed its predecessor's by at least this many seconds. */
export const SUCCESSOR_MIN_EXTENSION_SECONDS = 300;
/** A failed handover is retried this often, in seconds, until the limit. */
export const HANDOVER_RETRY_SECONDS = 60;

/**
 * Seconds of session lifetime a video join needs: the scheduled length +
 * 15 min for a scheduled appointment, 30 min for an on-demand call (a null,
 * zero, negative or non-finite length is on-demand).
 */
export function preJoinThresholdSeconds(scheduledLengthSeconds: number | null): number {
  return typeof scheduledLengthSeconds === 'number' && Number.isFinite(scheduledLengthSeconds) && scheduledLengthSeconds > 0
    ? Math.ceil(scheduledLengthSeconds) + PREJOIN_SCHEDULED_MARGIN_SECONDS
    : PREJOIN_ON_DEMAND_SECONDS;
}

/**
 * Whether a session may be used for a join now (server clock).
 * - `fresh: true` when `absoluteExpiresAt − now ≥ threshold`.
 * - Otherwise `needSeconds` (the threshold) and `joinAnywayAllowed`: true
 *   exactly when the CUSTOMER'S LOGIN is the limit, i.e. `untilMs` (the latest
 *   `until` the customer's server sent on mint or renew) is set and
 *   `until − now < threshold`. A fresh session is clamped to that same `until`,
 *   so it could not reach the threshold either (D12). Without `until`, or with
 *   an `until` far enough away, a fresh session would fix it: no Join anyway.
 *
 * The join routes answer `409 session_renewal_required {needSeconds,
 * joinAnywayAllowed}` exactly when this returns `fresh: false` and the join
 * did not qualify for Join anyway ({@link preJoinDecision}).
 */
export function preJoinFreshness(args: {absoluteExpiresAtMs: number; nowMs: number; scheduledLengthSeconds: number | null; untilMs?: number | null}):
  {fresh: true} | {fresh: false; needSeconds: number; joinAnywayAllowed: boolean} {
  const needSeconds = preJoinThresholdSeconds(args.scheduledLengthSeconds);
  if (args.absoluteExpiresAtMs - args.nowMs >= needSeconds * 1000) return {fresh: true};
  const until = args.untilMs;
  const joinAnywayAllowed = typeof until === 'number' && Number.isFinite(until) && until - args.nowMs < needSeconds * 1000;
  return {fresh: false, needSeconds, joinAnywayAllowed};
}

/**
 * Body flag of a join (`acceptShortSession: true`): the user chose "Join
 * anyway" on the D12 screen. The server honours it ONLY when
 * {@link preJoinFreshness} reports `joinAnywayAllowed` (the customer's login
 * is the limit); otherwise `409 session_renewal_required` stands, whatever
 * the flag says. Absent on every other request.
 */
export const ACCEPT_SHORT_SESSION_FIELD = 'acceptShortSession' as const;

/**
 * The join routes' rule in one place: join, or `409 session_renewal_required`
 * with its details. `acceptShortSession` is the request's flag.
 */
export function preJoinDecision(args: {absoluteExpiresAtMs: number; nowMs: number; scheduledLengthSeconds: number | null; untilMs?: number | null; acceptShortSession?: boolean}):
  {join: true; shortSession: boolean} | {join: false; code: 'session_renewal_required'; needSeconds: number; joinAnywayAllowed: boolean} {
  const f = preJoinFreshness(args);
  if (f.fresh) return {join: true, shortSession: false};
  if (args.acceptShortSession === true && f.joinAnywayAllowed) return {join: true, shortSession: true};
  return {join: false, code: 'session_renewal_required', needSeconds: f.needSeconds, joinAnywayAllowed: f.joinAnywayAllowed};
}

/**
 * The join routes and operations: the pre-join check runs on them and they
 * accept {@link ACCEPT_SHORT_SESSION_FIELD}. `room` counts as a join only
 * without `mediaSessionId` (with one it is a media-lease heartbeat).
 */
export const SESSION_JOIN_ROUTES = [
  'POST /v1/provider-embed/consultations/telehealth/{id}/room',
  'POST /v1/provider-embed/consultations/telehealth/{id}/ready',
  'POST /v1/telehealth-consults/{id}/room',
  'POST /v1/telehealth-consults/{id}/ready',
] as const satisfies readonly (ProviderEmbedRoute | Route)[];
/**
 * The patient join operations (AppSync, `nz1` in `Authorization`):
 * `embedConsultJoin`, and `embedAppointmentBeat` when the beat hands out the
 * room of a scheduled call (a plain waiting heartbeat is not a join).
 */
export const SESSION_JOIN_OPERATIONS = ['embedConsultJoin', 'embedAppointmentBeat'] as const;

/**
 * How an element or the SDK revokes ITS OWN session (logout, a reparent, a
 * rescope, and the switch to a fresh pre-join session): the patient
 * `embedLogout` operation (AppSync), and for every clinician surface the
 * provider route `POST /v1/provider-embed/session/logout`, both with the
 * session's own `nz1` credential. Server-side revocation uses
 * `DELETE /v1/sessions/{sessionId}` with the key instead.
 */
export const SESSION_SELF_REVOKE = {
  patient: {operation: 'embedLogout'},
  clinician: {route: 'POST /v1/provider-embed/session/logout'},
} as const satisfies {readonly patient: {readonly operation: string}; readonly clinician: {readonly route: ProviderEmbedRoute}};

/**
 * The patient session operations of the redesign (AppSync, `nz1` in
 * `Authorization`; shapes in `./sessions-schemas`):
 * - `start`: `embedStart(kind, mode?)`, the Natzar-billed in-widget Start
 *   (D1; `embedStartArgsSchema`, `embedStartResultSchema`). The frame then
 *   rescopes to the returned consult (a new session), unless it is the agent
 *   hub, which already reaches it;
 * - `completeProfile`: `embedCompleteProfile(profile)`, only missing fields,
 *   recorded as patient-reported (D5; `profile` is JSON-stringified on the
 *   wire);
 * - `logout`: `embedLogout`, the self-revoke ({@link SESSION_SELF_REVOKE});
 * - `consultEvents`: the subscription `onEmbedConsultEvent(consultId)`,
 *   registered through the session guard (the consult must be in reach) and
 *   pinned to it; events are status-only `{consultId, status}`.
 */
export const PATIENT_SESSION_OPERATIONS = {
  start: 'embedStart',
  completeProfile: 'embedCompleteProfile',
  logout: 'embedLogout',
  consultEvents: 'onEmbedConsultEvent',
} as const;

/**
 * Profile fields a patient may complete in the widget (D5; never the phone),
 * mirroring shared/patient-profile.ts `PROFILE_COMPLETION_FIELDS` (a test
 * holds them equal).
 */
export const PATIENT_PROFILE_FIELDS = ['givenName', 'familyName', 'email', 'birthdate', 'sex', 'state', 'country'] as const;
/** A completable profile field. */
export type PatientProfileField = (typeof PATIENT_PROFILE_FIELDS)[number];
/** The fields a Natzar-billed Start needs (`profile_incomplete` lists the missing ones). */
export const START_REQUIRED_PROFILE_FIELDS = ['givenName', 'familyName', 'birthdate', 'sex'] as const satisfies readonly PatientProfileField[];

/** Whether a live call should hand over to a successor now (T−5 min before the absolute limit). */
export function handoverDue(args: {absoluteExpiresAtMs: number; nowMs: number}): boolean {
  return args.absoluteExpiresAtMs - args.nowMs <= HANDOVER_LEAD_SECONDS * 1000;
}

/** Whether a successor's absolute limit extends its predecessor's by at least {@link SUCCESSOR_MIN_EXTENSION_SECONDS}. */
export function successorExtends(args: {predecessorAbsoluteMs: number; successorAbsoluteMs: number}): boolean {
  return args.successorAbsoluteMs - args.predecessorAbsoluteMs >= SUCCESSOR_MIN_EXTENSION_SECONDS * 1000;
}

// ------------------------------------------------------------- capabilities

/**
 * Capabilities that only the physician REST routes use (the `physician-rest`
 * preset of headless and native clinician sessions): the clinician's own
 * profile, schedule and licences, claiming and escalating threads.
 */
export const PHYSICIAN_REST_ONLY_CAPABILITIES = [
  'profile.read', 'profile.write', 'schedule.read', 'schedule.write', 'licenses.read', 'licenses.write',
  'consult.claim', 'consult.escalate',
] as const;
/**
 * Every capability a clinician session can hold: the provider embed's list
 * (unchanged) plus {@link PHYSICIAN_REST_ONLY_CAPABILITIES}. No wildcards, no
 * free-form scopes.
 */
export const CLINICIAN_CAPABILITIES = /* @__PURE__ */ (PROVIDER_EMBED_CAPABILITIES as readonly string[]).concat(PHYSICIAN_REST_ONLY_CAPABILITIES) as unknown as readonly [
  ...typeof PROVIDER_EMBED_CAPABILITIES, ...typeof PHYSICIAN_REST_ONLY_CAPABILITIES,
];
/** One clinician capability. */
export type ClinicianCapability = ProviderEmbedCapability | (typeof PHYSICIAN_REST_ONLY_CAPABILITIES)[number];

/**
 * Every route of today's physician SESSION allowlist
 * (`PHYSICIAN_SESSION_ROUTES`, amplify/functions/partner-api/handler.ts): the
 * route set headless and native clinician sessions keep (§3.9, D10). A test
 * holds this list equal to the handler's.
 */
export const PHYSICIAN_REST_ROUTES = [
  'GET /v1/drugs',
  'GET /v1/physicians/{id}/eprescribing',
  'GET /v1/physicians/{id}',
  'POST /v1/physicians/{id}/presence',
  'POST /v1/physicians/{id}/heartbeat',
  'POST /v1/physicians/{id}/availability',
  'GET /v1/physicians/{id}/workspace',
  'GET /v1/physicians/{id}/agenda',
  'GET /v1/physicians/{id}/schedule',
  'PUT /v1/physicians/{id}/schedule',
  'PATCH /v1/physicians/{id}/schedule',
  'GET /v1/physicians/{id}/licenses',
  'PUT /v1/physicians/{id}/licenses',
  'PUT /v1/physicians/{id}/specialties',
  'PUT /v1/physicians/{id}/languages',
  'GET /v1/specialties',
  'GET /v1/telehealth-consults',
  'GET /v1/telehealth-consults/{id}',
  'POST /v1/telehealth-consults/{id}/room',
  'POST /v1/telehealth-consults/{id}/end',
  'POST /v1/telehealth-consults/{id}/ready',
  'POST /v1/telehealth-consults/{id}/cancel',
  'GET /v1/async-consults',
  'GET /v1/async-consults/{id}',
  'GET /v1/async-consults/{id}/messages',
  'POST /v1/async-consults/{id}/replies',
  'POST /v1/async-consults/{id}/referrals',
  'POST /v1/async-consults/{id}/prescriptions',
  'POST /v1/async-consults/{id}/claim',
  'POST /v1/async-consults/{id}/takeover',
  'POST /v1/async-consults/{id}/resolve',
  'POST /v1/async-consults/{id}/close',
  'POST /v1/async-consults/{id}/escalate',
  'POST /v1/attachments/upload-urls',
  'GET /v1/patients',
  'GET /v1/patients/{id}',
  'GET /v1/agent/messages',
] as const satisfies readonly Route[];
/** A route of the `physician-rest` preset. */
export type PhysicianRestRoute = (typeof PHYSICIAN_REST_ROUTES)[number];

/**
 * The capability each `physician-rest` route requires: every route maps to
 * exactly one. partner-api dispatch checks it on every request of a headless
 * or native clinician session (§7, M3), after the session `GetItem`.
 *
 * The provider embed's deployment gates (media flag, prescribing transport readiness,
 * patient-mode only) narrow the FRAME surfaces; this preset keeps today's REST
 * behaviour, video included, and is released separately after rmc's e2e
 * suites (RG6).
 */
export const PHYSICIAN_REST_ROUTE_CAPABILITY: {readonly [R in PhysicianRestRoute]: ClinicianCapability} = {
  'GET /v1/drugs': 'prescriptions.issue',
  'GET /v1/physicians/{id}/eprescribing': 'profile.read',
  'GET /v1/physicians/{id}': 'profile.read',
  'POST /v1/physicians/{id}/presence': 'presence.write',
  'POST /v1/physicians/{id}/heartbeat': 'presence.write',
  'POST /v1/physicians/{id}/availability': 'availability.write',
  'GET /v1/physicians/{id}/workspace': 'workspace.read',
  'GET /v1/physicians/{id}/agenda': 'appointments.read',
  'GET /v1/physicians/{id}/schedule': 'schedule.read',
  'PUT /v1/physicians/{id}/schedule': 'schedule.write',
  'PATCH /v1/physicians/{id}/schedule': 'schedule.write',
  'GET /v1/physicians/{id}/licenses': 'licenses.read',
  'PUT /v1/physicians/{id}/licenses': 'licenses.write',
  'PUT /v1/physicians/{id}/specialties': 'profile.write',
  'PUT /v1/physicians/{id}/languages': 'profile.write',
  // The tenant's specialty catalog, read to fill the specialties form.
  'GET /v1/specialties': 'profile.read',
  'GET /v1/telehealth-consults': 'consult.read',
  'GET /v1/telehealth-consults/{id}': 'consult.read',
  'POST /v1/telehealth-consults/{id}/room': 'telehealth.join',
  'POST /v1/telehealth-consults/{id}/end': 'telehealth.end',
  'POST /v1/telehealth-consults/{id}/ready': 'telehealth.join',
  'POST /v1/telehealth-consults/{id}/cancel': 'appointments.cancel',
  'GET /v1/async-consults': 'consult.read',
  'GET /v1/async-consults/{id}': 'consult.read',
  'GET /v1/async-consults/{id}/messages': 'consult.read',
  'POST /v1/async-consults/{id}/replies': 'consult.reply',
  'POST /v1/async-consults/{id}/referrals': 'referrals.issue',
  'POST /v1/async-consults/{id}/prescriptions': 'prescriptions.issue',
  'POST /v1/async-consults/{id}/claim': 'consult.claim',
  'POST /v1/async-consults/{id}/takeover': 'consult.claim',
  'POST /v1/async-consults/{id}/resolve': 'consult.complete',
  'POST /v1/async-consults/{id}/close': 'consult.complete',
  'POST /v1/async-consults/{id}/escalate': 'consult.escalate',
  'POST /v1/attachments/upload-urls': 'attachments.write',
  'GET /v1/patients': 'patient.read',
  'GET /v1/patients/{id}': 'patient.read',
  // The patient's agent conversation, read as context for their consults.
  'GET /v1/agent/messages': 'patient.read',
};

/** The `physician-rest` preset: every capability some physician REST route requires. */
export const PHYSICIAN_REST_CAPABILITIES: readonly ClinicianCapability[] = /* @__PURE__ */ CLINICIAN_CAPABILITIES.filter((c) =>
  (Object.values(PHYSICIAN_REST_ROUTE_CAPABILITY) as readonly string[]).includes(c));

/** Whether a headless or native clinician session holding `capabilities` may call `route`. Unknown routes are refused. */
export function physicianRestAllows(route: string, capabilities: readonly string[]): boolean {
  if (!Object.prototype.hasOwnProperty.call(PHYSICIAN_REST_ROUTE_CAPABILITY, route)) return false;
  return capabilities.includes(PHYSICIAN_REST_ROUTE_CAPABILITY[route as PhysicianRestRoute]);
}

/**
 * The most each clinician surface can ever hold, before `∩ policy[surface] ∩
 * released` at mint. The frame surfaces keep the provider embed's mode
 * matrix (`workspace:patient` is a workspace session minted with `patient`,
 * patient mode, still behind its flag); headless and native get the
 * `physician-rest` preset.
 */
export const CLINICIAN_SURFACE_CAPABILITIES: {
  readonly workspace: readonly ClinicianCapability[];
  readonly 'workspace:patient': readonly ClinicianCapability[];
  readonly 'consultation:async': readonly ClinicianCapability[];
  readonly 'consultation:telehealth': readonly ClinicianCapability[];
  readonly headless: readonly ClinicianCapability[];
  readonly native: readonly ClinicianCapability[];
} = {
  workspace: PROVIDER_EMBED_MODE_CAPABILITIES.workspace,
  'workspace:patient': PROVIDER_EMBED_MODE_CAPABILITIES.patient,
  'consultation:async': PROVIDER_EMBED_MODE_CAPABILITIES['consultation:async'],
  'consultation:telehealth': PROVIDER_EMBED_MODE_CAPABILITIES['consultation:telehealth'],
  headless: PHYSICIAN_REST_CAPABILITIES,
  native: PHYSICIAN_REST_CAPABILITIES,
};

/** Why a requested capability was not granted (the grant's `unavailable`). */
export const SESSION_UNAVAILABLE_REASONS = [
  'not_in_policy', 'not_for_surface', 'not_in_view', 'not_released', 'deployment_disabled', 'tenant_feature_disabled',
  'transport_unsupported',
] as const;
/** A reason code for an ungranted capability. */
export type SessionUnavailableReason = (typeof SESSION_UNAVAILABLE_REASONS)[number];

// -------------------------------------------------- provider views (§4.12)

/** The `view` attribute of `<natzar-provider>` (D13). Absent means `workspace`. */
export const PROVIDER_VIEWS = ['workspace', 'inbox', 'agenda', 'availability'] as const;
/** A provider module. */
export type ProviderView = (typeof PROVIDER_VIEWS)[number];
/** The view of a workspace session minted without one. */
export const DEFAULT_PROVIDER_VIEW: ProviderView = 'workspace';
/** The `navigation` attribute: `module` (default) opens items inside the module; `host` emits `natzar:provider:open`. */
export const PROVIDER_NAVIGATION_MODES = ['module', 'host'] as const;
/** How a provider module navigates. */
export type ProviderNavigationMode = (typeof PROVIDER_NAVIGATION_MODES)[number];

/** Sections of `GET /v1/provider-embed/workspace` (its `async` and `telehealth` blocks; presence sits in `telehealth`). */
export const WORKSPACE_SECTIONS = ['async', 'telehealth'] as const;
/** A workspace section. */
export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number];

/** A view's least-privilege preset: data the session filter and the RG1 matrix read (RG0 F9). */
export interface ProviderViewPreset {
  /** The most the view's session can hold (∩ policy ∩ released at mint). */
  readonly capabilities: readonly ClinicianCapability[];
  /** Consult kinds its routes may touch; any other kind answers `404` (reads) or `403 not_in_view`. */
  readonly consultKinds: readonly SessionConsultKind[];
  /** The workspace sections it may receive through `workspace.read`; every other section is `null`. Empty without `workspace.read`. */
  readonly workspaceSections: readonly WorkspaceSection[];
  /** Whether appointment rows may carry the patient summary; false ⇒ `patient: null` on every row (own slots only). */
  readonly appointmentPatientData: boolean;
}

/**
 * The §4.12 presets. The server stores the view on the session (immutable;
 * a change rescopes to a new session) and every route checks capability AND
 * consult kind against it, and applies `workspaceSections` and
 * `appointmentPatientData`: `inbox` receives the inbox lists only (no video
 * queue, agenda or presence), `availability` its own slots with no patient
 * data.
 */
export const PROVIDER_VIEW_PRESETS: {readonly [V in ProviderView]: ProviderViewPreset} = {
  workspace: {
    capabilities: PROVIDER_EMBED_MODE_CAPABILITIES.workspace,
    consultKinds: ['async', 'telehealth'],
    workspaceSections: ['async', 'telehealth'],
    appointmentPatientData: true,
  },
  inbox: {
    capabilities: [
      'workspace.read', 'consult.read', 'consult.reply', 'consult.complete', 'attachments.read', 'attachments.write',
      'referrals.preview', 'referrals.issue', 'prescriptions.preview', 'prescriptions.issue', 'patient.read',
    ],
    consultKinds: ['async'],
    workspaceSections: ['async'],
    appointmentPatientData: true,
  },
  agenda: {
    capabilities: [
      'appointments.read', 'appointments.cancel', 'consult.read', 'telehealth.join', 'telehealth.end', 'attachments.read',
      'referrals.preview', 'referrals.issue', 'prescriptions.preview', 'prescriptions.issue', 'patient.read',
    ],
    consultKinds: ['telehealth'],
    workspaceSections: [],
    appointmentPatientData: true,
  },
  availability: {
    capabilities: ['availability.write', 'presence.write', 'appointments.read'],
    consultKinds: [],
    workspaceSections: [],
    appointmentPatientData: false,
  },
};

/**
 * The view named by `value` (undefined means {@link DEFAULT_PROVIDER_VIEW}),
 * or `invalid_request`: an unknown view fails the mint with `400`.
 */
export function resolveProviderView(value: unknown):
  {ok: true; view: ProviderView; preset: ProviderViewPreset} | {ok: false; code: 'invalid_request'} {
  const view = value === undefined ? DEFAULT_PROVIDER_VIEW : value;
  if (typeof view !== 'string' || !(PROVIDER_VIEWS as readonly string[]).includes(view)) return {ok: false, code: 'invalid_request'};
  return {ok: true, view: view as ProviderView, preset: PROVIDER_VIEW_PRESETS[view as ProviderView]};
}

/** Whether a session of `view` may use `capability` on a consult of `kind` (omit `kind` for non-consult routes). */
export function viewAllows(view: ProviderView, args: {capability: ClinicianCapability; kind?: SessionConsultKind}): boolean {
  const preset = PROVIDER_VIEW_PRESETS[view];
  if (!preset.capabilities.includes(args.capability)) return false;
  return args.kind === undefined || preset.consultKinds.includes(args.kind);
}

// ------------------------------------------------ customer endpoint (§3.7, §4.7)

/** Where the element looks for the middleware by default (same origin). */
export const ENDPOINT_DEFAULT_PATH = '/natzar' as const;
/** CSRF header the broker sends on every POST (forces a CORS preflight cross-site). */
export const ENDPOINT_REQUEST_HEADER = 'X-Natzar-Request' as const;
/** Response header proving the answer came from the middleware, not a same-origin static file (T5, m2). */
export const ENDPOINT_RESPONSE_HEADER = 'X-Natzar-Endpoint' as const;
/** Value of both headers. */
export const ENDPOINT_HEADER_VALUE = '1' as const;
/** Headers on every middleware response (§4.7 rule 8). The broker accepts only JSON carrying {@link ENDPOINT_RESPONSE_HEADER}. */
export const ENDPOINT_RESPONSE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Natzar-Endpoint': ENDPOINT_HEADER_VALUE,
} as const;
/** Largest request body the middleware reads, in bytes. */
export const ENDPOINT_MAX_BODY_BYTES = 4_096;
/** `Cache-Control` of the `GET {endpoint}/embed.js` 302 to the loader. */
export const ENDPOINT_LOADER_CACHE_CONTROL = 'max-age=3600' as const;
/** How long the middleware caches `GET /v1/embed/config`, in seconds (a cache, not state). */
export const ENDPOINT_CONFIG_CACHE_SECONDS = 300;
/**
 * The middleware's routes below its mount point; everything else is 404.
 * `/start` exists only with `onStart`, `/webhook` only with `onEvent`.
 */
export const ENDPOINT_ROUTES = ['POST /session', 'POST /start', 'GET /embed.js', 'GET /config', 'POST /webhook'] as const;
/** A middleware route. */
export type EndpointRoute = (typeof ENDPOINT_ROUTES)[number];

/** Why the broker asks: the first two decide mint vs renew (see {@link askMintKind}). */
export const SESSION_ASK_REASONS = ['initial', 'renew', 'reconnect', 'rescope', 'fresh', 'successor'] as const;
/** Why a session is asked for. `fresh` is the §4.11 pre-join switch, `successor` the mid-call handover. */
export type SessionAskReason = (typeof SESSION_ASK_REASONS)[number];
/** Reasons that name the current session in `sessionId`; every other reason sends `sessionId: null`. */
export const ASK_REASONS_WITH_SESSION = ['renew', 'successor'] as const satisfies readonly SessionAskReason[];

/**
 * What the middleware does with an ask: `renew` sends `sessionId`,
 * `successor` sends `successorOf: sessionId` and no `sessionId`, anything
 * else mints a new logical session.
 */
export function askMintKind(ask: {reason: SessionAskReason}): 'mint' | 'renew' | 'successor' {
  return ask.reason === 'renew' ? 'renew' : ask.reason === 'successor' ? 'successor' : 'mint';
}

const PATH_SEGMENT = /^[A-Za-z0-9._~!$&'()*+,;=:@%-]+$/;

/**
 * Whether `host` is a local development host: `localhost`, any
 * `*.localhost` (RFC 6761: browsers resolve it to loopback) or `127.0.0.1`.
 * Plain http and local origins are accepted for them outside production only.
 */
export function isLocalDevHost(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1';
}

/**
 * Whether `value` is a valid `endpoint` ATTRIBUTE: a same-origin absolute
 * path, one leading `/`, non-empty segments, no `.`/`..` segment (nor a
 * percent-encoded dot, `%2e`, which the URL parser decodes), no backslash,
 * query, fragment, whitespace or trailing `/`, at most 256 characters.
 * Anything else is `error {code:'endpoint_invalid'}` (BS-6).
 */
export function isEndpointPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 2 || value.length > 256 || value[0] !== '/' || /%2e/i.test(value)) return false;
  const segments = value.slice(1).split('/');
  return segments.every((s) => s !== '' && s !== '.' && s !== '..' && PATH_SEGMENT.test(s));
}

/**
 * Whether `value` is a valid `window.natzarConfig.endpoint`: an endpoint path,
 * or (only script can set it) an absolute https URL without credentials,
 * query or fragment and without a trailing `/`; http only on a local host
 * outside production.
 */
export function isConfigEndpoint(value: unknown, opts: {production: boolean}): value is string {
  if (isEndpointPath(value)) return true;
  if (typeof value !== 'string' || value.length > 2_048) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return false;
  const secure = url.protocol === 'https:' || (!opts.production && url.protocol === 'http:' && isLocalDevHost(url.hostname));
  if (!secure) return false;
  const path = url.pathname === '/' ? '' : url.pathname;
  return url.origin + path === value && (path === '' || isEndpointPath(path));
}

/** `${endpoint}/${route}` without doubling a slash; `endpoint` must pass {@link isConfigEndpoint}. */
export function endpointRouteUrl(endpoint: string, route: 'session' | 'start' | 'embed.js' | 'config'): string {
  return `${endpoint.replace(/\/+$/, '')}/${route}`;
}

// ------------------------------------------------------------ error codes

/**
 * The ONLY codes the middleware ever answers the browser with (§4.7 rule 8,
 * m3). Anything else becomes `unavailable`; bodies are never echoed.
 */
export const ENDPOINT_ERROR_CODES = [
  'signed_out', 'forbidden', 'origin_not_allowed', 'wrong_deployment', 'embedding_disabled', 'surface_not_allowed',
  'rate_limited', 'unavailable',
] as const;
/** A middleware error code. */
export type EndpointErrorCode = (typeof ENDPOINT_ERROR_CODES)[number];
/**
 * HTTP status of each middleware code. The broker is status-driven: `401` →
 * signed-out state, `403` → `error {code}`, `429` → retry after
 * `Retry-After`, `5xx` → bounded backoff.
 */
export const ENDPOINT_ERROR_HTTP_STATUS: {readonly [C in EndpointErrorCode]: number} = {
  signed_out: 401,
  forbidden: 403,
  origin_not_allowed: 403,
  wrong_deployment: 403,
  embedding_disabled: 403,
  surface_not_allowed: 403,
  rate_limited: 429,
  unavailable: 502,
};
/** The JSON body of every middleware error. */
export interface EndpointErrorBody {
  /** One of {@link ENDPOINT_ERROR_CODES}. */
  error: EndpointErrorCode;
}

/**
 * Error codes of the Natzar session routes (`/v1/sessions*`,
 * `/v1/embed/*`, `/v1/physicians/{id}/deactivate`) and of `nz1` credential
 * use on every operation, with their statuses. Seen by the customer's server
 * and the frames, never passed through to the page as-is (see
 * {@link endpointErrorFor}).
 */
export const SESSIONS_API_ERROR_HTTP_STATUS = {
  invalid_request: 400,
  unauthorized: 401,
  login_expired: 401,
  clinician_proof_invalid: 401,
  session_invalid: 401,
  session_expired: 401,
  session_ended: 401,
  session_revoked: 401,
  session_locked: 401,
  forbidden: 403,
  renew_mismatch: 403,
  origin_not_allowed: 403,
  embedding_disabled: 403,
  surface_not_allowed: 403,
  delegation_not_allowed: 403,
  clinician_unavailable: 403,
  capability_not_granted: 403,
  not_in_view: 403,
  not_found: 404,
  phone_unavailable: 409,
  successor_refused: 409,
  session_renewal_required: 409,
  renew_conflict: 409,
  rate_limited: 429,
  internal_error: 500,
  dependency_unavailable: 503,
} as const;
/** A session-API error code. */
export type SessionsApiErrorCode = keyof typeof SESSIONS_API_ERROR_HTTP_STATUS;
/** Every session-API error code. */
export const SESSIONS_API_ERROR_CODES = /* @__PURE__ */ Object.keys(SESSIONS_API_ERROR_HTTP_STATUS) as SessionsApiErrorCode[];
/**
 * Codes of the patient embed operations (M2), answered IN BAND
 * (`{ok: false, error, ...details}`, see `embedOperationRefusalSchema`),
 * with the HTTP class they correspond to:
 * - `agent_limit_reached` (429) `{retryAfterSeconds}`: the patient's daily
 *   agent cap (D8); the frame shows its localized limit state;
 * - `start_not_allowed` (403): an in-widget Start the policy, the tenant's
 *   price list or the visit matrix does not allow (the reason is audited only);
 * - `profile_incomplete` (409) `{missing}`: Natzar opens a visit only for a
 *   patient with a clinical identity; the frame asks for `missing` (D5) and
 *   Starts again;
 * - `invalid_profile` (422) `{field?}`: a profile completion value the
 *   server refuses (never echoed).
 */
export const PATIENT_OPERATION_ERROR_HTTP_STATUS = {
  agent_limit_reached: 429,
  start_not_allowed: 403,
  profile_incomplete: 409,
  invalid_profile: 422,
} as const;
/** A patient operation code. */
export type PatientOperationErrorCode = keyof typeof PATIENT_OPERATION_ERROR_HTTP_STATUS;
/** Every patient operation code. */
export const PATIENT_OPERATION_ERROR_CODES = Object.keys(PATIENT_OPERATION_ERROR_HTTP_STATUS) as PatientOperationErrorCode[];
/** Patient codes the frame answers in its own UI (the D5 form) and never reports to the page or the failure policy. */
export const IN_FRAME_PATIENT_CODES = ['profile_incomplete', 'invalid_profile'] as const satisfies readonly PatientOperationErrorCode[];
/**
 * The `reason` of a step-up refusal: choosing or adding a pharmacy (F46, F48)
 * needs `identify` within {@link SESSION_STEP_UP_MAX_AGE_SECONDS}; the
 * operation answers `session_expired` with `{reason: 'step_up'}`, and
 * {@link operationFailureAction} renews (which re-runs `identify`) and
 * retries the operation ONCE.
 */
export const STEP_UP_REASON = 'step_up' as const;

/** Credential-use codes the frame answers by renewing the SAME session. */
export const SESSION_RENEWABLE_CODES = ['session_expired'] as const satisfies readonly SessionsApiErrorCode[];
/** Credential-use codes that end the logical session (never retried with backoff; RG0 F2). */
export const SESSION_TERMINAL_CODES = [
  'session_invalid', 'session_ended', 'session_revoked', 'session_locked', 'embedding_disabled',
] as const satisfies readonly SessionsApiErrorCode[];
/**
 * Session-API codes that reach the page as `unavailable` although they are
 * 4xx: integration bugs of the customer's server (a malformed body, a wrong
 * key). Every other 4xx maps to a 4xx middleware code.
 */
export const INTEGRATION_BUG_CODES = ['invalid_request', 'unauthorized'] as const satisfies readonly SessionsApiErrorCode[];

/**
 * The middleware code for a session-API error:
 * - the allowlisted codes pass through;
 * - an expired login or clinician proof becomes `signed_out` (401);
 * - a dead or refused session (`session_*`, `renew_mismatch`,
 *   `renew_conflict`, `successor_refused`, `session_renewal_required`) and
 *   every refusal about the user's authority (including upsert conflicts and
 *   unknown subjects, T11) become a generic `forbidden` (403, never retried
 *   with backoff; the broker acts on it per {@link askFailureAction});
 * - anything else, unknown codes and {@link INTEGRATION_BUG_CODES} included,
 *   becomes `unavailable`.
 */
export function endpointErrorFor(apiCode: unknown): EndpointErrorCode {
  if (typeof apiCode !== 'string') return 'unavailable';
  if ((ENDPOINT_ERROR_CODES as readonly string[]).includes(apiCode)) return apiCode as EndpointErrorCode;
  if (apiCode === 'login_expired' || apiCode === 'clinician_proof_invalid') return 'signed_out';
  if (apiCode === 'agent_limit_reached') return 'rate_limited';
  const forbidden: readonly string[] = [
    'session_invalid', 'session_expired', 'session_ended', 'session_revoked', 'session_locked', 'renew_mismatch',
    'renew_conflict', 'successor_refused', 'session_renewal_required', 'delegation_not_allowed', 'clinician_unavailable',
    'capability_not_granted', 'not_in_view', 'not_found', 'phone_unavailable', 'start_not_allowed', 'profile_incomplete',
    'invalid_profile',
  ];
  return forbidden.includes(apiCode) ? 'forbidden' : 'unavailable';
}

// ------------------------------------------------ failure policy (RG0 F2)

/** Why a session ended, as the element's `expired` event reports it (`idle` only for clinicians). */
export type SessionExpiredReason = 'access' | 'absolute' | 'idle' | 'revoked' | 'signed_out';
/**
 * What an element (the loader's broker, the browser SDK) does after a failed
 * session ask or a failed operation. One table for M4 and M5, so they cannot
 * diverge.
 */
export type SessionFailureAction =
  /** Ask again: after `Retry-After` (429) or with bounded backoff (5xx, network). */
  | {action: 'retry'}
  /** Renew the SAME session (reason `renew`). */
  | {action: 'renew'}
  /** The logical session is gone: mint a new one once (reason `reconnect`); its failure follows the `reconnect` row. */
  | {action: 'reconnect'}
  /** §4.11 pre-join: switch to a fresh session (reason `fresh`), then retry the join once. */
  | {action: 'fresh'}
  /** End the session for good: clear the UI and fire `expired {reason}`. */
  | {action: 'expired'; reason: SessionExpiredReason}
  /**
   * The localized signed-out state and `expired {reason:'signed_out'}`. After
   * a failed `fresh` ask it is NOT an end: the current session still works,
   * and the element says "sign in again on <site>" (RG4B N4).
   */
  | {action: 'signed_out'}
  /** Fire `error {code}` and stop; never retried automatically. */
  | {action: 'error'}
  /**
   * D12: offer "Join anyway" on the CURRENT session with its expected end
   * time. Only the SERVER's join refusal yields it (`409
   * session_renewal_required` with `joinAnywayAllowed`); no ask-failure row
   * does (RG4B N4).
   */
  | {action: 'join_anyway'}
  /** §4.11: never tear a live call down; countdown banner, retry every {@link HANDOVER_RETRY_SECONDS} until the limit. */
  | {action: 'keep_call'};

/**
 * Failures of a session ask: the middleware codes plus what the broker sees
 * itself (`network_error`; `endpoint_misconfigured`; `session_callback_failed`,
 * a manual `getSession` that threw; `grant_rejected`, a grant that failed its
 * check or did not unseal, reported with its own element code).
 */
export const ASK_FAILURE_CODES = [
  ...ENDPOINT_ERROR_CODES, 'network_error', 'endpoint_misconfigured', 'session_callback_failed', 'grant_rejected',
] as const;
/** An ask failure. */
export type AskFailureCode = (typeof ASK_FAILURE_CODES)[number];

const RETRY: SessionFailureAction = {action: 'retry'};
const ERROR: SessionFailureAction = {action: 'error'};
const TRANSIENT: readonly AskFailureCode[] = ['rate_limited', 'unavailable', 'network_error', 'session_callback_failed'];
const CONFIG: readonly AskFailureCode[] = ['origin_not_allowed', 'wrong_deployment', 'embedding_disabled', 'surface_not_allowed'];

function askRow(pick: (code: AskFailureCode) => SessionFailureAction): {readonly [C in AskFailureCode]: SessionFailureAction} {
  return Object.fromEntries(ASK_FAILURE_CODES.map((c) => [c, pick(c)])) as {[C in AskFailureCode]: SessionFailureAction};
}
const mintRow = askRow((c) => (c === 'signed_out' ? {action: 'signed_out'} : TRANSIENT.includes(c) ? RETRY : ERROR));

/**
 * Reason × failure → action (§4.2 broker table, §4.11, D12):
 * - `initial`, `reconnect`, `rescope`: the §4.2 table: `signed_out` → the
 *   signed-out state; 429, 5xx, network → retry; anything else → `error`.
 * - `renew`: `signed_out` → signed-out state; `forbidden` (the session is
 *   dead, revoked or refused) → ONE `reconnect` mint (an idle-locked frame
 *   instead stays locked, see {@link askFailureAction}); a policy refusal
 *   (origin, deployment, embedding, surface) → `expired {revoked}`; transient
 *   → retry (renewal is allowed after access expiry until the absolute limit).
 * - `fresh` (the current session still works and is never ended here):
 *   `signed_out` → the "sign in again on <site>" state (not an end);
 *   transient → retry, and once the bounded retries are spent, `error` (the
 *   join attempt failed; a manual Try again); anything else → `error`. Join
 *   anyway is never an ask outcome: only the server's join refusal
 *   (`joinAnywayAllowed`, {@link preJoinDecision}) allows it (RG4B N4).
 * - `successor` (a call is live): every failure → `keep_call`.
 */
export const ASK_FAILURE_POLICY: {readonly [R in SessionAskReason]: {readonly [C in AskFailureCode]: SessionFailureAction}} = {
  initial: mintRow,
  reconnect: mintRow,
  rescope: mintRow,
  renew: askRow((c) => (c === 'signed_out' ? {action: 'signed_out'}
    : c === 'forbidden' ? {action: 'reconnect'}
      : CONFIG.includes(c) ? {action: 'expired', reason: 'revoked'}
        : TRANSIENT.includes(c) ? RETRY : ERROR)),
  fresh: askRow((c) => (c === 'signed_out' ? {action: 'signed_out'} : TRANSIENT.includes(c) ? RETRY : ERROR)),
  successor: askRow(() => ({action: 'keep_call'})),
};

/**
 * The action for a failed ask. `idleLocked`: a clinician frame whose session
 * locked after inactivity never unlocks by itself, so a refused renew leaves
 * it locked (`expired {idle}`) instead of reconnecting.
 */
export function askFailureAction(reason: SessionAskReason, code: AskFailureCode, ctx: {idleLocked: boolean}): SessionFailureAction {
  const action = ASK_FAILURE_POLICY[reason][code];
  return action.action === 'reconnect' && ctx.idleLocked ? {action: 'expired', reason: 'idle'} : action;
}

/**
 * What the frame or SDK does when an OPERATION (an `embed*` operation, a
 * provider or physician REST route) answers a credential code:
 * `session_expired` (also a step-up refusal, `{reason: 'step_up'}`) → renew,
 * which re-runs `identify`, then retry the operation ONCE;
 * `session_renewal_required` (409 on a join) → fresh session, one retry; the
 * terminal codes → `expired` with their reason; 429 and 5xx → retry;
 * `agent_limit_reached` and `start_not_allowed` → `error` (the element
 * reports them; never retried automatically); anything else → `error`.
 * {@link IN_FRAME_PATIENT_CODES} never reach this policy.
 */
export const SESSION_OPERATION_FAILURE_POLICY: {readonly [C in SessionsApiErrorCode | PatientOperationErrorCode]?: SessionFailureAction} = {
  session_expired: {action: 'renew'},
  session_renewal_required: {action: 'fresh'},
  session_invalid: {action: 'expired', reason: 'revoked'},
  session_revoked: {action: 'expired', reason: 'revoked'},
  session_ended: {action: 'expired', reason: 'absolute'},
  session_locked: {action: 'expired', reason: 'idle'},
  embedding_disabled: {action: 'expired', reason: 'revoked'},
  rate_limited: RETRY,
  internal_error: RETRY,
  dependency_unavailable: RETRY,
  agent_limit_reached: ERROR,
  start_not_allowed: ERROR,
};

/**
 * The action for an operation that answered `apiCode` (unknown codes →
 * `error`). `retried`: the operation already ran once after a renew or fresh
 * switch; a second `session_expired` (a step-up the renewal could not
 * satisfy) or `session_renewal_required` then stops (`error`): one retry,
 * never a loop.
 */
export function operationFailureAction(apiCode: unknown, ctx: {retried?: boolean} = {}): SessionFailureAction {
  if (typeof apiCode !== 'string' || !Object.prototype.hasOwnProperty.call(SESSION_OPERATION_FAILURE_POLICY, apiCode)) return ERROR;
  const action = SESSION_OPERATION_FAILURE_POLICY[apiCode as SessionsApiErrorCode | PatientOperationErrorCode] ?? ERROR;
  return ctx.retried === true && (action.action === 'renew' || action.action === 'fresh') ? ERROR : action;
}

/**
 * Every `code` an element reports in its `error` event (patient
 * `natzar:error`, provider `natzar:provider:error`): the middleware codes,
 * then the codes the loader and frames raise themselves.
 */
export const ELEMENT_ERROR_CODES = [
  ...ENDPOINT_ERROR_CODES,
  'endpoint_invalid', 'endpoint_misconfigured', 'attribute_invalid',
  'handshake_timeout', 'protocol_mismatch', 'origin_rejected', 'frame_url_rejected', 'session_grant_invalid',
  'session_mismatch', 'unseal_failed',
  'session_callback_failed', 'session_expired', 'session_locked', 'session_revoked', 'connect_aborted', 'not_connected',
  'already_connected',
  'navigation_refused', 'media_permission_denied', 'media_admission_failed', 'network_error',
] as const;
/** An element error code. */
export type ElementErrorCode = (typeof ELEMENT_ERROR_CODES)[number];
/** Codes only patient elements report (`natzar:error`), in addition to {@link ELEMENT_ERROR_CODES}. */
export const PATIENT_ELEMENT_ERROR_CODES = ['agent_limit_reached', 'start_not_allowed'] as const satisfies readonly PatientOperationErrorCode[];
/** A code a patient element may report. */
export type PatientElementErrorCode = ElementErrorCode | (typeof PATIENT_ELEMENT_ERROR_CODES)[number];
/** The fixed, data-free `message` of each element error code (also the console text). */
export const ELEMENT_ERROR_MESSAGES: {readonly [C in PatientElementErrorCode]: string} = {
  signed_out: 'The user is not signed in on this site.',
  forbidden: 'This user may not open this session.',
  origin_not_allowed: 'This page origin is not registered for embedding.',
  wrong_deployment: 'The session belongs to a different Natzar environment, zone or account than this loader.',
  embedding_disabled: 'Embedding is disabled for this account.',
  surface_not_allowed: 'This surface is not enabled for this account or endpoint.',
  rate_limited: 'Too many session requests; retrying later.',
  unavailable: 'The session service is unavailable; retrying.',
  endpoint_invalid: 'The endpoint attribute must be a same-origin path such as /natzar.',
  endpoint_misconfigured: 'The endpoint did not answer as the natzar() middleware: mount it before body parsers, CSRF and login redirects.',
  attribute_invalid: 'An element attribute has an invalid value.',
  handshake_timeout: 'The frame did not answer the handshake in time.',
  protocol_mismatch: 'The frame or grant speaks another protocol version.',
  origin_rejected: 'The grant is bound to another page origin.',
  frame_url_rejected: 'The grant names a frame this loader does not trust.',
  session_grant_invalid: 'The session grant is malformed.',
  session_mismatch: 'The grant does not match this element.',
  unseal_failed: 'The session credential could not be opened by this frame.',
  session_callback_failed: 'The getSession callback failed.',
  session_expired: 'The session expired.',
  session_locked: 'The session locked after inactivity.',
  session_revoked: 'The session was revoked.',
  connect_aborted: 'Connecting was cancelled.',
  not_connected: 'The element is not connected.',
  already_connected: 'The element is already connected.',
  navigation_refused: 'The navigation target is outside this session.',
  media_permission_denied: 'Camera or microphone permission was denied.',
  media_admission_failed: 'The call could not be joined.',
  network_error: 'A network error occurred.',
  agent_limit_reached: 'The daily limit of assistant messages is reached; try again later.',
  start_not_allowed: 'Starting a visit here is not available.',
};

// ------------------------------------------------------ API keys (§4.9)

/** Residency zones a key can name; mirrors shared/zones.ts `ZONE_IDS` (a test holds them equal). */
export const API_KEY_ZONES = ['us', 'ca', 'eu'] as const;
/** A residency zone. */
export type SessionZone = (typeof API_KEY_ZONES)[number];
/** Environments of a test key: `dev`, `stage` and every sandbox (`sbx`). */
export const API_KEY_TEST_ENVIRONMENTS = ['dev', 'stage', 'sbx'] as const;
/** A test-key environment. */
export type ApiKeyTestEnvironment = (typeof API_KEY_TEST_ENVIRONMENTS)[number];
/** The environment a key names: `prod` for `pp_live_…`. */
export type ApiKeyEnvironment = 'prod' | ApiKeyTestEnvironment;
/** Length of the random base62 tail of a key. */
export const API_KEY_RANDOM_LENGTH = 48;
/** Production key prefix, followed by the zone: `pp_live_<zone>_`. */
export const API_KEY_LIVE_PREFIX = 'pp_live_' as const;
/** Non-production key prefix, followed by environment and zone: `pp_test_<env>_<zone>_`. */
export const API_KEY_TEST_PREFIX = 'pp_test_' as const;
/** `pp_live_<zone>_<48 base62>` or `pp_test_<env>_<zone>_<48 base62>`. */
export const API_KEY_REGEX = /* @__PURE__ */ new RegExp(
  `^pp_(?:live_(${API_KEY_ZONES.join('|')})|test_(${API_KEY_TEST_ENVIRONMENTS.join('|')})_(${API_KEY_ZONES.join('|')}))_[0-9A-Za-z]{${API_KEY_RANDOM_LENGTH}}$`,
);
/** What a key's prefix says about the deployment it belongs to. */
export interface ParsedApiKey {
  /** A `pp_live_…` key. */
  live: boolean;
  /** `prod`, or the test environment. */
  environment: ApiKeyEnvironment;
  /** The residency zone. */
  zone: SessionZone;
}

/**
 * Environment and zone of a well-formed key, or null. The SDK derives its
 * endpoints from this (`resolveEndpoints({key})`); `sbx` keys have no built-in
 * endpoints and need `NATZAR_API_URL`. The authorizer compares the prefix with
 * its own deployment BEFORE hashing (F90).
 */
export function parseApiKey(key: unknown): ParsedApiKey | null {
  if (typeof key !== 'string') return null;
  const m = API_KEY_REGEX.exec(key);
  if (!m) return null;
  if (m[1] !== undefined) return {live: true, environment: 'prod', zone: m[1] as SessionZone};
  return {live: false, environment: m[2] as ApiKeyTestEnvironment, zone: m[3] as SessionZone};
}

/** The key environment of a deployment environment name: `prod`, `dev`, `stage`, anything else is a sandbox (`sbx`). */
export function apiKeyEnvironmentFor(deploymentEnvironment: string): ApiKeyEnvironment {
  return deploymentEnvironment === 'prod' || deploymentEnvironment === 'dev' || deploymentEnvironment === 'stage'
    ? deploymentEnvironment
    : 'sbx';
}

/** The key prefix a deployment mints and accepts, e.g. `pp_live_us_`, `pp_test_sbx_ca_`. */
export function apiKeyPrefixFor(deployment: {environment: string; zone: SessionZone}): string {
  const env = apiKeyEnvironmentFor(deployment.environment);
  return env === 'prod' ? `${API_KEY_LIVE_PREFIX}${deployment.zone}_` : `${API_KEY_TEST_PREFIX}${env}_${deployment.zone}_`;
}

// ------------------------------------------------ frames, loader, protocol

/** A partner id as it appears in frame paths and the loader URL. */
export const PARTNER_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;
/** A deployment environment name as grants and configurations carry it (`prod`, `stage`, `dev`, a sandbox name). */
export const DEPLOYMENT_ENVIRONMENT_REGEX = /^[a-z0-9-]{1,32}$/;
/** Path prefix of the patient frame shell on the patient frame origin (`/patient/frame/{partnerId}`). */
export const PATIENT_FRAME_PATH_PREFIX = '/patient/frame/' as const;
/** Frame path prefix per audience; the clinician frame keeps the provider embed's. */
export const FRAME_PATH_PREFIXES: {readonly [A in SessionAudience]: string} = {
  patient: PATIENT_FRAME_PATH_PREFIX,
  clinician: PROVIDER_EMBED_FRAME_PATH_PREFIX,
};
/** Path of the unified loader on the patient frame origin; `?p=<partnerId>` carries the partner. */
export const LOADER_V2_PATH = '/v2/natzar.js' as const;
/** Pinned loader for strict CSP / SRI: `/v2/natzar.<version>.js`. */
export const LOADER_V2_PINNED_PATH_REGEX = /^\/v2\/natzar\.[0-9a-z.-]{1,32}\.js$/;
/** The exact `allow` attribute of the patient iframes (F79); never a `sandbox` (F80). */
export const PATIENT_IFRAME_ALLOW = 'camera; microphone; display-capture; geolocation; payment' as const;

/** The frame URL a grant must name: `${frameOrigin}${prefix}${partnerId}`, nothing else. */
export function frameUrlFor(args: {frameOrigin: string; audience: SessionAudience; partnerId: string}): string {
  return `${args.frameOrigin}${FRAME_PATH_PREFIXES[args.audience]}${args.partnerId}`;
}

/** The loader URL `GET {endpoint}/embed.js` redirects to. */
export function loaderUrlFor(args: {patientFrameOrigin: string; partnerId: string}): string {
  return `${args.patientFrameOrigin}${LOADER_V2_PATH}?p=${encodeURIComponent(args.partnerId)}`;
}

/** `protocol` of every v2 `postMessage` envelope (both audiences). Replaces `natzar-provider-v1` and the raw `natzar-embed` source. */
export const EMBED_PROTOCOL = 'natzar-embed-v2' as const;
/** Protocol version of the envelopes AND of the grant (`grant.protocolVersion`). */
export const EMBED_PROTOCOL_VERSION = 2 as const;
/** Channel nonce of a `hello`: 32 random bytes, base64url. */
export const EMBED_NONCE_REGEX = /^[A-Za-z0-9_-]{43}$/;
/** Largest accepted `postMessage` payload, in bytes of serialized JSON (both directions). */
export const EMBED_MAX_MESSAGE_BYTES = PROVIDER_EMBED_MAX_MESSAGE_BYTES;
/** Loader and frame version strings (`loaderVersion`, `frameVersion`). */
export const EMBED_VERSION_STRING_REGEX = /^[0-9A-Za-z.+-]{1,32}$/;
/** Locales of both frames. */
export const EMBED_LOCALES = ['en', 'es', 'de', 'fr', 'it'] as const satisfies readonly EmbedLocale[];
/** Color schemes of both frames; `auto` follows `prefers-color-scheme` live. */
export const EMBED_THEMES = ['light', 'dark', 'auto'] as const;
/** Patient colors (`accent`, `accent-foreground`, `background`, `surface`): hex only, 3, 4, 6 or 8 digits (F68). */
export const PATIENT_HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
/** Patient `font-family`: a font STACK of letters, digits, spaces, commas, quotes and hyphens; no `url(`, `;` or parentheses. */
export const PATIENT_FONT_FAMILY_REGEX = /^[A-Za-z0-9_ ,'"-]{1,60}$/;
/** Largest `radius` in px (the loader clamps the attribute; the message carries the clamped integer). */
export const PRESENTATION_MAX_RADIUS = 24;
/** Provider layout densities. */
export const PROVIDER_DENSITIES = ['comfortable', 'compact'] as const;

/**
 * UTF-8 size of `value` serialized as JSON, or null when it cannot be
 * serialized (cycles, BigInt, a bare function or `undefined`). Receivers
 * drop anything over {@link EMBED_MAX_MESSAGE_BYTES} before any schema runs.
 */
export function messageByteLength(value: unknown): number | null {
  let json: unknown;
  try {
    json = JSON.stringify(value);
  } catch {
    return null;
  }
  if (typeof json !== 'string') return null;
  let bytes = 0;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < json.length) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

// ------------------------------------------------------------- events

/** Patient event names (the 12 of today's tags, unchanged). DOM names are `natzar:<name>`. */
export const PATIENT_EVENT_NAMES = EMBED_EVENT_NAMES;
/** A patient event name. */
export type PatientEventName = (typeof PATIENT_EVENT_NAMES)[number];
/** Why a patient session ended for good (`expired` fires only when renewal is impossible). */
export const PATIENT_EXPIRED_REASONS = ['access', 'absolute', 'revoked', 'signed_out'] as const;

/**
 * Provider event names: the provider embed's nine, plus `switch-request`
 * (cancelable, before a `consult`/`view`/`patient` change rescopes) and
 * `open` (`navigation="host"`). DOM names are `natzar:provider:<name>`.
 */
export const PROVIDER_EVENT_NAMES = [
  'ready', 'error', 'expired', 'unread-change', 'navigation-request', 'consultation-completed', 'call-state-change',
  'dirty-state-change', 'disconnected', 'switch-request', 'open',
] as const;
/** A provider event name. */
export type ProviderEventName = (typeof PROVIDER_EVENT_NAMES)[number];
/** Provider events the FRAME may post; `ready`, `disconnected` and `switch-request` are raised by the loader itself. */
export const PROVIDER_FRAME_EVENT_NAMES = [
  'error', 'expired', 'unread-change', 'navigation-request', 'consultation-completed', 'call-state-change',
  'dirty-state-change', 'open',
] as const satisfies readonly ProviderEventName[];
/** Why a provider session ended. */
export const PROVIDER_EXPIRED_REASONS = ['access', 'absolute', 'idle', 'revoked', 'signed_out'] as const;
/** The only cancelable events: `payment` (`started`) on patient tags, `switch-request` on the provider tag. */
export const CANCELABLE_EVENTS = ['natzar:payment', `${PROVIDER_EMBED_DOM_EVENT_PREFIX}switch-request`] as const;

/** The DOM event name of a patient event. */
export function patientDomEventName(name: PatientEventName): `natzar:${PatientEventName}` {
  return `natzar:${name}`;
}
/** The DOM event name of a provider event. */
export function providerDomEventName(name: ProviderEventName): `natzar:provider:${ProviderEventName}` {
  return `${PROVIDER_EMBED_DOM_EVENT_PREFIX}${name}`;
}

/** Async closed reasons, runtime list of `AsyncClosedReason` (a type test holds them equal). */
export const ASYNC_CLOSED_REASONS = [
  'accept_timeout', 'inactivity', 'consent_timeout', 'no_capacity', 'opted_out', 'cancelled', 'escalated', 'declined',
  'patient_closed', 'fulfilled',
] as const;
/** Message authors, runtime list of `MessageAuthor` (a type test holds them equal). */
export const MESSAGE_AUTHORS = ['patient', 'agent', 'physician', 'system'] as const;

// ------------------------------------------- grant checks (§4.2, §4.3, RG0 F1/F6/F7)

/** Why a grant was refused before use. */
export type GrantCheckCode =
  | 'protocol_mismatch' | 'wrong_deployment' | 'session_mismatch' | 'origin_rejected' | 'frame_url_rejected'
  | 'session_grant_invalid';
/** The grant field that failed. */
export type GrantCheckField =
  | 'protocolVersion' | 'environment' | 'zone' | 'partnerId' | 'audience' | 'surface' | 'parentOrigin' | 'frameUrl'
  | 'apiUrl' | 'graphqlUrl' | 'sealedToken' | 'sessionToken' | 'sessionId' | 'scope.consult' | 'scope.view'
  | 'scope.patient';
/** Outcome of a grant check. */
export type GrantCheckResult = {ok: true} | {ok: false; code: GrantCheckCode; field: GrantCheckField};

/** What the loader expects of a grant, from the element and its own build (never from the grant). */
export interface LoaderGrantExpectation {
  /** The element's audience. */
  audience: SessionAudience;
  /** The element's surface. */
  surface: SessionSurface;
  /** `location.origin` of the page. */
  pageOrigin: string;
  /** The loader's build environment. */
  environment: string;
  /** The zone of the element's endpoint (its config). */
  zone: SessionZone;
  /** The partner of the element's endpoint (its config). */
  partnerId: string;
  /** The frame origin the element created its iframe at (build constants for zone and audience). */
  frameOrigin: string;
  /** `renewed`: the session being renewed. null: a new logical session is expected. */
  sessionId: string | null;
  /** The element's `consult` attribute, or null when it has none (the server resolved the current consult). */
  consult: SessionConsultRef | null;
  /** Clinician workspace: the element's `view` (absent attribute = `workspace`). Otherwise null. */
  view: ProviderView | null;
  /** The element's `patient` attribute (which of the login's patients; clinician patient mode), or null. */
  patient: string | null;
}

/**
 * What a frame expects of a grant: its own configuration, its own key and
 * the bound `hello`. The frame uses ITS OWN configured `apiUrl` and
 * `graphqlUrl` for every call, never the grant's; the grant's must merely
 * equal them.
 */
export interface FrameGrantExpectation {
  /** The frame's audience (from its path). */
  audience: SessionAudience;
  /** The surface of the bound `hello`. */
  surface: SessionSurface;
  /** The origin the frame bound to. */
  boundOrigin: string;
  /** The frame configuration's environment. */
  environment: string;
  /** The frame configuration's zone. */
  zone: SessionZone;
  /** The frame configuration's partner. */
  partnerId: string;
  /** The frame's own URL (`location.origin + location.pathname`). */
  frameUrl: string;
  /** The frame configuration's REST base. */
  apiUrl: string;
  /** The frame configuration's AppSync endpoint. */
  graphqlUrl: string;
  /** `renewed`: the frame's current session. `session`: null. */
  sessionId: string | null;
}

/**
 * What the browser SDK (`headless`) or a native app (`native`) expects of a
 * grant: its own deployment (derived from the key or its configuration),
 * never the grant's. The SDK sends the credential only to the endpoints it
 * derived itself, never to `grant.apiUrl` or `grant.graphqlUrl` (T16).
 */
export interface ClientGrantExpectation {
  /** The client's audience. */
  audience: SessionAudience;
  /** `headless` or `native`. */
  surface: SessionSurface;
  /** The client's deployment environment. */
  environment: string;
  /** The client's zone. */
  zone: SessionZone;
  /** The client's partner (from its endpoint's config). */
  partnerId: string;
  /** Headless: `location.origin`. Native: null (no origin binding). */
  pageOrigin: string | null;
  /** Renewal: the current session. Otherwise null. */
  sessionId: string | null;
  /** The consult the client asked for, or null. */
  consult: SessionConsultRef | null;
  /** The patient the client asked for, or null. */
  patient: string | null;
}

function secureUrl(url: unknown, allowLocalHttp: boolean): boolean {
  if (typeof url !== 'string' || url.length > 2_048) return false;
  try {
    const u = new URL(url);
    if (u.username !== '' || u.password !== '' || u.hash !== '') return false;
    return u.protocol === 'https:' || (allowLocalHttp && u.protocol === 'http:' && isLocalDevHost(u.hostname));
  } catch {
    return false;
  }
}

function isLocalOrigin(origin: string): boolean {
  try {
    return isLocalDevHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function sameConsult(a: SessionConsultRef | undefined, b: SessionConsultRef | null): boolean {
  if (b === null) return true;
  return a !== undefined && a !== null && a.kind === b.kind && a.id === b.id;
}

const fail = (code: GrantCheckCode, field: GrantCheckField): GrantCheckResult => ({ok: false, code, field});

/** Deployment, audience and surface: the checks every side shares. */
function deploymentChecks(
  grant: SessionGrant,
  x: {audience: SessionAudience; surface: SessionSurface; environment: string; zone: SessionZone; partnerId: string},
): GrantCheckResult | null {
  if (grant.protocolVersion !== EMBED_PROTOCOL_VERSION) return fail('protocol_mismatch', 'protocolVersion');
  if (grant.environment !== x.environment) return fail('wrong_deployment', 'environment');
  if (grant.zone !== x.zone) return fail('wrong_deployment', 'zone');
  if (grant.partnerId !== x.partnerId) return fail('wrong_deployment', 'partnerId');
  if (grant.audience !== x.audience) return fail('session_mismatch', 'audience');
  if (grant.surface !== x.surface) return fail('session_mismatch', 'surface');
  return null;
}

/** A sealed credential and never a cleartext one (every surface but `native`). */
function sealedOnly(grant: SessionGrant): GrantCheckResult | null {
  if (grant.sessionToken !== undefined) return fail('session_grant_invalid', 'sessionToken');
  if (typeof grant.sealedToken !== 'object' || grant.sealedToken === null) return fail('session_grant_invalid', 'sealedToken');
  return null;
}

/** The element's narrowing: renewed session, consult, patient, view. A missing narrowing fails closed. */
function scopeChecks(grant: SessionGrant, x: {audience: SessionAudience; surface: SessionSurface; sessionId: string | null; consult: SessionConsultRef | null; patient: string | null; view?: ProviderView | null}): GrantCheckResult | null {
  if (x.sessionId !== null && grant.sessionId !== x.sessionId) return fail('session_mismatch', 'sessionId');
  if (!sameConsult(grant.scope?.consult, x.consult)) return fail('session_mismatch', 'scope.consult');
  if ((grant.scope?.patient ?? null) !== x.patient) return fail('session_mismatch', 'scope.patient');
  // Only a clinician workspace session has a view; the server always stamps it there.
  if (x.view !== undefined) {
    const wantView = x.audience === 'clinician' && x.surface === 'workspace' ? (x.view ?? DEFAULT_PROVIDER_VIEW) : undefined;
    if (grant.scope?.view !== wantView) return fail('session_mismatch', 'scope.view');
  }
  return null;
}

/**
 * The loader's check of a grant before anything is sent to the frame (§4.2),
 * for actionable errors: protocol 2; the environment, zone and partner of the
 * element's deployment (else `wrong_deployment`, and the loader names the
 * right one, F88); the element's audience and a frame surface; a sealed
 * credential only; `parentOrigin === location.origin`; the exact frame URL
 * the element created; https API URLs; the renewed session id; the element's
 * `consult`, `patient` and `view`. The loader forwards the PARSED grant, never
 * the raw object. The binding itself is enforced by the seal: the frame
 * cannot open a grant whose tuple differs from its own facts
 * (`./sessions-crypto`, RG0 F1). Pure; `grant` must already have passed
 * `sessionGrantSchema` (or the loader's own shape check).
 */
export function checkGrantAtLoader(grant: SessionGrant, expect: LoaderGrantExpectation): GrantCheckResult {
  const deployment = deploymentChecks(grant, expect);
  if (deployment) return deployment;
  if (!isFrameSurface(expect.audience, expect.surface)) return fail('session_mismatch', 'surface');
  const sealed = sealedOnly(grant);
  if (sealed) return sealed;
  if (grant.parentOrigin !== expect.pageOrigin) return fail('origin_rejected', 'parentOrigin');
  if (expect.frameOrigin === expect.pageOrigin || grant.frameUrl !== frameUrlFor({frameOrigin: expect.frameOrigin, audience: expect.audience, partnerId: expect.partnerId})) {
    return fail('frame_url_rejected', 'frameUrl');
  }
  const localHttp = isLocalOrigin(expect.frameOrigin);
  if (!secureUrl(grant.apiUrl, localHttp)) return fail('session_grant_invalid', 'apiUrl');
  if (!secureUrl(grant.graphqlUrl, localHttp)) return fail('session_grant_invalid', 'graphqlUrl');
  return scopeChecks(grant, expect) ?? {ok: true};
}

/**
 * The frame's check of a grant before it unseals (§4.3 step 6): protocol 2;
 * its own environment, zone and partner; its audience and the bound surface;
 * a sealed credential only; `parentOrigin === boundOrigin`; its own URL; its
 * own `apiUrl` and `graphqlUrl`; the current session id on renewal. Then the
 * frame unseals with the binding tuple rebuilt from those same facts, so a
 * field the relaying page rewrote fails to open (RG0 F1).
 */
export function checkGrantAtFrame(grant: SessionGrant, expect: FrameGrantExpectation): GrantCheckResult {
  const deployment = deploymentChecks(grant, expect);
  if (deployment) return deployment;
  if (!isFrameSurface(expect.audience, expect.surface)) return fail('session_mismatch', 'surface');
  const sealed = sealedOnly(grant);
  if (sealed) return sealed;
  if (grant.parentOrigin !== expect.boundOrigin) return fail('origin_rejected', 'parentOrigin');
  if (grant.frameUrl !== expect.frameUrl) return fail('frame_url_rejected', 'frameUrl');
  if (grant.apiUrl !== expect.apiUrl) return fail('session_grant_invalid', 'apiUrl');
  if (grant.graphqlUrl !== expect.graphqlUrl) return fail('session_grant_invalid', 'graphqlUrl');
  if (expect.sessionId !== null && grant.sessionId !== expect.sessionId) return fail('session_mismatch', 'sessionId');
  return {ok: true};
}

/**
 * The browser SDK's (`headless`) and a native app's (`native`) check (RG0 F7):
 * protocol 2; the client's own deployment, audience and surface; no frame
 * (`frameUrl` null); `headless`: sealed, `parentOrigin === location.origin`;
 * `native`: the plain `nz1` of this very session, no seal, `parentOrigin`
 * null; the renewed session, `consult` and `patient`. The client then uses
 * only the URLs it derived itself (T16).
 */
export function checkGrantAtClient(grant: SessionGrant, expect: ClientGrantExpectation): GrantCheckResult {
  const deployment = deploymentChecks(grant, expect);
  if (deployment) return deployment;
  if (expect.surface !== 'headless' && expect.surface !== 'native') return fail('session_mismatch', 'surface');
  if (grant.frameUrl !== null) return fail('frame_url_rejected', 'frameUrl');
  if (expect.surface === 'native') {
    if (typeof grant.sessionToken !== 'string' || parseNz1Token(grant.sessionToken)?.sessionId !== grant.sessionId) return fail('session_grant_invalid', 'sessionToken');
    if (grant.sealedToken !== undefined) return fail('session_grant_invalid', 'sealedToken');
    if (grant.parentOrigin !== null || expect.pageOrigin !== null) return fail('origin_rejected', 'parentOrigin');
  } else {
    const sealed = sealedOnly(grant);
    if (sealed) return sealed;
    if (expect.pageOrigin === null || grant.parentOrigin !== expect.pageOrigin) return fail('origin_rejected', 'parentOrigin');
  }
  return scopeChecks(grant, expect) ?? {ok: true};
}

/** Whether `surface` is rendered in a frame for `audience` (see {@link FRAME_SURFACES}). */
export function isFrameSurface(audience: SessionAudience, surface: SessionSurface): boolean {
  const surfaces = (FRAME_SURFACES as Partial<Record<string, readonly string[]>>)[audience];
  return surfaces !== undefined && surfaces.includes(surface);
}

// ------------------------------------------------------------ route tables

/** Path parameters of a route without any. */
export type SessionsNoParams = Record<string, never>;

/**
 * The Natzar session routes (§4.5). All are `auth: 'server'`: your key, from
 * your server only. A request carrying `Origin`, `Sec-Fetch-Site` or
 * `Sec-Fetch-Dest` is refused (Node's own `sec-fetch-mode: cors` is
 * accepted); responses carry `Cache-Control: no-store`. `POST /v1/sessions`
 * answers `201` for a mint and `200` for a renewal.
 */
export interface SessionsEndpoints {
  /** Mint (no `sessionId`), renew (`sessionId`) or hand over (`successorOf`) a session. */
  'POST /v1/sessions': {auth: 'server'; params: SessionsNoParams; query: undefined; request: CreateSessionRequest; response: SessionGrant};
  /** Revoke one session (idempotent, `204`). */
  'DELETE /v1/sessions/{sessionId}': {auth: 'server'; params: {sessionId: string}; query: undefined; request: undefined; response: undefined};
  /** Revoke every session of a login, a patient or a clinician. */
  'POST /v1/sessions/revoke': {auth: 'server'; params: SessionsNoParams; query: undefined; request: RevokeSessionsRequest; response: RevokeSessionsResponse};
  /** The deployment facts the middleware needs; no secrets. */
  'GET /v1/embed/config': {auth: 'server'; params: SessionsNoParams; query: undefined; request: undefined; response: EmbedConfig};
  /** Replace the embedding origin list (§4.8). */
  'PUT /v1/embed/origins': {auth: 'server'; params: SessionsNoParams; query: undefined; request: PutEmbedOriginsRequest; response: PutEmbedOriginsResponse};
  /** Offboarding by our id: not routable, availability cleared, sessions revoked (m11). */
  'POST /v1/physicians/{id}/deactivate': {auth: 'server'; params: {id: string}; query: undefined; request: DeactivatePhysicianRequest; response: DeactivatePhysicianResponse};
  /**
   * The same offboarding by YOUR id (`{externalId}` in the body): what
   * `nz.deactivateClinician(user.id)` calls. A literal resource beside
   * `/v1/physicians/{id}`, like `/v1/patients/state`. Unknown or foreign ids
   * are the uniform `404`.
   */
  'POST /v1/physicians/deactivate': {auth: 'server'; params: SessionsNoParams; query: undefined; request: DeactivatePhysicianByExternalIdRequest; response: DeactivatePhysicianResponse};
}
/** A session route key. */
export type SessionsRoute = keyof SessionsEndpoints;
/** Every session route (runtime list; tests assert completeness). */
export const SESSIONS_ROUTES = [
  'POST /v1/sessions',
  'DELETE /v1/sessions/{sessionId}',
  'POST /v1/sessions/revoke',
  'GET /v1/embed/config',
  'PUT /v1/embed/origins',
  'POST /v1/physicians/{id}/deactivate',
  'POST /v1/physicians/deactivate',
] as const satisfies readonly SessionsRoute[];

/**
 * The customer endpoint's routes as the browser sees them (§3.7, §4.7). The
 * contract a non-SDK server implements: POST + JSON ≤ 4 KB +
 * `X-Natzar-Request: 1` + exact same origin, and every answer carries
 * {@link ENDPOINT_RESPONSE_HEADERS}.
 */
export interface CustomerEndpoints {
  /** Mint or renew; answers the grant exactly as Natzar returned it. */
  'POST /session': {request: EndpointSessionRequest; response: SessionGrant};
  /** In-widget Start through the partner's `onStart` (D1): the grant of a new session scoped to the new consult. */
  'POST /start': {request: EndpointStartRequest; response: SessionGrant};
  /** `302` to {@link loaderUrlFor}, `Cache-Control: max-age=3600`. */
  'GET /embed.js': {request: undefined; response: undefined};
  /** `GET /v1/embed/config`, relayed from the middleware's 5 min cache. */
  'GET /config': {request: undefined; response: EmbedConfig};
  /** Verified webhook delivery (`onEvent`); `500` when the handler throws. */
  'POST /webhook': {request: unknown; response: undefined};
}
