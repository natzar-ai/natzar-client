// The natzar() middleware (@natzar/client/server): every built-in rule of plan
// §4.7, through the Fetch adapter (Hono, Workers, Bun, Deno), the Next.js App
// Router exports and the Node/Express adapter. The Natzar API is the stand-in
// in ./support/mock-natzar.ts; nothing touches a network except the local
// node:http servers of the Node-adapter tests. Negative cases first.
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {createServer, request as httpRequest, type IncomingMessage, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {natzar} from '../dist/esm/server/index.js';
import type {IdentifyAsk, NatzarLogEntry, NatzarOptions} from '../dist/esm/server/index.js';
import {signWebhook} from '../dist/esm/index.js';
import {ENDPOINT_ERROR_CODES} from '../dist/esm/contract/sessions.js';
import {generateFrameKeyPair} from '../dist/esm/contract/sessions-crypto.js';
import {API_KEY, API_URL, EMBED_CONFIG, mockNatzar, sid, type MockNatzarOptions} from './support/mock-natzar.ts';

const ORIGIN = 'https://portal.acme.test';
const HOST = 'portal.acme.test';
const {publicJwk: FRAME_KEY} = await generateFrameKeyPair();
const ASK = {audience: 'patient', surface: 'async', sessionId: null, reason: 'initial', frameKey: FRAME_KEY};
const UNTIL = new Date(Date.now() + 3_600_000);
const SECRET = 'whsec_test_secret';

/** identify for tests: the "login" is the `x-user` header (a cookie session, in effect). */
const identify: NatzarOptions<Request>['identify'] = (req) => {
  const user = req.headers.get('x-user');
  return user ? {patient: {externalId: user, phone: '+15551234567'}, login: `login-${user}`, until: UNTIL} : null;
};

function setup(options: Partial<NatzarOptions<Request>> = {}, api: MockNatzarOptions = {}) {
  const mock = mockNatzar(api);
  const logs: NatzarLogEntry[] = [];
  const nz = natzar<Request>({identify, apiKey: API_KEY, apiUrl: API_URL, fetch: mock.fetchLike, log: (e) => logs.push(e), ...options});
  return {nz, mock, logs};
}

type Headers_ = Record<string, string | null>;
/** A browser-shaped request: same-origin POST with the CSRF header, JSON, a signed-in user. `null` drops a header. */
function browser(path: string, init: {method?: string; headers?: Headers_; body?: unknown} = {}): Request {
  const base: Headers_ = {
    'content-type': 'application/json',
    'x-natzar-request': '1',
    origin: ORIGIN,
    'sec-fetch-site': 'same-origin',
    host: HOST,
    'x-user': 'u-1',
    cookie: 'sid=browser-cookie',
  };
  const headers = new Headers();
  for (const [k, v] of Object.entries({...base, ...init.headers})) if (v !== null) headers.set(k, v);
  const method = init.method ?? 'POST';
  const body = method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body ?? ASK);
  return new Request(`${ORIGIN}${path}`, {method, headers, ...(body !== undefined ? {body} : {})});
}

async function errorOf(res: Response): Promise<string | undefined> {
  const text = await res.text();
  return text ? (JSON.parse(text) as {error?: string}).error : undefined;
}

