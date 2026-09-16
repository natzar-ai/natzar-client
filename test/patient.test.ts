import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {connectPatient} from '../dist/esm/patient/index.js';

// The patient surface — the half that runs in a browser with no API key.
// Everything here is stubbed at fetch, so these assert SHAPING rules rather
// than transport.

const SESSION = {
  sessionToken: 'tok_1',
  graphqlUrl: 'https://gql.test/graphql',
  publicApiKey: 'da2-public',
};

type Vars = Record<string, unknown>;
type OpStub = unknown | ((variables: Vars, call: number) => unknown);

/**
 * Stubs the AppSync endpoint, answering each op from `ops` — a fixed payload,
 * or a function of the variables (and how many times that op has been hit)
 * for the stateful flows. Non-GraphQL requests (the presigned attachment PUT)
 * are recorded under `puts` and answered 200.
 */
function stub(ops: Record<string, OpStub>) {
  const calls: Array<{name: string; variables: Vars; query: string}> = [];
  const puts: Array<{url: string; init: RequestInit}> = [];
  const hits: Record<string, number> = {};
  const fetchLike = async (url: string, init: RequestInit) => {
    if (init.method === 'PUT') {
      puts.push({url, init});
      return new Response('', {status: 200});
    }
    const body = JSON.parse(String(init.body)) as {query: string; variables: Vars};
    const name = /\{\s*(\w+)/.exec(body.query)?.[1] ?? '';
    calls.push({name, variables: body.variables, query: body.query});
    hits[name] = (hits[name] ?? 0) + 1;
    const op = ops[name];
    const payload = typeof op === 'function' ? await (op as (v: Vars, n: number) => unknown)(body.variables, hits[name]) : (op ?? {});
    return new Response(JSON.stringify({data: {[name]: JSON.stringify(payload)}}), {status: 200});
  };
  return {calls, puts, fetchLike};
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** An unsigned JWT-shaped token — the SDK only reads `typ`/`exp` locally. */
const jwt = (claims: Record<string, unknown>) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

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
    const snap = await connectPatient(SESSION, {fetch: fetchLike}).conversation.get();
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
    const snap = await connectPatient(SESSION, {fetch: fetchLike}).conversation.get();
    assert.deepEqual(snap.timeline.map((e) => e.text), ['earlier', 'later']);
  });

  it('reports awaitingReply when the patient spoke last', async () => {
    const {fetchLike} = stub({
      embedState: {},
      embedAgentMessages: {messages: [msg('patient', 'hello?', '2026-08-19T09:00:00Z', 'a')]},
    });
    const snap = await connectPatient(SESSION, {fetch: fetchLike}).conversation.get();
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
    const snap = await connectPatient(SESSION, {fetch: fetchLike}).conversation.get();
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
    const snap = await connectPatient(SESSION, {fetch: fetchLike}).conversation.get();
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
    const snap = await connectPatient(SESSION, {fetch: fetchLike}).conversation.get();
    assert.equal(snap.timeline.at(-1)?.awaiting, 'consent');
  });

  it('surfaces a rating prompt when the platform says the consult is rateable', async () => {
    const {fetchLike} = stub({
      embedState: {consult: {id: 'c_1', type: 'async', status: 'closed', rateable: true}},
      embedAgentMessages: {messages: [msg('system', 'Your consultation has ended.', '2026-08-19T09:00:00Z', 'a')]},
    });
    const snap = await connectPatient(SESSION, {fetch: fetchLike}).conversation.get();
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
    const care = connectPatient(SESSION, {fetch: fetchLike});
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
    const care = connectPatient(SESSION, {fetch: fetchLike});
    await care.conversation.send({text: 'my message'});
    const snap = await care.conversation.get();
    assert.equal(snap.timeline.length, 1, 'exactly one copy, not the echo plus the optimistic one');
    assert.equal(snap.timeline[0].id, 'real_1');
    assert.notEqual(snap.timeline[0].pending, true);
  });

  it('refuses an empty send rather than posting nothing', async () => {
    const {fetchLike} = stub({embedState: {}, embedAgentMessages: {messages: []}});
    const care = connectPatient(SESSION, {fetch: fetchLike});
    await assert.rejects(() => care.conversation.send({text: '   '}), /needs text or an attachment/);
  });
});

