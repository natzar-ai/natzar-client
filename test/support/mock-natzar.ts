// A stand-in for the Natzar API behind the `natzar()` middleware: the M0
// session routes (mint, renew, revoke), the embed config, and the REST routes
// the middleware's helpers call. Grants are REAL: sealed with the contract's
// sealer to the ask's frame key and binding, so a broker on the other side
// unseals them exactly as it would in production.
//
// It is a `fetch`: pass it as the middleware's `fetch` option. Nothing here
// touches a network.

import {
  EMBED_PROTOCOL_VERSION,
  SESSION_LIFETIMES,
  frameUrlFor,
  isFrameSurface,
  type SessionSurface,
} from '../../dist/esm/contract/sessions.js';
import {createSessionRequestSchema} from '../../dist/esm/contract/sessions-schemas.js';
import {sealToFrameKey} from '../../dist/esm/contract/sessions-crypto.js';

export const API_KEY = `pp_test_sbx_us_${'a'.repeat(48)}`;
export const API_URL = 'https://natzar.test/v1';
export const DEPLOYMENT = {partnerId: 'partner_1', environment: 'sbx-test', zone: 'us' as const};
export const EMBED_CONFIG = {
  ...DEPLOYMENT,
  loaderUrl: 'https://us.embed.natzar.test/v2/natzar.js?p=partner_1',
  frameOrigins: {patient: 'https://us.embed.natzar.test', clinician: 'https://us.provider.natzar.test'},
  graphqlUrl: 'https://gql.natzar.test/graphql',
  // Natzar's own idea of its API; the middleware relays the URL IT derived from the key instead.
  apiUrl: 'https://api.natzar.test/v1',
};

export const sid = (n: number) => `sess${String(n).padStart(17, '0')}A`;
export const tokenOf = (sessionId: string, n: number) => `nz1.${sessionId}.${String(n).padStart(42, 'k')}A`;

export type ApiCall = {method: string; path: string; headers: Record<string, string>; body: unknown};

/** A refusal the test wants for one route. */
export type Refusal = {status: number; code: string; details?: unknown; retryAfter?: string};

export interface MockNatzarOptions {
  /** The key the mock accepts (default {@link API_KEY}). */
  apiKey?: string;
  /** Replace the embed config answer. */
  config?: Record<string, unknown>;
  /** Replace or extend the grant answered for a mint. */
  grantOverride?: (grant: Record<string, unknown>) => unknown;
  /** Return a refusal (or nothing to mint) for a `POST /v1/sessions` body. */
  onMint?: (body: Record<string, unknown>, n: number) => Refusal | undefined;
  /** Return a refusal for `POST /v1/async-consults` / `POST /v1/telehealth-consults`. */
  onCreate?: (kind: 'async' | 'telehealth', body: Record<string, unknown>) => Refusal | undefined;
  /** Delay every answer this long (single-flight tests). */
  delayMs?: number;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {status, headers: {'Content-Type': 'application/json', ...headers}});

const refuse = (r: Refusal) =>
  json(r.status, {error: {code: r.code, message: r.code, ...(r.details !== undefined ? {details: r.details} : {})}}, r.retryAfter ? {'Retry-After': r.retryAfter} : {});

