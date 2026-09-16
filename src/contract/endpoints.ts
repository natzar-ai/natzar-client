// GENERATED FILE — do not edit.
//
// Copied verbatim from provider-portal's shared/partner-api by
// scripts/sync-contract.mjs. Edit the source there; this copy exists only so
// the published package is self-contained.
/**
 * Route-by-route contract of the Natzar Partner API — every endpoint's
 * request and response type, plus the machine-readable {@link Endpoints}
 * route table.
 *
 * ## Base URL & auth
 *
 * All routes live under `/v1` and require your API key on every request:
 *
 * ```
 * Authorization: Bearer pp_live_…   (or pp_test_… outside production)
 * ```
 *
 * Keys are shown once at mint/rotate and stored hashed on our side. After a
 * rotation the previous key keeps working for a 24-hour grace period. A
 * missing/invalid/suspended key yields `401 unauthorized`.
 *
 * ## Acting as a physician
 *
 * The key proves which APPLICATION is calling. Routes that act AS a clinician
 * — replying on a thread, going on the video rota, taking a call — need to
 * know which PERSON, and accept any ONE of three credentials, listed from
 * strongest to weakest:
 *
 * | credential | how | attestation |
 * |---|---|---|
 * | Cognito ID token | `X-Natzar-Physician: <id token>` + your key | **proven** — the clinician signed in to us |
 * | Physician session token | `Authorization: Bearer <session>` (INSTEAD of the key) | **session** — you exchanged your own login for it via `POST /v1/physicians/{id}/session`; browser-safe |
 * | Asserted id | `X-Natzar-Physician-Id: <physician id>` + your key | **asserted** — your server vouches; refused with `403 forbidden` when your account has assertion switched off |
 *
 * A session token is what a clinician's BROWSER should hold: minted by your
 * backend after your own authentication (single sign-on by token exchange),
 * short-lived, invalidated by a key rotation, and restricted to the
 * physician-side routes — the ones marked "physician session" below.
 * Anything else answers `403 forbidden` to a session; keep the key on your
 * server for those.
 *
 * Wherever a route takes `/v1/physicians/{id}/…` (and on
 * `GET /v1/physicians/{id}`), `{id}` may be the literal `me`, resolving to
 * the acting physician — `401 unauthorized` when no physician credential
 * is present. Presence, heartbeat, availability and the session-scoped
 * schedule/licence/specialty/language writes are SELF-ONLY: with a physician
 * credential the addressed physician must be the acting one. The key alone
 * (no physician credential) keeps its administrative reach over every
 * physician of the tenant for schedule, licences, specialties and languages.
 *
 * A body `physicianId` on the older routes (`replies`, `claim`, `takeover`,
 * `resolve`) is only a cross-check: it must equal the resolved actor or the
 * request is `400 invalid_request`.
 *
 * ## Idempotency
 *
 * - `POST /v1/patients` is an UPSERT keyed on `externalId`: repeating the
 *   call updates the mutable fields, never duplicates. Safe to retry.
 * - `POST /v1/physicians` is idempotent only for an IDENTICAL repeat: the
 *   same `externalId` with the same `email` (case-insensitive) returns 200
 *   and refreshes the names — a retry after a network failure is therefore
 *   safe. Repeating an `externalId` with a DIFFERENT email is refused with
 *   `409 external_id_conflict` (the portal account is keyed by email; email
 *   changes are not supported over the API), and a NEW `externalId` whose
 *   email already backs a portal account gets `409 email_in_use`. Either
 *   way, never a duplicate account.
 * - Message/reply posts are accepted with **202** and deduplicated inside a
 *   per-patient FIFO pipeline; the response's `messageId` is the id the
 *   message will carry on the transcript and in webhooks.
 * - Consult lifecycle posts (claim/takeover/resolve/close/cancel) are
 *   conditional writes: a retry that finds the work already done gets a
 *   descriptive `409` (`already_closed`, `not_assigned`, …), never a
 *   double-application.
 *
 * ## 202 semantics of message posts
 *
 * `POST …/messages` and `POST …/replies` return `202 Accepted`: the message
 * is validated, enqueued, and WILL appear on the transcript in order — but
 * had not yet been processed when the response was sent. Delivery is
 * observable via the `async_consult.message` webhook (or by re-reading the
 * messages endpoint). If the thread closes before an accepted patient
 * message processes, an `async_consult.message_rejected` webhook fires — an
 * accepted message is never silently dropped.
 *
 * ## Pagination
 *
 * List endpoints take an optional `cursor` + `limit` (1–100) and return a
 * {@link Page}: `{items, nextCursor?}`. Follow `nextCursor` until absent.
 * Cursors are opaque and endpoint-specific.
 *
 * ## Path parameters
 *
 * `{id}` in a route key is always OUR id of the addressed resource (the
 * `id` field of the corresponding resource). Endpoints that accept your ids
 * instead do so explicitly via `externalId`/`externalPatientId` parameters.
 *
 * @packageDocumentation
 */

import type {
  AsyncConsultResource,
  IsoDateTime,
  MessageResource,
  Page,
  PartnerEventResource,
  PatientResource,
  PhysicianPresence,
  PhysicianResource,
  PhysicianWorkspace,
  TelehealthConsultResource,
  TelehealthStatus,
} from './resources';
import type {
  CancelTelehealthConsultRequest,
  ClaimAsyncConsultRequest,
  CloseAsyncConsultRequest,
  CreateAsyncConsultRequest,
  CreateEmbedSessionRequest,
  CreatePhysicianRequest,
  CreatePhysicianSessionRequest,
  CreateTelehealthConsultRequest,
  CreateAgentEmbedSessionRequest,
  CreateUploadUrlsRequest,
  EndTelehealthConsultRequest,
  EscalateAsyncConsultRequest,
  GetPatientStateQuery,
  JoinTelehealthConsultRequest,
  ListAgentMessagesQuery,
  ListAsyncConsultsQuery,
  ListAsyncMessagesQuery,
  ListEventsQuery,
  ListPatientsQuery,
  ListPhysiciansQuery,
  ListTelehealthConsultsQuery,
  PhysicianAgendaQuery,
  PhysicianHeartbeatRequest,
  PostAgentMessageRequest,
  PostAsyncMessageRequest,
  PostAsyncReplyRequest,
  RateAsyncConsultRequest,
  RateTelehealthConsultRequest,
  ResolveAsyncConsultRequest,
  RespondAsyncConsentRequest,
  SetPhysicianAvailabilityRequest,
  SetPhysicianPresenceRequest,
  SetPhysicianScheduleRequest,
  UpdatePhysicianScheduleRequest,
  PhysicianScheduleQuery,
  SetPhysicianLicensesRequest,
  SetPhysicianSpecialtiesRequest,
  SetPhysicianLanguagesRequest,
  PhysicianLicenseInput,
  BookTelehealthConsultRequest,
  ListTelehealthSlotsQuery,
  TakeoverAsyncConsultRequest,
  TelehealthReadyRequest,
  TelehealthRoomRequest,
  UpdatePatientRequest,
  UpsertPatientRequest,
} from './schemas';
import type {ResolvedDay, ScheduleException, ScheduleRule} from './schedule';