function assertEndpointHeaders(res: Response) {
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-natzar-endpoint'), '1');
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// ------------------------------------------------------------------ CSRF

describe('natzar() — CSRF and origin matrix (rule 2, T3)', () => {
  const refused: Array<[string, Headers_, string]> = [
    ['missing X-Natzar-Request', {'x-natzar-request': null}, 'forbidden'],
    ['a wrong X-Natzar-Request', {'x-natzar-request': '0'}, 'forbidden'],
    ['text/plain (a simple, preflight-free request)', {'content-type': 'text/plain'}, 'forbidden'],
    ['a form post', {'content-type': 'application/x-www-form-urlencoded'}, 'forbidden'],
    ['Sec-Fetch-Site: cross-site', {origin: 'https://evil.test', 'sec-fetch-site': 'cross-site'}, 'origin_not_allowed'],
    ['Sec-Fetch-Site: same-site from a sibling not in `origins`', {origin: 'https://blog.acme.test', 'sec-fetch-site': 'same-site'}, 'origin_not_allowed'],
    ['Sec-Fetch-Site: none', {'sec-fetch-site': 'none'}, 'origin_not_allowed'],
    ['no Sec-Fetch-Site and Origin host ≠ Host', {origin: 'https://evil.test', 'sec-fetch-site': null}, 'origin_not_allowed'],
    ['Origin: null', {origin: 'null'}, 'forbidden'],
    ['a non-canonical Origin', {origin: 'https://Portal.acme.test/'}, 'forbidden'],
    ['no Origin on a frame surface', {origin: null, 'sec-fetch-site': null}, 'forbidden'],
  ];
  for (const [name, headers, code] of refused) {
    it(`refuses ${name} (${code}), before identify and before any Natzar call`, async () => {
      let identified = 0;
      const {nz, mock} = setup({identify: (r, a) => (identified++, identify(r, a))});
      const res = await nz.fetch(browser('/natzar/session', {headers}));
      assert.equal(res.status, code === 'forbidden' ? 403 : 403);
      assert.equal(await errorOf(res), code);
      assertEndpointHeaders(res);
      assert.equal(res.headers.get('access-control-allow-origin'), null, 'no CORS for a refused origin');
      assert.equal(identified, 0);
      assert.equal(mock.calls.length, 0);
    });
  }

  it('refuses a disallowed cross-origin preflight without CORS headers', async () => {
    const {nz} = setup({origins: ['https://app.acme.test']});
    const res = await nz.fetch(browser('/natzar/session', {method: 'OPTIONS', headers: {origin: 'https://evil.test', 'access-control-request-method': 'POST'}}));
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  it('accepts same origin proven by Sec-Fetch-Site, even behind a proxy that rewrote Host', async () => {
    const {nz} = setup();
    const res = await nz.fetch(browser('/natzar/session', {headers: {host: 'internal-lb:8080'}}));
    assert.equal(res.status, 200);
  });

  it('accepts same origin proven by Origin host == Host when Sec-Fetch-Site is absent (older browsers)', async () => {
    const {nz, mock} = setup();
    const res = await nz.fetch(browser('/natzar/session', {headers: {'sec-fetch-site': null}}));
    assert.equal(res.status, 200);
    assert.equal((mock.mints()[0].body as {parentOrigin: string}).parentOrigin, ORIGIN);
  });

  it('answers CORS only for a listed cross origin, exactly, with credentials and the exposed endpoint header', async () => {
    const {nz, mock} = setup({origins: ['https://app.acme.test']});
    const pre = await nz.fetch(browser('/natzar/session', {method: 'OPTIONS', headers: {origin: 'https://app.acme.test', 'access-control-request-method': 'POST'}}));
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), 'https://app.acme.test');
    assert.equal(pre.headers.get('access-control-allow-credentials'), 'true');
    assert.match(pre.headers.get('access-control-allow-headers') ?? '', /X-Natzar-Request/);
    assert.match(pre.headers.get('access-control-allow-headers') ?? '', /Authorization/);
    const res = await nz.fetch(browser('/natzar/session', {headers: {origin: 'https://app.acme.test', 'sec-fetch-site': 'same-site'}}));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://app.acme.test');
    assert.match(res.headers.get('access-control-expose-headers') ?? '', /X-Natzar-Endpoint/);
    assert.equal(res.headers.get('vary'), 'Origin');
    assert.equal((mock.mints()[0].body as {parentOrigin: string}).parentOrigin, 'https://app.acme.test', 'parentOrigin is the verified Origin');
  });

  it('refuses `origins` entries that are not exact canonical origins, at construction', () => {
    for (const bad of ['https://app.acme.test/', 'https://*.acme.test', 'app.acme.test', 'https://APP.acme.test', 'null']) {
      assert.throws(() => natzar({identify, origins: [bad]}), /exact origins/, bad);
    }
  });
});

// ---------------------------------------------------------- native & bearer

describe('natzar() — bearer (auth hook) and native', () => {
  it('refuses surface native without a bearer — with or without an Origin', async () => {
    const {nz, mock} = setup({surfaces: ['native']});
    const ask = {audience: 'patient', surface: 'native', sessionId: null, reason: 'initial'};
    for (const headers of [{origin: null, 'sec-fetch-site': null, cookie: null}, {cookie: null}] as Headers_[]) {
      const res = await nz.fetch(browser('/natzar/session', {headers, body: ask}));
      assert.equal(res.status, 403);
      assert.equal(await errorOf(res), 'forbidden');
    }
    assert.equal(mock.calls.length, 0);
  });

  it('refuses native unless listed in `surfaces` (D10: off by default)', async () => {
    const {nz} = setup();
    const res = await nz.fetch(browser('/natzar/session', {headers: {origin: null, 'sec-fetch-site': null, authorization: 'Bearer tok'}, body: {audience: 'patient', surface: 'native', sessionId: null, reason: 'initial'}}));
    assert.equal(res.status, 403);
    assert.equal(await errorOf(res), 'surface_not_allowed');
  });

  it('mints native for an Origin-less bearer request: parentOrigin null, requestAuth bearer, token handed to identify', async () => {
    const asks: IdentifyAsk[] = [];
    const {nz, mock} = setup({
      surfaces: ['native'],
      identify: (_req, ask) => {
        asks.push(ask);
        return ask.token === 'firebase-id-token' ? {patient: {externalId: 'u-9'}, login: 'fb:u-9'} : null;
      },
    });
    const res = await nz.fetch(browser('/natzar/session', {
      headers: {origin: null, 'sec-fetch-site': null, cookie: null, 'x-user': null, authorization: 'Bearer firebase-id-token'},
      body: {audience: 'patient', surface: 'native', sessionId: null, reason: 'initial'},
    }));
    assert.equal(res.status, 200);
    const grant = (await res.json()) as {surface: string; sessionToken?: string};
    assert.equal(grant.surface, 'native');
    assert.equal(typeof grant.sessionToken, 'string');
    assert.equal(asks[0].token, 'firebase-id-token');
    const body = mock.mints()[0].body as Record<string, unknown>;
    assert.equal(body.parentOrigin, null);
    assert.equal(body.requestAuth, 'bearer');
    assert.equal('frameKey' in body, false);
  });

  it('marks requestAuth bearer ONLY for a Bearer request that carried no cookie (no ambient credential, RG5 S3)', async () => {
    const {nz, mock} = setup({identify: (_req, ask) => ({patient: {externalId: ask.token ?? 'cookie-user'}})});
    await nz.fetch(browser('/natzar/session'));
    // A cookie session plus a dummy bearer: identify may well have used the cookie.
    await nz.fetch(browser('/natzar/session', {headers: {authorization: 'Bearer spa-token'}}));
    await nz.fetch(browser('/natzar/session', {headers: {authorization: 'Bearer spa-token', cookie: null}}));
    await nz.fetch(browser('/natzar/session', {headers: {authorization: 'Basic dXNlcjpwYXNz', cookie: null}}));
    const bodies = mock.mints().map((c) => c.body as Record<string, unknown>);
    assert.deepEqual(bodies.map((b) => b.requestAuth), [undefined, undefined, 'bearer', undefined]);
    assert.deepEqual(bodies.map((b) => (b.patient as {externalId: string}).externalId), ['cookie-user', 'spa-token', 'spa-token', 'cookie-user']);
  });

  it('never mints native for a web page: an http(s) Origin, or a cookie beside the bearer, is refused (RG5 S4, S3)', async () => {
    const {nz, mock, logs} = setup({surfaces: ['native'], origins: ['https://app.acme.test', 'capacitor://localhost'], identify: () => ({patient: {externalId: 'u-9'}})});
    const ask = {audience: 'patient', surface: 'native', sessionId: null, reason: 'initial'};
    const web = await nz.fetch(browser('/natzar/session', {headers: {cookie: null, authorization: 'Bearer t'}, body: ask}));
    const listedWeb = await nz.fetch(browser('/natzar/session', {headers: {cookie: null, authorization: 'Bearer t', origin: 'https://app.acme.test', 'sec-fetch-site': 'same-site'}, body: ask}));
    const withCookie = await nz.fetch(browser('/natzar/session', {headers: {origin: null, 'sec-fetch-site': null, authorization: 'Bearer t'}, body: ask}));
    assert.deepEqual([web.status, listedWeb.status, withCookie.status], [403, 403, 403]);
    assert.equal(mock.calls.length, 0);
    assert.deepEqual(logs.map((l) => l.code), ['request_refused:native_from_web_origin', 'request_refused:native_from_web_origin', 'request_refused:native_needs_bearer']);
    // A native shell (Capacitor) is allowed when listed: bearer, no cookie, parentOrigin null.
    const shell = await nz.fetch(browser('/natzar/session', {headers: {cookie: null, authorization: 'Bearer t', origin: 'capacitor://localhost', 'sec-fetch-site': 'cross-site'}, body: ask}));
    assert.equal(shell.status, 200);
    assert.equal((mock.mints()[0].body as {parentOrigin: unknown}).parentOrigin, null);
  });
});

// ------------------------------------------------------------ strict body

describe('natzar() — strict body (rule 3)', () => {
  const bad: Array<[string, unknown, Headers_?]> = [
    ['an unknown key', {...ASK, patientId: 'someone-else'}],
    ['an identity in the body', {...ASK, externalId: 'u-2'}],
    ['a surface of the other audience', {...ASK, surface: 'workspace'}],
    ['renew without a sessionId', {...ASK, reason: 'renew'}],
    ['a sessionId on a mint', {...ASK, sessionId: sid(1)}],
    ['a frame surface without a frame key', {audience: 'patient', surface: 'async', sessionId: null, reason: 'initial'}],
    ['not JSON', '{"audience":'],
    ['a body over 4 KB (declared)', {...ASK, patient: 'x'.repeat(5000)}],
  ];
  for (const [name, body] of bad) {
    it(`refuses ${name}`, async () => {
      const {nz, mock} = setup();
      const res = await nz.fetch(browser('/natzar/session', {body}));
      assert.equal(res.status, 403);
      assert.equal(await errorOf(res), 'forbidden');
      assert.equal(mock.calls.length, 0);
    });
  }

  it('refuses a body over 4 KB that does not declare its length (streamed)', async () => {
    const {nz} = setup();
    const big = new TextEncoder().encode(JSON.stringify({...ASK, patient: 'x'.repeat(6000)}));
    const stream = new ReadableStream({start(c) {
      c.enqueue(big.slice(0, 3000));
      c.enqueue(big.slice(3000));
      c.close();
    }});
    const req = new Request(`${ORIGIN}/natzar/session`, {
      method: 'POST', body: stream, duplex: 'half',
      headers: {'content-type': 'application/json', 'x-natzar-request': '1', origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'x-user': 'u-1'},
    } as RequestInit);
    const res = await nz.fetch(req);
    assert.equal(res.status, 403);
  });

  it('refuses a surface not in `surfaces` — headless is opt-in (D10)', async () => {
    const {nz} = setup();
    const res = await nz.fetch(browser('/natzar/session', {body: {...ASK, surface: 'headless'}}));
    assert.equal(res.status, 403);
    assert.equal(await errorOf(res), 'surface_not_allowed');
  });
});

// ---------------------------------------------------------- identify result

describe('natzar() — identify and result checks (rule 4, T17)', () => {
  it('answers 401 signed_out for a falsy identify, and never calls Natzar', async () => {
    for (const nothing of [null, undefined, false, 0, '']) {
      const {nz, mock} = setup({identify: () => nothing as never});
      const res = await nz.fetch(browser('/natzar/session'));
      assert.equal(res.status, 401);
      assert.equal(await errorOf(res), 'signed_out');
      assert.equal(mock.calls.length, 0);
    }
  });

  it('refuses a result for the other audience with 403, never a mint', async () => {
    const {nz, mock} = setup({identify: () => ({clinician: {externalId: 'dr-1'}})});
    const res = await nz.fetch(browser('/natzar/session'));
    assert.equal(res.status, 403);
    assert.equal(await errorOf(res), 'forbidden');
    const other = setup({identify: () => ({patient: {externalId: 'u-1'}}), surfaces: ['workspace']});
    const res2 = await other.nz.fetch(browser('/natzar/session', {body: {audience: 'clinician', surface: 'workspace', sessionId: null, reason: 'initial', frameKey: FRAME_KEY}}));
    assert.equal(res2.status, 403);
    assert.equal(mock.calls.length + other.mock.calls.length, 0);
  });

  it('refuses an ask.patient the returned externalId does not match (M11)', async () => {
    const {nz, mock} = setup({identify: () => ({patient: {externalId: 'u-1'}})});
    const res = await nz.fetch(browser('/natzar/session', {body: {...ASK, patient: 'child-7'}}));
    assert.equal(res.status, 403);
    assert.equal(mock.calls.length, 0);
  });

  it('refuses an identify consult that points elsewhere than the element asked', async () => {
    const {nz, mock} = setup({identify: () => ({patient: {externalId: 'u-1'}, consult: 'async:other'})});
    const res = await nz.fetch(browser('/natzar/session', {body: {...ASK, consult: {kind: 'async', id: 'thr_1'}}}));
    assert.equal(res.status, 403);
    assert.equal(mock.calls.length, 0);
  });

  it('answers unavailable when identify throws, and logs a code only', async () => {
    const {nz, logs} = setup({identify: () => {
      throw new Error('db down: patient Jane Doe, MRN 123');
    }});
    const res = await nz.fetch(browser('/natzar/session'));
    assert.equal(res.status, 502);
    assert.equal(await errorOf(res), 'unavailable');
    assert.deepEqual(logs, [{code: 'identify_failed', route: 'session'}]);
  });

  it('refuses a malformed identify answer as unavailable, logging the FIELD, never the value', async () => {
    const {nz, logs, mock} = setup({identify: () => ({patient: {externalId: 'u-1', phone: '+15551234567', birthdate: 'Jan 1st 1990', ssn: '123-45-6789'} as never})});
    const res = await nz.fetch(browser('/natzar/session'));
    assert.equal(res.status, 502);
    assert.equal(mock.calls.length, 0);
    assert.equal(logs.length, 1);
    assert.match(logs[0].code, /^identify_result_invalid:/);
    assert.doesNotMatch(JSON.stringify(logs), /123-45-6789|Jan 1st/);
  });

  it('builds the mint: loginRef = sha256(natzar-login:login), until, verified parentOrigin, the key, and no browser header', async () => {
    const {nz, mock} = setup({
      identify: () => ({
        patient: {externalId: 'u-1', phone: '+15551234567', email: null, givenName: 'Ada', familyName: 'L', birthdate: new Date('1990-04-17T00:00:00Z'), sex: 'female'},
        login: 'sess-abc',
        until: UNTIL,
      }),
    });
    const res = await nz.fetch(browser('/natzar/session', {headers: {authorization: null}}));
    assert.equal(res.status, 200);
    const call = mock.mints()[0];
    const body = call.body as Record<string, unknown>;
    assert.equal(body.loginRef, sha256('natzar-login:sess-abc'));
    assert.equal(JSON.stringify(body).includes('sess-abc'), false, 'the raw login never leaves your server');
    assert.equal(body.until, UNTIL.toISOString());
    assert.equal(body.parentOrigin, ORIGIN);
    assert.deepEqual(body.patient, {externalId: 'u-1', phone: '+15551234567', givenName: 'Ada', familyName: 'L', birthdate: '1990-04-17', sex: 'female'});
    assert.equal('partnerStart' in body, false, 'no onStart, no Start button');
    // Rule 7: nothing of the browser request is forwarded.
    assert.equal(call.headers.authorization, `Bearer ${API_KEY}`);
    for (const h of ['cookie', 'origin', 'sec-fetch-site', 'x-user', 'x-natzar-request']) assert.equal(h in call.headers, false, h);
  });

  it('renews with the sessionId, and hands a successor over as successorOf', async () => {
    const {nz, mock} = setup({surfaces: ['workspace'], identify: () => ({clinician: {externalId: 'dr-1'}, login: 'L'})});
    const base = {audience: 'clinician', surface: 'workspace', frameKey: FRAME_KEY};
    const renew = await nz.fetch(browser('/natzar/session', {body: {...base, sessionId: sid(7), reason: 'renew'}}));
    assert.equal(renew.status, 200);
    await nz.fetch(browser('/natzar/session', {body: {...base, sessionId: sid(8), reason: 'successor'}}));
    const [a, b] = mock.mints().map((c) => c.body as Record<string, unknown>);
    assert.equal(a.sessionId, sid(7));
    assert.equal('successorOf' in a, false);
    assert.equal(b.successorOf, sid(8));
    assert.equal('sessionId' in b, false);
  });
});

// ------------------------------------------------------------ error codes

describe('natzar() — error allowlist (rule 8, m3)', () => {
  const table: Array<[string, number, string, number]> = [
    ['login_expired', 401, 'signed_out', 401],
    ['session_revoked', 401, 'forbidden', 403],
    ['session_ended', 401, 'forbidden', 403],
    ['renew_mismatch', 403, 'forbidden', 403],
    ['phone_unavailable', 409, 'forbidden', 403],
    ['origin_not_allowed', 403, 'origin_not_allowed', 403],
    ['surface_not_allowed', 403, 'surface_not_allowed', 403],
    ['embedding_disabled', 403, 'embedding_disabled', 403],
    ['rate_limited', 429, 'rate_limited', 429],
    ['invalid_request', 400, 'unavailable', 502],
    ['internal_error', 500, 'unavailable', 502],
    ['some_future_code', 418, 'unavailable', 502],
  ];
  for (const [apiCode, apiStatus, code, status] of table) {
    it(`${apiCode} (${apiStatus}) → ${code} (${status}), never echoing the body`, async () => {
      const {nz} = setup({}, {onMint: () => ({status: apiStatus, code: apiCode, details: {secret: 'SECRET-DETAIL'}, retryAfter: '9'})});
      const res = await nz.fetch(browser('/natzar/session'));
      assert.equal(res.status, status);
      const text = await res.text();
      assert.equal(text, JSON.stringify({error: code}));
      assert.ok((ENDPOINT_ERROR_CODES as readonly string[]).includes(code));
      if (code === 'rate_limited') assert.equal(res.headers.get('retry-after'), '9');
      assertEndpointHeaders(res);
    });
  }

  it('answers every route, 404 included, with no-store, nosniff and X-Natzar-Endpoint', async () => {
    const {nz} = setup();
    for (const req of [browser('/natzar/session'), browser('/natzar/nope'), browser('/natzar/session', {headers: {'x-natzar-request': null}})]) {
      assertEndpointHeaders(await nz.fetch(req));
    }
  });
});

// ------------------------------------------------------------------ routes

describe('natzar() — routes (rule 1)', () => {
  it('answers 404 for everything but its routes', async () => {
    const {nz, mock} = setup();
    const cases: Array<[string, string]> = [
      ['GET', '/natzar/session'], ['PUT', '/natzar/session'], ['POST', '/natzar/sessions'], ['POST', '/natzar/session/x'],
      ['POST', '/natzar/start'], ['POST', '/natzar/webhook'], ['POST', '/natzar/embed.js'], ['POST', '/natzar/session.json'], ['POST', '/natzar//session'],
      ['GET', '/natzar'], ['GET', '/natzar/'], ['DELETE', '/natzar/config'],
    ];
    for (const [method, path] of cases) {
      const res = await nz.fetch(browser(path, {method}));
      assert.equal(res.status, 404, `${method} ${path}`);
    }
    assert.equal(mock.calls.length, 0);
  });

  it('routes on the last segment below any valid mount (two zones: /natzar-us, /natzar-ca)', async () => {
    const {nz} = setup();
    assert.equal((await nz.fetch(browser('/natzar-ca/session'))).status, 200);
    assert.equal((await nz.fetch(browser('/session'))).status, 200, 'Express strips the mount: req.url is /session');
  });

  it('GET /embed.js answers 302 to the loader of the key\'s deployment, cached an hour by the browser', async () => {
    const {nz} = setup();
    const res = await nz.fetch(browser('/natzar/embed.js', {method: 'GET'}));
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), EMBED_CONFIG.loaderUrl);
    assert.equal(res.headers.get('cache-control'), 'max-age=3600');
    assert.equal(res.headers.get('x-natzar-endpoint'), '1');
  });

  it('GET /config relays the deployment facts plus the key-derived apiUrl, with CORS only for listed origins', async () => {
    const {nz} = setup({origins: ['https://app.acme.test']});
    const same = await nz.fetch(browser('/natzar/config', {method: 'GET'}));
    assert.deepEqual(await same.json(), {...EMBED_CONFIG, apiUrl: API_URL});
    assert.equal(same.headers.get('access-control-allow-origin'), null);
    const listed = await nz.fetch(browser('/natzar/config', {method: 'GET', headers: {origin: 'https://app.acme.test'}}));
    assert.equal(listed.headers.get('access-control-allow-origin'), 'https://app.acme.test');
    const other = await nz.fetch(browser('/natzar/config', {method: 'GET', headers: {origin: 'https://evil.test'}}));
    assert.equal(other.headers.get('access-control-allow-origin'), null);
  });

  it('caches GET /v1/embed/config per instance for 5 minutes, single-flight (rule 13)', async (t) => {
    t.mock.timers.enable({apis: ['Date'], now: Date.now()});
    const {nz, mock} = setup();
    await Promise.all([1, 2, 3].map(() => nz.fetch(browser('/natzar/embed.js', {method: 'GET'}))));
    await nz.fetch(browser('/natzar/config', {method: 'GET'}));
    const configCalls = () => mock.calls.filter((c) => c.path === '/embed/config').length;
    assert.equal(configCalls(), 1);
    t.mock.timers.tick(299_000);
    await nz.fetch(browser('/natzar/embed.js', {method: 'GET'}));
    assert.equal(configCalls(), 1, 'still cached at 4:59');
    t.mock.timers.tick(2_000);
    await nz.fetch(browser('/natzar/embed.js', {method: 'GET'}));
    assert.equal(configCalls(), 2, 'refetched after 5 minutes');
  });

  it('limits one login to 30 session asks a minute on this instance (rule 10), before calling Natzar', async () => {
    const {nz, mock} = setup();
    for (let i = 0; i < 30; i++) assert.equal((await nz.fetch(browser('/natzar/session'))).status, 200);
    const res = await nz.fetch(browser('/natzar/session'));
    assert.equal(res.status, 429);
    assert.equal(await errorOf(res), 'rate_limited');
    assert.ok(Number(res.headers.get('retry-after')) >= 1);
    assert.equal(mock.mints().length, 30);
    // Another login is unaffected.
    assert.equal((await nz.fetch(browser('/natzar/session', {headers: {'x-user': 'u-2'}}))).status, 200);
  });

  it('refuses to construct without identify, with an unknown surface, and answers a missing key loudly', async () => {
    assert.throws(() => natzar({} as never), /identify/);
    assert.throws(() => natzar({identify, surfaces: ['everything' as never]}), /unknown surface/);
    const logs: NatzarLogEntry[] = [];
    const nz = natzar<Request>({identify, log: (e) => logs.push(e)});
    const original = console.error;
    const errors: string[] = [];
    console.error = (m: unknown) => void errors.push(String(m));
    try {
      const res = await nz.fetch(browser('/natzar/session'));
      assert.equal(res.status, 502);
      assert.equal(res.headers.get('x-natzar-endpoint'), '1');
    } finally {
      console.error = original;
    }
    assert.match(errors.join(), /NATZAR_API_KEY/);
    assert.deepEqual(logs.map((l) => l.code), ['misconfigured']);
  });

  it('reads NATZAR_API_KEY / NATZAR_API_URL from a Workers-style env passed to fetch(request, env)', async () => {
    const mock = mockNatzar();
    const nz = natzar<Request>({identify, fetch: mock.fetchLike});
    const res = await nz.fetch(browser('/natzar/session'), {NATZAR_API_KEY: API_KEY, NATZAR_API_URL: API_URL});
    assert.equal(res.status, 200);
    assert.equal(mock.mints()[0].headers.authorization, `Bearer ${API_KEY}`);
  });
});

