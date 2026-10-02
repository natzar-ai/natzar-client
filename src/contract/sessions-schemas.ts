// GENERATED FILE — do not edit.
//
// Copied verbatim from natzar-core's shared/partner-api by
// scripts/sync-contract.mjs. Edit the source there; this copy exists only so
// the published package is self-contained.
/**
 * zod schemas of the sessions contract (`./sessions`): the customer
 * endpoint's bodies, the Natzar session routes, the grant, the v2
 * `postMessage` envelopes of both audiences and the element event details.
 * Every wire type of the redesign is inferred from a schema here.
 *
 * - Request bodies and envelopes are `.strict()`: an unknown key is
 *   rejected, an own `__proto__` key (as `JSON.parse` produces one)
 *   included. That is deliberate: such a key is never data, and refusing it
 *   closes the prototype-pollution class outright. zod 3 and zod ≥ 4.6 both
 *   reject it in strict objects (the tests pin it in both majors), and
 *   {@link parseEmbedMessage} refuses it at ANY depth of an envelope before
 *   any schema runs, so a lenient nested object (the relayed grant) cannot
 *   carry one either.
 * - Responses that cross a release boundary (the grant, `GET
 *   /v1/embed/config`, the origins answer) DROP unknown keys instead: they are
 *   server data, and an additive server field must not break a loader or SDK
 *   already in the field. The parsed result never contains an unknown key.
 * - Cross-field rules (audience ↔ surface, frame key ↔ native, reason ↔
 *   `sessionId`, consult and view scope) are `superRefine` issues whose
 *   `message` is a fixed code; input values are never echoed.
 *
 * The schemas use the zod subset whose decisions agree between zod 3 and
 * zod 4 (the tests run every table under both). Timestamps are pinned by
 * `isIsoDateTime` (`./schemas`), not zod's release-dependent `datetime()`.
 *
 * @packageDocumentation
 */

import {z} from 'zod';
import {PROVIDER_EMBED_HEX_COLOR_REGEX, PROVIDER_EMBED_REQUEST_ID_REGEX} from './provider-embed';
import {isIsoDateTime, upsertPatientSchema} from './schemas';
import {
  API_KEY_ZONES,
  ASYNC_CLOSED_REASONS,
  CLINICIAN_CAPABILITIES,
  DEPLOYMENT_ENVIRONMENT_REGEX,
  ELEMENT_ERROR_CODES,
  ELEMENT_ERROR_MESSAGES,
  EMBED_LOCALES,
  EMBED_MAX_MESSAGE_BYTES,
  EMBED_NONCE_REGEX,
  EMBED_PROTOCOL,
  EMBED_PROTOCOL_VERSION,
  EMBED_THEMES,
  EMBED_VERSION_STRING_REGEX,
  FRAME_SURFACES,
  LOGIN_REF_REGEX,
  MESSAGE_AUTHORS,
  NZ1_SESSION_ID_REGEX,
  NZ1_TOKEN_REGEX,
  PARTNER_ID_REGEX,
  PATIENT_ELEMENT_ERROR_CODES,
  PATIENT_PROFILE_FIELDS,
  PATIENT_EXPIRED_REASONS,
  PATIENT_FONT_FAMILY_REGEX,
  PATIENT_HEX_COLOR_REGEX,
  PRESENTATION_MAX_RADIUS,
  PROVIDER_DENSITIES,
  PROVIDER_EXPIRED_REASONS,
  PROVIDER_NAVIGATION_MODES,
  PROVIDER_VIEWS,
  SESSION_ASK_REASONS,
  SESSION_AUDIENCES,
  SESSION_CONSULT_KINDS,
  SESSION_IDLE_MAX_SECONDS,
  SESSION_IDLE_MIN_SECONDS,
  SESSION_SURFACES,
  SESSION_UNAVAILABLE_REASONS,
  STEP_UP_REASON,
  START_SURFACES,
  START_TELEHEALTH_MODES,
  isFrameSurface,
  isLocalDevHost,
  isSurfaceOf,
  messageByteLength,
  parseNz1Token,
  type SessionAudience,
} from './sessions';
import {P256_COORDINATE_REGEX, SEALED_CT_REGEX, SEALED_IV_REGEX} from './sessions-crypto';
import {
  EMBED_ORIGIN_MAX_LENGTH,
  EMBED_ORIGINS_OPERATOR_MAX,
  NATIVE_SHELL_ORIGINS,
  isCanonicalParentOrigin,
  validateEmbedOrigins,
  type PublicSuffixPredicate,
} from './sessions-origins';

// ---------------------------------------------------------------- primitives

const sessionIdSchema = z.string().regex(NZ1_SESSION_ID_REGEX);
const partnerIdSchema = z.string().regex(PARTNER_ID_REGEX);
const resourceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
/** A consult id that is empty where the surface has none to name (agent `ready`, agent-opened `payment`). */
const maybeEmptyIdSchema = z.string().regex(/^[A-Za-z0-9_-]{0,64}$/);
const externalIdSchema = z.string().min(1).max(128).regex(/^\S+$/);
// Pinned (not zod's built-in datetime): `Z` or `±HH:MM`, seconds optional, identical in zod 3 and zod 4.
const isoDateTimeSchema = z.string().refine((v) => isIsoDateTime(v), {message: 'not_an_iso_datetime'});
const audienceSchema = z.enum(SESSION_AUDIENCES);
const surfaceSchema = z.enum(SESSION_SURFACES);
const viewSchema = z.enum(PROVIDER_VIEWS);
const consultKindSchema = z.enum(SESSION_CONSULT_KINDS);
const clinicianCapabilitySchema = z.enum(CLINICIAN_CAPABILITIES);
const environmentSchema = z.string().regex(DEPLOYMENT_ENVIRONMENT_REGEX);
const zoneSchema = z.enum(API_KEY_ZONES);
const elementErrorCodeSchema = z.enum(ELEMENT_ERROR_CODES);
const patientElementErrorCodeSchema = z.enum([...ELEMENT_ERROR_CODES, ...PATIENT_ELEMENT_ERROR_CODES]);
const profileFieldSchema = z.enum(PATIENT_PROFILE_FIELDS);
const requestIdSchema = z.string().regex(PROVIDER_EMBED_REQUEST_ID_REGEX);
const versionStringSchema = z.string().regex(EMBED_VERSION_STRING_REGEX);
const uniqueList = (a: readonly string[]) => new Set(a).size === a.length;

/**
 * A deployment URL: https, or plain http on a local development host outside
 * production (RG0 N8); no credentials or fragment.
 */
function isDeploymentUrl(value: string, production: boolean): boolean {
  if (value.length > 2_048) return false;
  try {
    const u = new URL(value);
    const scheme = u.protocol === 'https:' || (!production && u.protocol === 'http:' && isLocalDevHost(u.hostname));
    return scheme && u.username === '' && u.password === '' && u.hash === '';
  } catch {
    return false;
  }
}
const deploymentUrlSchema = (production: boolean) => z.string().min(1).refine((v) => isDeploymentUrl(v, production), {message: 'not_a_deployment_url'});
const deploymentOriginSchema = (production: boolean) =>
  z.string().refine((v) => isCanonicalParentOrigin(v) && /^https?:/.test(v) && isDeploymentUrl(v, production), {message: 'not_an_origin'});