describe('connectPatient — failure modes', () => {
  it('refuses a session with no connection details, with an actionable message', async () => {
    // Thrown by connectPatient itself, before any component can use it.
    assert.throws(() => connectPatient({sessionToken: 't'} as never), /did not include graphqlUrl/);
  });

  // The surface reports refusals in-band because it also drives a widget.
  // Partners get an exception, matching every other call in this package.
  it('turns an in-band {ok:false} refusal into a typed error', async () => {
    const {fetchLike} = stub({embedState: {ok: false, error: 'embed_token_expired'}});
    await assert.rejects(
      () => connectPatient(SESSION, {fetch: fetchLike}).conversation.get(),
      (e: {name?: string; code?: string}) => e.name === 'NatzarApiError' && e.code === 'embed_token_expired',
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
    const snap = await connectPatient(SESSION, {fetch: fetchLike}).conversation.get();
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
          msg('agent', 'A physician can see you now — tap the button below.\n\nhttps://us.app.natzar.ai/telehealth?id=tele_1', '2026-08-19T09:00:00Z', 'a'),
          msg('system', 'Rate your consultation: https://us.app.natzar.ai/async?id=async_1', '2026-08-19T09:01:00Z', 'b'),
          msg('agent', 'Book a time: https://us.app.natzar.ai/async?id=unknown_1', '2026-08-19T09:02:00Z', 'c'),
        ],
        linkStates: {tele_1: {kind: 'telehealth', action: 'join'}, async_1: {kind: 'async', action: 'rate'}},
      },
    });
    const snap = await connectPatient(SESSION, {fetch: fetchLike}).conversation.get();
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
          msg('system', 'Choose a time: https://us.app.natzar.ai/book?id=booked_1', '2026-08-19T09:00:00Z', 'a'),
          msg('system', 'Join when ready: https://us.app.natzar.ai/telehealth?id=tele_2', '2026-08-19T09:01:00Z', 'b'),
        ],
        linkStates: {},
      },
    });
    const snap = await connectPatient(SESSION, {fetch: fetchLike}).conversation.get();
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
    const snap = await connectPatient(SESSION, {fetch: fetchLike}).conversation.get();
    assert.equal(snap.timeline[0].link, undefined);
    assert.equal(snap.timeline[0].text, 'see https://x.test/telehealth?id=abc');
  });

  it('shapes a consult-scoped session state into the same consult snapshot', async () => {
    const {fetchLike} = stub({
      embedState: {typ: 'telehealth', consultId: 'tele_1', status: 'waiting', rated: false, rateable: false, mode: 'scheduled'},
      embedAgentMessages: {messages: []},
    });
    const snap = await connectPatient(SESSION, {fetch: fetchLike}).conversation.get();
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
    const care = connectPatient(SESSION, {fetch: fetchLike});
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
    const care = connectPatient(SESSION, {fetch: fetchLike});
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
    const care = connectPatient(SESSION, {fetch: fetchLike});
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
    const care = connectPatient(SESSION, {fetch: fetchLike});
    const file = Object.assign(new Blob([new Uint8Array([1, 2, 3])], {type: 'image/png'}), {name: 'rash.png'});
    const staged = await care.attachments.upload(file);
    assert.deepEqual(staged, {stagingKey: 'staging/g/p/abc.png', fileName: 'rash.png', mimeType: 'image/png'});

    const slot = calls.find((c) => c.name === 'embedUploadUrls')!;
    assert.equal(slot.variables.token, 'tok_1');
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
    const care = connectPatient(SESSION, {fetch: fetchLike});
    const file = Object.assign(new Blob(['x'], {type: 'application/x-msdownload'}), {name: 'setup.exe'});
    await assert.rejects(() => care.attachments.upload(file), (e: {code?: string}) => e.code === 'unsupported_type');
  });
});

