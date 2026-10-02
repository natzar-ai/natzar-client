// The environment table and its override chain — the one piece of this client
// that decides WHICH deployment a partner's traffic reaches, so getting it
// wrong is silent and expensive rather than loud.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ENVIRONMENT,
  DEFAULT_ZONE,
  NATZAR_ENDPOINTS,
  isNatzarEnvironment,
  normalizeBaseUrl,
  resolveEndpoints,
} from '../dist/esm/index.js';

const PROD_API = 'https://prod-api.execute-api.us-east-1.amazonaws.com/v1';

test('prod / us are the defaults', () => {
  assert.equal(DEFAULT_ENVIRONMENT, 'prod');
  assert.equal(DEFAULT_ZONE, 'us');
  const resolved = resolveEndpoints({baseUrl: PROD_API}, {});
  assert.equal(resolved.environment, 'prod');
  assert.equal(resolved.zone, 'us');
  // The table is keyed by environment AND residency zone: each jurisdiction is
  // its own deployment with its own API.
  assert.equal(resolved.baseUrl, PROD_API);
});

test('local points at localhost:5173', () => {
  const local = resolveEndpoints({environment: 'local'}, {});
  assert.equal(local.baseUrl, 'http://localhost:5173/v1');
  assert.equal(local.embedOrigin, 'http://localhost:5173');
});

test('the deployed embed origins are the Natzar app hosts, per zone', () => {
  // These are what a partner pastes into a <script src>, and what the widget
  // iframe is loaded from — a wrong host here is a blank widget on their page,
  // not an error anyone sees. Pin them.
  //
  // Every host names its RESIDENCY ZONE. There is deliberately no bare
  // `app.natzar.ai`: one origin cannot serve three regional backends, and a
  // default zone whose siblings carry prefixes needs a special case in every
  // consumer.
  assert.equal(resolveEndpoints({environment: 'prod', baseUrl: PROD_API}, {}).embedOrigin, 'https://us.app.natzar.ai');
  assert.equal(resolveEndpoints({environment: 'stage', baseUrl: PROD_API}, {}).embedOrigin, 'https://stage.us.app.natzar.ai');
  assert.equal(resolveEndpoints({environment: 'dev', baseUrl: PROD_API}, {}).embedOrigin, 'https://dev.us.app.natzar.ai');
});

test('an undeployed zone is refused, never silently served by another', () => {
  // The failure this prevents is the worst one available: a Canadian clinic's
  // integration quietly talking to the American deployment, which answers
  // "tenant not found" and reads like a data problem.
  assert.throws(
    () => resolveEndpoints({environment: 'prod', zone: 'ca'}, {}),
    /No built-in Natzar endpoints .* zone "ca"/,
  );
  // ...unless the caller supplies the endpoints themselves, so a new zone is
  // reachable the moment it exists rather than after a release of this package.
  const explicit = resolveEndpoints(
    {environment: 'prod', zone: 'ca', baseUrl: 'https://ca.example/v1', embedOrigin: 'https://ca.app.natzar.ai'},
    {},
  );
  assert.equal(explicit.zone, 'ca');
  assert.equal(explicit.baseUrl, 'https://ca.example/v1');
});

test('the zone comes from an env var when not passed in code', () => {
  assert.equal(resolveEndpoints({baseUrl: PROD_API}, {NATZAR_ZONE: 'us'}).zone, 'us');
  // An unrecognised value is ignored rather than trusted, and the default holds.
  assert.equal(resolveEndpoints({baseUrl: PROD_API}, {NATZAR_ZONE: 'nope'}).zone, 'us');
});

test('hosted US deployments require the new API URL instead of reaching the old region', () => {
  for (const environment of ['dev', 'stage', 'prod'] as const) {
    assert.equal(NATZAR_ENDPOINTS[environment].us?.baseUrl, undefined);
    assert.throws(() => resolveEndpoints({environment}, {}), /set NATZAR_API_URL/);
  }
  assert.throws(() => resolveEndpoints({key: `pp_live_us_${'a'.repeat(48)}`}, {}), /set NATZAR_API_URL/);
  const resolved = resolveEndpoints({}, {NATZAR_API_URL: PROD_API});
  assert.equal(resolved.baseUrl, PROD_API);
  assert.equal(resolved.embedOrigin, 'https://us.app.natzar.ai');
});

