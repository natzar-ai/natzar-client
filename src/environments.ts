/**
 * The Natzar environments, and how a client resolves which one it is talking
 * to — from an API key's prefix (`resolveEndpoints({key})`), or explicitly.
 *
 * `prod` is the default on purpose. A client that silently defaults to a test
 * environment is the kind of thing you discover in production, when nothing
 * has been happening for a week; a client that defaults to production is
 * discovered on the first call, by a `pp_test_…` key coming back `401`. The
 * failure that shows up immediately is the better default.
 *
 * @packageDocumentation
 */

import {parseApiKey} from './contract/sessions';

/**
 * Which Natzar deployment a client talks to. `sbx` is every sandbox: it has
 * no built-in endpoints, so it always comes with `NATZAR_API_URL` (or an
 * explicit `baseUrl`).
 */
export type NatzarEnvironment = 'local' | 'dev' | 'stage' | 'prod' | 'sbx';

/** Every environment name, for validation and for enumerating in a UI. */
export const NATZAR_ENVIRONMENTS = ['local', 'dev', 'stage', 'prod', 'sbx'] as const satisfies readonly NatzarEnvironment[];

/**
 * Which RESIDENCY ZONE a client talks to.
 *
 * Natzar is deployed once per jurisdiction, not once globally: a Canadian
 * clinic's patient data may not leave Canada, so its backend is a separate
 * deployment in a separate region with its own API and its own app host. An
 * integration is therefore addressed by BOTH an environment and a zone.
 *
 * You want the zone your CLINIC is in. Pointing a Canadian clinic's
 * integration at the US zone does not fall back or proxy — the tenant simply
 * does not exist there.
 */
export type NatzarZone = 'us' | 'ca' | 'eu';

/** Every zone name, for validation and for enumerating in a UI. */
export const NATZAR_ZONES = ['us', 'ca', 'eu'] as const satisfies readonly NatzarZone[];

/** The resolved endpoints of one environment. */
export interface NatzarEndpoints {
  /**
   * Base URL of the REST API, INCLUDING the `/v1` version segment and without
   * a trailing slash — e.g. `https://api.natzar.ai/v1`. Every route in the
   * contract is appended to it verbatim.
   */
  baseUrl: string;
  /**
   * Origin of the Natzar web app — the host that serves the embed script and
   * the widget iframe (`<origin>/embed/v1/embed.js`, `<origin>/embed.html`),
   * plus the patient-facing `/telehealth` and `/async` pages that invite links
   * point at. Not used by the REST client itself; it is here so a host page can
   * get both halves of an integration from one config object instead of
   * hardcoding the second.
   *
   * Deliberately a DIFFERENT host from {@link baseUrl}: the app is static
   * hosting (Amplify/CloudFront) and the REST API is API Gateway. They are not
   * behind one domain, and pointing this at the API (or vice versa) yields
   * 403s that read like credential problems.
   *
   * Absent only in the key form of {@link resolveEndpoints} for a deployment
   * with no built-in entry (a sandbox reached through `NATZAR_API_URL`): the
   * embed script's address then comes from `GET /v1/embed/config`, which is
   * what the `natzar()` middleware uses anyway.
   */
  embedOrigin?: string;
}

/**
 * Built-in endpoints per environment.
 *
 * US API URLs are supplied through NATZAR_API_URL or baseUrl during the
 * move to us-east-1. API Gateway IDs belong to the old deployment and
 * cannot be reused in a different region. Populate these entries from
 * the new deployment outputs after its first successful deploy. The
 * stable app hosts remain available for embedOrigin resolution.
 *
 * `local` points at `http://localhost:5173` — the provider portal's own Vite
 * dev server, which serves the embed script and the widget page. A local REST
 * API normally lives somewhere else (a deployed sandbox, a proxy), so pass
 * `baseUrl` (or set `NATZAR_API_URL`) when running against one; the override
 * chain in {@link resolveEndpoints} exists precisely for that case and is the
 * ONLY thing you need to change between a sandbox and a real environment.
 */
export const NATZAR_ENDPOINTS: Readonly<
  Record<NatzarEnvironment, Partial<Record<NatzarZone, Partial<NatzarEndpoints>>>>
