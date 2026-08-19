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
} from './environments';
import {assertUsableKey, request, type FetchLike, type HttpConfig, type RequestArgs} from './http';
import type {
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
  CreateTelehealthConsultRequest,
  CreateTelehealthConsultResponse,
  CreateUploadUrlsRequest,
  CreateUploadUrlsResponse,
  GetAsyncConsultResponse,
  GetPatientResponse,
  GetPatientStateQuery,
  GetPatientStateResponse,
  GetPhysicianResponse,
  GetTelehealthConsultResponse,
  JoinTelehealthConsultResponse,
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

/** Options accepted by {@link NatzarClient}. */
export interface NatzarClientOptions extends EndpointOverrides {
  /**
   * Your partner API key. SERVER SIDE ONLY — it identifies your tenant and
   * grants full access to it. Browser code gets a short-lived embed session
   * token instead (`agent.embedSession`, `asyncConsults.embedSession`,
   * `telehealth.embedSession`).
   */
  apiKey: string;
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
}

const enc = encodeURIComponent;

// A retried message post is only SAFE when the caller pinned an
// idempotencyKey: the platform dedupes delivery on it, so the retry collapses
// into the first attempt. Without one the server treats each request as a new
// submission, and a retry would put the same clinical message on the patient's
// transcript twice. So retries are armed per call, by the caller, not blanket.
const hasIdempotencyKey = (body: unknown): boolean =>
  !!body && typeof body === 'object' && typeof (body as {idempotencyKey?: unknown}).idempotencyKey === 'string';


// The acting-physician assertion, as a request header. Omitted entirely when
// absent so patient-side calls carry nothing extra.
const physicianHeader = (opts?: CallOptions) =>
  opts?.physicianToken ? {headers: {'X-Natzar-Physician': opts.physicianToken}} : {};

export class NatzarClient {
  /** Which environment this client resolved to. */
  readonly environment: NatzarEnvironment;
  /** The endpoints in use — useful to log once at startup. */
  readonly endpoints: NatzarEndpoints;

  private readonly http: HttpConfig;

  constructor(options: NatzarClientOptions) {
    const apiKey = options.apiKey?.trim() ?? '';
    assertUsableKey(apiKey);
    const resolved = resolveEndpoints(options);
    this.environment = resolved.environment;
    this.endpoints = {baseUrl: resolved.baseUrl, embedOrigin: resolved.embedOrigin};
    this.http = {
      baseUrl: resolved.baseUrl,
      apiKey,
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
      request<UpdatePatientResponse>(this.http, {
        method: 'PATCH',
        path: `/patients/${enc(id)}`,
        body,
        ...(opts?.signal ? {signal: opts.signal} : {}),
      }),

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

    cancel: (id: string, opts?: CallOptions): Promise<CancelTelehealthConsultResponse> =>
      this.post(`/telehealth-consults/${enc(id)}/cancel`, {}, opts),

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
