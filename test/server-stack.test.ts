// Middleware-stack fixtures (plan §3.1 placement rules, M5/RG5): the natzar()
// middleware inside a realistic Express-style stack, driven end to end by the
// real browser broker (`connectPatient`, headless, sealed) over node:http.
//
// express, express-session, passport, helmet, csurf/lusca are NOT installed
// (no network installs); these are faithful minimal stand-ins with the same
// observable behaviour on the request:
//   - an Express-style app: `use(path, fn)` strips the mount into req.url and
//     sets req.baseUrl, exactly as Express/Connect do;
//   - session: reads the `sid` cookie → req.session (cookie.expires), req.sessionID;
//   - passport.session(): req.user from the session;
//   - helmet: sets security headers on every response;
//   - express.json(): consumes the stream into req.body, sets req._body;
//   - csurf/lusca: refuses a POST without its token with 403 (HTML);
//   - a global auth guard: redirects a signed-out request to /login.
//
// What they prove: mounted after the session and before the body parser, CSRF
// and the guard, it works (and a signed-out user gets the signed-out state);
// mounted after any of them, the browser side reports
// `endpoint_misconfigured` (and the server logs the fix) instead of silently
// failing. Real-library fixtures are recorded NOT RUN in GATE-EVIDENCE RG5.
import {after, before, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {natzar} from '../dist/esm/server/index.js';
import {connectPatient} from '../dist/esm/patient/index.js';
import {signWebhook} from '../dist/esm/index.js';
import {API_KEY, API_URL, mockNatzar} from './support/mock-natzar.ts';

type User = {id: string; phone: string};
type Req = IncomingMessage & {
  url: string;
  baseUrl?: string;
  body?: unknown;
  _body?: boolean;
  session?: {cookie: {expires: Date}; passport?: {user: string}; csrfSecret: string};
  sessionID?: string;
  user?: User;
};
type Next = (err?: unknown) => void;
type Mw = (req: Req, res: ServerResponse, next: Next) => void;

const USERS: Record<string, User> = {'u-1': {id: 'u-1', phone: '+15551234567'}};
const SESSIONS: Record<string, {user?: string; expires: Date}> = {
  'sid-signed-in': {user: 'u-1', expires: new Date(Date.now() + 3_600_000)},
  'sid-signed-out': {expires: new Date(Date.now() + 3_600_000)},
};

// --- stand-ins ---------------------------------------------------------------

function expressApp() {
  const layers: Array<{path: string; fn: Mw}> = [];
  const app = {
    use(pathOrFn: string | Mw, fn?: Mw) {
      layers.push(typeof pathOrFn === 'string' ? {path: pathOrFn, fn: fn!} : {path: '', fn: pathOrFn});
      return app;
    },
    handle(req: Req, res: ServerResponse) {
      let i = 0;
      const original = req.url;
      const next: Next = (err) => {
        req.url = original;
        req.baseUrl = '';
        if (err) {
          res.statusCode = 500;
          res.end('Internal Server Error');
          return;
        }
        const layer = layers[i++];
        if (!layer) {
          res.statusCode = 404;
          res.end('Cannot ' + req.method);
          return;
        }
        if (layer.path) {
          const path = original.split('?')[0];
          if (path !== layer.path && !path.startsWith(layer.path + '/')) return next();
          req.baseUrl = layer.path;
          req.url = original.slice(layer.path.length) || '/';
        }
        layer.fn(req, res, next);
      };
      next();
    },
  };
  return app;
}

const session: Mw = (req, _res, next) => {
  const sid = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  const stored = sid ? SESSIONS[sid] : undefined;
  if (sid && stored) {
    req.sessionID = sid;
    req.session = {cookie: {expires: stored.expires}, csrfSecret: `csrf-${sid}`, ...(stored.user ? {passport: {user: stored.user}} : {})};
  }
  next();
};
const passport: Mw = (req, _res, next) => {
  const id = req.session?.passport?.user;
  if (id) req.user = USERS[id];
  next();
};
const helmet: Mw = (_req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
};
const jsonParser: Mw = (req, _res, next) => {
  if (!/^application\/json/.test(req.headers['content-type'] ?? '')) return next();
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    try {
      req.body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      req._body = true;
      next();
    } catch (e) {
      next(e);
    }
  });
};
const csrf: Mw = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? 'GET')) return next();
  const token = (req.body as {_csrf?: string} | undefined)?._csrf ?? req.headers['csrf-token'] ?? req.headers['x-csrf-token'];
  if (req.session && token === req.session.csrfSecret) return next();
  res.statusCode = 403;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!DOCTYPE html><title>Error</title>ForbiddenError: invalid csrf token');
};
const authGuard: Mw = (req, res, next) => {
  if (req.user || req.url.startsWith('/login')) return next();
  res.statusCode = 302;
  res.setHeader('Location', '/login');
  res.end();
};
const appRoutes: Mw = (_req, res) => {
  res.statusCode = 200;
  res.end('app');
};

