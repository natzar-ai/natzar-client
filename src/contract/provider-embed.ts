// GENERATED FILE — do not edit.
//
// Copied verbatim from provider-portal's shared/partner-api by
// scripts/sync-contract.mjs. Edit the source there; this copy exists only so
// the published package is self-contained.
/**
 * Provider embed contract: the `<natzar-provider>` clinician element, the
 * session your server mints for it, the provider REST route table under
 * `/v1/provider-embed`, and the `postMessage` protocol between the loader on
 * your page and the provider iframe.
 *
 * ## Trust model
 *
 * Your API key identifies your application. In `delegated` mode your backend
 * vouches that its authenticated user is the named clinician; in `verified`
 * mode it also forwards the clinician's own Cognito ID token, whose subject
 * must match. Which of the two your account may use is a provider embed
 * policy decision on our side, disabled until configured — it is never
 * derived from the `physicianAssertion` capability. Self-reported MFA claims
 * are never accepted as proof.
 *
 * ## Server-only routes
 *
 * `POST /sessions`, `POST /sessions/{sessionId}/renew` and
 * `DELETE /sessions/{sessionId}` take your CURRENT API key (no rotation
 * grace, no cached authorization) and must only ever be called from your
 * server. Their responses carry `Cache-Control: no-store`. Every other route
 * takes the provider session credential (`pe1.…`) and is called by the
 * provider iframe itself. There, a legacy bearer credential (API key,
 * physician session token, patient embed token) is refused with
 * `401 provider_session_invalid`, and a request carrying an `X-Api-Key`,
 * `X-Natzar-Physician` or `X-Natzar-Physician-Id` header is refused with
 * `400 invalid_request` (`details.reason: 'conflicting_credentials'`).
 *
 * ## Modes
 *
 * - `workspace` — the clinician's own assigned written consultations, own
 *   appointments, active call and availability.
 * - `consultation` — exactly one async or telehealth consultation; no
 *   navigation to another episode or patient.
 * - `patient` — one patient with a verified clinical relationship. Rejected by
 *   the v1 mint schema ({@link PROVIDER_EMBED_V1_MODES}) until that release
 *   stage ships.
 *
 * Capabilities are an explicit list ({@link PROVIDER_EMBED_CAPABILITIES}); a
 * session holds the requested subset intersected with your policy, the
 * deployment and the mode ({@link PROVIDER_EMBED_MODE_CAPABILITIES}). The
 * scope of a session never widens: renewal keeps the identity, parent origin,
 * mode, scope and capabilities it was minted with.
 *
 * ## Lifecycle
 *
 * Access credentials live {@link PROVIDER_EMBED_ACCESS_TTL_SECONDS} seconds
 * and are renewed {@link PROVIDER_EMBED_RENEW_LEAD_SECONDS} seconds before
 * expiry through your `getSession` callback. A logical session ends after
 * {@link PROVIDER_EMBED_ABSOLUTE_TTL_SECONDS} seconds at the latest and locks
 * after {@link PROVIDER_EMBED_IDLE_TIMEOUT_SECONDS} seconds without real
 * interaction. The element moves through {@link PROVIDER_EMBED_LIFECYCLE_STATES};
 * revoke sessions from your server on logout and offboarding — removing the
 * element is not a logout.
 *
 * ## No tokens in URLs
 *
 * The session credential is handed to the iframe over the established
 * message channel only. It never appears in a URL, fragment, HTML attribute,
 * DOM event, cookie or browser storage, and the frame URL carries nothing but
 * your partner id.
 *
 * ## Event names
 *
 * DOM events are named `natzar:provider:<event>` (see
 * {@link ProviderEmbedDomEventName}). That prefix begins with the patient
 * embed's `natzar:` prefix, so listen to exact event names rather than to
 * anything that starts with `natzar:`.
 *
 * This module is imported by the loader, the provider iframe and partner
 * TypeScript: it is intentionally runtime-free apart from constants, and it
 * uses no DOM types.
 *
 * @packageDocumentation
 */

import type {
  AsyncClosedReason, AsyncConsultKind, AsyncConsultStatus, IsoDate, IsoDateTime,
  MessageClassification, PatientLang, PatientSex, TelehealthStatus,
} from './resources';
import type {ReferralDraft, ReferralKind, ReferralLanguage, ReferralStatus} from './referrals';
import type {PrescriptionDraft, PrescriptionStatus} from './prescriptions';
import type {ErrorCode} from './errors';

// ---------------------------------------------------------------- constants

/** `postMessage` protocol namespace of the provider embed (distinct from the patient embed's). */
export const PROVIDER_EMBED_PROTOCOL = 'natzar-provider-v1' as const;
/** Version of the `postMessage` protocol; stable for the life of `/provider/v1`. */
export const PROVIDER_EMBED_PROTOCOL_VERSION = 1 as const;
/** Version of the provider REST facade; the frame requires `GET /session` to report exactly this. */
export const PROVIDER_EMBED_API_VERSION = 1 as const;
/** Tag name of the provider element. */
export const PROVIDER_EMBED_ELEMENT_TAG = 'natzar-provider' as const;
/** Prefix of the DOM `CustomEvent` names the element dispatches. */
export const PROVIDER_EMBED_DOM_EVENT_PREFIX = 'natzar:provider:' as const;
/** Path of the versioned loader script on the provider embed origin. */
export const PROVIDER_EMBED_LOADER_PATH = '/provider/v1/embed.js' as const;
/** Path prefix of the dynamic frame shell (`/provider/frame/{partnerId}`). */
export const PROVIDER_EMBED_FRAME_PATH_PREFIX = '/provider/frame/' as const;
/** Path prefix of the hashed provider UI assets. */
export const PROVIDER_EMBED_ASSET_PATH_PREFIX = '/provider/app/' as const;
/** API subtree below the stage (`https://<api host>/v1/provider-embed`). */
export const PROVIDER_EMBED_API_PATH = '/v1/provider-embed' as const;
/** Element id of the JSON frame configuration the dynamic shell embeds. */
export const PROVIDER_EMBED_FRAME_CONFIG_ELEMENT_ID = 'natzar-provider-config' as const;
/** Permissions delegated to the provider iframe (NOT the patient list). */
export const PROVIDER_EMBED_IFRAME_ALLOW = 'camera; microphone; fullscreen' as const;
/** iframe `allow` when the grant does not include telehealth.join (least privilege). */
export const PROVIDER_EMBED_IFRAME_ALLOW_NO_MEDIA = 'fullscreen' as const;
/** `sandbox` tokens of the provider iframe: no top navigation, no popups. */
export const PROVIDER_EMBED_IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-downloads' as const;
/** First segment of every provider session credential. */
export const PROVIDER_EMBED_TOKEN_PREFIX = 'pe1' as const;
/** `pe1.<22-char base64url session id>.<43-char base64url secret>` (128-bit id, 256-bit secret). */
export const PROVIDER_EMBED_TOKEN_REGEX = /^pe1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/;
/** Shape of a public session id (22 base64url characters, 128 random bits). */
export const PROVIDER_EMBED_SESSION_ID_REGEX = /^[A-Za-z0-9_-]{22}$/;
/** Request header carrying the idempotency key of a retryable clinical mutation. */
export const PROVIDER_EMBED_IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key' as const;
/** Accepted idempotency keys: 16–128 base64url characters. */
export const PROVIDER_EMBED_IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_-]{16,128}$/;
/** Response header set when a stored idempotent outcome is replayed. */
export const PROVIDER_EMBED_REPLAYED_HEADER = 'Idempotent-Replayed' as const;
/** Default lifetime of one access credential, in seconds (5 minutes). */
export const PROVIDER_EMBED_ACCESS_TTL_SECONDS = 300;
/** Renewal starts this many seconds before the access credential expires. */
export const PROVIDER_EMBED_RENEW_LEAD_SECONDS = 60;
/** Maximum lifetime of one logical session, in seconds (8 hours). */
export const PROVIDER_EMBED_ABSOLUTE_TTL_SECONDS = 28_800;
/** Default inactivity lock, in seconds (15 minutes). */
export const PROVIDER_EMBED_IDLE_TIMEOUT_SECONDS = 900;
/** How long the previous secret stays valid after a renewal, in seconds. */
export const PROVIDER_EMBED_PREVIOUS_SECRET_OVERLAP_SECONDS = 30;
/** Bound on the loader/frame handshake, in milliseconds. */
export const PROVIDER_EMBED_HANDSHAKE_TIMEOUT_MS = 10_000;
/** Largest accepted `postMessage` payload, in bytes of serialized JSON. */
export const PROVIDER_EMBED_MAX_MESSAGE_BYTES = 16_384;
/** Channel nonce: 32 random bytes, base64url. */
export const PROVIDER_EMBED_NONCE_REGEX = /^[A-Za-z0-9_-]{43}$/;
/** Shape of a protocol request id. */
export const PROVIDER_EMBED_REQUEST_ID_REGEX = /^[A-Za-z0-9_-]{8,64}$/;
/** Most unanswered protocol requests one channel may hold. */
export const PROVIDER_EMBED_MAX_PENDING_REQUESTS = 16;
/** Backoff schedule of failed renewals, in milliseconds. */
export const PROVIDER_EMBED_RENEW_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
/** Minimum interval between two activity reports, in milliseconds. */
export const PROVIDER_EMBED_ACTIVITY_MIN_INTERVAL_MS = 30_000;
/** Upper bound of a signed file URL's lifetime, in seconds. */
export const PROVIDER_EMBED_FILE_URL_MAX_SECONDS = 60;
/** Cap of each workspace list (a capped list says `truncated: true`). */
export const PROVIDER_EMBED_WORKSPACE_LIST_CAP = 50;
/** Largest page size of a paginated provider list. */
export const PROVIDER_EMBED_MAX_PAGE_LIMIT = 50;
/** Most referral drafts one issue or preview request may carry. */
export const PROVIDER_EMBED_MAX_REFERRAL_DRAFTS = 5;
/** Widest agenda window, in milliseconds (31 days). */
export const PROVIDER_EMBED_AGENDA_MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
/** Most pending reply ids one transcript poll may ask about. */
export const PROVIDER_EMBED_MAX_PENDING_MESSAGE_IDS = 5;
/** Accepted accent colors: `#rgb` or `#rrggbb`. */
export const PROVIDER_EMBED_HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// ------------------------------------------------------------------ modes etc