describe('connectPatient — telehealth', () => {
  const teleOps = (overrides: Record<string, OpStub> = {}) =>
    stub({
      embedState: {},
      embedAgentMessages: {messages: []},
      embedAgentTelehealthSession: (_v: Vars, n: number) => ({ok: true, embedToken: `tele_${n}`, consultId: 'tele_1', mode: 'queue'}),
      embedConsultJoin: {ok: true, status: 'waiting', position: 2, estimatedMinutes: 6, rated: false},
      embedConsultLeave: {ok: true, left: true},
      embedRate: {ok: true},
      ...overrides,
    });

  it('mints the consult session once and runs every consult op on it', async () => {
    const {calls, fetchLike} = teleOps();
    const care = connectPatient(SESSION, {fetch: fetchLike});
    const session = await care.telehealth.session('tele_1');
    assert.deepEqual(session, {embedToken: 'tele_1', consultId: 'tele_1', mode: 'queue'});

    const waiting = await care.telehealth.join('tele_1');
    assert.deepEqual(waiting, {status: 'waiting', position: 2, estimatedMinutes: 6, rated: false});
    await care.telehealth.leave('tele_1');
    await care.telehealth.rate('tele_1', {communication: 5, overall: 4, feedback: 'great'});

    const mints = calls.filter((c) => c.name === 'embedAgentTelehealthSession');
    assert.equal(mints.length, 1, 'cached per consult');
    assert.equal(mints[0].variables.token, 'tok_1', 'minted from the patient session');
    assert.equal(mints[0].variables.consultId, 'tele_1');
    for (const name of ['embedConsultJoin', 'embedConsultLeave', 'embedRate']) {
      assert.equal(calls.find((c) => c.name === name)!.variables.token, 'tele_1', `${name} runs on the consult token`);
    }
    const rate = calls.find((c) => c.name === 'embedRate')!;
    assert.deepEqual(rate.variables, {token: 'tele_1', communicationRating: 5, overallPhysicianRating: 4, feedback: 'great'});
  });

  it('hands over the room grant when the call starts', async () => {
    const {fetchLike} = teleOps({
      embedConsultJoin: {ok: true, status: 'in_progress', token: 'lk_tok', url: 'wss://lk.test', roomName: 'consult-tele_1', physicianName: 'Dr. Sarah Chen MD', physicianShortName: 'Dr. Chen'},
    });
    const state = await connectPatient(SESSION, {fetch: fetchLike}).telehealth.join('tele_1');
    assert.equal(state.status, 'in_progress');
    assert.deepEqual(state.livekit, {token: 'lk_tok', url: 'wss://lk.test', roomName: 'consult-tele_1'});
    assert.equal(state.physicianShortName, 'Dr. Chen');
  });

  it('reports a status added after you shipped as `unknown`', async () => {
    const {fetchLike} = teleOps({embedConsultJoin: {ok: true, status: 'teleported'}});
    assert.equal((await connectPatient(SESSION, {fetch: fetchLike}).telehealth.join('tele_1')).status, 'unknown');
  });

  // A refused consult token is the SDK's problem, not the partner's: re-mint
  // from the (valid) patient session and retry once — without firing
  // onExpired, which is about the patient session.
  it('re-mints a refused consult token once and retries', async () => {
    let expiredCalls = 0;
    const {calls, fetchLike} = teleOps({
      embedConsultJoin: (v: Vars) => (v.token === 'tele_1' ? {ok: false, error: 'embed_token_expired'} : {ok: true, status: 'waiting', position: 1, estimatedMinutes: 3}),
    });
    const care = connectPatient(SESSION, {fetch: fetchLike, onExpired: () => expiredCalls++});
    const state = await care.telehealth.join('tele_1');
    assert.equal(state.position, 1);
    assert.equal(calls.filter((c) => c.name === 'embedAgentTelehealthSession').length, 2);
    assert.equal(calls.filter((c) => c.name === 'embedConsultJoin').at(-1)!.variables.token, 'tele_2');
    assert.equal(expiredCalls, 0);
  });

  it('honours the consult token expiry when minting', async () => {
    const soon = Math.floor(Date.now() / 1000) + 10; // inside the 30s margin → stale at once
    const {calls, fetchLike} = teleOps({
      embedAgentTelehealthSession: (_v: Vars, n: number) => ({ok: true, embedToken: jwt({typ: 'telehealth', exp: soon, n}), mode: 'queue'}),
    });
    const care = connectPatient(SESSION, {fetch: fetchLike});
    await care.telehealth.join('tele_1');
    await care.telehealth.join('tele_1');
    assert.equal(calls.filter((c) => c.name === 'embedAgentTelehealthSession').length, 2, 'a token about to expire is not reused');
  });

  it('drives the scheduled-mode surface with the schema-exact variable types', async () => {
    const appointment = {consultId: 'tele_1', startsAt: '2026-09-15T10:00:00Z', endsAt: '2026-09-15T10:20:00Z', practitionerId: 'p_1', practitionerName: 'Dr. Chen', status: 'invited', waitingRoomOpensAt: '2026-09-15T09:50:00Z', cancellableUntil: '2026-09-14T10:00:00Z', timezone: 'America/New_York'};
    const {calls, fetchLike} = teleOps({
      embedAgentTelehealthSession: {ok: true, embedToken: 'tele_s', consultId: 'tele_1', mode: 'scheduled'},
      embedBookingSlots: {ok: true, status: 'invited', slots: [{startsAt: '2026-09-15T10:00:00Z', endsAt: '2026-09-15T10:20:00Z', localDate: '2026-09-15', practitionerIds: ['p_1']}], timezone: 'America/New_York', slotMinutes: 20, appointment: null},
      embedBook: {ok: true, appointment, rescheduled: false},
      embedAppointmentBeat: {ok: true, state: {phase: 'waiting', startsAt: appointment.startsAt, otherSidePresent: false}, appointment},
      embedCancelBooking: {ok: true},
    });
    const care = connectPatient(SESSION, {fetch: fetchLike});
    assert.equal((await care.telehealth.session('tele_1')).mode, 'scheduled');

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
    assert.equal(book.variables.token, 'tele_s');

    const beat = await care.telehealth.appointmentBeat('tele_1');
    assert.equal(beat.state.phase, 'waiting');
    assert.equal(beat.livekit, undefined);
    const beatCall = calls.find((c) => c.name === 'embedAppointmentBeat')!;
    assert.equal(beatCall.variables.present, true);
    assert.match(beatCall.query, /\$present: Boolean\b/);

    await care.telehealth.appointmentBeat('tele_1', false);
    assert.equal(calls.filter((c) => c.name === 'embedAppointmentBeat').at(-1)!.variables.present, false);
    await care.telehealth.cancelBooking('tele_1');
    assert.equal(calls.find((c) => c.name === 'embedCancelBooking')!.variables.token, 'tele_s');
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
    const care = connectPatient(SESSION, {fetch: fetchLike});

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
    const care = connectPatient(SESSION, {fetch: fetchLike});
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
      () => connectPatient(SESSION, {fetch: fetchLike}).telehealth.book('tele_1', {startsAt: '2026-09-15T10:00:00Z'}),
      (e: {code?: string; details?: {slots?: unknown[]}}) => e.code === 'slot_taken' && e.details?.slots?.length === 1,
    );
  });

  it('rates a video consult from its rating entry on the consult token', async () => {
    const {calls, fetchLike} = teleOps({
      embedAgentMessages: {
        messages: [msg('system', 'Rate your call: https://us.app.natzar.ai/telehealth?id=tele_1', '2026-08-19T09:00:00Z', 'a')],
        linkStates: {tele_1: {kind: 'telehealth', action: 'rate'}},
      },
    });
    const care = connectPatient(SESSION, {fetch: fetchLike});
    const snap = await care.conversation.get();
    assert.equal(snap.timeline[0].awaiting, 'rating');
    await care.rate(snap.timeline[0], {stars: 4});
    const rate = calls.find((c) => c.name === 'embedRate')!;
    assert.deepEqual(rate.variables, {token: 'tele_1', communicationRating: 4, overallPhysicianRating: 4});
    assert.equal(calls.find((c) => c.name === 'embedAgentRate'), undefined, 'embedAgentRate would 404 on a telehealth id');
  });
});

