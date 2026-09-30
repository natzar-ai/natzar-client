// GENERATED FILE — do not edit.
//
// Copied verbatim from provider-portal's shared/partner-api by
// scripts/sync-contract.mjs. Edit the source there; this copy exists only so
// the published package is self-contained.
/**
 * Error model of the Natzar Partner API.
 *
 * Every non-2xx response carries a JSON body of shape {@link ApiError}:
 *
 * ```json
 * {"error": {"code": "has_open_thread", "message": "Patient already has an open async consult", "details": {"asyncConsultId": "aB3xK9mQpZ4r"}}}
 * ```
 *
 * `code` is machine-readable and stable — branch on it, never on `message`
 * (wording may change without notice). The HTTP status is fully determined by
 * the code via {@link httpStatusFor}; conflict-class codes (409) correspond to
 * conditional-write failures on the underlying consult state machine, which
 * means the state you observed via GET is stale — re-read and retry if the
 * operation still makes sense.
 *
 * Cross-tenant access NEVER yields 403: a resource belonging to another
 * partner is indistinguishable from a missing one (`not_found`), so ids are
 * not an existence oracle. The 403 codes are all about YOUR credential's
 * authority (`forbidden`, `key_capability_disabled`, `on_demand_disabled`,
 * `origin_not_allowed`, and on the provider embed routes
 * `provider_embed_disabled`, `delegation_not_allowed`,
 * `clinician_unavailable`, `capability_not_granted`,
 * `operation_not_available`), never about whether something exists.
 *
 * @packageDocumentation
 */

/**
 * Machine-readable error code. Stable across API versions within `/v1`;
 * new codes MAY be added, so treat unknown codes as their HTTP class
 * (4xx = your request, 5xx = ours).
 */