/** Every provider embed mode. */
export const PROVIDER_EMBED_MODES = ['workspace', 'consultation', 'patient'] as const;
/** A provider embed mode. */
export type ProviderEmbedMode = (typeof PROVIDER_EMBED_MODES)[number];
/** Modes the v1 mint schema accepts; `patient` is added only when the patient-mode flag ships (D9). */
export const PROVIDER_EMBED_V1_MODES = ['workspace', 'consultation'] as const satisfies readonly ProviderEmbedMode[];
/** Consultation kinds (the `{kind}` path segment). */
export const PROVIDER_EMBED_CONSULT_KINDS = ['async', 'telehealth'] as const;
/** A consultation kind: written (`async`) or video (`telehealth`). */
export type ProviderEmbedConsultKind = (typeof PROVIDER_EMBED_CONSULT_KINDS)[number];
/** How a session's clinician was authenticated. */
export const PROVIDER_EMBED_AUTH_METHODS = ['delegated', 'verified'] as const;
/** `delegated` (your server vouches) or `verified` (the clinician's Cognito ID token). */
export type ProviderEmbedAuthMethod = (typeof PROVIDER_EMBED_AUTH_METHODS)[number];
/** Delegation policies a partner account may be configured with. */
export const PROVIDER_EMBED_DELEGATION_MODES = ['delegated', 'verified', 'either'] as const;
/** Which authentication methods the partner's provider embed policy accepts at mint. */
export type ProviderEmbedDelegationMode = (typeof PROVIDER_EMBED_DELEGATION_MODES)[number];

/** Every capability a provider session can hold. No wildcards, no free-form scopes. */
export const PROVIDER_EMBED_CAPABILITIES = [
  'workspace.read', 'appointments.read', 'appointments.cancel',
  'consult.read', 'consult.reply', 'consult.complete',
  'attachments.read', 'attachments.write',
  'patient.read', 'patient.history.read',
  'referrals.preview', 'referrals.issue',
  'prescriptions.preview', 'prescriptions.issue',
  'telehealth.join', 'telehealth.end', 'presence.write',
  'availability.write',
] as const;
/** One provider embed capability. */
export type ProviderEmbedCapability = (typeof PROVIDER_EMBED_CAPABILITIES)[number];
/** Gated by the deployment media flag (D8) in addition to policy. */
export const PROVIDER_EMBED_MEDIA_CAPABILITIES = ['telehealth.join', 'telehealth.end', 'presence.write'] as const satisfies readonly ProviderEmbedCapability[];
/** Only grantable in patient mode (D9). */
export const PROVIDER_EMBED_PATIENT_ONLY_CAPABILITIES = ['patient.history.read'] as const satisfies readonly ProviderEmbedCapability[];
/** Only grantable where the deployment's prescribing transport is fax. */
export const PROVIDER_EMBED_FAX_CAPABILITIES = ['prescriptions.preview', 'prescriptions.issue'] as const satisfies readonly ProviderEmbedCapability[];

/** Key of the mode/capability matrix (consultation mode is split by kind). */
export type ProviderEmbedModeKey = 'workspace' | 'consultation:async' | 'consultation:telehealth' | 'patient';
/** The ONLY capabilities each mode may ever hold (intersected with policy, deployment and tenant features at mint). */
export const PROVIDER_EMBED_MODE_CAPABILITIES: {readonly [K in ProviderEmbedModeKey]: readonly ProviderEmbedCapability[]} = {
  workspace: [
    'workspace.read', 'appointments.read', 'appointments.cancel', 'consult.read', 'consult.reply', 'consult.complete',
    'attachments.read', 'attachments.write', 'patient.read', 'referrals.preview', 'referrals.issue',
    'prescriptions.preview', 'prescriptions.issue', 'telehealth.join', 'telehealth.end', 'presence.write',
    'availability.write',
  ],
  'consultation:async': [
    'consult.read', 'consult.reply', 'consult.complete', 'attachments.read', 'attachments.write', 'patient.read',
    'referrals.preview', 'referrals.issue', 'prescriptions.preview', 'prescriptions.issue',
  ],
  'consultation:telehealth': [
    'consult.read', 'patient.read', 'appointments.read', 'appointments.cancel', 'telehealth.join', 'telehealth.end',
  ],
  patient: [
    'patient.read', 'patient.history.read', 'consult.read', 'consult.reply', 'consult.complete', 'attachments.read',
    'attachments.write', 'referrals.preview', 'referrals.issue', 'prescriptions.preview', 'prescriptions.issue',
    'appointments.read',
  ],
};

/** Why a requested optional capability was not granted. */
export const PROVIDER_EMBED_UNAVAILABLE_REASONS = [
  'not_in_policy', 'not_for_mode', 'deployment_disabled', 'tenant_feature_disabled', 'transport_unsupported',
] as const;
/** A safe reason code for an ungranted capability. */
export type ProviderEmbedUnavailableReason = (typeof PROVIDER_EMBED_UNAVAILABLE_REASONS)[number];
/** An optional capability the session does not hold, with the reason. */
export interface ProviderEmbedUnavailableCapability {
  /** The capability that was not granted. */
  capability: ProviderEmbedCapability;
  /** Why it was not granted. */
  reason: ProviderEmbedUnavailableReason;
}

// ------------------------------------------------------------------- scope

/** The immutable resource scope of a session, fixed at mint. */
export type ProviderEmbedScope =
  | {mode: 'workspace'}
  | {mode: 'consultation'; kind: ProviderEmbedConsultKind; consultationId: string}
  | {mode: 'patient'; patientId: string};

// ------------------------------------------------------ server-only session routes

/** Exactly one of our id or your external id (`UserProfile.externalKey = <group>#<externalId>`). */
export type ProviderEmbedClinicianRef = {physicianId: string} | {externalPhysicianId: string};
/** Exactly one of our patient id or your external patient id. */
export type ProviderEmbedPatientRef = {patientId: string} | {externalPatientId: string};
/** Fields every mint request carries, whatever its mode. */
export interface ProviderEmbedMintCommon {
  /** The clinician the session acts as. Never taken from a browser-supplied value. */
  clinician: ProviderEmbedClinicianRef;
  /** Verified mode only: the clinician's current Cognito ID token (never self-reported MFA claims). */
  clinicianToken?: string;
  /** Exact origin of the page that embeds `<natzar-provider>` (scheme://host[:port]). */
  parentOrigin: string;
  /** Required capabilities; mint fails with 403 `capability_not_granted` if any cannot be granted. */
  capabilities: ProviderEmbedCapability[];
  /** Granted when possible, else reported in `unavailable`. */
  optionalCapabilities?: ProviderEmbedCapability[];
  /** Your own login's remaining lifetime; may only shorten the absolute lifetime (300–28800). */
  maxAbsoluteSeconds?: number;
  /** May only shorten the inactivity lock (60–900). */
  idleTimeoutSeconds?: number;
}
/** Body of `POST /v1/provider-embed/sessions` (server-only, current API key). */
export type ProviderEmbedMintRequest =
  | (ProviderEmbedMintCommon & {mode: 'workspace'})
  | (ProviderEmbedMintCommon & {mode: 'consultation'; resource: {kind: ProviderEmbedConsultKind; consultationId: string}})
  | (ProviderEmbedMintCommon & {mode: 'patient'; resource: ProviderEmbedPatientRef});
