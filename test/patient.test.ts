import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {checkoutOf, connectPatient} from '../dist/esm/patient/index.js';
import type {ConnectOptions, ConnectPatientSource, SessionAsk} from '../dist/esm/patient/index.js';

// The patient surface — the half that runs in a browser with no API key.
// Everything here is stubbed at fetch, so these assert SHAPING rules rather
// than transport.
//
// Sessions come from a `getSession` stand-in that answers NATIVE grants (the
// plain `nz1`, nothing to unseal): the rules below do not depend on how the
// credential arrived. Sealing, renewal timing, the endpoint and the failure
// table are test/broker.test.ts.

const CONFIG = {partnerId: 'partner_1', environment: 'sbx-test', zone: 'us' as const, graphqlUrl: 'https://gql.test/graphql'};
const sid = (n: number) => `sess${String(n).padStart(17, '0')}A`;
/** The credential the n-th ask got: a new session id, except that a renewal keeps its session's. */
const tokenOf = (sessionId: string, n: number) => `nz1.${sessionId}.${String(n).padStart(42, 'k')}A`;
/** The credential of the first session a test connects with. */
const TOKEN = tokenOf(sid(1), 1);

function grantFor(ask: SessionAsk, n: number) {
  const now = Date.now();
  const sessionId = ask.reason === 'renew' && ask.sessionId ? ask.sessionId : sid(n);
  return {
    protocolVersion: 2, audience: 'patient', surface: 'native', sessionId, partnerId: CONFIG.partnerId,
    sessionToken: tokenOf(sessionId, n),
    expiresAt: new Date(now + 900_000).toISOString(), renewAfter: new Date(now + 840_000).toISOString(),
    absoluteExpiresAt: new Date(now + 28_800_000).toISOString(), idleTimeoutSeconds: null,
    frameUrl: null, apiUrl: 'https://api.test/v1', graphqlUrl: CONFIG.graphqlUrl, parentOrigin: null,
    environment: CONFIG.environment, zone: CONFIG.zone,
    scope: {...(ask.consult ? {consult: ask.consult} : {}), ...(ask.patient !== undefined ? {patient: ask.patient} : {})},
    capabilities: [], unavailable: [],
  };
}

/** Connect on stand-in sessions (see {@link grantFor}). `asks` records them. */
function connect(options: ConnectOptions = {}, extra: Partial<ConnectPatientSource> = {}, asks: SessionAsk[] = []) {
  return connectPatient({
    getSession: (ask: SessionAsk) => {
      asks.push(ask);
      return grantFor(ask, asks.length) as never;
    },
    config: CONFIG,
    native: true,
    ...extra,
  } as ConnectPatientSource, options);
}

type Vars = Record<string, unknown>;
type Call = {name: string; variables: Vars; query: string; auth: string | undefined};
type OpStub = unknown | ((variables: Vars, call: number) => unknown);

/**
 * Stubs the AppSync endpoint, answering each op from `ops` — a fixed payload,
 * or a function of the variables (and how many times that op has been hit)
 * for the stateful flows. Non-GraphQL requests (the presigned attachment PUT)
 * are recorded under `puts` and answered 200.
 */
