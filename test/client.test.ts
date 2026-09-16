// The request layer: what the client puts on the wire, and how it behaves when
// the API says no. Driven through an injected fetch, so none of this touches a
// network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {NatzarClient, isErrorCode, isNatzarApiError} from '../dist/esm/index.js';

type Call = {url: string; init: RequestInit};

/** A fetch that records calls and replays a queued script of responses. */
function stubFetch(script: Array<{status: number; body?: unknown; headers?: Record<string, string>}>) {
  const calls: Call[] = [];
  const fetchLike = async (url: string, init: RequestInit) => {
    calls.push({url, init});
    const next = script.shift() ?? {status: 200, body: {}};
    return new Response(next.body === undefined ? '' : JSON.stringify(next.body), {
      status: next.status,
      headers: {'Content-Type': 'application/json', ...(next.headers ?? {})},
    });
  };
  return {calls, fetchLike};
}

const KEY = 'pp_test_abcdefghijklmnop';

test('the key rides as a bearer token and the path is built from the base URL', async () => {
  const {calls, fetchLike} = stubFetch([{status: 200, body: {items: []}}]);
  const client = new NatzarClient({apiKey: KEY, baseUrl: 'https://x.test/v1', fetch: fetchLike});
  await client.patients.list({limit: 10});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://x.test/v1/patients?limit=10');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
  assert.equal(calls[0].init.method, 'GET');
});

test('undefined query values are dropped rather than sent as the string "undefined"', async () => {
  const {calls, fetchLike} = stubFetch([{status: 200, body: {items: [], hasMore: false}}]);
  const client = new NatzarClient({apiKey: KEY, baseUrl: 'https://x.test/v1', fetch: fetchLike});
  await client.agent.messages({externalPatientId: 'u_1', cursor: undefined});
  assert.equal(calls[0].url, 'https://x.test/v1/agent/messages?externalPatientId=u_1');
});

test('path parameters are URL-encoded', async () => {
  const {calls, fetchLike} = stubFetch([{status: 200, body: {consult: {}}}]);
  const client = new NatzarClient({apiKey: KEY, baseUrl: 'https://x.test/v1', fetch: fetchLike});
  await client.asyncConsults.get('a/b c');
  assert.equal(calls[0].url, 'https://x.test/v1/async-consults/a%2Fb%20c');
});

test('a 409 becomes a typed error carrying the contract code and details', async () => {
  const {fetchLike} = stubFetch([
    {
      status: 409,
      body: {error: {code: 'has_open_thread', message: 'Patient already has an open async consult', details: {asyncConsultId: 't_9'}}},
    },
  ]);
  const client = new NatzarClient({apiKey: KEY, baseUrl: 'https://x.test/v1', fetch: fetchLike, maxRetries: 0});
  await assert.rejects(
    () => client.asyncConsults.create({externalPatientId: 'u_1', consent: 'collected'}),
    (e: unknown) => {
      assert.ok(isNatzarApiError(e));
      assert.ok(isErrorCode(e, 'has_open_thread'));
      assert.equal(e.status, 409);
      assert.equal(e.route, 'POST /async-consults');
      assert.deepEqual(e.details, {asyncConsultId: 't_9'});
      return true;
    },
  );
});

test('a non-JSON error body still produces a code, inferred from the status', async () => {
  const fetchLike = async () => new Response('<html>gateway</html>', {status: 502});
  const client = new NatzarClient({apiKey: KEY, baseUrl: 'https://x.test/v1', fetch: fetchLike, maxRetries: 0});
  await assert.rejects(
    () => client.patients.get('p_1'),
    (e: unknown) => isNatzarApiError(e) && e.code === 'internal_error' && e.rawBody?.includes('gateway') === true,
  );
});

test('a 5xx on a GET is retried, then succeeds', async () => {
  const {calls, fetchLike} = stubFetch([
    {status: 500, body: {error: {code: 'internal_error', message: 'boom'}}},
    {status: 200, body: {patient: {id: 'p_1'}}},
  ]);
  const client = new NatzarClient({apiKey: KEY, baseUrl: 'https://x.test/v1', fetch: fetchLike, retryBaseMs: 1});
  const {patient} = await client.patients.get('p_1');
  assert.equal(patient.id, 'p_1');
  assert.equal(calls.length, 2);
});

