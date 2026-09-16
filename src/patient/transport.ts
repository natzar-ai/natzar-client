// Transport for the PATIENT-side surface — the half that runs in a browser.
//
// The server half of this SDK authenticates with a `pp_live_`/`pp_test_` key,
// which must never reach a browser: it is tenant-scoped and can read every
// patient you have. That single fact is why partners were building a
// backend-for-frontend — hundreds of lines of Lambda whose entire job was
// relaying typed calls to their own front end.
//
// They do not need one. The platform already exposes a patient-scoped surface
// designed for exactly this: the embed operations, authenticated by a
// short-lived SESSION TOKEN your server mints for one patient (and, for consult
// sessions, one consult). The API key on that surface is public and is only the
// transport — the same split as Stripe's secret vs publishable keys.
//
// We reuse that existing, deployed, contract-documented surface rather than
// inventing a private protocol between two halves of this package. A private
// wire is the thing that drifts: it has no independent spec, nothing else
// exercises it, and it breaks silently on version skew.

import {NatzarApiError} from '../errors';
import {NatzarSessionError} from '../session-error';
import type {ErrorCode} from '../contract/index';

/**
 * Everything the browser needs to talk to the patient surface — exactly the
 * response your server got from a `/embed-session` mint. Hand it over as-is.
 */
export interface PatientSession {
  /** The patient-scoped credential. Short-lived; see {@link expiresAt}. */
  sessionToken: string;
  /** When {@link sessionToken} stops working. */
  expiresAt?: string;
  /** Patient-surface endpoint, returned with the mint so nothing is baked in. */
  graphqlUrl?: string;
  /** Public transport key, returned with the mint (it rotates). */
  publicApiKey?: string;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface TransportOptions {
  fetch?: FetchLike;
  /** Per-request timeout. @defaultValue 30000 */
  timeoutMs?: number;
}

// The session error is shared with the physician surface (../session-error) so
// one `catch` recognises it whichever entry point minted the session; it is
// re-exported here so this module's public surface is unchanged.
export {NatzarSessionError};

export function assertConnectable(session: PatientSession): asserts session is Required<Pick<PatientSession, 'sessionToken' | 'graphqlUrl' | 'publicApiKey'>> & PatientSession {
  if (!session?.sessionToken) {
    throw new NatzarSessionError('This session has no sessionToken.');
  }
  if (!session.graphqlUrl || !session.publicApiKey) {
    // Older deployments minted tokens without connection details. Say so
    // precisely — the alternative is a confusing failure deep inside fetch.
    throw new NatzarSessionError(
      'This session did not include graphqlUrl/publicApiKey, so the browser cannot connect directly. ' +
        'Your Natzar deployment predates self-describing sessions — upgrade it, or relay calls through your own server.',
    );
  }
}

/**
 * One patient-surface call.
 *
 * Returns the operation's payload already unwrapped, and converts both GraphQL
 * errors and the surface's own `{ok: false, error}` results into the SAME
 * {@link NatzarApiError} the server half throws — so a partner writes one error
 * path, not two.
 */
export async function callPatientOp<T>(
  session: PatientSession,
  op: {kind: 'query' | 'mutation'; name: string; args: Record<string, unknown>},
  options: TransportOptions = {},
  signal?: AbortSignal,
): Promise<T> {
  assertConnectable(session);
  const doFetch = options.fetch ?? globalThis.fetch;
  if (!doFetch) throw new NatzarSessionError('No fetch implementation available.');

  // Arguments are passed as GraphQL VARIABLES, never interpolated into the
  // document — the token is a credential and string-building a query with it
  // is how credentials end up in logs and error messages.
  const argNames = Object.keys(op.args).filter((k) => op.args[k] !== undefined);
  const varDefs = argNames.map((k) => `$${k}: ${gqlTypeFor(k)}`).join(', ');
  const argList = argNames.map((k) => `${k}: $${k}`).join(', ');
  const document = `${op.kind} Op${varDefs ? `(${varDefs})` : ''} { ${op.name}${argList ? `(${argList})` : ''} }`;

  const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000);
  const composed = signal ? anySignal([signal, timeout]) : timeout;