function stub(ops: Record<string, OpStub>) {
  const calls: Call[] = [];
  const puts: Array<{url: string; init: RequestInit}> = [];
  const hits: Record<string, number> = {};
  const fetchLike = async (url: string, init: RequestInit) => {
    if (init.method === 'PUT') {
      puts.push({url, init});
      return new Response('', {status: 200});
    }
    const body = JSON.parse(String(init.body)) as {query: string; variables: Vars};
    const name = /\{\s*(\w+)/.exec(body.query)?.[1] ?? '';
    const auth = (init.headers as Record<string, string>).authorization;
    calls.push({name, variables: body.variables, query: body.query, auth});
    hits[name] = (hits[name] ?? 0) + 1;
    const op = ops[name];
    const payload = typeof op === 'function' ? await (op as (v: Vars, n: number, c: Call) => unknown)(body.variables, hits[name], calls.at(-1)!) : (op ?? {});
    return new Response(JSON.stringify({data: {[name]: JSON.stringify(payload)}}), {status: 200});
  };
  return {calls, puts, fetchLike};
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

const msg = (author: string, body: string, sentAt: string, id: string) => ({id, author, body, sentAt});

describe('connectPatient — timeline shaping', () => {
  // The platform stamps a patient turn and the reply it triggers with the SAME
  // sentAt — they are one exchange. An id tiebreaker sorted them by nanoid,
  // putting the answer before the question roughly half the time and leaving
  // `awaitingReply` stuck on. Caught only against the live API.
  it('keeps server order when two entries share a timestamp', async () => {
    const T = '2026-08-19T09:32:04.410Z';
    const {fetchLike} = stub({
      embedState: {},
      // 'z_patient' sorts AFTER 'a_agent' by id — the exact trap.
      embedAgentMessages: {messages: [msg('patient', 'question?', T, 'z_patient'), msg('agent', 'answer.', T, 'a_agent')]},
    });
    const snap = await (await connect({fetch: fetchLike})).conversation.get();
    assert.deepEqual(snap.timeline.map((e) => e.author), ['patient', 'agent']);
    assert.equal(snap.awaitingReply, false, 'the reply came after the question');
  });

  it('sorts genuinely out-of-order entries by time', async () => {
    const {fetchLike} = stub({
      embedState: {},
      embedAgentMessages: {
        messages: [msg('agent', 'later', '2026-08-19T10:00:00Z', 'b'), msg('patient', 'earlier', '2026-08-19T09:00:00Z', 'a')],
      },
    });
    const snap = await (await connect({fetch: fetchLike})).conversation.get();
    assert.deepEqual(snap.timeline.map((e) => e.text), ['earlier', 'later']);
  });

  it('reports awaitingReply when the patient spoke last', async () => {
    const {fetchLike} = stub({
      embedState: {},
      embedAgentMessages: {messages: [msg('patient', 'hello?', '2026-08-19T09:00:00Z', 'a')]},
    });
    const snap = await (await connect({fetch: fetchLike})).conversation.get();
    assert.equal(snap.awaitingReply, true);
  });

  it('tags consult-sourced entries so a partner can split the views', async () => {
    const {fetchLike} = stub({
      embedState: {},
      embedAgentMessages: {
        messages: [
          msg('agent', 'from the assistant', '2026-08-19T09:00:00Z', 'a'),
          {...msg('physician', 'from your doctor', '2026-08-19T09:01:00Z', 'b'), asyncConsultId: 'c_1'},
        ],
      },
    });
    const snap = await (await connect({fetch: fetchLike})).conversation.get();
    assert.deepEqual(snap.timeline.map((e) => e.source), ['agent', 'consult']);
    assert.equal(snap.timeline[1].consultId, 'c_1');
  });
});

describe('connectPatient — consult phase', () => {
  const phaseFor = async (status: string, extra: Record<string, unknown> = {}) => {
    const {fetchLike} = stub({
      embedState: {consult: {id: 'c_1', type: 'async', status, ...extra}},
      embedAgentMessages: {messages: [msg('agent', 'hi', '2026-08-19T09:00:00Z', 'a')]},
    });
    const snap = await (await connect({fetch: fetchLike})).conversation.get();
    return snap.consult;
  };

  it('maps platform statuses onto a closed set a partner can switch on', async () => {
    assert.equal((await phaseFor('invited'))?.phase, 'awaiting_consent');
    assert.equal((await phaseFor('queued'))?.phase, 'queued');
    assert.equal((await phaseFor('active'))?.phase, 'active');
    assert.equal((await phaseFor('ringing'))?.phase, 'ringing');
    assert.equal((await phaseFor('in_progress'))?.phase, 'in_call');
    assert.equal((await phaseFor('closed'))?.phase, 'closed');
  });

  // Forward compatibility: a status shipped after the partner built must not
  // crash their switch.
  it('reports an unrecognised status as `unknown`, never undefined', async () => {
    assert.equal((await phaseFor('some_future_status'))?.phase, 'unknown');
  });

  it('surfaces the consent prompt on the last entry, so no link parsing is needed', async () => {
    const {fetchLike} = stub({
      embedState: {consult: {id: 'c_1', type: 'async', status: 'invited'}},
      embedAgentMessages: {messages: [msg('agent', 'Shall I get you a doctor?', '2026-08-19T09:00:00Z', 'a')]},
    });
    const snap = await (await connect({fetch: fetchLike})).conversation.get();
    assert.equal(snap.timeline.at(-1)?.awaiting, 'consent');
  });

  it('surfaces a rating prompt when the platform says the consult is rateable', async () => {
    const {fetchLike} = stub({
      embedState: {consult: {id: 'c_1', type: 'async', status: 'closed', rateable: true}},
      embedAgentMessages: {messages: [msg('system', 'Your consultation has ended.', '2026-08-19T09:00:00Z', 'a')]},
    });
    const snap = await (await connect({fetch: fetchLike})).conversation.get();
    assert.equal(snap.timeline.at(-1)?.awaiting, 'rating');
  });
});

describe('connectPatient — sending', () => {
  it('shows the patient their own message immediately, before the server echoes it', async () => {
    const {fetchLike} = stub({
      embedState: {},
      embedAgentMessages: {messages: []},
      embedAgentSend: {ok: true},
    });
    const care = await connect({fetch: fetchLike});
    await care.conversation.send({text: 'my message'});
    const snap = await care.conversation.get();
    assert.equal(snap.timeline.length, 1);
    assert.equal(snap.timeline[0].pending, true, 'optimistic entry is flagged');
    assert.equal(snap.awaitingReply, true);
  });

  it('drops the optimistic copy once the server returns the real one', async () => {
    let sent = false;
    const fetchLike = async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {query: string};
      const name = /\{\s*(\w+)/.exec(body.query)?.[1] ?? '';
      if (name === 'embedAgentSend') sent = true;
      const payload =
        name === 'embedAgentMessages'
          ? {messages: sent ? [msg('patient', 'my message', '2026-08-19T09:00:00Z', 'real_1')] : []}
          : {};
      return new Response(JSON.stringify({data: {[name]: JSON.stringify(payload)}}), {status: 200});
    };
    const care = await connect({fetch: fetchLike});
    await care.conversation.send({text: 'my message'});
    const snap = await care.conversation.get();
    assert.equal(snap.timeline.length, 1, 'exactly one copy, not the echo plus the optimistic one');
    assert.equal(snap.timeline[0].id, 'real_1');
    assert.notEqual(snap.timeline[0].pending, true);
  });

  it('refuses an empty send rather than posting nothing', async () => {
    const {fetchLike} = stub({embedState: {}, embedAgentMessages: {messages: []}});
    const care = await connect({fetch: fetchLike});
    await assert.rejects(() => care.conversation.send({text: '   '}), /needs text or an attachment/);
  });
});

describe('connectPatient — failure modes', () => {
  it('refuses a getSession source without its deployment config, before any request', async () => {
    // Thrown by connectPatient itself, before any component can use it.
    await assert.rejects(() => connectPatient({getSession: () => ({}) as never, native: true} as never), /needs `config`/);
  });

  it('sends the credential in Authorization to the configured endpoint, never an API key or a token argument', async () => {
    const {calls, fetchLike} = stub({embedState: {}, embedAgentMessages: {messages: []}});
    await (await connect({fetch: fetchLike})).conversation.get();
    for (const c of calls) {
      assert.equal(c.auth, TOKEN);
      assert.equal('token' in c.variables, false);
      assert.doesNotMatch(c.query, /\$token/);
    }
  });

  // The surface reports refusals in-band because it also drives a widget.
  // Partners get an exception, matching every other call in this package.
  it('turns an in-band {ok:false} refusal into a typed error', async () => {
    const {fetchLike} = stub({embedState: {ok: false, error: 'thread_not_active'}});
    await assert.rejects(
      async () => (await connect({fetch: fetchLike})).conversation.get(),
      (e: {name?: string; code?: string}) => e.name === 'NatzarApiError' && e.code === 'thread_not_active',
    );
  });
});

// --- Embed-widget parity ------------------------------------------------------
//
// Everything below is what the <natzar-agent> widget does that a partner
// building on the SDK used to have to redo by hand: link → button, attachments,
// the video surface, and session expiry.

describe('connectPatient — timeline enrichment', () => {
  it('passes emergency, signature, classification and clientRef through', async () => {
    const {fetchLike} = stub({
      embedState: {},
      embedAgentMessages: {
        messages: [
          {...msg('system', 'Call 911.', '2026-08-19T09:00:00Z', 'a'), emergency: true},
          {...msg('physician', 'Rest and fluids.', '2026-08-19T09:01:00Z', 'b'), signature: 'Dr. Chen MD', asyncConsultId: 'c_1', classification: 'async:reply'},
          {...msg('patient', 'thanks', '2026-08-19T09:02:00Z', 'c'), clientRef: 'sub_1'},
        ],
      },
    });
    const snap = await (await connect({fetch: fetchLike})).conversation.get();
    assert.equal(snap.timeline[0].emergency, true);
    assert.equal(snap.timeline[1].signature, 'Dr. Chen MD');
    assert.equal(snap.timeline[1].classification, 'async:reply');
    assert.equal(snap.timeline[2].clientRef, 'sub_1');
  });

  // The URL leads to our own DOB-gated page; inside a partner's UI the right
  // rendering is a button. The action comes from the server: `/async?id=` is
  // reused for the consent invite AND the rating invite.
  it('turns a consult link into an action and strips the URL from the text', async () => {
    const {fetchLike} = stub({
      embedState: {},
      embedAgentMessages: {
        messages: [
          msg('agent', 'A physician can see you now — tap the button below.\n\nhttps://app.natzar.ai/telehealth?id=tele_1', '2026-08-19T09:00:00Z', 'a'),
          msg('system', 'Rate your consultation: https://app.natzar.ai/async?id=async_1', '2026-08-19T09:01:00Z', 'b'),
          msg('agent', 'Book a time: https://app.natzar.ai/async?id=unknown_1', '2026-08-19T09:02:00Z', 'c'),
        ],
        linkStates: {tele_1: {kind: 'telehealth', action: 'join'}, async_1: {kind: 'async', action: 'rate'}},
      },
    });
    const snap = await (await connect({fetch: fetchLike})).conversation.get();
    const [join, rate, unresolved] = snap.timeline;
    assert.equal(join.text, 'A physician can see you now — tap the button below.');
    assert.deepEqual(join.link, {kind: 'telehealth', consultId: 'tele_1', action: 'join'});
    assert.equal(join.awaiting, 'join');
    assert.equal(join.consultId, 'tele_1', 'the consult id is on the entry for care.telehealth.join()');
    assert.equal(rate.awaiting, 'rating');
    assert.equal(rate.consultId, 'async_1');
    assert.equal(unresolved.link?.action, 'none', 'an unresolved ASYNC link says nothing rather than guessing');
    assert.equal(unresolved.awaiting, undefined);
  });

  it('defaults an unresolved booking link to `book` and an unresolved video link to `join` — the widget’s own rule', async () => {
    // The server resolves async and telehealth ids; a booking page is never a
    // dead end (it is the appointment's own page once booked), and a video
    // consult the server did not answer for is still worth the tap — the join
    // re-checks everything. Same defaults as frontend/partner-embed/links.ts.
    const {fetchLike} = stub({
      embedState: {},
      embedAgentMessages: {
        messages: [
          msg('system', 'Choose a time: https://app.natzar.ai/book?id=booked_1', '2026-08-19T09:00:00Z', 'a'),
          msg('system', 'Join when ready: https://app.natzar.ai/telehealth?id=tele_2', '2026-08-19T09:01:00Z', 'b'),
        ],
        linkStates: {},
      },
    });
    const snap = await (await connect({fetch: fetchLike})).conversation.get();
    const [book, join] = snap.timeline;
    assert.deepEqual(book.link, {kind: 'book', consultId: 'booked_1', action: 'book'});
    assert.equal(book.awaiting, 'book');
    assert.equal(book.text, 'Choose a time:');
    assert.deepEqual(join.link, {kind: 'telehealth', consultId: 'tele_2', action: 'join'});
    assert.equal(join.awaiting, 'join');
  });

  it('never treats a URL the patient typed as an action', async () => {
    const {fetchLike} = stub({
      embedState: {},
      embedAgentMessages: {messages: [msg('patient', 'see https://x.test/telehealth?id=abc', '2026-08-19T09:00:00Z', 'a')]},
    });
    const snap = await (await connect({fetch: fetchLike})).conversation.get();
    assert.equal(snap.timeline[0].link, undefined);
    assert.equal(snap.timeline[0].text, 'see https://x.test/telehealth?id=abc');
  });

  it('shapes a consult-scoped session state into the same consult snapshot', async () => {
    const {fetchLike} = stub({
      embedState: {typ: 'telehealth', consultId: 'tele_1', status: 'waiting', rated: false, rateable: false, mode: 'scheduled'},
      embedAgentMessages: {messages: []},
    });
    const snap = await (await connect({fetch: fetchLike})).conversation.get();
    assert.equal(snap.consult?.id, 'tele_1');
    assert.equal(snap.consult?.kind, 'telehealth');
    assert.equal(snap.consult?.phase, 'queued');
    assert.equal(snap.consult?.mode, 'scheduled');
    assert.equal(snap.consult?.joinable, true);
  });
});

describe('connectPatient — optimistic reconciliation', () => {
  // The platform mints a fresh transcript id for the echo and repeats our
  // submission id as `clientRef` — the only field the two share.
  it('reconciles on clientRef when the echo carries it, even if the text differs', async () => {
    let echoed = false;
    const {fetchLike} = stub({
      embedState: {},
      embedAgentSend: {ok: true, accepted: true, messageId: 'srv_1'},
      embedAgentMessages: () => ({
        messages: echoed ? [{...msg('patient', 'hello  there', '2026-08-19T09:00:00Z', 'real_1'), clientRef: 'srv_1'}] : [],
      }),
    });
    const care = await connect({fetch: fetchLike});
    await care.conversation.send({text: 'hello there'});
    let snap = await care.conversation.get();
    assert.equal(snap.timeline[0].clientRef, 'srv_1', 'the acknowledged submission id replaces the local one');
    echoed = true;
    snap = await care.conversation.get();
    assert.equal(snap.timeline.length, 1);
    assert.equal(snap.timeline[0].id, 'real_1');
  });

  // Two "yes" in a row: the first echo must retire ONE optimistic copy, not
  // both — and a "yes" already on the record must retire none.
  it('retires repeated identical texts one echo at a time, never against history', async () => {
    let served: Array<ReturnType<typeof msg>> = [msg('patient', 'yes', '2026-08-19T08:00:00Z', 'old_yes')];
    const {fetchLike} = stub({
      embedState: {},
      embedAgentSend: {ok: true},
      embedAgentMessages: () => ({messages: served}),
    });
    const care = await connect({fetch: fetchLike});
    await care.conversation.get(); // history seen
    await care.conversation.send({text: 'yes'});
    await care.conversation.send({text: 'yes'});
    let snap = await care.conversation.get();
    assert.equal(snap.timeline.length, 3, 'history + two pending; the old echo claims nothing');
    served = [...served, msg('patient', 'yes', '2026-08-19T09:00:00Z', 'new_yes_1')];
    snap = await care.conversation.get();
    assert.equal(snap.timeline.length, 3, 'one new echo retires exactly one pending');
    assert.equal(snap.timeline.filter((e) => e.pending).length, 1);
    served = [...served, msg('patient', 'yes', '2026-08-19T09:00:01Z', 'new_yes_2')];
    snap = await care.conversation.get();
    assert.equal(snap.timeline.filter((e) => e.pending).length, 0);
  });

  it('takes the optimistic entry back down when the platform refuses the send', async () => {
    const {fetchLike} = stub({
      embedState: {},
      embedAgentMessages: {messages: []},
      embedAgentSend: {ok: false, error: 'invalid_request'},
    });
    const care = await connect({fetch: fetchLike});
    await assert.rejects(() => care.conversation.send({text: 'nope'}), (e: {code?: string}) => e.code === 'invalid_request');
    const snap = await care.conversation.get();
    assert.equal(snap.timeline.length, 0, 'a refused message must not look sent');
  });
});

describe('connectPatient — attachments', () => {
  it('stages the bytes through a presigned PUT and sends the staging key stringified', async () => {
    const {calls, puts, fetchLike} = stub({
      embedState: {},
      embedAgentMessages: {messages: []},
      embedUploadUrls: {ok: true, files: [{url: 'https://s3.test/put-here', key: 'staging/g/p/abc.png'}], expiresIn: 60},
      embedAgentSend: {ok: true, messageId: 'srv_9'},
    });
    const care = await connect({fetch: fetchLike});
    const file = Object.assign(new Blob([new Uint8Array([1, 2, 3])], {type: 'image/png'}), {name: 'rash.png'});
    const staged = await care.attachments.upload(file);
    assert.deepEqual(staged, {stagingKey: 'staging/g/p/abc.png', fileName: 'rash.png', mimeType: 'image/png'});

    const slot = calls.find((c) => c.name === 'embedUploadUrls')!;
    assert.equal(slot.auth, TOKEN);
    assert.deepEqual(JSON.parse(String(slot.variables.files)), [{contentType: 'image/png', contentLength: 3}]);
    assert.match(slot.query, /\$files: AWSJSON!/);
    assert.equal(puts.length, 1);
    assert.equal(puts[0].url, 'https://s3.test/put-here');
    assert.equal((puts[0].init.headers as Record<string, string>)['content-type'], 'image/png');

    await care.conversation.send({attachment: {...staged, previewUrl: 'blob:local'}});
    const send = calls.find((c) => c.name === 'embedAgentSend')!;
    assert.equal(send.variables.text, undefined, 'a photo with no caption is a real message');
    assert.deepEqual(JSON.parse(String(send.variables.attachment)), {stagingKey: 'staging/g/p/abc.png', mimeType: 'image/png', fileName: 'rash.png'});
    assert.match(send.query, /\$attachment: AWSJSON/);
    const snap = await care.conversation.get();
    assert.deepEqual(snap.timeline[0].attachments, [{fileName: 'rash.png', mimeType: 'image/png', url: 'blob:local'}]);
  });

  it('surfaces the platform refusal for an unsupported type', async () => {
    const {fetchLike} = stub({embedUploadUrls: {ok: false, error: 'unsupported_type'}});
    const care = await connect({fetch: fetchLike});
    const file = Object.assign(new Blob(['x'], {type: 'application/x-msdownload'}), {name: 'setup.exe'});
    await assert.rejects(() => care.attachments.upload(file), (e: {code?: string}) => e.code === 'unsupported_type');
  });
});

describe('connectPatient — telehealth', () => {
  const teleOps = (overrides: Record<string, OpStub> = {}) =>
    stub({
      embedState: {},
      embedAgentMessages: {messages: []},
      embedConsultJoin: {ok: true, status: 'waiting', position: 2, estimatedMinutes: 6, rated: false},
      embedConsultLeave: {ok: true, left: true},
      embedRate: {ok: true},
      ...overrides,
    });

  it('runs every consult op on the ONE patient session, naming the consult', async () => {
    const {calls, fetchLike} = teleOps();
    const care = await connect({fetch: fetchLike});
    assert.equal('session' in care.telehealth, false, 'no consult-token minting any more');

    const waiting = await care.telehealth.join('tele_1');
    assert.deepEqual(waiting, {status: 'waiting', position: 2, estimatedMinutes: 6, rated: false});
    await care.telehealth.leave('tele_1');
    await care.telehealth.rate('tele_1', {communication: 5, overall: 4, feedback: 'great'});

    for (const name of ['embedConsultJoin', 'embedConsultLeave', 'embedRate']) {
      const call = calls.find((c) => c.name === name)!;
      assert.equal(call.auth, TOKEN, `${name} runs on the patient session`);
      assert.equal(call.variables.consultId, 'tele_1');
    }
    const rate = calls.find((c) => c.name === 'embedRate')!;
    assert.deepEqual(rate.variables, {consultId: 'tele_1', communicationRating: 5, overallPhysicianRating: 4, feedback: 'great'});
    assert.match(rate.query, /\$consultId: String!/);
  });

  // A grant the patient could not check before publishing is never offered:
  // no nonce, no grant (fail closed — the next beat brings a whole one).
  it('never hands over a room grant that carries no roomNonce', async () => {
    for (const roomNonce of [undefined, '', null]) {
      const {fetchLike} = teleOps({
        embedConsultJoin: {ok: true, status: 'in_progress', token: 'lk_tok', url: 'wss://lk.test', roomName: 'consult-e-tele_1-a', ...(roomNonce !== undefined ? {roomNonce} : {})},
        embedAppointmentBeat: {ok: true, state: {phase: 'in_progress', startsAt: null}, token: 'lk_tok', url: 'wss://lk.test', roomName: 'r', ...(roomNonce !== undefined ? {roomNonce} : {})},
      });
      const care = await connect({fetch: fetchLike});
      const state = await care.telehealth.join('tele_1');
      assert.equal(state.status, 'in_progress');
      assert.equal(state.livekit, undefined, `nonce ${String(roomNonce)}`);
      assert.equal((await care.telehealth.appointmentBeat('tele_1')).livekit, undefined);
    }
  });

  it('hands over the room grant, nonce included, when the call starts', async () => {
    const {fetchLike} = teleOps({
      embedConsultJoin: {ok: true, status: 'in_progress', token: 'lk_tok', url: 'wss://lk.test', roomName: 'consult-e-tele_1-a', roomNonce: 'n0nce', physicianName: 'Dr. Sarah Chen MD', physicianShortName: 'Dr. Chen'},
      embedAppointmentBeat: {ok: true, state: {phase: 'in_progress', startsAt: null}, token: 'lk_2', url: 'wss://lk.test', roomName: 'r2', roomNonce: 'n2'},
    });
    const care = await connect({fetch: fetchLike});
    const state = await care.telehealth.join('tele_1');
    assert.equal(state.status, 'in_progress');
    assert.deepEqual(state.livekit, {token: 'lk_tok', url: 'wss://lk.test', roomName: 'consult-e-tele_1-a', roomNonce: 'n0nce'});
    assert.equal(state.physicianShortName, 'Dr. Chen');
    assert.deepEqual((await care.telehealth.appointmentBeat('tele_1')).livekit, {token: 'lk_2', url: 'wss://lk.test', roomName: 'r2', roomNonce: 'n2'});
  });

  it('reports a status added after you shipped as `unknown`', async () => {
    const {fetchLike} = teleOps({embedConsultJoin: {ok: true, status: 'teleported'}});
    assert.equal((await (await connect({fetch: fetchLike})).telehealth.join('tele_1')).status, 'unknown');
  });

  // An expired ACCESS credential is the SDK's problem, not the partner's:
  // renew the same session and retry once — without firing onExpired.
  it('renews once when an operation answers session_expired, and retries on the new credential', async () => {
    let expiredCalls = 0;
    const asks: SessionAsk[] = [];
    const {calls, fetchLike} = teleOps({
      embedConsultJoin: (_v: Vars, _n: number, c: Call) =>
        c.auth === TOKEN ? {ok: false, error: 'session_expired'} : {ok: true, status: 'waiting', position: 1, estimatedMinutes: 3},
    });
    const care = await connect({fetch: fetchLike, onExpired: () => expiredCalls++}, {}, asks);
    const state = await care.telehealth.join('tele_1');
    assert.equal(state.position, 1);
    assert.deepEqual(asks.map((a) => [a.reason, a.sessionId]), [['initial', null], ['renew', sid(1)]]);
    assert.equal(calls.filter((c) => c.name === 'embedConsultJoin').at(-1)!.auth, tokenOf(sid(1), 2), 'same session, new secret');
    assert.equal(expiredCalls, 0);
  });

  // §4.11: a join refused for too little session time switches to a FRESH
  // session (identify runs again) and retries the join once.
  it('switches to a fresh session on session_renewal_required and retries the join once', async () => {
    const asks: SessionAsk[] = [];
    const {calls, fetchLike} = teleOps({
      embedConsultJoin: (_v: Vars, _n: number, c: Call) =>
        c.auth === TOKEN ? {ok: false, error: 'session_renewal_required', needSeconds: 2700} : {ok: true, status: 'waiting', position: 1},
    });
    const care = await connect({fetch: fetchLike}, {}, asks);
    assert.equal((await care.telehealth.join('tele_1')).status, 'waiting');
    assert.deepEqual(asks.map((a) => [a.reason, a.sessionId]), [['initial', null], ['fresh', null]]);
    assert.equal(calls.filter((c) => c.name === 'embedConsultJoin').length, 2, 'exactly one retry');
  });

  it('drives the scheduled-mode surface with the schema-exact variable types', async () => {
    const appointment = {consultId: 'tele_1', startsAt: '2026-09-15T10:00:00Z', endsAt: '2026-09-15T10:20:00Z', practitionerId: 'p_1', practitionerName: 'Dr. Chen', status: 'invited', waitingRoomOpensAt: '2026-09-15T09:50:00Z', cancellableUntil: '2026-09-14T10:00:00Z', timezone: 'America/New_York'};
    const {calls, fetchLike} = teleOps({
      embedBookingSlots: {ok: true, status: 'invited', slots: [{startsAt: '2026-09-15T10:00:00Z', endsAt: '2026-09-15T10:20:00Z', localDate: '2026-09-15', practitionerIds: ['p_1']}], timezone: 'America/New_York', slotMinutes: 20, appointment: null},
      embedBook: {ok: true, appointment, rescheduled: false},
      embedAppointmentBeat: {ok: true, state: {phase: 'waiting', startsAt: appointment.startsAt, otherSidePresent: false}, appointment},
      embedCancelBooking: {ok: true},
    });
    const care = await connect({fetch: fetchLike});

    const grid = await care.telehealth.slots('tele_1', {from: '2026-09-15', to: '2026-09-22'});
    assert.equal(grid.slots.length, 1);
    assert.equal(grid.timezone, 'America/New_York');
    assert.equal(grid.appointment, null);

    const booked = await care.telehealth.book('tele_1', {startsAt: '2026-09-15T10:00:00Z', practitionerId: 'p_1'});
    assert.equal(booked.appointment.consultId, 'tele_1');
    assert.equal(booked.rescheduled, false);
    const book = calls.find((c) => c.name === 'embedBook')!;
    assert.match(book.query, /\$startsAt: AWSDateTime!/, 'a.datetime() is AWSDateTime on the wire');
    assert.match(book.query, /\$practitionerId: ID\b/, 'a.id() is ID on the wire');
    assert.equal(book.variables.consultId, 'tele_1');

    const beat = await care.telehealth.appointmentBeat('tele_1');
    assert.equal(beat.state.phase, 'waiting');
    assert.equal(beat.livekit, undefined);
    const beatCall = calls.find((c) => c.name === 'embedAppointmentBeat')!;
    assert.equal(beatCall.variables.present, true);
    assert.match(beatCall.query, /\$present: Boolean\b/);

    await care.telehealth.appointmentBeat('tele_1', false);
    assert.equal(calls.filter((c) => c.name === 'embedAppointmentBeat').at(-1)!.variables.present, false);
    await care.telehealth.cancelBooking('tele_1');
    assert.equal(calls.find((c) => c.name === 'embedCancelBooking')!.variables.consultId, 'tele_1');
  });

  it('sends the viewer zone only when asked, and renders the grid in whatever zone the platform answered', async () => {
    // No implicit device default: a partner on 0.5.0 semantics who never
    // passes a zone must keep getting the clinic grid, and the platform must
    // never see a `timezone` variable it did not ask for.
    const appointment = {
      consultId: 'tele_1',
      startsAt: '2026-09-15T17:00:00Z',
      endsAt: '2026-09-15T17:20:00Z',
      practitionerId: 'p_1',
      practitionerName: 'Dr. Morin',
      status: 'scheduled',
      waitingRoomOpensAt: '2026-09-15T16:50:00Z',
      cancellableUntil: '2026-09-14T17:00:00Z',
      timezone: 'America/Los_Angeles',
      clinicTimezone: 'Europe/Zurich',
      physicianTimezone: 'Europe/Zurich',
      patientTimezone: 'America/Los_Angeles',
    };
    const {calls, fetchLike} = teleOps({
      embedBookingSlots: (v: Vars) => ({
        ok: true,
        status: 'scheduled',
        slots: [{startsAt: '2026-09-15T17:00:00Z', endsAt: '2026-09-15T17:20:00Z', localDate: '2026-09-15', practitionerIds: ['p_1']}],
        timezone: v.timezone ?? 'Europe/Zurich',
        clinicTimezone: 'Europe/Zurich',
        truncated: true,
        nextFrom: '2026-09-22',
        slotMinutes: 20,
        appointment,
      }),
      embedBook: {ok: true, appointment, rescheduled: true},
    });
    const care = await connect({fetch: fetchLike});

    const clinicGrid = await care.telehealth.slots('tele_1');
    const first = calls.find((c) => c.name === 'embedBookingSlots')!;
    assert.equal('timezone' in first.variables, false, 'nothing is guessed');
    assert.doesNotMatch(first.query, /\$timezone/);
    assert.equal(clinicGrid.timezone, 'Europe/Zurich');
    assert.equal(clinicGrid.clinicTimezone, 'Europe/Zurich');

    const grid = await care.telehealth.slots('tele_1', {from: '2026-09-15', timezone: 'America/Los_Angeles'});
    const second = calls.filter((c) => c.name === 'embedBookingSlots').at(-1)!;
    assert.equal(second.variables.timezone, 'America/Los_Angeles');
    assert.match(second.query, /\$timezone: String\b/, 'a.string() is String on the wire');
    assert.equal(grid.timezone, 'America/Los_Angeles');
    assert.equal(grid.clinicTimezone, 'Europe/Zurich');
    assert.equal(grid.truncated, true);
    assert.equal(grid.nextFrom, '2026-09-22');
    assert.equal(grid.appointment?.patientTimezone, 'America/Los_Angeles');
    assert.equal(grid.appointment?.physicianTimezone, 'Europe/Zurich');
    assert.equal(grid.appointment?.clinicTimezone, 'Europe/Zurich');

    const booked = await care.telehealth.book('tele_1', {startsAt: '2026-09-15T17:00:00Z', timezone: 'America/Los_Angeles'});
    const book = calls.find((c) => c.name === 'embedBook')!;
    assert.equal(book.variables.timezone, 'America/Los_Angeles');
    assert.match(book.query, /\$timezone: String\b/);
    assert.equal(booked.rescheduled, true);
    assert.equal(booked.appointment.timezone, 'America/Los_Angeles');
    assert.equal(booked.appointment.patientTimezone, 'America/Los_Angeles');
  });

  it('fills the zone fields a pre-0.6.0 platform does not send, so nothing reads undefined', async () => {
    // Older platforms answer with one `timezone` (the clinic's) and no
    // truncation info; the mapper says so rather than leaving holes.
    const appointment = {consultId: 'tele_1', startsAt: '2026-09-15T10:00:00Z', endsAt: '2026-09-15T10:20:00Z', practitionerId: 'p_1', practitionerName: 'Dr. Chen', status: 'scheduled', waitingRoomOpensAt: '2026-09-15T09:50:00Z', cancellableUntil: '2026-09-14T10:00:00Z', timezone: 'America/New_York'};
    const {fetchLike} = teleOps({
      embedBookingSlots: {ok: true, status: 'scheduled', slots: [], timezone: 'America/New_York', slotMinutes: 20, appointment},
      embedAppointmentBeat: {ok: true, state: {phase: 'early', opensAt: '2026-09-15T09:50:00Z', startsAt: appointment.startsAt}, appointment},
    });
    const care = await connect({fetch: fetchLike});
    const grid = await care.telehealth.slots('tele_1');
    assert.equal(grid.clinicTimezone, 'America/New_York', 'the grid zone WAS the clinic zone before 0.6.0');
    assert.equal(grid.truncated, false);
    assert.equal(grid.nextFrom, null);
    assert.deepEqual(
      [grid.appointment?.timezone, grid.appointment?.clinicTimezone, grid.appointment?.physicianTimezone, grid.appointment?.patientTimezone],
      ['America/New_York', 'America/New_York', null, null],
    );
    const beat = await care.telehealth.appointmentBeat('tele_1');
    assert.equal(beat.appointment?.clinicTimezone, 'America/New_York');
    assert.equal(beat.appointment?.practitionerName, 'Dr. Chen');
  });

  it('hands a lost booking race back with the fresh grid in the error details', async () => {
    const {fetchLike} = teleOps({
      embedBook: {ok: false, error: 'slot_taken', slots: [{startsAt: '2026-09-15T11:00:00Z', endsAt: '2026-09-15T11:20:00Z', localDate: '2026-09-15', practitionerIds: ['p_1']}]},
    });
    await assert.rejects(
      async () => (await connect({fetch: fetchLike})).telehealth.book('tele_1', {startsAt: '2026-09-15T10:00:00Z'}),
      (e: {code?: string; details?: {slots?: unknown[]}}) => e.code === 'slot_taken' && e.details?.slots?.length === 1,
    );
  });

  it('rates a video consult from its rating entry, naming the consult', async () => {
    const {calls, fetchLike} = teleOps({
      embedAgentMessages: {
        messages: [msg('system', 'Rate your call: https://app.natzar.ai/telehealth?id=tele_1', '2026-08-19T09:00:00Z', 'a')],
        linkStates: {tele_1: {kind: 'telehealth', action: 'rate'}},
      },
    });
    const care = await connect({fetch: fetchLike});
    const snap = await care.conversation.get();
    assert.equal(snap.timeline[0].awaiting, 'rating');
    await care.rate(snap.timeline[0], {stars: 4});
    const rate = calls.find((c) => c.name === 'embedRate')!;
    assert.deepEqual(rate.variables, {consultId: 'tele_1', communicationRating: 4, overallPhysicianRating: 4});
    assert.equal(calls.find((c) => c.name === 'embedAgentRate'), undefined, 'embedAgentRate would 404 on a telehealth id');
  });
});

// --- Prescriptions ------------------------------------------------------------
//
// The physician's "choose your pharmacy" notice carries a `/pharmacy?id=` link
// to a birthdate-gated page that refuses partner-origin patients by design —
// so inside a partner's UI the link is a button and the picker runs here, on
// the patient session. Every variable type below is pinned to the schema's own
// scalar: a `String` variable for an `Int`/`Float`/`AWSJSON` argument is
// refused by AppSync before the resolver runs.

describe('connectPatient — prescriptions', () => {
  const RX_BODY = 'Dr. Chen sent you a prescription. Choose your pharmacy below.\n\nhttps://app.ca.natzar.ai/pharmacy?id=rx_1\n\nThis link is active for the next 24 hours.';

  it('turns the pharmacy link into a `choose` action on the prescription id, leaving the thread id on the entry', async () => {
    const {fetchLike} = stub({
      embedState: {},
      embedAgentMessages: {
        messages: [{...msg('physician', RX_BODY, '2026-09-18T09:00:00Z', 'a'), asyncConsultId: 'thread_1'}],
        linkStates: {rx_1: {kind: 'pharmacy', action: 'choose', pharmacyName: null}},
      },
    });
    const snap = await (await connect({fetch: fetchLike})).conversation.get();
    const [rx] = snap.timeline;
    assert.equal(rx.text, 'Dr. Chen sent you a prescription. Choose your pharmacy below.\n\nThis link is active for the next 24 hours.');
    assert.deepEqual(rx.link, {kind: 'pharmacy', consultId: 'rx_1', action: 'choose', pharmacyName: null});
    assert.equal(rx.awaiting, 'pharmacy');
    assert.equal(rx.consultId, 'thread_1', 'a pharmacy link names a prescription — the entry still names the thread');
  });

  it('carries the chosen pharmacy on a `sent` link and offers nothing to press', async () => {
    const {fetchLike} = stub({
      embedState: {},
      embedAgentMessages: {
        messages: [msg('physician', RX_BODY, '2026-09-18T09:00:00Z', 'a')],
        linkStates: {rx_1: {kind: 'pharmacy', action: 'sent', pharmacyName: 'Shoppers Drug Mart'}},
      },
    });
    const snap = await (await connect({fetch: fetchLike})).conversation.get();
    assert.equal(snap.timeline[0].link?.action, 'sent');
    assert.equal(snap.timeline[0].link?.pharmacyName, 'Shoppers Drug Mart');
    assert.equal(snap.timeline[0].awaiting, undefined);
  });

  it('defaults an unresolved pharmacy link to `choose` — the picker re-reads the state anyway', async () => {
    const {fetchLike} = stub({
      embedState: {},
      embedAgentMessages: {messages: [msg('physician', RX_BODY, '2026-09-18T09:00:00Z', 'a')], linkStates: {}},
    });
    const snap = await (await connect({fetch: fetchLike})).conversation.get();
    assert.equal(snap.timeline[0].link?.action, 'choose');
    assert.equal(snap.timeline[0].awaiting, 'pharmacy');
  });

  it('drives the picker on the patient session with the schema-exact variable types', async () => {
    const hit = {directoryId: 'ca:ON:12345', name: 'Main St Pharmacy', address: '1 Main St', city: 'Toronto', region: 'ON', reachable: true, lat: 43.65, lng: -79.38, distanceKm: 1.2};
    const {calls, fetchLike} = stub({
      embedPrescriptionState: {status: 'awaiting_pharmacy', expired: false, expiresAt: '2026-09-19T09:00:00Z', pharmacyName: null, transport: 'fax', action: 'choose', addressRequired: false},
      embedPrescriptionPharmacies: {
        ok: true,
        status: 'awaiting_pharmacy',
        transport: 'fax',
        pharmacyName: null,
        origin: {lat: 43.65, lng: -79.38, source: 'device'},
        address: {step: null, onFile: null, zipHint: null},
        preferred: hit,
        licensure: null,
        distanceUnit: 'km',
        pharmacies: [hit],
      },
      embedPrescriptionChoose: {ok: true, status: 'transmitting', attempt: 1, pharmacyName: 'Main St Pharmacy', transport: 'fax'},
      embedPrescriptionHomeLocation: {ok: true},
    });
    const care = await connect({fetch: fetchLike});

    const state = await care.prescriptions.state('rx_1');
    assert.deepEqual(state, {status: 'awaiting_pharmacy', expired: false, expiresAt: '2026-09-19T09:00:00Z', pharmacyName: null, transport: 'fax', action: 'choose', addressRequired: false});
    const stateCall = calls.find((c) => c.name === 'embedPrescriptionState')!;
    assert.match(stateCall.query, /^query Op/, 'the state is a query, like embedState');
    assert.match(stateCall.query, /\$id: String!/);
    assert.deepEqual(stateCall.variables, {id: 'rx_1'});

    const list = await care.prescriptions.pharmacies('rx_1', {origin: {lat: 43.65, lng: -79.38, source: 'device'}, query: ' main ', radiusKm: 50});
    assert.equal(list.pharmacies.length, 1);
    assert.equal(list.transport, 'fax');
    assert.deepEqual(list.origin, {lat: 43.65, lng: -79.38, source: 'device'});
    assert.deepEqual(list.address, {step: null, onFile: null, zipHint: null}, 'a fax zone never asks for the address');
    assert.deepEqual(list.preferred, hit);
    assert.equal(list.licensure, null);
    assert.equal(list.distanceUnit, 'km', 'a Canadian deployment shows kilometres');
    assert.equal('ok' in list, false, 'the in-band ok flag never reaches the partner');
    const search = calls.find((c) => c.name === 'embedPrescriptionPharmacies')!;
    assert.match(search.query, /^query Op/, 'the search is a query');
    assert.match(search.query, /\$origin: AWSJSON\b/, 'a.json() is AWSJSON on the wire');
    assert.match(search.query, /\$radiusKm: Int\b/, 'a.integer() is Int on the wire');
    assert.match(search.query, /\$query: String\b/);
    assert.deepEqual(JSON.parse(String(search.variables.origin)), {lat: 43.65, lng: -79.38, source: 'device'}, 'AWSJSON travels stringified');
    assert.equal(search.variables.query, 'main', 'free text is trimmed');
    assert.equal(search.variables.radiusKm, 50);

    const chosen = await care.prescriptions.choose('rx_1', 'ca:ON:12345');
    assert.deepEqual(chosen, {status: 'transmitting', pharmacyName: 'Main St Pharmacy', transport: 'fax'});
    const choose = calls.find((c) => c.name === 'embedPrescriptionChoose')!;
    assert.match(choose.query, /^mutation Op/);
    assert.match(choose.query, /\$directoryId: String!/);
    assert.deepEqual(choose.variables, {id: 'rx_1', directoryId: 'ca:ON:12345'});

    await care.prescriptions.setHomeLocation('rx_1', {lat: 43.7, lng: -79.4});
    const home = calls.find((c) => c.name === 'embedPrescriptionHomeLocation')!;
    assert.match(home.query, /\$lat: Float!/, 'a.float() is Float on the wire');
    assert.match(home.query, /\$lng: Float!/);
    assert.deepEqual(home.variables, {id: 'rx_1', lat: 43.7, lng: -79.4});
  });

  it('runs the e-prescribing address step: the search answers it, setAddress sends it stringified and answers the list', async () => {
    const home = {street: '350 Fifth Avenue', street2: 'Suite 3300', city: 'New York', state: 'NY', zipCode: '10118', country: 'US'};
    const cvs = {directoryId: 'us:ncpdp:1234567', name: 'CVS Pharmacy', address: '1 W 34th St', reachable: true, lat: 40.7496, lng: -73.9877, distanceKm: 0.1};
    const {calls, fetchLike} = stub({
      embedPrescriptionState: {status: 'awaiting_pharmacy', expired: false, expiresAt: '2026-09-19T09:00:00Z', pharmacyName: null, transport: 'erx', action: 'choose', addressRequired: true},
      embedPrescriptionPharmacies: {ok: true, status: 'awaiting_pharmacy', transport: 'erx', pharmacyName: null, address: {step: 'collect', onFile: null, zipHint: '10118'}, preferred: null, licensure: null, distanceUnit: 'mi', pharmacies: []},
      embedPrescriptionAddress: {
        ok: true,
        status: 'awaiting_pharmacy',
        transport: 'erx',
        pharmacyName: null,
        origin: {lat: 40.749, lng: -73.986, source: 'address', label: 'Home'},
        address: {step: null, onFile: home, zipHint: null},
        preferred: cvs,
        licensure: {state: 'NY', stateName: 'New York'},
        distanceUnit: 'mi',
        pharmacies: [cvs],
      },
    });
    const care = await connect({fetch: fetchLike});

    assert.equal((await care.prescriptions.state('rx_1')).addressRequired, true);
    const pending = await care.prescriptions.pharmacies('rx_1');
    assert.deepEqual(pending.address, {step: 'collect', onFile: null, zipHint: '10118'});
    assert.equal(pending.preferred, null);
    assert.equal(pending.licensure, null, 'no notice while the address step is pending');
    assert.equal(pending.distanceUnit, 'mi');
    assert.deepEqual(pending.pharmacies, []);

    const list = await care.prescriptions.setAddress(
      'rx_1',
      {street: '350 Fifth Avenue', street2: 'Suite 3300', city: 'New York', state: 'NY', zipCode: '10118'},
      {lat: 40.74844, lng: -73.98566},
    );
    assert.deepEqual(list.address, {step: null, onFile: home, zipHint: null});
    assert.equal(list.preferred?.directoryId, 'us:ncpdp:1234567');
    assert.equal(list.pharmacies.length, 1);
    assert.deepEqual(list.licensure, {state: 'NY', stateName: 'New York'}, 'the notice judged against the address just confirmed');
    assert.equal(list.distanceUnit, 'mi');
    assert.equal('ok' in list, false);
    const call = calls.find((c) => c.name === 'embedPrescriptionAddress')!;
    assert.match(call.query, /^mutation Op/);
    assert.match(call.query, /\$address: AWSJSON!/, 'a.json() is AWSJSON on the wire');
    assert.match(call.query, /\$lat: Float!/);
    assert.deepEqual(JSON.parse(String(call.variables.address)), {street: '350 Fifth Avenue', street2: 'Suite 3300', city: 'New York', state: 'NY', zipCode: '10118'}, 'AWSJSON travels stringified');
    assert.equal(call.variables.lat, 40.748, 'the pick travels at the pickers\' precision (3 decimals)');
    assert.equal(call.variables.lng, -73.986);
  });

  it('omits the point when there is none — the address op\'s lat/lng are nullable, never sent as null', async () => {
    const {calls, fetchLike} = stub({
      embedPrescriptionAddress: {ok: true, status: 'awaiting_pharmacy', transport: 'erx', pharmacyName: null, homeAddress: '350 Fifth Avenue, New York, NY 10118, US', address: {step: null, onFile: null, zipHint: null}, preferred: null, pharmacies: []},
    });
    const list = await (await connect({fetch: fetchLike})).prescriptions.setAddress('rx_1', {street: '350 Fifth Avenue', city: 'New York', state: 'NY', zipCode: '10118'});
    assert.equal(list.homeAddress, '350 Fifth Avenue, New York, NY 10118, US', 'without a point the platform offers the line to geocode');
    const call = calls[0];
    assert.deepEqual(Object.keys(call.variables).sort(), ['address', 'id']);
    assert.doesNotMatch(call.query, /\$lat|\$lng/);
  });

  it('holds the address step to its invariants and defaults the new fields on a sparse answer', async () => {
    const {fetchLike} = stub({
      embedPrescriptionPharmacies: {ok: true, status: 'awaiting_pharmacy', transport: 'erx', pharmacyName: null, address: {step: 'confirm', onFile: {street: '', city: 'New York'}}, preferred: {name: 'no id'}, pharmacies: []},
    });
    const care = await connect({fetch: fetchLike});
    const list = await care.prescriptions.pharmacies('rx_1');
    assert.deepEqual(list.address, {step: 'collect', onFile: null, zipHint: null}, 'a confirm with nothing to confirm asks again');
    assert.equal(list.preferred, null);

    const bare = stub({embedPrescriptionPharmacies: {ok: true, status: 'sent', transport: 'erx', pharmacyName: 'CVS', pharmacies: []}});
    const settled = await (await connect({fetch: bare.fetchLike})).prescriptions.pharmacies('rx_1');
    assert.deepEqual(settled.address, {step: null, onFile: null, zipHint: null});
    assert.equal(settled.preferred, null);
    assert.equal(settled.licensure, null);
    assert.equal(settled.distanceUnit, 'km', 'a missing unit reads kilometres');
  });

  it('passes the licensure notice on as the state\'s code and name only, and reads an unknown unit as kilometres', async () => {
    const answer = (licensure: unknown, distanceUnit: unknown) =>
      stub({embedPrescriptionPharmacies: {ok: true, status: 'awaiting_pharmacy', transport: 'erx', pharmacyName: null, address: {step: null, onFile: null, zipHint: null}, preferred: null, licensure, distanceUnit, pharmacies: []}});
    const read = async (licensure: unknown, distanceUnit: unknown) =>
      (await connect({fetch: answer(licensure, distanceUnit).fetchLike})).prescriptions.pharmacies('rx_1');

    const warned = await read({state: ' NJ ', stateName: 'New Jersey', extra: 'dropped'}, 'mi');
    assert.deepEqual(warned.licensure, {state: 'NJ', stateName: 'New Jersey'});
    assert.equal(warned.distanceUnit, 'mi');
    // A notice that cannot name the state is not one to show.
    for (const broken of [{state: 'NJ'}, {stateName: 'New Jersey'}, {state: '', stateName: 'New Jersey'}, {state: 7, stateName: 'New Jersey'}, 'NJ', []]) {
      assert.equal((await read(broken, 'mi')).licensure, null, JSON.stringify(broken));
    }
    assert.equal((await read(null, 'miles')).distanceUnit, 'km');
    assert.equal((await read(null, 'km')).distanceUnit, 'km');
  });

  it('sends nothing it was not given on a search — no origin, no query, no radius', async () => {
    const {calls, fetchLike} = stub({
      embedPrescriptionPharmacies: {ok: true, status: 'awaiting_pharmacy', transport: 'erx', pharmacyName: null, homeAddress: '1 Main St, Toronto', pharmacies: []},
    });
    const list = await (await connect({fetch: fetchLike})).prescriptions.pharmacies('rx_1');
    assert.equal(list.homeAddress, '1 Main St, Toronto', 'the address to geocode when no origin exists');
    assert.equal(list.origin, undefined);
    const search = calls[0];
    assert.deepEqual(search.variables, {id: 'rx_1'});
    assert.doesNotMatch(search.query, /\$origin|\$query|\$radiusKm/);
  });

  it('adds a pharmacy no directory covers, stringified like every a.json() argument', async () => {
    const pharmacy = {directoryId: 'ca:manual:abc', name: 'Corner Pharmacy', address: '9 Side St', reachable: false};
    const {calls, fetchLike} = stub({
      embedPrescriptionAddPharmacy: {ok: true, directoryId: 'ca:manual:abc', pharmacy, status: 'pending_verification', probe: 'sent', faxIssue: null},
    });
    const added = await (await connect({fetch: fetchLike})).prescriptions.addPharmacy('rx_1', {name: 'Corner Pharmacy', address: '9 Side St', fax: '+14165550100'});
    assert.deepEqual(added, {directoryId: 'ca:manual:abc', pharmacy, status: 'pending_verification', probe: 'sent', faxIssue: null});
    const call = calls[0];
    assert.match(call.query, /^mutation Op/);
    assert.match(call.query, /\$pharmacy: AWSJSON!/);
    assert.deepEqual(JSON.parse(String(call.variables.pharmacy)), {name: 'Corner Pharmacy', address: '9 Side St', fax: '+14165550100'});
  });

  it('reads a miss as an expired link rather than throwing — the state call is safe to poll', async () => {
    const {fetchLike} = stub({
      embedPrescriptionState: {status: 'expired', expired: true, expiresAt: null, pharmacyName: null, transport: null, action: 'expired'},
    });
    const state = await (await connect({fetch: fetchLike})).prescriptions.state('someone_elses');
    assert.equal(state.action, 'expired');
    assert.equal(state.expired, true);
    assert.equal(state.transport, null);
  });

  it('refuses an address with the field to fix in the details, the REST plane\'s status', async () => {
    const {fetchLike} = stub({embedPrescriptionAddress: {ok: false, error: 'invalid_address', code: 'state'}});
    await assert.rejects(
      async () => (await connect({fetch: fetchLike})).prescriptions.setAddress('rx_1', {street: '1 Main St', city: 'Toronto', state: 'ON', zipCode: 'M5V 2T6'}),
      (e: {code?: string; status?: number; details?: {code?: string}}) => e.code === 'invalid_address' && e.status === 422 && e.details?.code === 'state',
    );
  });

  it('maps a refused choice onto the SAME error the server half throws, with the status in the details', async () => {
    const {fetchLike} = stub({
      embedPrescriptionChoose: {ok: false, error: 'not_choosable', status: 'sent'},
    });
    await assert.rejects(
      async () => (await connect({fetch: fetchLike})).prescriptions.choose('rx_1', 'ca:ON:1'),
      (e: {code?: string; status?: number; details?: {status?: string}}) => e.code === 'not_choosable' && e.status === 409 && e.details?.status === 'sent',
    );
  });

  it('reports the whole refusal vocabulary by its own code, never as internal_error', async () => {
    for (const error of ['pharmacy_not_found', 'not_choosable', 'expired', 'pharmacy_unreachable', 'lost_race', 'invalid_location', 'not_available', 'invalid_pharmacy', 'invalid_address', 'address_required', 'not_found']) {
      const {fetchLike} = stub({embedPrescriptionChoose: {ok: false, error}});
      await assert.rejects(
        async () => (await connect({fetch: fetchLike})).prescriptions.choose('rx_1', 'x'),
        (e: {code?: string}) => e.code === error,
        error,
      );
    }
  });

  // A refusal arrives in-band on a 200, so `status` is nominal — but it must
  // be the SAME number the REST plane sends for that code, or a partner
  // logging `e.status` sees 409 from one half and 404/422 from the other.
  it('stamps the contract status on a refusal the REST plane also knows, and 409 on the embed-only ones', async () => {
    const expected: Record<string, number> = {
      session_expired: 401,
      not_found: 404,
      pharmacy_not_found: 404,
      invalid_location: 422,
      invalid_pharmacy: 422,
      invalid_address: 422,
      address_required: 409,
      invalid_request: 400,
      not_choosable: 409,
      lost_race: 409,
      expired: 409,
      not_available: 409,
    };
    for (const [error, status] of Object.entries(expected)) {
      const {fetchLike} = stub({embedPrescriptionChoose: {ok: false, error}});
      await assert.rejects(
        async () => (await connect({fetch: fetchLike})).prescriptions.choose('rx_1', 'x'),
        (e: {code?: string; status?: number}) => e.code === error && e.status === status,
        `${error} → ${status}`,
      );
    }
  });
});

// --- Referrals ----------------------------------------------------------------
//
// The physician's "view your referral" notice carries a `/referral?id=` link
// to a signed PDF behind a birthdate-gated page that refuses partner-origin
// patients and dies after 30 days. On the patient session the document has
// no window: the link reads `view` for as long as the referral stands, the
// 30-day sentence is stripped, nothing awaits the patient, and the document
// op mints a fresh URL on every open.

describe('connectPatient — referrals', () => {
  const REF_BODY =
    'Dr. Chen has sent you a referral for laboratory tests. Simply show it or hand it to the laboratory — they will take it from there. Tap to view your referral: https://app.ca.natzar.ai/referral?id=ref_1\n\nThis link is active for the next 30 days.';

  it('turns the referral link into a `view` action on the referral id, strips the validity sentence and awaits nothing', async () => {
    const {fetchLike} = stub({
      embedState: {},
      embedAgentMessages: {
        messages: [{...msg('physician', REF_BODY, '2026-09-22T09:00:00Z', 'a'), asyncConsultId: 'thread_1'}],
        linkStates: {ref_1: {kind: 'referral', action: 'view', title: 'Laboratory requisition', referralKind: 'laboratory'}},
      },
    });
    const snap = await (await connect({fetch: fetchLike})).conversation.get();
    const [ref] = snap.timeline;
    assert.equal(
      ref.text,
      'Dr. Chen has sent you a referral for laboratory tests. Simply show it or hand it to the laboratory — they will take it from there. Tap to view your referral:',
    );
    assert.deepEqual(ref.link, {kind: 'referral', consultId: 'ref_1', action: 'view', title: 'Laboratory requisition'});
    assert.equal(ref.awaiting, undefined, 'a referral is carried, not answered');
    assert.equal(ref.consultId, 'thread_1', 'a referral link names a referral — the entry still names the thread');
  });

  it('strips the validity sentence in every language and leaves the prescription sentence alone', async () => {
    const sentences = [
      'This link is active for the next 30 days.',
      'Este enlace está activo durante los próximos 30 días.',
      'Dieser Link ist die nächsten 30 Tage aktiv.',
      'Ce lien est actif pendant les 30 prochains jours.',
      'Questo link è attivo per i prossimi 30 giorni.',
    ];
    const {fetchLike} = stub({
      embedState: {},
      embedAgentMessages: {
        messages: [
          ...sentences.map((sentence, i) => msg('physician', `Lead-in: https://x.test/referral?id=ref_${i}\n\n${sentence}`, '2026-09-22T09:00:00Z', `r${i}`)),
          msg('physician', 'Choose your pharmacy:\n\nhttps://x.test/pharmacy?id=rx_1\n\nThis link is active for the next 24 hours.', '2026-09-22T09:00:01Z', 'p'),
        ],
        linkStates: {},
      },
    });
    const snap = await (await connect({fetch: fetchLike})).conversation.get();
    for (let i = 0; i < sentences.length; i++) assert.equal(snap.timeline[i].text, 'Lead-in:', sentences[i]);
    assert.equal(snap.timeline[5].text, 'Choose your pharmacy:\n\nThis link is active for the next 24 hours.');
  });

  it('defaults an unresolved referral link to `view` — the open re-reads the row anyway', async () => {
    const {fetchLike} = stub({
      embedState: {},
      embedAgentMessages: {messages: [msg('physician', REF_BODY, '2026-09-22T09:00:00Z', 'a')], linkStates: {}},
    });
    const snap = await (await connect({fetch: fetchLike})).conversation.get();
    assert.equal(snap.timeline[0].link?.action, 'view');
    assert.equal(snap.timeline[0].link?.title, null);
    assert.equal(snap.timeline[0].awaiting, undefined);
  });

  it('renders a withdrawn referral as `revoked` with nothing to press', async () => {
    const {fetchLike} = stub({
      embedState: {},
      embedAgentMessages: {
        messages: [msg('physician', REF_BODY, '2026-09-22T09:00:00Z', 'a')],
        linkStates: {ref_1: {kind: 'referral', action: 'revoked', title: 'Laboratory requisition'}},
      },
    });
    const snap = await (await connect({fetch: fetchLike})).conversation.get();
    assert.equal(snap.timeline[0].link?.action, 'revoked');
    assert.equal(snap.timeline[0].awaiting, undefined);
  });

  it('mints the document on the patient session and hands it back as issued', async () => {
    const {calls, fetchLike} = stub({
      embedReferralDocument: {
        ok: true,
        status: 'issued',
        kind: 'laboratory',
        title: 'Laboratory requisition',
        physicianName: 'Dr. Sarah Chen',
        issuedAt: '2026-09-22T09:00:00Z',
        document: {url: 'https://s3.test/ref_1.pdf', expiresIn: 300, fileName: 'Laboratory-requisition-ref_1.pdf', contentType: 'application/pdf'},
      },
    });
    const doc = await (await connect({fetch: fetchLike})).referrals.document('ref_1');
    assert.deepEqual(doc, {
      status: 'issued',
      kind: 'laboratory',
      title: 'Laboratory requisition',
      physicianName: 'Dr. Sarah Chen',
      issuedAt: '2026-09-22T09:00:00Z',
      document: {url: 'https://s3.test/ref_1.pdf', expiresIn: 300, fileName: 'Laboratory-requisition-ref_1.pdf', contentType: 'application/pdf'},
    });
    const call = calls.find((c) => c.name === 'embedReferralDocument')!;
    assert.match(call.query, /^query Op/, 'the document read is a query');
    assert.match(call.query, /\$id: String!/);
    assert.deepEqual(call.variables, {id: 'ref_1'});
  });

  it('exposes every PDF under one referral link', async () => {
    const document = {url: 'https://s3.test/ref_1.pdf', expiresIn: 300, fileName: 'ref_1.pdf', contentType: 'application/pdf'};
    const {fetchLike} = stub({embedReferralDocument: {
      ok: true, status: 'issued', kind: 'laboratory', title: 'Laboratory requisition', physicianName: 'Dr. Sarah Chen', issuedAt: '2026-09-22T09:00:00Z', document,
      files: [
        {id: 'ref_1', kind: 'laboratory', title: 'Laboratory requisition', document},
        {id: 'ref_2', kind: 'imaging', title: 'Imaging requisition', document: {...document, url: 'https://s3.test/ref_2.pdf', fileName: 'ref_2.pdf'}},
      ],
    }});
    const reply = await (await connect({fetch: fetchLike})).referrals.document('ref_1');
    assert.equal(reply.status, 'issued');
    if (reply.status === 'issued') assert.deepEqual(reply.files?.map((file) => [file.id, file.document.fileName]), [['ref_1', 'ref_1.pdf'], ['ref_2', 'ref_2.pdf']]);
  });

  it('hands back a withdrawn referral as `revoked`, with no document', async () => {
    const {fetchLike} = stub({
      embedReferralDocument: {ok: true, status: 'revoked', kind: 'imaging', title: 'Imaging requisition — MRI', physicianName: 'Dr. Sarah Chen', issuedAt: '2026-09-22T09:00:00Z', revokedAt: '2026-09-23T09:00:00Z'},
    });
    const doc = await (await connect({fetch: fetchLike})).referrals.document('ref_1');
    assert.equal(doc.status, 'revoked');
    assert.equal('document' in doc, false);
    if (doc.status === 'revoked') assert.equal(doc.revokedAt, '2026-09-23T09:00:00Z');
  });

  it('rejects a referral that is not this patient\'s with `not_found`, never an expired state', async () => {
    const {fetchLike} = stub({embedReferralDocument: {ok: false, error: 'not_found'}});
    await assert.rejects(
      async () => (await connect({fetch: fetchLike})).referrals.document('someone_elses'),
      (e: {code?: string; status?: number}) => e.code === 'not_found' && e.status === 404,
    );
  });
});

describe('connectPatient — session kind', () => {
  it('answers consent through the thread op on a consult-scoped session', async () => {
    const {calls, fetchLike} = stub({embedAsyncConsent: {ok: true, status: 'queued'}});
    const care = await connect({fetch: fetchLike}, {consult: 'async:thread_1'});
    assert.deepEqual(care.session?.scope.consult, {kind: 'async', id: 'thread_1'});
    await care.respond({id: 'a', author: 'agent', text: '', sentAt: '', source: 'consult'}, true);
    assert.equal(calls[0].name, 'embedAsyncConsent');
    assert.equal(calls[0].variables.accept, true);
  });

  it('answers consent through the agent op on a patient session', async () => {
    const {calls, fetchLike} = stub({embedAgentConsent: {ok: true}});
    const care = await connect({fetch: fetchLike});
    await care.respond({id: 'a', author: 'agent', text: '', sentAt: '', source: 'consult'}, false);
    assert.equal(calls[0].name, 'embedAgentConsent');
    assert.equal(calls[0].variables.accept, false);
  });
});

describe('connectPatient — session end', () => {
  it('fires onExpired once on a revoked session, parks the subscription, and resumes on reconnect()', async () => {
    let revokedNow = false;
    const expiredInfo: unknown[] = [];
    const asks: SessionAsk[] = [];
    const {calls, fetchLike} = stub({
      embedState: () => (revokedNow ? {ok: false, error: 'session_revoked'} : {}),
      embedAgentMessages: {messages: []},
      embedAgentSend: () => (revokedNow ? {ok: false, error: 'session_revoked'} : {ok: true}),
    });
    const care = await connect({fetch: fetchLike, intervalMs: 5, onExpired: (info) => expiredInfo.push(info)}, {}, asks);
    const phases: string[] = [];
    const stop = care.conversation.subscribe((_s, sync) => phases.push(sync.phase), {pauseWhenHidden: false});
    await tick(30);
    const stateReads = () => calls.filter((c) => c.name === 'embedState').length;
    assert.ok(stateReads() >= 2, 'polling before the revocation');

    revokedNow = true;
    // An action hitting the dead session reports it too — and still only once.
    await assert.rejects(() => care.conversation.send({text: 'x'}), (e: {code?: string}) => e.code === 'session_revoked');
    await tick(30);
    assert.deepEqual(expiredInfo, [{reason: 'revoked', code: 'session_revoked'}]);
    const parkedAt = stateReads();
    await tick(40);
    assert.equal(stateReads(), parkedAt, 'no polls while ended');
    assert.ok(!phases.includes('retrying'), 'an ended session is not a network problem');
    assert.equal(asks.length, 1, 'the contract table ends the session: no automatic new one');

    revokedNow = false;
    await care.reconnect();
    await tick(30);
    assert.ok(stateReads() > parkedAt, 'polling resumed');
    assert.equal(asks.at(-1)!.reason, 'reconnect');
    assert.equal(calls.filter((c) => c.name === 'embedState').at(-1)!.auth, tokenOf(sid(2), 2), 'on the new session');
    stop();
    assert.equal(phases.at(-1), 'stopped');
  });

  it('a one-shot get() after the session ended rejects rather than hanging', async () => {
    const {fetchLike} = stub({embedState: {ok: false, error: 'session_ended'}, embedAgentMessages: {messages: []}});
    const expiredInfo: unknown[] = [];
    const care = await connect({fetch: fetchLike, onExpired: (info) => expiredInfo.push(info)});
    await assert.rejects(() => care.conversation.get(), (e: {code?: string}) => e.code === 'session_ended');
    await assert.rejects(() => care.conversation.get(), (e: {name?: string; code?: string}) => e.name === 'NatzarSessionError' && e.code === 'session_expired');
    assert.deepEqual(expiredInfo, [{reason: 'absolute', code: 'session_expired'}]);
  });

  it('logout() revokes the session on the platform and stops the client', async () => {
    const {calls, fetchLike} = stub({embedLogout: {ok: true, revoked: true}});
    const care = await connect({fetch: fetchLike});
    assert.deepEqual(await care.logout(), {revoked: true});
    assert.equal(calls[0].name, 'embedLogout');
    assert.equal(calls[0].auth, TOKEN);
    await assert.rejects(() => care.conversation.get(), (e: {code?: string}) => e.code === 'not_connected');
  });
});

describe('connectPatient — polling discipline', () => {
  // `send()` refreshes the subscription at once. If that refresh lands while
  // a poll is still in flight it must fold into it, not run beside it: a
  // second concurrent tick becomes a second poll chain for the life of the
  // subscription — twice the requests, and one timer `stop()` cannot reach.
  it('folds a refresh during an in-flight poll into that poll instead of starting a second chain', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const {calls, fetchLike} = stub({
      embedState: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await tick(20);
        inFlight -= 1;
        return {};
      },
      embedAgentMessages: {messages: []},
      embedAgentSend: {ok: true},
    });
    const care = await connect({fetch: fetchLike, intervalMs: 5});
    const stop = care.conversation.subscribe(() => {}, {pauseWhenHidden: false});
    await tick(5); // the first poll is mid-flight
    await care.conversation.send({text: 'hi'}); // refreshNow() before AND after the op
    await tick(60);
    stop();
    const reads = calls.filter((c) => c.name === 'embedState').length;
    await tick(60);
    assert.equal(calls.filter((c) => c.name === 'embedState').length, reads, 'nothing polls after stop()');
    assert.equal(maxInFlight, 1, 'one poll at a time');
    assert.ok(reads >= 2, 'the refresh still produced a fresh read');
  });
});