/** Body of `POST /v1/provider-embed/sessions/{sessionId}/renew` (server-only, current API key). */
export interface ProviderEmbedRenewRequest {
  /** Must name the same clinician the session was minted for. */
  clinician: ProviderEmbedClinicianRef;
  /** Verified mode only: a current Cognito ID token of that clinician. */
  clinicianToken?: string;
}
/** Mint and renew response. `Cache-Control: no-store`. */
export interface ProviderEmbedSessionGrant {
  /** Public id of the logical session (correlation and revocation; not a credential). */
  sessionId: string;
  /** The `pe1.…` access credential. Hand it to the loader only; never put it in a URL. */
  sessionToken: string;
  /** When this access credential expires. */
  expiresAt: IsoDateTime;
  /** When the loader should start renewing. */
  renewAfter: IsoDateTime;
  /** When the logical session ends; renewal never extends it. */
  absoluteExpiresAt: IsoDateTime;
  /** The session's inactivity lock, in seconds. */
  idleTimeoutSeconds: number;
  /** Deployment-owned frame URL (no credential in it). */
  frameUrl: string;
  /** Deployment-owned provider API base URL. */
  apiUrl: string;
  /** The exact parent origin the session is bound to. */
  parentOrigin: string;
  /** The session's mode. */
  mode: ProviderEmbedMode;
  /** The session's immutable scope. */
  scope: ProviderEmbedScope;
  /** The capabilities granted. */
  capabilities: ProviderEmbedCapability[];
  /** Requested optional capabilities that were not granted. */
  unavailable: ProviderEmbedUnavailableCapability[];
  /** Deployment environment of the session. */
  environment: string;
  /** Residency zone of the session. */
  zone: string;
  /** Protocol version the frame speaks. */
  protocolVersion: typeof PROVIDER_EMBED_PROTOCOL_VERSION;
  /** Our clinician id; lets the loader detect an identity change without asking the frame. */
  physicianId: string;
}

// ------------------------------------------------------------ browser views

/** Minimal display profile of the acting clinician. */
export interface ProviderEmbedPhysicianView {
  /** Our clinician id. */
  id: string;
  /** Name to display. */
  displayName: string;
  /** Given name, when known. */
  givenName?: string;
  /** Family name, when known. */
  familyName?: string;
  /** Professional title, when known. */
  title?: string;
}
/** `GET /v1/provider-embed/session` response: who the session acts as and what it may do. */
export interface ProviderEmbedSessionView {
  /** Public id of the logical session. */
  sessionId: string;
  /** The session's mode. */
  mode: ProviderEmbedMode;
  /** The session's immutable scope. */
  scope: ProviderEmbedScope;
  /** The capabilities currently effective. */
  capabilities: ProviderEmbedCapability[];
  /** Requested optional capabilities that are not available. */
  unavailable: ProviderEmbedUnavailableCapability[];
  /** The parent origin the session is bound to. */
  parentOrigin: string;
  /** When the current access credential expires. */
  expiresAt: IsoDateTime;
  /** When renewal should start. */
  renewAfter: IsoDateTime;
  /** When the logical session ends. */
  absoluteExpiresAt: IsoDateTime;
  /** When the inactivity lock engages without further interaction. */
  idleExpiresAt: IsoDateTime;
  /** The session's inactivity lock, in seconds. */
  idleTimeoutSeconds: number;
  /** The acting clinician. */
  physician: ProviderEmbedPhysicianView;
  /** Deployment environment. */
  environment: string;
  /** Residency zone. */
  zone: string;
  /** Deployment features the UI adapts to. */
  features: {mediaEnabled: boolean; prescribingTransport: 'fax' | null};
  /** The partner the session belongs to; the frame requires it to equal its configuration. */
  partnerId: string;
  /** Provider API version; the frame requires equality with {@link PROVIDER_EMBED_API_VERSION}. */
  apiVersion: typeof PROVIDER_EMBED_API_VERSION;
}
/** The minimum patient context shown beside an authorized episode. */
export interface ProviderEmbedPatientSummary {
  /** Our patient id. */
  id: string;
  /** Given name. */
  givenName?: string;
  /** Family name. */
  familyName?: string;
  /** Date of birth. */
  birthdate?: IsoDate;
  /** Sex as recorded. */
  sex?: PatientSex;
  /** Patient locale. */
  lang?: PatientLang;
}
/** One written (async) consultation in a list. */
export interface ProviderEmbedConsultRow {
  /** Always `async`. */
  kind: 'async';
  /** Consultation id. */
  id: string;
  /** Lifecycle status. */
  status: AsyncConsultStatus;
  /** Conversation or non-blocking referral request. */
  threadKind: AsyncConsultKind;
  /** Label of a referral request. */
  requestSubject?: string;
  /** Current assignee, or the recorded assignee of a closed episode. */
  relationship: 'assignee' | 'recorded_assignee';
  /** Patient summary, or null when it cannot be shown. */
  patient: ProviderEmbedPatientSummary | null;
  /** When the clinician was assigned. */
  assignedAt?: IsoDateTime;
  /** Since when the patient has been waiting for the clinician. */
  awaitingPhysicianSince?: IsoDateTime;
  /** When a response is due. */
  responseDueAt?: IsoDateTime;
  /** The response is overdue. */
  overdue: boolean;
  /** The patient is waiting on the clinician. */
  needsAttention: boolean;
  /** An emergency was flagged on the thread. */
  emergencyFlagged: boolean;
  /** When resolution was requested. */
  resolveRequestedAt?: IsoDateTime;
  /** When the episode ended. */
  endedAt?: IsoDateTime;
  /** How a closed episode ended. */
  closedReason?: AsyncClosedReason;
  /** Last activity on the thread. */
  lastActivityAt?: IsoDateTime;
  /** When the consultation was created. */
  createdAt?: IsoDateTime;
}
/** One telehealth appointment or call in a list. */
export interface ProviderEmbedAppointmentRow {
  /** Always `telehealth`. */
  kind: 'telehealth';
  /** Consultation id. */
  id: string;
  /** Lifecycle status. */
  status: TelehealthStatus;
  /** Live queue or scheduled appointment. */
  mode: 'queue' | 'scheduled';
  /** Video or in person. */
  modality: 'telehealth' | 'in_person';
  /** Scheduled start. */
  scheduledAt?: IsoDateTime;
  /** Scheduled end. */
  scheduledEndAt?: IsoDateTime;
  /** Actual start. */
  startedAt?: IsoDateTime;
  /** Actual end. */
  endedAt?: IsoDateTime;
  /** Specialty booked. */
  specialty?: string;
  /** The patient's IANA time zone. */
  patientTimezone?: string;
  /** Patient summary, or null when it cannot be shown. */
  patient: ProviderEmbedPatientSummary | null;
}
/** The clinician's live presence as the embed sees it. */
export interface ProviderEmbedPresenceView {
  /** Rota status. */
  status: 'ready' | 'busy' | 'offline';
  /** The last heartbeat is older than the presence TTL. */
  stale: boolean;
  /** When the clinician became ready. */
  readyAt?: IsoDateTime;
  /** Last heartbeat. */
  lastSeenAt?: IsoDateTime;
  /** Whether THIS session holds the presence ownership lease. */
  lease: {held: boolean; expiresAt?: IsoDateTime};
}
/** `GET /v1/provider-embed/workspace` response: the clinician's own work only (workspace mode). */
export interface ProviderEmbedWorkspace {
  /** When the projection was generated. */
  generatedAt: IsoDateTime;
  /** The acting clinician. */
  physician: ProviderEmbedPhysicianView;
  /** Own written consultations, or null when unavailable. */
  async: {
    available: boolean;
    mine: ProviderEmbedConsultRow[];
    truncated: boolean;
    counts: {needsAttention: number; waitingForPatient: number; total: number};
  } | null;
  /** Own appointments and active call, or null when unavailable. */
  telehealth: {
    upcoming: ProviderEmbedAppointmentRow[];
    active: ProviderEmbedAppointmentRow | null;
    presence: ProviderEmbedPresenceView | null;
    truncated: boolean;
  } | null;
}
/** Query of `GET /v1/provider-embed/agenda` (window of at most 31 days). */
export interface ProviderEmbedAgendaQuery {
  /** Window start. */
  from?: IsoDateTime;
  /** Window end. */
  to?: IsoDateTime;
}
/** `GET /v1/provider-embed/agenda` response. */
export interface ProviderEmbedAgenda {
  /** Own appointments in the window. */
  appointments: ProviderEmbedAppointmentRow[];
  /** The clinician's IANA time zone. */
  timezone: string;
}
/** Query of `GET /v1/provider-embed/consultations`. */
export interface ProviderEmbedConsultationsQuery {
  /** Only this kind. */
  kind?: ProviderEmbedConsultKind;
  /** Only open or only closed episodes. */
  state?: 'open' | 'closed';
  /** Opaque cursor from the previous page; bound to this session and filter. */
  cursor?: string;
  /** Page size, 1–50. */
  limit?: number;
}
/** One page of a provider list. */
export interface ProviderEmbedPage<T> {
  /** The rows of this page. */
  items: T[];
  /** Cursor of the next page; absent on the last one. */
  nextCursor?: string;
  /** The server stopped early; the list is not exhaustive. */
  truncated?: boolean;
}
/** Which actions the clinician may take on an async consultation right now. */
export interface ProviderEmbedAsyncActions {
  /** Post a reply. */
  reply: boolean;
  /** Request resolution. */
  resolve: boolean;
  /** Close the thread. */
  close: boolean;
  /** Upload an attachment. */
  upload: boolean;
  /** Issue a referral. */
  referral: boolean;
  /** Issue a prescription. */
  prescription: boolean;
}
/** The AI-drafted next step awaiting the clinician's review. */
export interface ProviderEmbedRecommendation {
  /** A proposed note. */
  note?: string;
  /** Proposed referral drafts. */
  referrals?: ReferralDraft[];
  /** A proposed prescription draft. */
  prescription?: PrescriptionDraft;
}
/** `GET /v1/provider-embed/consultations/async/{id}` response. */
export interface ProviderEmbedAsyncConsultDetail {
  /** Always `async`. */
  kind: 'async';
  /** The consultation with its clinical context. */
  consult: ProviderEmbedConsultRow & {
    context?: string;
    resolutionNote?: string;
    specialty?: string;
    patientState?: string;
    patientCountry?: string;
    patientLang?: string;
    suggestedReferrals?: ReferralDraft[];
    recommendation?: ProviderEmbedRecommendation;
  };
  /** Patient summary, or null when it cannot be shown. */
  patient: ProviderEmbedPatientSummary | null;
  /** The clinician is the current assignee of an active episode. */
  canWrite: boolean;
  /** Per-action availability. */
  actions: ProviderEmbedAsyncActions;
}
/** Which actions the clinician may take on a telehealth consultation right now. */
export interface ProviderEmbedTelehealthActions {
  /** Join the call. */
  join: boolean;
  /** Signal readiness. */
  ready: boolean;
  /** End the call. */
  end: boolean;
  /** Cancel the appointment. */
  cancel: boolean;
}
/** `GET /v1/provider-embed/consultations/telehealth/{id}` response. */
export interface ProviderEmbedTelehealthConsultDetail {
  /** Always `telehealth`. */
  kind: 'telehealth';
  /** The appointment with its clinical context. */
  consult: ProviderEmbedAppointmentRow & {context?: string; patientState?: string; patientLang?: string};
  /** Patient summary, or null when it cannot be shown. */
  patient: ProviderEmbedPatientSummary | null;
  /** Per-action availability. */
  actions: ProviderEmbedTelehealthActions;
}
/** Either consultation detail, discriminated by `kind`. */
export type ProviderEmbedConsultDetail = ProviderEmbedAsyncConsultDetail | ProviderEmbedTelehealthConsultDetail;

