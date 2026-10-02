/**
 * # @natzar/client/server
 *
 * The whole server side of an embed integration: one middleware, one
 * `identify` callback.
 *
 * ```ts
 * import {natzar} from '@natzar/client/server';
 *
 * // Express / Connect — AFTER your session middleware, BEFORE body parsers,
 * // CSRF middleware and login redirects:
 * app.use('/natzar', natzar({
 *   identify: (req) => req.user && {patient: {externalId: req.user.id, phone: req.user.phone}, login: req.sessionID},
 * }));
 *
 * // Next.js App Router — app/natzar/[...natzar]/route.ts
 * export const {GET, POST} = natzar({identify: async () => …});
 *
 * // Fetch runtimes — Hono, Workers, Bun, Deno, Remix, SvelteKit
 * const nz = natzar({identify: async (req) => …});
 * app.all('/natzar/*', (c) => nz.fetch(c.req.raw, c.env));
 * ```
 *
 * It mints and renews sessions (your key never leaves the server; the session
 * secret is sealed to the element's frame key, so this server only relays
 * ciphertext), opens visits when your `onStart` allows it, serves the script
 * redirect (`GET /embed.js`) and verifies webhooks (`onEvent`). It keeps no
 * durable state. The rules it enforces are listed in ./core.
 *
 * SERVER ONLY. A browser bundle that imports this entry fails AT BUILD: the
 * package's `browser` export condition resolves it to a stub that exports
 * nothing (esbuild: `No matching export … for import "natzar"`; Rollup/Vite:
 * `"natzar" is not exported by …`).
 *
 * @packageDocumentation
 */

import type {NatzarClient} from '../client';
import {
  createCore,
  type AnyRequest,
  type BodyRead,
  type ClinicianIdentity,
  type CoreRequest,
  type CoreResponse,
  type NatzarOptions,
  type StartConsultOptions,
  type StartConsultResult,
} from './core';
import type {DeactivatePhysicianResponse, RevokeSessionsResponse} from '../contract/sessions-schemas';

export type {
  AnyRequest,
  ClinicianIdentity,
  Identity,
  IdentifyAsk,
  IdentifyResult,
  NatzarLogEntry,
  NatzarOptions,
  PatientIdentity,
  StartAsk,
  StartConsultOptions,
  StartConsultResult,
  StartDecision,
  WebhookDedupe,
} from './core';
export type {WebhookEvent} from '../contract/webhooks';
export {NatzarSessionError, isNatzarSessionError} from '../session-error';
export {NatzarApiError, isNatzarApiError} from '../errors';

/** The Node request shape the middleware reads (an `http.IncomingMessage`, Express `req`, Connect `req`). */
export interface NodeLikeRequest {
  method?: string;
  url?: string;
  /** Express: the mount path (`''` at the app root). */
  baseUrl?: string;
  /** Express/Connect: the URL before the mount was stripped. */
  originalUrl?: string;
  headers: Record<string, string | string[] | undefined>;
  on(event: string, listener: (...args: never[]) => void): unknown;
  removeListener?(event: string, listener: (...args: never[]) => void): unknown;
  pause?(): unknown;
  readableEnded?: boolean;
}

/** The Node response shape the middleware writes. */
export interface NodeLikeResponse {
  statusCode: number;
  headersSent?: boolean;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
}

/**
 * The middleware. Call it as Express/Connect middleware, or use `.fetch`,
 * `.GET` / `.POST` / `.OPTIONS`, and the helpers for your own routes.
 */