export function mockNatzar(options: MockNatzarOptions = {}) {
  const calls: ApiCall[] = [];
  let minted = 0;
  const fetchLike = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = typeof init.body === 'string' && init.body !== '' ? JSON.parse(init.body) : undefined;
    const path = url.pathname.replace(/^\/v1/, '');
    calls.push({method, path, headers, body});
    if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
    if (headers.authorization !== `Bearer ${options.apiKey ?? API_KEY}`) return refuse({status: 401, code: 'unauthorized'});
    // §4.5: the session routes are server-only; a browser header is refused.
    if (path.startsWith('/sessions') && ('origin' in headers || 'sec-fetch-site' in headers || 'sec-fetch-dest' in headers)) {
      return refuse({status: 403, code: 'forbidden'});
    }
    const route = `${method} ${path}`;
    if (route === 'GET /embed/config') return json(200, options.config ?? EMBED_CONFIG);
    if (route === 'POST /sessions') {
      const parsed = createSessionRequestSchema.safeParse(body);
      if (!parsed.success) return refuse({status: 400, code: 'invalid_request'});
      minted += 1;
      const refusal = options.onMint?.(body as Record<string, unknown>, minted);
      if (refusal) return refuse(refusal);
      const grant = await grantFor(parsed.data as never, minted);
      return json(parsed.data.sessionId ? 200 : 201, options.grantOverride ? options.grantOverride(grant) : grant);
    }
    if (route === 'POST /sessions/revoke') return json(200, {revoked: 2});
    if (route === 'POST /patients') return json(200, {patient: {id: 'pat_1', externalId: (body as {externalId: string}).externalId}});
    if (route === 'POST /async-consults' || route === 'POST /telehealth-consults') {
      const kind = route === 'POST /async-consults' ? 'async' : 'telehealth';
      const refusal = options.onCreate?.(kind, body as Record<string, unknown>);
      if (refusal) return refuse(refusal);
      return json(200, {consult: {id: kind === 'async' ? 'thr_new' : 'tele_new', status: 'invited'}});
    }
    if (route === 'POST /physicians/ph_9/deactivate') return json(200, {deactivated: true, revoked: 1});
    if (route === 'POST /physicians/deactivate') {
      return (body as {externalId?: string}).externalId === 'dr-9' ? json(200, {deactivated: true, revoked: 1}) : refuse({status: 404, code: 'not_found'});
    }
    return refuse({status: 404, code: 'not_found'});
  };
  return {calls, fetchLike, mints: () => calls.filter((c) => c.method === 'POST' && c.path === '/sessions')};
}

type MintBody = {
  audience: 'patient' | 'clinician';
  surface: SessionSurface;
  sessionId?: string | null;
  frameKey?: {kty: 'EC'; crv: 'P-256'; x: string; y: string};
  consult?: {kind: 'async' | 'telehealth'; id: string};
  patient?: {externalId: string};
  askPatient?: string;
  view?: string;
  parentOrigin: string | null;
};

/** The grant the session service would answer for a mint body. */
export async function grantFor(b: MintBody, n: number, over: Record<string, unknown> = {}) {
  const now = Date.now();
  const sessionId = b.sessionId ?? sid(n);
  const token = tokenOf(sessionId, n);
  const life = (SESSION_LIFETIMES as unknown as Record<string, Record<string, {accessSeconds: number; absoluteSeconds: number}>>)[b.audience][b.surface];
  const frameUrl = isFrameSurface(b.audience, b.surface)
    ? frameUrlFor({frameOrigin: b.audience === 'patient' ? EMBED_CONFIG.frameOrigins.patient : EMBED_CONFIG.frameOrigins.clinician, audience: b.audience, partnerId: DEPLOYMENT.partnerId})
    : null;
  const sealed = b.surface === 'native'
    ? {sessionToken: token}
    : {sealedToken: await sealToFrameKey(token, b.frameKey!, {...DEPLOYMENT, audience: b.audience, surface: b.surface, sessionId, parentOrigin: b.parentOrigin!, frameUrl})};
  return {
    protocolVersion: EMBED_PROTOCOL_VERSION,
    audience: b.audience,
    surface: b.surface,
    sessionId,
    ...sealed,
    expiresAt: new Date(now + life.accessSeconds * 1000).toISOString(),
    renewAfter: new Date(now + (life.accessSeconds - 60) * 1000).toISOString(),
    absoluteExpiresAt: new Date(now + life.absoluteSeconds * 1000).toISOString(),
    idleTimeoutSeconds: null,
    frameUrl,
    apiUrl: API_URL,
    graphqlUrl: EMBED_CONFIG.graphqlUrl,
    parentOrigin: b.parentOrigin,
    ...DEPLOYMENT,
    // `scope.patient` echoes `askPatient` (RG0.6 CR1), only when present.
    scope: {
      ...(b.consult ? {consult: b.consult} : {}),
      ...(b.askPatient !== undefined ? {patient: b.askPatient} : {}),
      ...(b.audience === 'clinician' && b.surface === 'workspace' ? {view: b.view ?? 'workspace'} : {}),
    },
    capabilities: b.audience === 'clinician' ? ['workspace.read'] : [],
    unavailable: [],
    ...over,
  };
}