/** Coarse class of an attachment, for rendering. */
export type ProviderEmbedAttachmentKind = 'image' | 'pdf' | 'audio' | 'video' | 'document' | 'other';
/** An attachment on a transcript message; fetch it through the files route by `fileId`. */
export interface ProviderEmbedAttachment {
  /** Opaque, session-bound file id (never a storage key). */
  fileId: string;
  /** Sanitized file name. */
  fileName: string;
  /** MIME type. */
  mimeType: string;
  /** Coarse class. */
  kind: ProviderEmbedAttachmentKind;
}
/** Delivery state of a clinician message. */
export type ProviderEmbedDelivery = 'recorded' | 'sent' | 'delivered' | 'read' | 'failed';
/** One transcript message of the episode. */
export interface ProviderEmbedMessage {
  /** Message id. */
  id: string;
  /** Who wrote it. */
  author: 'patient' | 'physician' | 'system';
  /** Text; render as text, never as HTML. */
  body: string;
  /** Classification of a system notice. */
  classification?: MessageClassification;
  /** Signature line of a clinician message. */
  signature?: string;
  /** Written by the acting clinician. */
  own: boolean;
  /** Delivery state of an own message. */
  delivery?: ProviderEmbedDelivery;
  /** Attachments. */
  attachments?: ProviderEmbedAttachment[];
  /** When it was sent. */
  sentAt: IsoDateTime;
}
/** Query of `GET /v1/provider-embed/consultations/async/{id}/messages`. */
export interface ProviderEmbedMessagesQuery {
  /** Opaque cursor from the previous poll. */
  cursor?: string;
  /** Page size, 1–100. */
  limit?: number;
  /** Comma-separated ids of own replies still awaiting confirmation (at most 5). */
  pending?: string;
}
/** State of an own reply that has not reached the transcript yet. */
export interface ProviderEmbedPendingReplyState {
  /** The reply's message id. */
  messageId: string;
  /** Still queued, rejected by the workflow, or not confirmable. */
  state: 'queued' | 'rejected' | 'unconfirmed';
}
/** `GET /v1/provider-embed/consultations/async/{id}/messages` response. */
export interface ProviderEmbedTranscriptPage {
  /** Messages of the episode, oldest first. */
  items: ProviderEmbedMessage[];
  /** Cursor to poll from next. */
  cursor?: string;
  /** More messages are available now. */
  hasMore: boolean;
  /** States of the pending replies asked about. */
  pending: ProviderEmbedPendingReplyState[];
}
/** Body of `POST …/consultations/async/{id}/replies`. */
export interface ProviderEmbedReplyRequest {
  /** Reply text (1–4000 characters, not blank). */
  text: string;
  /** A finalized upload to attach. */
  uploadId?: string;
}
/** `POST …/replies` response (202): accepted for delivery, not yet delivered. */
export interface ProviderEmbedReplyResponse {
  /** Always true. */
  accepted: true;
  /** Id to track through `pending`. */
  messageId: string;
}
/** Body of `POST …/consultations/async/{id}/resolve`. */
export interface ProviderEmbedResolveRequest {
  /** Optional resolution note shown to the patient. */
  note?: string;
}
/** Response of the async resolve and close routes. */
export interface ProviderEmbedConsultStateResponse {
  /** The consultation after the transition. */
  consult: ProviderEmbedConsultRow;
}
/** Body of `POST …/consultations/{kind}/{id}/uploads`. */
export interface ProviderEmbedUploadRequest {
  /** File name as chosen by the user. */
  fileName: string;
  /** Lower-case `type/subtype`, no parameters. */
  contentType: string;
  /** Declared size in bytes; the stored object is verified at finalize. */
  contentLength: number;
}
/** An episode-bound upload slot. */
export interface ProviderEmbedUploadSlot {
  /** Id to finalize and attach. */
  uploadId: string;
  /** Signed upload URL; use it from the frame only. */
  uploadUrl: string;
  /** Always `PUT`. */
  method: 'PUT';
  /** Headers the upload must carry. */
  headers: {'Content-Type': string};
  /** When the slot expires. */
  expiresAt: IsoDateTime;
}
/** `POST …/uploads/{uploadId}/finalize` response: the stored bytes were verified. */
export interface ProviderEmbedFinalizedUpload {
  /** The upload id. */
  uploadId: string;
  /** Sanitized file name. */
  fileName: string;
  /** Verified MIME type. */
  mimeType: string;
  /** Verified size in bytes. */
  sizeBytes: number;
  /** Coarse class. */
  kind: ProviderEmbedAttachmentKind;
  /** Always `ready`. */
  state: 'ready';
}
/** `GET …/files/{fileId}` response: a short-lived download grant. */
export interface ProviderEmbedFileGrant {
  /** The file id. */
  fileId: string;
  /** Sanitized file name. */
  fileName: string;
  /** MIME type. */
  mimeType: string;
  /** Forced disposition. */
  disposition: 'inline' | 'attachment';
  /** Signed URL valid for at most 60 seconds; never forward it. */
  url: string;
  /** When the URL expires. */
  expiresAt: IsoDateTime;
}
/** A referral or prescription issued on the episode. */
export interface ProviderEmbedDocumentRow {
  /** Which kind of document. */
  documentType: 'referral' | 'prescription';
  /** Document id. */
  id: string;
  /** Kind of a referral. */
  referralKind?: ReferralKind;
  /** Display title. */
  title: string;
  /** Document status. */
  status: ReferralStatus | PrescriptionStatus;
  /** When it was issued. */
  issuedAt: IsoDateTime;
  /** Signed by the acting clinician. */
  signedByMe: boolean;
  /** Number of referrals in the same signed bundle. */
  bundleSize?: number;
  /** File id of the PDF, or null when it cannot be fetched. */
  fileId: string | null;
}
/** Why a clinical action is not available. */
export type ProviderEmbedActionBlock =
  | 'capability_not_granted' | 'not_assigned' | 'not_active' | 'request_thread' | 'transport_unsupported'
  | 'prescriber_not_eligible';