// --------------------------------------------------------------- onStart

describe('natzar() — in-widget Start through onStart (D1)', () => {
  const START = {audience: 'patient', surface: 'async', sessionId: null, kind: 'async', frameKey: FRAME_KEY};

  it('has no /start route without onStart', async () => {
    const {nz, mock} = setup();
    assert.equal((await nz.fetch(browser('/natzar/start', {body: START}))).status, 404);
    assert.equal(mock.calls.length, 0);
  });

  it('refuses when onStart says no (false, null), and never opens a consult', async () => {
    for (const no of [false, null, undefined]) {
      const {nz, mock} = setup({onStart: () => no});
      const res = await nz.fetch(browser('/natzar/start', {body: START}));
      assert.equal(res.status, 403);
      assert.equal(mock.calls.length, 0);
    }
  });

  it('applies the CSRF and identify rules to /start too', async () => {
    const {nz, mock} = setup({onStart: () => true});
    assert.equal((await nz.fetch(browser('/natzar/start', {body: START, headers: {'x-natzar-request': null}}))).status, 403);
    assert.equal((await nz.fetch(browser('/natzar/start', {body: START, headers: {origin: 'https://evil.test', 'sec-fetch-site': 'cross-site'}}))).status, 403);
    assert.equal((await nz.fetch(browser('/natzar/start', {body: START, headers: {'x-user': null}}))).status, 401);
    assert.equal((await nz.fetch(browser('/natzar/start', {body: {...START, kind: 'telehealth'}}))).status, 403, 'kind must be the tag\'s');
    assert.equal(mock.calls.length, 0);
  });

  it('answers unavailable when onStart throws', async () => {
    const {nz} = setup({onStart: () => {
      throw new Error('billing down');
    }});
    assert.equal((await nz.fetch(browser('/natzar/start', {body: START}))).status, 502);
  });

  it('true → opens the visit with YOUR key (consent in the widget) and returns a session scoped to it, in one round trip', async () => {
    const seen: unknown[] = [];
    const {nz, mock} = setup({onStart: (_req, start) => (seen.push(start), true)});
    const res = await nz.fetch(browser('/natzar/start', {body: START}));
    assert.equal(res.status, 200);
    const grant = (await res.json()) as {scope: {consult?: unknown}};
    assert.deepEqual(grant.scope.consult, {kind: 'async', id: 'thr_new'});
    assert.deepEqual(seen, [{kind: 'async', surface: 'async'}]);
    const create = mock.calls.find((c) => c.path === '/async-consults')!;
    assert.deepEqual(create.body, {externalPatientId: 'u-1', consent: 'embed'});
    assert.equal(create.headers.authorization, `Bearer ${API_KEY}`);
    const mint = mock.mints()[0].body as Record<string, unknown>;
    assert.deepEqual(mint.consult, {kind: 'async', id: 'thr_new'});
    assert.equal(mint.partnerStart, true);
    assert.equal(mint.parentOrigin, ORIGIN);
  });

  it('{context} → the handoff note rides on the create; telehealth keeps its mode', async () => {
    const {nz, mock} = setup({surfaces: ['telehealth'], onStart: () => ({context: 'Member, plan care'})});
    const res = await nz.fetch(browser('/natzar/start', {body: {...START, surface: 'telehealth', kind: 'telehealth', mode: 'scheduled'}}));
    assert.equal(res.status, 200);
    assert.deepEqual(mock.calls.find((c) => c.path === '/telehealth-consults')!.body, {externalPatientId: 'u-1', mode: 'scheduled', context: 'Member, plan care'});
  });

  it('a second Start lands on the open thread (has_open_thread) instead of failing', async () => {
    const {nz, mock} = setup({onStart: () => true}, {onCreate: () => ({status: 409, code: 'has_open_thread', details: {asyncConsultId: 'thr_open'}})});
    const res = await nz.fetch(browser('/natzar/start', {body: START}));
    assert.equal(res.status, 200);
    assert.deepEqual((mock.mints()[0].body as {consult: unknown}).consult, {kind: 'async', id: 'thr_open'});
  });

  it('a REST refusal of the visit (on-demand switch off, payment) is forbidden, not an outage', async () => {
    const {nz} = setup({onStart: () => true}, {onCreate: () => ({status: 409, code: 'feature_disabled'})});
    const res = await nz.fetch(browser('/natzar/start', {body: START}));
    assert.equal(res.status, 403);
    assert.equal(await errorOf(res), 'forbidden');
  });
});

