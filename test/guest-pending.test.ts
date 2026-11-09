import {it, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createGuestClient, type GuestView} from '../dist/esm/guest/index.js';

const ID = '11111111-1111-1111-1111-111111111111';
const CREDENTIAL = `ng1.${ID}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
const SECOND_ID = '22222222-2222-2222-2222-222222222222';
const SECOND = `ng1.${SECOND_ID}.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB`;
const START = '2026-11-08T12:00:00.000Z';
const MESSAGE = '33333333-3333-3333-3333-333333333333';
const BASE: GuestView = {id: ID, clinicId: 'clinic-a', clinicName: 'Clinic A', country: 'CA', channel: 'web', phase: 'chat', messages: [], offers: [], phoneVerified: false, expiresAt: '2027-01-01T00:00:00Z'};
const user = {id: MESSAGE, role: 'user' as const, text: 'A symptom report.', sentAt: START};
const pending = (status: 'queued' | 'processing' = 'queued'): GuestView => ({...BASE, messages: [user], pendingMessage: {requestId: MESSAGE, startedAt: START, status}});
const final = (): GuestView => ({...BASE, messages: [user, {id: 'reply-one', role: 'assistant', text: 'A completed medical reply.', sentAt: START}]});
const ok = (journey: GuestView, credential = CREDENTIAL) => ({ok: true, journey, credential});
const response = (result: unknown) => new Response(JSON.stringify({data: {guestJourney: result}}));
const flush = async () => {for (let n = 0; n < 30; n++) await Promise.resolve();};
async function advance(t: TestContext, promise: Promise<unknown>, max = 520) {
  let done = false; void promise.then(() => {done = true;}, () => {done = true;});
  for (let n = 0; n < max && !done; n++) {await flush(); if (!done) t.mock.timers.tick(250);}
  await flush(); assert.equal(done, true, 'pending observations must finish within 120 seconds');
}
function setup(t: TestContext, handler: (action: string, input: Record<string, unknown>, call: number) => unknown | Promise<unknown>) {
  t.mock.timers.enable({apis: ['setTimeout', 'Date'], now: Date.parse(START)});
  const calls: Array<{action: string; input: Record<string, unknown>}> = [], values = new Map<string, string>();
  const storage = {getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => {values.set(key, value);}, removeItem: (key: string) => {values.delete(key);}};
  const options = {clinicId: BASE.clinicId, graphqlUrl: 'https://clinic.example/graphql', apiKey: 'public-api-key', cookieStorage: null, storage,
    fetch: (async (_url, init) => {const body = JSON.parse(String(init?.body)); const action = body.variables.action, input = JSON.parse(body.variables.input); calls.push({action, input}); return response(await handler(action, input, calls.length));}) as typeof fetch};
  return {client: createGuestClient(options), options, calls, values};
}

it('accepted long reply publishes queued/processing progress and only polls state until exact final turn', async t => {
  let states = 0;
  const f = setup(t, action => action === 'message' ? ok(pending()) : action === 'state' ? ok(++states < 3 ? pending('processing') : final()) : ok(BASE));
  const changes: GuestView[] = []; f.client.subscribe!(view => changes.push(view));
  await f.client.request('begin'); const result = f.client.request('message', {requestId: MESSAGE, text: user.text});
  await flush(); assert.equal(changes.at(-1)?.pendingMessage?.status, 'queued');
  await advance(t, result); assert.deepEqual(await result, ok(final()));
  assert.deepEqual(f.calls.map(c => c.action), ['begin', 'message', 'state', 'state', 'state']);
  assert(f.calls.slice(2).every(c => c.input.requestId === MESSAGE && c.input.credential === CREDENTIAL && !('text' in c.input)));
  assert.deepEqual(changes.map(v => v.pendingMessage?.status), [undefined, 'queued', 'processing', undefined]);
});
it('same request/payload shares one in-flight message; a changed payload cannot reuse its id', async t => {
  const f = setup(t, action => ok(action === 'message' ? pending() : action === 'state' ? final() : BASE));
  await f.client.request('begin'); const one = f.client.request('message', {requestId: MESSAGE, text: user.text});
  const two = f.client.request('message', {requestId: MESSAGE, text: user.text}); assert.equal(one, two);
  assert.deepEqual(await f.client.request('message', {requestId: MESSAGE, text: 'different'}), {ok: false, error: 'invalid_request_id'});
  await advance(t, one); assert.equal((await one).ok, true); assert.equal(f.calls.filter(c => c.action === 'message').length, 1);
});
it('reload restores accepted pending turn and typing progress without resending patient text', async t => {
  let state = 0;
  const f = setup(t, action => ok(action === 'state' ? ++state === 1 ? pending('processing') : final() : BASE));
  await f.client.request('begin'); const reloaded = createGuestClient(f.options), changes: GuestView[] = [];
  reloaded.subscribe!(view => changes.push(view)); const request = reloaded.request('state');
  await flush(); assert.equal(changes[0]?.pendingMessage?.requestId, MESSAGE);
  await advance(t, request); assert.deepEqual(await request, ok(final()));
  assert.deepEqual(f.calls.map(c => c.action), ['begin', 'state', 'state']);
});
it('an ambiguous lost response recovers by state, never resubmits clinical text', async t => {
  const f = setup(t, action => {if (action === 'message') throw new Error('offline after acceptance'); return ok(action === 'state' ? final() : BASE);});
  await f.client.request('begin'); const request = f.client.request('message', {requestId: MESSAGE, text: user.text});
  await advance(t, request); assert.deepEqual(await request, ok(final()));
  assert.deepEqual(f.calls.map(c => c.action), ['begin', 'message', 'state']);
});
it('only an explicit queue failure retries once, preserving exact durable request id and payload', async t => {
  let messages = 0;
  const f = setup(t, action => action === 'message' && ++messages === 1 ? {ok: false, error: 'message_queue_unavailable'} : ok(action === 'message' ? pending() : action === 'state' ? final() : BASE));
  await f.client.request('begin'); const request = f.client.request('message', {requestId: MESSAGE, text: user.text});
  await advance(t, request); assert.equal((await request).ok, true);
  const sent = f.calls.filter(c => c.action === 'message'); assert.equal(sent.length, 2); assert.deepEqual(sent[0].input, sent[1].input);
});
it('temporary offline state observations retain pending progress and later recover without AI resubmission', async t => {
  let states = 0;
  const f = setup(t, action => action === 'state' && ++states === 1 ? {ok: false, error: 'service_unavailable'} : ok(action === 'message' ? pending() : action === 'state' ? final() : BASE));
  await f.client.request('begin'); const request = f.client.request('message', {requestId: MESSAGE, text: user.text});
  await advance(t, request); assert.equal((await request).ok, true); assert.equal(f.calls.filter(c => c.action === 'message').length, 1);
});
it('120-second observation bound retains accepted pending state rather than inventing a failed medical reply', async t => {
  const f = setup(t, action => ok(action === 'begin' ? BASE : pending('processing')));
  await f.client.request('begin'); const request = f.client.request('message', {requestId: MESSAGE, text: user.text});
  await advance(t, request); const result = await request; assert(result.ok); assert(result.journey.pendingMessage);
  assert.equal(Date.now() - Date.parse(START), 120000); assert.equal(f.calls.filter(c => c.action === 'message').length, 1);
});
for (const [name, changed] of [
  ['different journey', {...final(), id: SECOND_ID}],
  ['different clinic', {...final(), clinicId: 'other'}],
  ['different request', {...pending(), pendingMessage: {...pending().pendingMessage!, requestId: 'other'}}],
  ['newer same-id task', {...pending(), pendingMessage: {...pending().pendingMessage!, startedAt: '2026-11-08T12:01:00Z'}}],
] as const) it(`ignores a ${name} state and never publishes its care or messages`, async t => {
  const f = setup(t, action => ok(action === 'begin' ? BASE : action === 'message' ? pending() : changed));
  const changes: GuestView[] = []; f.client.subscribe!(view => changes.push(view)); await f.client.request('begin');
  const request = f.client.request('message', {requestId: MESSAGE, text: user.text}); await advance(t, request);
  const result = await request; assert.equal(result.ok, name === 'different clinic');
  if (result.ok) assert.equal(result.journey.pendingMessage?.requestId, MESSAGE);
  else assert.equal(result.error, 'request_superseded');
  assert(changes.every(view => view.id === ID && view.clinicId === BASE.clinicId && !view.messages.some(m => m.role === 'assistant')));
});
it('forget during a delayed poll returns cancelled, and late final cannot restore bearer, view or care', async t => {
  let deliver: (v: unknown) => void = () => {};
  const f = setup(t, action => action === 'state' ? new Promise(resolve => {deliver = resolve;}) : ok(action === 'message' ? pending() : BASE));
  const changes: GuestView[] = []; f.client.subscribe!(view => changes.push(view)); await f.client.request('begin');
  const request = f.client.request('message', {requestId: MESSAGE, text: user.text}); await flush(); t.mock.timers.tick(1500); await flush();
  f.client.forget(); deliver(ok(final())); await advance(t, request);
  assert.deepEqual(await request, {ok: false, error: 'request_superseded'}); assert.equal(f.client.hasSavedJourney(), false); assert.equal(f.values.size, 0);
  assert(changes.every(view => !view.messages.some(m => m.role === 'assistant')));
});
it('new journey invalidates old pending acknowledgement and delayed completion', async t => {
  let begins = 0, deliver: (v: unknown) => void = () => {};
  const f = setup(t, action => action === 'begin' ? ++begins === 1 ? ok(BASE) : ok({...BASE, id: SECOND_ID}, SECOND) : action === 'message' ? ok(pending()) : new Promise(resolve => {deliver = resolve;}));
  const changes: GuestView[] = []; f.client.subscribe!(view => changes.push(view)); await f.client.request('begin');
  const request = f.client.request('message', {requestId: MESSAGE, text: user.text}); await flush(); t.mock.timers.tick(1500); await flush();
  await f.client.request('begin'); deliver(ok(final())); await advance(t, request);
  assert.deepEqual(await request, {ok: false, error: 'request_superseded'}); assert.equal(changes.at(-1)?.id, SECOND_ID);
  assert.deepEqual([...f.values.values()], [SECOND]);
});
it('a stalled read cannot exceed the observation budget even if fetch ignores abort', async t => {
  const f = setup(t, action => action === 'state' ? new Promise(() => {}) : ok(action === 'message' ? pending() : BASE));
  await f.client.request('begin'); const request = f.client.request('message', {requestId: MESSAGE, text: user.text});
  await advance(t, request); const result = await request; assert(result.ok && result.journey.pendingMessage); assert.equal(Date.now() - Date.parse(START), 120000);
});
it('a canceled report is not completed by a different later patient/assistant pair', async t => {
  const later: GuestView = {...BASE, messages: [user, {...user, id: 'other-report', text: 'A new report.'}, {...final().messages[1]}]};
  const f = setup(t, action => ok(action === 'begin' ? BASE : action === 'message' ? pending() : later));
  const changes: GuestView[] = []; f.client.subscribe!(view => changes.push(view)); await f.client.request('begin');
  const request = f.client.request('message', {requestId: MESSAGE, text: user.text}); await advance(t, request);
  const result = await request; assert(result.ok && result.journey.pendingMessage); assert(changes.every(v => !v.messages.some(m => m.id === 'other-report')));
});
it('same request id with a different original sent time is not mistaken for this completed task', async t => {
  const later: GuestView = {...final(), messages: [{...user, sentAt: '2026-11-08T12:01:00Z'}, {...final().messages[1]}]};
  const f = setup(t, action => ok(action === 'begin' ? BASE : action === 'message' ? pending() : later));
  await f.client.request('begin'); const request = f.client.request('message', {requestId: MESSAGE, text: user.text}); await advance(t, request);
  const result = await request; assert(result.ok && result.journey.pendingMessage);
});
it('initial accepted pending response must belong to its credential journey even without a previously loaded view', async t => {
  const f = setup(t, () => ok({...pending(), id: SECOND_ID}));
  const client = createGuestClient({...f.options, credential: CREDENTIAL});
  assert.deepEqual(await client.request('message', {requestId: MESSAGE, text: user.text}), {ok: false, error: 'request_superseded'});
  assert.deepEqual([...f.values.values()], [CREDENTIAL]); assert.equal(f.calls.length, 1);
});
it('two enqueue outages can be explicitly retried with the same accepted turn and one assessment', async t => {
  let attempts = 0, assessments = 0, delivered = false;
  const f = setup(t, action => {
    if (action === 'message' && ++attempts <= 2) return {ok: false, error: 'message_queue_unavailable'};
    if (action === 'message') {delivered = true; return ok(pending());}
    if (action === 'state' && delivered) {assessments++; return ok(final());}
    return ok(action === 'begin' ? BASE : pending());
  });
  await f.client.request('begin'); const first = f.client.request('message', {requestId: MESSAGE, text: user.text}); await advance(t, first);
  assert((await first).ok); assert.equal(assessments, 0); assert.equal(attempts, 2);
  const explicit = f.client.request('message', {requestId: MESSAGE, text: user.text}); await advance(t, explicit);
  assert.deepEqual(await explicit, ok(final())); assert.equal(assessments, 1); assert.equal(attempts, 3);
  const messages = f.calls.filter(c => c.action === 'message'); assert(messages.every(c => c.input.requestId === MESSAGE && c.input.text === user.text));
});
it('reload of an already aged pending turn returns retryable progress without another120-second wait or resubmission', async t => {
  const f = setup(t, action => ok(action === 'begin' ? BASE : pending())); await f.client.request('begin');
  t.mock.timers.tick(120000); const client = createGuestClient(f.options), observed: GuestView[] = []; client.subscribe!(view => observed.push(view));
  const result = await client.request('state'); assert(result.ok && result.journey.pendingMessage); assert.equal(f.calls.filter(c => c.action === 'state').length, 1); assert.equal(f.calls.filter(c => c.action === 'message').length, 0); assert.equal(observed[0]?.pendingMessage?.requestId, MESSAGE);
});
it('same-owned disabled clinic cancellation publishes refund recovery without inventing a medical reply', async t => {
  const disabled: GuestView = {...BASE, guestEnabled: false, phase: 'payment', messages: [user], payment: {id: 'existing-payment', amountCents: 4000, currency: 'cad', status: 'refund_pending'}};
  const f = setup(t, action => ok(action === 'begin' ? BASE : action === 'message' ? pending() : disabled)), changes: GuestView[] = [];
  f.client.subscribe!(view => changes.push(view)); await f.client.request('begin'); const request = f.client.request('message', {requestId: MESSAGE, text: user.text}); await advance(t, request);
  assert.deepEqual(await request, ok(disabled)); assert.equal(changes.at(-1)?.guestEnabled, false); assert.equal(changes.at(-1)?.pendingMessage, undefined);
  assert.equal(changes.at(-1)?.messages.some(m => m.role === 'assistant'), false); assert.deepEqual(f.calls.map(c => c.action), ['begin', 'message', 'state']);
});
it('disabled state from another request cannot be treated as this pending cancellation', async t => {
  const f = setup(t, action => ok(action === 'begin' ? BASE : action === 'message' ? pending() : {...BASE, guestEnabled: false, messages: [{...user, id: 'unrelated'}]}));
  await f.client.request('begin'); const request = f.client.request('message', {requestId: MESSAGE, text: user.text}); await advance(t, request);
  const result = await request; assert(result.ok && result.journey.pendingMessage); assert.equal(result.journey.guestEnabled, undefined);
});
it('disabled cancellation remains bound to original accepted timestamp and credential', async t => {
  const f = setup(t, action => ok(action === 'begin' ? BASE : action === 'message' ? pending() : {...BASE, guestEnabled: false, messages: [{...user, sentAt: '2026-11-08T12:01:00Z'}]}));
  await f.client.request('begin'); const request = f.client.request('message', {requestId: MESSAGE, text: user.text}); await advance(t, request);
  const result = await request; assert(result.ok && result.journey.pendingMessage); assert.equal(result.journey.guestEnabled, undefined);
});
it('actual no-fund guest_disabled error terminates state observation promptly without claiming a reply', async t => {
  const f = setup(t, action => action === 'state' ? {ok: false, error: 'guest_disabled'} : ok(action === 'begin' ? BASE : pending()));
  await f.client.request('begin'); const request = f.client.request('message', {requestId: MESSAGE, text: user.text}); await advance(t, request);
  assert.deepEqual(await request, {ok: false, error: 'guest_disabled'}); assert.deepEqual(f.calls.map(c => c.action), ['begin', 'message', 'state']); assert(Date.now() - Date.parse(START) < 3000);
});
