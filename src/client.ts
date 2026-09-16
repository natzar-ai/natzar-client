/**
 * `NatzarClient` — the typed entry point to the Natzar Partner API.
 *
 * Every method is one route from the published contract
 * (`./contract/endpoints`), with the route's own request and response types.
 * Nothing here re-describes the API; it wires the contract to a `fetch`, so a
 * route added to the contract shows up as a type error here until it is
 * exposed, and a response shape can never drift from what the server sends.
 *
 * ```ts
 * const natzar = new NatzarClient({apiKey: process.env.NATZAR_API_KEY!, environment: 'stage'});
 * const {patient} = await natzar.patients.upsert({externalId: 'u_42', …});
 * const state = await natzar.patients.state({externalPatientId: 'u_42'});
 * ```
 *
 * @packageDocumentation
 */

import {
  resolveEndpoints,
  type EndpointOverrides,
  type NatzarEndpoints,
  type NatzarEnvironment,
  type NatzarZone,
} from './environments';
import {
  assertUsableKey,
  request,
  type CredentialKind,
  type FetchLike,
  type HttpConfig,
  type RequestArgs,
} from './http';
import type {
  CancelTelehealthConsultRequest,
  CancelTelehealthConsultResponse,
  ClaimAsyncConsultRequest,
  ClaimAsyncConsultResponse,
  CloseAsyncConsultRequest,
  CloseAsyncConsultResponse,
  CreateAgentEmbedSessionRequest,
  CreateAsyncConsultRequest,
  CreateAsyncConsultResponse,
  CreateEmbedSessionRequest,
  CreateEmbedSessionResponse,
  CreatePhysicianRequest,
  CreatePhysicianResponse,
  CreatePhysicianSessionRequest,
  CreatePhysicianSessionResponse,
  CreateTelehealthConsultRequest,
  CreateTelehealthConsultResponse,
  CreateUploadUrlsRequest,
  CreateUploadUrlsResponse,
  EndTelehealthConsultRequest,
  EndTelehealthConsultResponse,
  EscalateAsyncConsultResponse,
  GetAsyncConsultResponse,
  GetPatientResponse,
  GetPatientStateQuery,
  GetPatientStateResponse,
  GetPhysicianAgendaResponse,
  GetPhysicianResponse,
  GetPhysicianWorkspaceResponse,
  GetTelehealthConsultResponse,
  JoinTelehealthConsultResponse,
  ListSpecialtiesResponse,
  PhysicianAgendaQuery,
  PresenceResponse,
  SetPhysicianPresenceRequest,
  SetPhysicianSpecialtiesRequest,
  SetPhysicianSpecialtiesResponse,
  SetPhysicianLanguagesRequest,
  SetPhysicianLanguagesResponse,
  TelehealthReadyRequest,
  TelehealthReadyResponse,
  TelehealthRoomResponse,
  ListAgentMessagesQuery,
  ListAgentMessagesResponse,
  ListAsyncConsultsQuery,
  ListAsyncConsultsResponse,
  ListAsyncMessagesQuery,
  ListAsyncMessagesResponse,
  ListEventsQuery,
  ListEventsResponse,
  ListPatientsQuery,
  ListPatientsResponse,
  ListPhysiciansQuery,
  ListPhysiciansResponse,
  ListTelehealthConsultsQuery,
  ListTelehealthSlotsQuery,
  ListTelehealthSlotsResponse,
  BookTelehealthConsultRequest,
  BookTelehealthConsultResponse,
  SetPhysicianScheduleRequest,
  UpdatePhysicianScheduleRequest,
  PhysicianScheduleQuery,
  GetPhysicianScheduleResponse,
  SetPhysicianLicensesRequest,
  GetPhysicianLicensesResponse,
  ListTelehealthConsultsResponse,
  PostAgentMessageRequest,
  PostAgentMessageResponse,
  PostAsyncMessageRequest,
  PostAsyncMessageResponse,
  PostAsyncReplyRequest,
  PostAsyncReplyResponse,
  RateAsyncConsultRequest,
  RateAsyncConsultResponse,
  RateTelehealthConsultRequest,
  RateTelehealthConsultResponse,
  ResolveAsyncConsultRequest,
  ResolveAsyncConsultResponse,
  RespondAsyncConsentRequest,
  RespondAsyncConsentResponse,
  SendPortalInviteResponse,
  SetPhysicianAvailabilityRequest,
  SetPhysicianAvailabilityResponse,
  TakeoverAsyncConsultRequest,
  TakeoverAsyncConsultResponse,
  UpdatePatientRequest,
  UpdatePatientResponse,
  UpsertPatientRequest,
  UpsertPatientResponse,
} from './contract/endpoints';

/**
 * Options accepted by {@link NatzarClient}. Exactly ONE of `apiKey` /
 * `sessionToken` — they are different credentials for different halves of an
 * integration, and a client built with both would not know which it is.
 */
