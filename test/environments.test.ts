// The environment table and its override chain — the one piece of this client
// that decides WHICH deployment a partner's traffic reaches, so getting it
// wrong is silent and expensive rather than loud.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ENVIRONMENT,
  NATZAR_ENDPOINTS,
  isNatzarEnvironment,
  normalizeBaseUrl,
  resolveEndpoints,
} from '../dist/esm/index.js';

test('prod is the default environment', () => {
  assert.equal(DEFAULT_ENVIRONMENT, 'prod');
  assert.equal(resolveEndpoints({}, {}).environment, 'prod');
  assert.equal(resolveEndpoints({}, {}).baseUrl, NATZAR_ENDPOINTS.prod.baseUrl);
});

test('local points at localhost:5173', () => {
  const local = resolveEndpoints({environment: 'local'}, {});
  assert.equal(local.baseUrl, 'http://localhost:5173/v1');
  assert.equal(local.embedOrigin, 'http://localhost:5173');
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
