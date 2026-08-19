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

/** The resolved endpoints of one environment. */
export interface NatzarEndpoints {
  /**
   * Base URL of the REST API, INCLUDING the `/v1` version segment and without
   * a trailing slash — e.g. `https://api.natzar.ai/v1`. Every route in the
   * contract is appended to it verbatim.
   */
  baseUrl: string;
  /**
   * Origin that serves the embed script and the widget iframe
   * (`<origin>/embed/v1/embed.js`). Not used by the REST client itself; it is
   * here so a host page can get both halves of an integration from one config
   * object instead of hardcoding the second.
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
export const NATZAR_ENDPOINTS: Readonly<Record<NatzarEnvironment, NatzarEndpoints>> = {
  local: {
    baseUrl: 'http://localhost:5173/v1',
    embedOrigin: 'http://localhost:5173',
  },
  dev: {
    baseUrl: 'https://nzcmjra5c3.execute-api.us-east-2.amazonaws.com/v1',
    embedOrigin: 'https://dev.checkup.getmyhealthchecked.com',
  },
  stage: {
    baseUrl: 'https://sffiedz762.execute-api.us-east-2.amazonaws.com/v1',
    embedOrigin: 'https://stage.checkup.getmyhealthchecked.com',
  },
  prod: {
    baseUrl: 'https://gd4n95b4zl.execute-api.us-east-2.amazonaws.com/v1',
    embedOrigin: 'https://checkup.getmyhealthchecked.com',
  },
};

/** The environment a client uses when none is named. */
export const DEFAULT_ENVIRONMENT: NatzarEnvironment = 'prod';

/** True when `value` is one of the four environment names. */
export function isNatzarEnvironment(value: unknown): value is NatzarEnvironment {
  return typeof value === 'string' && (NATZAR_ENVIRONMENTS as readonly string[]).includes(value);
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
 *  3. the built-in table for `environment` (or `NATZAR_ENV`, if it names one);
 *  4. `prod`.
 *
 * The env-var layer is what makes one deployable artifact runnable against a
 * sandbox: nothing in your code changes between environments, and no build
 * needs to know which one it will be.
 */
export function resolveEndpoints(
  overrides: EndpointOverrides = {},
  processEnv: Record<string, string | undefined> = typeof process === 'undefined' ? {} : (process.env ?? {}),
): NatzarEndpoints & {environment: NatzarEnvironment} {
  const fromEnvVar = isNatzarEnvironment(processEnv.NATZAR_ENV) ? processEnv.NATZAR_ENV : undefined;
  const environment = overrides.environment ?? fromEnvVar ?? DEFAULT_ENVIRONMENT;
  const defaults = NATZAR_ENDPOINTS[environment];
  const baseUrl = overrides.baseUrl ?? processEnv.NATZAR_API_URL ?? defaults.baseUrl;
  const embedOrigin = overrides.embedOrigin ?? processEnv.NATZAR_EMBED_ORIGIN ?? defaults.embedOrigin;
  return {
    environment,
    baseUrl: normalizeBaseUrl(baseUrl),
    embedOrigin: normalizeBaseUrl(embedOrigin),
  };
}