export type ErrorCode =
  /**
   * The request body or query string failed validation (missing/unknown
   * field, malformed phone, oversize value, …). `details` carries the
   * per-field issues. Fix the request; retrying unchanged will fail again.
   * HTTP 400.
   */
  | 'invalid_request'
  /**
   * The `Authorization: Bearer pp_…` API key is missing, malformed, revoked,
   * from another environment (`pp_test_…` against prod or vice versa), or the
   * partner account is suspended. Also returned when a physician SESSION
   * token in that header is malformed, expired, or was invalidated by an
   * API-key rotation (mint a fresh one via `POST /v1/physicians/{id}/session`),
   * and when a route that needs a physician credential got none — the
   * message lists the three accepted forms. HTTP 401.
   */
  | 'unauthorized'
  /**
   * The credential is VALID but may not do this. Distinct from
   * `unauthorized` (we could not tell who you are) — here we know exactly who
   * you are, and the answer is no. Raised by the physician-side surface:
   *
   * - a physician SESSION token (`Authorization: Bearer <session>`) called a
   *   route outside the physician allowlist (creating consults, minting embed
   *   sessions, listing physicians, minting another session, …) — those need
   *   the tenant API key;
   * - `X-Natzar-Physician-Id` was sent by a key whose partner account has
   *   physician assertion switched off (`capabilities.physicianAssertion ===
   *   false`) — send the clinician's Cognito ID token in `X-Natzar-Physician`,
   *   or mint a physician session with the key instead.
   *
   * Never returned for a resource that merely belongs to someone else — that
   * stays `not_found`. Retrying unchanged will fail again. HTTP 403.
   */
  | 'forbidden'
  /**
   * No such resource in YOUR tenant. Also returned (deliberately, instead of
   * 403) when the id exists but belongs to a different partner. HTTP 404.
   */
  | 'not_found'
  /**
   * The tenant this API key belongs to does not have the requested product
   * enabled at all — the MODALITY is off (`asyncEnabled` for async consults,
   * `telehealthEnabled` for telehealth), so neither mode of it can be
   * created. Returned by the consult-creation endpoints. Contact us to
   * enable the feature; retrying will not help. HTTP 409.
   *
   * Its narrower siblings tell you the refusal was NOT "you don't have this
   * product": {@link ErrorCode | `mode_disabled`} (the tenant runs the
   * modality, but not the mode you asked for) and
   * {@link ErrorCode | `key_capability_disabled`} (the tenant runs it, your
   * key is not licensed for it). Branching only on `feature_disabled`
   * remains safe — those two are additions, and a client that treats every
   * one of the three as "not available here" is correct.
   */
  | 'feature_disabled'
  /**
   * The tenant offers this modality, but not in the MODE you asked for —
   * e.g. `POST /v1/telehealth-consults` with `mode: "scheduled"` against a
   * tenant that runs the live queue and has never turned booking on. Read
   * `capabilities` from `GET /v1/patients/state` to see which modes are
   * live; contact the tenant to have the other one enabled. HTTP 409.
   */
  | 'mode_disabled'
  /**
   * The mode you asked for does not exist for that modality, in any tenant —
   * today only in-person visits, which are always for a time and therefore
   * have no `live` mode. A request shape error, not a configuration one:
   * no tenant can enable it. HTTP 400.
   */
  | 'mode_not_supported'
  /**
   * The TENANT offers this scenario, but THIS API key is not licensed for it.
   * A key can only ever narrow its tenant's capabilities, never widen them,
   * and an operator has narrowed this one. Distinct from
   * {@link ErrorCode | `on_demand_disabled`}, which is about who may
   * INITIATE; this is about whether the key participates in the scenario at
   * all. Contact us to widen the key; retrying will not help. HTTP 403.
   */
  | 'key_capability_disabled'
  /**
   * `POST /v1/patients`: the phone number is already registered — either to a
   * patient outside your tenant, or to a DIFFERENT patient (other
   * `externalId`) inside it. Phone numbers are a global identity key (they
   * drive login and message serialization), so they cannot be shared or
   * reassigned via upsert. No further detail is disclosed. HTTP 409.
   */
  | 'phone_unavailable'
  /**
   * `POST /v1/physicians`: a portal account with this email already exists.
   * Physician accounts are keyed by email in our identity pool; use a
   * different address or contact us to reconcile. HTTP 409.
   */
  | 'email_in_use'
  /**
   * `POST /v1/physicians`: this `externalId` is already registered, and the
   * portal account behind it signs in with a DIFFERENT email than the one you
   * posted. A repeat POST is idempotent only when it is identical (same
   * `externalId`, same email case-insensitively → 200, names refreshed); it
   * is refused as a conflict otherwise, because the portal account is keyed
   * by email and silently ignoring the new address would leave your systems
   * holding a wrong mapping. Changing a physician's sign-in email is not
   * supported over the API — contact us to reconcile. HTTP 409.
   */
  | 'external_id_conflict'
  /**
   * `POST /v1/async-consults`: the patient already has an open async consult
   * (`invited`/`queued`/`active`/`resolve_requested`). One open thread per
   * patient is an invariant; close or resolve the existing one first
   * (`details.asyncConsultId` identifies it). HTTP 409.
   */
  | 'has_open_thread'
  /**
   * The operation requires the async consult to be in an open, routable state
   * and it is not — e.g. posting a patient message to a thread that is
   * `closed` or still `invited` (unconsented). Re-read the consult for its
   * current status. HTTP 409.
   *
   * Also `POST /v1/billing/visit-checkout` keyed on a consult that can no
   * longer be paid for — not an open invite any more, or its link expired
   * (`details.status`, `"expired"` for the latter). Nothing was charged.
   *
   * Also `GET /v1/telehealth-consults/{id}/slots` and `…/book` on a booking
   * invite a physician or the agent sent whose booking window lapsed before
   * a time was chosen (`details.status: "expired"`) — the same answer the
   * consult-keyed checkout gives it. A payment already made for that invite
   * keeps it bookable. Consults you created carry no window.
   *
   * Also `POST /v1/async-consults/{id}/consent` with `accept: false` on an
   * invite the patient has already PAID for (`details.reason:
   * "payment_settled"`, `details.status: "invited"`): paying is consenting,
   * so the decline is refused rather than leave the payment buying nothing.
   * Send `accept: true` instead — the payment bound to the invite is adopted,
   * no `paymentId` needed.
   */
  | 'thread_not_active'
  /**
   * The async consult is a non-blocking `referral_request` (see
   * `AsyncConsultKind`), which carries no dialogue: neither the patient's
   * messages (`POST …/messages`) nor a physician reply (`POST …/replies`)
   * belong on it. The physician answers it with a referral, or converts it
   * to a `conversation` first. HTTP 409.
   */
  | 'request_thread'
  /**
   * The acting physician is not the consult's current assignee — replies,
   * resolves, escalations and physician-side closes are restricted to the
   * assigned physician, and the assignment may have changed under you (SLA
   * reassignment). Re-read the consult; use `claim`/`takeover` to obtain the
   * assignment. The telehealth twin: `room`/`end`/`ready` on a consult whose
   * `practitioner` is somebody else (or nobody yet). HTTP 409.
   */
  | 'not_assigned'
  /**
   * A rating was already recorded for this consult. Ratings are write-once.
   * HTTP 409.
   */
  | 'already_rated'
  /**
   * The consult is already in a terminal state, so close/cancel (or another
   * lifecycle write) has nothing to do. The stored `closedReason`/`status`
   * tells you how it ended. HTTP 409.
   */
  | 'already_closed'
  /**
   * `POST /v1/async-consults/{id}/takeover`: the current assignee's response
   * SLA has not elapsed, so the thread cannot be forcibly taken over yet. Use
   * `claim` semantics or wait for the SLA. HTTP 409.
   */
  | 'sla_not_overdue'
  /**
   * A posted message could not be accepted for delivery — for example the
   * thread closed between your read and the write, or the message was empty
   * after normalization. Note the asynchronous sibling: a message that passes
   * validation (202) but whose thread closes before processing is reported
   * via the `async_consult.message_rejected` webhook, not this code.
   * HTTP 409.
   */
  | 'message_rejected'
  /**
   * `POST /v1/telehealth-consults/{id}/cancel`: cancellation is only allowed
   * from `invited` or `waiting`; the consult has already started or ended.
   * HTTP 409.
   */
  | 'consult_not_cancellable'
  /**
   * `POST /v1/telehealth-consults/{id}/book`: the requested start is no longer
   * offerable — somebody took it in the moments between reading `/slots` and
   * booking, or it never was on offer for this consult's specialty.
   *
   * This is the ONLY honest answer to a lost race, and it is deliberately not
   * an internal error: the reservation is a conditional write, so exactly one
   * of two simultaneous requests wins and the other must be told plainly. The
   * `details` carry a FRESH `slots` array, so a retry is against times that
   * still exist rather than the same one again. HTTP 409.
   */
  | 'slot_taken'
  /**
   * `POST /v1/telehealth-consults/{id}/book`: the patient already holds as
   * many upcoming appointments as the platform allows one person at a time
   * (`details.maxOpen`), counted over their booked consults whose start has
   * not passed. An abuse guard, not a clinic setting: a patient is expected
   * to cancel or attend before booking more. Moving an EXISTING appointment
   * (a `book` on a consult that already has one) is exempt — it never adds
   * one. Cancel one first, or wait for it to happen; retrying unchanged
   * fails again. HTTP 409.
   */
  | 'too_many_open_bookings'
  /**
   * The tenant charges for this visit and the request carried no
   * `paymentId` that entitles it. Returned by `POST /v1/async-consults`
   * (`consent: "collected"`), `POST /v1/async-consults/{id}/consent`
   * (`accept: true`), `POST /v1/telehealth-consults/{id}/join` (an unpaid
   * on-demand video consult — nobody is queued) and
   * `POST /v1/telehealth-consults/{id}/book` on a priced scenario.
   * `details.amountCents` / `details.currency` say what is owed and
   * `details.modality` / `details.mode` which scenario — exactly what
   * `POST /v1/billing/visit-checkout` takes. A `paymentId` is the id of a
   * Payment row in `paid` for THIS patient and THIS scenario — minted by
   * `POST /v1/billing/visit-checkout` (preferably keyed on the consult:
   * `{asyncConsultId}` / `{telehealthConsultId}`; then confirm `paid` with
   * `GET /v1/billing/payments/{id}` before retrying) or by the platform's own
   * checkout. A checkout keyed on the consult is BOUND to it: once paid, the
   * retry is let in without the id. See docs/partner-api/guides/payments.md.
   * HTTP 402.
   */
  | 'payment_required'
  /**
   * The `paymentId` you sent names a payment that does not entitle this
   * visit: it is not `paid` yet (`details.reason: "payment_not_completed"`),
   * belongs to another patient, tenant or scenario (`"payment_mismatch"`),
   * or already bought a different visit (`"payment_already_used"`). Also
   * returned, as `"payment_check_failed"`, when the payment could not be
   * verified at all — that one is safe to retry. HTTP 402.
   *
   * `"payment_not_completed"` also answers an action sent WITHOUT a
   * `paymentId` while a checkout bound to the consult is still in progress
   * (the patient is on Stripe's form, or it just completed and the platform
   * has not confirmed it yet): wait for `paid` rather than starting another
   * checkout — `POST /v1/billing/visit-checkout` for the same consult hands
   * the one in progress back. `details` carry `amountCents` / `currency`
   * there too, and `modality` / `mode` whenever the route knows the
   * scenario.
   *
   * A DECLINE (`POST /v1/async-consults/{id}/consent`, `accept: false`) can
   * draw two of these reasons although it pays for nothing, because a
   * decline must not strand a payment: `"payment_not_completed"` while a
   * checkout bound to the invite is still in progress (let it settle — once
   * `paid`, accept instead; a checkout that ends unpaid no longer blocks the
   * decline), and `"payment_check_failed"` when the platform could not tell
   * whether the invite was paid for (retry; the invite is left as it was).
   * A decline of an invite already paid for is `409 thread_not_active`
   * instead.
   *
   * On `POST /v1/async-consults`, `"payment_already_used"` carries
   * `details.asyncConsultId` when the payment bought an async consult of the
   * SAME patient — typically the create you are retrying, or a concurrent
   * one that won the payment — so you can take that thread without
   * listing. A `referral_request` create refused with `payment_invalid`
   * (any reason) leaves no open thread behind: one refused after the mint
   * (it lost a race for the payment) is closed before the refusal.
   */
  | 'payment_invalid'
  /**
   * `POST /v1/prescriptions/{id}/pharmacy`: no pharmacy answers to that
   * `directoryId` — it is not from a `GET …/pharmacies` listing of THIS
   * deployment, or the directory dropped it. A 404 on the pharmacy, not on
   * the prescription (which resolved). Re-run the search and pick again.
   * HTTP 404.
   */
  | 'pharmacy_not_found'
  /**
   * The prescription is not waiting for a pharmacy: it was already chosen
   * (`transmitting`/`sent`), withdrawn (`revoked`), or its 24-hour link
   * lapsed (`expired`) — including when somebody else chose a moment before
   * you (the platform's own widget, the app, the web page). `details.status`
   * is the effective status; re-read `GET /v1/prescriptions/{id}` and render
   * its `action`. HTTP 409.
   */
  | 'prescription_not_choosable'
  /**
   * `POST /v1/prescriptions/{id}/pharmacy`: the chosen pharmacy cannot be
   * reached by this deployment's transport — in a fax jurisdiction, no
   * verified fax line on file. The listing said so (`reachable: false`);
   * offer another pharmacy, or add the line with `POST …/pharmacies` and let
   * it be verified. HTTP 409.
   */
  | 'pharmacy_unreachable'
  /**
   * `POST /v1/prescriptions/{id}/pharmacies`: adding a pharmacy by hand is
   * not offered here — the prescription is e-prescribed (`transport: 'erx'`,
   * the network already lists every pharmacy it can reach), or this
   * deployment holds no directory to add it to. Never a transient condition;
   * retrying will not help. HTTP 409.
   */
  | 'pharmacy_add_unavailable'
  /**
   * `POST /v1/prescriptions/{id}/home-location`: the coordinates are not a
   * place on Earth (latitude outside ±90, longitude outside ±180, NaN).
   * Distinct from `invalid_request` (the shape was fine; the values are not
   * a location). HTTP 422.
   */
  | 'invalid_location'
  /**
   * `POST /v1/prescriptions/{id}/pharmacies`: the pharmacy as typed cannot
   * be placed — `details.code` says why (`name_or_address_missing`, or the
   * directory normaliser's reason, e.g. a province it cannot resolve).
   * Distinct from `invalid_request` (the shape was fine). HTTP 422.
   */
  | 'invalid_pharmacy'
  /**
   * Embed surface only: the session token failed verification (bad signature,
   * wrong shape, minted for a suspended partner, or invalidated by an API-key
   * rotation). Mint a fresh one via the `/embed-session` endpoint. HTTP 401.
   */
  | 'embed_token_invalid'
  /**
   * Embed surface only: the session token's `exp` has passed. Tokens live
   * 1 hour by default; mint a fresh one via `/embed-session` and call the
   * element's `refresh(token)`. HTTP 401.
   */
  | 'embed_token_expired'
  /**
   * Embed surface only: the page embedding the widget is served from an
   * origin that is not on your partner account's `allowedOrigins` list.
   * HTTP 403.
   */
  | 'origin_not_allowed'
  /**
   * `POST /v1/async-consults` / `POST /v1/telehealth-consults`: this consult
   * may not be opened ON DEMAND — i.e. from nothing, rather than through an
   * invitation the agent or a physician proposed first (that path never
   * carries this restriction; it doesn't go through your key at all).
   *
   * TWO levels can withhold it and both answer with this code: the TENANT may
   * have decided patients never request this scenario directly (it is offered
   * on clinical judgement only), or YOUR KEY may not hold on-demand access
   * for it. The `message` says which. Async and telehealth are gated
   * independently at both levels — a key can hold one without the other.
   * Retrying will not help. HTTP 403.
   */
  | 'on_demand_disabled'
  /**
   * Too many requests. Back off and retry with jitter; the gateway may also
   * respond 429 without a JSON body when throttling before the application
   * layer. HTTP 429.
   */
  | 'rate_limited'
  /**
   * Unexpected server-side failure. Safe to retry idempotent requests
   * (GETs, upserts); message posts are deduplicated per patient so a retry
   * after a 5xx will not double-deliver. HTTP 500.
   */
  | 'internal_error'
  /**
   * Provider embed routes only: the provider session credential is missing,
   * malformed or unknown, its secret is wrong, it belongs to another
   * environment or residency zone, or a legacy bearer credential (API key,
   * physician session token, patient embed token) was presented instead.
   * (An `X-Api-Key`, `X-Natzar-Physician` or `X-Natzar-Physician-Id` header
   * on these routes is `invalid_request` with `details.reason`
   * `'conflicting_credentials'` instead.) Mint a new session from your
   * server. HTTP 401.
   */
  | 'provider_session_invalid'
  /**
   * Provider embed routes only: the access credential expired. Renew the
   * SAME session from your server
   * (`POST /v1/provider-embed/sessions/{sessionId}/renew`); the loader does
   * this through your `getSession` callback. HTTP 401.
   */
  | 'provider_session_expired'
  /**
   * Provider embed routes only: the logical session reached its absolute
   * lifetime. Renewal cannot extend it; mint a new session. HTTP 401.
   */
  | 'provider_session_ended'
  /**
   * Provider embed routes only: the session was revoked — by your server, by
   * logout, or by a partner, policy or clinician change. Mint a new session
   * only if the user is still entitled to one. HTTP 401.
   */
  | 'provider_session_revoked'
  /**
   * Provider embed routes only: the session locked after inactivity. Mint a
   * new session after the user interacts again. HTTP 401.
   */
  | 'provider_session_locked'
  /**
   * Provider embed session routes only, verified mode: the clinician's
   * Cognito ID token is invalid or expired, or its subject is not the named
   * clinician. HTTP 401.
   */
  | 'clinician_proof_invalid'
  /**
   * The provider embed is disabled for your account: no or malformed
   * provider embed policy, the policy is switched off, no parent origins are
   * configured, or an operator switched it off. Retrying will not help.
   * HTTP 403.
   */
  | 'provider_embed_disabled'
  /**
   * The authentication method of this mint or renewal (`delegated` or
   * `verified`) is not permitted by your provider embed delegation policy.
   * HTTP 403.
   */
  | 'delegation_not_allowed'
  /**
   * The clinician in your tenant cannot act: the account is not a physician
   * or is disabled. HTTP 403.
   */
  | 'clinician_unavailable'
  /**
   * A required capability was not granted at mint, or is no longer allowed
   * for the session. `details` names it. HTTP 403.
   */
  | 'capability_not_granted'
  /**
   * The operation is not available in this session's mode, for this
   * consultation kind, or in this deployment. HTTP 403.
   */
  | 'operation_not_available'
  /**
   * The same `Idempotency-Key` was already used with a different request
   * body. Use a new key for a new request. HTTP 409.
   */
  | 'idempotency_conflict'
  /**
   * A request with the same `Idempotency-Key` is still executing. Retry the
   * same request after `Retry-After`. HTTP 409.
   */
  | 'idempotency_in_progress'
  /**
   * Presence or media ownership is held by another session of the same
   * clinician. HTTP 409.
   */
  | 'lease_conflict'
  /**
   * A concurrent renewal of the same session won elsewhere. Use the grant
   * that renewal returned. HTTP 409.
   */
  | 'renew_conflict'
  /**
   * The prescriber's licence does not cover the patient's jurisdiction under
   * the tenant's licensure enforcement. HTTP 409.
   */
  | 'prescriber_not_eligible'
  /**
   * The cursor was tampered with, expired, or belongs to another session or
   * query. Restart the listing without a cursor. HTTP 400.
   */
  | 'cursor_invalid'
  /**
   * The stored upload failed size, type or signature verification and was
   * not accepted. HTTP 422.
   */
  | 'upload_rejected'
  /**
   * An authorization dependency failed, so the request was refused rather
   * than allowed. Retry later with backoff. HTTP 503.
   *
   * On the video routes (`/join`, `/room`, `/ready`) it also means the
   * platform could not confirm the consult's current room right now, so it
   * handed out no grant rather than a possibly stale one. It is never "the
   * call is over": pull again with backoff.
   */
  | 'dependency_unavailable';