const httpUrlSchema = deploymentUrlSchema(false);

/** A cross-field issue: a path and a fixed code. */
interface Issue {
  path: Array<string | number>;
  message: string;
}

// ------------------------------------------------------------- shared shapes

const p256Shape = {
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: z.string().regex(P256_COORDINATE_REGEX),
  y: z.string().regex(P256_COORDINATE_REGEX),
};
/** The frame's public key: exactly `{kty:'EC', crv:'P-256', x, y}` (strip `ext`/`key_ops` from an export first). */
export const p256PublicJwkSchema = z.object(p256Shape).strict();

/** The credential sealed to the frame key (see `./sessions-crypto`). Relayed server data: unknown keys dropped. */
export const sealedTokenSchema = z.object({
  /** Ephemeral public key of the seal. */
  epk: z.object(p256Shape),
  /** 12-byte AES-GCM IV, base64url. */
  iv: z.string().regex(SEALED_IV_REGEX),
  /** AES-256-GCM ciphertext and tag, base64url. */
  ct: z.string().regex(SEALED_CT_REGEX),
});

const consultRefShape = {
  /** `async` or `telehealth`. */
  kind: consultKindSchema,
  /** Our consult id. */
  id: resourceIdSchema,
};
/** A consult a session is scoped to (`consult="kind:id"`, or the tag's kind and `consult="id"`). */
export const sessionConsultRefSchema = z.object(consultRefShape).strict();

/**
 * The patient a session is for: either `{externalId}` alone (the patient must
 * already exist), or `externalId` + `phone` plus any of the profile (an
 * idempotent upsert, skipped when the profile hash is unchanged; missing
 * fields are completed in the widget, D5).
 */
export const sessionPatientSchema = z.union([
  z.object({externalId: externalIdSchema}).strict(),
  upsertPatientSchema.partial({email: true, givenName: true, familyName: true, birthdate: true, sex: true}),
]);
/** The clinician a session acts as: your `externalId` or our `physicianId`. Must already exist (D6). */
export const sessionClinicianRefSchema = z.union([
  z.object({externalId: externalIdSchema}).strict(),
  z.object({physicianId: resourceIdSchema}).strict(),
]);

/** Scope rules shared by the ask, the mint body and the grant. */
function scopeIssues(v: {audience: SessionAudience; surface: string; consult?: {kind: string}; view?: string; patient?: unknown}, opts: {consultRequired: boolean}): Issue[] {
  const out: Issue[] = [];
  if (v.audience === 'patient') {
    if (v.consult && (v.surface === 'async' || v.surface === 'telehealth') && v.consult.kind !== v.surface) out.push({path: ['consult', 'kind'], message: 'kind_not_of_surface'});
  } else if (v.surface === 'consultation') {
    if (!v.consult && opts.consultRequired) out.push({path: ['consult'], message: 'required_for_consultation'});
  } else if (v.consult) {
    out.push({path: ['consult'], message: 'only_for_consultation'});
  }
  if (v.view !== undefined && !(v.audience === 'clinician' && v.surface === 'workspace')) out.push({path: ['view'], message: 'only_for_clinician_workspace'});
  // Patient mode is its own preset (§4.12): no module view beside it.
  if (v.audience === 'clinician' && v.patient !== undefined && v.view !== undefined && v.view !== 'workspace') out.push({path: ['view'], message: 'not_with_patient_mode'});
  return out;
}

const addIssues = (issues: Issue[], ctx: {addIssue: (issue: {code: 'custom'; path: Array<string | number>; message: string}) => void}) => {
  for (const i of issues) ctx.addIssue({code: 'custom', path: i.path, message: i.message});
};

// ------------------------------------------------ customer endpoint bodies

/**
 * Body of `POST {endpoint}/session` (browser → your middleware; ≤ 4 KB,
 * `X-Natzar-Request: 1`). It carries NO identity: `identify` decides who the
 * user is. `patient` is the `patient` attribute (which of the login's
 * patients; for the provider tag, patient mode). `sessionId` is required
 * (null) and set only for `renew` and `successor`.
 */
export const endpointSessionRequestSchema = z.object({
  /** `patient` or `clinician`. */
  audience: audienceSchema,
  /** The element's surface. */
  surface: surfaceSchema,
  /** The current session for `renew`/`successor`; null otherwise. */
  sessionId: sessionIdSchema.nullable(),
  /** The `consult` attribute, parsed. */
  consult: sessionConsultRefSchema.optional(),
  /** The `patient` attribute: your external patient id. */
  patient: externalIdSchema.optional(),
  /** Why the element asks. */
  reason: z.enum(SESSION_ASK_REASONS),
  /** The frame's public key; required except for `native`, where it is refused. */
  frameKey: p256PublicJwkSchema.optional(),
  /** The provider `view` attribute (clinician `workspace` only). */
  view: viewSchema.optional(),
}).strict().superRefine((ask, ctx) => {
  const out: Issue[] = [];
  if (!isSurfaceOf(ask.audience, ask.surface)) out.push({path: ['surface'], message: 'surface_not_of_audience'});
  const needsSession = ask.reason === 'renew' || ask.reason === 'successor';
  if (needsSession !== (ask.sessionId !== null)) out.push({path: ['sessionId'], message: needsSession ? 'required_for_reason' : 'must_be_null_for_reason'});
  if (ask.surface === 'native' ? ask.frameKey !== undefined : ask.frameKey === undefined) {
    out.push({path: ['frameKey'], message: ask.surface === 'native' ? 'not_for_native' : 'required'});
  }
  if (ask.audience === 'clinician' && ask.patient !== undefined && ask.surface !== 'workspace') out.push({path: ['patient'], message: 'patient_mode_workspace_only'});
  if (ask.reason === 'successor' && ask.surface === 'native') out.push({path: ['reason'], message: 'successor_not_for_native'});
  out.push(...scopeIssues(ask, {consultRequired: true}));
  addIssues(out, ctx);
});

/**
 * Body of `POST {endpoint}/start` (only when the middleware has `onStart`,
 * D1): the middleware runs `identify` and `onStart`, opens the consult with
 * its key and answers the grant of a new session scoped to it.
 */
export const endpointStartRequestSchema = z.object({
  /** Always `patient`. */
  audience: z.literal('patient'),
  /** The tag asking. */
  surface: z.enum(START_SURFACES),
  /** The element's current (unbound) session, or null. */
  sessionId: sessionIdSchema.nullable(),
  /** What to open. */
  kind: consultKindSchema,
  /** Telehealth only: the waiting room (`queue`, the default) or a booking. */
  mode: z.enum(START_TELEHEALTH_MODES).optional(),
  /** The `patient` attribute. */
  patient: externalIdSchema.optional(),
  /** The frame's public key. */
  frameKey: p256PublicJwkSchema,
}).strict().superRefine((s, ctx) => {
  const out: Issue[] = [];
  if ((s.surface === 'async' || s.surface === 'telehealth') && s.kind !== s.surface) out.push({path: ['kind'], message: 'kind_not_of_surface'});
  if (s.mode !== undefined && s.kind !== 'telehealth') out.push({path: ['mode'], message: 'telehealth_only'});
  addIssues(out, ctx);
});