// The request types are z.infer'd from ./schemas so the documented contract
// and the runtime validation are one artifact; re-export them here so the
// endpoint module is self-contained for readers of the API reference.
export type {
  CancelTelehealthConsultRequest,
  ClaimAsyncConsultRequest,
  CloseAsyncConsultRequest,
  CreateAgentEmbedSessionRequest,
  CreateAsyncConsultRequest,
  CreateEmbedSessionRequest,
  CreatePhysicianRequest,
  CreatePhysicianSessionRequest,
  CreateTelehealthConsultRequest,
  CreateUploadUrlsRequest,
  EndTelehealthConsultRequest,
  EscalateAsyncConsultRequest,
  GetPatientStateQuery,
  JoinTelehealthConsultRequest,
  BookTelehealthConsultRequest,
  ListTelehealthSlotsQuery,
  SetPhysicianScheduleRequest,
  UpdatePhysicianScheduleRequest,
  PhysicianScheduleQuery,
  SetPhysicianLicensesRequest,
  SetPhysicianSpecialtiesRequest,
  SetPhysicianLanguagesRequest,
  PhysicianLicenseInput,
  ListAgentMessagesQuery,
  ListAsyncConsultsQuery,
  ListAsyncMessagesQuery,
  ListEventsQuery,
  ListPatientsQuery,
  ListPhysiciansQuery,
  ListTelehealthConsultsQuery,
  PhysicianAgendaQuery,
  PhysicianHeartbeatRequest,
  PostAgentMessageRequest,
  PostAsyncMessageRequest,
  PostAsyncReplyRequest,
  RateAsyncConsultRequest,
  RateTelehealthConsultRequest,
  ResolveAsyncConsultRequest,
  RespondAsyncConsentRequest,
  SetPhysicianAvailabilityRequest,
  SetPhysicianPresenceRequest,
  TakeoverAsyncConsultRequest,
  TelehealthReadyRequest,
  TelehealthRoomRequest,
  UpdatePatientRequest,
  UpsertPatientRequest,
};

// ---------------------------------------------------------------------------
// Patients
// ---------------------------------------------------------------------------

/**
 * `POST /v1/patients` response. `created` distinguishes a fresh row from an
 * upsert that updated an existing one.
 */
export interface UpsertPatientResponse {
  /** The patient after the write. */
  patient: PatientResource;
  /** True when this call created the patient; false when it updated one. */
  created: boolean;
}

/** `GET /v1/patients/{id}` response. */
export interface GetPatientResponse {
  patient: PatientResource;
}

/**
 * `GET /v1/patients` response. With `?externalId=` the page holds zero or
 * one item; without it, the whole tenant pages by creation order.
 */
export type ListPatientsResponse = Page<PatientResource>;

/** `PATCH /v1/patients/{id}` response. */
export interface UpdatePatientResponse {
  /** The patient after the update. */
  patient: PatientResource;
}

// ---------------------------------------------------------------------------
// Physicians
// ---------------------------------------------------------------------------

/** `POST /v1/physicians` response. */
export interface CreatePhysicianResponse {
  /** The freshly created physician. */
  physician: PhysicianResource;
}

/** `GET /v1/physicians/{id}` response. */
export interface GetPhysicianResponse {
  physician: PhysicianResource;
}

/** `GET /v1/physicians` response. */
export type ListPhysiciansResponse = Page<PhysicianResource>;

/**
 * `POST /v1/physicians/{id}/portal-invite` response. (Re-)sends the portal
 * invitation email to the physician's sign-in address.
 */
export interface SendPortalInviteResponse {
  /** Always true on success — the invite email was handed to delivery. */
  sent: true;
}

/** `POST /v1/physicians/{id}/availability` response. */
export interface SetPhysicianAvailabilityResponse {
  /** The physician after the toggle. */
  physician: PhysicianResource;
}

/**
 * `POST /v1/physicians/{id}/session` response — a physician session token
 * and everything a browser client needs to use it. Hand the whole object to
 * `connectPhysician` from `@natzar/client/physician` and it is
 * self-configuring.
 */
export interface CreatePhysicianSessionResponse {
  /**
   * The session token: send it as `Authorization: Bearer <sessionToken>` on
   * the physician-side routes. Browser-safe — it names one physician, expires,
   * and can do nothing your key could not have let that physician do.
   */
  sessionToken: string;
  /** When the token expires; re-mint before then (2 minutes early is plenty). */
  expiresAt: IsoDateTime;
  /**
   * The base URL of THIS API (through `/v1`, no trailing slash) as seen from
   * the request — returned per mint, like the embed mints return their
   * transport, so a browser bundle never bakes in a host that may move.
   */
  apiUrl: string;
  /** The physician the session was minted for. */
  physician: PhysicianResource;
}

/**
 * Response of `POST /v1/physicians/{id}/presence` and
 * `POST /v1/physicians/{id}/heartbeat`: the presence after the write, plus
 * the consult the physician is now on or being rung for — because going
 * `ready` (and every beat while ready) retries the match, and a match is the
 * thing the caller wants to hear about first.
 */
export interface PresenceResponse {
  /** The physician's live-queue presence after the write. */
  presence: PhysicianPresence;
  /**
   * This physician's `ringing` or `in_progress` consult after the match
   * attempt, or null when idle. `in_progress` → call `/room` for the grant;
   * `ringing` → keep polling the workspace until the patient confirms.
   */
  activeConsult: TelehealthConsultResource | null;
}

/** `GET /v1/physicians/{id}/workspace` response — see `PhysicianWorkspace`. */
export type GetPhysicianWorkspaceResponse = PhysicianWorkspace;

/** `GET /v1/physicians/{id}/agenda` response. */
export interface GetPhysicianAgendaResponse {
  /**
   * The physician's booked appointments in the window, soonest first: rows
   * that still hold a time (`scheduled`, `waiting`, `in_progress`) — a
   * cancelled or missed appointment releases its slot and is no longer on
   * the agenda. Each row's `scheduledAt` is an instant; render it in
   * `timezone`, and show the patient's own clock from its `patientTimezone`
   * when that differs.
   */
  appointments: TelehealthConsultResource[];
  /**
   * The zone to render this agenda in: the physician's calendar zone
   * (`schedulingTimezone`, else the clinic's). Label the times with it.
   */
  timezone: string;
}

/** One of the tenant's specialties, as `GET /v1/specialties` lists them. */
export interface SpecialtyResource {
  /**
   * Stable machine identifier, lowercase kebab — what goes on consults,
   * physicians and the agent's triage. Never changes once in use; `name` is
   * what gets renamed.
   */
  slug: string;
  /** Display name. */
  name: string;
  /** Patient-facing one-liner, if the clinic wrote one. */
  description?: string;
  /**
   * Soft-deleted specialties are `false`: no longer offered to the agent or
   * to new bookings, still named on old consults. Absent means active.
   */
  active?: boolean;
  /**
   * THE catch-all: a physician holding it may take every consult of the
   * clinic, whatever it was triaged to — the general practitioner, and the
   * reason a clinic can route by specialty without stranding a patient whose
   * complaint fits no box.
   */
  catchAll?: boolean;
}

/** `GET /v1/specialties` response. */
export interface ListSpecialtiesResponse {
  /** The tenant's specialty catalogue, in the clinic's display order. */
  specialties: SpecialtyResource[];
}