> = {
  local: {
    us: {
      baseUrl: 'http://localhost:5173/v1',
      embedOrigin: 'http://localhost:5173',
    },
  },
  dev: {
    us: {
      embedOrigin: 'https://dev.us.app.natzar.ai',
    },
  },
  stage: {
    us: {
      embedOrigin: 'https://stage.us.app.natzar.ai',
    },
  },
  prod: {
    us: {
      embedOrigin: 'https://us.app.natzar.ai',
    },
    // `ca` and `eu` are deliberately ABSENT rather than guessed. Each zone is
    // its own deployment with its own API Gateway id, knowable only once that
    // deployment exists; a plausible-looking placeholder would fail as a 403
    // that reads exactly like a credential problem. Asking for a zone that is
    // not here throws a message that says so.
    //
    // `ca` (ca-central-1) is being stood up: once its first deploy has run,
    // add it here from that deployment's `amplify_outputs.json` `custom.API`
    // with `embedOrigin: 'https://app.ca.natzar.ai'` (docs/RESIDENCY-ZONES.md,
    // step 11). Until then, callers reach it by passing `baseUrl` +
    // `embedOrigin` explicitly.
  },
  // Every sandbox is its own stack with its own API id: nothing to build in.
  // A sandbox key (`pp_test_sbx_<zone>_…`) always comes with NATZAR_API_URL.
  sbx: {},
};

/** The environment a client uses when none is named. */
export const DEFAULT_ENVIRONMENT: NatzarEnvironment = 'prod';

/**
 * The zone a client uses when none is named.
 *
 * Unlike the environment default — where guessing production is the *safer*
 * error, because a test key fails loudly on the first call — a wrong zone
 * fails as "tenant not found", which reads like a data problem rather than a
 * configuration one. So the default is the only zone that has ever been the
 * whole platform, and every other zone must be asked for by name.
 */
export const DEFAULT_ZONE: NatzarZone = 'us';

/** True when `value` is one of the four environment names. */
export function isNatzarEnvironment(value: unknown): value is NatzarEnvironment {
  return typeof value === 'string' && (NATZAR_ENVIRONMENTS as readonly string[]).includes(value);
}

/** True when `value` is one of the residency-zone names. */
export function isNatzarZone(value: unknown): value is NatzarZone {
  return typeof value === 'string' && (NATZAR_ZONES as readonly string[]).includes(value);
}

/**
 * Trim a base URL to the shape the request builder expects: no trailing
 * slashes.
 *
 * Not cosmetic. A trailing slash produces `/v1//patients`, which API Gateway
 * routes to nothing and answers with a bare 403 that reads exactly like a
 * credential problem — an afternoon lost to a character. Same class of bug as
 * a newline on the end of an API key, so both are normalized at the boundary.
 */
export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** Overrides accepted when resolving endpoints. Each wins over the built-in. */
export interface EndpointOverrides {
  /**
   * An API key (`pp_live_<zone>_…` / `pp_test_<env>_<zone>_…`). Its prefix
   * NAMES the deployment, so with a key the environment and zone are derived
   * from it rather than chosen: `NATZAR_ENV` / `NATZAR_ZONE` are ignored, an
   * explicit `environment` or `zone` that disagrees with the key throws, and a
   * value that is not a key throws. `baseUrl` / `NATZAR_API_URL` still win
   * over the built-in table (a sandbox needs only `NATZAR_API_URL`).
   */
  key?: string;
  /** Which environment's defaults to start from. Default `prod`. */
  environment?: NatzarEnvironment;
  /** Which residency zone's deployment to talk to. Default `us`. */
  zone?: NatzarZone;
  /** Explicit REST base URL, including `/v1`. Wins over the environment. */
  baseUrl?: string;
  /** Explicit embed origin. Wins over the environment. */
  embedOrigin?: string;
}

/** Resolved endpoints, plus the environment and zone they belong to. */
export type ResolvedEndpoints = NatzarEndpoints & {environment: NatzarEnvironment; zone: NatzarZone};

/**
 * Resolve the endpoints a client should use.
 *
 * **Key form** (`{key}`): the key prefix names the environment and zone
 * (F87, F90). `baseUrl` comes from an explicit value, then `NATZAR_API_URL`,
 * then the built-in table; a deployment with none of the three throws (an
 * unpopulated zone is never served by another one). `embedOrigin` is
 * optional here.
 *
 * **Explicit form** (no `key`), precedence highest first:
 *  1. an explicit `baseUrl` / `embedOrigin` passed in code;
 *  2. `NATZAR_API_URL` / `NATZAR_EMBED_ORIGIN` in the process environment;
 *  3. the built-in table for (`environment`, `zone`) — or `NATZAR_ENV` /
 *     `NATZAR_ZONE`, if they name one;
 *  4. `prod` / `us`.
 *
 * The env-var layer is what makes one deployable artifact runnable against a
 * sandbox: nothing in your code changes between environments, and no build
 * needs to know which one it will be.
 *
 * An explicit `baseUrl` and `embedOrigin` together satisfy the whole
 * resolution, so a zone with no built-in entry is still reachable the moment
 * its deployment exists — you do not have to wait for a release of this
 * package.
 */
