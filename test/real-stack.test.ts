// Real-library stack fixtures (plan §3.1 placement rules, RG5.4): the natzar()
// middleware inside REAL express + express-session + passport (local) +
// helmet + csurf / lusca + a global auth guard, REAL Hono on
// @hono/node-server, and a REAL Next.js App Router app (catch-all route +
// middleware matcher, `next build` + `next start`), each driven end to end by
// the real browser broker (`connectPatient`, headless, sealed).
//
// The libraries are NOT dependencies of this package. They live out of tree
// (owner-approved install, 2026-10-01) and are loaded from
// NATZAR_FIXTURE_DEPS_DIR (a directory with its own package.json and
// node_modules, `@natzar/client` linked there for the Next.js app). Without it
// every suite here is SKIPPED (reported as skipped, never as passed):
//
//   NATZAR_FIXTURE_DEPS_DIR=<dir> node --test --experimental-strip-types test/real-stack.test.ts
//
// Cloudflare Workers / Wrangler are not part of the approval: Workers stay on
// the Fetch-adapter tests (test/server.test.ts, test/bundler.test.ts).
import {after, before, describe, it as nodeIt} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync, cpSync, rmSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn, spawnSync, type ChildProcess} from 'node:child_process';
import {createServer as createNetServer, type AddressInfo} from 'node:net';
import type {Server} from 'node:http';
import {natzar} from '../dist/esm/server/index.js';
import {connectPatient} from '../dist/esm/patient/index.js';
import {signWebhook} from '../dist/esm/index.js';
import {API_KEY, API_URL, EMBED_CONFIG, mockNatzar} from './support/mock-natzar.ts';
import {serveMockNatzar} from './support/natzar-http.ts';

const DEPS = process.env.NATZAR_FIXTURE_DEPS_DIR;
const available = !!DEPS && existsSync(join(DEPS, 'node_modules', 'express', 'package.json'));
const skip = available ? false : 'NATZAR_FIXTURE_DEPS_DIR is not set: the real-library fixtures need the out-of-tree install (GATE-EVIDENCE RG5.4)';
const load = available ? createRequire(join(DEPS!, 'package.json')) : (() => undefined) as unknown as NodeJS.Require;
const here = dirname(fileURLToPath(import.meta.url));

// Each fixture registers as its own test, so without the deps directory the
// run reports every one of them as SKIPPED (with the reason), never passed.
const it = (name: string, fn: () => Promise<void>) => nodeIt(name, {skip}, fn);
// Hooks do nothing without the deps directory.
const whenAvailable = (fn: () => unknown) => async () => {
  if (available) await fn();
};

const SECRET = 'whsec_real_stack';
const g = globalThis as {location?: {origin: string}};

/** A browser on `origin`: its Origin, Sec-Fetch-Site and cookie on every same-origin request. */
function browserFetch(origin: string, cookie: string) {
  return (input: string, init: RequestInit = {}) =>
    fetch(input, {...init, headers: {...(init.headers as Record<string, string>), origin, 'sec-fetch-site': 'same-origin', ...(cookie ? {cookie} : {})}});
}

async function connectAs(origin: string, cookie: string, endpoint = '/natzar') {
  g.location = {origin};
  return connectPatient({endpoint: `${origin}${endpoint}`}, {fetch: browserFetch(origin, cookie)});
}

async function rejectsWith(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: {name?: string; code?: string}) => {
    assert.equal(e.name, 'NatzarSessionError', String(e));
    assert.equal(e.code, code);
    return true;
  });
}

/** Run `fn` with console.error captured; returns what was printed. */
async function capturingErrors(fn: () => Promise<void>): Promise<string> {
  const original = console.error;
  const out: string[] = [];
  console.error = (...a: unknown[]) => void out.push(a.map(String).join(' '));
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return out.join('\n');
}