// ------------------------------------------------------ Natzar session routes

/**
 * Body of `POST /v1/sessions` (server-only, your key): mint, renew
 * (`sessionId`: identity, `loginRef` and frame key must equal the record,
 * else `403 renew_mismatch`) or hand a live call over (`successorOf`, §4.11).
 * `parentOrigin` is the VERIFIED `Origin` of the browser request and must be
 * on the policy; it is null only for `native`, which also requires
 * `requestAuth: 'bearer'`. `until` clamps the absolute lifetime to your
 * login's; `capabilities` (clinicians) narrows the policy's set for the
 * surface.
 */
export const createSessionRequestSchema = z.object({
  /** `patient` or `clinician`. */
  audience: audienceSchema,
  /** The surface to mint. */
  surface: surfaceSchema,
  /** Set ⇒ renew this session. */
  sessionId: sessionIdSchema.nullable().optional(),
  /** Set ⇒ mint the successor of this live session (mid-call handover). */
  successorOf: sessionIdSchema.optional(),
  /** The frame's public key; required except for `native`. */
  frameKey: p256PublicJwkSchema.optional(),
  /** Patient audience: who (full or partial profile ⇒ upsert; externalId alone ⇒ must exist). Clinician workspace: patient mode, `{externalId}` only. */
  patient: sessionPatientSchema.optional(),
  /**
   * The element's `patient` attribute (`ask.patient`: which of the login's
   * patients, or the clinician's patient mode), when it set one. Must equal
   * `patient.externalId`; the grant echoes it as `scope.patient`, which the
   * loader and SDK require to equal their attribute (multi-patient, M11).
   */
  askPatient: externalIdSchema.optional(),
  /** Clinician audience: who. */
  clinician: sessionClinicianRefSchema.optional(),
  /** Verified delegation only: the clinician's current Natzar ID token. */
  clinicianToken: z.string().min(20).max(8_192).regex(/^[A-Za-z0-9_.-]+$/).optional(),
  /** Narrows the session to one consult. */
  consult: sessionConsultRefSchema.optional(),
  /** Clinician workspace: the provider module (default `workspace`). */
  view: viewSchema.optional(),
  /** Patient: your middleware has `onStart` (drives the Start button). */
  partnerStart: z.boolean().optional(),
  /** Exact origin of the embedding page; null only for `native`. */
  parentOrigin: z.string().max(EMBED_ORIGIN_MAX_LENGTH).nullable(),
  /** `sha256_hex('natzar-login:' + login)`; renew and `revokeLogin` compare it. */
  loginRef: z.string().regex(LOGIN_REF_REGEX).optional(),
  /** When your login ends; the absolute lifetime is clamped to it. */
  until: isoDateTimeSchema.optional(),
  /** Clinician: requested capabilities (default: the policy's set for the surface). */
  capabilities: z.array(clinicianCapabilitySchema).min(1).max(CLINICIAN_CAPABILITIES.length).refine(uniqueList, {message: 'duplicate'}).optional(),
  /** How your endpoint authenticated the browser: ambient cookie (default) or a bearer token. */
  requestAuth: z.enum(['ambient', 'bearer']).optional(),
}).strict().superRefine((b, ctx) => {
  const out: Issue[] = [];
  if (!isSurfaceOf(b.audience, b.surface)) out.push({path: ['surface'], message: 'surface_not_of_audience'});
  if (b.surface === 'native') {
    if (b.frameKey !== undefined) out.push({path: ['frameKey'], message: 'not_for_native'});
    if (b.parentOrigin !== null) out.push({path: ['parentOrigin'], message: 'must_be_null_for_native'});
    if (b.requestAuth !== 'bearer') out.push({path: ['requestAuth'], message: 'bearer_required_for_native'});
    if (b.successorOf !== undefined) out.push({path: ['successorOf'], message: 'successor_not_for_native'});
  } else {
    if (b.frameKey === undefined) out.push({path: ['frameKey'], message: 'required'});
    if (b.parentOrigin === null || !isCanonicalParentOrigin(b.parentOrigin)) out.push({path: ['parentOrigin'], message: 'not_an_origin'});
  }
  if (b.sessionId !== undefined && b.sessionId !== null && b.successorOf !== undefined) out.push({path: ['successorOf'], message: 'exclusive_with_sessionId'});
  if (b.askPatient !== undefined && b.patient?.externalId !== b.askPatient) out.push({path: ['askPatient'], message: 'must_equal_patient_external_id'});
  if (b.audience === 'patient') {
    if (b.patient === undefined) out.push({path: ['patient'], message: 'required'});
    for (const k of ['clinician', 'clinicianToken', 'capabilities'] as const) if (b[k] !== undefined) out.push({path: [k], message: 'clinician_only'});
  } else {
    if (b.clinician === undefined) out.push({path: ['clinician'], message: 'required'});
    if (b.partnerStart !== undefined) out.push({path: ['partnerStart'], message: 'patient_only'});
    if (b.patient !== undefined) {
      if (b.surface !== 'workspace') out.push({path: ['patient'], message: 'patient_mode_workspace_only'});
      if (Object.keys(b.patient).length !== 1) out.push({path: ['patient'], message: 'external_id_only'});
    }
  }
  out.push(...scopeIssues(b, {consultRequired: true}));
  addIssues(out, ctx);
});

/** Body of `POST /v1/sessions/revoke`: every session of one login, one patient or one clinician. */
export const revokeSessionsRequestSchema = z.union([
  z.object({loginRef: z.string().regex(LOGIN_REF_REGEX)}).strict(),
  z.object({patient: z.object({externalId: externalIdSchema}).strict()}).strict(),
  z.object({clinician: sessionClinicianRefSchema}).strict(),
]);
/** Answer of `POST /v1/sessions/revoke`. */
export const revokeSessionsResponseSchema = z.object({
  /** How many sessions were revoked. */
  revoked: z.number().int().min(0),
});
/** `DELETE /v1/sessions/{sessionId}` path parameter (a non-id such as `revoke` is a 404). */
export const sessionIdParamSchema = sessionIdSchema;

/**
 * Answer of `GET /v1/embed/config` (and of the middleware's
 * `GET {endpoint}/config`) for a deployment: https URLs, plain http only on a
 * local host outside production. No secrets. A client with a live key uses
 * `{production: true}`.
 */