export interface NatzarHandler<Req = AnyRequest> {
  /** Express / Connect / Node middleware: `app.use('/natzar', nz)`. */
  (req: NodeLikeRequest, res: NodeLikeResponse, next?: (err?: unknown) => void): void;
  /** Fetch runtimes: `app.all('/natzar/*', (c) => nz.fetch(c.req.raw, c.env))`. `env` may hold `NATZAR_API_KEY` etc. */
  fetch(request: Request, env?: object): Promise<Response>;
  /** Next.js App Router: `export const {GET, POST} = natzar({...})` in `app/natzar/[...natzar]/route.ts`. */
  GET(request: Request): Promise<Response>;
  /** Next.js App Router. */
  POST(request: Request): Promise<Response>;
  /** Next.js App Router: CORS preflights, only needed with `origins`. */
  OPTIONS(request: Request): Promise<Response>;
  /** A `NatzarClient` built from your key (`NATZAR_API_KEY`), for provisioning and every other REST route. */
  readonly client: NatzarClient;
  /** Revoke every session of one login (the `login` your `identify` returned), at once. In your logout route. */
  revokeLogin(login: string | number, env?: object): Promise<RevokeSessionsResponse>;
  /** Revoke every session of one patient (your external id). */
  revokePatient(externalId: string, env?: object): Promise<RevokeSessionsResponse>;
  /** Revoke every session of one clinician (your external id, or `{physicianId}`). */
  revokeClinician(clinician: string | ClinicianIdentity, env?: object): Promise<RevokeSessionsResponse>;
  /**
   * Offboarding: the clinician stops being routable and every session they
   * hold is revoked. One call by your id (`POST /v1/physicians/deactivate`).
   * `env`: Workers bindings holding the key, as for `fetch`.
   */
  deactivateClinician(clinician: string | ClinicianIdentity, env?: object): Promise<DeactivatePhysicianResponse>;
  /**
   * Open a visit from YOUR flow (`identify` decides who): `await nz.startConsult(req, {kind: 'async', context})`.
   * The element finds the new consult by itself. `referral_request` opens a non-blocking referral ask.
   */
  startConsult(req: Req, options: StartConsultOptions): Promise<StartConsultResult>;
}

// ------------------------------------------------------------ Node adapter

function nodeHeader(req: NodeLikeRequest, name: string): string | undefined {
  const v = req.headers?.[name];
  if (Array.isArray(v)) return v.join(', ');
  return typeof v === 'string' ? v : undefined;
}

// A body some middleware already dealt with. Raw bytes (express.raw(),
// express.text(), Firebase/GCF's `rawBody`) are still the exact bytes and are
// used; anything parsed is not, and fails loudly with the fix.
function preRead(req: NodeLikeRequest, limit: number): BodyRead | null {
  const r = req as NodeLikeRequest & {rawBody?: unknown; body?: unknown; _body?: unknown};
  const bytes = (b: Uint8Array): BodyRead => (b.byteLength > limit ? {kind: 'too_large'} : {kind: 'bytes', bytes: b});
  if (r.rawBody instanceof Uint8Array) return bytes(r.rawBody);
  if (r.body instanceof Uint8Array) return bytes(r.body);
  if (typeof r.body === 'string') return bytes(new TextEncoder().encode(r.body));
  // body-parser 1.x sets `req.body = {}` when it SKIPS a request (another
  // content type): an untouched stream is still readable (RG5 N7).
  const placeholder = isEmptyPlainObject(r.body) && r._body !== true && r.readableEnded !== true;
  if (r.body !== undefined && r.body !== null && !placeholder) return {kind: 'consumed'};
  if (r._body === true || r.readableEnded === true) return {kind: 'consumed'};
  return null;
}

function isEmptyPlainObject(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null) && Object.keys(value).length === 0;
}

function readNodeBody(req: NodeLikeRequest, limit: number): Promise<BodyRead> {
  const pre = preRead(req, limit);
  if (pre) return Promise.resolve(pre);
  const declared = Number(nodeHeader(req, 'content-length'));
  if (Number.isFinite(declared) && declared > limit) return Promise.resolve({kind: 'too_large'});
  return new Promise((resolve) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    let done = false;
    const finish = (result: BodyRead) => {
      if (done) return;
      done = true;
      req.removeListener?.('data', onData as never);
      req.removeListener?.('end', onEnd as never);
      req.removeListener?.('error', onError as never);
      resolve(result);
    };
    const onData = (chunk: Uint8Array | string) => {
      const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
      size += bytes.byteLength;
      if (size > limit) {
        req.pause?.();
        finish({kind: 'too_large'});
        return;
      }
      chunks.push(bytes);
    };
    const onEnd = () => {
      const out = new Uint8Array(size);
      let at = 0;
      for (const c of chunks) {
        out.set(c, at);
        at += c.byteLength;
      }
      finish({kind: 'bytes', bytes: out});
    };
    const onError = () => finish({kind: 'too_large'});
    req.on('data', onData as never);
    req.on('end', onEnd as never);
    req.on('error', onError as never);
  });
}