export interface NatzarClientOptions extends EndpointOverrides {
  /**
   * Your partner API key. SERVER SIDE ONLY — it identifies your tenant and
   * grants full access to it. Browser code gets a short-lived embed session
   * token instead (`agent.embedSession`, `asyncConsults.embedSession`,
   * `telehealth.embedSession`), or a physician session (`physicians.session`).
   */
  apiKey?: string;
  /**
   * A physician SESSION token instead of an API key — the browser-side
   * credential for the physician routes, minted by your server with
   * `physicians.session(id)` after your own sign-in. It names one physician,
   * expires, and can do nothing your key could not have let that physician do,
   * so it may live in a browser bundle.
   *
   * A session-authenticated client reaches only the routes the contract marks
   * "physician session" (`403 forbidden` elsewhere — keep the key on your
   * server for those) and acts only as that physician, so pass `'me'` as the
   * physician id. `@natzar/client/physician` wraps this client with polling,
   * presence and automatic heartbeats; reach for it unless you want the raw
   * routes.
   */
  sessionToken?: string;
  /** Per-request timeout in ms. Default 30 000. */
  timeoutMs?: number;
  /** Automatic retries of retryable failures (429/5xx/network). Default 2. */
  maxRetries?: number;
  /** Base backoff in ms, doubled per attempt with jitter. Default 250. */
  retryBaseMs?: number;
  /** Extra headers on every request. */
  headers?: Record<string, string>;
  /** Replace the `fetch` used. Defaults to the global one. */
  fetch?: FetchLike;
  /** Per-attempt hook for logging/metrics. */
  onResponse?: HttpConfig['onResponse'];
}

/** Options every method accepts on top of its own arguments. */
export interface CallOptions {
  /** Abort this call. */
  signal?: AbortSignal;
  /**
   * The acting clinician's Cognito ID token, for the PHYSICIAN-side routes
   * (`replies`, `claim`, `takeover`, `resolve`, and setting a physician's own
   * availability). Sent as `X-Natzar-Physician`.
   *
   * Required on those routes, because your API key identifies your
   * APPLICATION and they need to know which PERSON is acting: a reply lands on
   * a patient's permanent record signed with a named clinician. Sign the
   * physician in against the Natzar provider user pool (they are given an
   * account when you create them) and pass the resulting ID token here.
   *
   * The server derives the acting physician from this token. Any `physicianId`
   * you also put in the body is only a cross-check and must agree with it.
   */
  physicianToken?: string;
  /**
   * The acting physician's id, ASSERTED by your server, for the same routes.
   * Sent as `X-Natzar-Physician-Id`.
   *
   * The weakest of the three physician credentials: nothing proves the
   * clinician is really there — your server vouches, on your key. It exists
   * for partners whose clinicians never sign in to Natzar and who cannot mint
   * a session per screen; the platform records the attestation level on
   * everything it signs, and a tenant can switch assertion off, after which
   * these calls answer `403 forbidden`. Prefer a session token
   * (`physicians.session`) whenever a browser is involved.
   */
  physicianId?: string;
}

const enc = encodeURIComponent;

// A retried message post is only SAFE when the caller pinned an
// idempotencyKey: the platform dedupes delivery on it, so the retry collapses
// into the first attempt. Without one the server treats each request as a new
// submission, and a retry would put the same clinical message on the patient's
// transcript twice. So retries are armed per call, by the caller, not blanket.
const hasIdempotencyKey = (body: unknown): boolean =>
  !!body && typeof body === 'object' && typeof (body as {idempotencyKey?: unknown}).idempotencyKey === 'string';


// The acting-physician credential(s), as request headers. Omitted entirely
// when absent so patient-side calls carry nothing extra. Both may be sent:
// the server takes the strongest it can verify and ignores the rest.
const physicianHeader = (opts?: CallOptions): {headers?: Record<string, string>} => {
  const headers: Record<string, string> = {};
  if (opts?.physicianToken) headers['X-Natzar-Physician'] = opts.physicianToken;
  if (opts?.physicianId) headers['X-Natzar-Physician-Id'] = opts.physicianId;
  return Object.keys(headers).length ? {headers} : {};
};

export class NatzarClient {
  /** Which environment this client resolved to. */
  readonly environment: NatzarEnvironment;
  /**
   * Which residency zone this client resolved to — the jurisdiction whose
   * deployment it is talking to. Worth logging once at startup next to the
   * environment: "tenant not found" and "wrong zone" look identical otherwise.
   */
  readonly zone: NatzarZone;
  /** The endpoints in use — useful to log once at startup. */
  readonly endpoints: NatzarEndpoints;
  /**
   * Which credential this client was built with: `apiKey` (your server,
   * tenant-wide) or `sessionToken` (one physician, browser-safe). A
   * session-built client reaches only the physician-session routes.
   */
  readonly credential: CredentialKind;