/** `PUT /v1/physicians/{id}/specialties` response. */
export interface SetPhysicianSpecialtiesResponse {
  /** The physician after the replace — read `specialties` for what stuck. */
  physician: PhysicianResource;
}

/** `PUT /v1/physicians/{id}/languages` response. */
export interface SetPhysicianLanguagesResponse {
  /** The physician after the replace — `languages` is the list as stored. */
  physician: PhysicianResource;
}

// ---------------------------------------------------------------------------
// Patient state
// ---------------------------------------------------------------------------

/**
 * One modality's switches, as they apply to YOUR key on THIS tenant.
 *
 * Two questions, deliberately separated:
 *
 * - `live` / `book` — WHAT the clinic runs. `live` is a clinician engaging
 *   now (the video queue; a messaging thread picked up straight away);
 *   `book` is an appointment at a chosen time. A scenario the clinic doesn't
 *   run cannot be reached by anyone, in any way.
 * - `onDemand` — WHO may start it. With it off, the scenario exists but only
 *   the AI agent (or a clinician) offers it, on clinical judgement; a direct
 *   request — yours over REST, or the patient's in the embed — is refused
 *   with `on_demand_disabled`. With it on, the patient may ask.
 *
 * So `onDemandLive` / `onDemandBook` are the fields to branch on when the
 * question is "may I create one right now": they are already the AND of the
 * mode and the initiator switch.
 */
export interface ModalityCapabilities {
  /** A clinician engages now. Always false for `in_person`. */
  live: boolean;
  /** An appointment at a chosen time, from published availability. */
  book: boolean;
  /** The patient (or you, on their behalf) may ask for this unprompted. */
  onDemand: boolean;
  /** `live && onDemand` — a `live` create would be accepted. */
  onDemandLive: boolean;
  /** `book && onDemand` — a `book`/`scheduled` create would be accepted. */
  onDemandBook: boolean;
  /** `live || book` — the modality is reachable at all. */
  enabled: boolean;
}

/**
 * What this tenant is allowed to offer, so your UI can hide what isn't
 * enabled instead of discovering it through a `409 feature_disabled`.
 *
 * Always the EFFECTIVE answer: the tenant's own configuration AND your API
 * key's, ANDed together. A key can only narrow its tenant, never widen it,
 * so nothing here can claim more than a create would actually allow.
 */
export interface TenantCapabilities {
  /**
   * Whether async (messaging) consults exist on this tenant for this key —
   * i.e. `modalities.async.enabled`. This is the flag `feature_disabled`
   * answers to; whether YOU may create one on demand is
   * `modalities.async.onDemandLive`.
   */
  asyncEnabled: boolean;
  /**
   * Whether telehealth (video) consults exist on this tenant for this key —
   * i.e. `modalities.telehealth.enabled`. As above: `onDemandLive` (queue) and
   * `onDemandBook` (scheduled) are what a create is gated on.
   */
  telehealthEnabled: boolean;
  /**
   * The full matrix, per modality. Added after the two booleans above, which
   * remain present and correct — `/v1` only ever grows.
   *
   * `in_person` is the third modality (a real appointment at a clinic). It
   * has no `live` mode by definition and no creation endpoint on `/v1` yet;
   * it is published so a UI can already tell a patient the clinic sees people
   * in person.
   */
  modalities: {
    async: ModalityCapabilities;
    telehealth: ModalityCapabilities;
    in_person: ModalityCapabilities;
  };
}

/**
 * `GET /v1/patients/state` response — the whole patient-facing picture in
 * one call.
 *
 * Render straight from this: if `telehealthConsult` is present the patient
 * is in a call or waiting for one; else if `asyncConsult` is present a human
 * clinician owns the conversation (or is about to); else the agent chat is
 * the surface. `agentCursor` is the cursor to start polling
 * `GET /v1/agent/messages` from if you want only what's new.
 */
export interface GetPatientStateResponse {
  /** The patient record. */
  patient: PatientResource;
  /** The patient's OPEN async consult, if any (never a closed one). */
  asyncConsult?: AsyncConsultResource;
  /**
   * The patient's OPEN telehealth consult, if any — i.e. one still
   * `invited`, `waiting`, or `in_progress`.
   */
  telehealthConsult?: TelehealthConsultResource;
  /**
   * Cursor for the END of the agent conversation as of this read. Absent
   * when the patient has no conversation yet.
   */
  agentCursor?: string;
  /** What this tenant can offer. */
  capabilities: TenantCapabilities;
}

// ---------------------------------------------------------------------------
// Agent chat
// ---------------------------------------------------------------------------

/**
 * `202` response of `POST /v1/agent/messages`. The turn is enqueued, not yet
 * answered — poll `GET /v1/agent/messages` for the agent's reply (typically
 * a few seconds; longer when the patient sent a file to read).
 */
export interface PostAgentMessageResponse {
  /** Always true: validation passed and the turn was enqueued. */
  accepted: true;
  /**
   * Your handle on this submission. It comes back as the stored message's
   * {@link MessageResource.clientRef} (NOT its `id`, which we assign) — match
   * on it to reconcile an optimistically rendered message. It is also the
   * idempotency key: retrying a timed-out POST with the same body will not
   * enqueue the turn twice.
   */
  messageId: string;
}

/**
 * The envelope BOTH transcript endpoints return — the agent conversation
 * and an async consult's messages. One shape, one polling loop, whichever
 * you are reading.
 *
 * Deliberately not a {@link Page}: collections page, transcripts POLL.
 * `cursor` always marks the position after the last message you were given,
 * whether or not more exist — hold on to it and pass it back on every poll.
 * A poll with nothing new returns `items: []` and the same cursor, so you
 * never have to reason about which cursor is still valid. `hasMore` means
 * "fetch the next page now" rather than "wait for new activity".
 */
export interface TranscriptPage {
  /** The messages, oldest first. */
  items: MessageResource[];
  /**
   * Opaque position after the last returned message. Absent only when there
   * is nothing to read yet.
   */
  cursor?: string;
  /** True when more messages are already available — page again now. */
  hasMore: boolean;
}

/** `GET /v1/agent/messages` response. See {@link TranscriptPage}. */
export type ListAgentMessagesResponse = TranscriptPage;

// ---------------------------------------------------------------------------
// Async consults
// ---------------------------------------------------------------------------

/**
 * `POST /v1/async-consults` response.
 *
 * With `consent: 'collected'` the consult is already `queued` or `active`
 * (assignment is attempted synchronously). With `consent: 'embed'` it is
 * `invited` and `sessionToken` is present — render `<natzar-async
 * session-token="…">` to let the patient consent and chat.
 */
export interface CreateAsyncConsultResponse {
  /** The consult after creation (status reflects the consent mode). */
  consult: AsyncConsultResource;
  /**
   * Embed session token for the patient widget. Present when
   * `consent: 'embed'`; mint later/again via
   * `POST /v1/async-consults/{id}/embed-session`.
   */
  sessionToken?: string;
  /**
   * Present alongside `sessionToken`, for the same reason it is on the
   * `/embed-session` mints: hand this whole response to the browser half of
   * `@natzar/client` and it is self-configuring. See
   * {@link CreateEmbedSessionResponse.graphqlUrl}.
   */
  graphqlUrl?: string;
  /** Public transport key for the patient surface. Rotates; never bake it in. */
  publicApiKey?: string;
}