test('a 409 is NOT retried — a conflict is an answer, not a fault', async () => {
  const {calls, fetchLike} = stubFetch([
    {status: 409, body: {error: {code: 'already_closed', message: 'closed'}}},
    {status: 200, body: {consult: {}}},
  ]);
  const client = new NatzarClient({apiKey: KEY, baseUrl: 'https://x.test/v1', fetch: fetchLike, retryBaseMs: 1});
  await assert.rejects(() => client.asyncConsults.close('t_1'));
  assert.equal(calls.length, 1);
});

test('a non-idempotent lifecycle POST is not replayed after a 500', async () => {
  const {calls, fetchLike} = stubFetch([
    {status: 500, body: {error: {code: 'internal_error', message: 'boom'}}},
    {status: 200, body: {consult: {}}},
  ]);
  const client = new NatzarClient({apiKey: KEY, baseUrl: 'https://x.test/v1', fetch: fetchLike, retryBaseMs: 1});
  await assert.rejects(() => client.asyncConsults.resolve('t_1', {physicianId: 'd_1'}));
  assert.equal(calls.length, 1, 'resolve must not be re-applied blindly');
});

// A message POST is only safe to replay when the CALLER pinned an
// idempotencyKey — the platform dedupes delivery on it. This test used to
// assert the opposite (blanket retry) on the assumption that the server
// deduplicated on its own. It does not: it mints a fresh dedup id per request,
// so the retry armed here would have put the same clinical message on a
// patient's transcript twice.
test('a message POST is NOT retried without an idempotency key', async () => {
  const {calls, fetchLike} = stubFetch([
    {status: 500, body: {error: {code: 'internal_error', message: 'boom'}}},
    {status: 202, body: {accepted: true, messageId: 'm_1'}},
  ]);
  const client = new NatzarClient({apiKey: KEY, baseUrl: 'https://x.test/v1', fetch: fetchLike, retryBaseMs: 1});
  await assert.rejects(() => client.agent.send({externalPatientId: 'u_1', text: 'hi'}));
  assert.equal(calls.length, 1, 'a message must never be delivered twice by a retry');
});

test('a message POST IS retried when an idempotency key makes it safe', async () => {
  const {calls, fetchLike} = stubFetch([
    {status: 500, body: {error: {code: 'internal_error', message: 'boom'}}},
    {status: 202, body: {accepted: true, messageId: 'm_1'}},
  ]);
  const client = new NatzarClient({apiKey: KEY, baseUrl: 'https://x.test/v1', fetch: fetchLike, retryBaseMs: 1});
  const res = await client.agent.send({externalPatientId: 'u_1', text: 'hi', idempotencyKey: 'k-1'});
  assert.equal(res.messageId, 'm_1');
  assert.equal(calls.length, 2);
});

test('an empty 202 body is a success, not a parse error', async () => {
  const fetchLike = async () => new Response('', {status: 202});
  const client = new NatzarClient({apiKey: KEY, baseUrl: 'https://x.test/v1', fetch: fetchLike});
  assert.deepEqual(await client.physicians.sendPortalInvite('d_1'), {});
});

test('a browser-unsafe key is refused at construction, before any request', () => {
  assert.throws(() => new NatzarClient({apiKey: ''}), /partner key/);
  assert.throws(() => new NatzarClient({apiKey: '<value will be resolved during deployment>'}), /did not resolve/);
});

test('a trailing newline on a key from a secret store is trimmed, not sent', async () => {
  const {calls, fetchLike} = stubFetch([{status: 200, body: {items: []}}]);
  const client = new NatzarClient({apiKey: `${KEY}\n`, baseUrl: 'https://x.test/v1', fetch: fetchLike});
  await client.patients.list();
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
});

test('onResponse observes every attempt', async () => {
  const seen: number[] = [];
  const {fetchLike} = stubFetch([
    {status: 429, body: {error: {code: 'rate_limited', message: 'slow down'}}},
    {status: 200, body: {items: []}},
  ]);
  const client = new NatzarClient({
    apiKey: KEY,
    baseUrl: 'https://x.test/v1',
    fetch: fetchLike,
    retryBaseMs: 1,
    onResponse: ({status}) => seen.push(status),
  });
  await client.events.list();
  assert.deepEqual(seen, [429, 200]);
});

// --- physician credentials ---------------------------------------------------

