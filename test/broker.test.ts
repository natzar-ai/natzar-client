// The session broker behind connectPatient / connectPhysician (plan §4.2, the
// contract's failure tables): single-flight, renewal timing and triggers,
// backoff, 401/403/429/5xx, the X-Natzar-Endpoint check, the client grant
// check and the sealed round trip. The page's `natzar()` endpoint is faked at
// fetch; grants are sealed for real (./support/mock-natzar.ts). Timers and the
// clock are node:test mocks. Negative cases first.
import {after, afterEach, before, beforeEach, describe, it, mock} from 'node:test';
import assert from 'node:assert/strict';
import {connectPatient, type SessionAsk} from '../dist/esm/patient/index.js';
import {connectPhysician} from '../dist/esm/physician/index.js';
import {sealToFrameKey, generateFrameKeyPair} from '../dist/esm/contract/sessions-crypto.js';
import {API_URL, DEPLOYMENT, EMBED_CONFIG, grantFor, sid} from './support/mock-natzar.ts';

const PAGE = 'https://portal.acme.test';
const g = globalThis as {location?: {origin: string}; document?: unknown};

type Answer = Response | 'grant' | ((ask: SessionAsk) => Response | 'grant' | Promise<Response | 'grant'>);

const endpointJson = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', 'x-natzar-endpoint': '1', 'cache-control': 'no-store', ...headers}});

/**
 * A fake page: its `natzar()` endpoint (`/natzar/config`, `/natzar/session`
 * answering `script` in order, then real sealed grants) and the patient
 * surface (GraphQL at the CONFIGURED url, answering `ops`).
 */