// --- the integration under test -----------------------------------------------

const SECRET = 'whsec_stack';
const events: unknown[] = [];
const mock = mockNatzar();
// §3.2, as a customer writes it (minus the optional profile lines).
const nz = natzar<Req>({
  identify: (req) => req.user && {
    patient: {externalId: req.user.id, phone: req.user.phone},
    login: req.sessionID, until: req.session!.cookie.expires,
  },
  surfaces: ['async', 'telehealth', 'agent', 'headless'],
  onEvent: (e) => void events.push(e),
  apiKey: API_KEY,
  apiUrl: API_URL,
  webhookSecret: SECRET,
  fetch: mock.fetchLike,
  log: () => {},
});
const mount = nz as unknown as Mw;

async function serve(build: (app: ReturnType<typeof expressApp>) => void) {
  const app = expressApp();
  build(app);
  const server = createServer((req, res) => app.handle(req as Req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {origin, close: () => new Promise<void>((r) => server.close(() => r()))};
}

/** A browser on `origin`: sends its Origin, Sec-Fetch-Site and the session cookie with every same-origin request. */
function browserFetch(origin: string, cookie: string) {
  return (input: string, init: RequestInit = {}) =>
    fetch(input, {...init, headers: {...(init.headers as Record<string, string>), origin, 'sec-fetch-site': 'same-origin', cookie}});
}

const g = globalThis as {location?: {origin: string}};
let consoleError: typeof console.error;
let shouted: string[] = [];
before(() => {
  consoleError = console.error;
  console.error = (...a: unknown[]) => void shouted.push(a.map(String).join(' '));
});
after(() => {
  console.error = consoleError;
  delete g.location;
});

async function connectAs(origin: string, cookie: string) {
  g.location = {origin};
  return connectPatient({endpoint: `${origin}/natzar`}, {fetch: browserFetch(origin, cookie)});
}

async function rejectsWith(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: {name?: string; code?: string}) => {
    assert.equal(e.name, 'NatzarSessionError');
    assert.equal(e.code, code);
    return true;
  });
}

