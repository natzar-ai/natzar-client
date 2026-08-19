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
 * not an existence oracle.
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
   * partner account is suspended. HTTP 401.
   */
  | 'unauthorized'
  /**
   * No such resource in YOUR tenant. Also returned (deliberately, instead of
   * 403) when the id exists but belongs to a different partner. HTTP 404.
   */
  | 'not_found'
  /**
   * The tenant this API key belongs to does not have the requested product
   * enabled (`asyncEnabled` for async consults, `telehealthEnabled` for
   * telehealth). Returned by the consult-creation endpoints. Contact us to
   * enable the feature; retrying will not help. HTTP 409.
   */
  | 'feature_disabled'
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
   */
  | 'thread_not_active'
  /**
   * The acting physician is not the consult's current assignee — replies and
   * resolves are restricted to the assigned physician, and the assignment may
   * have changed under you (SLA reassignment). Re-read the consult; use
   * `claim`/`takeover` to obtain the assignment. HTTP 409.
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
   * `POST /v1/async-consults` / `POST /v1/telehealth-consults`: this API key
   * is not authorized to open a consult ON DEMAND — i.e. from nothing, rather
   * than through an invitation the agent or a physician proposed first (that
   * path never carries this restriction; it doesn't go through your key at
   * all). Async and telehealth are gated independently — a key can hold one
   * without the other. Contact us to enable on-demand access for this key;
   * retrying will not help. HTTP 403.
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
  | 'internal_error';

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
  unauthorized: 401,
  embed_token_invalid: 401,
  embed_token_expired: 401,
  origin_not_allowed: 403,
  on_demand_disabled: 403,
  not_found: 404,
  feature_disabled: 409,
  phone_unavailable: 409,
  email_in_use: 409,
  external_id_conflict: 409,
  has_open_thread: 409,
  thread_not_active: 409,
  not_assigned: 409,
  already_rated: 409,
  already_closed: 409,
  sla_not_overdue: 409,
  message_rejected: 409,
  consult_not_cancellable: 409,
  rate_limited: 429,
  internal_error: 500,
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
