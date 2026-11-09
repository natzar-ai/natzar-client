import {describe, it, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createGuestClient, validateGuestUrl} from '../dist/esm/guest/index.js';
import type {GuestView} from '../dist/esm/guest/index.js';

const VIEW: GuestView = {id: 'journey', clinicId: 'clinic-a', clinicName: 'Clinic A', country: 'US', channel: 'web', phase: 'chat', messages: [], offers: [], phoneVerified: false, expiresAt: '2027-01-01T00:00:00Z'};
const CREDENTIAL = 'ng1.11111111-1111-1111-1111-111111111111.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
function fixture(result: unknown = {ok: true, journey: VIEW, credential: CREDENTIAL}) {
  const calls: Array<{url: string; init: RequestInit; body: {query: string; variables: {action: string; input: string}}}> = [];
  const values = new Map<string, string>();
  const storage = {getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => {values.set(key, value);}, removeItem: (key: string) => {values.delete(key);}};
  const options = {clinicId: 'clinic-a', graphqlUrl: 'https://clinic.example/graphql', apiKey: 'da2-public-api-key', storage,
    fetch: (async (url: string | URL | Request, init: RequestInit) => {
      calls.push({url: String(url), init, body: JSON.parse(String(init.body))});
      return new Response(JSON.stringify({data: {[String(init.headers && (init.headers as Record<string, string>).Authorization ? 'guestJourneyAccount' : 'guestJourney')]: result}}), {status: 200});
    }) as typeof fetch};
  return {calls, values, options, client: createGuestClient(options)};
}