/** `GET /v1/async-consults/{id}` response. */
export interface GetAsyncConsultResponse {
  consult: AsyncConsultResource;
}

/** `GET /v1/async-consults` response, most recently active first. */
export type ListAsyncConsultsResponse = Page<AsyncConsultResource>;

/**
 * `GET /v1/async-consults/{id}/messages` response — the full transcript in
 * order (oldest first), including system lifecycle notices. Attachment
 * `url`s are freshly presigned and short-lived.
 */
export type ListAsyncMessagesResponse = TranscriptPage;

/**
 * `202` response of the message/reply posts. The message is enqueued, not
 * yet processed — see the module docs on 202 semantics.
 */
export interface PostAsyncMessageResponse {
  /** Always true: validation passed and the message was enqueued. */
  accepted: true;
  /** The id the message will carry on the transcript and in webhooks. */
  messageId: string;
}

/** `202` response of `POST /v1/async-consults/{id}/replies`. */
export type PostAsyncReplyResponse = PostAsyncMessageResponse;

/** `POST /v1/async-consults/{id}/claim` response. */
export interface ClaimAsyncConsultResponse {
  /** The consult after assignment (`status: 'active'`). */
  consult: AsyncConsultResource;
}

/** `POST /v1/async-consults/{id}/takeover` response. */
export interface TakeoverAsyncConsultResponse {
  /** The consult after reassignment. */
  consult: AsyncConsultResource;
}

/** `POST /v1/async-consults/{id}/resolve` response. */
export interface ResolveAsyncConsultResponse {
  /** The consult after the transition (`status: 'resolve_requested'`). */
  consult: AsyncConsultResource;
}

/** `POST /v1/async-consults/{id}/close` response. */
export interface CloseAsyncConsultResponse {
  /** The consult after closing (`closedReason` reflects the request's `reason`). */
  consult: AsyncConsultResource;
}

/** `POST /v1/async-consults/{id}/consent` response. */
export interface RespondAsyncConsentResponse {
  /**
   * The consult after the answer: `queued`/`active` on accept, `closed`
   * with `closedReason: 'declined'` on decline.
   */
  consult: AsyncConsultResource;
}

/**
 * `POST /v1/async-consults/{id}/escalate` response. The thread is closed
 * (`closedReason: 'escalated'`) and a telehealth consult now exists for the
 * same patient; the patient has been sent their join link.
 */
export interface EscalateAsyncConsultResponse {
  /** The thread after closing. */
  consult: AsyncConsultResource;
  /**
   * The telehealth consult opened for the patient — `invited` until they
   * follow the link. Go `ready` on the live queue to take it when they do.
   */
  telehealthConsultId: string;
}

/** `POST /v1/async-consults/{id}/rate` response. */
export interface RateAsyncConsultResponse {
  /** The consult, now carrying `rating` and with `rateable: false`. */
  consult: AsyncConsultResource;
  /** True when a rating already existed and this call changed nothing. */
  alreadyRated: boolean;
}

/**
 * Response of the `/embed-session` mints (both consult kinds): a fresh
 * session token for the consult's patient-facing embed widget.
 */
export interface CreateEmbedSessionResponse {
  /** The token to pass as the tag's `session-token` attribute. */
  sessionToken: string;
  /** When the token expires; re-mint and call `refresh(token)` before then. */
  expiresAt: IsoDateTime;
  /**
   * Where the patient-side surface lives, so a browser client is
   * SELF-CONFIGURING: hand this whole response to `@natzar/client`'s browser
   * half and it knows how to connect. Deliberately returned per-mint rather
   * than published as a constant — the key rotates (AppSync keys expire), and
   * a value baked into your bundle would break at a moment unrelated to
   * anything you shipped.
   *
   * Absent on older deployments; a client that does not see them should fall
   * back to relaying calls through your own server.
   */
  graphqlUrl?: string;
  /**
   * Public, browser-safe API key for the patient-side surface — the transport
   * credential only. The real credential is `sessionToken`, which is scoped to
   * one patient (and, for consult sessions, one consult). Publishable in the
   * same sense as a Stripe publishable key.
   */
  publicApiKey?: string;
}

/** One presigned upload slot in `POST /v1/attachments/upload-urls`'s response. */
export interface UploadUrlSlot {
  /** The staging key to reference in a subsequent message/reply post. */
  stagingKey: string;
  /** Presigned HTTPS PUT URL — upload the file bytes here. */
  uploadUrl: string;
  /** When the upload URL expires. */
  expiresAt: IsoDateTime;
}

/**
 * `POST /v1/attachments/upload-urls` response. Slots are returned in the
 * same order as the request's `files` array.
 */
export interface CreateUploadUrlsResponse {
  uploads: UploadUrlSlot[];
}

// ---------------------------------------------------------------------------
// Telehealth
// ---------------------------------------------------------------------------

/**
 * `POST /v1/telehealth-consults` response. The consult starts `invited`;
 * mint an embed session (`POST /v1/telehealth-consults/{id}/embed-session`)
 * and render `<natzar-telehealth>` for the patient to join.
 */
export interface CreateTelehealthConsultResponse {
  consult: TelehealthConsultResource;
}

/**
 * `GET /v1/telehealth-consults/{id}` response. `consult.recordingUrl`, when
 * present, is freshly presigned per read and short-lived.
 */
export interface GetTelehealthConsultResponse {
  consult: TelehealthConsultResource;
}

/** `GET /v1/telehealth-consults` response, newest first. */
export type ListTelehealthConsultsResponse = Page<TelehealthConsultResource>;

/** `POST /v1/telehealth-consults/{id}/cancel` response. */
export interface CancelTelehealthConsultResponse {
  /** The consult after cancellation (`status: 'cancelled'`). */
  consult: TelehealthConsultResource;
}

/** The credentials for joining the video room. Present only while `in_progress`. */
export interface LiveKitGrant {
  /** Short-lived room access token. */
  token: string;
  /** LiveKit server URL to connect to. */
  url: string;
  /** The room to join. */
  roomName: string;
}

/**
 * `POST /v1/telehealth-consults/{id}/join` response — what to render right
 * now, plus the credentials when the call is live.
 *
 * Drive your waiting-room screen entirely from `status`:
 * - `'waiting'` — show `position` / `estimatedMinutes` and keep heartbeating.
 * - `'in_progress'` — connect to `livekit.url` with `livekit.token`.
 * - `'completed'` / `'cancelled'` / `'no_show'` — the call is over; show the
 *   rating prompt when `rateable` is true.
 * - `'expired'` — the invite is no longer usable; ask your backend to create
 *   a new consult.
 */
export interface JoinTelehealthConsultResponse {
  /**
   * The consult's state after this heartbeat. `'expired'` is join-only — it
   * is not a stored {@link TelehealthStatus}.
   */
  status: TelehealthStatus | 'expired';
  /** 1-based place in the queue. Present while `waiting`. */
  position?: number;
  /** Rough wait in minutes, derived from `position`. Present while `waiting`. */
  estimatedMinutes?: number;
  /** Room credentials. Present only when `status` is `'in_progress'`. */
  livekit?: LiveKitGrant;
  /** Whether a rating can still be submitted for this consult. */
  rateable?: boolean;
}