export function embedConfigSchemaFor(opts: {production: boolean}) {
  return z.object({
    /** Your partner id (frame paths, `?p=`). */
    partnerId: partnerIdSchema,
    /** The deployment environment. */
    environment: environmentSchema,
    /** The residency zone. */
    zone: zoneSchema,
    /** `https://<zone>.embed.natzar.ai/v2/natzar.js?p=<partnerId>` (or the environment's variant). */
    loaderUrl: deploymentUrlSchema(opts.production),
    /** The two frame origins of this deployment. */
    frameOrigins: z.object({patient: deploymentOriginSchema(opts.production), clinician: deploymentOriginSchema(opts.production)}),
    /** The deployment's REST base (including `/v1`): the ONLY API URL a client sends credentials to, never a grant's. */
    apiUrl: deploymentUrlSchema(opts.production),
    /** The AppSync endpoint the patient frame and SDK use. */
    graphqlUrl: deploymentUrlSchema(opts.production),
  });
}
/** {@link embedConfigSchemaFor} outside production (local http accepted). */
export const embedConfigSchema = embedConfigSchemaFor({production: false});

/**
 * Body of `PUT /v1/embed/origins` for a deployment (`production`), a
 * partner cap (`maxEntries`, default 100, operator ceiling 500) and the
 * authoritative public-suffix list (`publicSuffixList`; without it every
 * wildcard is refused, see `./sessions-origins`). Replaces the whole list.
 * Issue messages are {@link validateEmbedOrigins} reason codes.
 */
export function putEmbedOriginsSchema(opts: {production: boolean; maxEntries?: number; publicSuffixList?: PublicSuffixPredicate}) {
  return z.object({
    /** Exact origins, patient wildcards and (outside production) local origins. */
    origins: z.array(z.string().max(EMBED_ORIGIN_MAX_LENGTH)).max(EMBED_ORIGINS_OPERATOR_MAX),
    /** Native-shell origins; sessions for them need a bearer-authenticated request. */
    nativeOrigins: z.array(z.string().max(EMBED_ORIGIN_MAX_LENGTH)).max(NATIVE_SHELL_ORIGINS.length).optional(),
  }).strict().superRefine((body, ctx) => {
    addIssues(validateEmbedOrigins(body, opts).map((i) => ({path: i.path, message: i.reason})), ctx);
  });
}
/** Answer of `PUT /v1/embed/origins`: the stored list. */
export const putEmbedOriginsResponseSchema = z.object({
  /** The stored `origins`. */
  origins: z.array(z.string()),
  /** The stored `nativeOrigins`. */
  nativeOrigins: z.array(z.string()),
});

/** Body of `POST /v1/physicians/{id}/deactivate`: empty. */
export const deactivatePhysicianRequestSchema = z.object({}).strict();
/** Body of `POST /v1/physicians/deactivate`: the clinician by YOUR id. */
export const deactivatePhysicianByExternalIdRequestSchema = z.object({
  /** Your external id of the clinician (`physicians.create`). */
  externalId: externalIdSchema,
}).strict();
/** Answer of both deactivate routes. */
export const deactivatePhysicianResponseSchema = z.object({
  /** Always true: the clinician is no longer routable and their availability is cleared. */
  deactivated: z.literal(true),
  /** How many of their sessions were revoked. */
  revoked: z.number().int().min(0),
});

// ------------------------------------------- patient operations (M2, §4.6)

/**
 * Detail keys each in-band refusal code carries (required / optional); every
 * other code carries none. Details sit flat beside `error`.
 */
const REFUSAL_DETAILS: Readonly<Record<string, {required: readonly string[]; optional: readonly string[]}>> = {
  agent_limit_reached: {required: ['retryAfterSeconds'], optional: []},
  rate_limited: {required: [], optional: ['retryAfterSeconds']},
  profile_incomplete: {required: ['missing'], optional: []},
  invalid_profile: {required: [], optional: ['field']},
  session_renewal_required: {required: ['needSeconds', 'joinAnywayAllowed'], optional: []},
  session_expired: {required: [], optional: ['reason']},
};
const REFUSAL_DETAIL_KEYS = ['retryAfterSeconds', 'needSeconds', 'joinAnywayAllowed', 'reason', 'missing', 'field'] as const;

/**
 * An in-band refusal of a patient session operation (the guard's codes,
 * `session_*`, `origin_not_allowed`, `embedding_disabled`, …; the codes of
 * `embedStart`, `embedCompleteProfile`, `embedLogout` and the joins):
 * `{ok: false, error, ...details}` with the details `REFUSAL_DETAILS` allows
 * for the code — `retryAfterSeconds` (`rate_limited`, `agent_limit_reached`),
 * `{missing}` (`profile_incomplete`), `{field?}` (`invalid_profile`),
 * `{needSeconds, joinAnywayAllowed}` (`session_renewal_required`) and
 * `{reason: 'step_up'}` (`session_expired`, a step-up). Older operations keep
 * their own documented answers.
 */
export const embedOperationRefusalSchema = z.object({
  ok: z.literal(false),
  error: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  retryAfterSeconds: z.number().int().min(1).optional(),
  needSeconds: z.number().int().min(0).optional(),
  joinAnywayAllowed: z.boolean().optional(),
  reason: z.literal(STEP_UP_REASON).optional(),
  missing: z.array(profileFieldSchema).min(1).max(PATIENT_PROFILE_FIELDS.length).refine(uniqueList, {message: 'duplicate'}).optional(),
  field: profileFieldSchema.optional(),
}).strict().superRefine((r, ctx) => {
  const rule = REFUSAL_DETAILS[r.error] ?? {required: [], optional: []};
  const present = REFUSAL_DETAIL_KEYS.filter((k) => r[k] !== undefined);
  addIssues([
    ...rule.required.filter((k) => !(present as readonly string[]).includes(k)).map((k) => ({path: [k], message: 'required_for_code'})),
    ...present.filter((k) => !rule.required.includes(k) && !rule.optional.includes(k)).map((k) => ({path: [k], message: 'not_for_code'})),
  ], ctx);
});

/** Arguments of `embedStart` (Natzar-billed in-widget Start, D1). */
export const embedStartArgsSchema = z.object({
  /** What to open: the tag's kind, or either from the agent hub. */
  kind: consultKindSchema,
  /** Telehealth only: the waiting room (`queue`, the default) or a booking. */
  mode: z.enum(START_TELEHEALTH_MODES).optional(),
}).strict().refine((a) => a.mode === undefined || a.kind === 'telehealth', {message: 'telehealth_only', path: ['mode']});
/**
 * Answer of `embedStart`: the consult opened (`created: true`) or the open
 * one of the kind (`created: false`, idempotent through the one-open
 * markers); or a refusal (`start_not_allowed`, `profile_incomplete
 * {missing}`, `rate_limited {retryAfterSeconds}`, `not_found`,
 * `dependency_unavailable`, a clinical-protocol `protocol_*` code, or a guard
 * code).
 */
export const embedStartResultSchema = z.union([
  z.object({ok: z.literal(true), consult: sessionConsultRefSchema, created: z.boolean()}).strict(),
  embedOperationRefusalSchema,
]);