describe('public guest SDK isolation and handoff', () => {
  it('begins only when asked, uses public API key, omits ambient credentials and persists only guest bearer', async () => {
    const f = fixture(); assert.equal(f.calls.length, 0); assert.equal(f.client.hasSavedJourney(), false);
    assert.equal((await f.client.request('begin')).ok, true);
    assert.equal(f.client.hasSavedJourney(), true); assert.deepEqual([...f.values.values()], [CREDENTIAL]);
    const call = f.calls[0]; assert.equal(call.init.credentials, 'omit'); assert.equal(call.init.referrerPolicy, 'no-referrer');
    assert.equal((call.init.headers as Record<string, string>)['x-api-key'], 'da2-public-api-key');
    assert.equal((call.init.headers as Record<string, string>).Authorization, undefined);
    const input = JSON.parse(call.body.variables.input); assert.equal(input.clinicId, 'clinic-a'); assert.match(input.requestId, /^[a-z0-9-]{36}$/i);
    assert.equal(call.url.includes(CREDENTIAL), false); assert.equal(call.body.query.includes(CREDENTIAL), false);
  });
  it('does not auto-fetch a saved conversation and sends bearer only in the scoped operation input', async () => {
    const f = fixture(); await f.client.request('begin'); const saved = createGuestClient(f.options);
    assert.equal(f.calls.length, 1); assert.equal(saved.hasSavedJourney(), true); await saved.request('state');
    assert.equal(JSON.parse(f.calls[1].body.variables.input).credential, CREDENTIAL);
    assert.equal((f.calls[1].init.headers as Record<string, string>).Authorization, undefined);
  });
  it('account linking requires normal authenticated token on a separate GraphQL operation', async () => {
    const f = fixture(); await f.client.request('begin'); await f.client.linkAccount('normal-patient-id-token');
    const call = f.calls[1]; assert.match(call.body.query, /guestJourneyAccount/);
    assert.equal((call.init.headers as Record<string, string>).Authorization, 'normal-patient-id-token');
    assert.equal((call.init.headers as Record<string, string>)['x-api-key'], undefined);
    assert.equal(JSON.parse(call.body.variables.input).credential, CREDENTIAL);
  });
  it('refuses a foreign clinic response before persisting any credential', async () => {
    const f = fixture({ok: true, journey: {...VIEW, clinicId: 'other'}, credential: CREDENTIAL});
    assert.deepEqual(await f.client.request('begin'), {ok: false, error: 'service_unavailable'}); assert.equal(f.values.size, 0);
  });
  it('places handoff credential in a fragment, never a query; rejects non-guest and insecure destinations', async () => {
    const f = fixture(); await f.client.request('begin'); const url = new URL(f.client.handoffUrl('https://clinic.example/guest'));
    assert.equal(url.searchParams.get('clinic'), 'clinic-a'); assert.equal(url.search.includes(CREDENTIAL), false);
    assert.equal(new URLSearchParams(url.hash.slice(1)).get('credential'), CREDENTIAL);
    assert.throws(() => f.client.handoffUrl('https://clinic.example/login'));
    assert.throws(() => f.client.handoffUrl('http://clinic.example/guest'));
    assert.throws(() => f.client.handoffUrl('javascript:alert(1)'));
  });
  it('forgetting clears this guest credential and leaves unrelated patient storage intact', async () => {
    const f = fixture(); f.values.set('patient-auth', 'normal-login'); await f.client.request('begin'); f.client.forget();
    assert.equal(f.client.hasSavedJourney(), false); assert.deepEqual([...f.values.entries()], [['patient-auth', 'normal-login']]);
  });
  it('preserves caller idempotency keys and clinic binding', async () => {
    const f = fixture(); await f.client.request('begin', {requestId: 'stable-attempt-1', clinicId: 'other'});
    const input = JSON.parse(f.calls[0].body.variables.input); assert.equal(input.requestId, 'stable-attempt-1'); assert.equal(input.clinicId, 'clinic-a');
  });
  it('normalizes browser and short locales to the platform locale keys', async () => {
    const f = fixture(); const client = createGuestClient({...f.options, locale: 'fr-CA'}); await client.request('begin');
    assert.equal(JSON.parse(f.calls[0].body.variables.input).locale, 'fr');
  });
  it('refuses partner/server and payment keys and insecure configured endpoints', () => {
    const f = fixture(); assert.throws(() => createGuestClient({...f.options, apiKey: 'pp_live_secret'}));
    assert.throws(() => createGuestClient({...f.options, graphqlUrl: 'http://clinic.example/graphql'}));
    assert.throws(() => validateGuestUrl('https://user:password@clinic.example/graphql'));
    assert.equal(validateGuestUrl('http://localhost:4795/graphql').origin, 'http://localhost:4795');
  });
  it('remembers a device only after explicit opt-in and forget clears both stores', async () => {
    const f = fixture(); const persistent = new Map<string, string>();
    const rememberStorage = {getItem: (key: string) => persistent.get(key) ?? null, setItem: (key: string, value: string) => {persistent.set(key, value);}, removeItem: (key: string) => {persistent.delete(key);}};
    const client = createGuestClient({...f.options, rememberStorage}); await client.request('begin');
    assert.equal(persistent.size, 0); assert.equal(client.isRemembered(), false); client.rememberOnDevice(true);
    assert.deepEqual([...persistent.values()], [CREDENTIAL]); assert.equal(client.isRemembered(), true);
    const newTab = createGuestClient({...f.options, storage: null, rememberStorage}); assert.equal(newTab.hasSavedJourney(), true); assert.equal(f.calls.length, 1);
    newTab.forget(); assert.equal(persistent.size, 0);
  });
  it('a one-use payment return ticket can be exchanged without any pre-existing guest credential', async () => {
    const f = fixture(); const ticket = 'ngr1.11111111-1111-1111-1111-111111111111.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const result = await f.client.request('resume', {resumeTicket: ticket}); assert.equal(result.ok, true);
    const input = JSON.parse(f.calls[0].body.variables.input); assert.equal(input.resumeTicket, ticket); assert.equal(input.credential, undefined);
    assert.equal(f.calls[0].url.includes(ticket), false); assert.equal(f.client.hasSavedJourney(), true);
  });
  it('preserves an edge rate limit and bounds its Retry-After rather than showing an outage', async () => {
    const f = fixture();
    for (const [header, expected] of [['300', 300], ['999999999', 3600], ['invalid', 300], ['-1', 300]] as const) {
      const client = createGuestClient({...f.options, fetch: (async () => new Response('', {status: 429, headers: {'Retry-After': header}})) as typeof fetch});
      assert.deepEqual(await client.request('begin'), {ok: false, error: 'rate_limited', retryAfterSeconds: expected});
    }
  });
});