/** `GET …/consultations/async/{id}/clinical-actions` response. */
export interface ProviderEmbedClinicalActions {
  /** The consultation. */
  consultationId: string;
  /** The clinician may act on the episode at all. */
  canAct: boolean;
  /** Referral availability. */
  referrals: {available: boolean; blockedBy?: ProviderEmbedActionBlock};
  /** Prescribing availability. */
  prescribing: {available: boolean; transport: 'fax' | null; prescriberEligible: boolean; blockedBy?: ProviderEmbedActionBlock};
  /** Documents already issued on the episode. */
  documents: ProviderEmbedDocumentRow[];
}
/** Body of the referral preview and issue routes: one draft or a bundle of up to five. */
export type ProviderEmbedReferralRequest =
  | {draft: ReferralDraft; lang?: ReferralLanguage}
  | {drafts: ReferralDraft[]; lang?: ReferralLanguage};
/** A rendered, unsigned PDF preview. */
export interface ProviderEmbedPdfPreview {
  /** Suggested file name. */
  fileName: string;
  /** The PDF bytes, base64. */
  pdfBase64: string;
}
/** `POST …/referrals/preview` response. */
export interface ProviderEmbedReferralPreviewResponse {
  /** One preview per draft. */
  documents: ProviderEmbedPdfPreview[];
}
/** `POST …/referrals` response. */
export interface ProviderEmbedReferralIssueResponse {
  /** Id of the first referral of the bundle. */
  leadId: string;
  /** The issued referrals. */
  referrals: ProviderEmbedDocumentRow[];
  /** The patient notice was confirmed on the transcript. */
  noticeConfirmed: boolean;
}
/** Body of the prescription preview and issue routes. */
export interface ProviderEmbedPrescriptionRequest {
  /** The prescription as written. */
  draft: PrescriptionDraft;
}
/** `POST …/prescriptions` response. */
export interface ProviderEmbedPrescriptionIssueResponse {
  /** The issued prescription. */
  prescription: ProviderEmbedDocumentRow;
  /** The patient notice was confirmed on the transcript. */
  noticeConfirmed: boolean;
}
/** A provider-specific, short-lived media join grant. */
export interface ProviderEmbedMediaGrant {
  /** Id of the media session (the lease heartbeat names it). */
  mediaSessionId: string;
  /** Join token. */
  token: string;
  /** Media server URL. */
  url: string;
  /** Room name. */
  roomName: string;
  /** When the join grant expires. */
  expiresAt: IsoDateTime;
}
/** Body of `POST …/telehealth/{id}/room`. Absent `mediaSessionId` ⇒ join (grant issued). Present ⇒ media lease heartbeat (no token). */
export interface ProviderEmbedRoomRequest {
  /** The media session whose lease to extend. */
  mediaSessionId?: string;
}
/** `POST …/telehealth/{id}/room` response. */
export interface ProviderEmbedRoomResponse {
  /** Consultation status. */
  status: TelehealthStatus;
  /** A join grant, on join. */
  media?: ProviderEmbedMediaGrant;
  /** When the media lease expires. */
  leaseExpiresAt?: IsoDateTime;
}
/** Where a scheduled call stands for the clinician. */
export type ProviderEmbedRendezvousState =
  | {phase: 'early'; opensAt: IsoDateTime; startsAt: IsoDateTime}
  | {phase: 'waiting'; startsAt: IsoDateTime; otherSidePresent: false}
  | {phase: 'connecting'; startsAt: IsoDateTime; otherSidePresent: true}
  | {phase: 'in_progress'; startsAt: IsoDateTime | null}
  | {phase: 'closed'; status: string}
  | {phase: 'missed'; startsAt: IsoDateTime};
/** Body of `POST …/telehealth/{id}/ready`. */
export interface ProviderEmbedReadyRequest {
  /** The clinician is present in the waiting room. */
  present?: boolean;
}
/** `POST …/telehealth/{id}/ready` response. */
export interface ProviderEmbedReadyResponse {
  /** The rendezvous state. */
  state: ProviderEmbedRendezvousState;
  /** A join grant, once the call can start. */
  media?: ProviderEmbedMediaGrant;
}
/** Body of `POST …/telehealth/{id}/end`. */
export interface ProviderEmbedEndRequest {
  /** Leave the rota afterwards (forced for narrow sessions). */
  goOffline?: boolean;
}
/** `POST …/telehealth/{id}/end` response. */
export interface ProviderEmbedEndResponse {
  /** The ended consultation. */
  consult: ProviderEmbedAppointmentRow;
  /** The next call; always null for a narrow session. */
  next: ProviderEmbedAppointmentRow | null;
}
/** Body of `POST …/telehealth/{id}/cancel`. */
export interface ProviderEmbedCancelRequest {
  /** Optional reason. */
  reason?: string;
}
/** `POST …/telehealth/{id}/cancel` response. */
export interface ProviderEmbedAppointmentStateResponse {
  /** The appointment after the transition. */
  consult: ProviderEmbedAppointmentRow;
}
/** Body of `POST /v1/provider-embed/presence`. */
export interface ProviderEmbedPresenceRequest {
  /** Join (true) or leave (false) the live rota. */
  ready: boolean;
}
/** Response of the presence and heartbeat routes. */
export interface ProviderEmbedPresenceResponse {
  /** The clinician's presence after the call. */
  presence: ProviderEmbedPresenceView;
}
/** Body of `POST /v1/provider-embed/availability`. */
export interface ProviderEmbedAvailabilityRequest {
  /** Accept new written consultations. */
  asyncAvailable: boolean;
}
/** `POST /v1/provider-embed/availability` response. */
export interface ProviderEmbedAvailabilityResponse {
  /** The stored availability. */
  asyncAvailable: boolean;
}
/** `GET /v1/provider-embed/patient` response (patient mode). */
export interface ProviderEmbedPatientView {
  /** The session's patient. */
  patient: ProviderEmbedPatientSummary;
  /** The clinician's authorized episodes with that patient. */
  episodes: Array<ProviderEmbedConsultRow | ProviderEmbedAppointmentRow>;
}
/** Query of `GET /v1/provider-embed/patient/history`. */
export interface ProviderEmbedPatientHistoryQuery {
  /** Opaque cursor from the previous page. */
  cursor?: string;
  /** Page size, 1–50. */
  limit?: number;
}
/** `GET /v1/provider-embed/patient/history` response (requires `patient.history.read`). */
export interface ProviderEmbedPatientHistoryPage {
  /** Messages of the longitudinal history. */
  items: ProviderEmbedMessage[];
  /** Cursor of the next page. */
  cursor?: string;
  /** More history is available. */
  hasMore: boolean;
}

// ------------------------------------------------------------- route table

/** Path parameters of a route without any. */
export type ProviderEmbedNoParams = Record<string, never>;
/** Path parameters `{kind}/{id}`. */
export interface ProviderEmbedConsultParams {
  /** Consultation kind. */
  kind: ProviderEmbedConsultKind;
  /** Consultation id. */
  id: string;
}
/** Path parameter `{id}`. */
export interface ProviderEmbedIdParams {
  /** Consultation id. */
  id: string;
}
/**
 * The provider REST route table. Keys are `'METHOD /v1/provider-embed/…'`;
 * `auth: 'server'` routes take your current API key and are called from your
 * server only, `auth: 'browser'` routes take the `pe1` session credential.
 * For GET routes `query` is the query-string shape.
 */