describe('stack fixture: placed as documented (after session + passport, before body parser, csrf, auth guard)', () => {
  const build = (app: ReturnType<typeof expressApp>) =>
    app.use(session).use(passport).use(helmet).use('/natzar', mount).use(jsonParser).use(csrf).use(authGuard).use(appRoutes);

  it('a signed-in user gets a sealed headless session that this page (and only this page) can open', async () => {
    const srv = await serve(build);
    try {
      shouted = [];
      const care = await connectAs(srv.origin, 'sid=sid-signed-in');
      assert.match(care.session!.sessionId, /^sess/);
      const mint = mock.mints().at(-1)!.body as Record<string, unknown>;
      assert.equal(mint.surface, 'headless');
      assert.equal(mint.parentOrigin, srv.origin);
      assert.equal(typeof mint.loginRef, 'string');
      assert.equal(mint.until, SESSIONS['sid-signed-in'].expires.toISOString());
      care.disconnect();
      assert.deepEqual(shouted, []);
    } finally {
      await srv.close();
    }
  });

  it('multi-patient (M11): the patient the page names is echoed as scope.patient and accepted; another login\'s patient is refused', async () => {
    const srv = await serve(build);
    try {
      g.location = {origin: srv.origin};
      const care = await connectPatient({endpoint: `${srv.origin}/natzar`, patient: 'u-1'}, {fetch: browserFetch(srv.origin, 'sid=sid-signed-in')});
      assert.equal(care.session!.scope.patient, 'u-1');
      assert.equal((mock.mints().at(-1)!.body as {askPatient?: string}).askPatient, 'u-1');
      care.disconnect();
      await rejectsWith(connectPatient({endpoint: `${srv.origin}/natzar`, patient: 'child-of-someone-else'}, {fetch: browserFetch(srv.origin, 'sid=sid-signed-in')}), 'forbidden');
    } finally {
      await srv.close();
    }
  });

  it('a signed-out user gets the signed-out answer (401), not the login redirect', async () => {
    const srv = await serve(build);
    try {
      await rejectsWith(connectAs(srv.origin, 'sid=sid-signed-out'), 'signed_out');
    } finally {
      await srv.close();
    }
  });

  it('webhooks verify over the raw body; the rest of the app is untouched', async () => {
    const srv = await serve(build);
    try {
      const raw = JSON.stringify({id: 'evt_s1', type: 'async_consult.assigned', createdAt: '2026-10-01T00:00:00Z', data: {}});
      const res = await fetch(`${srv.origin}/natzar/webhook`, {
        method: 'POST', body: raw,
        headers: {'content-type': 'application/json', 'x-natzar-signature': await signWebhook({secret: SECRET, rawBody: raw})},
      });
      assert.equal(res.status, 200);
      assert.equal(events.length, 1);
      assert.equal((await fetch(`${srv.origin}/dashboard`, {redirect: 'manual'})).status, 302, 'the guard still guards the app');
    } finally {
      await srv.close();
    }
  });
});

describe('stack fixture: misplaced (each fails with the actionable error, never silently)', () => {
  it('after express.json(): endpoint_misconfigured in the browser, the fix in the server log', async () => {
    const srv = await serve((app) => app.use(session).use(passport).use(jsonParser).use('/natzar', mount));
    try {
      shouted = [];
      await rejectsWith(connectAs(srv.origin, 'sid=sid-signed-in'), 'endpoint_misconfigured');
      const log = shouted.join('\n');
      assert.match(log, /body_consumed/);
      assert.match(log, /BEFORE body parsers/);
      assert.match(log, /endpoint did not answer as the natzar\(\) middleware/, 'the browser console names the placement rule too');
    } finally {
      await srv.close();
    }
  });

  it('after csurf/lusca: the CSRF guard answers 403 HTML, so the browser reports endpoint_misconfigured', async () => {
    const srv = await serve((app) => app.use(session).use(passport).use(csrf).use('/natzar', mount));
    try {
      await rejectsWith(connectAs(srv.origin, 'sid=sid-signed-in'), 'endpoint_misconfigured');
    } finally {
      await srv.close();
    }
  });

  it('after a global auth guard: a signed-out user is redirected to /login, reported as endpoint_misconfigured', async () => {
    const srv = await serve((app) => app.use(session).use(passport).use(authGuard).use('/natzar', mount));
    try {
      await rejectsWith(connectAs(srv.origin, 'sid=sid-signed-out'), 'endpoint_misconfigured');
    } finally {
      await srv.close();
    }
  });

  it('webhooks after express.json(): 500 and a loud log naming the fix (never a silent skip)', async () => {
    const srv = await serve((app) => app.use(jsonParser).use('/natzar', mount));
    try {
      shouted = [];
      const raw = JSON.stringify({id: 'evt_s2', type: 'async_consult.assigned', createdAt: '2026-10-01T00:00:00Z', data: {}});
      const res = await fetch(`${srv.origin}/natzar/webhook`, {
        method: 'POST', body: raw,
        headers: {'content-type': 'application/json', 'x-natzar-signature': await signWebhook({secret: SECRET, rawBody: raw})},
      });
      assert.equal(res.status, 500);
      assert.match(shouted.join('\n'), /webhook_body_consumed/);
    } finally {
      await srv.close();
    }
  });

  it('BEFORE the session middleware: identify sees no user, so even a signed-in user is signed out (the rule\'s other half)', async () => {
    const srv = await serve((app) => app.use('/natzar', mount).use(session).use(passport));
    try {
      await rejectsWith(connectAs(srv.origin, 'sid=sid-signed-in'), 'signed_out');
    } finally {
      await srv.close();
    }
  });
});
