import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createGuestClient, type GuestAccount, type GuestView} from '../dist/esm/guest/index.js';

const id = '11111111-1111-1111-1111-111111111111';
const guest = `ng1.${id}.${'A'.repeat(43)}`, login = `nac1.${id}.${'B'.repeat(43)}`;
const view: GuestView = {id, clinicId: 'clinic', clinicName: 'Clinic', country: 'US', channel: 'web', phase: 'chat', messages: [], offers: [], phoneVerified: false, expiresAt: '2027-01-01T00:00:00Z'};
const account: GuestAccount = {credential: login, firstName: 'Ada', frameUrl: 'https://clinic.example/guest/account', expiresAt: new Date(Date.now() + 3600000).toISOString()};
const mapStore = () => {const values = new Map<string, string>(); return {values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => {values.set(key, value);}, removeItem: (key: string) => {values.delete(key);}};};

test('explicit login uses a separate session credential, private registered operation, and cookie-only restore cannot unlock history', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage'), session = mapStore(), cookies = mapStore(), durable = mapStore();
  Object.defineProperty(globalThis, 'sessionStorage', {value: session, configurable: true});
  const calls: Array<{query: string; variables: Record<string, string>}> = [];
  let rejectState = false;
  const options = {clinicId: 'clinic', graphqlUrl: 'https://clinic.example/graphql', apiKey: 'da2-public', credential: guest, cookieStorage: cookies, rememberStorage: durable,
    fetch: (async (_url: unknown, init: RequestInit) => {
      assert.equal(init.credentials, 'omit');
      const call = JSON.parse(String(init.body)); calls.push(call);
      if (call.query.includes('guestPatientEmbed')) return Response.json({data: {guestPatientEmbed: {ok: true, messages: [{body: 'Private history'}]}}});
      const input = JSON.parse(call.variables.input);
      if (call.variables.action === 'verifyLoginCode') return Response.json({data: {guestJourney: {ok: true, journey: view, account: {...account, credential: input.newAccountCredential}}}});
      if (rejectState && input.accountCredential) return Response.json({data: {guestJourney: {ok: false, error: 'account_expired'}}});
      return Response.json({data: {guestJourney: {ok: true, journey: view}}});
    }) as typeof fetch};
  try {
    const client = createGuestClient(options);
    assert.equal((await client.request('verifyLoginCode', {code: '123456'})).ok, true);
    const proposed = JSON.parse(calls[0].variables.input).newAccountCredential;
    assert.match(proposed, new RegExp(`^nac1\\.${id}\\.[A-Za-z0-9_-]{43}$`));
    assert.equal(client.account?.()?.credential, proposed);
    assert.deepEqual([...cookies.values.values()], [guest]); assert.equal(durable.values.size, 0);
    assert.equal([...session.values.values()].some(value => value.includes(proposed)), true);
    assert.equal((await client.accountOperation!('embedAgentMessages')).ok, true);
    assert.equal(calls.at(-1)?.variables.credential, proposed); assert.equal(calls.at(-1)?.variables.operation, 'embedAgentMessages');
    assert.equal(calls.at(-1)?.query.includes(proposed), false);
    assert.equal(createGuestClient(options).account?.()?.credential, proposed);
    rejectState = true;
    assert.equal((await client.request('state', {accountCredential: proposed})).ok, true, 'stale explicit credentials retry once without recursion');
    assert.equal(client.account?.(), null);
    assert.equal(JSON.parse(calls.at(-1)!.variables.input).accountCredential, undefined);
    session.values.clear();
    const cookieOnly = createGuestClient({...options, credential: undefined});
    assert.equal(cookieOnly.hasSavedJourney(), true); assert.equal(cookieOnly.account?.(), null);
    assert.deepEqual(await cookieOnly.accountOperation?.('embedAgentMessages'), {ok: false, error: 'account_expired'});
  } finally {if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous); else Reflect.deleteProperty(globalThis, 'sessionStorage');}
});

test('expired or malformed cached login never authorizes registered operations and fresh journeys clear old login', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage'), session = mapStore();
  Object.defineProperty(globalThis, 'sessionStorage', {value: session, configurable: true});
  const key = 'natzar.guest.v1:https://clinic.example:clinic:account';
  const options = {clinicId: 'clinic', graphqlUrl: 'https://clinic.example/graphql', apiKey: 'da2-public', credential: guest,
    fetch: (async () => Response.json({data: {guestJourney: {ok: true, journey: {...view, id: '22222222-2222-2222-2222-222222222222'}, credential: `ng1.22222222-2222-2222-2222-222222222222.${'C'.repeat(43)}`}}})) as typeof fetch};
  try {
    for (const value of [{...account, expiresAt: '2000-01-01'}, {...account, credential: guest}, {...account, frameUrl: 'javascript:alert(1)'}, {...account, frameUrl: 'https://clinic.example/admin'}]) {
      session.setItem(key, JSON.stringify(value)); const client = createGuestClient(options);
      assert.equal(client.account?.(), null); assert.deepEqual(await client.accountOperation?.('embedState'), {ok: false, error: 'account_expired'});
    }
    session.setItem(key, JSON.stringify(account)); const client = createGuestClient(options); assert.ok(client.account?.());
    await client.request('begin'); assert.equal(client.account?.(), null); assert.equal(session.getItem(key), null);
  } finally {if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous); else Reflect.deleteProperty(globalThis, 'sessionStorage');}
});

test('an account error without any login credential is returned without an unbounded retry', async () => {
  let requests = 0;
  const client = createGuestClient({clinicId: 'clinic', graphqlUrl: 'https://clinic.example/graphql', apiKey: 'da2-public', credential: guest,
    fetch: (async () => {requests++; return Response.json({data: {guestJourney: {ok: false, error: 'account_expired'}}});}) as typeof fetch});
  assert.deepEqual(await client.request('state'), {ok: false, error: 'account_expired'}); assert.equal(requests, 1);
});
test('optional history and care verification both request automatic account login', async () => {
  for (const action of ['verifyHistoryCode', 'verify'] as const) {
    let proposed = '';
    const client = createGuestClient({clinicId: 'clinic', graphqlUrl: 'https://clinic.example/graphql', apiKey: 'da2-public', credential: guest,
      fetch: (async (_url: unknown, init: RequestInit) => {
        const body = JSON.parse(String(init.body)), input = JSON.parse(body.variables.input);
        assert.equal(body.variables.action, action); proposed = input.newAccountCredential;
        assert.match(proposed, /^nac1\./); assert.equal(input.credential, guest);
        return Response.json({data: {guestJourney: {ok: true, journey: view, account: {...account, credential: proposed}}}});
      }) as typeof fetch});
    assert.equal((await client.request(action, {code: '123456'})).ok, true);
    assert.equal(client.account?.()?.credential, proposed);
  }
});