/** `POST /v1/telehealth-consults/{id}/rate` response. */
export interface RateTelehealthConsultResponse {
  /** The consult after the rating. */
  consult: TelehealthConsultResource;
  /** True when a rating already existed and this call changed nothing. */
  alreadyRated: boolean;
}

// -- Physician side of a call -----------------------------------------------

/**
 * `POST /v1/telehealth-consults/{id}/room` response — the physician's way
 * into their call, keyed on the consult's state.
 *
 * - `'in_progress'` — `livekit` is present: connect and render the room.
 * - `'ringing'` — no grant yet; the patient's client is confirming. Keep
 *   polling the workspace (`telehealth.active`) and call again when it reads
 *   `in_progress`.
 * - terminal (`completed` / `cancelled` / `no_show`) — the call is over.
 */
export interface TelehealthRoomResponse {
  /** The consult's state as of this call. */
  status: TelehealthStatus;
  /** Room credentials. Present only when `status` is `'in_progress'`. */
  livekit?: LiveKitGrant;
  /** The consult, for the call panel's header. */
  consult: TelehealthConsultResource;
}

/**
 * `POST /v1/telehealth-consults/{id}/end` response. Ending puts the
 * physician straight back on the rota (unless `goOffline`) and re-runs the
 * match, so the NEXT patient can already be ringing by the time this returns.
 */
export interface EndTelehealthConsultResponse {
  /** The consult after ending (`status: 'completed'`, or unchanged if it already had). */
  consult: TelehealthConsultResource;
  /**
   * The consult now `ringing` for this physician, if the re-match found a
   * waiting patient; null otherwise (including whenever `goOffline` was set).
   */
  next: TelehealthConsultResource | null;
}

/**
 * Where a BOOKED appointment stands for the physician who opened it — the
 * `state` of `POST /v1/telehealth-consults/{id}/ready`. Discriminate on
 * `phase`; "the other side" is the patient.
 *
 * - `early` — the waiting room has not opened yet (it does at `opensAt`).
 * - `waiting` — the physician is present, the patient is not yet.
 * - `connecting` — both sides present; the call is being activated (the next
 *   read is `in_progress` with a grant).
 * - `in_progress` — the call is live.
 * - `missed` — the appointment window closed without a call.
 * - `closed` — the consult is in a terminal state (`status` says which).
 */
export type TelehealthAppointmentState =
  | {phase: 'early'; opensAt: IsoDateTime; startsAt: IsoDateTime}
  | {phase: 'waiting'; startsAt: IsoDateTime; otherSidePresent: false}
  | {phase: 'connecting'; startsAt: IsoDateTime; otherSidePresent: true}
  | {phase: 'in_progress'; startsAt: IsoDateTime | null}
  | {phase: 'missed'; startsAt: IsoDateTime}
  | {phase: 'closed'; status: TelehealthStatus};

/**
 * `POST /v1/telehealth-consults/{id}/ready` response — the appointment's
 * state after recording the physician's presence, plus the grant once the
 * call is live. Poll it every ~10 s while the physician is in the waiting
 * room; the moment `livekit` appears, connect.
 */
export interface TelehealthReadyResponse {
  /** Where the appointment stands. */
  state: TelehealthAppointmentState;
  /** Room credentials. Present once the call is `in_progress`. */
  livekit?: LiveKitGrant;
}

// -- Scheduled consultations (docs/SCHEDULED-CONSULTS.md) -------------------

/** One offerable appointment start. */
export interface TelehealthSlot {
  /** ISO instant of the start. This is the identity of a slot everywhere. */
  startsAt: IsoDateTime;
  /** ISO instant of the consultation's end, WITHOUT the tenant's buffer. */
  endsAt: IsoDateTime;
  /**
   * Local date in the response's `timezone` (the `timezone` you asked for,
   * else the clinic's) — the grouping key for a day grid. Never recompute it
   * from `startsAt`: a start near midnight files under a different day in a
   * different zone, and this one is already in the zone the grid is drawn in.
   */
  localDate: string;
  /**
   * Physicians who published this start and cover the consult's specialty.
   * Pass one back as `practitionerId` to pin it; omit and the platform picks
   * the least-loaded within the language tier — the patient's language
   * first, then English — which is what you want unless the patient chose a
   * person.
   */
  practitionerIds: string[];
  /**
   * Every language at least one of those physicians consults in, as base
   * codes in catalogue order (`./languages`) — so a grid can badge the times
   * that come with a French speaker. Absent when none of them has recorded
   * any. Which of them actually gets the booking is decided at `book` time
   * (the patient's language first, then English, then least loaded), never
   * by this list.
   */
  languages?: string[];
}

/**
 * A booked appointment, as every surface renders it. The instants are
 * absolute; the four zone fields say whose clock to show them on.
 */
export interface TelehealthAppointment {
  consultId: string;
  startsAt: IsoDateTime;
  endsAt: IsoDateTime;
  practitionerId?: string | null;
  practitionerName?: string | null;
  status: TelehealthStatus;
  /** Both sides may enter the waiting room from this instant. */
  waitingRoomOpensAt: IsoDateTime;
  /** Past this instant the PATIENT may no longer cancel; the clinic still can. */
  cancellableUntil: IsoDateTime;
  /**
   * The VIEWER's zone — the `timezone` (or `patientTimezone`) the request
   * carried, else the clinic's. Render `startsAt` in this one and label it;
   * an unlabelled appointment time is a support call.
   */
  timezone: string;
  /** The clinic's zone. */
  clinicTimezone: string;
  /**
   * The physician's calendar zone, once a physician is assigned; null before.
   * When its offset at `startsAt` differs from `timezone`'s, show the
   * physician's clock as a second line ("08:00 CEST for Dr Morin") — the
   * confirmation notices do the same.
   */
  physicianTimezone: string | null;
  /**
   * The zone the PATIENT booked from (`patientTimezone` on the booking call,
   * or the device zone of the booking surface), or null when none was sent —
   * notices then fall back to the clinic's zone.
   */
  patientTimezone: string | null;
}

/**
 * `GET /v1/telehealth-consults/{id}/slots` response. Three things to render:
 * group `slots` by `localDate`, label the grid with `timezone`, and — when it
 * is not the clinic's — say so with `clinicTimezone`.
 */
export interface ListTelehealthSlotsResponse {
  slots: TelehealthSlot[];
  /**
   * The zone this payload is expressed in: the `timezone` you asked for,
   * else the clinic's. Every `localDate`, and `nextFrom`, are in it. Show
   * it: an unlabelled appointment time is a support call.
   */
  timezone: string;
  /** The clinic's zone, for a "the clinic is in …" note when it differs from `timezone`. */
  clinicTimezone: string;
  /**
   * True when the window held more offers than one response carries and the
   * tail was dropped. Page: request again with `from = nextFrom`.
   */
  truncated: boolean;
  /**
   * When `truncated`, the local date (in `timezone`) of the first offer that
   * was dropped — the `from` of the next page. Null otherwise.
   */
  nextFrom: string | null;
  /** Length of one consultation, in minutes. */
  slotMinutes: number;
  /** How far ahead this tenant lets patients book. */
  bookingHorizonDays: number;
  /** Minutes before the start after which the patient may no longer cancel. */
  cancellationWindowMinutes: number;
  /** Minutes before the start at which the waiting room opens. */
  waitingRoomOpensMinutes: number;
  /** This consult's current appointment, when it already has one. */
  appointment?: TelehealthAppointment | null;
  /** The specialty this consult was routed to, if any. */
  specialty?: {slug: string; name: string; description?: string | null} | null;
  /**
   * The patient's language this grid was ranked for, as a base code (`fr`),
   * or null when unknown. With each slot's `languages`, what lets a grid say
   * "with a French-speaking physician" on the times where that is true. Says
   * nothing about who will be chosen — `book` ranks that.
   */
  patientLang: string | null;
  /**
   * True when NOBODY in the tenant covers this consult's specialty. Distinct
   * from an empty `slots`: that means "nothing published in this window", this
   * means "no amount of waiting will help" — say so rather than showing an
   * empty calendar.
   */
  noEligiblePhysicians: boolean;
}

