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

test('prod / us are the defaults', () => {
  assert.equal(DEFAULT_ENVIRONMENT, 'prod');
  assert.equal(DEFAULT_ZONE, 'us');
  const resolved = resolveEndpoints({}, {});
  assert.equal(resolved.environment, 'prod');
  assert.equal(resolved.zone, 'us');
  // The table is keyed by environment AND residency zone: each jurisdiction is
  // its own deployment with its own API.
  assert.equal(resolved.baseUrl, NATZAR_ENDPOINTS.prod.us?.baseUrl);
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
  assert.equal(resolveEndpoints({environment: 'prod'}, {}).embedOrigin, 'https://us.app.natzar.ai');
  assert.equal(resolveEndpoints({environment: 'stage'}, {}).embedOrigin, 'https://stage.us.app.natzar.ai');
  assert.equal(resolveEndpoints({environment: 'dev'}, {}).embedOrigin, 'https://dev.us.app.natzar.ai');
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
  assert.equal(resolveEndpoints({}, {NATZAR_ZONE: 'us'}).zone, 'us');
  // An unrecognised value is ignored rather than trusted, and the default holds.
  assert.equal(resolveEndpoints({}, {NATZAR_ZONE: 'nope'}).zone, 'us');
});

test('all four environments are addressable and distinct', () => {
  const urls = (['local', 'dev', 'stage', 'prod'] as const).map(
    (environment) => resolveEndpoints({environment}, {}).baseUrl,
  );
  assert.equal(new Set(urls).size, 4);
  for (const url of urls) assert.match(url, /^https?:\/\/.+\/v1$/);
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
  assert.equal(resolveEndpoints({}, {NATZAR_ENV: 'staging'}).environment, 'prod');
  assert.equal(isNatzarEnvironment('staging'), false);
  assert.equal(isNatzarEnvironment('stage'), true);
});

test('trailing slashes are stripped so paths never double up', () => {
  assert.equal(normalizeBaseUrl('https://x.test/v1///'), 'https://x.test/v1');
  assert.equal(resolveEndpoints({baseUrl: 'https://x.test/v1/'}, {}).baseUrl, 'https://x.test/v1');
});
