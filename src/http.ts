/**
 * The one place a request is actually made.
 *
 * Everything in `./client` composes into a call to {@link request}: build a
 * URL, attach the key, send, and turn a non-2xx into a typed
 * {@link NatzarApiError}. Keeping that in one function is what makes the
 * client's behaviour under failure describable in a sentence rather than
 * discovered per-endpoint.
 *
 * @packageDocumentation
 */

import {NatzarApiError, codeForStatus, isRetryable, parseApiError} from './errors';

/** The `fetch` this client uses. Injectable so tests need no network. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Everything {@link request} needs that does not change per call. */
export interface HttpConfig {
  /** REST base URL including `/v1`, no trailing slash. */
  baseUrl: string;
  /**
   * The bearer credential: a partner API key (`pp_live_…` / `pp_test_…`), or
   * a physician SESSION token on the browser-side physician surface. Both go
   * out as `Authorization: Bearer …` — the API tells them apart by shape, so
   * the request builder does not have to.
   */
  apiKey: string;
  /** Per-request timeout in milliseconds. Default 30 000. */
  timeoutMs: number;
  /** How many times to re-issue a retryable failure. Default 2. */
  maxRetries: number;
  /** Base backoff in milliseconds; doubled per attempt, with jitter. Default 250. */
  retryBaseMs: number;
  /** Extra headers on every request (tracing, tenant tagging…). */
  headers: Record<string, string>;
  /** The fetch implementation. Defaults to the global one. */
  fetch: FetchLike;
  /** Called once per completed attempt — a hook for logging/metrics. */
  onResponse?: (info: {route: string; status: number; durationMs: number; attempt: number}) => void;
}

export interface RequestArgs {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path after the base URL, starting with `/` and already interpolated. */
  path: string;
  /** Query parameters. `undefined` values are dropped, not sent as "undefined". */
  query?: Record<string, string | number | boolean | undefined>;
  /** JSON body. Omitted entirely when `undefined` — never sent as `null`. */
  body?: unknown;
  /** Abort this individual call (composed with the configured timeout). */
  signal?: AbortSignal;
  /**
   * Whether re-issuing this exact request is safe. Set per route by the
   * client, never guessed from the method: `POST /v1/patients` is an upsert
   * and `POST …/messages` is deduplicated, while `POST …/resolve` is a
   * conditional write whose repeat is a meaningful 409 the caller must see.
   */
  idempotent?: boolean;
  /**
   * Headers for THIS request only, merged over the client-wide ones. Used for
   * the acting-physician assertion, which is per-call by nature: it names the
   * clinician doing this one thing, not the application.
   */
  headers?: Record<string, string>;
}

/** Which bearer credential a client was built with. */
export type CredentialKind = 'apiKey' | 'sessionToken';

// A physician session token is a compact JWS — three base64url segments. Like
// the key-prefix test below this is a SHAPE check, not a validation: the
// platform verifies the signature and expiry. What it catches is the class of
// mistake that otherwise surfaces as a bare 401 indistinguishable from an
// expired session: a mint response that was never awaited, an empty value out
// of a store, or the partner key handed over where the session belongs.
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * A partner key that never left the server is the entire security model of
 * this API, so the client says so out loud rather than letting a browser
 * bundle discover it in production. The check is a prefix test, not a
 * validation: a wrong-but-well-formed key is the server's business, while
 * "the Amplify secret did not resolve and we are about to send the literal
 * placeholder as a bearer token" is a mistake worth naming here — it comes
 * back as a bare 401 that looks exactly like a revoked key.
 *
 * With `kind: 'sessionToken'` the same check applies to a physician SESSION
 * token (the browser-side credential): it must have the three-segment JWT
 * shape. Each message names the credential it was checking and, when the
 * value plainly belongs to the OTHER slot, says so — swapping the two is the
 * likeliest wiring mistake and the one the server answers least helpfully.
 */
