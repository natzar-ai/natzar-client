// Run by test/server.test.ts in a child process with a TZ set (RG5 S1): which
// birthdate does the mint carry for a `Date` at local midnight (node-postgres
// `DATE`), at UTC midnight, and at noon (ambiguous: refused)?
import {natzar} from '../../dist/esm/server/index.js';
import {generateFrameKeyPair} from '../../dist/esm/contract/sessions-crypto.js';

const {publicJwk} = await generateFrameKeyPair();
const ask = {audience: 'patient', surface: 'async', sessionId: null, reason: 'initial', frameKey: publicJwk};
const dates = {
  local: new Date(1980, 1, 3),
  utc: new Date(Date.UTC(1980, 1, 3)),
  noon: new Date(1980, 1, 3, 12),
};
const out = {};
for (const [name, birthdate] of Object.entries(dates)) {
  let mint = null;
  const logs = [];
  const nz = natzar({
    identify: () => ({patient: {externalId: 'u-1', phone: '+15551234567', birthdate}}),
    apiKey: `pp_test_sbx_us_${'a'.repeat(48)}`,
    apiUrl: 'https://natzar.test/v1',
    log: (e) => logs.push(e.code),
    fetch: async (_url, init) => {
      mint = JSON.parse(init.body);
      return new Response('{"error":{"code":"unauthorized","message":"stop"}}', {status: 401});
    },
  });
  const res = await nz.fetch(new Request('https://p.test/natzar/session', {
    method: 'POST',
    headers: {'content-type': 'application/json', 'x-natzar-request': '1', origin: 'https://p.test', 'sec-fetch-site': 'same-origin'},
    body: JSON.stringify(ask),
  }));
  out[name] = {status: res.status, birthdate: mint?.patient?.birthdate ?? null, logs};
}
console.log(JSON.stringify(out));