// ---------------------------------------------------------- helpers

describe('natzar() — helpers for your own routes', () => {
  it('startConsult: signed out throws signed_out; a clinician throws forbidden; nothing is created', async () => {
    const {nz, mock} = setup();
    await assert.rejects(() => nz.startConsult(browser('/x', {headers: {'x-user': null}}), {kind: 'async'}), (e: {code?: string}) => e.code === 'signed_out');
    const clin = setup({identify: () => ({clinician: {externalId: 'dr-1'}})});
    await assert.rejects(() => clin.nz.startConsult(browser('/x'), {kind: 'async'}), (e: {code?: string}) => e.code === 'forbidden');
    await assert.rejects(() => nz.startConsult(browser('/x'), {kind: 'bogus' as never}), /kind must be/);
    assert.equal(mock.calls.length + clin.mock.calls.length, 0);
  });

  it('startConsult: async (consent in the widget), referral_request (collected), telehealth; a complete profile is upserted first', async () => {
    const full = {externalId: 'u-1', phone: '+15551234567', email: 'a@b.test', givenName: 'Ada', familyName: 'L', birthdate: '1990-04-17', sex: 'female' as const};
    const {nz, mock} = setup({identify: () => ({patient: full})});
    const a = await nz.startConsult(browser('/x'), {kind: 'async', context: 'Follow-up'});
    assert.equal(a.kind, 'async');
    assert.equal(a.consult.id, 'thr_new');
    await nz.startConsult(browser('/x'), {kind: 'referral_request', subject: 'Lipid panel', context: 'Annual check'});
    const t = await nz.startConsult(browser('/x'), {kind: 'telehealth', mode: 'queue'});
    assert.equal(t.kind, 'telehealth');
    const wire = mock.calls.map((c) => `${c.method} ${c.path} ${JSON.stringify(c.body)}`);
    assert.deepEqual(wire, [
      `POST /patients ${JSON.stringify(full)}`,
      'POST /async-consults {"externalPatientId":"u-1","consent":"embed","context":"Follow-up"}',
      `POST /patients ${JSON.stringify(full)}`,
      'POST /async-consults {"externalPatientId":"u-1","consent":"collected","kind":"referral_request","subject":"Lipid panel","context":"Annual check"}',
      `POST /patients ${JSON.stringify(full)}`,
      'POST /telehealth-consults {"externalPatientId":"u-1","mode":"queue"}',
    ]);
  });

  it('startConsult takes a Node/Express req as well as a Fetch Request, and passes its bearer as ask.token', async () => {
    const asks: IdentifyAsk[] = [];
    const {nz, mock} = setup({identify: (_r, ask) => (asks.push(ask), {patient: {externalId: 'u-1'}})});
    const nodeReq = {method: 'POST', url: '/visits', headers: {authorization: 'Bearer spa'}, on() {}} as never;
    await nz.startConsult(nodeReq, {kind: 'async'});
    assert.equal(asks[0].token, 'spa');
    assert.equal(mock.calls.length, 1, 'a partial profile is not upserted: the patient must exist');
  });

  it('revokeLogin hashes the login; revokePatient, revokeClinician; deactivateClinician resolves your id first', async () => {
    const {nz, mock} = setup();
    assert.deepEqual(await nz.revokeLogin('sess-abc'), {revoked: 2});
    await nz.revokePatient('u-1');
    await nz.revokeClinician('dr-9');
    await nz.revokeClinician({physicianId: 'ph_9'});
    assert.deepEqual(await nz.deactivateClinician('dr-9'), {deactivated: true, revoked: 1});
    assert.deepEqual(await nz.deactivateClinician({physicianId: 'ph_9'}), {deactivated: true, revoked: 1});
    await assert.rejects(() => nz.deactivateClinician('dr-unknown'), (e: {code?: string}) => e.code === 'not_found');
    await assert.rejects(() => nz.revokeLogin(''), /login id/);
    // RG5 S2: never hash an object (or a boolean) into a shared loginRef.
    await assert.rejects(() => nz.revokeLogin({id: 'sess'} as never), /login id/);
    await assert.rejects(() => nz.revokeLogin(true as never), /login id/);
    const bodies = mock.calls.filter((c) => c.path === '/sessions/revoke').map((c) => c.body);
    assert.deepEqual(bodies, [
      {loginRef: sha256('natzar-login:sess-abc')},
      {patient: {externalId: 'u-1'}},
      {clinician: {externalId: 'dr-9'}},
      {clinician: {physicianId: 'ph_9'}},
    ]);
    // Deactivation by YOUR id is one call (RG0.6 CR4), by ours the {id} route.
    const deactivations = mock.calls.filter((c) => c.path.endsWith('/deactivate')).map((c) => `${c.path} ${JSON.stringify(c.body)}`);
    assert.deepEqual(deactivations, ['/physicians/deactivate {"externalId":"dr-9"}', '/physicians/ph_9/deactivate {}', '/physicians/deactivate {"externalId":"dr-unknown"}']);
    assert.equal(mock.calls.some((c) => c.method === 'GET'), false, 'no lookup first');
  });

  it('exposes a NatzarClient built from the key', () => {
    const {nz} = setup();
    assert.equal(nz.client.credential, 'apiKey');
    assert.equal(nz.client.endpoints.baseUrl, API_URL);
    assert.equal(nz.client.environment, 'sbx');
  });
});

