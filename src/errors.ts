/**
 * The error the client throws, and the predicates worth branching on.
 *
 * Every non-2xx response becomes a {@link NatzarApiError} carrying the API's
 * own machine-readable `code`. Branch on `code`, never on `message`: the
 * wording is explicitly not stable, the code is.
 *
 * @packageDocumentation
 */

import type {ApiError, ErrorCode} from './contract/errors';

/**
 * A non-2xx response from the Natzar API.
 *
 * `code` is the contract's {@link ErrorCode} whenever the body carried one.
 * When it did not — a gateway 502, an HTML error page, a throttle that never
 * reached the application — the code is inferred from the HTTP class
 * (`rate_limited` for 429, `internal_error` for 5xx, `invalid_request`
 * otherwise) so callers always have exactly one thing to switch on.
 */
export class NatzarApiError extends Error {
  readonly name = 'NatzarApiError';
  /** Stable machine-readable code. */
  readonly code: ErrorCode;
  /** HTTP status of the response. */
  readonly status: number;
  /** Structured context: validation issues, conflicting ids… */
  readonly details?: unknown;
  /** `METHOD /path` of the request that failed — the first thing you want in a log. */
  readonly route: string;
  /** The raw response body, when it was not the documented JSON envelope. */
  readonly rawBody?: string;

  constructor(args: {
    code: ErrorCode;
    status: number;
    message: string;
    route: string;
    details?: unknown;
    rawBody?: string;
  }) {
    super(args.message);
    this.code = args.code;
    this.status = args.status;
    this.route = args.route;
    if (args.details !== undefined) this.details = args.details;
    if (args.rawBody !== undefined) this.rawBody = args.rawBody;
  }
}

/** True for a {@link NatzarApiError}, across realms (no instanceof trap). */
export function isNatzarApiError(e: unknown): e is NatzarApiError {
  return !!e && typeof e === 'object' && (e as {name?: string}).name === 'NatzarApiError';
}

/** True when this error is that specific code — the common branch, spelled once. */
export function isErrorCode(e: unknown, code: ErrorCode): boolean {
  return isNatzarApiError(e) && e.code === code;
}

/**
 * Codes worth ONE automatic retry with backoff. Everything else is either the
 * caller's request (fix it) or a state conflict (re-read, then decide) — both
 * of which a blind retry only makes slower.
 */
const RETRYABLE = new Set<ErrorCode>(['rate_limited', 'internal_error']);

/** Whether the client's built-in retry should re-issue this request. */
export function isRetryable(e: unknown): boolean {
  return isNatzarApiError(e) && RETRYABLE.has(e.code);
}

/** Best-effort read of the documented `{error: {...}}` envelope. */
export function parseApiError(body: string): ApiError['error'] | null {
  try {
    const parsed = JSON.parse(body) as Partial<ApiError>;
    const err = parsed?.error;
    if (err && typeof err.code === 'string' && typeof err.message === 'string') {
      return err as ApiError['error'];
    }
  } catch {
    /* not JSON — a gateway page, an empty body */
  }
  return null;
}

/**
 * The code to use when the response body did not carry one.
 *
 * A bare 403 is `forbidden` — the API's own word for "we know who you are and
 * the answer is no", and what the gateway's un-enveloped denials mean too (a
 * physician session token on a route outside its allowlist arrives as one).
 * `origin_not_allowed` is only ever sent WITH an envelope, so mapping the bare
 * status onto it named a cause the response never claimed.
 */
export function codeForStatus(status: number): ErrorCode {
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'internal_error';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  return 'invalid_request';
}
