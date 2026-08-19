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
  PhysicianResource,
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
  CreateTelehealthConsultRequest,
  CreateAgentEmbedSessionRequest,
  CreateUploadUrlsRequest,
  GetPatientStateQuery,
  JoinTelehealthConsultRequest,
  ListAgentMessagesQuery,
  ListAsyncConsultsQuery,
  ListAsyncMessagesQuery,
  ListEventsQuery,
  ListPatientsQuery,
  ListPhysiciansQuery,
  ListTelehealthConsultsQuery,
  PostAgentMessageRequest,
  PostAsyncMessageRequest,
  PostAsyncReplyRequest,
  RateAsyncConsultRequest,
  RateTelehealthConsultRequest,
  ResolveAsyncConsultRequest,
  RespondAsyncConsentRequest,
  SetPhysicianAvailabilityRequest,
  TakeoverAsyncConsultRequest,
  UpdatePatientRequest,
  UpsertPatientRequest,
} from './schemas';

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
  CreateTelehealthConsultRequest,
  CreateUploadUrlsRequest,
  GetPatientStateQuery,
  JoinTelehealthConsultRequest,
  ListAgentMessagesQuery,
  ListAsyncConsultsQuery,
  ListAsyncMessagesQuery,
  ListEventsQuery,
  ListPatientsQuery,
  ListPhysiciansQuery,
  ListTelehealthConsultsQuery,
  PostAgentMessageRequest,
  PostAsyncMessageRequest,
  PostAsyncReplyRequest,
  RateAsyncConsultRequest,
  RateTelehealthConsultRequest,
  ResolveAsyncConsultRequest,
  RespondAsyncConsentRequest,
  SetPhysicianAvailabilityRequest,
  TakeoverAsyncConsultRequest,
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

// ---------------------------------------------------------------------------
// Patient state
// ---------------------------------------------------------------------------

/**
 * What this tenant is allowed to offer, so your UI can hide what isn't
 * enabled instead of discovering it through a `409 feature_disabled`.
 */
export interface TenantCapabilities {
  /** Whether async (messaging) consults can be created. */
  asyncEnabled: boolean;
  /** Whether telehealth (video) consults can be created. */
  telehealthEnabled: boolean;
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
  /** Fetch one physician by our id. */
  'GET /v1/physicians/{id}': {request: undefined; response: GetPhysicianResponse};
  /** (Re-)send the portal invitation email. */
  'POST /v1/physicians/{id}/portal-invite': {request: undefined; response: SendPortalInviteResponse};
  /** Toggle async auto-assignment eligibility. */
  'POST /v1/physicians/{id}/availability': {
    request: SetPhysicianAvailabilityRequest;
    response: SetPhysicianAvailabilityResponse;
  };

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
  /** List async consults, most recently active first. */
  'GET /v1/async-consults': {request: ListAsyncConsultsQuery; response: ListAsyncConsultsResponse};
  /** Fetch one async consult. */
  'GET /v1/async-consults/{id}': {request: undefined; response: GetAsyncConsultResponse};
  /** Page the consult transcript, oldest first. */
  'GET /v1/async-consults/{id}/messages': {
    request: ListAsyncMessagesQuery;
    response: ListAsyncMessagesResponse;
  };
  /** Post a patient message (202, FIFO-enqueued). */
  'POST /v1/async-consults/{id}/messages': {
    request: PostAsyncMessageRequest;
    response: PostAsyncMessageResponse;
  };
  /** Post the assigned physician's reply (202, FIFO-enqueued). */
  'POST /v1/async-consults/{id}/replies': {
    request: PostAsyncReplyRequest;
    response: PostAsyncReplyResponse;
  };
  /** Assign a queued consult to a specific physician. */
  'POST /v1/async-consults/{id}/claim': {
    request: ClaimAsyncConsultRequest;
    response: ClaimAsyncConsultResponse;
  };
  /** Reassign an active consult after an SLA breach. `409 sla_not_overdue` before. */
  'POST /v1/async-consults/{id}/takeover': {
    request: TakeoverAsyncConsultRequest;
    response: TakeoverAsyncConsultResponse;
  };
  /** Mark the consult resolved (assignee only). */
  'POST /v1/async-consults/{id}/resolve': {
    request: ResolveAsyncConsultRequest;
    response: ResolveAsyncConsultResponse;
  };
  /** Close an open consult — administratively, or on the patient's behalf. */
  'POST /v1/async-consults/{id}/close': {
    request: CloseAsyncConsultRequest | undefined;
    response: CloseAsyncConsultResponse;
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
  /** List telehealth consults, newest first. */
  'GET /v1/telehealth-consults': {
    request: ListTelehealthConsultsQuery;
    response: ListTelehealthConsultsResponse;
  };
  /** Fetch one telehealth consult (fresh `recordingUrl` when available). */
  'GET /v1/telehealth-consults/{id}': {request: undefined; response: GetTelehealthConsultResponse};
  /** Mint an embed session token for the video widget. */
  'POST /v1/telehealth-consults/{id}/embed-session': {
    request: CreateEmbedSessionRequest | undefined;
    response: CreateEmbedSessionResponse;
  };
  /** Cancel before the call starts (`invited`/`waiting` only). */
  'POST /v1/telehealth-consults/{id}/cancel': {
    request: CancelTelehealthConsultRequest | undefined;
    response: CancelTelehealthConsultResponse;
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