  private readonly http: HttpConfig;

  constructor(options: NatzarClientOptions) {
    const apiKey = options.apiKey?.trim() ?? '';
    const sessionToken = options.sessionToken?.trim() ?? '';
    if (apiKey && sessionToken) {
      throw new Error(
        'natzar-client: pass EITHER apiKey (your server, tenant-wide) OR sessionToken (one physician, ' +
          'browser-safe) — not both. They are different credentials for different halves of an integration.',
      );
    }
    // One credential, checked for the shape of the slot it arrived in. Both
    // ride as the same bearer header, so a swap would otherwise surface as a
    // bare 401 indistinguishable from an expired session; the shape check
    // names the mistake at construction instead.
    const credential: CredentialKind = sessionToken ? 'sessionToken' : 'apiKey';
    assertUsableKey(sessionToken || apiKey, credential);
    this.credential = credential;
    const resolved = resolveEndpoints(options);
    this.environment = resolved.environment;
    this.zone = resolved.zone;
    this.endpoints = {baseUrl: resolved.baseUrl, embedOrigin: resolved.embedOrigin};
    this.http = {
      baseUrl: resolved.baseUrl,
      apiKey: sessionToken || apiKey,
      timeoutMs: options.timeoutMs ?? 30_000,
      maxRetries: options.maxRetries ?? 2,
      retryBaseMs: options.retryBaseMs ?? 250,
      headers: options.headers ?? {},
      fetch:
        options.fetch ??
        ((input, init) => {
          if (typeof globalThis.fetch !== 'function') {
            throw new Error('natzar-client: no global fetch — pass one via `fetch` (Node < 18).');
          }
          return globalThis.fetch(input, init);
        }),
      ...(options.onResponse ? {onResponse: options.onResponse} : {}),
    };
  }

  /**
   * Escape hatch: call any route by path, with your own types.
   *
   * Here for a route this client version predates — `/v1` grows additively, so
   * a client one release behind should not be a wall.
   */
  raw<T>(args: RequestArgs): Promise<T> {
    return request<T>(this.http, args);
  }

  private get<T>(path: string, query?: RequestArgs['query'], opts?: CallOptions): Promise<T> {
    return request<T>(this.http, {
      method: 'GET',
      path,
      ...(query ? {query} : {}),
      ...(opts?.signal ? {signal: opts.signal} : {}),
      ...physicianHeader(opts),
    });
  }

  private post<T>(
    path: string,
    body: unknown,
    opts: CallOptions & {idempotent?: boolean} = {},
  ): Promise<T> {
    return request<T>(this.http, {
      method: 'POST',
      path,
      body,
      ...(opts.idempotent ? {idempotent: true} : {}),
      ...(opts.signal ? {signal: opts.signal} : {}),
      ...physicianHeader(opts),
    });
  }

  /**
   * PUT — a whole-resource replace. The physician schedule, licence and
   * specialty routes use it, and use it precisely because "replace" is the
   * semantics they need: a partially-merged availability calendar is not
   * something a caller can reason about.
   */
  private put<T>(path: string, body: unknown, opts: CallOptions = {}, query?: RequestArgs['query']): Promise<T> {
    return request<T>(this.http, {
      method: 'PUT',
      path,
      body,
      ...(query ? {query} : {}),
      ...(opts.signal ? {signal: opts.signal} : {}),
      ...physicianHeader(opts),
    });
  }

  /**
   * PATCH — a partial update. Carries the same per-call headers as every
   * other verb: a route that grows a physician-side use later must not
   * silently lose the acting-physician credential because its verb differed.
   */
  private patch<T>(path: string, body: unknown, opts: CallOptions = {}, query?: RequestArgs['query']): Promise<T> {
    return request<T>(this.http, {
      method: 'PATCH',
      path,
      body,
      ...(query ? {query} : {}),
      ...(opts.signal ? {signal: opts.signal} : {}),
      ...physicianHeader(opts),
    });
  }

  // -------------------------------------------------------------------------
  // Patients
  // -------------------------------------------------------------------------