/** One printable line: no control characters (checked by code point, not a control-character regex). */
const noControlCharacters = (v: string) => ![...v].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);
const NAME_FIELD = z.string().min(1).max(100).regex(/^[^<>{}\\]+$/u).refine(noControlCharacters, {message: 'control_character'});
/**
 * The D5 form: the profile fields the patient fills in (each optional, at
 * least one). The server validates and normalizes every value
 * (`invalid_profile {field}`) and writes only fields still missing.
 */
export const patientProfileCompletionSchema = z.object({
  givenName: NAME_FIELD.optional(),
  familyName: NAME_FIELD.optional(),
  email: z.string().min(3).max(254).optional(),
  birthdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sex: z.enum(['male', 'female']).optional(),
  state: z.string().min(1).max(64).optional(),
  country: z.string().min(1).max(64).optional(),
}).strict().refine((p) => Object.keys(p).length > 0, {message: 'empty'});
/** Arguments of `embedCompleteProfile` (`profile` is JSON-stringified on the wire, the AWSJSON convention). */
export const embedCompleteProfileArgsSchema = z.object({profile: patientProfileCompletionSchema}).strict();
/** Answer of `embedCompleteProfile`: what was written and what is still missing; or a refusal (`invalid_profile {field?}`, `rate_limited`, …). */
export const embedCompleteProfileResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    written: z.array(profileFieldSchema).max(PATIENT_PROFILE_FIELDS.length).refine(uniqueList, {message: 'duplicate'}),
    profile: z.object({missing: z.array(profileFieldSchema).max(PATIENT_PROFILE_FIELDS.length).refine(uniqueList, {message: 'duplicate'})}).strict(),
  }).strict(),
  embedOperationRefusalSchema,
]);
/** Answer of `embedLogout`: the session is revoked (also when it already was). */
export const embedLogoutResultSchema = z.union([
  z.object({ok: z.literal(true), revoked: z.boolean()}).strict(),
  embedOperationRefusalSchema,
]);
/** Arguments of the `onEmbedConsultEvent` subscription: a consult in the session's reach. */
export const embedConsultEventArgsSchema = z.object({consultId: resourceIdSchema}).strict();
/** One `onEmbedConsultEvent` event: status only (unknown selection fields such as `__typename` are dropped). */
export const embedConsultEventSchema = z.object({
  consultId: resourceIdSchema,
  status: z.string().min(1).max(64),
});

// ------------------------------------------------------- joins (§4.11, D12)

/**
 * Spread into the body schema of every join route (`SESSION_JOIN_ROUTES`) and
 * the join operation's arguments: `acceptShortSession: true` is the user's
 * "Join anyway". Honoured only per `preJoinDecision`.
 */
export const acceptShortSessionShape = {
  /** "Join anyway" (D12); only `true` or absent. */
  acceptShortSession: z.literal(true).optional(),
};
/** `details` of `409 session_renewal_required` on a join. */
export const sessionRenewalRequiredDetailsSchema = z.object({
  /** Seconds of session lifetime the join needs (the pre-join threshold). */
  needSeconds: z.number().int().min(0),
  /** The customer's login is the limit: offer "Join anyway" and retry with `acceptShortSession: true`. */
  joinAnywayAllowed: z.boolean(),
}).strict();

// ------------------------------------------------------------------- grant

/**
 * The grant v2 (§4.5): answer of `POST /v1/sessions`, relayed unchanged by
 * the middleware. Everything but `sealedToken` is metadata the loader checks
 * (`checkGrantAtLoader`); the frame checks again and unseals. `sessionToken`
 * (the plain credential) exists only for `native`, which has no frame. Unknown
 * keys are dropped.
 */
export const sessionGrantSchema = z.object({
  /** Always 2. */
  protocolVersion: z.literal(EMBED_PROTOCOL_VERSION),
  /** The session's audience. */
  audience: audienceSchema,
  /** The session's surface. */
  surface: surfaceSchema,
  /** Public id of the logical session (not a credential). */
  sessionId: sessionIdSchema,
  /** The partner the session belongs to; the frame requires its own. */
  partnerId: partnerIdSchema,
  /** The `nz1` credential sealed to the frame key (every surface but `native`). */
  sealedToken: sealedTokenSchema.optional(),
  /** `native` only: the plain `nz1` credential. */
  sessionToken: z.string().regex(NZ1_TOKEN_REGEX).optional(),
  /** When this access credential expires. */
  expiresAt: isoDateTimeSchema,
  /** When the broker starts renewing. */
  renewAfter: isoDateTimeSchema,
  /** When the logical session ends; renewal never extends it. */
  absoluteExpiresAt: isoDateTimeSchema,
  /** The inactivity lock in seconds, or null for none. */
  idleTimeoutSeconds: z.number().int().min(SESSION_IDLE_MIN_SECONDS).max(SESSION_IDLE_MAX_SECONDS).nullable(),
  /** Exact frame URL (`<frame origin>/<audience path>/<partnerId>`); null for `headless` and `native`, which have no frame. */
  frameUrl: httpUrlSchema.nullable(),
  /** Natzar REST base of this deployment. */
  apiUrl: httpUrlSchema,
  /** AppSync endpoint of this deployment. */
  graphqlUrl: httpUrlSchema,
  /** The exact origin the session is bound to; null only for `native`. */
  parentOrigin: z.string().max(EMBED_ORIGIN_MAX_LENGTH).nullable(),
  /** Deployment environment. */
  environment: environmentSchema,
  /** Residency zone. */
  zone: zoneSchema,
  /** The session's immutable scope. */
  scope: z.object({
    /** The one consult the session is bound to, when it is. */
    consult: z.object(consultRefShape).optional(),
    /** Clinician workspace: the provider module (always present there). */
    view: viewSchema.optional(),
    /** The `patient` the ask named (which of the login's patients; clinician patient mode), echoed. */
    patient: externalIdSchema.optional(),
  }),
  /** Clinician: the capabilities granted. Patient: empty. */
  capabilities: z.array(clinicianCapabilitySchema).max(CLINICIAN_CAPABILITIES.length).refine(uniqueList, {message: 'duplicate'}),
  /** Clinician: requested capabilities not granted, with why. Patient: empty. */
  unavailable: z.array(z.object({capability: clinicianCapabilitySchema, reason: z.enum(SESSION_UNAVAILABLE_REASONS)}))
    .max(CLINICIAN_CAPABILITIES.length).refine((a) => uniqueList(a.map((u) => u.capability)), {message: 'duplicate'}),
}).superRefine((g, ctx) => {
  const out: Issue[] = [];
  if (!isSurfaceOf(g.audience, g.surface)) out.push({path: ['surface'], message: 'surface_not_of_audience'});
  if (g.surface === 'native') {
    if (g.sessionToken === undefined || parseNz1Token(g.sessionToken)?.sessionId !== g.sessionId) out.push({path: ['sessionToken'], message: 'required_for_native'});
    if (g.sealedToken !== undefined) out.push({path: ['sealedToken'], message: 'not_for_native'});
    if (g.parentOrigin !== null) out.push({path: ['parentOrigin'], message: 'must_be_null_for_native'});
  } else {
    if (g.sealedToken === undefined) out.push({path: ['sealedToken'], message: 'required'});
    if (g.sessionToken !== undefined) out.push({path: ['sessionToken'], message: 'native_only'});
    if (g.parentOrigin === null || !isCanonicalParentOrigin(g.parentOrigin)) out.push({path: ['parentOrigin'], message: 'not_an_origin'});
  }
  if (g.audience === 'patient') {
    if (g.capabilities.length > 0 || g.unavailable.length > 0) out.push({path: ['capabilities'], message: 'clinician_only'});
    if (g.idleTimeoutSeconds !== null) out.push({path: ['idleTimeoutSeconds'], message: 'patient_sessions_never_idle_lock'});
  }
  if ((g.audience === 'clinician' && g.surface === 'workspace') !== (g.scope.view !== undefined)) {
    out.push({path: ['scope', 'view'], message: 'required_exactly_for_clinician_workspace'});
  }
  if (isFrameSurface(g.audience, g.surface) === (g.frameUrl === null)) out.push({path: ['frameUrl'], message: 'required_exactly_for_frame_surfaces'});
  if (g.audience === 'clinician' && g.scope.patient !== undefined && g.surface !== 'workspace') out.push({path: ['scope', 'patient'], message: 'patient_mode_workspace_only'});
  out.push(...scopeIssues({audience: g.audience, surface: g.surface, consult: g.scope.consult, view: g.scope.view, patient: g.scope.patient}, {consultRequired: true})
    .filter((i) => i.path[0] !== 'view' || i.message === 'not_with_patient_mode')
    .map((i) => ({...i, path: ['scope', ...i.path]})));
  const [renew, expires, absolute] = [Date.parse(g.renewAfter), Date.parse(g.expiresAt), Date.parse(g.absoluteExpiresAt)];
  if (!(renew <= expires && expires <= absolute)) out.push({path: ['expiresAt'], message: 'times_out_of_order'});
  addIssues(out, ctx);
});