/**
 * The JSON body of every error response.
 *
 * @remarks
 * `details` is intentionally loose: for `invalid_request` it contains the
 * validation issues (field paths + messages); for conflict codes it may carry
 * the conflicting resource id (e.g. `{asyncConsultId}` on
 * `has_open_thread`). Never required for handling — `code` alone is enough
 * to branch on.
 */
export interface ApiError {
  error: {
    /** Stable machine-readable code — see {@link ErrorCode} for semantics. */
    code: ErrorCode;
    /** Human-readable explanation for logs/debugging. Wording is NOT stable. */
    message: string;
    /** Optional structured context (validation issues, conflicting ids, …). */
    details?: unknown;
  };
}

/**
 * The single source of truth mapping each {@link ErrorCode} to its HTTP
 * status. The server derives response statuses from this table, so client
 * and server can never disagree about a code's class.
 */
export const ERROR_HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  invalid_request: 400,
  mode_not_supported: 400,
  unauthorized: 401,
  embed_token_invalid: 401,
  embed_token_expired: 401,
  forbidden: 403,
  origin_not_allowed: 403,
  on_demand_disabled: 403,
  key_capability_disabled: 403,
  not_found: 404,
  feature_disabled: 409,
  mode_disabled: 409,
  phone_unavailable: 409,
  email_in_use: 409,
  external_id_conflict: 409,
  has_open_thread: 409,
  thread_not_active: 409,
  request_thread: 409,
  not_assigned: 409,
  already_rated: 409,
  already_closed: 409,
  sla_not_overdue: 409,
  message_rejected: 409,
  consult_not_cancellable: 409,
  slot_taken: 409,
  too_many_open_bookings: 409,
  payment_required: 402,
  payment_invalid: 402,
  pharmacy_not_found: 404,
  prescription_not_choosable: 409,
  pharmacy_unreachable: 409,
  pharmacy_add_unavailable: 409,
  invalid_location: 422,
  invalid_pharmacy: 422,
  rate_limited: 429,
  internal_error: 500,
  provider_session_invalid: 401,
  provider_session_expired: 401,
  provider_session_ended: 401,
  provider_session_revoked: 401,
  provider_session_locked: 401,
  clinician_proof_invalid: 401,
  provider_embed_disabled: 403,
  delegation_not_allowed: 403,
  clinician_unavailable: 403,
  capability_not_granted: 403,
  operation_not_available: 403,
  idempotency_conflict: 409,
  idempotency_in_progress: 409,
  lease_conflict: 409,
  renew_conflict: 409,
  prescriber_not_eligible: 409,
  cursor_invalid: 400,
  upload_rejected: 422,
  dependency_unavailable: 503,
};

/**
 * HTTP status for a given error code.
 *
 * @param code - Any {@link ErrorCode}.
 * @returns The HTTP status the API responds with for that code.
 */
export function httpStatusFor(code: ErrorCode): number {
  return ERROR_HTTP_STATUS[code];
}