function page(script: Answer[] = [], ops: Record<string, (auth: string) => unknown> = {}, config: Record<string, unknown> = {...EMBED_CONFIG, apiUrl: API_URL}) {
  const asks: SessionAsk[] = [];
  const requests: Array<{url: string; init: RequestInit}> = [];
  const gql: Array<{url: string; op: string; auth: string}> = [];
  let minted = 0;
  const fetchLike = async (url: string, init: RequestInit = {}): Promise<Response> => {
    requests.push({url, init});
    if (url === '/natzar/config') return endpointJson(200, config);
    if (url === '/natzar/session') {
      const ask = JSON.parse(String(init.body)) as SessionAsk;
      asks.push(ask);
      const next = script.shift();
      const answer = typeof next === 'function' ? await next(ask) : next ?? 'grant';
      if (answer !== 'grant') return answer;
      minted += 1;
      return endpointJson(200, await grantFor({...ask, parentOrigin: ask.surface === 'native' ? null : PAGE} as never, minted));
    }
    const op = /\{\s*(\w+)/.exec(JSON.parse(String(init.body)).query)?.[1] ?? '';
    const auth = (init.headers as Record<string, string>).authorization;
    gql.push({url, op, auth});
    const payload = ops[op]?.(auth) ?? {};
    return new Response(JSON.stringify({data: {[op]: JSON.stringify(payload)}}), {status: 200});
  };
  return {asks, requests, gql, fetchLike};
}

before(() => {
  g.location = {origin: PAGE};
});
after(() => {
  delete g.location;
});

// ---------------------------------------------------------------- refusals

describe('broker — what it refuses to connect with', () => {
  it('a headless session with no page to bind to (use native outside a browser)', async () => {
    const saved = g.location;
    delete g.location;
    try {
      await assert.rejects(() => connectPatient({endpoint: '/natzar'}, {fetch: page().fetchLike}), (e: {code?: string}) => e.code === 'origin_rejected');
    } finally {
      g.location = saved;
    }
  });

  it('native on a web page (RG5 S4): refused — a page gets the sealed headless surface, never the plain token', async () => {
    // g.location is an https page here.
    await assert.rejects(
      () => connectPatient({endpoint: '/natzar', auth: () => 't', native: true}, {fetch: page().fetchLike}),
      (e: {code?: string; message?: string}) => e.code === 'attribute_invalid' && /headless/.test(e.message ?? ''),
    );
    // A Capacitor/Ionic shell's origin is a native app, not a web page.
    const saved = g.location;
    g.location = {origin: 'capacitor://localhost'};
    try {
      const p = page();
      const care = await connectPatient({endpoint: 'https://api.acme.test/natzar', auth: () => 't', native: true}, {fetch: async (u, i) => p.fetchLike(u.replace('https://api.acme.test', ''), i)});
      assert.equal(p.asks[0].surface, 'native');
      assert.equal(p.requests.find((r) => r.url === '/natzar/session')!.init.credentials, 'omit', 'no cookie rides along a native ask (S3)');
      care.disconnect();
    } finally {
      g.location = saved;
    }
  });

  it('native without an auth hook, and an endpoint that is not a same-origin path or https URL', async () => {
    await assert.rejects(() => connectPatient({endpoint: '/natzar', native: true}), /auth hook/);
    for (const endpoint of ['natzar', '//evil.test/natzar', 'http://evil.test/natzar', '/natzar/', 'javascript:alert(1)', '/natzar?x=1']) {
      await assert.rejects(() => connectPatient({endpoint}), (e: {code?: string}) => e.code === 'endpoint_invalid', endpoint);
    }
  });

  const misplaced: Array<[string, Response]> = [
    ['a login redirect (302)', new Response(null, {status: 302, headers: {location: '/login'}})],
    ['an HTML page (a CSRF guard, a SPA fallback)', new Response('<html>', {status: 200, headers: {'content-type': 'text/html'}})],
    ['JSON without X-Natzar-Endpoint (a same-origin static file, T5)', new Response('{"protocolVersion":2}', {status: 200, headers: {'content-type': 'application/json'}})],
    ['a 403 without X-Natzar-Endpoint (csurf)', new Response('Forbidden', {status: 403})],
    ['a 404 from the middleware (wrong route)', endpointJson(404, {})],
  ];
  for (const [name, response] of misplaced) {
    it(`reports endpoint_misconfigured for ${name}, naming the placement rule`, async () => {
      const errors: string[] = [];
      const original = console.error;
      console.error = (m: unknown) => void errors.push(String(m));
      try {
        await assert.rejects(() => connectPatient({endpoint: '/natzar'}, {fetch: page([response]).fetchLike}), (e: {code?: string}) => e.code === 'endpoint_misconfigured');
      } finally {
        console.error = original;
      }
      assert.match(errors.join(), /before express\.json\(\), csurf\/lusca and login redirects/);
    });
  }

  it('reports endpoint_misconfigured when /config is not the middleware', async () => {
    const fetchLike = async (url: string) => (url === '/natzar/config' ? new Response('<html>', {status: 200, headers: {'content-type': 'text/html'}}) : endpointJson(500, {}));
    const original = console.error;
    console.error = () => {};
    try {
      await assert.rejects(() => connectPatient({endpoint: '/natzar'}, {fetch: fetchLike}), (e: {code?: string}) => e.code === 'endpoint_misconfigured');
    } finally {
      console.error = original;
    }
  });

  it('rejects the first connect with signed_out (401) and the endpoint code (403), without onExpired', async () => {
    let expired = 0;
    await assert.rejects(
      () => connectPatient({endpoint: '/natzar'}, {fetch: page([endpointJson(401, {error: 'signed_out'})]).fetchLike, onExpired: () => expired++}),
      (e: {code?: string}) => e.code === 'signed_out',
    );
    await assert.rejects(
      () => connectPatient({endpoint: '/natzar'}, {fetch: page([endpointJson(403, {error: 'surface_not_allowed'})]).fetchLike}),
      (e: {code?: string}) => e.code === 'surface_not_allowed',
    );
    // A code outside the allowlist is never trusted: it reads as forbidden.
    await assert.rejects(
      () => connectPatient({endpoint: '/natzar'}, {fetch: page([endpointJson(403, {error: 'root_granted'})]).fetchLike}),
      (e: {code?: string}) => e.code === 'forbidden',
    );
    assert.equal(expired, 0);
  });
});

// ------------------------------------------------------------ grant checks

describe('broker — the client grant check and the seal (T5, T16, RG0 F1/F7)', () => {
  const forged = (over: (g: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>): Answer => async (ask) =>
    endpointJson(200, await over(await grantFor({...ask, parentOrigin: PAGE} as never, 1)));

  const cases: Array<[string, Answer, string]> = [
    ['a grant of another deployment (partner)', forged((gr) => ({...gr, partnerId: 'partner_2'})), 'wrong_deployment'],
    ['a grant of another zone', forged((gr) => ({...gr, zone: 'ca'})), 'wrong_deployment'],
    ['a grant for another audience', forged((gr) => ({...gr, audience: 'clinician'})), 'session_mismatch'],
    ['a grant for a frame surface', forged((gr) => ({...gr, surface: 'async'})), 'session_mismatch'],
    ['a grant bound to another page origin', forged((gr) => ({...gr, parentOrigin: 'https://evil.test'})), 'origin_rejected'],
    ['a headless grant carrying the cleartext credential', forged((gr) => ({...gr, sessionToken: `nz1.${sid(1)}.${'k'.repeat(42)}A`})), 'session_grant_invalid'],
    ['a grant naming a frame', forged((gr) => ({...gr, frameUrl: 'https://us.embed.natzar.test/patient/frame/partner_1'})), 'frame_url_rejected'],
    ['a protocol-1 grant', forged((gr) => ({...gr, protocolVersion: 1})), 'protocol_mismatch'],
    ['a shapeless grant', forged(() => ({hello: 'world'})), 'session_grant_invalid'],
    // Fixation: a genuine grant sealed to ANOTHER page's key (another tab, an attacker's frame).
    ['a grant sealed to another key', forged(async (gr) => {
      const other = await generateFrameKeyPair();
      const token = `nz1.${gr.sessionId}.${'z'.repeat(42)}A`;
      return {...gr, sealedToken: await sealToFrameKey(token, other.publicJwk, {...DEPLOYMENT, audience: 'patient', surface: 'headless', sessionId: gr.sessionId as string, parentOrigin: PAGE, frameUrl: null})};
    }), 'unseal_failed'],
    // RG0 F1: sealed for another origin, then the relaying page rewrote the metadata to pass the check.
    ['a grant sealed for another origin with its parentOrigin rewritten', async (ask) => {
      const gr = await grantFor({...ask, parentOrigin: 'https://evil.test'} as never, 1);
      return endpointJson(200, {...gr, parentOrigin: PAGE});
    }, 'unseal_failed'],
  ];
  for (const [name, answer, code] of cases) {
    it(`refuses ${name} (${code})`, async () => {
      await assert.rejects(() => connectPatient({endpoint: '/natzar'}, {fetch: page([answer]).fetchLike}), (e: {code?: string}) => e.code === code);
    });
  }

  it('unseals a genuine grant with its own non-extractable key and sends the credential ONLY to its configured endpoint', async () => {
    const p = page([async (ask) => endpointJson(200, await grantFor({...ask, parentOrigin: PAGE} as never, 1, {apiUrl: 'https://evil.test/v1', graphqlUrl: 'https://evil.test/graphql'}))], {
      embedState: () => ({}),
      embedAgentMessages: () => ({messages: []}),
    });
    const care = await connectPatient({endpoint: '/natzar'}, {fetch: p.fetchLike});
    await care.conversation.get();
    assert.ok(p.gql.length > 0);
    for (const call of p.gql) {
      assert.equal(call.url, EMBED_CONFIG.graphqlUrl, 'never the grant\'s URL');
      assert.match(call.auth, /^nz1\./);
    }
    const ask = p.asks[0];
    assert.deepEqual(Object.keys(ask.frameKey!).sort(), ['crv', 'kty', 'x', 'y'], 'only the public JWK leaves the page');
    care.disconnect();
  });

  it('asks exactly as the element does: POST, JSON, X-Natzar-Request, same-origin credentials, no redirects, no-store, the auth hook re-read each time', async () => {
    let n = 0;
    const p = page();
    const care = await connectPatient({endpoint: '/natzar', auth: () => `id-token-${++n}`}, {fetch: p.fetchLike});
    await care.reconnect();
    const sessionRequests = p.requests.filter((r) => r.url === '/natzar/session');
    for (const [i, r] of sessionRequests.entries()) {
      const headers = r.init.headers as Record<string, string>;
      assert.equal(r.init.method, 'POST');
      assert.equal(headers['X-Natzar-Request'], '1');
      assert.equal(headers['Content-Type'], 'application/json');
      assert.equal(headers.Authorization, `Bearer id-token-${i + 1}`);
      assert.equal(r.init.credentials, 'same-origin');
      assert.equal(r.init.redirect, 'manual');
      assert.equal(r.init.cache, 'no-store');
    }
    assert.deepEqual(p.asks.map((a) => [a.reason, a.surface, a.audience]), [['initial', 'headless', 'patient'], ['reconnect', 'headless', 'patient']]);
    assert.deepEqual(p.asks[0].frameKey, p.asks[1].frameKey, 'one key per client');
    care.disconnect();
  });

  it('native: no frame key, the plain token, surface native, bearer-only; a sealed grant is refused', async () => {
    const saved = g.location;
    delete g.location; // React Native: no page
    try {
      const p = page([], {embedState: () => ({}), embedAgentMessages: () => ({messages: []})});
      const care = await connectPatient({endpoint: 'https://api.acme.test/natzar', auth: () => 'rn-token', native: true}, {fetch: async (u, i) => p.fetchLike(u.replace('https://api.acme.test', ''), i)});
      assert.equal(p.asks[0].surface, 'native');
      assert.equal('frameKey' in p.asks[0], false);
      await care.conversation.get();
      assert.equal(p.gql[0].auth, `nz1.${sid(1)}.${'1'.padStart(42, 'k')}A`);
      care.disconnect();
      const sealed: Answer = async (ask) => endpointJson(200, {...(await grantFor({...ask, surface: 'native', parentOrigin: null} as never, 1)), sealedToken: {epk: {}, iv: 'x', ct: 'y'}});
      await assert.rejects(
        () => connectPatient({endpoint: 'https://api.acme.test/natzar', auth: () => 'rn', native: true}, {fetch: async (u, i) => page([sealed]).fetchLike(u.replace('https://api.acme.test', ''), i)}),
        (e: {code?: string}) => e.code === 'session_grant_invalid',
      );
    } finally {
      g.location = saved;
    }
  });

  it('connectPhysician uses the configured apiUrl and a headless clinician session', async () => {
    const p = page();
    const calls: string[] = [];
    const fetchLike = async (url: string, init: RequestInit = {}) => {
      if (url.startsWith('https://')) {
        calls.push(`${url} ${(init.headers as Record<string, string>).Authorization}`);
        return new Response(JSON.stringify({physician: {id: 'd_1'}}), {status: 200, headers: {'content-type': 'application/json'}});
      }
      return p.fetchLike(url, init);
    };
    const desk = await connectPhysician({endpoint: '/natzar'}, {fetch: fetchLike});
    assert.deepEqual([p.asks[0].audience, p.asks[0].surface], ['clinician', 'headless']);
    await desk.me();
    assert.match(calls[0], new RegExp(`^${API_URL}/physicians/me Bearer nz1\\.`));
    desk.disconnect();
  });
});

// ------------------------------------------------------ timing (fake clock)

describe('broker — renewal, single-flight and backoff (fake timers)', () => {
  beforeEach(() => mock.timers.enable({apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-01T09:00:00Z')}));
  afterEach(() => mock.timers.reset());

  // Let pending promise chains (and WebCrypto, which runs off-thread) settle
  // between fake-clock steps. setImmediate is not mocked.
  const settle = async () => {
    for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
  };
  const OPS = {embedState: () => ({}), embedAgentMessages: () => ({messages: []})};

  it('renews 60 s before the access credential expires, by itself, on the same session', async () => {
    const p = page([], OPS);
    const care = await connectPatient({endpoint: '/natzar'}, {fetch: p.fetchLike});
    mock.timers.tick(839_000);
    await settle();
    assert.equal(p.asks.length, 1, 'not yet');
    mock.timers.tick(1_000);
    await settle();
    assert.deepEqual(p.asks.map((a) => [a.reason, a.sessionId]), [['initial', null], ['renew', sid(1)]]);
    await care.conversation.get();
    assert.equal(p.gql.at(-1)!.auth, `nz1.${sid(1)}.${'2'.padStart(42, 'k')}A`, 'the renewed secret is in force');
    care.disconnect();
  });

  it('is single-flight: ten operations that all see session_expired cause ONE renewal', async () => {
    const first = `nz1.${sid(1)}.${'1'.padStart(42, 'k')}A`;
    const p = page([], {
      embedState: (auth) => (auth === first ? {ok: false, error: 'session_expired'} : {}),
      embedAgentMessages: (auth) => (auth === first ? {ok: false, error: 'session_expired'} : {messages: []}),
    });
    const care = await connectPatient({endpoint: '/natzar'}, {fetch: p.fetchLike});
    await Promise.all(Array.from({length: 5}, () => care.conversation.get()));
    assert.deepEqual(p.asks.map((a) => a.reason), ['initial', 'renew']);
    care.disconnect();
  });

  it('renews after access expiry until the absolute limit (a throttled background tab), then asks for a new session', async () => {
    const p = page([], OPS);
    const care = await connectPatient({endpoint: '/natzar'}, {fetch: p.fetchLike});
    mock.timers.setTime(Date.now() + 3_600_000); // an hour frozen, no timer ran
    await care.conversation.get();
    assert.deepEqual(p.asks.map((a) => [a.reason, a.sessionId]), [['initial', null], ['renew', sid(1)]]);
    mock.timers.setTime(Date.now() + 9 * 3_600_000); // past the 8 h absolute limit
    await care.conversation.get();
    assert.deepEqual(p.asks.at(-1)!.reason, 'reconnect');
    assert.equal(p.asks.at(-1)!.sessionId, null);
    care.disconnect();
  });

  it('renews when the tab becomes visible again past renewAfter (and on focus/online)', async () => {
    const doc = Object.assign(new EventTarget(), {visibilityState: 'hidden'});
    g.document = doc;
    try {
      const p = page([], OPS);
      const care = await connectPatient({endpoint: '/natzar'}, {fetch: p.fetchLike});
      mock.timers.setTime(Date.now() + 850_000);
      doc.visibilityState = 'visible';
      doc.dispatchEvent(new Event('visibilitychange'));
      await settle();
      assert.deepEqual(p.asks.map((a) => a.reason), ['initial', 'renew']);
      care.disconnect();
    } finally {
      delete g.document;
    }
  });

  it('waits Retry-After on a 429 before asking again', async () => {
    const p = page(['grant', endpointJson(429, {error: 'rate_limited'}, {'retry-after': '7'})], OPS);
    const care = await connectPatient({endpoint: '/natzar'}, {fetch: p.fetchLike});
    mock.timers.tick(840_000);
    await settle();
    assert.equal(p.asks.length, 2, 'the renewal was answered 429');
    mock.timers.tick(6_900);
    await settle();
    assert.equal(p.asks.length, 2, 'not before Retry-After');
    mock.timers.tick(200);
    await settle();
    assert.equal(p.asks.length, 3);
    care.disconnect();
  });

  it('backs off (bounded) on 5xx and network errors; a first connect gives up after 4 attempts', async () => {
    const down = () => endpointJson(503, {error: 'unavailable'});
    const p = page([down, down, down, down]);
    const connecting = connectPatient({endpoint: '/natzar'}, {fetch: p.fetchLike});
    let settled: unknown = 'pending';
    connecting.then(() => (settled = 'resolved'), (e) => (settled = e));
    for (let i = 0; i < 4; i++) {
      await settle();
      mock.timers.tick(60_000);
    }
    await settle();
    assert.equal(p.asks.length, 4, 'bounded');
    assert.equal((settled as {code?: string}).code, 'unavailable');
  });

  it('S5: a renewal that keeps failing transiently keeps RENEWING the same session — never a new one', async () => {
    const down = () => endpointJson(503, {error: 'unavailable'});
    const p = page(['grant', down, down, down, down, down, down], OPS);
    const care = await connectPatient({endpoint: '/natzar'}, {fetch: p.fetchLike});
    mock.timers.tick(840_000);
    for (let i = 0; i < 12; i++) {
      await settle();
      mock.timers.tick(60_000);
    }
    await settle();
    assert.ok(p.asks.length >= 7, 'retried past the first round');
    assert.deepEqual([...new Set(p.asks.slice(1).map((a) => `${a.reason}:${a.sessionId}`))], [`renew:${sid(1)}`], 'every retry renews the SAME session');
    await care.conversation.get();
    assert.equal(p.gql.at(-1)!.auth.startsWith(`nz1.${sid(1)}.`), true, 'the renewed credential of the same session');
    care.disconnect();
  });

  it('a renewal answered 401 ends the session: onExpired(signed_out) once, no more asks', async () => {
    const infos: unknown[] = [];
    const p = page(['grant', endpointJson(401, {error: 'signed_out'})], OPS);
    const care = await connectPatient({endpoint: '/natzar'}, {fetch: p.fetchLike, onExpired: (i) => infos.push(i)});
    mock.timers.tick(840_000);
    await settle();
    assert.deepEqual(infos, [{reason: 'signed_out', code: 'signed_out'}]);
    mock.timers.tick(3_600_000);
    await settle();
    assert.equal(p.asks.length, 2);
    await assert.rejects(() => care.conversation.get(), (e: {code?: string}) => e.code === 'signed_out');
    care.disconnect();
  });

  it('a renewal refused (403: the session is dead) gets ONE new session; a second refusal ends it as revoked', async () => {
    const infos: Array<{reason: string; code: string}> = [];
    const refused = () => endpointJson(403, {error: 'forbidden'});
    const ok = page(['grant', refused, 'grant'], OPS);
    const care = await connectPatient({endpoint: '/natzar'}, {fetch: ok.fetchLike, onExpired: (i) => infos.push(i)});
    mock.timers.tick(840_000);
    await settle();
    assert.deepEqual(ok.asks.map((a) => a.reason), ['initial', 'renew', 'reconnect']);
    assert.equal(infos.length, 0);
    care.disconnect();

    const dead = page(['grant', refused, refused], OPS);
    const care2 = await connectPatient({endpoint: '/natzar'}, {fetch: dead.fetchLike, onExpired: (i) => infos.push(i)});
    mock.timers.tick(840_000);
    await settle();
    assert.deepEqual(dead.asks.map((a) => a.reason), ['initial', 'renew', 'reconnect']);
    assert.deepEqual(infos, [{reason: 'revoked', code: 'forbidden'}]);
    care2.disconnect();
  });
});

// --------------------------------------------- D12 Join anyway, self-revoke

describe('broker — Join anyway (D12) and the self-revoke of a switched session', () => {
  const firstToken = `nz1.${sid(1)}.${'1'.padStart(42, 'k')}A`;

  it('when YOUR login is the limit, no fresh session is tried: the join\'s 409 reaches you, and acceptShortSession joins anyway', async () => {
    const p = page([], {
      embedConsultJoin: () => ({ok: false, error: 'session_renewal_required', needSeconds: 2700, joinAnywayAllowed: true}),
    });
    const care = await connectPatient({endpoint: '/natzar'}, {fetch: p.fetchLike});
    let error: unknown;
    await care.telehealth.join('tele_1').catch((e) => (error = e));
    const {joinAnywayOf} = await import('../dist/esm/patient/index.js');
    assert.deepEqual(joinAnywayOf(error), {needSeconds: 2700, joinAnywayAllowed: true});
    assert.deepEqual(p.asks.map((a) => a.reason), ['initial'], 'a fresh session could not help: none was minted');
    assert.equal(joinAnywayOf(new Error('x')), null);
    care.disconnect();
  });

  it('a fresh switch answered signed_out (the contract\'s fresh row, RG4B N4): the join rejects with signed_out, never Join anyway; the current session keeps working', async () => {
    let joins = 0;
    let expired = 0;
    const p = page(['grant', endpointJson(401, {error: 'signed_out'})], {
      embedConsultJoin: () => (++joins === 1 ? {ok: false, error: 'session_renewal_required', needSeconds: 2700, joinAnywayAllowed: false} : {ok: true, status: 'waiting'}),
    });
    const care = await connectPatient({endpoint: '/natzar'}, {fetch: p.fetchLike, onExpired: () => expired++});
    let error: unknown;
    await care.telehealth.join('tele_1').catch((e) => (error = e));
    const {joinAnywayOf} = await import('../dist/esm/patient/index.js');
    assert.equal((error as {code?: string}).code, 'signed_out', 'the "sign in again on <site>" state');
    assert.equal(joinAnywayOf(error), null, 'a failed switch never offers Join anyway');
    assert.deepEqual(p.asks.map((a) => a.reason), ['initial', 'fresh']);
    // Not an end: the current session still works.
    assert.equal((await care.telehealth.join('tele_1')).status, 'waiting');
    assert.equal(p.gql.filter((c) => c.op === 'embedConsultJoin').at(-1)!.auth, firstToken);
    assert.equal(expired, 0);
    care.disconnect();
  });

  it('a fresh switch refused (403): the join\'s own refusal reaches the caller, without Join anyway; the broker continues', async () => {
    let expired = 0;
    const p = page(['grant', endpointJson(403, {error: 'forbidden'})], {
      embedConsultJoin: () => ({ok: false, error: 'session_renewal_required', needSeconds: 2700, joinAnywayAllowed: false}),
    });
    const care = await connectPatient({endpoint: '/natzar'}, {fetch: p.fetchLike, onExpired: () => expired++});
    let error: unknown;
    await care.telehealth.join('tele_1').catch((e) => (error = e));
    const {joinAnywayOf} = await import('../dist/esm/patient/index.js');
    assert.deepEqual(joinAnywayOf(error), {needSeconds: 2700, joinAnywayAllowed: false});
    assert.deepEqual(p.asks.map((a) => a.reason), ['initial', 'fresh']);
    assert.equal(expired, 0, 'a failed switch is not an end');
    care.disconnect();
  });

  it('the SDK never sets acceptShortSession itself; the caller\'s choice is sent as the Boolean argument', async () => {
    const vars: Array<Record<string, unknown>> = [];
    const p = page();
    const fetchLike = async (url: string, init: RequestInit = {}) => {
      if (url.startsWith('https://gql')) {
        const body = JSON.parse(String(init.body)) as {query: string; variables: Record<string, unknown>};
        vars.push({...body.variables, query: body.query});
        return new Response(JSON.stringify({data: {embedConsultJoin: JSON.stringify({ok: true, status: 'waiting'})}}), {status: 200});
      }
      return p.fetchLike(url, init);
    };
    const care = await connectPatient({endpoint: '/natzar'}, {fetch: fetchLike});
    await care.telehealth.join('tele_1');
    await care.telehealth.join('tele_1', {acceptShortSession: true});
    assert.equal('acceptShortSession' in vars[0], false);
    assert.equal(vars[1].acceptShortSession, true);
    assert.match(String(vars[1].query), /\$acceptShortSession: Boolean/);
    care.disconnect();
  });

  it('a fresh pre-join switch revokes the OLD session with its own credential (embedLogout)', async () => {
    const p = page([], {
      embedConsultJoin: (auth) => (auth === firstToken ? {ok: false, error: 'session_renewal_required', needSeconds: 2700, joinAnywayAllowed: false} : {ok: true, status: 'waiting'}),
      embedLogout: () => ({ok: true, revoked: true}),
    });
    const care = await connectPatient({endpoint: '/natzar'}, {fetch: p.fetchLike});
    assert.equal((await care.telehealth.join('tele_1')).status, 'waiting');
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(p.asks.map((a) => a.reason), ['initial', 'fresh']);
    const logout = p.gql.find((c) => c.op === 'embedLogout');
    assert.equal(logout?.auth, firstToken, 'the old session revoked itself');
    care.disconnect();
  });

  it('connectPhysician: logout() self-revokes (POST /provider-embed/session/logout) and stops; the fresh switch revokes the old one; room() takes acceptShortSession', async () => {
    const p = page();
    const rest: Array<{url: string; auth: string; body: unknown}> = [];
    const fetchLike = async (url: string, init: RequestInit = {}) => {
      if (url.startsWith('https://')) {
        const auth = (init.headers as Record<string, string>).Authorization;
        rest.push({url, auth, body: init.body ? JSON.parse(String(init.body)) : undefined});
        if (url.endsWith('/telehealth-consults/tele_1/room') && auth === `Bearer ${firstToken}`) {
          return new Response(JSON.stringify({error: {code: 'session_renewal_required', message: 'x', details: {needSeconds: 2700, joinAnywayAllowed: false}}}), {status: 409, headers: {'content-type': 'application/json'}});
        }
        return new Response(JSON.stringify({status: 'in_progress'}), {status: 200, headers: {'content-type': 'application/json'}});
      }
      return p.fetchLike(url, init);
    };
    const desk = await connectPhysician({endpoint: '/natzar'}, {fetch: fetchLike});
    await desk.telehealth.room('tele_1', {acceptShortSession: true});
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(p.asks.map((a) => a.reason), ['initial', 'fresh']);
    const rooms = rest.filter((r) => r.url.endsWith('/room'));
    assert.deepEqual(rooms.map((r) => r.body), [{acceptShortSession: true}, {acceptShortSession: true}]);
    const revokedOld = rest.find((r) => r.url === `${API_URL}/provider-embed/session/logout`);
    assert.equal(revokedOld?.auth, `Bearer ${firstToken}`, 'the switched-away session revoked itself');
    assert.deepEqual(await desk.logout(), {revoked: true});
    assert.equal(rest.at(-1)!.url, `${API_URL}/provider-embed/session/logout`);
    assert.notEqual(rest.at(-1)!.auth, `Bearer ${firstToken}`, 'logout revokes the CURRENT session');
    await assert.rejects(() => desk.me(), (e: {code?: string}) => e.code === 'not_connected');
  });
});