export interface ProviderEmbedEndpoints {
  /** Mint a logical session. Server only. */
  'POST /v1/provider-embed/sessions': {auth: 'server'; params: ProviderEmbedNoParams; query: undefined; request: ProviderEmbedMintRequest; response: ProviderEmbedSessionGrant};
  /** Rotate the credential of the same logical session. Server only. */
  'POST /v1/provider-embed/sessions/{sessionId}/renew': {auth: 'server'; params: {sessionId: string}; query: undefined; request: ProviderEmbedRenewRequest; response: ProviderEmbedSessionGrant};
  /** Revoke a session (idempotent). Server only. */
  'DELETE /v1/provider-embed/sessions/{sessionId}': {auth: 'server'; params: {sessionId: string}; query: undefined; request: undefined; response: undefined};
  /** Identity, effective capabilities, scope and expiry. */
  'GET /v1/provider-embed/session': {auth: 'browser'; params: ProviderEmbedNoParams; query: undefined; request: undefined; response: ProviderEmbedSessionView};
  /** Report real user interaction (rate-limited). */
  'POST /v1/provider-embed/session/activity': {auth: 'browser'; params: ProviderEmbedNoParams; query: undefined; request: ProviderEmbedNoParams; response: undefined};
  /** Revoke the session itself. */
  'POST /v1/provider-embed/session/logout': {auth: 'browser'; params: ProviderEmbedNoParams; query: undefined; request: ProviderEmbedNoParams; response: undefined};
  /** Own assigned work (`workspace.read`, workspace mode). */
  'GET /v1/provider-embed/workspace': {auth: 'browser'; params: ProviderEmbedNoParams; query: undefined; request: undefined; response: ProviderEmbedWorkspace};
  /** Own appointments in a bounded window (`appointments.read`). */
  'GET /v1/provider-embed/agenda': {auth: 'browser'; params: ProviderEmbedNoParams; query: ProviderEmbedAgendaQuery; request: undefined; response: ProviderEmbedAgenda};
  /** Own authorized episodes, paginated (`consult.read`). */
  'GET /v1/provider-embed/consultations': {auth: 'browser'; params: ProviderEmbedNoParams; query: ProviderEmbedConsultationsQuery; request: undefined; response: ProviderEmbedPage<ProviderEmbedConsultRow | ProviderEmbedAppointmentRow>};
  /** One authorized episode (`consult.read`). */
  'GET /v1/provider-embed/consultations/{kind}/{id}': {auth: 'browser'; params: ProviderEmbedConsultParams; query: undefined; request: undefined; response: ProviderEmbedConsultDetail};
  /** The episode transcript (`consult.read`). */
  'GET /v1/provider-embed/consultations/async/{id}/messages': {auth: 'browser'; params: ProviderEmbedIdParams; query: ProviderEmbedMessagesQuery; request: undefined; response: ProviderEmbedTranscriptPage};
  /** Reply as the current assignee (`consult.reply`, idempotent). */
  'POST /v1/provider-embed/consultations/async/{id}/replies': {auth: 'browser'; params: ProviderEmbedIdParams; query: undefined; request: ProviderEmbedReplyRequest; response: ProviderEmbedReplyResponse};
  /** Request resolution (`consult.complete`, idempotent). */
  'POST /v1/provider-embed/consultations/async/{id}/resolve': {auth: 'browser'; params: ProviderEmbedIdParams; query: undefined; request: ProviderEmbedResolveRequest; response: ProviderEmbedConsultStateResponse};
  /** Close the thread (`consult.complete`, idempotent). */
  'POST /v1/provider-embed/consultations/async/{id}/close': {auth: 'browser'; params: ProviderEmbedIdParams; query: undefined; request: ProviderEmbedNoParams; response: ProviderEmbedConsultStateResponse};
  /** Open an episode-bound upload slot (`attachments.write`). */
  'POST /v1/provider-embed/consultations/{kind}/{id}/uploads': {auth: 'browser'; params: ProviderEmbedConsultParams; query: undefined; request: ProviderEmbedUploadRequest; response: ProviderEmbedUploadSlot};
  /** Verify the stored bytes of an upload (`attachments.write`). */
  'POST /v1/provider-embed/consultations/{kind}/{id}/uploads/{uploadId}/finalize': {auth: 'browser'; params: ProviderEmbedConsultParams & {uploadId: string}; query: undefined; request: ProviderEmbedNoParams; response: ProviderEmbedFinalizedUpload};
  /** Short-lived grant for an episode file (`attachments.read`). */
  'GET /v1/provider-embed/consultations/{kind}/{id}/files/{fileId}': {auth: 'browser'; params: ProviderEmbedConsultParams & {fileId: string}; query: undefined; request: undefined; response: ProviderEmbedFileGrant};
  /** Allowed clinical actions and issued documents (`consult.read`). */
  'GET /v1/provider-embed/consultations/async/{id}/clinical-actions': {auth: 'browser'; params: ProviderEmbedIdParams; query: undefined; request: undefined; response: ProviderEmbedClinicalActions};
  /** Unsigned referral preview (`referrals.preview`). */
  'POST /v1/provider-embed/consultations/async/{id}/referrals/preview': {auth: 'browser'; params: ProviderEmbedIdParams; query: undefined; request: ProviderEmbedReferralRequest; response: ProviderEmbedReferralPreviewResponse};
  /** Sign and issue referrals (`referrals.issue`, idempotent). */
  'POST /v1/provider-embed/consultations/async/{id}/referrals': {auth: 'browser'; params: ProviderEmbedIdParams; query: undefined; request: ProviderEmbedReferralRequest; response: ProviderEmbedReferralIssueResponse};
  /** Unsigned prescription preview (`prescriptions.preview`, fax only). */
  'POST /v1/provider-embed/consultations/async/{id}/prescriptions/preview': {auth: 'browser'; params: ProviderEmbedIdParams; query: undefined; request: ProviderEmbedPrescriptionRequest; response: ProviderEmbedPdfPreview};
  /** Sign and issue a prescription (`prescriptions.issue`, fax only, idempotent). */
  'POST /v1/provider-embed/consultations/async/{id}/prescriptions': {auth: 'browser'; params: ProviderEmbedIdParams; query: undefined; request: ProviderEmbedPrescriptionRequest; response: ProviderEmbedPrescriptionIssueResponse};
  /** Join the call, or extend the media lease (`telehealth.join`). */
  'POST /v1/provider-embed/consultations/telehealth/{id}/room': {auth: 'browser'; params: ProviderEmbedIdParams; query: undefined; request: ProviderEmbedRoomRequest; response: ProviderEmbedRoomResponse};
  /** Signal readiness for a scheduled call (`telehealth.join`). */
  'POST /v1/provider-embed/consultations/telehealth/{id}/ready': {auth: 'browser'; params: ProviderEmbedIdParams; query: undefined; request: ProviderEmbedReadyRequest; response: ProviderEmbedReadyResponse};
  /** End the call explicitly (`telehealth.end`). */
  'POST /v1/provider-embed/consultations/telehealth/{id}/end': {auth: 'browser'; params: ProviderEmbedIdParams; query: undefined; request: ProviderEmbedEndRequest; response: ProviderEmbedEndResponse};
  /** Cancel an own appointment (`appointments.cancel`, idempotent). */
  'POST /v1/provider-embed/consultations/telehealth/{id}/cancel': {auth: 'browser'; params: ProviderEmbedIdParams; query: undefined; request: ProviderEmbedCancelRequest; response: ProviderEmbedAppointmentStateResponse};
  /** Join or leave the live rota (`presence.write`, workspace mode). */
  'POST /v1/provider-embed/presence': {auth: 'browser'; params: ProviderEmbedNoParams; query: undefined; request: ProviderEmbedPresenceRequest; response: ProviderEmbedPresenceResponse};
  /** Presence heartbeat (`presence.write`, workspace mode). */
  'POST /v1/provider-embed/heartbeat': {auth: 'browser'; params: ProviderEmbedNoParams; query: undefined; request: ProviderEmbedNoParams; response: ProviderEmbedPresenceResponse};
  /** Own async availability (`availability.write`, workspace mode). */
  'POST /v1/provider-embed/availability': {auth: 'browser'; params: ProviderEmbedNoParams; query: undefined; request: ProviderEmbedAvailabilityRequest; response: ProviderEmbedAvailabilityResponse};
  /** The session's patient (`patient.read`, patient mode). */
  'GET /v1/provider-embed/patient': {auth: 'browser'; params: ProviderEmbedNoParams; query: undefined; request: undefined; response: ProviderEmbedPatientView};
  /** The session's patient history (`patient.history.read`, patient mode). */
  'GET /v1/provider-embed/patient/history': {auth: 'browser'; params: ProviderEmbedNoParams; query: ProviderEmbedPatientHistoryQuery; request: undefined; response: ProviderEmbedPatientHistoryPage};
}
/** Any provider route key, e.g. `'GET /v1/provider-embed/workspace'`. */
export type ProviderEmbedRoute = keyof ProviderEmbedEndpoints;
/** The request body type of a provider route. */
export type ProviderEmbedRequestOf<R extends ProviderEmbedRoute> = ProviderEmbedEndpoints[R]['request'];
/** The query-string type of a provider route. */
export type ProviderEmbedQueryOf<R extends ProviderEmbedRoute> = ProviderEmbedEndpoints[R]['query'];
/** The path-parameter type of a provider route. */
export type ProviderEmbedParamsOf<R extends ProviderEmbedRoute> = ProviderEmbedEndpoints[R]['params'];
/** The success-response body type of a provider route. */
export type ProviderEmbedResponseOf<R extends ProviderEmbedRoute> = ProviderEmbedEndpoints[R]['response'];
/** The six session routes. */
export type ProviderEmbedSessionRoute =
  | 'POST /v1/provider-embed/sessions' | 'POST /v1/provider-embed/sessions/{sessionId}/renew'
  | 'DELETE /v1/provider-embed/sessions/{sessionId}' | 'GET /v1/provider-embed/session'
  | 'POST /v1/provider-embed/session/activity' | 'POST /v1/provider-embed/session/logout';
/** The five media and presence routes (disabled unless the deployment media flag is on). */
export type ProviderEmbedMediaRoute =
  | 'POST /v1/provider-embed/consultations/telehealth/{id}/room' | 'POST /v1/provider-embed/consultations/telehealth/{id}/ready'
  | 'POST /v1/provider-embed/consultations/telehealth/{id}/end' | 'POST /v1/provider-embed/presence'
  | 'POST /v1/provider-embed/heartbeat';
