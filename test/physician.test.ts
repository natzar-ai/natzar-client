import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {connectPhysician, NatzarSessionError} from '../dist/esm/physician/index.js';
import type {ConnectOptions, ConnectPhysicianSource, PhysicianWorkspace, SessionAsk} from '../dist/esm/physician/index.js';

// The physician surface — the half that runs in a clinician's browser on an
// nz1 session, with no API key. Everything here is stubbed at fetch, so
// these assert the SDK's OWN rules (headers, polling discipline, heartbeats,
// session end) rather than transport. Sessions come from a `getSession`
// stand-in answering native grants; the broker itself is test/broker.test.ts.

type Call = {method: string; path: string; url: string; headers: Record<string, string>; body: unknown; count: number};
// `object`, not `unknown`: a union with `unknown` collapses to `unknown` and
// the stub functions' `(c)` parameter loses its contextual type.
type RouteStub = object | ((call: Call) => unknown);

/**
 * Stubs the REST API. Routes are keyed `METHOD /path` (without `/v1`);
 * a stub is a fixed payload, a function of the call (which also sees how
 * many times that route was hit), or a `Response` for a non-2xx. Requests
 * outside the API (the presigned attachment PUT) land in `puts`.
 */
function stubApi(routes: Record<string, RouteStub>) {
  const calls: Call[] = [];
  const puts: Array<{url: string; init: RequestInit}> = [];
  const hits: Record<string, number> = {};
  const fetchLike = async (url: string, init: RequestInit) => {
    const parsed = new URL(url);
    const method = init.method ?? 'GET';
    if (!parsed.pathname.startsWith('/v1/')) {
      puts.push({url, init});
      return new Response('', {status: 200});
    }
    const path = parsed.pathname.slice('/v1'.length);
    const key = `${method} ${path}`;
    hits[key] = (hits[key] ?? 0) + 1;
    const call: Call = {
      method,
      path,
      url,
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      count: hits[key],
    };
    calls.push(call);
    const stub = routes[key];
    if (stub === undefined) {
      return new Response(JSON.stringify({error: {code: 'not_found', message: `no stub for ${key}`}}), {status: 404});
    }
    const payload = typeof stub === 'function' ? await (stub as (c: Call) => unknown)(call) : stub;
    if (payload instanceof Response) return payload;
    return new Response(JSON.stringify(payload), {status: 200, headers: {'Content-Type': 'application/json'}});
  };
  const hitsFor = (key: string) => calls.filter((c) => `${c.method} ${c.path}` === key).length;
  return {calls, puts, fetchLike, hitsFor};
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CONFIG = {partnerId: 'partner_1', environment: 'sbx-test', zone: 'us' as const, apiUrl: 'https://api.test/v1'};
const sid = (n: number) => `sess${String(n).padStart(17, '0')}A`;
const tokenOf = (sessionId: string, n: number) => `nz1.${sessionId}.${String(n).padStart(42, 'k')}A`;
const TOKEN = tokenOf(sid(1), 1);

function grantFor(ask: SessionAsk, n: number) {
  const now = Date.now();
  const sessionId = ask.reason === 'renew' && ask.sessionId ? ask.sessionId : sid(n);
  return {
    protocolVersion: 2, audience: 'clinician', surface: 'native', sessionId, partnerId: CONFIG.partnerId,
    sessionToken: tokenOf(sessionId, n),
    expiresAt: new Date(now + 300_000).toISOString(), renewAfter: new Date(now + 240_000).toISOString(),
    absoluteExpiresAt: new Date(now + 28_800_000).toISOString(), idleTimeoutSeconds: null,
    // The grant's own URLs are never used: the client sends only to its config's apiUrl.
    frameUrl: null, apiUrl: 'https://elsewhere.test/v1', graphqlUrl: 'https://elsewhere.test/graphql', parentOrigin: null,
    environment: CONFIG.environment, zone: CONFIG.zone, scope: {},
    capabilities: ['workspace.read', 'consult.read'], unavailable: [],
  };
}

function connect(options: ConnectOptions = {}, extra: Partial<ConnectPhysicianSource> = {}, asks: SessionAsk[] = []) {
  return connectPhysician({
    getSession: (ask: SessionAsk) => {
      asks.push(ask);
      return grantFor(ask, asks.length) as never;
    },
    config: CONFIG,
    native: true,
    ...extra,
  } as ConnectPhysicianSource, options);
}

const refused = (status: number, code?: string) =>
  new Response(code ? JSON.stringify({error: {code, message: code}}) : 'denied', {status});

const physician = (presence: Partial<PhysicianWorkspace['physician']['presence']> = {}) => ({
  id: 'd_1',
  externalId: 'ext_d_1',
  email: 'dr@clinic.test',
  displayName: 'Dr. Chen, MD',
  presence: {status: 'offline', ...presence},
  asyncAvailable: true,
  createdAt: '2026-01-01T00:00:00Z',
});

/** A workspace with a fresh clock every time — the shape the server sends. */
const workspace = (over: {
  presence?: Partial<PhysicianWorkspace['physician']['presence']>;
  queue?: Array<{consultId: string; position: number}>;
  active?: PhysicianWorkspace['telehealth']['active'];
  mine?: Array<{id: string; status: string}>;
} = {}): PhysicianWorkspace =>
  ({
    physician: physician(over.presence),
    telehealth: {
      waiting: over.queue?.length ?? 0,
      readyPhysicians: over.presence?.status === 'ready' ? 1 : 0,
      visible: over.presence?.status === 'ready',
      queue: (over.queue ?? []).map((q) => ({
        consultId: q.consultId,
        position: q.position,
        enqueuedAt: '2026-08-19T09:00:00Z',
        waitedSeconds: Math.floor(Math.random() * 1000),
        patient: {id: `p_${q.consultId}`, givenName: 'Ada'},
      })),
      active: over.active ?? null,
      upcoming: [],
    },
    async: {available: true, queued: [], mine: (over.mine ?? []).map((m) => ({...consult(m.id), status: m.status})), overdue: []},
    generatedAt: new Date().toISOString(),
  }) as PhysicianWorkspace;

const consult = (id: string, status = 'active') => ({
  id,
  patientId: `p_${id}`,
  kind: 'conversation' as const,
  status,
  createdAt: '2026-08-19T09:00:00Z',
  overdue: false,
  rateable: false,
  origin: 'platform',
});

const msg = (id: string, author: string, body: string) => ({id, author, body, sentAt: '2026-08-19T09:00:00Z'});

describe('connectPhysician — transport', () => {
  it('sends the session credential as the bearer, to the CONFIGURED apiUrl (never the grant\'s), as `me`', async () => {
    const {calls, fetchLike} = stubApi({'GET /physicians/me/workspace': workspace()});
    const desk = await connect({fetch: fetchLike});
    const ws = await desk.workspace.get();
    assert.equal(ws.physician.id, 'd_1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.test/v1/physicians/me/workspace');
    assert.equal(calls[0].headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(calls[0].headers['X-Natzar-Physician'], undefined, 'a session IS the physician credential');
    assert.equal(calls[0].headers['X-Natzar-Physician-Id'], undefined);
  });

  it('refuses a source it cannot use, before any request', async () => {
    await assert.rejects(() => connectPhysician({getSession: () => ({}) as never} as never), NatzarSessionError);
    await assert.rejects(() => connectPhysician({getSession: () => ({}) as never, config: {...CONFIG, apiUrl: undefined}, native: true} as never), (e: Error) => {
      assert.ok(e instanceof NatzarSessionError);
      assert.match(e.message, /apiUrl/);
      return true;
    });
    await assert.rejects(() => connectPhysician({getSession: () => ({}) as never, config: {...CONFIG, apiUrl: 'v1'}, native: true} as never), NatzarSessionError);
    await assert.rejects(() => connectPhysician({endpoint: 'https://api.acme.test/natzar', native: true}), /auth hook/);
    await assert.rejects(() => connectPhysician({endpoint: 'natzar'}), (e: {code?: string}) => e.code === 'endpoint_invalid');
  });

  it('exposes the bound REST client for routes it does not model, rebound on renewal', async () => {
    const {calls, fetchLike} = stubApi({
      'GET /async-consults': {items: [], hasMore: false},
      'GET /physicians/me/workspace': (c: Call) => (c.count === 1 ? refused(401, 'session_expired') : workspace()),
    });
    const asks: SessionAsk[] = [];
    const desk = await connect({fetch: fetchLike}, {}, asks);
    assert.equal(desk.client.credential, 'sessionToken');
    await desk.client.asyncConsults.list({assignee: 'me'});
    assert.equal(calls[0].url, 'https://api.test/v1/async-consults?assignee=me');
    assert.equal(calls[0].headers.Authorization, `Bearer ${TOKEN}`);
    await desk.workspace.get(); // session_expired → renewed → retried
    await desk.client.asyncConsults.list();
    assert.equal(calls.at(-1)!.headers.Authorization, `Bearer ${tokenOf(sid(1), 2)}`, 'the renewed credential is in force');
    assert.equal(desk.session?.sessionId, sid(1), 'same logical session');
  });
});

describe('connectPhysician — workspace polling', () => {
  // The server stamps every read with a fresh `generatedAt` and recomputes
  // `waitedSeconds`; neither means anything changed. The callback must fire
  // for a real change (a patient joining the queue) and for nothing else.
  it('calls back only when something that drives a render changed', async () => {
    let queue: Array<{consultId: string; position: number}> = [];
    const {fetchLike, hitsFor} = stubApi({'GET /physicians/me/workspace': () => workspace({queue})});
    const desk = await connect({fetch: fetchLike, intervalMs: 5});
    const seen: string[] = [];
    const stop = desk.workspace.subscribe((snap, sync) => seen.push(snap ? `${sync.phase}:${snap.telehealth.queue.length}` : sync.phase), {
      pauseWhenHidden: false,
    });
    await tick(60);
    assert.ok(hitsFor('GET /physicians/me/workspace') >= 4, 'polling on the interval');
    assert.deepEqual(seen, ['connecting', 'live:0'], 'a ticking clock is not a change');
    queue = [{consultId: 'tele_1', position: 1}];
    await tick(40);
    assert.deepEqual(seen, ['connecting', 'live:0', 'live:1'], 'a patient joining the queue is');
    stop();
    // `stopped` still carries the last good snapshot — a UI bound to the
    // subscription keeps showing real data rather than blanking on unmount.
    assert.equal(seen.at(-1), 'stopped:1');
    const after = hitsFor('GET /physicians/me/workspace');
    await tick(30);
    assert.equal(hitsFor('GET /physicians/me/workspace'), after, 'nothing polls after unsubscribe');
  });

  it('refreshes at once after an action instead of waiting out the interval', async () => {
    const {fetchLike, hitsFor} = stubApi({
      'GET /physicians/me/workspace': workspace(),
      'POST /async-consults/t_1/claim': {consult: consult('t_1')},
    });
    const desk = await connect({fetch: fetchLike, intervalMs: 10_000});
    const stop = desk.workspace.subscribe(() => {}, {pauseWhenHidden: false});
    await tick(20);
    assert.equal(hitsFor('GET /physicians/me/workspace'), 1);
    await desk.inbox.claim('t_1');
    await tick(20);
    assert.equal(hitsFor('GET /physicians/me/workspace'), 2, 'the claim triggered a read of its own');
    stop();
  });
});

describe('connectPhysician — presence & heartbeat', () => {
  it('beats on the cadence while ready and subscribed, and stops on unsubscribe', async () => {
    const {calls, fetchLike, hitsFor} = stubApi({
      'GET /physicians/me/workspace': workspace({presence: {status: 'ready'}}),
      'POST /physicians/me/presence': (c) => ({
        presence: {status: (c.body as {ready: boolean}).ready ? 'ready' : 'busy'},
        activeConsult: null,
      }),
      'POST /physicians/me/heartbeat': {presence: {status: 'ready'}, activeConsult: null},
    });
    const desk = await connect({fetch: fetchLike, intervalMs: 10_000, heartbeatIntervalMs: 10});
    const stop = desk.workspace.subscribe(() => {}, {pauseWhenHidden: false});
    const res = await desk.presence.ready();
    assert.equal(res.presence.status, 'ready');
    assert.deepEqual(calls.find((c) => c.path === '/physicians/me/presence')?.body, {ready: true});
    await tick(65);
    const beats = hitsFor('POST /physicians/me/heartbeat');
    assert.ok(beats >= 3 && beats <= 8, `beats on the cadence (got ${beats})`);
    assert.equal(calls.at(-1)?.headers.Authorization, `Bearer ${TOKEN}`, 'beats carry the session');
    stop();
    const atStop = hitsFor('POST /physicians/me/heartbeat');
    await tick(40);
    assert.equal(hitsFor('POST /physicians/me/heartbeat'), atStop, 'no beats once nobody is watching');
  });

  it('does not beat without a subscription, and stops when the physician goes offline', async () => {
    // The platform stores "off the queue" as `busy` with no active consult —
    // the same status as "on a call". The stub mirrors that, and the
    // workspace reports whatever presence was last written, as the server's
    // would.
    let onQueue = false;
    const {fetchLike, hitsFor} = stubApi({
      'GET /physicians/me/workspace': () => workspace({presence: {status: onQueue ? 'ready' : 'busy'}}),
      'POST /physicians/me/presence': (c) => {
        onQueue = (c.body as {ready: boolean}).ready;
        return {presence: {status: onQueue ? 'ready' : 'busy'}, activeConsult: null};
      },
      'POST /physicians/me/heartbeat': () => ({presence: {status: onQueue ? 'ready' : 'busy'}, activeConsult: null}),
    });
    const desk = await connect({fetch: fetchLike, intervalMs: 10_000, heartbeatIntervalMs: 10});
    await desk.presence.ready();
    await tick(40);
    assert.equal(hitsFor('POST /physicians/me/heartbeat'), 0, 'a subscription is the "screen is open" signal');
    const stop = desk.workspace.subscribe(() => {}, {pauseWhenHidden: false});
    await tick(40);
    assert.ok(hitsFor('POST /physicians/me/heartbeat') >= 2, 'subscribing starts the beat for an engaged physician');
    await desk.presence.offline();
    const atOffline = hitsFor('POST /physicians/me/heartbeat');
    await tick(40);
    assert.equal(hitsFor('POST /physicians/me/heartbeat'), atOffline, 'offline stops the beat');
    stop();
  });

  // A workspace read that left BEFORE the ready() write can land after it and
  // report `offline`; it must not overrule the write and silence the beat.
  it('does not let a stale read overrule a newer presence write', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let reads = 0;
    const {fetchLike, hitsFor} = stubApi({
      'GET /physicians/me/workspace': async () => {
        reads += 1;
        if (reads === 1) await gate; // the first read hangs until after ready()
        return workspace({presence: {status: reads === 1 ? 'offline' : 'ready'}});
      },
      'POST /physicians/me/presence': {presence: {status: 'ready'}, activeConsult: null},
      'POST /physicians/me/heartbeat': {presence: {status: 'ready'}, activeConsult: null},
    });
    const desk = await connect({fetch: fetchLike, intervalMs: 10_000, heartbeatIntervalMs: 10});
    const stop = desk.workspace.subscribe(() => {}, {pauseWhenHidden: false});
    await tick(5);
    await desk.presence.ready();
    release();
    await tick(50);
    assert.ok(hitsFor('POST /physicians/me/heartbeat') >= 2, 'still beating after the stale read landed');
    stop();
  });

  it('re-reads the workspace the moment a beat reports a match', async () => {
    let ringing = false;
    const {fetchLike, hitsFor} = stubApi({
      'GET /physicians/me/workspace': () => workspace({presence: {status: 'ready'}}),
      'POST /physicians/me/presence': {presence: {status: 'ready'}, activeConsult: null},
      'POST /physicians/me/heartbeat': () => ({
        presence: {status: 'ready', ...(ringing ? {activeConsultId: 'tele_9'} : {})},
        activeConsult: ringing ? {...consult('tele_9', 'ringing'), practitioner: {id: 'd_1'}} : null,
      }),
    });
    const desk = await connect({fetch: fetchLike, intervalMs: 10_000, heartbeatIntervalMs: 10});
    const stop = desk.workspace.subscribe(() => {}, {pauseWhenHidden: false});
    await desk.presence.ready();
    await tick(30);
    const before = hitsFor('GET /physicians/me/workspace');
    ringing = true;
    await tick(30);
    assert.ok(hitsFor('GET /physicians/me/workspace') > before, 'a ring is worth an immediate read');
    stop();
  });
});

describe('connectPhysician — session end', () => {
  it('fires onExpired once, parks polling and beats, and resumes on reconnect() with the new session', async () => {
    let revokedNow = false;
    const expiredInfo: unknown[] = [];
    const asks: SessionAsk[] = [];
    const {calls, fetchLike, hitsFor} = stubApi({
      'GET /physicians/me/workspace': () => (revokedNow ? refused(401, 'session_revoked') : workspace({presence: {status: 'ready'}})),
      'POST /physicians/me/presence': {presence: {status: 'ready'}, activeConsult: null},
      'POST /physicians/me/heartbeat': () =>
        revokedNow ? refused(401, 'session_revoked') : {presence: {status: 'ready'}, activeConsult: null},
      'POST /async-consults/t_1/claim': () => (revokedNow ? refused(401, 'session_revoked') : {consult: consult('t_1')}),
    });
    const desk = await connect({fetch: fetchLike, intervalMs: 5, heartbeatIntervalMs: 10, onExpired: (info) => expiredInfo.push(info)}, {}, asks);
    const phases: string[] = [];
    const stop = desk.workspace.subscribe((_s, sync) => phases.push(sync.phase), {pauseWhenHidden: false});
    await desk.presence.ready();
    await tick(30);
    assert.ok(hitsFor('GET /physicians/me/workspace') >= 2, 'polling before the revocation');
    assert.ok(hitsFor('POST /physicians/me/heartbeat') >= 1, 'beating before the revocation');

    revokedNow = true;
    // An action hitting the dead session reports it too — and still only once.
    await assert.rejects(() => desk.inbox.claim('t_1'), (e: {code?: string; status?: number}) => e.code === 'session_revoked' && e.status === 401);
    await tick(30);
    assert.deepEqual(expiredInfo, [{reason: 'revoked', code: 'session_revoked'}]);
    const parkedReads = hitsFor('GET /physicians/me/workspace');
    const parkedBeats = hitsFor('POST /physicians/me/heartbeat');
    await tick(40);
    assert.equal(hitsFor('GET /physicians/me/workspace'), parkedReads, 'no polls while ended');
    assert.equal(hitsFor('POST /physicians/me/heartbeat'), parkedBeats, 'no beats while ended');
    assert.ok(!phases.includes('retrying'), 'an ended session is not a network problem');

    revokedNow = false;
    await desk.reconnect();
    await tick(40);
    assert.ok(hitsFor('GET /physicians/me/workspace') > parkedReads, 'polling resumed');
    assert.ok(hitsFor('POST /physicians/me/heartbeat') > parkedBeats, 'beats resumed from what the platform reports');
    assert.equal(asks.at(-1)!.reason, 'reconnect');
    assert.equal(calls.filter((c) => c.path === '/physicians/me/workspace').at(-1)!.headers.Authorization, `Bearer ${tokenOf(sid(2), 2)}`);
    stop();
    assert.equal(phases.at(-1), 'stopped');
  });

  it('renews on session_expired and retries once, without ending anything', async () => {
    const asks: SessionAsk[] = [];
    let onExpiredCalls = 0;
    const {calls, fetchLike} = stubApi({
      'GET /physicians/me/workspace': (c: Call) => (c.headers.Authorization === `Bearer ${TOKEN}` ? refused(401, 'session_expired') : workspace()),
    });
    const desk = await connect({fetch: fetchLike, onExpired: () => onExpiredCalls++}, {}, asks);
    const ws = await desk.workspace.get();
    assert.equal(ws.physician.id, 'd_1');
    assert.deepEqual(asks.map((a) => a.reason), ['initial', 'renew']);
    assert.equal(calls.at(-1)!.headers.Authorization, `Bearer ${tokenOf(sid(1), 2)}`);
    assert.equal(onExpiredCalls, 0);
  });

  it('a one-shot get() after the session ended rejects rather than hanging, reporting once', async () => {
    // A fresh Response per call: a body can only be read once.
    const {fetchLike} = stubApi({'GET /physicians/me/workspace': () => refused(401, 'session_locked')});
    const expiredInfo: unknown[] = [];
    const desk = await connect({fetch: fetchLike, onExpired: (info) => expiredInfo.push(info)});
    await assert.rejects(() => desk.workspace.get(), (e: {code?: string}) => e.code === 'session_locked');
    await assert.rejects(() => desk.workspace.get(), (e: {name?: string; code?: string}) => e.name === 'NatzarSessionError' && e.code === 'session_locked');
    assert.deepEqual(expiredInfo, [{reason: 'idle', code: 'session_locked'}], 'the idle lock sticks: no automatic new session');
  });

  // A route outside what a session may call comes back 403 — from the
  // application with an envelope, or from the gateway bare. Neither ends the session.
  it('treats a 403 as forbidden, not as an ended session', async () => {
    const {fetchLike} = stubApi({
      'GET /patients': refused(403, 'capability_not_granted'),
      'GET /events': refused(403),
      'GET /physicians/me/workspace': workspace(),
    });
    let onExpiredCalls = 0;
    const desk = await connect({fetch: fetchLike, onExpired: () => onExpiredCalls++});
    await assert.rejects(() => desk.client.patients.list(), (e: {code?: string; status?: number}) => e.code === 'capability_not_granted' && e.status === 403);
    await assert.rejects(() => desk.client.events.list(), (e: {code?: string; status?: number}) => e.code === 'forbidden' && e.status === 403);
    assert.equal(onExpiredCalls, 0);
    const ws = await desk.workspace.get();
    assert.equal(ws.physician.id, 'd_1', 'the session is still perfectly usable');
  });
});

describe('connectPhysician — inbox', () => {
  it('a thread subscription polls the consult and its transcript, and stops once closed', async () => {
    let status = 'active';
    const {fetchLike, hitsFor} = stubApi({
      'GET /async-consults/t_1': () => ({consult: consult('t_1', status)}),
      'GET /async-consults/t_1/messages': {items: [msg('m_1', 'patient', 'hello'), msg('m_2', 'physician', 'hi')], hasMore: false},
    });
    const desk = await connect({fetch: fetchLike, intervalMs: 5});
    const seen: string[] = [];
    const stop = desk.inbox.thread('t_1').subscribe((snap, sync) => seen.push(snap ? `${sync.phase}:${snap.consult.status}:${snap.messages.length}` : sync.phase), {
      pauseWhenHidden: false,
    });
    await tick(40);
    assert.deepEqual(seen, ['connecting', 'live:active:2']);
    assert.ok(hitsFor('GET /async-consults/t_1/messages') >= 3, 'the transcript is polled alongside the consult');
    status = 'closed';
    await tick(40);
    assert.deepEqual(seen, ['connecting', 'live:active:2', 'live:closed:2', 'stopped:closed:2'], 'a closed thread stops on its own');
    const reads = hitsFor('GET /async-consults/t_1');
    await tick(30);
    assert.equal(hitsFor('GET /async-consults/t_1'), reads, 'and costs nothing more');
    stop();
  });

  it('follows the transcript cursor across pages', async () => {
    const {calls, fetchLike} = stubApi({
      'GET /async-consults/t_1': {consult: consult('t_1')},
      'GET /async-consults/t_1/messages': (c) =>
        c.url.includes('cursor=')
          ? {items: [msg('m_3', 'patient', 'page two')], hasMore: false}
          : {items: [msg('m_1', 'patient', 'one'), msg('m_2', 'physician', 'two')], cursor: 'c_1', hasMore: true},
    });
    const desk = await connect({fetch: fetchLike});
    const thread = await desk.inbox.thread('t_1').get();
    assert.deepEqual(thread.messages.map((m) => m.id), ['m_1', 'm_2', 'm_3']);
    assert.equal(calls.filter((c) => c.path === '/async-consults/t_1/messages').length, 2);
    assert.ok(calls.at(-1)!.url.includes('cursor=c_1'));
  });

  it('a reply pins an idempotency key, sends the staged attachment, and refreshes the thread', async () => {
    const {calls, fetchLike, hitsFor} = stubApi({
      'GET /async-consults/t_1': {consult: consult('t_1')},
      'GET /async-consults/t_1/messages': {items: [], hasMore: false},
      'POST /async-consults/t_1/replies': {accepted: true, messageId: 'm_9'},
    });
    const desk = await connect({fetch: fetchLike, intervalMs: 10_000});
    const stop = desk.inbox.thread('t_1').subscribe(() => {}, {pauseWhenHidden: false});
    await tick(20);
    const before = hitsFor('GET /async-consults/t_1');
    const {messageId} = await desk.inbox.reply('t_1', {
      text: '  Rest and fluids.  ',
      attachment: {stagingKey: 'staging/g/p/x.pdf', fileName: 'plan.pdf', mimeType: 'application/pdf'},
    });
    assert.equal(messageId, 'm_9');
    const post = calls.find((c) => c.path === '/async-consults/t_1/replies')!;
    const body = post.body as {idempotencyKey?: string; text?: string; attachment?: unknown; physicianId?: unknown};
    assert.equal(typeof body.idempotencyKey, 'string');
    assert.ok(body.idempotencyKey!.length > 8);
    assert.equal(body.text, 'Rest and fluids.');
    assert.deepEqual(body.attachment, {stagingKey: 'staging/g/p/x.pdf', fileName: 'plan.pdf', mimeType: 'application/pdf'});
    assert.equal(body.physicianId, undefined, 'the session names the physician; no body cross-check to get wrong');
    await tick(20);
    assert.equal(hitsFor('GET /async-consults/t_1'), before + 1, 'the thread re-read at once');
    await assert.rejects(() => desk.inbox.reply('t_1', {text: '   '}), /needs text/);
    stop();
  });

  it('lifecycle actions send the bodies the contract expects', async () => {
    const {calls, fetchLike} = stubApi({
      'POST /async-consults/t_1/resolve': {consult: consult('t_1', 'resolve_requested')},
      'POST /async-consults/t_1/close': {consult: consult('t_1', 'closed')},
      'POST /async-consults/t_1/takeover': {consult: consult('t_1')},
      'POST /async-consults/t_1/escalate': {consult: consult('t_1', 'closed'), telehealthConsultId: 'tele_1'},
      'POST /telehealth-consults/tele_1/cancel': {consult: consult('tele_1', 'cancelled')},
    });
    const desk = await connect({fetch: fetchLike});
    assert.equal((await desk.inbox.resolve('t_1', {note: ' Take care. '})).status, 'resolve_requested');
    assert.equal((await desk.inbox.close('t_1', {reason: 'patient_closed'})).status, 'closed');
    assert.equal((await desk.inbox.takeover('t_1')).id, 't_1');
    assert.equal((await desk.inbox.escalate('t_1')).telehealthConsultId, 'tele_1');
    assert.equal((await desk.telehealth.cancel('tele_1', {reason: 'Running late'})).status, 'cancelled');
    const bodies = Object.fromEntries(calls.map((c) => [c.path, c.body]));
    assert.deepEqual(bodies['/async-consults/t_1/resolve'], {note: 'Take care.'});
    assert.deepEqual(bodies['/async-consults/t_1/close'], {reason: 'patient_closed'});
    assert.deepEqual(bodies['/async-consults/t_1/takeover'], {});
    assert.deepEqual(bodies['/async-consults/t_1/escalate'], {});
    assert.deepEqual(bodies['/telehealth-consults/tele_1/cancel'], {reason: 'Running late'});
  });

  it('issues a signed referral through the physician session surface', async () => {
    const referral = {id: 'ref_1', kind: 'specialist', title: 'Specialist referral — Cardiology', issuedAt: '2026-09-22T09:00:00.000Z'};
    const {calls, fetchLike} = stubApi({
      'POST /async-consults/t_1/referrals': {referral},
    });
    const desk = await connect({fetch: fetchLike});
    const result = await desk.inbox.issueReferral('t_1', {
      draft: {kind: 'specialist', specialty: 'Cardiology', priority: 'routine', reason: 'Exertional symptoms'},
      lang: 'en',
    });
    assert.deepEqual(result, referral);
    assert.deepEqual(calls[0].body, {
      draft: {kind: 'specialist', specialty: 'Cardiology', priority: 'routine', reason: 'Exertional symptoms'},
      lang: 'en',
    });
    assert.equal(calls[0].headers.Authorization, `Bearer ${TOKEN}`);
  });

  it('issues several referrals in one call and a prescription through the physician session', async () => {
    const referral = {id: 'ref_1', kind: 'laboratory', title: 'Lab', issuedAt: '2026-09-22T09:00:00.000Z'};
    const {calls, fetchLike} = stubApi({
      'POST /async-consults/t_1/referrals': {referral, referrals: [referral, {...referral, id: 'ref_2', kind: 'imaging'}]},
      'POST /async-consults/t_1/prescriptions': {prescription: {id: 'rx_1', issuedAt: referral.issuedAt, link: 'https://example.test/pharmacy?id=rx_1'}},
    });
    const desk = await connect({fetch: fetchLike});
    const drafts = [
      {kind: 'laboratory' as const, tests: ['cbc' as const], priority: 'routine' as const},
      {kind: 'imaging' as const, modality: 'mri' as const, examination: 'Spine', clinicalIndication: 'Pain', priority: 'routine' as const},
    ];
    assert.equal((await desk.inbox.issueReferrals('t_1', {drafts})).referrals?.length, 2);
    assert.deepEqual(calls[0].body, {drafts});
    const draft = {items: [{medication: 'Amoxicillin', dose: '500 mg', route: 'oral' as const, frequency: 'tid' as const, quantity: '21 capsules', refills: 0}]};
    assert.equal((await desk.inbox.issuePrescription('t_1', {draft})).id, 'rx_1');
    assert.deepEqual(calls[1].body, {draft});
  });
});

describe('connectPhysician — suggested referrals (0.13.0)', () => {
  const LAB = {kind: 'laboratory' as const, tests: ['lipid_panel' as const], priority: 'routine' as const};
  const GASTRO = {kind: 'specialist' as const, specialty: 'Gastroenterology', priority: 'routine' as const, reason: 'Screening colonoscopy'};
  const referral = {id: 'ref_1', kind: 'laboratory', title: 'Laboratory requisition', issuedAt: '2026-09-23T09:00:00.000Z'};
  const request = (over: Record<string, unknown> = {}) => ({
    consult: {id: 't_1', patientId: 'p_1', status: 'active', kind: 'referral_request', requestSubject: 'Requisitions', overdue: false, rateable: false, origin: 'partner', createdAt: '2026-09-23T08:00:00Z', suggestedReferrals: [LAB, GASTRO], ...over},
  });

  it('suggestedReferrals reads the consult fresh and answers [] when there are none', async () => {
    const {fetchLike} = stubApi({
      'GET /async-consults/t_1': request(),
      'GET /async-consults/t_2': {consult: {...request().consult, id: 't_2', suggestedReferrals: undefined}},
    });
    const desk = await connect({fetch: fetchLike});
    assert.deepEqual(await desk.inbox.suggestedReferrals('t_1'), [LAB, GASTRO]);
    assert.deepEqual(await desk.inbox.suggestedReferrals('t_2'), []);
  });

  it("generateReferrals signs the consult's suggestions as one bundle, with the language asked for", async () => {
    const {calls, fetchLike, hitsFor} = stubApi({
      'GET /async-consults/t_1': request(),
      'POST /async-consults/t_1/referrals': {referral, referrals: [referral, {...referral, id: 'ref_2', kind: 'specialist'}]},
    });
    const desk = await connect({fetch: fetchLike});
    const result = await desk.inbox.generateReferrals('t_1', {lang: 'fr'});
    assert.equal(result.referrals?.length, 2);
    assert.equal(hitsFor('POST /async-consults/t_1/claim'), 0); // already the assignee's
    assert.deepEqual(calls.find((c) => c.method === 'POST')?.body, {drafts: [LAB, GASTRO], lang: 'fr'});
  });

  it('edited drafts win over the suggestions', async () => {
    const {calls, fetchLike} = stubApi({
      'GET /async-consults/t_1': request(),
      'POST /async-consults/t_1/referrals': {referral},
    });
    const desk = await connect({fetch: fetchLike});
    const edited = [{...LAB, fasting: true}];
    await desk.inbox.generateReferrals('t_1', {drafts: edited});
    assert.deepEqual(calls.find((c) => c.method === 'POST')?.body, {drafts: edited});
  });

  it('claims a queued request first — the physician asked to answer it', async () => {
    const {calls, fetchLike} = stubApi({
      'GET /async-consults/t_1': request({status: 'queued'}),
      'POST /async-consults/t_1/claim': {consult: request({status: 'active', assignedPhysicianId: 'd_1'}).consult},
      'POST /async-consults/t_1/referrals': {referral},
    });
    const desk = await connect({fetch: fetchLike});
    await desk.inbox.generateReferrals('t_1');
    assert.deepEqual(
      calls.filter((c) => c.method === 'POST').map((c) => c.path),
      ['/async-consults/t_1/claim', '/async-consults/t_1/referrals'],
    );
  });

  it('signs the suggestions in the patient\'s language when no lang is given — fr_CH → fr, unknown → the platform default', async () => {
    const {calls, fetchLike} = stubApi({
      'GET /async-consults/t_1': request({patientLang: 'fr_CH'}),
      'GET /async-consults/t_2': {consult: {...request().consult, id: 't_2', patientLang: 'xx_YY'}},
      'POST /async-consults/t_1/referrals': {referral},
      'POST /async-consults/t_2/referrals': {referral},
    });
    const desk = await connect({fetch: fetchLike});
    await desk.inbox.generateReferrals('t_1');
    await desk.inbox.generateReferrals('t_2');
    const posts = calls.filter((c) => c.method === 'POST');
    assert.deepEqual(posts[0].body, {drafts: [LAB, GASTRO], lang: 'fr'});
    assert.deepEqual(posts[1].body, {drafts: [LAB, GASTRO]});
  });

  it("an explicit lang wins over the patient's, and edited drafts keep the platform's default", async () => {
    const {calls, fetchLike} = stubApi({
      'GET /async-consults/t_1': request({patientLang: 'fr_CH'}),
      'POST /async-consults/t_1/referrals': {referral},
    });
    const desk = await connect({fetch: fetchLike});
    await desk.inbox.generateReferrals('t_1', {lang: 'de'});
    await desk.inbox.generateReferrals('t_1', {drafts: [LAB]});
    const posts = calls.filter((c) => c.method === 'POST');
    assert.deepEqual(posts[0].body, {drafts: [LAB, GASTRO], lang: 'de'});
    assert.deepEqual(posts[1].body, {drafts: [LAB]});
  });

  it('refuses an explicit empty selection — never falls back to signing every suggestion', async () => {
    const {calls, fetchLike} = stubApi({
      'GET /async-consults/t_1': request({status: 'queued'}),
      'POST /async-consults/t_1/referrals': {referral},
    });
    const desk = await connect({fetch: fetchLike});
    await assert.rejects(desk.inbox.generateReferrals('t_1', {drafts: []}), (e: unknown) => {
      assert.equal((e as {code?: string}).code, 'no_suggested_referrals');
      return true;
    });
    // No claim, no signing — not even the read.
    assert.equal(calls.filter((c) => c.path.startsWith('/async-consults/t_1')).length, 0);
  });

  it('refuses with no_suggested_referrals — before any write — when there is nothing to sign', async () => {
    const {calls, fetchLike} = stubApi({
      'GET /async-consults/t_1': request({suggestedReferrals: undefined, status: 'queued'}),
    });
    const desk = await connect({fetch: fetchLike});
    await assert.rejects(desk.inbox.generateReferrals('t_1'), (e: unknown) => {
      assert.equal((e as {name?: string}).name, 'NatzarApiError');
      assert.equal((e as {code?: string}).code, 'no_suggested_referrals');
      return true;
    });
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
  });
});

describe('connectPhysician — calls', () => {
  it('room, end and ready go to their routes and hand the grant through', async () => {
    const {calls, fetchLike} = stubApi({
      'POST /telehealth-consults/tele_1/room': {
        status: 'in_progress',
        livekit: {token: 'lk', url: 'wss://lk.test', roomName: 'r1'},
        consult: consult('tele_1', 'in_progress'),
      },
      'POST /telehealth-consults/tele_1/end': {consult: consult('tele_1', 'completed'), next: null},
      'POST /telehealth-consults/tele_2/ready': {state: {phase: 'in_progress', startsAt: null}, livekit: {token: 'lk2', url: 'wss://lk.test', roomName: 'r2'}},
      'GET /physicians/me/agenda': {appointments: [consult('tele_2', 'scheduled')]},
    });
    const desk = await connect({fetch: fetchLike});
    const room = await desk.telehealth.room('tele_1');
    assert.equal(room.livekit?.token, 'lk');
    const ended = await desk.telehealth.end('tele_1', {goOffline: true});
    assert.equal(ended.consult.status, 'completed');
    const beat = await desk.telehealth.ready('tele_2', false);
    assert.equal(beat.livekit?.roomName, 'r2');
    const agenda = await desk.telehealth.agenda({from: '2026-08-19T00:00:00Z', to: '2026-08-26T00:00:00Z'});
    assert.equal(agenda[0].id, 'tele_2');
    const bodies = Object.fromEntries(calls.map((c) => [c.path, c.body]));
    assert.deepEqual(bodies['/telehealth-consults/tele_1/room'], {});
    assert.deepEqual(bodies['/telehealth-consults/tele_1/end'], {goOffline: true});
    assert.deepEqual(bodies['/telehealth-consults/tele_2/ready'], {present: false});
    assert.ok(calls.at(-1)!.url.endsWith('/physicians/me/agenda?from=2026-08-19T00%3A00%3A00Z&to=2026-08-26T00%3A00%3A00Z'));
  });
});

describe('connectPhysician — attachments & specialties', () => {
  it('stages the bytes for a named patient through a presigned PUT', async () => {
    const {calls, puts, fetchLike} = stubApi({
      'POST /attachments/upload-urls': {
        uploads: [{stagingKey: 'staging/g/p_1/abc.png', uploadUrl: 'https://s3.test/put-here', expiresAt: '2026-08-19T09:05:00Z'}],
      },
    });
    const desk = await connect({fetch: fetchLike});
    const file = new Blob([new Uint8Array([1, 2, 3])], {type: 'image/png'});
    const staged = await desk.attachments.upload({externalPatientId: 'u_42'}, file, {fileName: 'rash.png'});
    assert.deepEqual(staged, {stagingKey: 'staging/g/p_1/abc.png', fileName: 'rash.png', mimeType: 'image/png'});
    assert.deepEqual(calls[0].body, {externalPatientId: 'u_42', files: [{fileName: 'rash.png', mimeType: 'image/png', sizeBytes: 3}]});
    assert.equal(puts.length, 1);
    assert.equal(puts[0].url, 'https://s3.test/put-here');
    assert.equal((puts[0].init.headers as Record<string, string>)['content-type'], 'image/png');
  });

  it('lists the catalogue and replaces the physician\'s own specialties', async () => {
    const {calls, fetchLike} = stubApi({
      'GET /specialties': {specialties: [{slug: 'derm', name: 'Dermatology'}]},
      'PUT /physicians/me/specialties': {physician: {...physician(), specialties: ['derm']}},
    });
    const desk = await connect({fetch: fetchLike});
    assert.deepEqual((await desk.specialties.list()).map((s) => s.slug), ['derm']);
    const me = await desk.specialties.set({specialties: ['derm', 'typo'], acceptsAllSpecialties: false});
    assert.deepEqual(me.specialties, ['derm']);
    assert.equal(calls[1].method, 'PUT');
    assert.deepEqual(calls[1].body, {specialties: ['derm', 'typo'], acceptsAllSpecialties: false});
  });

  it("replaces the physician's own languages", async () => {
    const {calls, fetchLike} = stubApi({
      'PUT /physicians/me/languages': {physician: {...physician(), languages: ['fr', 'en']}},
    });
    const desk = await connect({fetch: fetchLike});
    const me = await desk.languages.set({languages: ['fr', 'en']});
    assert.deepEqual(me.languages, ['fr', 'en']);
    assert.equal(calls[0].method, 'PUT');
    assert.ok(calls[0].url.endsWith('/physicians/me/languages'));
    assert.deepEqual(calls[0].body, {languages: ['fr', 'en']});
  });
});