// ------------------------------------------------------------- presentation

const radiusSchema = z.number().int().min(0).max(PRESENTATION_MAX_RADIUS);
/** Patient presentation, applied in place (F66): the validated attributes, camelCased. */
export const patientPresentationSchema = z.object({
  theme: z.enum(EMBED_THEMES).optional(),
  locale: z.enum(EMBED_LOCALES).optional(),
  accent: z.string().regex(PATIENT_HEX_COLOR_REGEX).optional(),
  accentForeground: z.string().regex(PATIENT_HEX_COLOR_REGEX).optional(),
  background: z.string().regex(PATIENT_HEX_COLOR_REGEX).optional(),
  surface: z.string().regex(PATIENT_HEX_COLOR_REGEX).optional(),
  radius: radiusSchema.optional(),
  fontFamily: z.string().regex(PATIENT_FONT_FAMILY_REGEX).optional(),
}).strict();
/**
 * Provider presentation, applied in place. `navigation` (§4.12) is the
 * element's `navigation` attribute: how a module opens items (`module`, the
 * default, inside itself; `host`, by emitting `open {kind, consultId}`); like
 * the other fields it changes in place, without a new session.
 */
export const clinicianPresentationSchema = z.object({
  theme: z.enum(EMBED_THEMES).optional(),
  locale: z.enum(EMBED_LOCALES).optional(),
  accent: z.string().regex(PROVIDER_EMBED_HEX_COLOR_REGEX).optional(),
  radius: radiusSchema.optional(),
  density: z.enum(PROVIDER_DENSITIES).optional(),
  navigation: z.enum(PROVIDER_NAVIGATION_MODES).optional(),
}).strict();

// ----------------------------------------------------------- event details

const consultIdOnly = z.object({consultId: resourceIdSchema}).strict();
/** `detail` schema of every patient event (DOM `natzar:<name>`): ids, states and counts only (D2, T12). */
export const patientEventDetailSchemas = {
  ready: z.object({type: z.enum(['telehealth', 'async', 'agent']), consultId: maybeEmptyIdSchema}).strict(),
  consented: consultIdOnly,
  queued: consultIdOnly,
  /** RG0 F8: no physician name (T12); the consult resource still carries it over REST. */
  assigned: consultIdOnly,
  /** D2: no text. */
  message: z.object({consultId: maybeEmptyIdSchema, messageId: resourceIdSchema, author: z.enum(MESSAGE_AUTHORS), sentAt: isoDateTimeSchema}).strict(),
  joined: consultIdOnly,
  ended: consultIdOnly,
  rated: z.object({consultId: resourceIdSchema, stars: z.number().int().min(1).max(5).optional()}).strict(),
  closed: z.object({consultId: resourceIdSchema, closedReason: z.enum(ASYNC_CLOSED_REASONS).optional()}).strict(),
  /** Only when renewal is impossible. */
  expired: z.object({consultId: resourceIdSchema.optional(), reason: z.enum(PATIENT_EXPIRED_REASONS)}).strict(),
  /** `message` is exactly the fixed text of `code` (`ELEMENT_ERROR_MESSAGES`): no free text reaches the page. */
  error: z.object({code: patientElementErrorCodeSchema, message: z.string().min(1).max(300), recoverable: z.boolean()}).strict()
    .refine((e) => e.message === ELEMENT_ERROR_MESSAGES[e.code], {message: 'not_the_fixed_message', path: ['message']}),
  payment: z.object({consultId: maybeEmptyIdSchema, phase: z.enum(['started', 'ended'])}).strict(),
};

/** A navigation target inside the session's grant (the provider embed's shape). */
const navigationTargetSchema = z.union([
  z.object({view: z.literal('workspace')}).strict(),
  z.object({view: z.literal('consultation'), kind: consultKindSchema, consultationId: resourceIdSchema}).strict(),
  z.object({view: z.literal('patient'), patientId: resourceIdSchema}).strict(),
]);
/** `detail` schema of every provider event (DOM `natzar:provider:<name>`). */
export const providerEventDetailSchemas = {
  ready: z.object({sessionId: sessionIdSchema, surface: z.enum(FRAME_SURFACES.clinician), view: viewSchema.optional(), protocolVersion: z.literal(EMBED_PROTOCOL_VERSION)}).strict(),
  error: z.object({code: elementErrorCodeSchema, recoverable: z.boolean(), correlationId: z.string().regex(/^[A-Za-z0-9_-]{12}$/).optional()}).strict(),
  expired: z.object({reason: z.enum(PROVIDER_EXPIRED_REASONS)}).strict(),
  'unread-change': z.object({count: z.number().int().min(0)}).strict(),
  'navigation-request': z.object({target: navigationTargetSchema}).strict(),
  'consultation-completed': z.object({kind: consultKindSchema, consultationId: resourceIdSchema, outcome: z.enum(['resolved', 'closed', 'ended', 'cancelled'])}).strict(),
  'call-state-change': z.object({consultationId: resourceIdSchema, state: z.enum(['idle', 'connecting', 'in_call', 'reconnecting', 'ended'])}).strict(),
  'dirty-state-change': z.object({dirty: z.boolean()}).strict(),
  disconnected: z.object({reason: z.enum(['host', 'logout', 'revoked', 'protocol_error', 'failed'])}).strict(),
  /** Cancelable; raised by the loader before a `consult`/`view`/`patient` change rescopes. Attribute values only. */
  'switch-request': z.object({
    attribute: z.enum(['consult', 'view', 'patient']),
    from: z.string().max(200).nullable(),
    to: z.string().max(200).nullable(),
    dirty: z.boolean(),
    inCall: z.boolean(),
  }).strict(),
  /** `navigation="host"`: route the click yourself. Ids only. */
  open: z.object({kind: consultKindSchema, consultId: resourceIdSchema}).strict(),
};