// ------------------------------------------------------------- webhooks

const EVENT = {id: 'evt_1', type: 'async_consult.assigned', createdAt: '2026-10-01T00:00:00Z', data: {consultId: 'thr_1'}};

async function signed(rawBody: string, timestamp?: number) {
  return signWebhook({secret: SECRET, rawBody, ...(timestamp !== undefined ? {timestamp} : {})});
}

function hook(body: string, signature: string, extra: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/natzar/webhook`, {method: 'POST', headers: {'content-type': 'application/json', 'x-natzar-signature': signature, ...extra}, body});
}

describe('natzar() — webhooks (rule 11)', () => {
  it('refuses a bad signature, a stale timestamp and a missing header without calling your handler', async () => {
    const events: unknown[] = [];
    const {nz, logs} = setup({webhookSecret: SECRET, onEvent: (e) => void events.push(e)});
    const raw = JSON.stringify(EVENT);
    assert.equal((await nz.fetch(hook(raw, await signWebhook({secret: 'wrong', rawBody: raw})))).status, 400);
    assert.equal((await nz.fetch(hook(raw, await signed(raw, Math.floor(Date.now() / 1000) - 301)))).status, 400);
    assert.equal((await nz.fetch(hook(raw, ''))).status, 400);
    // The signature covers the RAW bytes: a re-serialized body does not verify.
    assert.equal((await nz.fetch(hook(JSON.stringify(EVENT, null, 2), await signed(raw)))).status, 400);
    assert.equal(events.length, 0);
    assert.deepEqual(logs.map((l) => l.code), ['webhook_signature_mismatch', 'webhook_timestamp_out_of_tolerance', 'webhook_malformed_signature', 'webhook_signature_mismatch']);
  });

  it('verifies the raw body within 5 minutes and calls onEvent once, answering 200', async () => {
    const events: unknown[] = [];
    const {nz} = setup({webhookSecret: SECRET, onEvent: (e) => void events.push(e)});
    const raw = JSON.stringify(EVENT);
    const res = await nz.fetch(hook(raw, await signed(raw, Math.floor(Date.now() / 1000) - 290)));
    assert.equal(res.status, 200);
    assert.deepEqual(events, [EVENT]);
    assertEndpointHeaders(res);
  });

  it('answers 500 when the handler throws (Natzar retries: at-least-once), and lets the retry through the dedupe', async () => {
    const seenIds = new Set<string>();
    let fail = true;
    const handled: string[] = [];
    const {nz} = setup({
      webhookSecret: SECRET,
      dedupe: {seen: (id) => (seenIds.has(id) ? true : (seenIds.add(id), false)), forget: (id) => void seenIds.delete(id)},
      onEvent: (e) => {
        if (fail) throw new Error('db down');
        handled.push(e.id);
      },
    });
    const raw = JSON.stringify(EVENT);
    assert.equal((await nz.fetch(hook(raw, await signed(raw)))).status, 500);
    fail = false;
    assert.equal((await nz.fetch(hook(raw, await signed(raw)))).status, 200, 'the retry is processed');
    assert.equal((await nz.fetch(hook(raw, await signed(raw)))).status, 200, 'a duplicate is acknowledged');
    assert.deepEqual(handled, ['evt_1'], 'and processed exactly once');
  });

  it('fails LOUDLY when a body parser already consumed the body, naming the fix', async () => {
    const {nz} = setup({webhookSecret: SECRET, onEvent: () => {}});
    const raw = JSON.stringify(EVENT);
    const req = hook(raw, await signed(raw));
    await req.json(); // a framework's body parser got there first
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => void errors.push(a);
    try {
      const res = await nz.fetch(req);
      assert.equal(res.status, 500);
      assert.equal(res.headers.get('x-natzar-endpoint'), null);
    } finally {
      console.error = original;
    }
    assert.match(String(errors[0]?.[0]), /webhook_body_consumed/);
    assert.match(String(errors[0]?.[0]), /BEFORE body parsers/);
  });

  it('answers 500 (and says why, once) when onEvent is set but there is no secret', async () => {
    const {nz, logs} = setup({onEvent: () => {}});
    const raw = JSON.stringify(EVENT);
    const original = console.error;
    console.error = () => {};
    try {
      assert.equal((await nz.fetch(hook(raw, await signed(raw)))).status, 500);
    } finally {
      console.error = original;
    }
    assert.equal(logs[0].code, 'webhook_secret_missing');
  });

  it('verifies through the Next.js POST export too', async () => {
    const events: unknown[] = [];
    const {nz} = setup({webhookSecret: SECRET, onEvent: (e) => void events.push(e)});
    const {POST} = nz;
    const raw = JSON.stringify(EVENT);
    assert.equal((await POST(hook(raw, await signed(raw)))).status, 200);
    assert.equal(events.length, 1);
  });
});

// ------------------------------------------------------ adapters: Next.js

describe('natzar() — Next.js App Router exports', () => {
  it('export const {GET, POST, OPTIONS} work unbound, and ignore Next\'s second argument', async () => {
    const {nz} = setup({origins: ['https://app.acme.test']});
    const {GET, POST, OPTIONS} = nz;
    const ctx = {params: Promise.resolve({natzar: ['session']}), NATZAR_API_KEY: 'pp_test_sbx_us_bogus'} as never;
    assert.equal((await (POST as (r: Request, c: unknown) => Promise<Response>)(browser('/natzar/session'), ctx)).status, 200);
    assert.equal((await GET(browser('/natzar/embed.js', {method: 'GET'}))).status, 302);
    assert.equal((await OPTIONS(browser('/natzar/session', {method: 'OPTIONS', headers: {origin: 'https://app.acme.test', 'access-control-request-method': 'POST'}}))).status, 204);
  });
});

// --------------------------------------------------- adapters: Node / Express

type Mw = (req: IncomingMessage & Record<string, unknown>, res: ServerResponse, next: (e?: unknown) => void) => void;

/** A Node server running `stack` in order (a connect chain without mount paths). */
async function serve(stack: Mw[]) {
  const server = createServer((req, res) => {
    let i = 0;
    const next = (e?: unknown) => {
      if (e) {
        res.statusCode = 500;
        res.end('error');
        return;
      }
      const mw = stack[i++];
      if (!mw) {
        res.statusCode = 404;
        res.end('fell through');
        return;
      }
      mw(req as never, res, next);
    };
    next();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {port, close: () => new Promise<void>((r) => server.close(() => r()))};
}

function post(port: number, path: string, body: string, headers: Record<string, string>): Promise<{status: number; headers: Record<string, string | string[] | undefined>; body: string}> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({host: '127.0.0.1', port, path, method: 'POST', headers: {'content-length': String(Buffer.byteLength(body)), ...headers}}, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({status: res.statusCode ?? 0, headers: res.headers, body: data}));
    });
    req.on('error', reject);
    req.end(body);
  });
}

describe('natzar() — Node / Express adapter', () => {
  const nodeIdentify = (req: {headers: Record<string, string | undefined>}) => (req.headers['x-user'] ? {patient: {externalId: String(req.headers['x-user'])}, login: 'L'} : null);

  it('serves /session over node:http as (req, res, next) middleware', async () => {
    const mock = mockNatzar();
    const nz = natzar({identify: nodeIdentify, apiKey: API_KEY, apiUrl: API_URL, fetch: mock.fetchLike, log: () => {}});
    const srv = await serve([nz as unknown as Mw]);
    try {
      const res = await post(srv.port, '/natzar/session', JSON.stringify(ASK), {
        'content-type': 'application/json', 'x-natzar-request': '1', origin: `http://127.0.0.1:${srv.port}`, 'x-user': 'u-1',
      });
      assert.equal(res.status, 200, res.body);
      assert.equal(res.headers['x-natzar-endpoint'], '1');
      assert.equal((mock.mints()[0].body as {parentOrigin: string}).parentOrigin, `http://127.0.0.1:${srv.port}`, 'Origin host == Host proved same origin');
    } finally {
      await srv.close();
    }
  });

  it('webhooks: the raw stream verifies; an express.raw() Buffer verifies; a parsed body fails loudly', async () => {
    const events: unknown[] = [];
    const nz = natzar({identify: nodeIdentify, apiKey: API_KEY, apiUrl: API_URL, webhookSecret: SECRET, onEvent: (e) => void events.push(e), log: () => {}});
    const raw = JSON.stringify(EVENT);
    const sig = await signed(raw);
    const read = (req: IncomingMessage) => new Promise<Buffer>((r) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => r(Buffer.concat(chunks)));
    });
    const rawParser: Mw = async (req, _res, next) => {
      req.body = await read(req);
      next();
    };
    const jsonParser: Mw = async (req, _res, next) => {
      req.body = JSON.parse((await read(req)).toString('utf8'));
      req._body = true;
      next();
    };
    const original = console.error;
    const errors: string[] = [];
    console.error = (m: unknown) => void errors.push(String(m));
    try {
      for (const [stack, status] of [[[nz], 200], [[rawParser, nz], 200], [[jsonParser, nz], 500]] as Array<[Mw[], number]>) {
        const srv = await serve(stack as Mw[]);
        try {
          const res = await post(srv.port, '/natzar/webhook', raw, {'content-type': 'application/json', 'x-natzar-signature': sig});
          assert.equal(res.status, status, res.body);
        } finally {
          await srv.close();
        }
      }
    } finally {
      console.error = original;
    }
    assert.equal(events.length, 2);
    assert.match(errors.join('\n'), /webhook_body_consumed/);
  });
});

