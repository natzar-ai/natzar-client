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
  bookActionFor,
  detectLink,
  isActionable,
  linkIdsIn,
  pharmacyActionFor,
  referralActionFor,
  resolveLinkActions,
  stripLink,
  telehealthActionFor,
} from '../dist/esm/index.js';
import {REFERRAL_LINK_VALIDITY_SENTENCES} from '../dist/esm/contract/index.js';

const ASYNC_BODY =
  'A physician can take a closer look. Tap to accept:\n\nhttps://checkup.getmyhealthchecked.com/async?id=t_1gbX-hCHDD';
const TELE_BODY = 'Your video consultation is ready: https://checkup.getmyhealthchecked.com/telehealth?id=4H1-sGULhQQi';
const BOOK_BODY = 'Choose a time for your appointment:\n\nhttps://us.app.natzar.ai/book?id=sch_9';
const RX_BODY =
  'Dr. Chen sent you a prescription. Choose your pharmacy below.\n\nhttps://ca.app.natzar.ai/pharmacy?id=rx_Ab12-cD\n\nThis link is active for the next 24 hours.';
const REF_BODY =
  'Dr. Chen has sent you a referral for laboratory tests. Simply show it or hand it to the laboratory — they will take it from there. Tap to view your referral: https://ca.app.natzar.ai/referral?id=ref_Zz9-Qq\n\nThis link is active for the next 30 days.';

test('links are detected by shape, with the consult id extracted', () => {
  assert.deepEqual(detectLink(ASYNC_BODY), {kind: 'async', consultId: 't_1gbX-hCHDD'});
  assert.deepEqual(detectLink(TELE_BODY), {kind: 'telehealth', consultId: '4H1-sGULhQQi'});
  assert.deepEqual(detectLink(BOOK_BODY), {kind: 'book', consultId: 'sch_9'});
  assert.equal(detectLink('no link here'), null);
});

test('a pharmacy link is detected with the PRESCRIPTION id in the same field', () => {
  // One field for every kind: a card hands `consultId` to the matching call
  // (`client.prescriptions.get`) without a switch on the kind.
  assert.deepEqual(detectLink(RX_BODY), {kind: 'pharmacy', consultId: 'rx_Ab12-cD'});
});

test('a referral link is detected with the REFERRAL id in the same field', () => {
  assert.deepEqual(detectLink(REF_BODY), {kind: 'referral', consultId: 'ref_Zz9-Qq'});
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
  assert.equal(stripLink(BOOK_BODY), 'Choose a time for your appointment:');
  assert.equal(
    stripLink(RX_BODY),
    'Dr. Chen sent you a prescription. Choose your pharmacy below.\n\nThis link is active for the next 24 hours.',
  );
  assert.equal(stripLink('nothing to strip'), 'nothing to strip');
});

test('stripLink drops the 30-day sentence from a referral notice — in every language — and only there', () => {
  // The sentence describes the anonymous web link; the document read over
  // the API has no window, so it must not survive into the card.
  assert.equal(
    stripLink(REF_BODY),
    'Dr. Chen has sent you a referral for laboratory tests. Simply show it or hand it to the laboratory — they will take it from there. Tap to view your referral:',
  );
  assert.equal(REFERRAL_LINK_VALIDITY_SENTENCES.length, 5);
  for (const sentence of REFERRAL_LINK_VALIDITY_SENTENCES) {
    assert.equal(stripLink(`Lead-in: https://x.test/referral?id=r_1\n\n${sentence}`), 'Lead-in:', sentence);
  }
  // A prescription keeps its 24-hour sentence (that link does expire), and
  // prose that merely contains the words is not touched.
  assert.ok(stripLink(RX_BODY).endsWith('This link is active for the next 24 hours.'));
  const prose = `FYI: ${REFERRAL_LINK_VALIDITY_SENTENCES[0]}`;
  assert.equal(stripLink(prose), prose);
});

test('linkIdsIn collects every referenced consult, prescription and referral, deduplicated', () => {
  const ids = linkIdsIn([ASYNC_BODY, TELE_BODY, ASYNC_BODY, BOOK_BODY, RX_BODY, RX_BODY, REF_BODY]);
  assert.deepEqual(ids, {
    async: ['t_1gbX-hCHDD'],
    telehealth: ['4H1-sGULhQQi'],
    book: ['sch_9'],
    pharmacy: ['rx_Ab12-cD'],
    referral: ['ref_Zz9-Qq'],
  });
});