  readonly patients = {
    /**
     * Upsert a patient by your `externalId`. Idempotent — repeating updates
     * the mutable fields and never duplicates, so it is safe to call on every
     * request as a "make sure they exist" step.
     */
    upsert: (body: UpsertPatientRequest, opts?: CallOptions): Promise<UpsertPatientResponse> =>
      this.post('/patients', body, {...opts, idempotent: true}),

    /** List patients, or look one up with `{externalId}`. */
    list: (query: ListPatientsQuery = {}, opts?: CallOptions): Promise<ListPatientsResponse> =>
      this.get('/patients', query as RequestArgs['query'], opts),

    /** Fetch one patient by OUR id. */
    get: (id: string, opts?: CallOptions): Promise<GetPatientResponse> =>
      this.get(`/patients/${enc(id)}`, undefined, opts),

    /** Update the editable subset (never phone/externalId). */
    update: (id: string, body: UpdatePatientRequest, opts?: CallOptions): Promise<UpdatePatientResponse> =>
      this.patch(`/patients/${enc(id)}`, body, opts),

    /**
     * Everything a patient-facing screen needs, in ONE call: the patient, their
     * open async consult (if any), their open video consult (if any), the
     * agent-transcript cursor, and what this tenant can offer.
     *
     * Render straight from it — `telehealthConsult` beats `asyncConsult` beats
     * the agent chat. That precedence is decided server-side so two clients
     * cannot disagree about which surface a patient is on.
     */
    state: (query: GetPatientStateQuery, opts?: CallOptions): Promise<GetPatientStateResponse> =>
      this.get('/patients/state', query as RequestArgs['query'], opts),
  };

  // -------------------------------------------------------------------------
  // Physicians
  // -------------------------------------------------------------------------

  readonly physicians = {
    /**
     * Create a physician + their backing portal account. An IDENTICAL repeat
     * (same externalId, same email) is idempotent; a different email on a known
     * externalId is a `409 external_id_conflict`.
     */
    create: (body: CreatePhysicianRequest, opts?: CallOptions): Promise<CreatePhysicianResponse> =>
      this.post('/physicians', body, {...opts, idempotent: true}),

    list: (query: ListPhysiciansQuery = {}, opts?: CallOptions): Promise<ListPhysiciansResponse> =>
      this.get('/physicians', query as RequestArgs['query'], opts),

    get: (id: string, opts?: CallOptions): Promise<GetPhysicianResponse> =>
      this.get(`/physicians/${enc(id)}`, undefined, opts),

    /** (Re-)send the portal invitation email. */
    sendPortalInvite: (id: string, opts?: CallOptions): Promise<SendPortalInviteResponse> =>
      this.post(`/physicians/${enc(id)}/portal-invite`, {}, opts),

    /**
     * Toggle async auto-assignment eligibility. Turning it ON can immediately
     * drain queued consults to this physician.
     */
    setAvailability: (
      id: string,
      body: SetPhysicianAvailabilityRequest,
      opts?: CallOptions,
    ): Promise<SetPhysicianAvailabilityResponse> =>
      this.post(`/physicians/${enc(id)}/availability`, body, {...opts, idempotent: true}),

    /**
     * The ACTING physician — `GET /v1/physicians/me`. Needs a physician
     * credential (a session-built client, or `physicianToken` /
     * `physicianId` on this call); `401 unauthorized` without one.
     */
    me: (opts?: CallOptions): Promise<GetPhysicianResponse> => this.get('/physicians/me', undefined, opts),

    /**
     * Mint a physician SESSION token — the browser-side credential for the
     * physician routes. Tenant key only: call it from your server after your
     * own authentication (single sign-on by token exchange) and hand the
     * whole response to `connectPhysician` from `@natzar/client/physician`;
     * it carries the API URL, so nothing about our deployment is baked into
     * your bundle.
     *
     * Safe to repeat: every mint is a fresh token, so a retry after an
     * ambiguous failure costs a token nobody uses, never a duplicate of
     * anything.
     */
    session: (
      id: string,
      body?: CreatePhysicianSessionRequest,
      opts?: CallOptions,
    ): Promise<CreatePhysicianSessionResponse> =>
      this.post(`/physicians/${enc(id)}/session`, body ?? {}, {...opts, idempotent: true}),

    /**
     * Go on or off the LIVE video queue. `ready: true` matches immediately —
     * read `activeConsult` for the patient now ringing — and starts the
     * presence clock: keep `heartbeat`ing every 15 s or it lapses after 45 s
     * (`@natzar/client/physician` does that for you). Self-only.
     *
     * Idempotent: the write records a state, not an event, so repeating it
     * after a timeout lands on the same state.
     */
    presence: (id: string, body: SetPhysicianPresenceRequest, opts?: CallOptions): Promise<PresenceResponse> =>
      this.post(`/physicians/${enc(id)}/presence`, body, {...opts, idempotent: true}),

    /**
     * Keep a `ready` physician on the rota. Every 15 s while `ready` and the
     * page is open; STOP when it closes — a physician nobody is watching for
     * must fall off the rota, or patients ring a clinician who never answers.
     * A beat while `ready` also retries the match, so `activeConsult` can
     * appear here first. Self-only, idempotent.
     */
    heartbeat: (id: string, opts?: CallOptions): Promise<PresenceResponse> =>
      this.post(`/physicians/${enc(id)}/heartbeat`, {}, {...opts, idempotent: true}),

    /**
     * The whole clinician screen in ONE read — presence, live queue, active
     * call, upcoming appointments, inbox. The polling target; every list is
     * capped and `truncated` names any that hit the cap.
     */
    workspace: (id: string, opts?: CallOptions): Promise<GetPhysicianWorkspaceResponse> =>
      this.get(`/physicians/${enc(id)}/workspace`, undefined, opts),

    /**
     * Booked appointments in a window (default: now → +7 days; at most 31),
     * soonest first. Only rows that still hold a time — a cancelled or missed
     * appointment has released its slot and is not on the agenda.
     */
    agenda: (id: string, query: PhysicianAgendaQuery = {}, opts?: CallOptions): Promise<GetPhysicianAgendaResponse> =>
      this.get(`/physicians/${enc(id)}/agenda`, query as RequestArgs['query'], opts),

    /**
     * REPLACE the specialties a physician covers (slugs from
     * `specialties.list`). An unknown slug is dropped, not refused — read the
     * returned `physician.specialties` for what stuck. An EMPTY list means
     * "covers everything". Self-only with a physician credential.
     */
    setSpecialties: (
      id: string,
      body: SetPhysicianSpecialtiesRequest,
      opts?: CallOptions,
    ): Promise<SetPhysicianSpecialtiesResponse> => this.put(`/physicians/${enc(id)}/specialties`, body, opts),

    /**
     * REPLACE the languages a physician consults in — base codes from
     * `PHYSICIAN_LANGUAGES` (`fr`, never `fr_CH`; a locale is `400
     * invalid_request`). A RANKED PREFERENCE, not a filter: among the
     * physicians a consult may go to, one who speaks the patient's language
     * is offered it first, then an English speaker, then anyone — so no list
     * can exclude a physician, and an EMPTY list means "nothing recorded"
     * (ranks last, never assumed English). Self-only with a physician
     * credential.
     */
    setLanguages: (
      id: string,
      body: SetPhysicianLanguagesRequest,
      opts?: CallOptions,
    ): Promise<SetPhysicianLanguagesResponse> => this.put(`/physicians/${enc(id)}/languages`, body, opts),
  };