  const response = await doFetch(session.graphqlUrl!, {
    method: 'POST',
    headers: {'content-type': 'application/json', 'x-api-key': session.publicApiKey!},
    body: JSON.stringify({
      query: document,
      variables: Object.fromEntries(argNames.map((k) => [k, op.args[k]])),
    }),
    signal: composed,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new NatzarApiError({
      code: response.status === 401 ? 'embed_token_invalid' : 'internal_error',
      message: `Patient surface returned ${response.status}`,
      status: response.status,
      route: op.name,
      rawBody: text,
    });
  }

  const body = JSON.parse(text) as {data?: Record<string, unknown>; errors?: Array<{message: string}>};
  if (body.errors?.length) {
    throw new NatzarApiError({
      code: 'internal_error',
      message: body.errors.map((e) => e.message).join('; '),
      status: 200,
      route: op.name,
    });
  }

  const payload = parseMaybeJson(body.data?.[op.name]);
  // The surface reports refusals in-band (`{ok:false, error:'expired'}`)
  // because it also drives a widget that renders them. Partners get an
  // exception instead, matching every other call in this package.
  if (payload && typeof payload === 'object' && (payload as {ok?: boolean}).ok === false) {
    const code = String((payload as {error?: string}).error ?? 'internal_error');
    throw new NatzarApiError({
      code: (KNOWN_CODES.has(code) ? code : 'internal_error') as ErrorCode,
      message: `Patient surface refused ${op.name}: ${code}`,
      status: code.startsWith('embed_token') ? 401 : 409,
      route: op.name,
      details: payload,
    });
  }
  return payload as T;
}

// AWSJSON fields arrive as strings; scalars arrive parsed. One tolerant hop.
const parseMaybeJson = (v: unknown): unknown => {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

// The refusal vocabulary of the embed surface, verbatim from embed-api and the
// booking/consent cores it calls. Anything outside this set is reported as
// `internal_error` rather than passed through, so a partner never ends up
// branching on a string the surface emitted once by accident.
const KNOWN_CODES = new Set<string>([
  'embed_token_invalid',
  'embed_token_expired',
  'origin_not_allowed',
  'not_found',
  'thread_not_active',
  'already_rated',
  'already_closed',
  'invalid_request',
  'internal_error',
  'not_ended',
  'not_rateable',
  'not_closed',
  'invalid_rating',
  'empty_rating',
  // Attachments (embedUploadUrls).
  'unsupported_type',
  'file_too_large',
  // Video (embedConsultJoin / embedAppointmentBeat).
  'livekit_unconfigured',
  'expired',
  // Scheduled consultations (embedBookingSlots / embedBook / embedCancelBooking).
  'booking_disabled',
  'too_many_open_bookings',
  'slot_taken',
  'slot_unavailable',
  'too_late_to_cancel',
  'not_booked',
  'already_started',
  'wrong_modality',
  'payment_check_failed',
]);

// The embed ops' argument types, by name. Small and closed — the surface is
// fixed by the contract, so a lookup beats threading types through every call.
//
// These MUST match the schema's declared scalar exactly: GraphQL only accepts
// a variable whose type is the argument's own, so `startsAt` declared as
// `a.datetime()` is `AWSDateTime!` on the wire and a `String!` variable is a
// validation error before the resolver ever runs.
const GQL_TYPES: Record<string, string> = {
  token: 'String!',
  ancestor: 'String',
  after: 'String',
  text: 'String',
  attachment: 'AWSJSON',
  files: 'AWSJSON!',
  accept: 'Boolean!',
  consultId: 'String!',
  overallPhysicianRating: 'Int',
  communicationRating: 'Int',
  feedback: 'String',
  // Waiting-room presence for a booked appointment (embedAppointmentBeat).
  present: 'Boolean',
  // Slot grid + booking (embedBookingSlots / embedBook). `timezone` is the
  // viewer's zone; sent only when the caller passes one, never guessed.
  from: 'String',
  to: 'String',
  timezone: 'String',
  startsAt: 'AWSDateTime!',
  practitionerId: 'ID',
};
const gqlTypeFor = (name: string): string => GQL_TYPES[name] ?? 'String';

// AbortSignal.any is Node 20+/modern browsers; this keeps Node 18 working.
function anySignal(signals: AbortSignal[]): AbortSignal {
  const withAny = AbortSignal as unknown as {any?: (s: AbortSignal[]) => AbortSignal};
  if (typeof withAny.any === 'function') return withAny.any(signals);
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => controller.abort(s.reason), {once: true});
  }
  return controller.signal;
}