it('cookie persistence stores only the scoped credential, resumes across tabs, respects opt-out and clears on forget', async () => {
  const f = fixture(), cookies = new Map<string, string>(), legacy = new Map<string, string>(), expiries: string[] = [];
  const adapter = (values: Map<string, string>) => ({getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => {values.set(key, value);}, removeItem: (key: string) => {values.delete(key);}});
  const cookieStorage = {...adapter(cookies), setExpiry: (value: string) => {expiries.push(value);}};
  const client = createGuestClient({...f.options, cookieStorage, rememberStorage: adapter(legacy)});
  assert.equal(client.isRemembered(), true); assert.equal(cookies.size, 0);
  await client.request('begin'); assert.deepEqual([...cookies.values()], [CREDENTIAL]); assert.equal(legacy.size, 0); assert.deepEqual(expiries, [VIEW.expiresAt]);
  const another = createGuestClient({...f.options, storage: null, cookieStorage});
  assert.equal(another.hasSavedJourney(), true); assert.equal(f.calls.length, 1);
  client.rememberOnDevice(false); assert.equal(cookies.size, 0); assert.equal(client.hasSavedJourney(), true);
  await client.request('state'); assert.equal(cookies.size, 0);
  client.rememberOnDevice(true); assert.equal(cookies.size, 1); client.forget(); assert.equal(cookies.size, 0);
});
it('a blocked cookie adapter never turns a committed operation into an apparent server failure', async () => {
  const f = fixture(); const blocked = () => {throw new Error('blocked');};
  const client = createGuestClient({...f.options, cookieStorage: {getItem: blocked, setItem: blocked, removeItem: blocked, setExpiry: blocked}});
  assert.equal((await client.request('begin')).ok, true); assert.equal(client.hasSavedJourney(), true);
});

const CHECKOUT_VIEW: GuestView = {...VIEW, id: CREDENTIAL.split('.')[1], country: 'CA', phase: 'offer', phoneVerified: true,
  choice: {modality: 'async', mode: 'live'}, messages: [{id: 'initial-question', role: 'assistant', text: 'Please review the clinic offer.', sentAt: '2026-11-04T10:00:00Z'}]};
const CHECKOUT_READY: GuestView = {...CHECKOUT_VIEW, phase: 'payment', payment: {id: 'payment-one', status: 'pending', amountCents: 3900, currency: 'cad', clientSecret: 'synthetic-checkout-client-secret'}};
const reply = (result: unknown) => ({ok: true, status: 200, json: async () => ({data: {guestJourney: result}})}) as Response;
async function settle() {for (let i = 0; i < 24; i++) await Promise.resolve();}
async function advance(t: TestContext, pending: Promise<unknown>, maxTicks = 48) {
  let done = false; void pending.finally(() => {done = true;});
  for (let i = 0; i < maxTicks && !done; i++) {await settle(); if (!done) t.mock.timers.tick(250);}
  await settle(); assert(done, 'recovery must finish within its bounded observation window');
}
function recoveryFixture(states: Array<unknown | (() => Promise<Response>)>, original: unknown = {ok: false, error: 'service_unavailable'}) {
  const calls: Array<{action: string; input: Record<string, unknown>; signal: AbortSignal | null | undefined}> = [];
  const saved = new Map<string, string>();
  let stateIndex = 0, begins = 0;
  const nextCredential = 'ng1.22222222-2222-2222-2222-222222222222.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  const client = createGuestClient({clinicId: CHECKOUT_VIEW.clinicId, graphqlUrl: 'https://clinic.example/graphql', apiKey: 'public-api-key', cookieStorage: null,
    storage: {getItem: key => saved.get(key) ?? null, setItem: (key, value) => {saved.set(key, value);}, removeItem: key => {saved.delete(key);}},
    fetch: (async (_url, init) => {
      const body = JSON.parse(String(init?.body)), action = body.variables.action, input = JSON.parse(body.variables.input);
      calls.push({action, input, signal: init?.signal});
      if (action === 'begin') {begins++; return reply({ok: true, journey: begins === 1 ? CHECKOUT_VIEW : {...CHECKOUT_VIEW, id: nextCredential.split('.')[1], phase: 'chat'}, credential: begins === 1 ? CREDENTIAL : nextCredential});}
      if (action !== 'state') {if (original instanceof Error) throw original; return typeof original === 'function' ? original(init?.signal) : reply(original);}
      const state = states[Math.min(stateIndex++, states.length - 1)];
      return typeof state === 'function' ? state() : reply(state);
    }) as typeof fetch});
  return {client, calls, saved, nextCredential};
}