// --------------------------------------------------------- envelopes (§4.3)

const base = {
  protocol: z.literal(EMBED_PROTOCOL),
  version: z.literal(EMBED_PROTOCOL_VERSION),
  /** The channel nonce of the bound `hello`. */
  nonce: z.string().regex(EMBED_NONCE_REGEX),
};
const empty = z.object({}).strict();
const command = {kind: z.literal('command'), requestId: requestIdSchema};
const grantPayload = z.object({grant: sessionGrantSchema}).strict();

/** Loader → patient frame. `hello` first (nothing secret), then commands; the frame posts nothing before binding. */
export const patientLoaderMessageSchema = z.union([
  z.object({...base, kind: z.literal('hello'), audience: z.literal('patient'), surface: z.enum(FRAME_SURFACES.patient), loaderVersion: versionStringSchema}).strict(),
  z.object({...base, ...command, command: z.literal('presentation'), payload: patientPresentationSchema}).strict(),
  z.object({...base, ...command, command: z.literal('session'), payload: grantPayload}).strict(),
  z.object({...base, ...command, command: z.literal('renewed'), payload: grantPayload}).strict(),
  z.object({...base, ...command, command: z.literal('session-error'), payload: z.object({code: elementErrorCodeSchema}).strict()}).strict(),
  z.object({...base, ...command, command: z.literal('logout'), payload: empty}).strict(),
  z.object({...base, ...command, command: z.literal('teardown'), payload: empty}).strict(),
]);
/** Loader → clinician frame: the patient set plus `navigate` and `can-leave`. */
export const clinicianLoaderMessageSchema = z.union([
  z.object({...base, kind: z.literal('hello'), audience: z.literal('clinician'), surface: z.enum(FRAME_SURFACES.clinician), loaderVersion: versionStringSchema}).strict(),
  z.object({...base, ...command, command: z.literal('presentation'), payload: clinicianPresentationSchema}).strict(),
  z.object({...base, ...command, command: z.literal('session'), payload: grantPayload}).strict(),
  z.object({...base, ...command, command: z.literal('renewed'), payload: grantPayload}).strict(),
  z.object({...base, ...command, command: z.literal('session-error'), payload: z.object({code: elementErrorCodeSchema}).strict()}).strict(),
  z.object({...base, ...command, command: z.literal('navigate'), payload: z.object({target: navigationTargetSchema}).strict()}).strict(),
  z.object({...base, ...command, command: z.literal('can-leave'), payload: empty}).strict(),
  z.object({...base, ...command, command: z.literal('logout'), payload: empty}).strict(),
  z.object({...base, ...command, command: z.literal('teardown'), payload: empty}).strict(),
]);

const helloAck = z.object({...base, kind: z.literal('hello-ack'), frameKey: p256PublicJwkSchema, frameVersion: versionStringSchema}).strict();
const replyError = z.object({...base, kind: z.literal('reply'), requestId: requestIdSchema, ok: z.literal(false), error: elementErrorCodeSchema}).strict();
const logoutResult = z.object({revoked: z.boolean()}).strict();
const acceptedResult = z.object({accepted: z.literal(true)}).strict();
/** Frame → loader `need-session`: renew, reconnect, the §4.11 pre-join `fresh` session, or a mid-call `successor`. */
const needSession = z.object({
  ...base,
  kind: z.literal('request'),
  request: z.literal('need-session'),
  requestId: requestIdSchema,
  payload: z.object({reason: z.enum(['renew', 'reconnect', 'fresh', 'successor']), sessionId: sessionIdSchema.nullable()}).strict()
    // renew, successor and fresh act on the frame's current session; reconnect may have none.
    .refine((p) => p.reason === 'reconnect' || p.sessionId !== null, {message: 'required_for_reason', path: ['sessionId']}),
}).strict();
const event = {kind: z.literal('event')};
const pe = patientEventDetailSchemas;
const ve = providerEventDetailSchemas;

/** Patient frame → loader: `hello-ack` (the frame key), replies, `need-session`, `start`, and the 12 events. */
export const patientFrameMessageSchema = z.union([
  helloAck,
  z.object({...base, kind: z.literal('reply'), requestId: requestIdSchema, ok: z.literal(true), result: z.union([acceptedResult, logoutResult])}).strict(),
  replyError,
  needSession,
  z.object({
    ...base, kind: z.literal('request'), request: z.literal('start'), requestId: requestIdSchema,
    payload: z.object({kind: consultKindSchema, mode: z.enum(START_TELEHEALTH_MODES).optional()}).strict(),
  }).strict(),
  z.object({...base, ...event, event: z.literal('ready'), detail: pe.ready}).strict(),
  z.object({...base, ...event, event: z.literal('consented'), detail: pe.consented}).strict(),
  z.object({...base, ...event, event: z.literal('queued'), detail: pe.queued}).strict(),
  z.object({...base, ...event, event: z.literal('assigned'), detail: pe.assigned}).strict(),
  z.object({...base, ...event, event: z.literal('message'), detail: pe.message}).strict(),
  z.object({...base, ...event, event: z.literal('joined'), detail: pe.joined}).strict(),
  z.object({...base, ...event, event: z.literal('ended'), detail: pe.ended}).strict(),
  z.object({...base, ...event, event: z.literal('rated'), detail: pe.rated}).strict(),
  z.object({...base, ...event, event: z.literal('closed'), detail: pe.closed}).strict(),
  z.object({...base, ...event, event: z.literal('expired'), detail: pe.expired}).strict(),
  z.object({...base, ...event, event: z.literal('error'), detail: pe.error}).strict(),
  z.object({...base, ...event, event: z.literal('payment'), detail: pe.payment}).strict(),
]);
/** Clinician frame → loader: `hello-ack`, replies, `need-session`, and the events the frame may post. */
export const clinicianFrameMessageSchema = z.union([
  helloAck,
  z.object({
    ...base, kind: z.literal('reply'), requestId: requestIdSchema, ok: z.literal(true),
    result: z.union([
      acceptedResult,
      logoutResult,
      z.object({canLeave: z.boolean(), dirty: z.boolean(), inCall: z.boolean()}).strict(),
      z.object({ok: z.literal(true)}).strict(),
      z.object({ok: z.literal(false), reason: z.enum(['out_of_scope', 'dirty', 'not_connected', 'invalid_target'])}).strict(),
    ]),
  }).strict(),
  replyError,
  needSession,
  z.object({...base, ...event, event: z.literal('error'), detail: ve.error}).strict(),
  z.object({...base, ...event, event: z.literal('expired'), detail: ve.expired}).strict(),
  z.object({...base, ...event, event: z.literal('unread-change'), detail: ve['unread-change']}).strict(),
  z.object({...base, ...event, event: z.literal('navigation-request'), detail: ve['navigation-request']}).strict(),
  z.object({...base, ...event, event: z.literal('consultation-completed'), detail: ve['consultation-completed']}).strict(),
  z.object({...base, ...event, event: z.literal('call-state-change'), detail: ve['call-state-change']}).strict(),
  z.object({...base, ...event, event: z.literal('dirty-state-change'), detail: ve['dirty-state-change']}).strict(),
  z.object({...base, ...event, event: z.literal('open'), detail: ve.open}).strict(),
]);

