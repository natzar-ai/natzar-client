// GENERATED FILE — do not edit.
//
// Copied verbatim from natzar-core's shared/partner-api by
// scripts/sync-contract.mjs. Edit the source there; this copy exists only so
// the published package is self-contained.
/**
 * Canonical platform web app origins. App hostnames are explicit deployment
 * settings; they are not derived from a zone's intake/embed DNS prefix.
 * Canada dev/stage and EU hosts are not configured. Never route those zones
 * through a US app as a fallback.
 */
export const PLATFORM_APP_ORIGINS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  local: {us: 'http://localhost:5173'},
  dev: {us: 'https://app-dev.natzar.dev'},
  stage: {us: 'https://app-stage.natzar.dev'},
  prod: {us: 'https://app.natzar.ai', ca: 'https://app.ca.natzar.ai'},
};

/**
 * Canonical REST API origins, one per hosted deployment. The REST base is
 * `<origin>/v1`. Each deploy registers its own host (certificate, API Gateway
 * custom domain, Route 53 alias; amplify/api-domain.ts), so these never
 * change when a backend is recreated. A different host from the app on
 * purpose: Amplify Hosting does not proxy the API. Sandboxes have none and
 * use their own execute-api URL. Same rule as the app: an unconfigured zone
 * has no API here, never another zone's.
 */
export const PLATFORM_API_ORIGINS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  dev: {us: 'https://api-dev.natzar.dev'},
  stage: {us: 'https://api-stage.natzar.dev'},
  prod: {us: 'https://api.natzar.ai', ca: 'https://api.ca.natzar.ai'},
};

function originIn(table: Readonly<Record<string, Readonly<Record<string, string>>>>, environment: string, zone: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(table, environment)) return null;
  const zones = table[environment];
  return Object.prototype.hasOwnProperty.call(zones, zone) ? zones[zone] : null;
}

/** Null means this environment/zone has no configured platform web app. */
export function platformAppOrigin(environment: string, zone: string): string | null {
  return originIn(PLATFORM_APP_ORIGINS, environment, zone);
}

/** Null means this environment/zone has no registered API host (sandboxes, unconfigured zones). */
export function platformApiOrigin(environment: string, zone: string): string | null {
  return originIn(PLATFORM_API_ORIGINS, environment, zone);
}

/** Platform app hosts, for branding and domain ownership checks. */
export const PLATFORM_APP_HOSTS: readonly string[] = Object.values(PLATFORM_APP_ORIGINS)
  .flatMap((zones) => Object.values(zones))
  .map((origin) => new URL(origin).hostname);

/** Tenant label position under a configured app's domain (including ca.natzar.ai). */
export function platformTenantLabelIndex(host: string): number | null {
  const labels = host.split('.');
  const suffixes = PLATFORM_APP_HOSTS.filter((appHost) => appHost.includes('.'))
    .map((appHost) => appHost.split('.').slice(1).join('.'))
    .sort((a, b) => b.length - a.length);
  const suffix = suffixes.find((domain) => host.endsWith(`.${domain}`));
  return suffix ? labels.length - suffix.split('.').length - 1 : null;
}

/** Hosted app hosts and their subdomains cannot also serve a dedicated frame. */
export function isHostedPlatformAppHost(host: string): boolean {
  return PLATFORM_APP_HOSTS.some((appHost) => appHost !== 'localhost'
    && (host === appHost || host.endsWith(`.${appHost}`)));
}