  // -------------------------------------------------------------------------
  // Specialties
  // -------------------------------------------------------------------------

  readonly specialties = {
    /**
     * The tenant's specialty catalogue, in the clinic's display order. The
     * `slug`s are what consults are routed on and what `physicians.setSpecialties`
     * takes; a `catchAll` one covers every consult of the clinic.
     */
    list: (opts?: CallOptions): Promise<ListSpecialtiesResponse> => this.get('/specialties', undefined, opts),
  };

  // -------------------------------------------------------------------------
  // Agent chat
  // -------------------------------------------------------------------------

  readonly agent = {
    /**
     * Send one patient turn. Returns `202` immediately — the `messageId` you
     * get back is the `clientRef` the stored message will carry, so it is what
     * reconciles an optimistically rendered bubble. It is also the idempotency
     * key: re-posting the same body after a timeout will not enqueue twice.
     */
    send: (body: PostAgentMessageRequest, opts?: CallOptions): Promise<PostAgentMessageResponse> =>
      this.post('/agent/messages', body, {...opts, idempotent: hasIdempotencyKey(body)}),

    /**
     * Read/poll the conversation, oldest first. Hold on to `cursor` and pass it
     * back every time: it stays valid across empty polls, so it never needs
     * resetting.
     */
    messages: (query: ListAgentMessagesQuery, opts?: CallOptions): Promise<ListAgentMessagesResponse> =>
      this.get('/agent/messages', query as RequestArgs['query'], opts),

    /** Mint a session token for the `<natzar-agent>` widget (patient-scoped). */
    embedSession: (
      body: CreateAgentEmbedSessionRequest,
      opts?: CallOptions,
    ): Promise<CreateEmbedSessionResponse> => this.post('/agent/embed-session', body, {...opts, idempotent: true}),
  };

  // -------------------------------------------------------------------------
  // Async consults
  // -------------------------------------------------------------------------