test('explicit options beat env vars beat the built-in table', () => {
  const env = {NATZAR_ENV: 'dev', NATZAR_API_URL: 'https://from-env.test/v1'};
  assert.equal(resolveEndpoints({}, env).baseUrl, 'https://from-env.test/v1');
  assert.equal(resolveEndpoints({}, env).environment, 'dev');
  assert.equal(
    resolveEndpoints({baseUrl: 'https://from-code.test/v1'}, env).baseUrl,
    'https://from-code.test/v1',
  );
});

test('a junk NATZAR_ENV falls back to prod rather than throwing', () => {
  assert.equal(resolveEndpoints({baseUrl: PROD_API}, {NATZAR_ENV: 'staging'}).environment, 'prod');
  assert.equal(isNatzarEnvironment('staging'), false);
  assert.equal(isNatzarEnvironment('stage'), true);
});

test('trailing slashes are stripped so paths never double up', () => {
  assert.equal(normalizeBaseUrl('https://x.test/v1///'), 'https://x.test/v1');
  assert.equal(resolveEndpoints({baseUrl: 'https://x.test/v1/'}, {}).baseUrl, 'https://x.test/v1');
});

// --- the key form (F87, F90) ------------------------------------------------

const K = 'a'.repeat(48);

test('resolveEndpoints({key}): the prefix names environment and zone; env vars cannot re-point it', () => {
  const live = resolveEndpoints({key: `pp_live_us_${K}`, baseUrl: PROD_API}, {NATZAR_ENV: 'dev', NATZAR_ZONE: 'ca'});
  assert.equal(live.environment, 'prod');
  assert.equal(live.zone, 'us');
  assert.equal(live.baseUrl, PROD_API);
  const stage = resolveEndpoints({key: `pp_test_stage_us_${K}`, baseUrl: PROD_API}, {});
  assert.equal(stage.environment, 'stage');
  assert.equal(stage.baseUrl, PROD_API);
});

test('resolveEndpoints({key}) refuses what is not a key, a disagreeing option, and an unpopulated zone', () => {
  for (const key of ['', 'pp_live_xx_' + K, 'pp_test_prod_us_' + K, 'pp_live_us_' + K.slice(1), 'sk_live_' + K, `pp_test_abcdefghijklmnop`]) {
    assert.throws(() => resolveEndpoints({key}, {}), /not a Natzar API key/, key.slice(0, 16));
  }
  assert.throws(() => resolveEndpoints({key: `pp_live_us_${K}`, environment: 'dev'}, {}), /disagrees with the key/);
  assert.throws(() => resolveEndpoints({key: `pp_live_us_${K}`, zone: 'eu'}, {}), /disagrees with the key/);
  // No built-in deployment: never served by another zone.
  assert.throws(() => resolveEndpoints({key: `pp_live_ca_${K}`}, {}), /No built-in Natzar endpoints .*zone "ca"/);
  assert.throws(() => resolveEndpoints({key: `pp_test_sbx_us_${K}`}, {}), /sandbox key needs NATZAR_API_URL/);
});

test('resolveEndpoints({key}): a sandbox needs only NATZAR_API_URL; the key still names the zone', () => {
  const sbx = resolveEndpoints({key: `pp_test_sbx_eu_${K}`}, {NATZAR_API_URL: 'https://sbx.example/v1/'});
  assert.deepEqual(sbx, {environment: 'sbx', zone: 'eu', baseUrl: 'https://sbx.example/v1'});
  // An explicit baseUrl wins over the env var, as in the explicit form.
  assert.equal(resolveEndpoints({key: `pp_live_ca_${K}`, baseUrl: 'https://ca.example/v1'}, {NATZAR_API_URL: 'https://x.example/v1'}).baseUrl, 'https://ca.example/v1');
});
