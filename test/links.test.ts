// Invite links → buttons. The load-bearing case is that ONE url shape
// (`/async?id=`) carries two different intents, so the action can only come
// from the consult's state — get that wrong and a patient is asked to consent
// to a consultation that already ended.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NatzarClient,
  actionFor,
  asyncActionFor,
  detectLink,
  isActionable,
  linkIdsIn,
  resolveLinkActions,
  stripLink,
  telehealthActionFor,
} from '../dist/esm/index.js';

const ASYNC_BODY =
  'A physician can take a closer look. Tap to accept:\n\nhttps://checkup.getmyhealthchecked.com/async?id=t_1gbX-hCHDD';
const TELE_BODY = 'Your video consultation is ready: https://checkup.getmyhealthchecked.com/telehealth?id=4H1-sGULhQQi';

test('links are detected by shape, with the consult id extracted', () => {
  assert.deepEqual(detectLink(ASYNC_BODY), {kind: 'async', consultId: 't_1gbX-hCHDD'});
  assert.deepEqual(detectLink(TELE_BODY), {kind: 'telehealth', consultId: '4H1-sGULhQQi'});
  assert.equal(detectLink('no link here'), null);
});

test('white-labelled and local hosts are recognized — the shape is the marker, not the domain', () => {
  assert.deepEqual(detectLink('see https://white.label.example/async?id=abc'), {kind: 'async', consultId: 'abc'});
  assert.deepEqual(detectLink('see http://localhost:5173/telehealth?id=xyz'), {
    kind: 'telehealth',
    consultId: 'xyz',
  });
});

test('stripLink leaves readable prose, not a hole where the URL was', () => {
  assert.equal(stripLink(ASYNC_BODY), 'A physician can take a closer look. Tap to accept:');
  assert.equal(stripLink(TELE_BODY), 'Your video consultation is ready:');
  assert.equal(stripLink('nothing to strip'), 'nothing to strip');
});

test('linkIdsIn collects every referenced consult, deduplicated', () => {
  const ids = linkIdsIn([ASYNC_BODY, TELE_BODY, ASYNC_BODY]);
  assert.deepEqual(ids, {async: ['t_1gbX-hCHDD'], telehealth: ['4H1-sGULhQQi']});
});

test('the async action follows the consult state, not the URL', () => {
  const base = {id: 't_1', patientId: 'p', createdAt: '', rateable: false, origin: 'partner'} as const;
  assert.equal(asyncActionFor({...base, status: 'invited'}), 'consent');
  assert.equal(asyncActionFor({...base, status: 'queued'}), 'open');
  assert.equal(asyncActionFor({...base, status: 'active'}), 'open');
  assert.equal(asyncActionFor({...base, status: 'resolve_requested'}), 'open');
  assert.equal(asyncActionFor({...base, status: 'closed', rateable: true}), 'rate');
  assert.equal(asyncActionFor({...base, status: 'closed', rateable: false}), 'ended');
  assert.equal(
    asyncActionFor({...base, status: 'closed', rateable: false, rating: {stars: 4, ratedAt: 'now'}}),
    'rated',
  );
});

test('a declined invite offers nothing to rate', () => {
  const declined = {
    id: 't_1',
    patientId: 'p',
    createdAt: '',
    origin: 'partner',
    status: 'closed',
    closedReason: 'declined',
    rateable: false,
  } as const;
  assert.equal(asyncActionFor(declined), 'ended');
  assert.equal(isActionable(asyncActionFor(declined)), false);
});

test('the telehealth action covers the whole lifecycle including ringing', () => {
  const base = {id: 'c_1', patientId: 'p', createdAt: '', origin: 'partner'} as const;
  for (const status of ['invited', 'waiting', 'ringing', 'in_progress'] as const) {
    assert.equal(telehealthActionFor({...base, status}), 'join', status);
  }
  assert.equal(telehealthActionFor({...base, status: 'completed'}), 'rate');
  assert.equal(telehealthActionFor({...base, status: 'no_show'}), 'rate');
  assert.equal(telehealthActionFor({...base, status: 'completed', rating: {overallPhysician: 5}}), 'rated');
});

test('a lapsed invite offers nothing to join, even while the record is still "invited"', () => {
  // The record's status alone never expires an invite — the platform only
  // ever transitions it forward on a real event (join, cancel, no-show sweep).
  // `joinableUntil` is what a client has to consult, or the Join button on an
  // invite from an hour ago stays live and fails the moment it's pressed.
  const base = {id: 'c_1', patientId: 'p', createdAt: '', origin: 'partner', status: 'invited'} as const;
  const now = Date.parse('2026-08-18T12:10:00.000Z');
  const stillOpen = {...base, joinableUntil: '2026-08-18T12:15:00.000Z'};
  const justLapsed = {...base, joinableUntil: '2026-08-18T12:09:59.000Z'};
  assert.equal(telehealthActionFor(stillOpen, now), 'join');
  assert.equal(telehealthActionFor(justLapsed, now), 'ended');
  assert.equal(isActionable(telehealthActionFor(justLapsed, now)), false);
});

test('no joinableUntil means no window — partner-originated consults never expire on their own', () => {
  const base = {id: 'c_1', patientId: 'p', createdAt: '', origin: 'partner', status: 'waiting'} as const;
  assert.equal(telehealthActionFor(base, Date.parse('2099-01-01T00:00:00.000Z')), 'join');
});

test('an unparseable joinableUntil fails OPEN, matching the server rule', () => {
  const base = {
    id: 'c_1',
    patientId: 'p',
    createdAt: '',
    origin: 'partner',
    status: 'in_progress',
    joinableUntil: 'not-a-date',
  } as const;
  assert.equal(telehealthActionFor(base), 'join');
});

test('only consent/rate/join are actionable; terminal states render disabled', () => {
  assert.deepEqual(
    (['consent', 'rate', 'join', 'open', 'rated', 'ended', 'none'] as const).map(isActionable),
    [true, true, true, false, false, false, false],
  );
});

test('an unresolved async link falls back to nothing, a telehealth link to join', () => {
  assert.equal(actionFor({kind: 'async', consultId: 'gone'}, {}), 'none');
  assert.equal(actionFor({kind: 'telehealth', consultId: 'gone'}, {}), 'join');
  assert.equal(actionFor({kind: 'async', consultId: 't_1'}, {t_1: {kind: 'async', action: 'rate'}}), 'rate');
});

test('resolveLinkActions reads each referenced consult and skips ones it cannot see', async () => {
  const requested: string[] = [];
  const fetchLike = async (url: string) => {
    requested.push(url);
    if (url.includes('/async-consults/')) {
      return new Response(
        JSON.stringify({
          consult: {id: 't_1gbX-hCHDD', patientId: 'p', createdAt: '', origin: 'partner', status: 'invited', rateable: false},
        }),
        {status: 200},
      );
    }
    return new Response(JSON.stringify({error: {code: 'not_found', message: 'No such resource'}}), {status: 404});
  };
  const client = new NatzarClient({apiKey: 'pp_test_x', baseUrl: 'https://x.test/v1', fetch: fetchLike, maxRetries: 0});
  const actions = await resolveLinkActions(client, [{body: ASYNC_BODY}, {body: TELE_BODY}]);
  assert.equal(requested.length, 2);
  assert.deepEqual(actions['t_1gbX-hCHDD'], {kind: 'async', action: 'consent'});
  // The 404'd telehealth consult is simply absent — actionFor then decides.
  assert.equal(actions['4H1-sGULhQQi'], undefined);
  assert.equal(actionFor({kind: 'telehealth', consultId: '4H1-sGULhQQi'}, actions), 'join');
});