/** Outcome of {@link parseEmbedMessage}. */
export type EmbedMessageParse<T> = {ok: true; message: T} | {ok: false; reason: 'too_large' | 'invalid'};

/** Whether `value` holds an own `__proto__` key at any depth. */
function hasOwnProtoKey(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(value, '__proto__')) return true;
  return Object.values(value).some(hasOwnProtoKey);
}

/**
 * Size gate, `__proto__` gate, then strict schema: how either side validates
 * what it received. Anything over `EMBED_MAX_MESSAGE_BYTES` (or not
 * serializable) is dropped before the schema runs, and so is anything with an
 * own `__proto__` key at any depth.
 */
export function parseEmbedMessage<T>(schema: {safeParse: (v: unknown) => {success: boolean; data?: unknown}}, raw: unknown): EmbedMessageParse<T> {
  const size = messageByteLength(raw);
  if (size === null || size > EMBED_MAX_MESSAGE_BYTES) return {ok: false, reason: 'too_large'};
  if (hasOwnProtoKey(raw)) return {ok: false, reason: 'invalid'};
  const r = schema.safeParse(raw);
  return r.success ? {ok: true, message: r.data as T} : {ok: false, reason: 'invalid'};
}

// ------------------------------------------------------------------- types

/** A P-256 public JWK. */
export type P256PublicJwk = z.infer<typeof p256PublicJwkSchema>;
/** A sealed credential. */
export type SealedToken = z.infer<typeof sealedTokenSchema>;
/** A consult reference. */
export type SessionConsultRef = z.infer<typeof sessionConsultRefSchema>;
/** The patient of a mint. */
export type SessionPatient = z.infer<typeof sessionPatientSchema>;
/** The clinician of a mint. */
export type SessionClinicianRef = z.infer<typeof sessionClinicianRefSchema>;
/** Body of `POST {endpoint}/session`. */
export type EndpointSessionRequest = z.infer<typeof endpointSessionRequestSchema>;
/** Body of `POST {endpoint}/start`. */
export type EndpointStartRequest = z.infer<typeof endpointStartRequestSchema>;
/** Body of `POST /v1/sessions`. */
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;
/** Body of `POST /v1/sessions/revoke`. */
export type RevokeSessionsRequest = z.infer<typeof revokeSessionsRequestSchema>;
/** Answer of `POST /v1/sessions/revoke`. */
export type RevokeSessionsResponse = z.infer<typeof revokeSessionsResponseSchema>;
/** Answer of `GET /v1/embed/config`. */
export type EmbedConfig = z.infer<typeof embedConfigSchema>;
/** Body of `PUT /v1/embed/origins`. */
export type PutEmbedOriginsRequest = z.infer<ReturnType<typeof putEmbedOriginsSchema>>;
/** Answer of `PUT /v1/embed/origins`. */
export type PutEmbedOriginsResponse = z.infer<typeof putEmbedOriginsResponseSchema>;
/** Body of `POST /v1/physicians/{id}/deactivate`. */
export type DeactivatePhysicianRequest = z.infer<typeof deactivatePhysicianRequestSchema>;
/** Body of `POST /v1/physicians/deactivate`. */
export type DeactivatePhysicianByExternalIdRequest = z.infer<typeof deactivatePhysicianByExternalIdRequestSchema>;
/** An in-band refusal of a patient session operation. */
export type EmbedOperationRefusal = z.infer<typeof embedOperationRefusalSchema>;
/** Arguments of `embedStart`. */
export type EmbedStartArgs = z.infer<typeof embedStartArgsSchema>;
/** Answer of `embedStart`. */
export type EmbedStartResult = z.infer<typeof embedStartResultSchema>;
/** The D5 profile form. */
export type PatientProfileCompletion = z.infer<typeof patientProfileCompletionSchema>;
/** Arguments of `embedCompleteProfile`. */
export type EmbedCompleteProfileArgs = z.infer<typeof embedCompleteProfileArgsSchema>;
/** Answer of `embedCompleteProfile`. */
export type EmbedCompleteProfileResult = z.infer<typeof embedCompleteProfileResultSchema>;
/** Answer of `embedLogout`. */
export type EmbedLogoutResult = z.infer<typeof embedLogoutResultSchema>;
/** One `onEmbedConsultEvent` event. */
export type EmbedConsultEvent = z.infer<typeof embedConsultEventSchema>;
/** `details` of `409 session_renewal_required`. */
export type SessionRenewalRequiredDetails = z.infer<typeof sessionRenewalRequiredDetailsSchema>;
/** Answer of `POST /v1/physicians/{id}/deactivate`. */
export type DeactivatePhysicianResponse = z.infer<typeof deactivatePhysicianResponseSchema>;
/** The grant v2. */
export type SessionGrant = z.infer<typeof sessionGrantSchema>;
/** Patient presentation. */
export type PatientPresentation = z.infer<typeof patientPresentationSchema>;
/** Provider presentation. */
export type ClinicianPresentation = z.infer<typeof clinicianPresentationSchema>;
/** `detail` of each patient event. */
export type PatientEventDetailMap = {[E in keyof typeof patientEventDetailSchemas]: z.infer<(typeof patientEventDetailSchemas)[E]>};
/** `detail` of each provider event. */
export type ProviderEventDetailMap = {[E in keyof typeof providerEventDetailSchemas]: z.infer<(typeof providerEventDetailSchemas)[E]>};
/** Any loader → patient frame message. */
export type PatientLoaderMessage = z.infer<typeof patientLoaderMessageSchema>;
/** Any loader → clinician frame message. */
export type ClinicianLoaderMessage = z.infer<typeof clinicianLoaderMessageSchema>;
/** Any patient frame → loader message. */
export type PatientFrameMessage = z.infer<typeof patientFrameMessageSchema>;
/** Any clinician frame → loader message. */
export type ClinicianFrameMessage = z.infer<typeof clinicianFrameMessageSchema>;