const pathOf = (url: string) => {
  const cut = url.search(/[?#]/);
  return cut >= 0 ? url.slice(0, cut) : url;
};

function nodeRequest(req: NodeLikeRequest): CoreRequest {
  const url = typeof req.url === 'string' ? req.url : '/';
  // Express sets `baseUrl` (even at the app root); Connect rewrites `url` and
  // keeps `originalUrl`. Either way the router stripped the mount.
  const mounted = typeof req.baseUrl === 'string' || (typeof req.originalUrl === 'string' && req.originalUrl !== url);
  return {
    method: req.method ?? 'GET',
    pathname: pathOf(url),
    mounted,
    fullPathname: pathOf(typeof req.originalUrl === 'string' ? req.originalUrl : url),
    header: (name) => nodeHeader(req, name.toLowerCase()),
    readBody: (limit) => readNodeBody(req, limit),
    raw: req,
  };
}

function writeNode(res: NodeLikeResponse, r: CoreResponse): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.statusCode = r.status;
  for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
  res.end(r.body);
}

// ----------------------------------------------------------- Fetch adapter

async function readFetchBody(request: Request, limit: number): Promise<BodyRead> {
  if (request.bodyUsed) return {kind: 'consumed'};
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) return {kind: 'too_large'};
  if (!request.body) return {kind: 'bytes', bytes: new Uint8Array(0)};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return {kind: 'too_large'};
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return {kind: 'bytes', bytes: out};
}

function fetchRequest(request: Request, env?: object): CoreRequest {
  let url: URL | null;
  try {
    url = new URL(request.url);
  } catch {
    url = null;
  }
  return {
    method: request.method,
    pathname: url?.pathname ?? '/',
    header: (name) => request.headers.get(name) ?? undefined,
    readBody: (limit) => readFetchBody(request, limit),
    raw: request,
    ...(env && typeof env === 'object' ? {env} : {}),
    ...(url ? {urlHost: url.host} : {}),
  };
}

function toResponse(r: CoreResponse): Response {
  // 204 and 302 carry no body; Response refuses one for 204.
  return new Response(r.status === 204 || r.status === 302 || r.body === '' ? null : r.body, {status: r.status, headers: r.headers});
}

// A request object from any adapter, for `startConsult(req, …)`.
function anyRequest(req: unknown): CoreRequest {
  if (typeof Request !== 'undefined' && req instanceof Request) return fetchRequest(req);
  const r = req as {headers?: unknown; url?: unknown; method?: unknown};
  if (r && typeof (r.headers as {get?: unknown})?.get === 'function') {
    const headers = r.headers as {get(name: string): string | null};
    return {
      method: String(r.method ?? 'POST'),
      pathname: '/',
      header: (name) => headers.get(name) ?? undefined,
      readBody: async () => ({kind: 'consumed'}),
      raw: req,
    };
  }
  if (r && typeof r.headers === 'object' && r.headers !== null) {
    return {...nodeRequest(req as NodeLikeRequest), raw: req};
  }
  throw new TypeError('startConsult(): pass the request your route received (a Node/Express req or a Fetch Request).');
}

/**
 * Create the middleware. See the module documentation for the three
 * framework shapes; `identify` is the only required option.
 */
export function natzar<Req = AnyRequest>(options: NatzarOptions<Req>): NatzarHandler<Req> {
  const core = createCore(options);

  const handleFetch = async (request: Request, env?: object): Promise<Response> =>
    toResponse(await core.handle(fetchRequest(request, env)));

  const middleware = function natzarMiddleware(req: NodeLikeRequest, res: NodeLikeResponse): void {
    core.handle(nodeRequest(req)).then(
      (r) => writeNode(res, r),
      () => writeNode(res, {status: 502, headers: {'Cache-Control': 'no-store'}, body: ''}),
    );
  };

  // Next.js passes `(request, {params})`: never read its second argument as `env`.
  const route = (request: Request) => handleFetch(request);

  Object.defineProperties(middleware, {
    fetch: {value: handleFetch, enumerable: true},
    GET: {value: route, enumerable: true},
    POST: {value: route, enumerable: true},
    OPTIONS: {value: route, enumerable: true},
    client: {get: () => core.client(), enumerable: true},
    revokeLogin: {value: core.revokeLogin, enumerable: true},
    revokePatient: {value: core.revokePatient, enumerable: true},
    revokeClinician: {value: core.revokeClinician, enumerable: true},
    deactivateClinician: {value: core.deactivateClinician, enumerable: true},
    startConsult: {value: (req: Req, opts: StartConsultOptions) => core.startConsult(anyRequest(req), opts), enumerable: true},
  });
  return middleware as unknown as NatzarHandler<Req>;
}
