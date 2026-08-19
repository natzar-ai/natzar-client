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

/** Stubs the AppSync endpoint, answering each op from `ops`. */
function stub(ops: Record<string, unknown>) {
  const calls: Array<{name: string; variables: Record<string, unknown>}> = [];
  const fetchLike = async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {query: string; variables: Record<string, unknown>};
    const name = /\{\s*(\w+)/.exec(body.query)?.[1] ?? '';
    calls.push({name, variables: body.variables});
    return new Response(JSON.stringify({data: {[name]: JSON.stringify(ops[name] ?? {})}}), {status: 200});
  };
  return {calls, fetchLike};
}

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
