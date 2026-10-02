// Transport for the PATIENT-side surface — the half that runs in a browser.
//
// The server half of this SDK authenticates with a `pp_live_`/`pp_test_` key,
// which must never reach a browser: it is tenant-scoped and can read every
// patient you have. That single fact is why partners were building a
// backend-for-frontend — hundreds of lines of Lambda whose entire job was
// relaying typed calls to their own front end.
//
// They do not need one. The platform already exposes a patient-scoped surface
// designed for exactly this: the embed operations, authenticated by an `nz1`
// SESSION credential that your `natzar()` endpoint mints for one patient and
// the broker (`../broker`) renews. It rides in `Authorization` (the surface's
// Lambda authorization mode); there is no public API key on this surface any
// more, and no credential in any operation argument.
//
// We reuse that existing, deployed, contract-documented surface rather than
// inventing a private protocol between two halves of this package. A private
// wire is the thing that drifts: it has no independent spec, nothing else
// exercises it, and it breaks silently on version skew.

import {NatzarApiError} from '../errors';
import {NatzarSessionError} from '../session-error';
import {ERROR_HTTP_STATUS} from '../contract/errors';
import {PATIENT_SURFACE_CODE_SET, type PatientSurfaceErrorCode} from './codes';

/**
 * Where one patient-surface call goes and what authorizes it: the grant's
 * `graphqlUrl` and the unsealed `nz1` credential, both from the broker.
 */
export interface PatientConnection {
  /** The `nz1` credential. */
  token: string;
  /** The patient-surface endpoint of this deployment (from the grant). */
  graphqlUrl: string;
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

/**
 * One patient-surface call.
 *
 * Returns the operation's payload already unwrapped, and converts both GraphQL
 * errors and the surface's own `{ok: false, error}` results into the SAME
 * {@link NatzarApiError} the server half throws — so a partner writes one error
 * path, not two.
 */
export async function callPatientOp<T>(
  connection: PatientConnection,
  op: {kind: 'query' | 'mutation'; name: string; args: Record<string, unknown>},
  options: TransportOptions = {},
  signal?: AbortSignal,
): Promise<T> {
  const doFetch = options.fetch ?? globalThis.fetch;
  if (!doFetch) throw new NatzarSessionError('No fetch implementation available.', 'network_error');

  // Arguments are passed as GraphQL VARIABLES, never interpolated into the
  // document — string-building a query from user input is how injection and
  // leaked values in logs happen.
  const argNames = Object.keys(op.args).filter((k) => op.args[k] !== undefined);
  const varDefs = argNames.map((k) => `$${k}: ${gqlTypeFor(k)}`).join(', ');
  const argList = argNames.map((k) => `${k}: $${k}`).join(', ');
  const document = `${op.kind} Op${varDefs ? `(${varDefs})` : ''} { ${op.name}${argList ? `(${argList})` : ''} }`;

  const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000);
  const composed = signal ? anySignal([signal, timeout]) : timeout;

  const response = await doFetch(connection.graphqlUrl, {
    method: 'POST',
    // The Lambda authorization mode takes the credential as the whole header
    // value (no `Bearer`); the resolvers check the session on every call.
    headers: {'content-type': 'application/json', authorization: connection.token},
    body: JSON.stringify({
      query: document,
      variables: Object.fromEntries(argNames.map((k) => [k, op.args[k]])),
    }),
    signal: composed,
  });

  const text = await response.text();
  if (!response.ok) {
    // The authorizer answers 401 for a credential it cannot even parse; the
    // broker then asks for a new session.
    throw new NatzarApiError({
      code: response.status === 401 ? 'session_invalid' : 'internal_error',
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
    const raw = String((payload as {error?: string}).error ?? 'internal_error');
    const code: PatientSurfaceErrorCode = PATIENT_SURFACE_CODE_SET.has(raw) ? (raw as PatientSurfaceErrorCode) : 'internal_error';
    throw new NatzarApiError({
      code,
      message: `Patient surface refused ${op.name}: ${raw}`,
      // The refusal came in-band on a 200, so the status is nominal: the one
      // the REST contract assigns the same code (401 for a token, 404 for
      // `not_found`, 422 for `invalid_location`…) so a log line reads the
      // same whichever half raised it, and 409 for the embed-only spellings
      // the contract does not know — a conflict with the resource's state,
      // which is what every one of them is.
      status: (ERROR_HTTP_STATUS as Readonly<Record<string, number | undefined>>)[code] ?? 409,
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

// The refusal vocabulary (`PATIENT_SURFACE_CODES`) lives in ./codes so
// `../errors` can type `NatzarApiError.code` with it without importing the
// transport.

// The embed ops' argument types, by name. Small and closed — the surface is
// fixed by the contract, so a lookup beats threading types through every call.
//
// These MUST match the schema's declared scalar exactly: GraphQL only accepts
// a variable whose type is the argument's own, so `startsAt` declared as
// `a.datetime()` is `AWSDateTime!` on the wire and a `String!` variable is a
// validation error before the resolver ever runs.
const GQL_TYPES: Record<string, string> = {
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
  // Prescriptions (embedPrescription*). `id` is the prescription id lifted
  // from the message link; `origin` and `pharmacy` are a.json() — stringified
  // by the caller, like `attachment`; `radiusKm` is a.integer(), so `Int`,
  // and the home point is a.float() — a `String` variable for a Float
  // argument is refused before the resolver runs.
  id: 'String!',
  origin: 'AWSJSON',
  query: 'String',
  radiusKm: 'Int',
  directoryId: 'String!',
  lat: 'Float!',
  lng: 'Float!',
  pharmacy: 'AWSJSON!',
  // Payments ("accept & pay"). `paymentId` is declared NON-null: that is the
  // one type valid in every position it is sent to — the optional argument of
  // embedAgentConsent / embedAsyncConsent / embedConsultJoin / embedBook (a
  // `String!` variable may fill a nullable `String` argument) AND the
  // required one of embedPaymentStatus (a nullable variable may not fill a
  // `String!`). It is only ever sent when present, never as null. `checkout`
  // and `embedded` are a.boolean(); sent as the default `String` they fail
  // validation before the resolver runs.
  paymentId: 'String!',
  checkout: 'Boolean',
  embedded: 'Boolean',
  // D12 "Join anyway" on embedConsultJoin (`acceptShortSession: true` only).
  acceptShortSession: 'Boolean',
};
const gqlTypeFor = (name: string): string => GQL_TYPES[name] ?? 'String';

// AbortSignal.any is missing on some React Native runtimes; this composes by hand there.
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