/** The two patient-mode routes. */
export type ProviderEmbedPatientRoute = 'GET /v1/provider-embed/patient' | 'GET /v1/provider-embed/patient/history';
/** Every other route: the clinical operations. */
export type ProviderEmbedClinicalRoute = Exclude<ProviderEmbedRoute, ProviderEmbedSessionRoute | ProviderEmbedMediaRoute | ProviderEmbedPatientRoute>;
/** Every route, runtime list (infra builds API Gateway resources from it; tests assert completeness). */
export const PROVIDER_EMBED_ROUTES = [
  'POST /v1/provider-embed/sessions',
  'POST /v1/provider-embed/sessions/{sessionId}/renew',
  'DELETE /v1/provider-embed/sessions/{sessionId}',
  'GET /v1/provider-embed/session',
  'POST /v1/provider-embed/session/activity',
  'POST /v1/provider-embed/session/logout',
  'GET /v1/provider-embed/workspace',
  'GET /v1/provider-embed/agenda',
  'GET /v1/provider-embed/consultations',
  'GET /v1/provider-embed/consultations/{kind}/{id}',
  'GET /v1/provider-embed/consultations/async/{id}/messages',
  'POST /v1/provider-embed/consultations/async/{id}/replies',
  'POST /v1/provider-embed/consultations/async/{id}/resolve',
  'POST /v1/provider-embed/consultations/async/{id}/close',
  'POST /v1/provider-embed/consultations/{kind}/{id}/uploads',
  'POST /v1/provider-embed/consultations/{kind}/{id}/uploads/{uploadId}/finalize',
  'GET /v1/provider-embed/consultations/{kind}/{id}/files/{fileId}',
  'GET /v1/provider-embed/consultations/async/{id}/clinical-actions',
  'POST /v1/provider-embed/consultations/async/{id}/referrals/preview',
  'POST /v1/provider-embed/consultations/async/{id}/referrals',
  'POST /v1/provider-embed/consultations/async/{id}/prescriptions/preview',
  'POST /v1/provider-embed/consultations/async/{id}/prescriptions',
  'POST /v1/provider-embed/consultations/telehealth/{id}/room',
  'POST /v1/provider-embed/consultations/telehealth/{id}/ready',
  'POST /v1/provider-embed/consultations/telehealth/{id}/end',
  'POST /v1/provider-embed/consultations/telehealth/{id}/cancel',
  'POST /v1/provider-embed/presence',
  'POST /v1/provider-embed/heartbeat',
  'POST /v1/provider-embed/availability',
  'GET /v1/provider-embed/patient',
  'GET /v1/provider-embed/patient/history',
] as const satisfies readonly ProviderEmbedRoute[];

// ------------------------------------------------------------------ errors

/** Every error code a provider route can answer with. */
export const PROVIDER_EMBED_ERROR_CODES = [
  'invalid_request', 'cursor_invalid', 'unauthorized', 'provider_session_invalid', 'provider_session_expired',
  'provider_session_ended', 'provider_session_revoked', 'provider_session_locked', 'clinician_proof_invalid',
  'forbidden', 'origin_not_allowed', 'provider_embed_disabled', 'delegation_not_allowed', 'clinician_unavailable',
  'capability_not_granted', 'operation_not_available', 'not_found', 'thread_not_active', 'request_thread',
  'not_assigned', 'already_closed', 'message_rejected', 'consult_not_cancellable', 'idempotency_conflict',
  'idempotency_in_progress', 'lease_conflict', 'renew_conflict', 'prescriber_not_eligible', 'upload_rejected',
  'rate_limited', 'internal_error', 'dependency_unavailable',
] as const satisfies readonly ErrorCode[];
/** An error code of the provider routes. */
export type ProviderEmbedErrorCode = (typeof PROVIDER_EMBED_ERROR_CODES)[number];
/** 401 codes the loader answers by renewing (same session). */
export const PROVIDER_EMBED_RENEWABLE_CODES = ['provider_session_expired'] as const satisfies readonly ProviderEmbedErrorCode[];
/** 401/403 codes that end the logical session (loader re-mints only after a user gesture, or stops). */
export const PROVIDER_EMBED_TERMINAL_CODES = [
  'provider_session_invalid', 'provider_session_ended', 'provider_session_revoked', 'provider_session_locked',
  'provider_embed_disabled',
] as const satisfies readonly ProviderEmbedErrorCode[];
/** One validation issue: the field path and a machine-readable issue code (no input echo). */
export interface ProviderEmbedValidationIssue {
  /** Path to the offending field. */
  path: Array<string | number>;
  /** Issue code. */
  code: string;
}
/** Structured, data-free details of a provider error. */
export type ProviderEmbedErrorDetails =
  | {issues: ProviderEmbedValidationIssue[]}
  | {unavailable: ProviderEmbedUnavailableCapability[]}
  | {capability: ProviderEmbedCapability}
  | {draftCode: string}
  | {reason: string};
/** The JSON body of every provider error response. `message` is a fixed safe string per code. */
export interface ProviderEmbedApiError {
  /** The error. */
  error: {
    code: ProviderEmbedErrorCode;
    message: string;
    requestId: string;
    retryAfterSeconds?: number;
    details?: ProviderEmbedErrorDetails;
  };
}

// ------------------------------------------------ element, events, protocol

/** Color scheme; `auto` follows `prefers-color-scheme`. */
export type ProviderEmbedTheme = 'light' | 'dark' | 'auto';
/** UI locale of the provider frame. */
export type ProviderEmbedLocale = 'en' | 'es' | 'de' | 'fr' | 'it';
/** Layout density. */
export type ProviderEmbedDensity = 'comfortable' | 'compact';
/** Presentation settings; validated and applied in place. */
export interface ProviderEmbedPresentation {
  /** Color scheme. */
  theme?: ProviderEmbedTheme;
  /** UI locale. */
  locale?: ProviderEmbedLocale;
  /** `#rgb` or `#rrggbb` only. */
  accent?: string;
  /** Integer px 0–24. */
  radius?: number;
  /** Layout density. */
  density?: ProviderEmbedDensity;
}
/** Kebab-case element attributes; any change is applied in place (never reloads the frame). */
export interface ProviderEmbedAttributes {
  /** Color scheme. */
  theme?: ProviderEmbedTheme;
  /** UI locale. */
  locale?: ProviderEmbedLocale;
  /** `#rgb` or `#rrggbb` only. */
  accent?: string;
  /** Integer px 0–24, as an attribute string. */
  radius?: string;
  /** Layout density. */
  density?: ProviderEmbedDensity;
}
/** Every state of the element's lifecycle machine. */
export const PROVIDER_EMBED_LIFECYCLE_STATES = [
  'disconnected', 'bootstrapping', 'authenticating', 'ready', 'renewing', 'locked', 'revoked', 'failed',
] as const;
/** A lifecycle state of `<natzar-provider>`. */
export type ProviderEmbedLifecycleState = (typeof PROVIDER_EMBED_LIFECYCLE_STATES)[number];
/** A view inside the session's grant. Navigation never alters the grant. */
export type ProviderEmbedNavigationTarget =
  | {view: 'workspace'}
  | {view: 'consultation'; kind: ProviderEmbedConsultKind; consultationId: string}
  | {view: 'patient'; patientId: string};
/** Accepted by navigate(): the plan's shapes are normalized to ProviderEmbedNavigationTarget by the loader. */
export type ProviderEmbedNavigationInput =
  | ProviderEmbedNavigationTarget
  | {kind: ProviderEmbedConsultKind; consultationId: string}
  | {patientId: string};