export function resolveEndpoints(
  overrides: EndpointOverrides = {},
  processEnv: Record<string, string | undefined> = typeof process === 'undefined' ? {} : (process.env ?? {}),
): ResolvedEndpoints {
  if (overrides.key !== undefined) return resolveFromKey(overrides.key, overrides, processEnv);

  const fromEnvVar = isNatzarEnvironment(processEnv.NATZAR_ENV) ? processEnv.NATZAR_ENV : undefined;
  const environment = overrides.environment ?? fromEnvVar ?? DEFAULT_ENVIRONMENT;
  const zoneFromEnvVar = isNatzarZone(processEnv.NATZAR_ZONE) ? processEnv.NATZAR_ZONE : undefined;
  const zone = overrides.zone ?? zoneFromEnvVar ?? DEFAULT_ZONE;

  const defaults = NATZAR_ENDPOINTS[environment][zone];
  const baseUrl = overrides.baseUrl ?? processEnv.NATZAR_API_URL ?? defaults?.baseUrl;
  const embedOrigin = overrides.embedOrigin ?? processEnv.NATZAR_EMBED_ORIGIN ?? defaults?.embedOrigin;

  // Named a zone that has no deployment yet and gave no explicit URLs. Saying
  // so beats falling back to another jurisdiction, which would send a Canadian
  // clinic's traffic to the United States and answer "tenant not found".
  if (!baseUrl || !embedOrigin) {
    const available = Object.entries(NATZAR_ENDPOINTS[environment]).filter(([, entry]) => entry?.baseUrl).map(([id]) => id).join(', ') || 'none';
    throw new Error(
      `No built-in Natzar endpoints for environment "${environment}" in residency zone "${zone}" ` +
        `(available: ${available}). That zone may not be deployed yet — pass baseUrl and embedOrigin ` +
        `explicitly, or set NATZAR_API_URL and NATZAR_EMBED_ORIGIN.`,
    );
  }

  return {
    environment,
    zone,
    baseUrl: normalizeBaseUrl(baseUrl),
    embedOrigin: normalizeBaseUrl(embedOrigin),
  };
}

// The key form. The prefix is the deployment (§4.9): a live key is `prod` in
// its zone, a test key names `dev`, `stage` or `sbx` and a zone. Never
// printed: an error names the prefix shape, not the value.
function resolveFromKey(
  key: string,
  overrides: EndpointOverrides,
  processEnv: Record<string, string | undefined>,
): ResolvedEndpoints {
  const parsed = parseApiKey(typeof key === 'string' ? key.trim() : key);
  if (!parsed) {
    throw new Error(
      'natzar-client: the key is not a Natzar API key (pp_live_<zone>_… or pp_test_<env>_<zone>_…); ' +
        'its prefix selects the deployment. If it came from a secret manager, the secret most likely did not resolve.',
    );
  }
  const environment: NatzarEnvironment = parsed.environment;
  const zone: NatzarZone = parsed.zone;
  if (overrides.environment !== undefined && overrides.environment !== environment) {
    throw new Error(`natzar-client: environment "${overrides.environment}" disagrees with the key, which belongs to "${environment}".`);
  }
  if (overrides.zone !== undefined && overrides.zone !== zone) {
    throw new Error(`natzar-client: zone "${overrides.zone}" disagrees with the key, which belongs to zone "${zone}".`);
  }
  const defaults = NATZAR_ENDPOINTS[environment][zone];
  const baseUrl = overrides.baseUrl ?? processEnv.NATZAR_API_URL ?? defaults?.baseUrl;
  const embedOrigin = overrides.embedOrigin ?? processEnv.NATZAR_EMBED_ORIGIN ?? defaults?.embedOrigin;
  if (!baseUrl) {
    const available = Object.entries(NATZAR_ENDPOINTS[environment]).filter(([, entry]) => entry?.baseUrl).map(([id]) => id).join(', ') || 'none';
    throw new Error(
      `No built-in Natzar endpoints for this key's deployment (environment "${environment}", residency zone "${zone}"; ` +
        `available: ${available}). ` +
        (environment === 'sbx'
          ? 'A sandbox key needs NATZAR_API_URL (the sandbox API, through /v1).'
          : 'That zone may not be deployed yet — set NATZAR_API_URL (or pass baseUrl) once it is.'),
    );
  }
  return {
    environment,
    zone,
    baseUrl: normalizeBaseUrl(baseUrl),
    ...(embedOrigin ? {embedOrigin: normalizeBaseUrl(embedOrigin)} : {}),
  };
}