/** An unsigned JWT-shaped token — the client only checks the SHAPE locally. */
const SESSION_TOKEN = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({typ: 'physician', sub: 'd_1'})).toString('base64url')}.sig`;

test('physicianId rides as X-Natzar-Physician-Id, on every verb', async () => {
  const {calls, fetchLike} = stubFetch([
    {status: 202, body: {accepted: true, messageId: 'm_1'}},
    {status: 200, body: {patient: {id: 'p_1'}}},
    {status: 200, body: {physicianId: 'd_1', rules: [], exceptions: []}},
    {status: 200, body: {physician: {id: 'd_1'}}},
  ]);
  const client = new NatzarClient({apiKey: KEY, baseUrl: 'https://x.test/v1', fetch: fetchLike});
  await client.asyncConsults.postReply('t_1', {text: 'hi'}, {physicianId: 'd_1'});
  await client.patients.update('p_1', {givenName: 'Ada'}, {physicianId: 'd_1'});
  await client.schedules.replace('d_1', {rules: [], exceptions: []}, {physicianId: 'd_1'});
  await client.physicians.me({physicianId: 'd_1', physicianToken: 'id.token.here'});
  for (const call of calls) {
    assert.equal((call.init.headers as Record<string, string>)['X-Natzar-Physician-Id'], 'd_1', `${call.init.method} ${call.url}`);
  }
  assert.deepEqual(['POST', 'PATCH', 'PUT', 'GET'], calls.map((c) => c.init.method));
  const both = calls[3].init.headers as Record<string, string>;
  assert.equal(both['X-Natzar-Physician'], 'id.token.here', 'both credentials may be sent; the server takes the strongest');
});

test('no physician header is sent when no physician option is given', async () => {
  const {calls, fetchLike} = stubFetch([{status: 200, body: {items: []}}]);
  const client = new NatzarClient({apiKey: KEY, baseUrl: 'https://x.test/v1', fetch: fetchLike});
  await client.patients.list();
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal('X-Natzar-Physician' in headers, false);
  assert.equal('X-Natzar-Physician-Id' in headers, false);
});

test('a session token is a bearer credential in its own right', async () => {
  const {calls, fetchLike} = stubFetch([{status: 200, body: {physician: {id: 'd_1'}}}]);
  const client = new NatzarClient({sessionToken: SESSION_TOKEN, baseUrl: 'https://x.test/v1', fetch: fetchLike});
  assert.equal(client.credential, 'sessionToken');
  await client.physicians.workspace('me');
  assert.equal(calls[0].url, 'https://x.test/v1/physicians/me/workspace');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, `Bearer ${SESSION_TOKEN}`);
  assert.equal(new NatzarClient({apiKey: KEY, baseUrl: 'https://x.test/v1'}).credential, 'apiKey');
});

test('the two credentials are checked for the slot they were passed in, and never both', () => {
  assert.throws(() => new NatzarClient({apiKey: KEY, sessionToken: SESSION_TOKEN}), /EITHER apiKey .* OR sessionToken/);
  // A swap is the likeliest wiring mistake, so each message names the other slot.
  assert.throws(() => new NatzarClient({sessionToken: KEY}), (e: Error) => /partner key/.test(e.message) && /apiKey/.test(e.message));
  assert.throws(() => new NatzarClient({apiKey: SESSION_TOKEN}), (e: Error) => /session token/.test(e.message) && /sessionToken/.test(e.message));
  assert.throws(() => new NatzarClient({sessionToken: 'not-a-jwt'}), /three-segment JWT/);
  assert.throws(() => new NatzarClient({}), /partner key/);
});

test('a bare 403 is `forbidden` — a session on a route outside its allowlist', async () => {
  const fetchLike = async () => new Response('{"message":"Forbidden"}', {status: 403});
  const client = new NatzarClient({sessionToken: SESSION_TOKEN, baseUrl: 'https://x.test/v1', fetch: fetchLike});
  await assert.rejects(
    () => client.physicians.session('me'),
    (e: unknown) => isNatzarApiError(e) && e.code === 'forbidden' && e.status === 403,
  );
});

// --- physician routes --------------------------------------------------------

test('the physician-side routes hit their paths with the documented bodies', async () => {
  const {calls, fetchLike} = stubFetch([
    {status: 200, body: {sessionToken: 't', expiresAt: 'x', apiUrl: 'https://x.test/v1', physician: {}}},
    {status: 200, body: {presence: {status: 'ready'}, activeConsult: null}},
    {status: 200, body: {presence: {status: 'ready'}, activeConsult: null}},
    {status: 200, body: {appointments: []}},
    {status: 200, body: {physician: {}}},
    {status: 200, body: {specialties: []}},
    {status: 200, body: {physician: {}}},
    {status: 200, body: {status: 'ringing', consult: {}}},
    {status: 200, body: {state: {phase: 'waiting'}}},
    {status: 200, body: {consult: {}}},
  ]);
  const client = new NatzarClient({apiKey: KEY, baseUrl: 'https://x.test/v1', fetch: fetchLike});
  await client.physicians.session('d_1', {ttlSeconds: 600}, {physicianId: 'd_1'});
  await client.physicians.presence('me', {ready: true});
  await client.physicians.heartbeat('me');
  await client.physicians.agenda('me', {from: '2026-08-19T00:00:00Z'});
  await client.physicians.setSpecialties('me', {specialties: ['derm']});
  await client.specialties.list();
  await client.physicians.setLanguages('me', {languages: ['en', 'fr']});
  await client.telehealth.room('tele_1');
  await client.telehealth.ready('tele_1', {present: true});
  await client.telehealth.cancel('tele_1', {reason: 'Running late'});
  const wire = calls.map((c) => `${c.init.method} ${c.url.replace('https://x.test/v1', '')} ${c.init.body ?? ''}`);
  assert.deepEqual(wire, [
    'POST /physicians/d_1/session {"ttlSeconds":600}',
    'POST /physicians/me/presence {"ready":true}',
    'POST /physicians/me/heartbeat {}',
    'GET /physicians/me/agenda?from=2026-08-19T00%3A00%3A00Z ',
    'PUT /physicians/me/specialties {"specialties":["derm"]}',
    'GET /specialties ',
    'PUT /physicians/me/languages {"languages":["en","fr"]}',
    'POST /telehealth-consults/tele_1/room {}',
    'POST /telehealth-consults/tele_1/ready {"present":true}',
    'POST /telehealth-consults/tele_1/cancel {"reason":"Running late"}',
  ]);
});

// `end` is the one lifecycle post the server guards against replay (a repeat
// on an ended consult returns it unchanged), so a transport fault may re-issue
// it; `escalate` is a conditional write whose repeat is a 409 the caller must
// see, so it is not.
test('end is replayed after a 500 while escalate is not', async () => {
  const ended = stubFetch([
    {status: 500, body: {error: {code: 'internal_error', message: 'boom'}}},
    {status: 200, body: {consult: {status: 'completed'}, next: null}},
  ]);
  const client = new NatzarClient({apiKey: KEY, baseUrl: 'https://x.test/v1', fetch: ended.fetchLike, retryBaseMs: 1});
  const res = await client.telehealth.end('tele_1', {goOffline: true});
  assert.equal(res.next, null);
  assert.equal(ended.calls.length, 2);
  assert.equal(ended.calls[1].init.body, '{"goOffline":true}');

  const escalated = stubFetch([
    {status: 500, body: {error: {code: 'internal_error', message: 'boom'}}},
    {status: 200, body: {consult: {}, telehealthConsultId: 'tele_1'}},
  ]);
  const client2 = new NatzarClient({apiKey: KEY, baseUrl: 'https://x.test/v1', fetch: escalated.fetchLike, retryBaseMs: 1});
  await assert.rejects(() => client2.asyncConsults.escalate('t_1'));
  assert.equal(escalated.calls.length, 1, 'escalate must not be re-applied blindly');
});

test('the schedule routes: a range read, a change-set PATCH and a whole-rota PUT', async () => {
  const {calls, fetchLike} = stubFetch([
    {status: 200, body: {physicianId: 'd_1', rules: [], exceptions: [], days: []}},
    {status: 200, body: {physicianId: 'd_1', rules: [], exceptions: [], days: []}},
    {status: 200, body: {physicianId: 'd_1', rules: [], exceptions: [], days: []}},
  ]);
  const client = new NatzarClient({apiKey: KEY, baseUrl: 'https://x.test/v1', fetch: fetchLike});
  await client.schedules.get('me', {from: '2026-09-01', to: '2026-10-31'});
  await client.schedules.update(
    'me',
    {exceptions: [{date: '2026-09-14', kind: 'block', reason: 'Conference'}], deletedRuleIds: ['r_9']},
    undefined,
    {from: '2026-09-01', to: '2026-09-30'},
  );
  await client.schedules.replace('d_1', {rules: [{weekday: 1, startMinute: 540, endMinute: 720, intervalWeeks: 2, effectiveFrom: '2026-09-07'}], exceptions: []});
  assert.deepEqual(
    calls.map((c) => [c.init.method, c.url]),
    [
      ['GET', 'https://x.test/v1/physicians/me/schedule?from=2026-09-01&to=2026-10-31'],
      ['PATCH', 'https://x.test/v1/physicians/me/schedule?from=2026-09-01&to=2026-09-30'],
      ['PUT', 'https://x.test/v1/physicians/d_1/schedule'],
    ],
  );
  assert.deepEqual(JSON.parse(calls[1].init.body as string), {
    exceptions: [{date: '2026-09-14', kind: 'block', reason: 'Conference'}],
    deletedRuleIds: ['r_9'],
  });
});

test('the physician calendar zone rides on the schedule routes: set with a string, cleared with null', async () => {
  const {calls, fetchLike} = stubFetch([
    {status: 200, body: {physicianId: 'd_1', rules: [], exceptions: [], days: [], timezone: 'America/Los_Angeles', clinicTimezone: 'Europe/Zurich', schedulingTimezone: 'America/Los_Angeles', upcomingAppointments: 3}},
    {status: 200, body: {physicianId: 'd_1', rules: [], exceptions: [], days: [], timezone: 'Europe/Zurich', clinicTimezone: 'Europe/Zurich', schedulingTimezone: null, upcomingAppointments: 3}},
    {status: 200, body: {physicianId: 'd_1', rules: [], exceptions: [], days: [], timezone: 'Asia/Tokyo', clinicTimezone: 'Europe/Zurich', schedulingTimezone: 'Asia/Tokyo', upcomingAppointments: 0}},
  ]);
  const client = new NatzarClient({apiKey: KEY, baseUrl: 'https://x.test/v1', fetch: fetchLike});
  // A zone-only save is a valid change set: nothing else on the calendar moves.
  const moved = await client.schedules.update('me', {timezone: 'America/Los_Angeles'});
  assert.equal(moved.timezone, 'America/Los_Angeles');
  assert.equal(moved.schedulingTimezone, 'America/Los_Angeles');
  assert.equal(moved.upcomingAppointments, 3);
  const cleared = await client.schedules.update('me', {timezone: null});
  assert.equal(cleared.schedulingTimezone, null);
  assert.equal(cleared.timezone, cleared.clinicTimezone, 'back on the clinic zone');
  await client.schedules.replace('d_1', {rules: [{weekday: 1, startMinute: 540, endMinute: 720}], timezone: 'Asia/Tokyo'});
  assert.deepEqual(
    calls.map((c) => JSON.parse(c.init.body as string)),
    [{timezone: 'America/Los_Angeles'}, {timezone: null}, {rules: [{weekday: 1, startMinute: 540, endMinute: 720}], timezone: 'Asia/Tokyo'}],
  );
});

test('the contract ships the zone helpers every picker needs, and the new codes', async () => {
  const contract = await import('../dist/esm/contract/index.js');
  assert.equal(contract.isKnownTimeZone('Europe/Zurich'), true);
  assert.equal(contract.isKnownTimeZone('Mars/Olympus'), false);
  assert.equal(contract.listTimeZoneIds().includes('UTC'), true);
  assert.equal(typeof contract.deviceTimeZone(), 'string');
  const june = new Date('2026-06-16T12:00:00Z');
  assert.equal(contract.describeTimeZone('Europe/Zurich', june, 'en').offsetLabel, 'UTC+02:00');
  assert.equal(contract.describeOffsetDifference(contract.offsetDifferenceMinutes('Europe/Zurich', 'America/Los_Angeles', june), 'fr'), '9 h d’avance');
  assert.equal(contract.httpStatusFor('too_many_open_bookings'), 409);
  assert.match(contract.SCHEDULE_PROBLEM_MESSAGES.rule_zone_mismatch, /calendar zone/);
  assert.equal(contract.ianaZoneSchema.safeParse('+02:00').success, false);
  assert.equal(contract.updatePhysicianScheduleSchema.safeParse({timezone: null}).success, true);
  assert.equal(contract.bookTelehealthConsultSchema.safeParse({startsAt: '2026-09-15T10:00:00Z', patientTimezone: 'Asia/Tokyo'}).success, true);
});

test('the contract ships the schedule engine the platform runs', async () => {
  const {resolveDays, closeWindow, diffSchedule} = await import('../dist/esm/contract/index.js');
  const loaded = {rules: [{id: 'r1', weekday: 1, startMinute: 540, endMinute: 720}], exceptions: []};
  // 2026-09-07 is a Monday.
  const draft = closeWindow(loaded, {date: '2026-09-07', start: 600, end: 660});
  assert.deepEqual(resolveDays(draft, '2026-09-07', '2026-09-07')[0].intervals, [
    {start: 540, end: 600, specialty: null},
    {start: 660, end: 720, specialty: null},
  ]);
  const change = diffSchedule(loaded, draft);
  assert.equal(change.rules.length, 0, 'a day edit never touches the rules');
  assert.equal(change.exceptions.length, 1);
  assert.equal(change.exceptions[0].kind, 'block');
});