  readonly asyncConsults = {
    /**
     * Start an async consult. `409 has_open_thread` when the patient already
     * has one open — one open thread per patient is an invariant, so treat
     * that code as "reuse the existing one" rather than as an error.
     */
    create: (body: CreateAsyncConsultRequest, opts?: CallOptions): Promise<CreateAsyncConsultResponse> =>
      this.post('/async-consults', body, opts),

    list: (query: ListAsyncConsultsQuery = {}, opts?: CallOptions): Promise<ListAsyncConsultsResponse> =>
      this.get('/async-consults', query as RequestArgs['query'], opts),

    get: (id: string, opts?: CallOptions): Promise<GetAsyncConsultResponse> =>
      this.get(`/async-consults/${enc(id)}`, undefined, opts),

    /** The transcript, oldest first, including system lifecycle notices. */
    messages: (
      id: string,
      query: ListAsyncMessagesQuery = {},
      opts?: CallOptions,
    ): Promise<ListAsyncMessagesResponse> =>
      this.get(`/async-consults/${enc(id)}/messages`, query as RequestArgs['query'], opts),

    /** Post a PATIENT message (202, FIFO-enqueued, deduplicated). */
    postMessage: (
      id: string,
      body: PostAsyncMessageRequest,
      opts?: CallOptions,
    ): Promise<PostAsyncMessageResponse> =>
      this.post(`/async-consults/${enc(id)}/messages`, body, {...opts, idempotent: hasIdempotencyKey(body)}),

    /** Post the assigned PHYSICIAN's reply (202, FIFO-enqueued, deduplicated). */
    postReply: (id: string, body: PostAsyncReplyRequest, opts?: CallOptions): Promise<PostAsyncReplyResponse> =>
      this.post(`/async-consults/${enc(id)}/replies`, body, {...opts, idempotent: hasIdempotencyKey(body)}),

    claim: (id: string, body: ClaimAsyncConsultRequest, opts?: CallOptions): Promise<ClaimAsyncConsultResponse> =>
      this.post(`/async-consults/${enc(id)}/claim`, body, opts),

    takeover: (
      id: string,
      body: TakeoverAsyncConsultRequest,
      opts?: CallOptions,
    ): Promise<TakeoverAsyncConsultResponse> => this.post(`/async-consults/${enc(id)}/takeover`, body, opts),

    resolve: (
      id: string,
      body: ResolveAsyncConsultRequest,
      opts?: CallOptions,
    ): Promise<ResolveAsyncConsultResponse> => this.post(`/async-consults/${enc(id)}/resolve`, body, opts),

    close: (id: string, body?: CloseAsyncConsultRequest, opts?: CallOptions): Promise<CloseAsyncConsultResponse> =>
      this.post(`/async-consults/${enc(id)}/close`, body ?? {}, opts),

    /**
     * The assignee turns the thread into a live video consult: the thread
     * closes as `escalated`, a telehealth consult opens for the same patient
     * and they are sent the join link. Go `ready` on the live queue to take
     * it when they follow it.
     *
     * A lifecycle post, so NOT replayed: a repeat that finds the thread
     * already closed is a `409 already_closed` the caller should see.
     */
    escalate: (id: string, opts?: CallOptions): Promise<EscalateAsyncConsultResponse> =>
      this.post(`/async-consults/${enc(id)}/escalate`, {}, opts),

    /**
     * Record the PATIENT's answer to a consent invite.
     *
     * This is what lets you render the consent prompt in your OWN UI: create
     * the consult with `consent: 'embed'`, show your screen, post the answer
     * here. `accept: false` closes the consult with `closedReason: 'declined'`.
     */
    consent: (
      id: string,
      body: RespondAsyncConsentRequest,
      opts?: CallOptions,
    ): Promise<RespondAsyncConsentResponse> => this.post(`/async-consults/${enc(id)}/consent`, body, opts),

    /**
     * Record the PATIENT's rating of a finished consult. Write-once: a repeat
     * comes back with `alreadyRated: true` and the consult unchanged, never an
     * error, so a double-tap needs no special handling.
     */
    rate: (id: string, body: RateAsyncConsultRequest, opts?: CallOptions): Promise<RateAsyncConsultResponse> =>
      this.post(`/async-consults/${enc(id)}/rate`, body, {...opts, idempotent: true}),

    /** Mint a session token for the `<natzar-async>` widget. */
    embedSession: (
      id: string,
      body?: CreateEmbedSessionRequest,
      opts?: CallOptions,
    ): Promise<CreateEmbedSessionResponse> =>
      this.post(`/async-consults/${enc(id)}/embed-session`, body ?? {}, {...opts, idempotent: true}),
  };

  // -------------------------------------------------------------------------
  // Attachments
  // -------------------------------------------------------------------------

  readonly attachments = {
    /**
     * Presign upload slots in the patient's staging area. PUT the bytes to
     * each `uploadUrl`, then reference the `stagingKey` on a message post.
     * See `uploadAttachments` in `./uploads` for the whole dance in one call.
     */
    createUploadUrls: (body: CreateUploadUrlsRequest, opts?: CallOptions): Promise<CreateUploadUrlsResponse> =>
      this.post('/attachments/upload-urls', body, {...opts, idempotent: true}),
  };

  // -------------------------------------------------------------------------
  // Physician schedules (scheduled consultations)
  // -------------------------------------------------------------------------