// ------------------------------------------------------- RG5 review fixes

describe('natzar() — RG5 review fixes', () => {
  it('S1: a Date birthdate is its UTC date at UTC midnight, its local date at local midnight, refused otherwise — in every server zone', () => {
    const child = fileURLToPath(new URL('./support/dob-child.mjs', import.meta.url));
    for (const tz of ['UTC', 'Europe/Zurich', 'Asia/Tokyo', 'America/Los_Angeles']) {
      const run = spawnSync(process.execPath, [child], {env: {...process.env, TZ: tz}, encoding: 'utf8'});
      assert.equal(run.status, 0, run.stderr);
      const out = JSON.parse(run.stdout) as Record<string, {status: number; birthdate: string | null; logs: string[]}>;
      assert.equal(out.local.birthdate, '1980-02-03', `${tz}: local midnight (node-postgres DATE)`);
      assert.equal(out.utc.birthdate, '1980-02-03', `${tz}: UTC midnight`);
      assert.equal(out.noon.status, 502, `${tz}: noon is ambiguous`);
      assert.equal(out.noon.birthdate, null, `${tz}: nothing was minted`);
      assert.deepEqual(out.noon.logs, ['identify_result_invalid:patient.birthdate']);
    }
  });

  it('S2: an object or boolean login is refused (logged by field), never hashed into a shared loginRef; numbers are fine', async () => {
    for (const login of [{id: 's'}, ['s'], true, 'x'.repeat(1025)]) {
      const {nz, mock, logs} = setup({identify: () => ({patient: {externalId: 'u-1'}, login: login as never})});
      const res = await nz.fetch(browser('/natzar/session'));
      assert.equal(res.status, 502);
      assert.equal(mock.calls.length, 0);
      assert.deepEqual(logs.map((l) => l.code), ['identify_result_invalid:login']);
    }
    const {nz, mock} = setup({identify: () => ({patient: {externalId: 'u-1'}, login: 4711})});
    assert.equal((await nz.fetch(browser('/natzar/session'))).status, 200);
    assert.equal((mock.mints()[0].body as {loginRef: string}).loginRef, sha256('natzar-login:4711'));
  });

  it('S9 (M11): the element\'s patient becomes askPatient, echoed as scope.patient', async () => {
    const {nz, mock} = setup({identify: (_r, ask) => ({patient: {externalId: ask.patient ?? 'u-1'}})});
    const res = await nz.fetch(browser('/natzar/session', {body: {...ASK, patient: 'child-7'}}));
    assert.equal(res.status, 200);
    assert.equal((mock.mints()[0].body as {askPatient?: string}).askPatient, 'child-7');
    assert.equal(((await res.json()) as {scope: {patient?: string}}).scope.patient, 'child-7');
    await nz.fetch(browser('/natzar/session'));
    assert.equal('askPatient' in (mock.mints()[1].body as object), false, 'absent when the element named none');
  });

  it('N5: an epoch-SECONDS until is refused loudly, never read as 1970; epoch milliseconds are fine', async () => {
    const seconds = setup({identify: () => ({patient: {externalId: 'u-1'}, until: Math.floor(Date.now() / 1000) + 3600})});
    assert.equal((await seconds.nz.fetch(browser('/natzar/session'))).status, 502);
    assert.deepEqual(seconds.logs.map((l) => l.code), ['identify_until_invalid']);
    const ms = setup({identify: () => ({patient: {externalId: 'u-1'}, until: Date.now() + 3_600_000})});
    assert.equal((await ms.nz.fetch(browser('/natzar/session'))).status, 200);
  });

  it('N6: a refused profile field is logged by its path through the union (patient.sex), never its value', async () => {
    const {nz, logs} = setup({identify: () => ({patient: {externalId: 'u-1', phone: '+15551234567', sex: 'M'}})});
    assert.equal((await nz.fetch(browser('/natzar/session'))).status, 502);
    assert.deepEqual(logs.map((l) => l.code), ['identify_result_invalid:patient.sex']);
  });

  it('N2/N3: Retry-After is capped at an hour; the grant is relayed PARSED (unknown keys dropped) and a malformed one refused', async () => {
    const slow = setup({}, {onMint: () => ({status: 429, code: 'rate_limited', retryAfter: '99999'})});
    assert.equal((await slow.nz.fetch(browser('/natzar/session'))).headers.get('retry-after'), '3600');
    const extra = setup({}, {grantOverride: (g) => ({...g, debugInternal: 'x'})});
    const grant = (await (await extra.nz.fetch(browser('/natzar/session'))).json()) as Record<string, unknown>;
    assert.equal('debugInternal' in grant, false);
    assert.equal(grant.protocolVersion, 2);
    const broken = setup({}, {grantOverride: (g) => ({...g, sealedToken: undefined})});
    assert.equal((await broken.nz.fetch(browser('/natzar/session'))).status, 502);
    assert.deepEqual(broken.logs.map((l) => l.code), ['grant_invalid']);
  });

  it('N4: a live key\'s deployment config must be production-shaped (no http loader)', async () => {
    const live = `pp_live_us_${'b'.repeat(48)}`;
    const {nz, logs} = setup({apiKey: live}, {apiKey: live, config: {...EMBED_CONFIG, loaderUrl: 'http://localhost:5173/v2/natzar.js?p=partner_1'}});
    const original = console.error;
    console.error = () => {};
    try {
      assert.equal((await nz.fetch(browser('/natzar/embed.js', {method: 'GET'}))).status, 502);
    } finally {
      console.error = original;
    }
    assert.deepEqual(logs.map((l) => l.code), ['misconfigured']);
  });

  it('N8: a sandbox key without NATZAR_API_URL is a loud configuration error, not an outage', async () => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (m: unknown) => void errors.push(String(m));
    try {
      const nz = natzar<Request>({identify, apiKey: API_KEY, log: () => {}});
      assert.equal((await nz.fetch(browser('/natzar/session'))).status, 502);
    } finally {
      console.error = original;
    }
    assert.match(errors.join(), /NATZAR_API_URL/);
  });

  it('N1: basePath pins the mount; under Express only routes directly below the mount answer, never at the app root', async () => {
    const pinned = setup({basePath: '/api/natzar'});
    assert.equal((await pinned.nz.fetch(browser('/api/natzar/session'))).status, 200);
    for (const path of ['/natzar/session', '/api/users/session', '/session', '/api/natzar/x/session']) {
      assert.equal((await pinned.nz.fetch(browser(path))).status, 404, path);
    }
    assert.throws(() => natzar({identify, basePath: 'natzar'}), /basePath/);
    // Express: the router strips the mount into req.url and sets req.baseUrl.
    const mock = mockNatzar();
    const nz = natzar({identify: () => ({patient: {externalId: 'u-1'}}), apiKey: API_KEY, apiUrl: API_URL, fetch: mock.fetchLike, log: () => {}});
    const results: number[] = [];
    for (const [baseUrl, url] of [['/natzar', '/session'], ['/natzar', '/x/session'], ['', '/natzar/session']]) {
      const req = Object.assign(new EventTarget(), {
        method: 'POST', url, baseUrl, originalUrl: `${baseUrl}${url}`,
        headers: {'content-type': 'application/json', 'x-natzar-request': '1', origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-length': String(JSON.stringify(ASK).length)},
        on(event: string, fn: (c?: unknown) => void) {
          if (event === 'data') queueMicrotask(() => fn(new TextEncoder().encode(JSON.stringify(ASK))));
          if (event === 'end') queueMicrotask(() => queueMicrotask(() => fn()));
        },
      });
      const status = await new Promise<number>((resolve) => {
        const res = {statusCode: 0, setHeader() {}, end() {
          resolve(res.statusCode);
        }};
        nz(req as never, res as never);
      });
      results.push(status);
    }
    assert.deepEqual(results, [200, 404, 404]);
  });

  it('N7: body-parser\'s untouched {} placeholder is not a consumed body', async () => {
    const mock = mockNatzar();
    const nz = natzar({identify: (req: {headers: Record<string, string>}) => ({patient: {externalId: req.headers['x-user']}}), apiKey: API_KEY, apiUrl: API_URL, fetch: mock.fetchLike, log: () => {}});
    const skippingParser: Mw = (req, _res, next) => {
      req.body = {}; // body-parser 1.x for a request it does not parse
      next();
    };
    const srv = await serve([skippingParser, nz as unknown as Mw]);
    try {
      const res = await post(srv.port, '/natzar/session', JSON.stringify(ASK), {
        'content-type': 'application/json', 'x-natzar-request': '1', origin: `http://127.0.0.1:${srv.port}`, 'x-user': 'u-1',
      });
      assert.equal(res.status, 200, res.body);
    } finally {
      await srv.close();
    }
  });

  it('N9: refused requests are logged as codes', async () => {
    const {nz, logs} = setup();
    await nz.fetch(browser('/natzar/session', {headers: {'x-natzar-request': null}}));
    await nz.fetch(browser('/natzar/session', {headers: {origin: 'https://evil.test', 'sec-fetch-site': 'cross-site'}}));
    await nz.fetch(browser('/natzar/session', {body: {...ASK, extra: 1}}));
    assert.deepEqual(logs.map((l) => l.code), ['request_refused:csrf_header', 'request_refused:origin', 'request_refused:schema']);
  });

  it('N10: the helpers take a Workers-style env for the key', async () => {
    const mock = mockNatzar();
    const nz = natzar<Request>({identify, fetch: mock.fetchLike, log: () => {}});
    assert.deepEqual(await nz.revokeLogin('sess', {NATZAR_API_KEY: API_KEY, NATZAR_API_URL: API_URL}), {revoked: 2});
  });
});