/** Structural subset of `AbortSignal` (the contract is DOM-free). */
export interface ProviderEmbedAbortSignalLike {
  /** The request was cancelled. */
  readonly aborted: boolean;
  /** Subscribe to cancellation. */
  addEventListener(type: 'abort', listener: () => void): void;
  /** Unsubscribe from cancellation. */
  removeEventListener(type: 'abort', listener: () => void): void;
}
/** What the loader passes to your `getSession` callback. */
export interface ProviderEmbedSessionRequest {
  /** null → mint a new logical session; a value → renew exactly this session. */
  sessionId: string | null;
  /** Why a session is needed. */
  reason: 'initial' | 'renew' | 'reconnect';
  /** Aborted when the element no longer needs the answer. */
  signal: ProviderEmbedAbortSignalLike;
}
/** Options of `connect()`. */
export interface ProviderEmbedConnectOptions {
  /** Calls YOUR server, which mints or renews with its API key and returns the grant. */
  getSession: (request: ProviderEmbedSessionRequest) => Promise<ProviderEmbedSessionGrant>;
}
/** Outcome of `navigate()`. */
export type ProviderEmbedNavigateResult = {ok: true} | {ok: false; reason: 'out_of_scope' | 'dirty' | 'not_connected' | 'invalid_target'};
/** Outcome of `canLeave()`; carries no draft or clinical content. */
export interface ProviderEmbedCanLeaveResult {
  /** Leaving loses nothing. */
  canLeave: boolean;
  /** Unsaved work exists. */
  dirty: boolean;
  /** A call is active. */
  inCall: boolean;
}
/** Outcome of `logout()`. */
export interface ProviderEmbedLogoutResult {
  /** The server acknowledged the revocation. */
  revoked: boolean;
}
/** Methods of `<natzar-provider>`. */
export interface ProviderEmbedElementApi {
  /** Establish the authenticated connection. */
  connect(options: ProviderEmbedConnectOptions): Promise<void>;
  /** Select a view within the current grant. */
  navigate(target: ProviderEmbedNavigationInput): Promise<ProviderEmbedNavigateResult>;
  /** Manual renewal with a grant of the SAME logical session. */
  refresh(grant: ProviderEmbedSessionGrant): Promise<void>;
  /** Report dirty-work and active-call state. */
  canLeave(): Promise<ProviderEmbedCanLeaveResult>;
  /** Release this instance (not a logout). */
  disconnect(): void;
  /** Revoke the session, lock and clear the UI. */
  logout(): Promise<ProviderEmbedLogoutResult>;
  /** Current lifecycle state. */
  readonly state: ProviderEmbedLifecycleState;
}

/** Error codes the loader and frame raise themselves (reported in `natzar:provider:error`). */
export const PROVIDER_EMBED_CLIENT_ERROR_CODES = [
  'handshake_timeout', 'protocol_mismatch', 'origin_rejected', 'frame_url_rejected', 'api_url_mismatch',
  'session_callback_failed', 'session_grant_invalid', 'session_mismatch', 'session_unavailable', 'not_connected',
  'already_connected', 'navigation_refused', 'media_permission_denied', 'network_error', 'server_error',
  'session_expired', 'session_locked', 'session_revoked', 'embed_disabled', 'connect_aborted',
  'media_admission_failed',
] as const;
/** A client-side error code. */
export type ProviderEmbedClientErrorCode = (typeof PROVIDER_EMBED_CLIENT_ERROR_CODES)[number];

/** Names of the element's DOM events, without the prefix. */
export const PROVIDER_EMBED_EVENT_NAMES = [
  'ready', 'error', 'expired', 'unread-change', 'navigation-request', 'consultation-completed',
  'call-state-change', 'dirty-state-change', 'disconnected',
] as const;
/** A provider event name, without the prefix. */
export type ProviderEmbedEventName = (typeof PROVIDER_EMBED_EVENT_NAMES)[number];
/** `detail` of each DOM event: ids, counts and states only — never names, clinical text, URLs or tokens. */
export interface ProviderEmbedEventDetailMap {
  /** The session is authenticated and the UI is live. */
  ready: {sessionId: string; mode: ProviderEmbedMode; protocolVersion: typeof PROVIDER_EMBED_PROTOCOL_VERSION};
  /** Something failed; `recoverable` says whether the element will retry. */
  error: {code: ProviderEmbedClientErrorCode; recoverable: boolean; correlationId?: string};
  /** The session expired, locked or was revoked. */
  expired: {reason: 'access' | 'absolute' | 'idle' | 'revoked'};
  /** Workspace unread count changed (workspace mode only). */
  'unread-change': {count: number};
  /** The frame asks the host to navigate. */
  'navigation-request': {target: ProviderEmbedNavigationTarget};
  /** A consultation reached a completion outcome. */
  'consultation-completed': {kind: ProviderEmbedConsultKind; consultationId: string; outcome: 'resolved' | 'closed' | 'ended' | 'cancelled'};
  /** Call state changed. */
  'call-state-change': {consultationId: string; state: 'idle' | 'connecting' | 'in_call' | 'reconnecting' | 'ended'};
  /** Unsaved-work state changed. */
  'dirty-state-change': {dirty: boolean};
  /** The element disconnected. */
  disconnected: {reason: 'host' | 'logout' | 'revoked' | 'protocol_error' | 'failed'};
}
/** Full DOM event name, e.g. `natzar:provider:ready`. */
export type ProviderEmbedDomEventName = `${typeof PROVIDER_EMBED_DOM_EVENT_PREFIX}${ProviderEmbedEventName}`;

/** Fields every protocol message carries. */
export interface ProviderEmbedMessageBase {
  /** Always {@link PROVIDER_EMBED_PROTOCOL}. */
  protocol: typeof PROVIDER_EMBED_PROTOCOL;
  /** Always {@link PROVIDER_EMBED_PROTOCOL_VERSION}. */
  version: typeof PROVIDER_EMBED_PROTOCOL_VERSION;
  /** Channel nonce generated by the loader; 32 random bytes base64url. */
  channel: string;
}
/** Loader → frame; contains nothing secret. */
export type ProviderEmbedHello = ProviderEmbedMessageBase & {kind: 'hello'; loaderVersion: string};
/** Frame → loader, targeted at the exact observed origin of `hello`. */
export type ProviderEmbedHelloAck = ProviderEmbedMessageBase & {kind: 'hello-ack'; frameVersion: string; apiUrl: string};
/** Payload of each host → frame command. */
export interface ProviderEmbedHostCommandMap {
  /** The initial session grant. */
  session: {grant: ProviderEmbedSessionGrant};
  /** A renewed grant of the same session. */
  renewed: {grant: ProviderEmbedSessionGrant};
  /** `getSession` failed. */
  'session-error': {code: ProviderEmbedClientErrorCode};
  /** Navigate within the grant. */
  navigate: {target: ProviderEmbedNavigationTarget};
  /** Apply presentation settings in place. */
  presentation: ProviderEmbedPresentation;
  /** Ask for dirty/in-call state. */
  'can-leave': Record<string, never>;
  /** Revoke the session. */
  logout: Record<string, never>;
  /** Dispose of everything before removal. */
  teardown: Record<string, never>;
}
/** A host → frame command name. */
export type ProviderEmbedHostCommandName = keyof ProviderEmbedHostCommandMap;
/** A host → frame command envelope. */
export type ProviderEmbedCommand = {
  [K in ProviderEmbedHostCommandName]: ProviderEmbedMessageBase & {kind: 'command'; command: K; requestId: string; payload: ProviderEmbedHostCommandMap[K]};
}[ProviderEmbedHostCommandName];
/** Result carried by a successful reply. */
export type ProviderEmbedReplyResult = ProviderEmbedNavigateResult | ProviderEmbedCanLeaveResult | ProviderEmbedLogoutResult | {accepted: true};
/** Frame → loader answer to a command. */
export type ProviderEmbedReply = ProviderEmbedMessageBase & {kind: 'reply'; requestId: string} &
  ({ok: true; result: ProviderEmbedReplyResult} | {ok: false; error: ProviderEmbedClientErrorCode});
/** Frame → loader: ask the loader to run `getSession` (renewal or reconnect after an idle lock). */
export type ProviderEmbedFrameRequest = ProviderEmbedMessageBase & {
  kind: 'request'; request: 'need-session'; requestId: string; payload: {reason: 'renew' | 'reconnect'; sessionId: string | null};
};
/** Frame → loader event envelope, re-dispatched as a DOM event. */
export type ProviderEmbedFrameEvent = {
  [E in ProviderEmbedEventName]: ProviderEmbedMessageBase & {kind: 'event'; event: E; detail: ProviderEmbedEventDetailMap[E]};
}[ProviderEmbedEventName];
/** Any loader → frame message. */
export type ProviderEmbedLoaderToFrameMessage = ProviderEmbedHello | ProviderEmbedCommand;
/** Any frame → loader message. */
export type ProviderEmbedFrameToLoaderMessage = ProviderEmbedHelloAck | ProviderEmbedReply | ProviderEmbedFrameRequest | ProviderEmbedFrameEvent;

/** JSON embedded by the dynamic shell in `<script type="application/json" id="natzar-provider-config">`. */
export interface ProviderEmbedFrameConfig {
  /** Config format version. */
  v: 1;
  /** The partner the frame belongs to. */
  partnerId: string;
  /** Exact parent origins approved by the partner's policy. */
  allowedParentOrigins: string[];
  /** Deployment-owned provider API base URL. */
  apiUrl: string;
  /** Deployment environment. */
  environment: string;
  /** Residency zone. */
  zone: string;
  /** Protocol version the frame speaks. */
  protocolVersion: typeof PROVIDER_EMBED_PROTOCOL_VERSION;
  /** Version of the asset set the shell loaded. */
  assetVersion: string;
  /** The deployment media flag. */
  mediaEnabled: boolean;
  /** Per-response nonce for runtime-injected `<style>` elements (Radix scroll lock); pass to `get-nonce`'s `setNonce`. */
  styleNonce: string;
}