describe('ambiguous checkout response reconciliation', () => {
  it('recovers a late committed pending payment with the same request/credential and no checkout replay', async t => {
    const f = recoveryFixture([{ok: false, error: 'journey_busy'}, {ok: true, journey: CHECKOUT_READY}], new Error('response lost'));
    await f.client.request('begin'); t.mock.timers.enable({apis: ['setTimeout', 'Date']});
    const pending = f.client.request('checkout', {consent: true, requestId: 'same-checkout-attempt'});
    await advance(t, pending); const result = await pending;
    assert(result.ok); assert.equal(result.journey.phase, 'payment'); assert.equal(result.journey.payment?.id, 'payment-one');
    assert.equal(f.calls.filter(c => c.action === 'checkout').length, 1);
    for (const call of f.calls.filter(c => c.action === 'state')) {assert.equal(call.input.requestId, 'same-checkout-attempt'); assert.equal(call.input.credential, CREDENTIAL); assert.equal(call.input.consent, undefined);}
  });

  it('shows a newly committed clinical follow-up as an offer, without claiming payment or clearance', async t => {
    const followup: GuestView = {...CHECKOUT_VIEW, messages: [...CHECKOUT_VIEW.messages, {id: 'clinic-followup', role: 'assistant', text: 'Do you have a fever?', sentAt: '2026-11-04T10:00:01Z'}]};
    const f = recoveryFixture([{ok: true, journey: followup}]); await f.client.request('begin'); t.mock.timers.enable({apis: ['setTimeout', 'Date']});
    const pending = f.client.request('checkout', {consent: true}); await advance(t, pending); const result = await pending;
    assert(result.ok); assert.equal(result.journey.phase, 'offer'); assert.equal(result.journey.payment, undefined); assert.equal(result.journey.messages.at(-1)?.text, 'Do you have a fever?');
    assert.equal(f.calls.filter(c => c.action === 'checkout').length, 1);
  });

  it('accepts only a server-confirmed free intake transition', async t => {
    const f = recoveryFixture([{ok: true, journey: {...CHECKOUT_VIEW, phase: 'intake', payment: {id: null, status: 'free', amountCents: 0, currency: 'cad'}}}]);
    await f.client.request('begin'); t.mock.timers.enable({apis: ['setTimeout', 'Date']});
    const pending = f.client.request('checkout', {consent: true}); await advance(t, pending); const result = await pending;
    assert(result.ok); assert.equal(result.journey.phase, 'intake'); assert.equal(result.journey.payment?.status, 'free');
  });

  it('retains the original error for unchanged, busy, disabled or non-actionable state', async t => {
    t.mock.timers.enable({apis: ['setTimeout', 'Date']});
    for (const state of [{ok: true, journey: CHECKOUT_VIEW}, {ok: false, error: 'journey_busy'}, {ok: true, journey: {...CHECKOUT_READY, guestEnabled: false}}, {ok: true, journey: {...CHECKOUT_READY, payment: {...CHECKOUT_READY.payment!, clientSecret: undefined, checkoutUrl: undefined}}}, {ok: false, error: 'session_expired'}]) {
      const f = recoveryFixture([state], {ok: false, error: 'demo_unavailable'}); await f.client.request('begin');
      const pending = f.client.request('checkout', {consent: true}); await advance(t, pending);
      assert.deepEqual(await pending, {ok: false, error: 'demo_unavailable'}); assert.equal(f.calls.filter(c => c.action === 'checkout').length, 1);
      assert(f.calls.filter(c => c.action === 'state').length <= 4);
    }
  });

  it('does not poll after a clinical/business refusal or for unrelated actions', async () => {
    for (const [action, original] of [['checkout', {ok: false, error: 'care_unavailable'}], ['complete', {ok: false, error: 'service_unavailable'}], ['message', {ok: false, error: 'care_unavailable'}]] as const) {
      const f = recoveryFixture([{ok: true, journey: CHECKOUT_READY}], original); await f.client.request('begin');
      assert.deepEqual(await f.client.request(action), original); assert.equal(f.calls.filter(c => c.action === 'state').length, 0);
    }
  });

  it('rejects foreign journey/clinic/credential observations without persisting their bearer', async t => {
    t.mock.timers.enable({apis: ['setTimeout', 'Date']});
    for (const result of [{ok: true, journey: {...CHECKOUT_READY, id: 'foreign-journey'}}, {ok: true, journey: {...CHECKOUT_READY, clinicId: 'foreign-clinic'}}, {ok: true, journey: CHECKOUT_READY, credential: 'foreign-bearer'}]) {
      const f = recoveryFixture([result]); await f.client.request('begin');
      const pending = f.client.request('checkout', {consent: true}); await advance(t, pending);
      assert.deepEqual(await pending, {ok: false, error: 'service_unavailable'}); assert.deepEqual([...f.saved.values()], [CREDENTIAL]);
    }
  });

  it('bounds state polls even when a transport ignores abort and never resolves', async t => {
    const signals: AbortSignal[] = [];
    const f = recoveryFixture([() => new Promise<Response>(() => {})]); await f.client.request('begin'); t.mock.timers.enable({apis: ['setTimeout', 'Date']});
    const pending = f.client.request('checkout', {consent: true}); await advance(t, pending, 44);
    assert.deepEqual(await pending, {ok: false, error: 'service_unavailable'});
    assert.equal(f.calls.filter(c => c.action === 'state').length, 4);
    signals.push(...f.calls.filter(c => c.action === 'state').map(c => c.signal!)); assert(signals.every(s => s.aborted));
  });

  it('never lets a late observation overwrite a forgotten or newer journey', async t => {
    let resolveLate!: (value: Response) => void;
    const f = recoveryFixture([() => new Promise<Response>(resolve => {resolveLate = resolve;})]); await f.client.request('begin'); t.mock.timers.enable({apis: ['setTimeout', 'Date']});
    const pending = f.client.request('checkout', {consent: true}); await settle(); t.mock.timers.tick(500); await settle(); assert(resolveLate);
    f.client.forget(); await f.client.request('begin');
    resolveLate(reply({ok: true, journey: CHECKOUT_READY, credential: CREDENTIAL})); await advance(t, pending);
    assert.deepEqual(await pending, {ok: false, error: 'service_unavailable'}); assert.deepEqual([...f.saved.values()], [f.nextCredential]);
    assert.equal(new URL(f.client.handoffUrl('https://clinic.example/guest')).hash.includes(encodeURIComponent(f.nextCredential)), true);
  });

  it('does not extend recovery when a backgrounded page resumes after the overall deadline', async t => {
    let resolveLate!: (value: Response) => void;
    const f = recoveryFixture([() => new Promise<Response>(resolve => {resolveLate = resolve;})]); await f.client.request('begin'); t.mock.timers.enable({apis: ['setTimeout', 'Date']});
    const pending = f.client.request('checkout', {consent: true}); await settle(); t.mock.timers.tick(500); await settle(); assert(resolveLate);
    t.mock.timers.tick(10_001); await settle();
    assert.deepEqual(await pending, {ok: false, error: 'service_unavailable'});
    resolveLate(reply({ok: true, journey: CHECKOUT_READY, credential: CREDENTIAL})); await settle();
    assert.equal(f.calls.filter(c => c.action === 'state').length, 1); assert.equal(f.calls.filter(c => c.action === 'checkout').length, 1);
  });

  it('keeps the original transport timeout at 25 seconds before short state observations', async t => {
    let signal!: AbortSignal;
    const f = recoveryFixture([{ok: true, journey: CHECKOUT_READY}], (value: AbortSignal) => {signal = value; return new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), {once: true}));});
    await f.client.request('begin'); t.mock.timers.enable({apis: ['setTimeout', 'Date']}); const pending = f.client.request('checkout', {consent: true}); await settle();
    t.mock.timers.tick(24_999); assert.equal(signal.aborted, false); t.mock.timers.tick(1); assert.equal(signal.aborted, true);
    await advance(t, pending); assert((await pending).ok); assert.equal(f.calls.filter(c => c.action === 'checkout').length, 1);
  });
});
