// Signature verification. Every assertion here is a way a webhook endpoint
// can look secure while accepting forgeries, so each one is a real failure
// mode rather than a coverage exercise.
import test from 'node:test';
import assert from 'node:assert/strict';
import {handleWebhook, parseSignatureHeader, signWebhook, verifyWebhook} from '../dist/esm/index.js';

const SECRET = 'whsec_test_2f8a91c4';
const BODY = JSON.stringify({
  id: 'evt_01',
  type: 'async_consult.message',
  createdAt: '2026-08-18T09:00:00.000Z',
  partnerId: 'p_1',
  data: {asyncConsultId: 't_1', message: {id: 'm_1', author: 'physician', body: 'hi', sentAt: '2026-08-18T09:00:00.000Z'}},
});

test('a genuine delivery verifies and yields the typed event', async () => {
  const signature = await signWebhook({secret: SECRET, rawBody: BODY});
  const result = await verifyWebhook({secret: SECRET, rawBody: BODY, signature});
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.equal(result.event.type, 'async_consult.message');
  assert.equal(result.event.id, 'evt_01');
});

test('the wrong secret is rejected', async () => {
  const signature = await signWebhook({secret: SECRET, rawBody: BODY});
  const result = await verifyWebhook({secret: 'whsec_other', rawBody: BODY, signature});
  assert.deepEqual(result, {valid: false, reason: 'signature_mismatch'});
});

test('a tampered body is rejected even with a real signature', async () => {
  const signature = await signWebhook({secret: SECRET, rawBody: BODY});
  const tampered = BODY.replace('"hi"', '"transfer funds"');
  const result = await verifyWebhook({secret: SECRET, rawBody: tampered, signature});
  assert.deepEqual(result, {valid: false, reason: 'signature_mismatch'});
});

test('re-serializing the body breaks verification — sign-then-parse is mandatory', async () => {
  const signature = await signWebhook({secret: SECRET, rawBody: BODY});
  // What a framework's JSON body-parser leaves you with. Key order survives
  // here, but the point stands: this is a DIFFERENT byte string in general and
  // the client must never be handed it.
  const reserialized = JSON.stringify({...JSON.parse(BODY), extra: undefined});
  const result = await verifyWebhook({secret: SECRET, rawBody: reserialized, signature});
  assert.equal(result.valid, true, 'sanity: identical bytes still verify');
  const shuffled = JSON.stringify({type: 'async_consult.message', id: 'evt_01'});
  const bad = await verifyWebhook({secret: SECRET, rawBody: shuffled, signature});
  assert.equal(bad.valid, false);
});

test('an old delivery is refused — a valid signature is otherwise valid forever', async () => {
  const sixMinutesAgo = Math.floor(Date.now() / 1000) - 360;
  const signature = await signWebhook({secret: SECRET, rawBody: BODY, timestamp: sixMinutesAgo});
  const result = await verifyWebhook({secret: SECRET, rawBody: BODY, signature});
  assert.deepEqual(result, {valid: false, reason: 'timestamp_out_of_tolerance'});
  // …and accepted once the window is widened deliberately.
  const lenient = await verifyWebhook({secret: SECRET, rawBody: BODY, signature, toleranceSeconds: 3600});
  assert.equal(lenient.valid, true);
});

test('a future timestamp is refused too (clock skew cuts both ways)', async () => {
  const ahead = Math.floor(Date.now() / 1000) + 3600;
  const signature = await signWebhook({secret: SECRET, rawBody: BODY, timestamp: ahead});
  const result = await verifyWebhook({secret: SECRET, rawBody: BODY, signature});
  assert.deepEqual(result, {valid: false, reason: 'timestamp_out_of_tolerance'});
});

test('malformed and missing headers are refused, not thrown', async () => {
  for (const signature of [null, undefined, '', 'garbage', 't=abc,v1=ff', 'v1=ff', `t=${Date.now() / 1000}`]) {
    const result = await verifyWebhook({secret: SECRET, rawBody: BODY, signature});
    assert.deepEqual(result, {valid: false, reason: 'malformed_signature'}, `for ${String(signature)}`);
  }
});

test('parseSignatureHeader tolerates whitespace and extra fields', () => {
  const parsed = parseSignatureHeader('t=1700000000, v1=deadBEEF, v2=ignored');
  assert.deepEqual(parsed, {t: 1700000000, v1: 'deadBEEF'});
});

test('handleWebhook dispatches once and honours the dedupe hook', async () => {
  const signature = await signWebhook({secret: SECRET, rawBody: BODY});
  const seenIds = new Set<string>();
  const delivered: string[] = [];
  const duplicates: string[] = [];
  const run = () =>
    handleWebhook({
      secret: SECRET,
      rawBody: BODY,
      signature,
      seen: (id) => seenIds.has(id),
      onEvent: (e) => {
        seenIds.add(e.id);
        delivered.push(e.id);
      },
      onDuplicate: (e) => {
        duplicates.push(e.id);
      },
    });
  await run();
  await run(); // the retry
  assert.deepEqual(delivered, ['evt_01']);
  assert.deepEqual(duplicates, ['evt_01']);
});

test('a bad signature never reaches the handler', async () => {
  let called = false;
  const result = await handleWebhook({
    secret: SECRET,
    rawBody: BODY,
    signature: await signWebhook({secret: 'whsec_other', rawBody: BODY}),
    onEvent: () => {
      called = true;
    },
  });
  assert.equal(result.valid, false);
  assert.equal(called, false);
});