export function assertUsableKey(value: string, kind: CredentialKind = 'apiKey'): void {
  const shown = value ? `"${value.slice(0, 12)}…"` : 'an empty value';
  if (kind === 'sessionToken') {
    if (!value || !JWT_SHAPE.test(value)) {
      throw new Error(
        'natzar-client: sessionToken must be a physician session token — the `sessionToken` of a ' +
          '`POST /v1/physicians/{id}/session` mint, a three-segment JWT. Got ' +
          shown +
          (/^pp_(?:live|test)_/.test(value)
            ? '. That is a partner key: it belongs in `apiKey`, and only on your server.'
            : '. If this came from your own session exchange, the mint most likely failed or was never awaited.'),
      );
    }
    return;
  }
  if (!value || !/^pp_(?:live|test)_/.test(value)) {
    throw new Error(
      'natzar-client: apiKey must be a partner key (pp_live_… or pp_test_…). ' +
        'Got ' +
        shown +
        (JWT_SHAPE.test(value)
          ? '. That looks like a physician session token: pass it as `sessionToken` instead.'
          : '. If this came from a secret manager, the secret most likely did not resolve.'),
    );
  }
}

function buildUrl(baseUrl: string, path: string, query: RequestArgs['query']): string {
  const url = `${baseUrl}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Compose the caller's abort signal with a timeout, without requiring
 * `AbortSignal.any` (Node 18 lacks it).
 */
function withTimeout(timeoutMs: number, signal?: AbortSignal): {signal: AbortSignal; done: () => void} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, {once: true});
  }
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * Issue one API request and return its parsed body.
 *
 * Retries only what is worth retrying (`429`, `5xx`, and network faults) and
 * only for methods where a retry is safe by construction: GETs, and the POSTs
 * the contract documents as idempotent or deduplicated. A lifecycle POST that
 * failed mid-flight is NOT re-sent — the API answers a repeat with a
 * descriptive 409 rather than double-applying, and surfacing that 409 to the
 * caller is more honest than swallowing it inside a retry loop.
 */
export async function request<T>(config: HttpConfig, args: RequestArgs): Promise<T> {
  const route = `${args.method} ${args.path}`;
  const url = buildUrl(config.baseUrl, args.path, args.query);
  const hasBody = args.body !== undefined;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const startedAt = Date.now();
    const {signal, done} = withTimeout(config.timeoutMs, args.signal);
    let response: Response;
    try {
      response = await config.fetch(url, {
        method: args.method,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          Accept: 'application/json',
          ...(hasBody ? {'Content-Type': 'application/json'} : {}),
          ...config.headers,
          ...args.headers,
        },
        ...(hasBody ? {body: JSON.stringify(args.body)} : {}),
        signal,
      });
    } catch (cause) {
      done();
      // A transport failure (DNS, reset, timeout) is the one case with no
      // status to reason from. Treat it as retryable, then give up with a
      // 5xx-class error so callers have the same shape to catch.
      const safeToRepeat = args.method === 'GET' || args.idempotent === true;
      if (safeToRepeat && attempt < config.maxRetries && args.signal?.aborted !== true) {
        await sleep(config.retryBaseMs * 2 ** attempt * (0.5 + Math.random()));
        attempt++;
        continue;
      }
      throw new NatzarApiError({
        code: 'internal_error',
        status: 0,
        route,
        message: `Could not reach the Natzar API: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
    }
    done();

    const text = await response.text();
    config.onResponse?.({route, status: response.status, durationMs: Date.now() - startedAt, attempt});

    if (response.ok) {
      // 202/204 bodies may be empty; an endpoint returning nothing is not an
      // error, it is a response with no fields.
      return (text ? (JSON.parse(text) as T) : ({} as T));
    }

    const envelope = parseApiError(text);
    const error = new NatzarApiError({
      code: envelope?.code ?? codeForStatus(response.status),
      status: response.status,
      route,
      message: envelope?.message ?? `${response.status} ${response.statusText || 'error'}`,
      ...(envelope?.details !== undefined ? {details: envelope.details} : {}),
      ...(envelope ? {} : {rawBody: text.slice(0, 2000)}),
    });

    const retryable = isRetryable(error) && (args.method === 'GET' || args.idempotent === true);
    if (retryable && attempt < config.maxRetries) {
      // Honour Retry-After when the gateway sends one; otherwise exponential
      // backoff with jitter so a fleet of clients does not resynchronize.
      const retryAfter = Number(response.headers.get('retry-after'));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : config.retryBaseMs * 2 ** attempt * (0.5 + Math.random());
      await sleep(wait);
      attempt++;
      continue;
    }
    throw error;
  }
}
