/**
 * The four Natzar environments, and how a client resolves which one it is
 * talking to.
 *
 * `prod` is the default on purpose. A client that silently defaults to a test
 * environment is the kind of thing you discover in production, when nothing
 * has been happening for a week; a client that defaults to production is
 * discovered on the first call, by a `pp_test_…` key coming back `401`. The
 * failure that shows up immediately is the better default.
 *
 * @packageDocumentation
 */

/** Which Natzar deployment a client talks to. */
export type NatzarEnvironment = 'local' | 'dev' | 'stage' | 'prod';

/** Every environment name, for validation and for enumerating in a UI. */
export const NATZAR_ENVIRONMENTS = ['local', 'dev', 'stage', 'prod'] as const satisfies readonly NatzarEnvironment[];

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
   */
  embedOrigin: string;
}

/**
 * Built-in endpoints per environment.
 *
 * `local` points at `http://localhost:5173` — the provider portal's own Vite
 * dev server, which serves the embed script and the widget page. A local REST
 * API normally lives somewhere else (a deployed sandbox, a proxy), so pass
 * `baseUrl` (or set `NATZAR_API_URL`) when running against one; the override
 * chain in {@link resolveEndpoints} exists precisely for that case and is the
 * ONLY thing you need to change between a sandbox and a real environment.
 */
export const NATZAR_ENDPOINTS: Readonly<
  Record<NatzarEnvironment, Partial<Record<NatzarZone, NatzarEndpoints>>>
> = {
  local: {
    us: {
      baseUrl: 'http://localhost:5173/v1',
      embedOrigin: 'http://localhost:5173',
    },
  },
  dev: {
    us: {
      baseUrl: 'https://nzcmjra5c3.execute-api.us-east-2.amazonaws.com/v1',
      embedOrigin: 'https://dev.us.app.natzar.ai',
    },
  },
  stage: {
    us: {
      baseUrl: 'https://sffiedz762.execute-api.us-east-2.amazonaws.com/v1',
      embedOrigin: 'https://stage.us.app.natzar.ai',
    },
  },
  prod: {
    us: {
      baseUrl: 'https://gd4n95b4zl.execute-api.us-east-2.amazonaws.com/v1',
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
    // with `embedOrigin: 'https://ca.app.natzar.ai'` (docs/RESIDENCY-ZONES.md,
    // step 11). Until then, callers reach it by passing `baseUrl` +
    // `embedOrigin` explicitly.
  },
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
  /** Which environment's defaults to start from. Default `prod`. */
  environment?: NatzarEnvironment;
  /** Which residency zone's deployment to talk to. Default `us`. */
  zone?: NatzarZone;
  /** Explicit REST base URL, including `/v1`. Wins over the environment. */
  baseUrl?: string;
  /** Explicit embed origin. Wins over the environment. */
  embedOrigin?: string;
}

/**
 * Resolve the endpoints a client should use.
 *
 * Precedence, highest first:
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
): NatzarEndpoints & {environment: NatzarEnvironment; zone: NatzarZone} {
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
    const available = Object.keys(NATZAR_ENDPOINTS[environment]).join(', ') || 'none';
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