/** `POST /v1/telehealth-consults/{id}/book` response. */
export interface BookTelehealthConsultResponse {
  /** The consult after booking. */
  consult: TelehealthConsultResource;
  /** The appointment just created (or moved). */
  appointment: TelehealthAppointment;
  /** True when this replaced an earlier time on the same consult. */
  rescheduled: boolean;
}

/**
 * One recurring availability window, as stored — {@link ScheduleRule} with
 * its server `id`. `weekday` is 0 = Sunday … 6 = Saturday in the schedule's
 * `timezone` (the physician's calendar zone); minutes are from local
 * midnight; `intervalWeeks` > 1 repeats every N weeks from the first
 * `weekday` on or after `effectiveFrom`.
 */
export type PhysicianScheduleRule = ScheduleRule & {id: string};

/**
 * One dated exception, as stored — {@link ScheduleException} with its server
 * `id`. `date`..`endDate` (inclusive) is the range it covers; both minute
 * fields absent = the whole of each day.
 */
export type PhysicianScheduleException = ScheduleException & {id: string};

/** `GET`/`PUT /v1/physicians/{id}/licenses` response. */
export interface GetPhysicianLicensesResponse {
  physicianId: string;
  licenses: PhysicianLicenseInput[];
  /**
   * Licences lapsing within 60 days. Surface these: an expired licence removes
   * a physician from the rota with no error anywhere, and the first symptom is
   * a patient being told nobody can see them.
   */
  expiringSoon: PhysicianLicenseInput[];
  /** Whether this tenant actually enforces licensure. False = recorded only. */
  licenseEnforcement: boolean;
}

/**
 * `GET`/`PUT`/`PATCH /v1/physicians/{id}/schedule` response: the stored
 * document plus its reading over the requested range.
 *
 * `rules` are always the physician's WHOLE rota. `exceptions` and `days` are
 * only those touching `from`..`to` (the query's range, clamped to
 * `MAX_SCHEDULE_RANGE_DAYS`; default today → `requiredThrough`) — page by
 * range to look further ahead. `days` is the engine's resolution of rules +
 * exceptions for every date of the range (`resolveDays` in `./schedule`), so
 * a surface can draw the calendar without running the engine itself.
 */
export interface GetPhysicianScheduleResponse {
  physicianId: string;
  rules: PhysicianScheduleRule[];
  exceptions: PhysicianScheduleException[];
  /** Resolved availability for each date of `from`..`to`. */
  days: ResolvedDay[];
  /** The range `exceptions` and `days` describe, inclusive local dates in `timezone`. */
  from: string;
  to: string;
  /** Today's local date in `timezone` — what "today" means on this calendar. */
  today: string;
  /**
   * The physician's EFFECTIVE calendar zone — `schedulingTimezone` when set,
   * else `clinicTimezone`. Every rule, exception, `day`, `from`/`to` and
   * `today` here is read in it; draw the calendar in it and label it.
   */
  timezone: string;
  /** The clinic's zone — what `timezone` falls back to. */
  clinicTimezone: string;
  /**
   * The zone this physician chose for their calendar, or null when they
   * follow the clinic (`timezone === clinicTimezone`). Set or clear it with
   * `timezone` on `PATCH /schedule` (`null` clears).
   */
  schedulingTimezone: string | null;
  /**
   * How many booked appointments this physician has ahead of them. For the
   * confirmation before a zone change: their rules keep their clock times,
   * these keep their instants and move to the new zone's clock on the
   * calendar — say so with the number.
   */
  upcomingAppointments: number;
  /** Consultation length, so a calendar can show how many appointments a window holds. */
  slotMinutes: number;
  /** How far ahead the tenant asks its physicians to publish. */
  scheduleHorizonDays: number;
  /** The date that horizon lands on. */
  requiredThrough: string;
  /**
   * The last date this physician actually covers without a gap, or null when
   * nothing is published. Compare with `requiredThrough` to tell a physician
   * their rota is short — the one number that matters to them.
   */
  coveredThrough: string | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * `GET /v1/events` response — the durable webhook replay log, oldest first.
 * Poll it as a substitute for webhooks, or to reconcile after downtime.
 */
export type ListEventsResponse = Page<PartnerEventResource>;

// ---------------------------------------------------------------------------
// The route table
// ---------------------------------------------------------------------------

/**
 * The machine-readable route table: every Partner API route mapped to its
 * request and response types.
 *
 * Keys are `METHOD /v1/path` with `{id}` marking the path parameter (always
 * our id of the addressed resource). For GET routes, `request` is the QUERY
 * shape; for body-carrying methods it is the JSON body. `undefined` means
 * the route takes no query/body.
 *
 * Useful for building typed clients:
 *
 * @example
 * ```ts
 * type Route = keyof Endpoints;
 * async function call<R extends Route>(
 *   route: R,
 *   args: {params?: Record<string, string>; request: Endpoints[R]['request']},
 * ): Promise<Endpoints[R]['response']> { …fetch with Authorization: Bearer pp_…  }
 * ```
 */
export interface Endpoints {
  // -- Patients ------------------------------------------------------------
  /** Upsert a patient by `externalId`. Idempotent. */
  'POST /v1/patients': {request: UpsertPatientRequest; response: UpsertPatientResponse};
  /** List patients, or look one up by `?externalId=`. */
  'GET /v1/patients': {request: ListPatientsQuery; response: ListPatientsResponse};
  /** Fetch one patient by our id. */
  'GET /v1/patients/{id}': {request: undefined; response: GetPatientResponse};
  /** Update the editable subset (never `phone`/`externalId`). */
  'PATCH /v1/patients/{id}': {request: UpdatePatientRequest; response: UpdatePatientResponse};
  /** Everything a patient-facing screen needs, in one call. */
  'GET /v1/patients/state': {request: GetPatientStateQuery; response: GetPatientStateResponse};