  readonly schedules = {
    /**
     * Read a physician's schedule: the whole rota (`rules`), plus the
     * exceptions and the resolved `days` over `query.from`..`query.to`
     * (inclusive local dates; default today → the tenant's planning horizon,
     * at most `MAX_SCHEDULE_RANGE_DAYS` — page by range to look further).
     * Compare `coveredThrough` with `requiredThrough` to tell a physician
     * their rota is short — the one number that matters to them.
     */
    get: (physicianId: string, query: PhysicianScheduleQuery = {}, opts?: CallOptions): Promise<GetPhysicianScheduleResponse> =>
      this.get(`/physicians/${enc(physicianId)}/schedule`, query as RequestArgs['query'], opts),

    /**
     * Apply a CHANGE SET — create, update and delete individual rules and
     * exceptions by id, leaving everything else exactly as it was. The way a
     * calendar edits; `diffSchedule` (from `@natzar/client/contract`) builds
     * the body from an edited document. One malformed row refuses the whole
     * call (`400 invalid_request`). `query.from`/`to` shape the response.
     */
    update: (
      physicianId: string,
      body: UpdatePhysicianScheduleRequest,
      opts?: CallOptions,
      query?: PhysicianScheduleQuery,
    ): Promise<GetPhysicianScheduleResponse> =>
      this.patch(`/physicians/${enc(physicianId)}/schedule`, body, opts, query as RequestArgs['query']),

    /**
     * REPLACE a physician's WHOLE schedule — every rule and every exception,
     * whatever its date. Send the schedule you want to exist; it becomes the
     * schedule. For a caller that owns the rota (a rostering system): a
     * calendar edits with `update` instead.
     *
     * A replace rather than a merge, deliberately: patients book against this,
     * and a merge makes the result depend on what was already there — which
     * the caller cannot see and cannot predict.
     */
    replace: (
      physicianId: string,
      body: SetPhysicianScheduleRequest,
      opts?: CallOptions,
      query?: PhysicianScheduleQuery,
    ): Promise<GetPhysicianScheduleResponse> =>
      this.put(`/physicians/${enc(physicianId)}/schedule`, body, opts, query as RequestArgs['query']),
  };

  // -------------------------------------------------------------------------
  // Physician licences (state licensure)
  // -------------------------------------------------------------------------

  readonly licenses = {
    /**
     * A physician's licences, with the ones lapsing within 60 days called out
     * separately. Surface `expiringSoon`: an expired licence removes a
     * physician from the rota with no error anywhere, and the first symptom is
     * a patient being told nobody can see them.
     */
    get: (physicianId: string, opts?: CallOptions): Promise<GetPhysicianLicensesResponse> =>
      this.get(`/physicians/${enc(physicianId)}/licenses`, undefined, opts),

    /**
     * REPLACE a physician's licences — send the list that should exist.
     *
     * Only consulted by tenants with licence enforcement switched on; for
     * everyone else these are recorded and ignored (`licenseEnforcement` in the
     * response says which). With it on the constraint is hard: no licence for
     * the patient's state means the physician is not offered that consult, and
     * no licences at all means they are offered none.
     *
     * A `state` this platform cannot resolve to a real jurisdiction is REFUSED
     * (400), not dropped — a licence list that silently lost an entry looks
     * like coverage that is not there.
     */
    replace: (
      physicianId: string,
      body: SetPhysicianLicensesRequest,
      opts?: CallOptions,
    ): Promise<GetPhysicianLicensesResponse> =>
      this.put(`/physicians/${enc(physicianId)}/licenses`, body, opts),
  };

  // -------------------------------------------------------------------------
  // Telehealth
  // -------------------------------------------------------------------------