async function signedWebhook(origin: string, path = '/natzar/webhook') {
  const raw = JSON.stringify({id: `evt_${Math.random().toString(36).slice(2)}`, type: 'async_consult.assigned', createdAt: '2026-10-01T00:00:00Z', data: {}});
  return fetch(`${origin}${path}`, {
    method: 'POST', body: raw,
    headers: {'content-type': 'application/json', 'x-natzar-signature': await signWebhook({secret: SECRET, rawBody: raw})},
  });
}

after(() => {
  delete g.location;
});

// ------------------------------------------------------------------- Express

type ExpressPart = 'cookies' | 'session' | 'passport' | 'login' | 'helmet' | 'natzar' | 'json' | 'csurf' | 'lusca' | 'guard';

describe('real express 5 + express-session + passport + helmet + csurf / lusca + an auth guard', () => {
  const USERS: Record<string, {id: string; phone: string}> = {'u-1': {id: 'u-1', phone: '+15551234567'}};
  const events: unknown[] = [];
  const mock = mockNatzar();
  let servers: Server[] = [];

  before(whenAvailable(() => {
    const passport = load('passport');
    const {Strategy: LocalStrategy} = load('passport-local');
    passport.use(new LocalStrategy((username: string, password: string, done: (e: unknown, u?: unknown) => void) =>
      done(null, username === 'u-1' && password === 'pw' ? USERS[username] : false)));
    passport.serializeUser((user: {id: string}, done: (e: unknown, id?: string) => void) => done(null, user.id));
    passport.deserializeUser((id: string, done: (e: unknown, u?: unknown) => void) => done(null, USERS[id] ?? false));
  }));
  after(async () => {
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
    servers = [];
  });

  /** An Express app with the parts in this order (the plan's §3.2 identify). */
  async function app(parts: ExpressPart[]): Promise<string> {
    const express = load('express');
    const session = load('express-session');
    const passport = load('passport');
    const helmet = load('helmet');
    const csurf = load('csurf');
    const lusca = load('lusca');
    const cookieParser = load('cookie-parser');
    const nz = natzar({
      identify: (req: {user?: {id: string; phone: string}; sessionID: string; session: {cookie: {expires: Date}}}) => req.user && {
        patient: {externalId: req.user.id, phone: req.user.phone},
        login: req.sessionID, until: req.session.cookie.expires,
      },
      surfaces: ['async', 'telehealth', 'agent', 'headless'],
      onEvent: (e) => void events.push(e),
      apiKey: API_KEY, apiUrl: API_URL, webhookSecret: SECRET, fetch: mock.fetchLike, log: () => {},
    });
    const a = express();
    for (const part of parts) {
      if (part === 'cookies') a.use(cookieParser());
      if (part === 'session') a.use(session({secret: 'fixture-secret', resave: false, saveUninitialized: false, cookie: {maxAge: 3_600_000}}));
      if (part === 'passport') a.use(passport.session());
      if (part === 'login') {
        a.post('/login', express.urlencoded({extended: false}), passport.authenticate('local'), (_req: unknown, res: {sendStatus(n: number): void}) => res.sendStatus(204));
      }
      if (part === 'helmet') a.use(helmet());
      if (part === 'natzar') a.use('/natzar', nz);
      if (part === 'json') a.use(express.json());
      if (part === 'csurf') a.use(csurf());
      if (part === 'lusca') a.use(lusca.csrf());
      if (part === 'guard') {
        a.use((req: {user?: unknown; path: string}, res: {redirect(p: string): void}, next: () => void) => (req.user || req.path === '/login' ? next() : res.redirect('/login')));
      }
    }
    a.get('/dashboard', (_req: unknown, res: {send(b: string): void}) => res.send('app'));
    const server: Server = await new Promise((resolve) => {
      const s = a.listen(0, '127.0.0.1', () => resolve(s));
    });
    servers.push(server);
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  /** Sign in through passport-local; the express-session cookie. */
  async function signIn(origin: string): Promise<string> {
    const res = await fetch(`${origin}/login`, {
      method: 'POST', redirect: 'manual', body: 'username=u-1&password=pw',
      headers: {'content-type': 'application/x-www-form-urlencoded'},
    });
    assert.equal(res.status, 204, 'signed in');
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('connect.sid='));
    assert.ok(cookie, 'a session cookie');
    return cookie.split(';')[0];
  }

  const RIGHT: ExpressPart[] = ['cookies', 'session', 'passport', 'login', 'helmet', 'natzar', 'json', 'csurf', 'guard'];

  it('placed as documented (after session + passport, before express.json, csurf and the guard): a sealed headless session; signed out → signed_out; webhooks verify', async () => {
    const origin = await app(RIGHT);
    const cookie = await signIn(origin);
    const care = await connectAs(origin, cookie);
    assert.match(care.session!.sessionId, /^sess/);
    const mint = mock.mints().at(-1)!.body as Record<string, unknown>;
    assert.equal(mint.surface, 'headless');
    assert.equal(mint.parentOrigin, origin);
    assert.match(String(mint.loginRef), /^[0-9a-f]{64}$/);
    assert.equal(typeof mint.until, 'string', 'cookie.expires → until');
    assert.equal(JSON.stringify(mint).includes(cookie.slice('connect.sid='.length)), false, 'the session id never leaves');
    care.disconnect();
    await rejectsWith(connectAs(origin, ''), 'signed_out');
    assert.equal((await signedWebhook(origin)).status, 200);
    assert.equal((await fetch(`${origin}/dashboard`, {redirect: 'manual'})).status, 302, 'the guard still guards the app');
    // helmet's headers ride on natzar's answers too, without breaking them.
    const loader = await fetch(`${origin}/natzar/embed.js`, {redirect: 'manual'});
    assert.equal(loader.status, 302);
    assert.equal(loader.headers.get('location'), EMBED_CONFIG.loaderUrl);
    assert.ok(loader.headers.get('content-security-policy'), 'helmet ran');
  });

  it('the same with lusca.csrf() instead of csurf', async () => {
    const origin = await app(['session', 'passport', 'login', 'natzar', 'json', 'lusca', 'guard']);
    const care = await connectAs(origin, await signIn(origin));
    care.disconnect();
  });

  it('after express.json(): endpoint_misconfigured in the browser, the fix in the server log', async () => {
    const origin = await app(['session', 'passport', 'login', 'json', 'natzar']);
    const cookie = await signIn(origin);
    const log = await capturingErrors(() => rejectsWith(connectAs(origin, cookie), 'endpoint_misconfigured'));
    assert.match(log, /body_consumed/);
    assert.match(log, /BEFORE body parsers/);
    assert.match(log, /endpoint did not answer as the natzar\(\) middleware/);
  });

  it('after csurf: its 403 is reported as endpoint_misconfigured', async () => {
    const origin = await app(['cookies', 'session', 'passport', 'login', 'csurf', 'natzar']);
    const cookie = await signIn(origin);
    await capturingErrors(() => rejectsWith(connectAs(origin, cookie), 'endpoint_misconfigured'));
  });

  it('after lusca.csrf(): its 403 is reported as endpoint_misconfigured', async () => {
    const origin = await app(['session', 'passport', 'login', 'lusca', 'natzar']);
    const cookie = await signIn(origin);
    await capturingErrors(() => rejectsWith(connectAs(origin, cookie), 'endpoint_misconfigured'));
  });

  it('after the global auth guard: a signed-out user is redirected to /login, reported as endpoint_misconfigured', async () => {
    const origin = await app(['session', 'passport', 'login', 'guard', 'natzar']);
    await capturingErrors(() => rejectsWith(connectAs(origin, ''), 'endpoint_misconfigured'));
  });

  it('BEFORE the session middleware: identify sees no user, so a signed-in user is signed out', async () => {
    const origin = await app(['natzar', 'session', 'passport', 'login']);
    await rejectsWith(connectAs(origin, await signIn(origin)), 'signed_out');
  });

  it('webhooks after express.json(): 500 and a loud log naming the fix', async () => {
    const origin = await app(['json', 'natzar']);
    let status = 0;
    const log = await capturingErrors(async () => {
      status = (await signedWebhook(origin)).status;
    });
    assert.equal(status, 500);
    assert.match(log, /webhook_body_consumed/);
  });
});