  // -- Physicians ----------------------------------------------------------
  /**
   * Create a physician + backing portal account. Identical repeat (same
   * `externalId` + same email) → 200, idempotent; same `externalId` with a
   * different email → `409 external_id_conflict`; new `externalId` with an
   * in-use email → `409 email_in_use`.
   */
  'POST /v1/physicians': {request: CreatePhysicianRequest; response: CreatePhysicianResponse};
  /** List physicians, or look one up by `?externalId=`. */
  'GET /v1/physicians': {request: ListPhysiciansQuery; response: ListPhysiciansResponse};
  /** Fetch one physician by our id, or `me` for the acting one. Physician session: `me` only. */
  'GET /v1/physicians/{id}': {request: undefined; response: GetPhysicianResponse};
  /** (Re-)send the portal invitation email. */
  'POST /v1/physicians/{id}/portal-invite': {request: undefined; response: SendPortalInviteResponse};
  /** Toggle async auto-assignment eligibility. Self-only with a physician credential. Physician session. */
  'POST /v1/physicians/{id}/availability': {
    request: SetPhysicianAvailabilityRequest;
    response: SetPhysicianAvailabilityResponse;
  };
  /**
   * Mint a physician SESSION token for browser-direct calls (see "Acting as a
   * physician"). Tenant key only — a session may not mint another (`403
   * forbidden`).
   */
  'POST /v1/physicians/{id}/session': {
    request: CreatePhysicianSessionRequest | undefined;
    response: CreatePhysicianSessionResponse;
  };
  /**
   * Go on/off the live video queue; `ready: true` matches immediately. Self-only.
   * Physician session.
   */
  'POST /v1/physicians/{id}/presence': {
    request: SetPhysicianPresenceRequest;
    response: PresenceResponse;
  };
  /**
   * Keep a `ready` physician on the rota — every 15 s, TTL 45 s. Self-only.
   * Physician session.
   */
  'POST /v1/physicians/{id}/heartbeat': {
    request: PhysicianHeartbeatRequest | undefined;
    response: PresenceResponse;
  };
  /**
   * The whole clinician screen in one read: presence, live queue, active
   * call, upcoming appointments, inbox. The polling target. Physician session.
   */
  'GET /v1/physicians/{id}/workspace': {request: undefined; response: GetPhysicianWorkspaceResponse};
  /** Booked appointments in a window (default now → +7 d, max 31 d). Physician session. */
  'GET /v1/physicians/{id}/agenda': {request: PhysicianAgendaQuery; response: GetPhysicianAgendaResponse};
  /**
   * Replace the specialties a physician covers (slugs from `GET /v1/specialties`;
   * unknown ones are dropped). Self-only with a physician credential. Physician
   * session.
   */
  'PUT /v1/physicians/{id}/specialties': {
    request: SetPhysicianSpecialtiesRequest;
    response: SetPhysicianSpecialtiesResponse;
  };
  /**
   * Replace the languages a physician consults in (base codes from
   * `./languages`; a full locale such as `fr_CH` is `400 invalid_request`).
   * A ranked routing preference, never a filter — a physician with none
   * recorded still receives consults, last. Self-only with a physician
   * credential. Physician session.
   */
  'PUT /v1/physicians/{id}/languages': {
    request: SetPhysicianLanguagesRequest;
    response: SetPhysicianLanguagesResponse;
  };
  /** The tenant's specialty catalogue. Physician session. */
  'GET /v1/specialties': {request: undefined; response: ListSpecialtiesResponse};

  // -- Agent chat ----------------------------------------------------------
  /**
   * Send a patient turn to the AI agent (202, FIFO-enqueued). Answered by
   * the agent unless a human clinician already owns an open consult for this
   * patient, in which case the turn is routed to them.
   */
  'POST /v1/agent/messages': {request: PostAgentMessageRequest; response: PostAgentMessageResponse};
  /** Read/poll the patient's agent conversation, oldest first. */
  'GET /v1/agent/messages': {request: ListAgentMessagesQuery; response: ListAgentMessagesResponse};
  /** Mint a session token for the `<natzar-agent>` widget (patient-scoped). */
  'POST /v1/agent/embed-session': {
    request: CreateAgentEmbedSessionRequest;
    response: CreateEmbedSessionResponse;
  };

  // -- Async consults ------------------------------------------------------
  /** Start an async consult. `409 has_open_thread` / `feature_disabled`. */
  'POST /v1/async-consults': {request: CreateAsyncConsultRequest; response: CreateAsyncConsultResponse};
  /**
   * List async consults, most recently active first. `assignee=me|unassigned|<id>`
   * and `origin` filter the physician's view. Physician session.
   */
  'GET /v1/async-consults': {request: ListAsyncConsultsQuery; response: ListAsyncConsultsResponse};
  /** Fetch one async consult. Tenant-scoped with a physician credential. Physician session. */
  'GET /v1/async-consults/{id}': {request: undefined; response: GetAsyncConsultResponse};
  /** Page the consult transcript, oldest first. Physician session. */
  'GET /v1/async-consults/{id}/messages': {
    request: ListAsyncMessagesQuery;
    response: ListAsyncMessagesResponse;
  };
  /** Post a patient message (202, FIFO-enqueued). Tenant key only — not a physician-session route. */
  'POST /v1/async-consults/{id}/messages': {
    request: PostAsyncMessageRequest;
    response: PostAsyncMessageResponse;
  };
  /** Post the assigned physician's reply (202, FIFO-enqueued). Physician credential required. Physician session. */
  'POST /v1/async-consults/{id}/replies': {
    request: PostAsyncReplyRequest;
    response: PostAsyncReplyResponse;
  };
  /** Assign a queued consult to the acting physician. Physician session. */
  'POST /v1/async-consults/{id}/claim': {
    request: ClaimAsyncConsultRequest;
    response: ClaimAsyncConsultResponse;
  };
  /** Reassign an active consult after an SLA breach. `409 sla_not_overdue` before. Physician session. */
  'POST /v1/async-consults/{id}/takeover': {
    request: TakeoverAsyncConsultRequest;
    response: TakeoverAsyncConsultResponse;
  };
  /** Mark the consult resolved (assignee only). Physician session. */
  'POST /v1/async-consults/{id}/resolve': {
    request: ResolveAsyncConsultRequest;
    response: ResolveAsyncConsultResponse;
  };
  /**
   * Close an open consult — administratively, or on the patient's behalf.
   * With a physician credential: assignee only, tenant-scoped. Physician session.
   */
  'POST /v1/async-consults/{id}/close': {
    request: CloseAsyncConsultRequest | undefined;
    response: CloseAsyncConsultResponse;
  };
  /**
   * The assignee turns the thread into a live video consult: closes it as
   * `escalated`, opens a telehealth consult for the patient, sends them the
   * link. Physician session.
   */
  'POST /v1/async-consults/{id}/escalate': {
    request: EscalateAsyncConsultRequest | undefined;
    response: EscalateAsyncConsultResponse;
  };
  /** Record the PATIENT's consent answer to an invite (accept or decline). */
  'POST /v1/async-consults/{id}/consent': {
    request: RespondAsyncConsentRequest;
    response: RespondAsyncConsentResponse;
  };
  /** Record the PATIENT's rating of a finished consult. Write-once. */
  'POST /v1/async-consults/{id}/rate': {
    request: RateAsyncConsultRequest;
    response: RateAsyncConsultResponse;
  };
  /** Mint an embed session token for the async chat widget. */
  'POST /v1/async-consults/{id}/embed-session': {
    request: CreateEmbedSessionRequest | undefined;
    response: CreateEmbedSessionResponse;
  };
  /** Presign attachment upload slots in the patient's staging area. */
  'POST /v1/attachments/upload-urls': {
    request: CreateUploadUrlsRequest;
    response: CreateUploadUrlsResponse;
  };

