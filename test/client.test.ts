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
    () => client.asyncConsults.create({externalPatientId: 'u_1'}),
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