// ---------------------------------------------------------------------- Hono

describe('real Hono on @hono/node-server', () => {
  const mock = mockNatzar();
  let servers: Array<{close(cb?: () => void): void}> = [];
  after(async () => {
    await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
    servers = [];
  });

  type Variant = 'right' | 'json-first' | 'guard-first';

  async function honoApp(variant: Variant): Promise<string> {
    const {Hono} = load('hono');
    const {csrf} = load('hono/csrf');
    const {secureHeaders} = load('hono/secure-headers');
    const {serve} = load('@hono/node-server');
    const nz = natzar({
      identify: (req: Request) => (/(?:^|;\s*)sid=signed-in/.test(req.headers.get('cookie') ?? '') ? {patient: {externalId: 'u-1', phone: '+15551234567'}, login: 'signed-in'} : null),
      surfaces: ['async', 'telehealth', 'agent', 'headless'],
      apiKey: API_KEY, apiUrl: API_URL, fetch: mock.fetchLike, log: () => {},
    });
    type Ctx = {req: {raw: Request; header(n: string): string | undefined; json(): Promise<unknown>}; env: object; redirect(p: string): Response};
    const guard = async (c: Ctx, next: () => Promise<void>) => {
      if (/(?:^|;\s*)sid=signed-in/.test(c.req.header('cookie') ?? '')) return next();
      return c.redirect('/login');
    };
    const app = new Hono();
    app.use(secureHeaders());
    app.use(csrf());
    if (variant === 'json-first') {
      app.use(async (c: Ctx, next: () => Promise<void>) => {
        if ((c.req.header('content-type') ?? '').startsWith('application/json')) await c.req.json();
        return next();
      });
    }
    if (variant === 'guard-first') app.use(guard);
    app.all('/natzar/*', (c: Ctx) => nz.fetch(c.req.raw, c.env));   // plan §3.5, as printed
    app.use(guard);
    app.get('/dashboard', () => new Response('app'));
    const server = await new Promise<{close(cb?: () => void): void; address(): AddressInfo}>((resolve) => {
      const s = serve({fetch: app.fetch, port: 0, hostname: '127.0.0.1'}, () => resolve(s));
    });
    servers.push(server);
    return `http://127.0.0.1:${server.address().port}`;
  }

  it('placed as documented: a sealed headless session; signed out → signed_out; hono/csrf and secureHeaders in front are compatible', async () => {
    const origin = await honoApp('right');
    const care = await connectAs(origin, 'sid=signed-in');
    assert.match(care.session!.sessionId, /^sess/);
    care.disconnect();
    await rejectsWith(connectAs(origin, ''), 'signed_out');
    const loader = await fetch(`${origin}/natzar/embed.js`, {redirect: 'manual'});
    assert.equal(loader.status, 302);
    assert.equal((await fetch(`${origin}/dashboard`, {redirect: 'manual'})).status, 302);
  });

  it('a cross-site POST is refused by natzar itself (not only by the browser)', async () => {
    const origin = await honoApp('right');
    const res = await fetch(`${origin}/natzar/session`, {
      method: 'POST', body: '{}',
      headers: {'content-type': 'application/json', 'x-natzar-request': '1', origin: 'https://evil.test', 'sec-fetch-site': 'cross-site', cookie: 'sid=signed-in'},
    });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  it('after a middleware that read the JSON body: endpoint_misconfigured, the fix in the log', async () => {
    const origin = await honoApp('json-first');
    const log = await capturingErrors(() => rejectsWith(connectAs(origin, 'sid=signed-in'), 'endpoint_misconfigured'));
    assert.match(log, /body_consumed/);
  });

  it('after the auth guard: a signed-out user is redirected, reported as endpoint_misconfigured', async () => {
    const origin = await honoApp('guard-first');
    await capturingErrors(() => rejectsWith(connectAs(origin, ''), 'endpoint_misconfigured'));
  });
});

// ------------------------------------------------------------------- Next.js

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createNetServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

describe('real Next.js App Router (catch-all route + middleware matcher; next build + next start)', () => {
  let next: ChildProcess | undefined;
  let origin = '';
  let api: Awaited<ReturnType<typeof serveMockNatzar>> | undefined;

  before(whenAvailable(async () => {
    const appDir = join(DEPS!, 'next-app');
    rmSync(appDir, {recursive: true, force: true});
    cpSync(join(here, 'fixtures', 'next-app'), appDir, {recursive: true});
    const bin = join(DEPS!, 'node_modules', '.bin', 'next');
    const env = {...process.env, NEXT_TELEMETRY_DISABLED: '1'};
    const build = spawnSync(bin, ['build'], {cwd: appDir, env, encoding: 'utf8', timeout: 240_000});
    assert.equal(build.status, 0, `next build failed:\n${build.stdout}\n${build.stderr}`);
    api = await serveMockNatzar();
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    next = spawn(bin, ['start', '-p', String(port), '-H', '127.0.0.1'], {
      cwd: appDir,
      env: {...env, NATZAR_API_KEY: API_KEY, NATZAR_API_URL: api.url},
      stdio: 'ignore',
    });
    for (let i = 0; i < 150; i++) {
      try {
        await fetch(`${origin}/login`);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    throw new Error('next start did not come up');
  }));
  after(async () => {
    next?.kill('SIGTERM');
    await api?.close();
  });

  it('the matcher-excluded catch-all: a sealed headless session through `export const {GET, POST} = natzar(...)`', async () => {
    const care = await connectAs(origin, 'sid=signed-in');
    assert.match(care.session!.sessionId, /^sess/);
    const mint = api!.mock.mints().at(-1)!;
    assert.equal((mint.body as {parentOrigin: string}).parentOrigin, origin);
    for (const h of ['origin', 'sec-fetch-site', 'cookie']) assert.equal(h in mint.headers, false, `${h} not forwarded by the Next.js runtime either`);
    care.disconnect();
  });

  it('signed out on the excluded mount → signed_out, not the middleware redirect', async () => {
    await rejectsWith(connectAs(origin, ''), 'signed_out');
  });

  it('GET /natzar/embed.js → 302 to the loader; /config carries the key-derived apiUrl', async () => {
    const loader = await fetch(`${origin}/natzar/embed.js`, {redirect: 'manual'});
    assert.equal(loader.status, 302);
    assert.equal(loader.headers.get('location'), EMBED_CONFIG.loaderUrl);
    assert.equal(loader.headers.get('cache-control'), 'max-age=3600');
    const config = (await (await fetch(`${origin}/natzar/config`)).json()) as {apiUrl: string};
    assert.equal(config.apiUrl, api!.url);
  });

  it('a mount the matcher does NOT exclude: the middleware redirects a signed-out user, reported as endpoint_misconfigured', async () => {
    await capturingErrors(() => rejectsWith(connectAs(origin, '', '/natzar-guarded'), 'endpoint_misconfigured'));
    // Signed in, the guard lets it through: the misplacement only bites signed-out users, which is why it must be excluded.
    const care = await connectAs(origin, 'sid=signed-in', '/natzar-guarded');
    care.disconnect();
  });

  it('a cross-site POST is refused by natzar inside Next.js', async () => {
    const res = await fetch(`${origin}/natzar/session`, {
      method: 'POST', body: '{}',
      headers: {'content-type': 'application/json', 'x-natzar-request': '1', origin: 'https://evil.test', 'sec-fetch-site': 'cross-site', cookie: 'sid=signed-in'},
    });
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as {error: string}).error, 'origin_not_allowed');
  });
});