  // -- Telehealth ----------------------------------------------------------
  /** Start a live video consult. `409 feature_disabled` when not enabled. */
  'POST /v1/telehealth-consults': {
    request: CreateTelehealthConsultRequest;
    response: CreateTelehealthConsultResponse;
  };
  /**
   * List telehealth consults, newest first. `status`, `practitionerId` (`me`),
   * `mode` and `origin` filter the physician's view. Physician session.
   */
  'GET /v1/telehealth-consults': {
    request: ListTelehealthConsultsQuery;
    response: ListTelehealthConsultsResponse;
  };
  /** Fetch one telehealth consult (fresh `recordingUrl` when available). Physician session. */
  'GET /v1/telehealth-consults/{id}': {request: undefined; response: GetTelehealthConsultResponse};
  /** Mint an embed session token for the video widget. */
  'POST /v1/telehealth-consults/{id}/embed-session': {
    request: CreateEmbedSessionRequest | undefined;
    response: CreateEmbedSessionResponse;
  };
  /**
   * Cancel before the call starts (`invited`/`scheduled`/`waiting` only). With a
   * physician credential on a booked consult: the clinician cancels their own
   * appointment and the patient is told (`reason` relayed). Physician session.
   */
  'POST /v1/telehealth-consults/{id}/cancel': {
    request: CancelTelehealthConsultRequest | undefined;
    response: CancelTelehealthConsultResponse;
  };
  /**
   * The PHYSICIAN's way into their call: the LiveKit grant once `in_progress`.
   * Requires a physician credential naming the practitioner (`409
   * not_assigned`). Physician session.
   */
  'POST /v1/telehealth-consults/{id}/room': {
    request: TelehealthRoomRequest | undefined;
    response: TelehealthRoomResponse;
  };
  /**
   * Hang up. The physician goes back to `ready` (or `offline` with
   * `goOffline`) and the queue is re-matched at once — `next` is the patient
   * now ringing. Idempotent once completed. Physician session.
   */
  'POST /v1/telehealth-consults/{id}/end': {
    request: EndTelehealthConsultRequest | undefined;
    response: EndTelehealthConsultResponse;
  };
  /**
   * The booked physician's waiting-room presence for a `scheduled` consult
   * (the twin of the patient's `/join`); call every ~10 s. Starts the call
   * when both sides are present in the window. Physician session.
   */
  'POST /v1/telehealth-consults/{id}/ready': {
    request: TelehealthReadyRequest | undefined;
    response: TelehealthReadyResponse;
  };
  /**
   * The patient's waiting-room heartbeat AND read: enters/holds the queue
   * and returns position, or the LiveKit credentials once the call starts.
   * Call every ~10s while the patient is watching.
   */
  'POST /v1/telehealth-consults/{id}/join': {
    request: JoinTelehealthConsultRequest | undefined;
    response: JoinTelehealthConsultResponse;
  };
  /** Record the PATIENT's post-call rating. Write-once. */
  'POST /v1/telehealth-consults/{id}/rate': {
    request: RateTelehealthConsultRequest;
    response: RateTelehealthConsultResponse;
  };

  // -- Scheduled consultations (docs/SCHEDULED-CONSULTS.md) ----------------
  /**
   * The bookable times for a `scheduled` consult: every published availability
   * window of every physician who covers its specialty, minus what is already
   * taken, clipped to the tenant's lead time and booking horizon.
   *
   * Identical starts from different physicians collapse into ONE offer. That is
   * deliberate: the patient picks a TIME, not a person, and `book` chooses the
   * least-loaded eligible physician within the language tier — the patient's
   * language first, then English, then anyone. `practitionerIds` is exposed
   * so a surface that genuinely needs to pin one can, not so every surface
   * should; each offer's `languages` and the response's `patientLang` let a
   * grid badge the times a French speaker is preferred for.
   */
  'GET /v1/telehealth-consults/{id}/slots': {
    request: ListTelehealthSlotsQuery;
    response: ListTelehealthSlotsResponse;
  };
  /**
   * Take one of the offered slots. ATOMIC: the reservation is a conditional
   * write, so two requests for the same start cannot both succeed — the loser
   * gets `409 slot_taken` with a fresh `slots` array attached, ready to render.
   *
   * Calling this on a consult that is ALREADY booked reschedules it: same
   * consult, same id, same embed session, a different time.
   */
  'POST /v1/telehealth-consults/{id}/book': {
    request: BookTelehealthConsultRequest;
    response: BookTelehealthConsultResponse;
  };
  /**
   * Replace a physician's WHOLE schedule — every rule and every exception,
   * whatever its date — with the one sent: the availability patients book
   * against. A replace, not a merge, for a caller that owns the rota (an HR or
   * rostering system): send the schedule you want to exist, and it becomes
   * the schedule. Calendar-style edits use PATCH instead. Self-only with a
   * physician credential. Physician session. Query: `from`/`to` shape the
   * response range.
   */
  'PUT /v1/physicians/{id}/schedule': {
    request: SetPhysicianScheduleRequest;
    response: GetPhysicianScheduleResponse;
  };
  /**
   * Apply a CHANGE SET to a physician's schedule — create, update and delete
   * individual rules and exceptions by id, leaving everything else exactly as
   * it was however far ahead it lies. The way a calendar edits: "block the
   * 14th", "end this pattern in March", "extra hours next Saturday" are each
   * one small PATCH. `diffSchedule` in `./schedule` produces the body from an
   * edited document. Self-only with a physician credential. Physician
   * session. Query: `from`/`to` shape the response range.
   */
  'PATCH /v1/physicians/{id}/schedule': {
    request: UpdatePhysicianScheduleRequest;
    response: GetPhysicianScheduleResponse;
  };
  /**
   * Read a physician's schedule: the whole rota, the exceptions and the
   * resolved days over `from`..`to` (query; default today → the planning
   * horizon), plus how far the tenant asks them to publish. Physician session.
   */
  'GET /v1/physicians/{id}/schedule': {request: PhysicianScheduleQuery; response: GetPhysicianScheduleResponse};
  /**
   * Replace a physician's STATE LICENCES — the jurisdictions they may practise
   * in. A whole-list replace, like the schedule.
   *
   * Only consulted by tenants with licence enforcement switched on; for
   * everyone else these are recorded and ignored. With it on the constraint is
   * hard in both directions: no licence for the patient's state means the
   * physician is not offered the consult, and no licences at all means they are
   * offered nothing. Self-only with a physician credential. Physician session.
   */
  'PUT /v1/physicians/{id}/licenses': {
    request: SetPhysicianLicensesRequest;
    response: GetPhysicianLicensesResponse;
  };
  /** Read a physician's licences, with the ones lapsing soon called out. Physician session. */
  'GET /v1/physicians/{id}/licenses': {request: undefined; response: GetPhysicianLicensesResponse};

  // -- Events --------------------------------------------------------------
  /** Page the durable webhook replay log, oldest first. */
  'GET /v1/events': {request: ListEventsQuery; response: ListEventsResponse};
}

/** Any route key of the API, e.g. `'POST /v1/patients'`. */
export type Route = keyof Endpoints;

/** The request (body or query) type of a route. */
export type RequestOf<R extends Route> = Endpoints[R]['request'];

/** The success-response body type of a route. */
export type ResponseOf<R extends Route> = Endpoints[R]['response'];