  readonly telehealth = {
    create: (
      body: CreateTelehealthConsultRequest,
      opts?: CallOptions,
    ): Promise<CreateTelehealthConsultResponse> => this.post('/telehealth-consults', body, opts),

    list: (
      query: ListTelehealthConsultsQuery = {},
      opts?: CallOptions,
    ): Promise<ListTelehealthConsultsResponse> =>
      this.get('/telehealth-consults', query as RequestArgs['query'], opts),

    /** Fetch one consult. `recordingUrl` is freshly presigned per read. */
    get: (id: string, opts?: CallOptions): Promise<GetTelehealthConsultResponse> =>
      this.get(`/telehealth-consults/${enc(id)}`, undefined, opts),

    /** Mint a session token for the `<natzar-telehealth>` widget. */
    embedSession: (
      id: string,
      body?: CreateEmbedSessionRequest,
      opts?: CallOptions,
    ): Promise<CreateEmbedSessionResponse> =>
      this.post(`/telehealth-consults/${enc(id)}/embed-session`, body ?? {}, {...opts, idempotent: true}),

    /**
     * Cancel before the call starts (`invited` / `scheduled` / `waiting`
     * only). With a physician credential on a booked consult this is the
     * clinician cancelling their own appointment: the patient is told, and
     * `reason` is relayed to them with the notice.
     */
    cancel: (
      id: string,
      body?: CancelTelehealthConsultRequest,
      opts?: CallOptions,
    ): Promise<CancelTelehealthConsultResponse> => this.post(`/telehealth-consults/${enc(id)}/cancel`, body ?? {}, opts),

    /**
     * The PHYSICIAN's way into their call. Needs a physician credential
     * naming the consult's practitioner (`409 not_assigned`, including while
     * it is still `waiting` for a match). `in_progress` carries the LiveKit
     * grant; `ringing` carries none — the patient's client is confirming, so
     * keep polling the workspace and call again once it reads `in_progress`.
     * Also counts as a presence heartbeat. A read in effect, so idempotent.
     */
    room: (id: string, opts?: CallOptions): Promise<TelehealthRoomResponse> =>
      this.post(`/telehealth-consults/${enc(id)}/room`, {}, {...opts, idempotent: true}),

    /**
     * Hang up. The physician goes back to `ready` (or `offline` with
     * `goOffline`) and the queue is re-matched at once — `next` is the
     * patient now ringing for them, if any.
     *
     * Retried on a transport fault, unlike the other lifecycle posts, because
     * the server guards the replay itself: ending a consult that already
     * ended returns it unchanged with `next: null` rather than a 409, so a
     * re-issue after a timeout is a read, not a second hang-up.
     */
    end: (id: string, body?: EndTelehealthConsultRequest, opts?: CallOptions): Promise<EndTelehealthConsultResponse> =>
      this.post(`/telehealth-consults/${enc(id)}/end`, body ?? {}, {...opts, idempotent: true}),

    /**
     * The booked physician's waiting-room presence for a `scheduled` consult
     * — the twin of the patient's `join`. Call it when they open the
     * appointment and every ~10 s while they stay; the call starts the moment
     * both sides are present inside the window, and `livekit` appears here.
     * Send `present: false` once when they step away. Only the practitioner
     * the slot was booked with may call it (`409 not_assigned`).
     */
    ready: (id: string, body?: TelehealthReadyRequest, opts?: CallOptions): Promise<TelehealthReadyResponse> =>
      this.post(`/telehealth-consults/${enc(id)}/ready`, body ?? {}, {...opts, idempotent: true}),

    /**
     * The patient's waiting-room heartbeat AND read.
     *
     * Call it when the patient opens the screen and every ~10 s while they
     * watch: it enters/holds the queue and returns their position, then the
     * LiveKit credentials the moment a physician picks up. STOP calling it when
     * they navigate away — continuing holds a queue slot nobody is watching.
     */
    join: (id: string, opts?: CallOptions): Promise<JoinTelehealthConsultResponse> =>
      this.post(`/telehealth-consults/${enc(id)}/join`, {}, {...opts, idempotent: true}),

    /** Record the PATIENT's post-call rating. Write-once, like the async one. */
    rate: (
      id: string,
      body: RateTelehealthConsultRequest,
      opts?: CallOptions,
    ): Promise<RateTelehealthConsultResponse> =>
      this.post(`/telehealth-consults/${enc(id)}/rate`, body, {...opts, idempotent: true}),

    /**
     * The bookable times for a `mode: 'scheduled'` consult.
     *
     * Identical starts from different physicians collapse into ONE offer: the
     * patient picks a TIME and `book` assigns the least-loaded physician who
     * published it. Pass the patient's zone as `timezone` and render and label
     * the times in the response's `timezone` — the zone you passed, else the
     * clinic's; `clinicTimezone` says where the clinic is when they differ.
     * An unlabelled appointment time is a support call waiting to happen.
     *
     * A read: safe to poll, holds nothing, reserves nothing.
     */
    slots: (
      id: string,
      query: ListTelehealthSlotsQuery = {},
      opts?: CallOptions,
    ): Promise<ListTelehealthSlotsResponse> =>
      this.get(`/telehealth-consults/${enc(id)}/slots`, query as RequestArgs['query'], opts),

    /**
     * Take one of the offered slots.
     *
     * The reservation is atomic, so two requests for the same start cannot both
     * succeed: the loser gets `slot_taken` (409) with a fresh `slots` array in
     * `details`, ready to re-render. Retry with a DIFFERENT time, never the
     * same one.
     *
     * Calling this on a consult that already has a time RESCHEDULES it — same
     * consult, same id, same embed session, a different slot.
     */
    book: (
      id: string,
      body: BookTelehealthConsultRequest,
      opts?: CallOptions,
    ): Promise<BookTelehealthConsultResponse> =>
      // NOT idempotent-retried: a retried book after an ambiguous failure could
      // land on a slot the first attempt already took, and the honest answer to
      // "did that work?" is to read `slots` again.
      this.post(`/telehealth-consults/${enc(id)}/book`, body, opts),
  };

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  readonly events = {
    /**
     * Page the durable webhook replay log, oldest first. Every event is stored
     * here BEFORE any delivery attempt, so polling this is a complete
     * substitute for receiving webhooks — and the way to reconcile after your
     * endpoint was down.
     */
    list: (query: ListEventsQuery = {}, opts?: CallOptions): Promise<ListEventsResponse> =>
      this.get('/events', query as RequestArgs['query'], opts),
  };
}