describe('connectPatient — accept & pay', () => {
  const PRICE = {amountCents: 10000, currency: 'cad'};
  const refusal = (checkout?: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    ok: false, status: 'invited', error: 'payment_required', modality: 'async', mode: 'live', ...PRICE,
    ...(checkout ? {checkout} : {}), ...extra,
  });
  const embeddedCheckout = {paymentId: 'pay_1', ...PRICE, clientSecret: 'cs_test_secret', publishableKey: 'pk_test_1'};
  const inviteEntry = {id: 'm1', author: 'agent' as const, text: '', sentAt: '', source: 'agent' as const, awaiting: 'consent' as const};

  it('surfaces the price on an ACTIONABLE invite link only, and drops a malformed one', async () => {
    const {fetchLike} = stub({
      embedState: {},
      embedAgentMessages: {
        messages: [
          msg('agent', 'A physician can take this: https://x.test/async?id=thr_1', '2026-09-24T09:00:00Z', 'a'),
          msg('agent', 'Join: https://x.test/telehealth?id=tele_1', '2026-09-24T09:01:00Z', 'b'),
          msg('agent', 'Rate: https://x.test/async?id=thr_2', '2026-09-24T09:02:00Z', 'c'),
          msg('agent', 'Book: https://x.test/book?id=bk_1', '2026-09-24T09:03:00Z', 'd'),
        ],
        linkStates: {
          thr_1: {kind: 'async', action: 'consent', payment: PRICE},
          tele_1: {kind: 'telehealth', action: 'join', payment: {amountCents: '10000', currency: 'cad'}},
          thr_2: {kind: 'async', action: 'rate', payment: PRICE},
          bk_1: {kind: 'book', action: 'book', payment: {amountCents: 5000, currency: 'cad'}},
        },
      },
    });
    const snap = await (await connect({fetch: fetchLike})).conversation.get();
    const [consent, join, rate, book] = snap.timeline;
    assert.deepEqual(consent.link, {kind: 'async', consultId: 'thr_1', action: 'consent', payment: PRICE});
    assert.equal(join.link?.payment, undefined, 'a malformed price is not shown');
    assert.equal(rate.link?.payment, undefined, 'no price beside a terminal action');
    assert.deepEqual(book.link?.payment, {amountCents: 5000, currency: 'cad'});
  });

  it('reads a consult-scoped session price and a slot grid price', async () => {
    const {fetchLike} = stub({
      embedState: {typ: 'async', consultId: 'thr_1', status: 'invited', payment: PRICE},
      embedAgentMessages: {messages: []},
      embedBookingSlots: {ok: true, status: 'invited', slots: [], timezone: 'UTC', payment: PRICE},
    });
    const care = await connect({fetch: fetchLike});
    const snap = await care.conversation.get();
    assert.deepEqual(snap.consult?.payment, PRICE);
    const grid = await care.telehealth.slots('bk_1');
    assert.deepEqual(grid.payment, PRICE);
  });

  it('sends `checkout` as a Boolean and `paymentId` as String!, and keeps the bare-signal form', async () => {
    const {calls, fetchLike} = stub({embedAgentConsent: {ok: true, status: 'queued'}});
    const care = await connect({fetch: fetchLike});
    await care.respond(inviteEntry, true, {checkout: true});
    assert.equal(calls[0].variables.checkout, true);
    assert.match(calls[0].query, /\$checkout: Boolean\b/);
    await care.respond(inviteEntry, true, {paymentId: 'pay_1', checkout: true});
    assert.equal(calls[1].variables.paymentId, 'pay_1');
    assert.equal(calls[1].variables.checkout, undefined, 'a presented payment wins over checkout');
    assert.match(calls[1].query, /\$paymentId: String!/);
    await care.respond(inviteEntry, true, new AbortController().signal);
    assert.deepEqual(Object.keys(calls[2].variables).sort(), ['accept']);
    await care.respond(inviteEntry, false, {checkout: true, paymentId: 'pay_1'});
    assert.deepEqual(Object.keys(calls[3].variables).sort(), ['accept'], 'a decline is never charged');
  });

  it('join and book carry the payment, naming the consult', async () => {
    const {calls, fetchLike} = stub({
      embedConsultJoin: {ok: true, status: 'waiting', position: 1, estimatedMinutes: 3},
      embedBook: {ok: true, appointment: {consultId: 'tele_1', startsAt: '2026-10-01T15:00:00Z', timezone: 'UTC'}},
    });
    const care = await connect({fetch: fetchLike});
    await care.telehealth.join('tele_1', {paymentId: 'pay_1'});
    await care.telehealth.join('tele_1', new AbortController().signal);
    await care.telehealth.book('tele_1', {startsAt: '2026-10-01T15:00:00Z', checkout: true});
    const joins = calls.filter((c) => c.name === 'embedConsultJoin');
    assert.equal(joins[0].variables.consultId, 'tele_1');
    assert.equal(joins[0].variables.paymentId, 'pay_1');
    assert.equal(joins[1].variables.paymentId, undefined);
    const bookCall = calls.find((c) => c.name === 'embedBook')!;
    assert.equal(bookCall.variables.checkout, true);
  });

  it('payments.status reads embedPaymentStatus on the patient session; only `paid` is paid', async () => {
    const {calls, fetchLike} = stub({
      embedPaymentStatus: (v: Vars) => (v.paymentId === 'pay_1' ? {ok: true, status: 'paid', paid: true} : {ok: true, status: 'teleported', paid: true}),
    });
    const care = await connect({fetch: fetchLike});
    assert.deepEqual(await care.payments.status('pay_1'), {paymentId: 'pay_1', status: 'paid', paid: true});
    assert.deepEqual(await care.payments.status('pay_2'), {paymentId: 'pay_2', status: 'unknown', paid: false});
    assert.equal(calls[0].auth, TOKEN);
    assert.match(calls[0].query, /\$paymentId: String!/);
  });

  it('checkoutOf reads the bound checkout off a payment refusal, and nothing else', async () => {
    const {fetchLike} = stub({
      embedAgentConsent: (_v: Vars, n: number) =>
        n === 1 ? refusal(embeddedCheckout)
          : n === 2 ? refusal(undefined, {checkoutError: 'payments_unavailable'})
            : n === 3 ? refusal({paymentId: 'pay_1', ...PRICE})
              : {ok: false, error: 'expired', status: 'expired'},
    });
    const care = await connect({fetch: fetchLike});
    const caught = async () => {
      try {
        await care.respond(inviteEntry, true, {checkout: true});
      } catch (e) {
        return e;
      }
      throw new Error('expected a refusal');
    };
    assert.deepEqual(checkoutOf(await caught()), embeddedCheckout);
    assert.equal(checkoutOf(await caught()), null, 'no checkout could start');
    assert.equal(checkoutOf(await caught()), null, 'nothing to mount and nothing paid');
    assert.equal(checkoutOf(await caught()), null, 'not a payment refusal');
  });

  it('acceptAndPay: consent → mount → wait for paid → consent again with the payment', async () => {
    const order: string[] = [];
    const {calls, fetchLike} = stub({
      embedState: {},
      embedAgentMessages: {messages: []},
      embedAgentConsent: (v: Vars) => {
        order.push(v.paymentId ? `consent:${v.paymentId}` : `consent:checkout=${v.checkout}`);
        return v.paymentId ? {ok: true, status: 'queued'} : refusal(embeddedCheckout);
      },
      embedPaymentStatus: (_v: Vars, n: number) => {
        order.push('status');
        return n < 3 ? {ok: true, status: 'pending', paid: false} : {ok: true, status: 'paid', paid: true};
      },
    });
    const care = await connect({fetch: fetchLike});
    const mounted: unknown[] = [];
    const result = await care.acceptAndPay(inviteEntry, {
      mount: async (checkout) => {
        order.push('mount');
        mounted.push(checkout);
      },
      pollIntervalMs: 1,
    });
    assert.deepEqual(mounted, [embeddedCheckout]);
    assert.deepEqual(order, ['consent:checkout=true', 'mount', 'status', 'status', 'status', 'consent:pay_1']);
    assert.deepEqual(result, {action: 'consent', paymentId: 'pay_1'});
    assert.equal(calls.filter((c) => c.name === 'embedAgentConsent').length, 2);
  });

  it('acceptAndPay goes straight through when nothing is owed (free, folded, or adopted)', async () => {
    const {calls, fetchLike} = stub({embedAgentConsent: {ok: true, status: 'queued'}});
    const care = await connect({fetch: fetchLike});
    let mounts = 0;
    const result = await care.acceptAndPay(inviteEntry, {mount: async () => void mounts++});
    assert.equal(mounts, 0);
    assert.deepEqual(result, {action: 'consent', paymentId: null});
    assert.equal(calls.length, 1);
  });

  it('acceptAndPay skips the form when the invite is already paid (settling) and only awaits confirmation', async () => {
    const {fetchLike} = stub({
      embedAgentConsent: (v: Vars) =>
        v.paymentId ? {ok: true, status: 'queued'} : refusal({paymentId: 'pay_9', ...PRICE, alreadyPaid: true, settling: true}, {error: 'payment_not_completed'}),
      embedPaymentStatus: (_v: Vars, n: number) => (n < 2 ? {ok: true, status: 'pending', paid: false} : {ok: true, status: 'paid', paid: true}),
    });
    const care = await connect({fetch: fetchLike});
    let mounts = 0;
    const result = await care.acceptAndPay(inviteEntry, {mount: async () => void mounts++, pollIntervalMs: 1});
    assert.equal(mounts, 0);
    assert.equal(result.paymentId, 'pay_9');
  });

  it('acceptAndPay on a video invite joins the consult and returns the waiting room', async () => {
    const {calls, fetchLike} = stub({
      embedConsultJoin: (v: Vars) =>
        v.paymentId
          ? {ok: true, status: 'waiting', position: 2, estimatedMinutes: 6}
          : {ok: false, error: 'payment_required', ...PRICE, checkout: {...embeddedCheckout, paymentId: 'pay_t'}},
      embedPaymentStatus: {ok: true, status: 'paid', paid: true},
    });
    const care = await connect({fetch: fetchLike});
    const entry = {id: 'm2', author: 'agent' as const, text: '', sentAt: '', source: 'agent' as const, awaiting: 'join' as const,
      consultId: 'tele_1', link: {kind: 'telehealth' as const, consultId: 'tele_1', action: 'join' as const, payment: PRICE}};
    const result = await care.acceptAndPay(entry, {mount: async () => {}, pollIntervalMs: 1});
    assert.equal(result.action, 'join');
    assert.equal(result.join?.position, 2);
    const joins = calls.filter((c) => c.name === 'embedConsultJoin');
    assert.deepEqual(joins.map((c) => [c.variables.consultId, c.variables.checkout, c.variables.paymentId]),
      [['tele_1', true, undefined], ['tele_1', undefined, 'pay_t']]);
    const status = calls.find((c) => c.name === 'embedPaymentStatus')!;
    assert.equal(status.auth, TOKEN, 'payment status is read on the patient session');
  });

  it('acceptAndPay stops on a payment that fails, rejecting with the id to resume from', async () => {
    const {calls, fetchLike} = stub({
      embedAgentConsent: refusal(embeddedCheckout),
      embedPaymentStatus: {ok: true, status: 'failed', paid: false},
    });
    const care = await connect({fetch: fetchLike});
    await assert.rejects(() => care.acceptAndPay(inviteEntry, {mount: async () => {}, pollIntervalMs: 1}), (e: {code?: string; details?: unknown}) => {
      assert.equal(e.code, 'payment_not_completed');
      assert.deepEqual(e.details, {paymentId: 'pay_1', status: 'failed'});
      return true;
    });
    assert.equal(calls.filter((c) => c.name === 'embedAgentConsent').length, 1, 'no retry on an unpaid payment');
  });

  it('acceptAndPay passes a backed-out mount through and never polls', async () => {
    const {calls, fetchLike} = stub({embedAgentConsent: refusal(embeddedCheckout)});
    const care = await connect({fetch: fetchLike});
    await assert.rejects(
      () => care.acceptAndPay(inviteEntry, {mount: async () => {throw new Error('backed out');}}),
      /backed out/,
    );
    assert.equal(calls.some((c) => c.name === 'embedPaymentStatus'), false);
  });

  it('acceptAndPay rethrows a refusal that carries no checkout (checkoutError)', async () => {
    const {fetchLike} = stub({embedAgentConsent: refusal(undefined, {checkoutError: 'stripe_error'})});
    const care = await connect({fetch: fetchLike});
    await assert.rejects(() => care.acceptAndPay(inviteEntry, {mount: async () => {}}), (e: {code?: string; details?: {checkoutError?: string}}) => {
      assert.equal(e.code, 'payment_required');
      assert.equal(e.details?.checkoutError, 'stripe_error');
      return true;
    });
  });

  it('acceptAndPay refuses an entry that awaits nothing payable, and a booking without a slot', async () => {
    const care = await connect({fetch: stub({}).fetchLike});
    await assert.rejects(() => care.acceptAndPay({...inviteEntry, awaiting: 'rating'}, {mount: async () => {}}), /consent, join or book/);
    await assert.rejects(
      () => care.acceptAndPay({...inviteEntry, awaiting: 'book', consultId: 'bk_1'}, {mount: async () => {}}),
      /booking\.startsAt/,
    );
  });
});