test('the async action follows the consult state, not the URL', () => {
  const base = {id: 't_1', patientId: 'p', kind: 'conversation', createdAt: '', rateable: false, overdue: false, origin: 'partner'} as const;
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
    kind: 'conversation',
    createdAt: '',
    origin: 'partner',
    status: 'closed',
    closedReason: 'declined',
    rateable: false,
    overdue: false,
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

test('a booking link stays `book` while the consult is open and dies with it', () => {
  const base = {id: 'c_1', patientId: 'p', createdAt: '', origin: 'partner', mode: 'scheduled'} as const;
  for (const status of ['invited', 'scheduled', 'waiting', 'ringing', 'in_progress'] as const) {
    assert.equal(bookActionFor({...base, status}), 'book', status);
  }
  assert.equal(bookActionFor({...base, status: 'completed'}), 'rate');
  assert.equal(bookActionFor({...base, status: 'no_show'}), 'rate');
  assert.equal(bookActionFor({...base, status: 'completed', rating: {overallPhysician: 5}}), 'rated');
  // A cancelled appointment was never a call: nothing to rate, nothing to book.
  assert.equal(bookActionFor({...base, status: 'cancelled'}), 'ended');
});

test('the pharmacy action follows the effective status: only a waiting prescription is choosable', () => {
  const base = {id: 'rx_1', externalPatientId: 'u_1', consultId: 't_1', transport: 'fax', pharmacyName: null, createdAt: ''} as const;
  const open = {expired: false, expiresAt: '2026-09-19T09:00:00.000Z'} as const;
  // Pinned: the window is judged against the clock passed in, and a wall
  // clock past `expiresAt` would turn a "choosable" fixture into an expired one.
  const now = Date.parse('2026-09-18T12:00:00.000Z');
  assert.equal(pharmacyActionFor({...base, ...open, status: 'awaiting_pharmacy', action: 'choose'}, now), 'choose');
  assert.equal(pharmacyActionFor({...base, ...open, status: 'failed', action: 'choose'}, now), 'choose', 'a failed transmit waits for another pharmacy');
  assert.equal(pharmacyActionFor({...base, ...open, status: 'transmitting', action: 'sent', pharmacyName: 'Main St'}), 'sent');
  assert.equal(pharmacyActionFor({...base, ...open, status: 'sent', action: 'sent', pharmacyName: 'Main St'}), 'sent');
  assert.equal(pharmacyActionFor({...base, ...open, status: 'revoked', action: 'revoked'}), 'revoked');
  assert.equal(pharmacyActionFor({...base, status: 'expired', expired: true, expiresAt: null, action: 'expired'}), 'expired');
  assert.equal(pharmacyActionFor({...base, status: 'awaiting_pharmacy', expired: true, expiresAt: '2026-09-17T09:00:00.000Z', action: 'expired'}), 'expired');
});

test('the pharmacy link expires by the clock, so a card can run its own countdown', () => {
  // The platform stamps `expired` at read time; a client holding the resource
  // for a while must not keep offering a picker the server will refuse.
  const rx = {
    id: 'rx_1',
    externalPatientId: 'u_1',
    consultId: 't_1',
    status: 'awaiting_pharmacy',
    expired: false,
    expiresAt: '2026-09-19T09:00:00.000Z',
    transport: 'erx',
    pharmacyName: null,
    action: 'choose',
    createdAt: '',
  } as const;
  assert.equal(pharmacyActionFor(rx, Date.parse('2026-09-19T08:59:59.000Z')), 'choose');
  assert.equal(pharmacyActionFor(rx, Date.parse('2026-09-19T09:00:00.000Z')), 'expired');
  // No window on the resource never expires — the platform's own rule.
  assert.equal(pharmacyActionFor({...rx, expiresAt: null}, Date.parse('2099-01-01T00:00:00.000Z')), 'choose');
  // A chosen prescription's clock means nothing any more.
  assert.equal(pharmacyActionFor({...rx, status: 'sent', pharmacyName: 'Main St'}, Date.parse('2099-01-01T00:00:00.000Z')), 'sent');
});

test('the referral action follows the status: `view` while issued, `revoked` once withdrawn — never by the clock', () => {
  const base = {
    id: 'ref_1',
    externalPatientId: 'u_1',
    consultId: 't_1',
    kind: 'laboratory',
    title: 'Laboratory requisition',
    physicianName: 'Dr. Sarah Chen',
    issuedAt: '2026-09-22T09:00:00.000Z',
    createdAt: '2026-09-22T09:00:00.000Z',
  } as const;
  const doc = {url: 'https://s3.test/x.pdf', expiresAt: '2026-09-22T09:05:00.000Z', fileName: 'Laboratory-requisition-ref_1.pdf', contentType: 'application/pdf'} as const;
  assert.equal(referralActionFor({...base, status: 'issued', action: 'view', revokedAt: null, document: doc}), 'view');
  assert.equal(referralActionFor({...base, status: 'revoked', action: 'revoked', revokedAt: '2026-09-23T09:00:00.000Z', document: null}), 'revoked');
});

test('only consent/rate/join/book/choose/view are actionable; terminal states render disabled', () => {
  assert.deepEqual(
    (['consent', 'rate', 'join', 'book', 'choose', 'view', 'open', 'rated', 'ended', 'sent', 'expired', 'revoked', 'none'] as const).map(isActionable),
    [true, true, true, true, true, true, false, false, false, false, false, false, false],
  );
});

test('an unresolved async link falls back to nothing; telehealth, booking, pharmacy and referral links to their tap', () => {
  assert.equal(actionFor({kind: 'async', consultId: 'gone'}, {}), 'none');
  assert.equal(actionFor({kind: 'telehealth', consultId: 'gone'}, {}), 'join');
  assert.equal(actionFor({kind: 'book', consultId: 'gone'}, {}), 'book');
  assert.equal(actionFor({kind: 'pharmacy', consultId: 'gone'}, {}), 'choose');
  assert.equal(actionFor({kind: 'referral', consultId: 'gone'}, {}), 'view');
  assert.equal(actionFor({kind: 'referral', consultId: 'ref_1'}, {ref_1: {kind: 'referral', action: 'revoked', title: 'Laboratory requisition'}}), 'revoked');
  assert.equal(actionFor({kind: 'async', consultId: 't_1'}, {t_1: {kind: 'async', action: 'rate'}}), 'rate');
  assert.equal(actionFor({kind: 'pharmacy', consultId: 'rx_1'}, {rx_1: {kind: 'pharmacy', action: 'sent', pharmacyName: 'Main St'}}), 'sent');
});

test('resolveLinkActions reads each referenced consult and skips ones it cannot see', async () => {
  const requested: string[] = [];
  const fetchLike = async (url: string) => {
    requested.push(url);
    if (url.includes('/async-consults/')) {
      return new Response(
        JSON.stringify({
          consult: {id: 't_1gbX-hCHDD', patientId: 'p', createdAt: '', origin: 'partner', kind: 'conversation', status: 'invited', rateable: false},
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

test('resolveLinkActions reads a prescription for a pharmacy link and carries the pharmacy name', async () => {
  const requested: string[] = [];
  const fetchLike = async (url: string) => {
    requested.push(url);
    if (url.endsWith('/prescriptions/rx_Ab12-cD')) {
      return new Response(
        JSON.stringify({
          prescription: {
            id: 'rx_Ab12-cD',
            externalPatientId: 'u_1',
            consultId: 't_1',
            status: 'sent',
            expired: false,
            expiresAt: '2026-09-19T09:00:00.000Z',
            transport: 'fax',
            pharmacyName: 'Main St Pharmacy',
            action: 'sent',
            createdAt: '2026-09-18T09:00:00.000Z',
          },
        }),
        {status: 200},
      );
    }
    if (url.includes('/telehealth-consults/sch_9')) {
      return new Response(
        JSON.stringify({consult: {id: 'sch_9', patientId: 'p', createdAt: '', origin: 'partner', status: 'scheduled', mode: 'scheduled'}}),
        {status: 200},
      );
    }
    return new Response(JSON.stringify({error: {code: 'not_found', message: 'No such resource'}}), {status: 404});
  };
  const client = new NatzarClient({apiKey: 'pp_test_x', baseUrl: 'https://x.test/v1', fetch: fetchLike, maxRetries: 0});
  const actions = await resolveLinkActions(client, [{body: RX_BODY}, {body: BOOK_BODY}]);
  assert.equal(requested.length, 2);
  assert.deepEqual(actions['rx_Ab12-cD'], {kind: 'pharmacy', action: 'sent', pharmacyName: 'Main St Pharmacy'});
  assert.deepEqual(actions['sch_9'], {kind: 'book', action: 'book'});
});

test('resolveLinkActions reads a referral for a referral link, keeps the title and drops the document URL', async () => {
  const requested: string[] = [];
  const fetchLike = async (url: string) => {
    requested.push(url);
    if (url.endsWith('/referrals/ref_Zz9-Qq')) {
      return new Response(
        JSON.stringify({
          referral: {
            id: 'ref_Zz9-Qq',
            externalPatientId: 'u_1',
            consultId: 't_1',
            kind: 'laboratory',
            status: 'issued',
            action: 'view',
            title: 'Laboratory requisition',
            physicianName: 'Dr. Sarah Chen',
            issuedAt: '2026-09-22T09:00:00.000Z',
            revokedAt: null,
            createdAt: '2026-09-22T09:00:00.000Z',
            document: {url: 'https://s3.test/x.pdf', expiresAt: '2026-09-22T09:05:00.000Z', fileName: 'Laboratory-requisition-ref_Zz9-Qq.pdf', contentType: 'application/pdf'},
          },
        }),
        {status: 200},
      );
    }
    return new Response(JSON.stringify({error: {code: 'not_found', message: 'No such resource'}}), {status: 404});
  };
  const client = new NatzarClient({apiKey: 'pp_test_x', baseUrl: 'https://x.test/v1', fetch: fetchLike, maxRetries: 0});
  const actions = await resolveLinkActions(client, [{body: REF_BODY}]);
  assert.equal(requested.length, 1);
  // The URL minted by that read expires in minutes — a card `get`s again on
  // the tap, so the resolved state carries the title and nothing to open.
  assert.deepEqual(actions['ref_Zz9-Qq'], {kind: 'referral', action: 'view', title: 'Laboratory requisition'});
});

test('resolveLinkActions on a physician session keeps the consult buttons when the prescription read is forbidden', async () => {
  // The prescription routes are patient-side, tenant-key only, so a
  // physician session (which CAN read the consults) gets a 403 there. One
  // rejection in the fan-out used to discard every resolved consult with it.
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
    if (url.includes('/prescriptions/') || url.includes('/referrals/')) {
      return new Response(JSON.stringify({error: {code: 'forbidden', message: 'Not available to a physician session'}}), {status: 403});
    }
    return new Response(JSON.stringify({error: {code: 'not_found', message: 'No such resource'}}), {status: 404});
  };
  // A three-segment JWT is all the constructor checks for a session token.
  const sessionToken = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({typ: 'physician', sub: 'ph_1'})).toString('base64url')}.sig`;
  const client = new NatzarClient({sessionToken, baseUrl: 'https://x.test/v1', fetch: fetchLike, maxRetries: 0});
  const actions = await resolveLinkActions(client, [{body: ASYNC_BODY}, {body: RX_BODY}, {body: REF_BODY}]);
  assert.equal(requested.length, 3);
  assert.deepEqual(actions['t_1gbX-hCHDD'], {kind: 'async', action: 'consent'});
  // The forbidden prescription is simply absent — the pharmacy link falls
  // back to `choose`, which the picker's first read re-checks anyway. The
  // referral likewise falls back to `view`: the open is a read.
  assert.equal(actions['rx_Ab12-cD'], undefined);
  assert.equal(actionFor({kind: 'pharmacy', consultId: 'rx_Ab12-cD'}, actions), 'choose');
  assert.equal(actions['ref_Zz9-Qq'], undefined);
  assert.equal(actionFor({kind: 'referral', consultId: 'ref_Zz9-Qq'}, actions), 'view');
});

test('resolveLinkActions still propagates a forbidden CONSULT read — that is a misconfiguration, not a miss', async () => {
  const fetchLike = async () =>
    new Response(JSON.stringify({error: {code: 'forbidden', message: 'No'}}), {status: 403});
  const client = new NatzarClient({apiKey: 'pp_test_x', baseUrl: 'https://x.test/v1', fetch: fetchLike, maxRetries: 0});
  await assert.rejects(() => resolveLinkActions(client, [{body: ASYNC_BODY}]), (e: {code?: string}) => e.code === 'forbidden');
});

test('resolveLinkActions carries a DUE consult price on an owed action only (0.16.0)', async () => {
  const due = {status: 'due', amountCents: 10000, currency: 'cad', modality: 'async', mode: 'live'};
  const fetchLike = async (url: string) => {
    if (url.includes('/async-consults/')) {
      return new Response(JSON.stringify({
        consult: {id: 't_1gbX-hCHDD', patientId: 'p', createdAt: '', origin: 'platform', kind: 'conversation', status: 'invited', rateable: false, payment: due},
      }), {status: 200});
    }
    // A paid video consult: `paid` is not a price to put on the button.
    return new Response(JSON.stringify({
      consult: {id: '4H1-sGULhQQi', patientId: 'p', createdAt: '', origin: 'platform', status: 'waiting', mode: 'queue',
        payment: {status: 'paid', amountCents: 10000, currency: 'cad', modality: 'telehealth', mode: 'live', paymentId: 'pay_1'}},
    }), {status: 200});
  };
  const client = new NatzarClient({apiKey: 'pp_test_x', baseUrl: 'https://x.test/v1', fetch: fetchLike, maxRetries: 0});
  const actions = await resolveLinkActions(client, [{body: ASYNC_BODY}, {body: TELE_BODY}]);
  assert.deepEqual(actions['t_1gbX-hCHDD'], {kind: 'async', action: 'consent', payment: {amountCents: 10000, currency: 'cad'}});
  assert.equal(actions['4H1-sGULhQQi']?.payment, undefined);
});