describe('connectPatient — session kind', () => {
  it('answers consent through the thread op on a consult-scoped session', async () => {
    const {calls, fetchLike} = stub({embedAsyncConsent: {ok: true, status: 'queued'}});
    const care = connectPatient({...SESSION, sessionToken: jwt({typ: 'async', sub: 'thread_1'})}, {fetch: fetchLike});
    await care.respond({id: 'a', author: 'agent', text: '', sentAt: '', source: 'consult'}, true);
    assert.equal(calls[0].name, 'embedAsyncConsent');
    assert.equal(calls[0].variables.accept, true);
  });

  it('answers consent through the agent op on a patient session', async () => {
    const {calls, fetchLike} = stub({embedAgentConsent: {ok: true}});
    const care = connectPatient(SESSION, {fetch: fetchLike});
    await care.respond({id: 'a', author: 'agent', text: '', sentAt: '', source: 'consult'}, false);
    assert.equal(calls[0].name, 'embedAgentConsent');
    assert.equal(calls[0].variables.accept, false);
  });
});

describe('connectPatient — session expiry', () => {
  it('fires onExpired once, pauses the subscription, and resumes on refresh with the new token', async () => {
    let expiredNow = false;
    let onExpiredCalls = 0;
    const {calls, fetchLike} = stub({
      embedState: () => (expiredNow ? {ok: false, error: 'embed_token_expired'} : {}),
      embedAgentMessages: {messages: []},
      embedAgentSend: () => (expiredNow ? {ok: false, error: 'embed_token_expired'} : {ok: true}),
    });
    const care = connectPatient(SESSION, {fetch: fetchLike, intervalMs: 5, onExpired: () => onExpiredCalls++});
    const phases: string[] = [];
    const stop = care.conversation.subscribe((_s, sync) => phases.push(sync.phase), {pauseWhenHidden: false});
    await tick(30);
    const stateReads = () => calls.filter((c) => c.name === 'embedState').length;
    assert.ok(stateReads() >= 2, 'polling before expiry');

    expiredNow = true;
    // An action hitting the dead token reports it too — and still only once.
    await assert.rejects(() => care.conversation.send({text: 'x'}), (e: {code?: string}) => e.code === 'embed_token_expired');
    await tick(30);
    assert.equal(onExpiredCalls, 1);
    const parkedAt = stateReads();
    await tick(40);
    assert.equal(stateReads(), parkedAt, 'no polls while expired');
    assert.ok(!phases.includes('retrying'), 'an expired session is not a network problem');

    expiredNow = false;
    care.refresh({...SESSION, sessionToken: 'tok_2'});
    await tick(30);
    assert.ok(stateReads() > parkedAt, 'polling resumed');
    assert.equal(calls.filter((c) => c.name === 'embedState').at(-1)!.variables.token, 'tok_2');
    stop();
    assert.equal(phases.at(-1), 'stopped');
  });

  it('discards cached consult tokens on refresh', async () => {
    const {calls, fetchLike} = stub({
      embedAgentTelehealthSession: (_v: Vars, n: number) => ({ok: true, embedToken: `tele_${n}`, mode: 'queue'}),
      embedConsultJoin: {ok: true, status: 'waiting'},
    });
    const care = connectPatient(SESSION, {fetch: fetchLike});
    await care.telehealth.join('tele_1');
    care.refresh({...SESSION, sessionToken: 'tok_2'});
    await care.telehealth.join('tele_1');
    const mints = calls.filter((c) => c.name === 'embedAgentTelehealthSession');
    assert.equal(mints.length, 2);
    assert.equal(mints[1].variables.token, 'tok_2', 're-minted from the new patient session');
  });

  it('a one-shot get() while expired rejects rather than hanging', async () => {
    const {fetchLike} = stub({embedState: {ok: false, error: 'embed_token_expired'}, embedAgentMessages: {messages: []}});
    let onExpiredCalls = 0;
    const care = connectPatient(SESSION, {fetch: fetchLike, onExpired: () => onExpiredCalls++});
    await assert.rejects(() => care.conversation.get(), (e: {code?: string}) => e.code === 'embed_token_expired');
    await assert.rejects(() => care.conversation.get(), (e: {code?: string}) => e.code === 'embed_token_expired');
    assert.equal(onExpiredCalls, 1);
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
    const care = connectPatient(SESSION, {fetch: fetchLike, intervalMs: 5});
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
