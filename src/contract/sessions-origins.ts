// GENERATED FILE — do not edit.
//
// Copied verbatim from natzar-core's shared/partner-api by
// scripts/sync-contract.mjs. Edit the source there; this copy exists only so
// the published package is self-contained.
/**
 * Embedding origins (docs/EMBED-INTEGRATION-REDESIGN-PLAN.md §4.8, D3): the
 * rules `PUT /v1/embed/origins` and the console validate a partner's list
 * with, and how a page origin is matched against it. The list is ENFORCED for
 * both audiences: at mint (`parentOrigin`), in `frame-ancestors` and in the
 * frame's bind. An empty list means embedding is off.
 *
 * Entries of `origins`:
 * - an exact origin, `https://portal.acme.com` (any port written explicitly);
 * - a patient wildcard, `https://*.acme.com`: one leading label, https only,
 *   never over a public suffix (so `https://*.vercel.app` and
 *   `https://*.co.uk` are refused). The check FAILS CLOSED: a wildcard is
 *   accepted only when an authoritative public-suffix list
 *   ({@link createPublicSuffixList}, fed the owner-approved PSL snapshot) says
 *   its base is registrable; the embedded {@link PUBLIC_SUFFIXES} subset is a
 *   floor that can only refuse more (RG0 F3);
 * - outside production only, a local development origin: `http(s)://localhost`,
 *   any `*.localhost` or `127.0.0.1`, with an optional port or the port
 *   wildcard `:*`. Special-use names (`.test`, `.local`, `.internal`, …) are
 *   refused in production.
 *
 * Wildcards (host or port) serve PATIENT frames only; clinicians match exact
 * entries.
 *
 * `nativeOrigins` holds native-shell origins ({@link NATIVE_SHELL_ORIGINS}).
 * They are the only way to list those in production, and a session for them
 * is minted only for a bearer-authenticated request (`requestAuth: 'bearer'`).
 * `*.natzar.ai` is forbidden everywhere; `*.natzar.dev` is NOT (see
 * {@link FORBIDDEN_EMBED_DOMAINS}). Null-origin WebViews are unsupported.
 *
 * Every entry must be written exactly as the URL parser serializes it: lower
 * case, punycode, no path, query, fragment, credentials, trailing dot or
 * default port. Validation never repairs a value.
 *
 * Pure and dependency-free (no zod, no DOM types); `./sessions-schemas`
 * wraps {@link validateEmbedOrigins} into the route's zod schema.
 *
 * @packageDocumentation
 */

import {isLocalDevHost, type SessionAudience} from './sessions';

/** Default cap of a partner's `origins` + `nativeOrigins`. */
export const EMBED_ORIGINS_DEFAULT_MAX = 100;
/** The most an operator can raise the cap to. */
export const EMBED_ORIGINS_OPERATOR_MAX = 500;
/** Longest accepted entry. */
export const EMBED_ORIGIN_MAX_LENGTH = 255;
/**
 * Origins native shells load their web content from (Capacitor on iOS, Ionic,
 * and Capacitor on Android with `androidScheme: 'https'`). Accepted only in
 * `nativeOrigins`.
 */
export const NATIVE_SHELL_ORIGINS = ['capacitor://localhost', 'ionic://localhost', 'https://localhost'] as const;
/** The platform's own domain: no entry may be it or under it. */
export const FORBIDDEN_EMBED_DOMAIN = 'natzar.ai' as const;
/**
 * The domains a partner origin policy can never name, nor any subdomain of.
 * `natzar.dev` is deliberately absent: its dev/stage app hosts
 * (https://app-dev.natzar.dev) also serve the live demo pages
 * (demo/live-demo), which embed the widget exactly as a partner page does and
 * so must be admissible origins. The embed frames themselves stay reserved
 * through the deployment's own frame origins (`reservedOrigins`).
 */
export const FORBIDDEN_EMBED_DOMAINS = [FORBIDDEN_EMBED_DOMAIN] as const;
/** Local development hosts, accepted outside production only (and every `*.localhost`, RFC 6761). */
export const LOCAL_DEV_HOSTS = ['localhost', '127.0.0.1'] as const;
/**
 * Special-use and never-delegated names (RFC 2606, 6761, 6762, 7686, 8375,
 * 9476; ICANN `internal` and the name-collision `corp`, `home`, `mail`): an
 * origin at or under one is refused in production, exact or wildcard.
 */
export const SPECIAL_USE_DOMAINS = [
  'localhost', 'test', 'example', 'invalid', 'local', 'home.arpa', 'onion', 'alt', 'internal', 'corp', 'home', 'mail',
] as const;

/** Whether `host` is, or is under, a special-use name. */
export function isSpecialUseHost(host: string): boolean {
  return SPECIAL_USE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * PUBLIC SUFFIXES — the FLOOR: a conservative subset of the Public Suffix List
 * (https://publicsuffix.org/list/), embedded because this contract ships
 * without dependencies. It can only refuse more: the authoritative decision
 * is the injected full list ({@link createPublicSuffixList}), and without
 * that list every wildcard is refused (`public_suffix_unverified`). A
 * wildcard `https://*.<base>` is refused when `<base>` IS one of these: every
 * name below it belongs to a different customer. `<base>` UNDER one
 * (`https://*.acme.vercel.app`) is a registrable domain, as with the real list.
 *
 * The subset covers (1) multi-label country suffixes in common use and (2)
 * the shared-hosting platforms partners actually deploy on. Single-label
 * suffixes (`com`, `app`, `uk`, …) need no entry: a base with fewer than two
 * labels is always refused. {@link CCTLD_SECOND_LEVEL_LABELS} additionally
 * refuses any `<generic label>.<2-letter ccTLD>` base, which catches country
 * suffixes missing here.
 *
 * TO EXTEND: add the suffix exactly as the PSL spells it (lower case,
 * punycode). A PSL wildcard rule (`*.foo.example`) whose children are all
 * suffixes goes in {@link PUBLIC_SUFFIX_FAMILIES} instead. Keep one entry per
 * line group and add an accept/reject case to
 * shared/partner-api/__tests__/sessions-origins.test.ts.
 */
export const PUBLIC_SUFFIXES: ReadonlySet<string> = new Set([
  // United Kingdom, Ireland
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk', 'ac.uk', 'gov.uk', 'nhs.uk', 'police.uk',
  // Australia, New Zealand
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au', 'asn.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz', 'geek.nz', 'school.nz',
  // Canada (provinces and territories)
  'ab.ca', 'bc.ca', 'mb.ca', 'nb.ca', 'nf.ca', 'nl.ca', 'ns.ca', 'nt.ca', 'nu.ca', 'on.ca', 'pe.ca', 'qc.ca', 'sk.ca',
  'yk.ca', 'gc.ca',
  // Europe
  'co.at', 'or.at', 'gv.at', 'ac.at', 'com.pl', 'net.pl', 'org.pl', 'com.es', 'org.es', 'nom.es', 'com.pt',
  'com.gr', 'com.cy', 'com.mt', 'co.hu', 'com.ro', 'com.ua', 'co.ua', 'com.tr', 'gen.tr', 'co.it', 'gov.it',
  'asso.fr', 'gouv.fr', 'com.fr', 'co.no', 'priv.no',
  // Asia and the Middle East
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'com.hk', 'org.hk',
  'com.tw', 'org.tw', 'co.kr', 'or.kr', 'com.sg', 'edu.sg', 'gov.sg', 'com.my', 'com.ph', 'co.id', 'co.th',
  'com.vn', 'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in', 'ind.in', 'com.pk', 'co.il', 'org.il', 'com.sa',
  'co.ae',
  // Americas, Africa
  'com.br', 'net.br', 'org.br', 'gov.br', 'com.mx', 'org.mx', 'gob.mx', 'com.ar', 'com.co', 'com.pe', 'cl.cl',
  'co.za', 'org.za', 'gov.za', 'com.ng', 'co.ke',
  // Shared hosting and app platforms (PSL private section)
  'vercel.app', 'now.sh', 'netlify.app', 'github.io', 'gitlab.io', 'herokuapp.com', 'pages.dev', 'workers.dev',
  'web.app', 'firebaseapp.com', 'amplifyapp.com', 'cloudfront.net', 'azurewebsites.net', 'azurestaticapps.net',
  'azureedge.net', 'cloudapp.net', 'appspot.com', 'blogspot.com', 'glitch.me', 'onrender.com', 'fly.dev',
  'up.railway.app', 'surge.sh', 'deno.dev', 'repl.co', 'replit.app', 'replit.dev', 'wixsite.com', 'myshopify.com',
  'squarespace.com', 'webflow.io', 'bubbleapps.io', 'framer.app', 'fly.io', 'stackblitz.io', 'codesandbox.io',
]);

/**
 * Domains whose names are ALL provider-assigned: a wildcard base at or under
 * one of these is always refused (a conservative stand-in for the many PSL
 * rules below them, e.g. `*.compute.amazonaws.com`, `a.run.app`).
 */
export const PUBLIC_SUFFIX_FAMILIES: readonly string[] = [
  'amazonaws.com', 'elasticbeanstalk.com', 'awsapps.com', 'on.aws', 'cloudapp.azure.com', 'azurecontainerapps.io',
  'googleusercontent.com', 'cloudfunctions.net', 'run.app', 'ngrok.io', 'ngrok.app', 'ngrok-free.app',
  'trycloudflare.com', 'loca.lt',
];

/**
 * Generic second-level labels of country TLDs (`com.xx`, `co.xx`, `gov.xx`,
 * …): a two-label base `<label>.<2-letter TLD>` with one of these labels is
 * treated as a public suffix even when {@link PUBLIC_SUFFIXES} lacks it.
 */
export const CCTLD_SECOND_LEVEL_LABELS: ReadonlySet<string> = new Set([
  'ac', 'co', 'com', 'edu', 'firm', 'gen', 'gob', 'gouv', 'gov', 'govt', 'go', 'ind', 'ltd', 'mil', 'ne', 'net', 'nhs',
  'nic', 'nom', 'or', 'org', 'plc', 'sch',
]);

/**
 * The FLOOR check: whether `domain` (lower case, no trailing dot) is a public
 * suffix by the embedded subset. Not authoritative; see
 * {@link createPublicSuffixList}.
 */
export function isPublicSuffix(domain: string): boolean {
  if (PUBLIC_SUFFIXES.has(domain)) return true;
  const labels = domain.split('.');
  if (labels.length === 2 && /^[a-z]{2}$/.test(labels[1]) && CCTLD_SECOND_LEVEL_LABELS.has(labels[0])) return true;
  return PUBLIC_SUFFIX_FAMILIES.some((f) => domain === f || domain.endsWith(`.${f}`));
}

/**
 * An AUTHORITATIVE public-suffix check: true when `domain` (lower case,
 * punycode, no trailing dot) is itself a public suffix, i.e. has no
 * registrable part.
 */
export type PublicSuffixPredicate = (domain: string) => boolean;

/** A rule label or domain in the URL parser's ASCII form, or null. */
function asciiDomain(domain: string): string | null {
  try {
    const host = new URL(`http://${domain}`).hostname;
    return host.length > 0 && !host.endsWith('.') && !host.includes('%') ? host : null;
  } catch {
    return null;
  }
}

/**
 * THE HOOK FOR THE FULL LIST: builds an authoritative
 * {@link PublicSuffixPredicate} from the lines of a Public Suffix List file
 * (`public_suffix_list.dat`: ICANN and PRIVATE sections, `//` comments,
 * `*.` wildcard and `!` exception rules, Unicode rules converted to
 * punycode). It implements the PSL algorithm: an exception rule prevails,
 * otherwise the longest matching rule, otherwise the implicit `*`.
 *
 * The snapshot itself is owner-supplied (no agent fetches it): a pinned,
 * dated data module on the SERVER side, never imported by the loader, passed
 * as `publicSuffixList` to {@link validateEmbedOrigins} /
 * `putEmbedOriginsSchema`. RG1 gates the origins route on it.
 */
export function createPublicSuffixList(lines: Iterable<string>): PublicSuffixPredicate {
  const rules = new Set<string>();
  const wildcardParents = new Set<string>();
  const exceptions = new Set<string>();
  for (const raw of lines) {
    const token = raw.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    if (token === '' || token.startsWith('//')) continue;
    if (token.startsWith('!')) {
      const rule = asciiDomain(token.slice(1));
      if (rule) exceptions.add(rule);
    } else if (token.startsWith('*.')) {
      const parent = asciiDomain(token.slice(2));
      if (parent && !parent.includes('*')) wildcardParents.add(parent);
    } else if (!token.includes('*')) {
      const rule = asciiDomain(token);
      if (rule) rules.add(rule);
    }
  }
  return (domain: string): boolean => {
    const labels = domain.split('.');
    const n = labels.length;
    for (let i = 0; i < n; i++) {
      // An exception rule prevails. Its public suffix is the rule minus its leftmost label, so
      // strictly shorter than `domain`: `domain` is then never itself a public suffix.
      if (exceptions.has(labels.slice(i).join('.'))) return false;
    }
    let longest = 1; // the implicit "*" rule
    for (let i = 0; i < n; i++) {
      const len = n - i;
      if (rules.has(labels.slice(i).join('.'))) longest = Math.max(longest, len);
      if (i + 1 < n && wildcardParents.has(labels.slice(i + 1).join('.'))) longest = Math.max(longest, len);
    }
    return longest >= n;
  };
}

/** How an accepted `origins` entry matches. */
export type EmbedOriginKind = 'exact' | 'wildcard' | 'localhost';
/** Why an entry was refused (the route reports it as the issue message; values are never echoed). */
export type EmbedOriginRejectReason =
  | 'not_a_string' | 'too_long' | 'malformed' | 'not_canonical' | 'scheme_not_allowed' | 'ip_address'
  | 'localhost_in_production' | 'special_use_domain' | 'native_shell_origin' | 'not_native_shell_origin'
  | 'wildcard_not_allowed' | 'too_few_labels' | 'public_suffix' | 'public_suffix_unverified' | 'natzar_domain'
  | 'duplicate' | 'too_many';

/** A DNS host: letters, digits and inner hyphens per label, at least two labels (no `_`, `*`, IP or trailing dot). */
const DNS_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
/** http(s)://host[:port|:*] with nothing after it. */
const ORIGIN_SHAPE = /^(https?):\/\/([^/?#@\s:]+)(?::(\d{1,5}|\*))?$/;
/** Any scheme://host[:port|:*], to tell a wrong scheme from a malformed entry. */
const ANY_SCHEME_SHAPE = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#@\s:]+)(?::(\d{1,5}|\*))?$/;
/** A patient wildcard entry, `https://*.<base>[:port]`. */
const WILDCARD_PREFIX = 'https://*.';

const isLocalHost = isLocalDevHost;
const isNatzarHost = (host: string): boolean => FORBIDDEN_EMBED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));

/** The URL parser's own serialization of `scheme://host[:port]`, or null. */
function canonicalOrigin(scheme: string, host: string, port: string | undefined): string | null {
  try {
    return new URL(`${scheme}://${host}${port === undefined ? '' : `:${port}`}`).origin;
  } catch {
    return null;
  }
}

/**
 * Whether `value` is a canonical http(s) origin (the parser reproduces it
 * exactly: lower-case host, no path, default port omitted) or a native-shell
 * origin. Shape only; policy membership is {@link matchEmbedOrigin}'s job.
 * The mint schema checks `parentOrigin` with this.
 */
export function isCanonicalParentOrigin(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > EMBED_ORIGIN_MAX_LENGTH) return false;
  if ((NATIVE_SHELL_ORIGINS as readonly string[]).includes(value)) return true;
  const m = ORIGIN_SHAPE.exec(value);
  if (!m || m[3] === '*' || !(isLocalHost(m[2]) || (DNS_HOST.test(m[2]) && !IPV4.test(m[2])))) return false;
  return canonicalOrigin(m[1], m[2], m[3]) === value;
}

/**
 * Whether a frame may bind to a `hello` from `origin` (§4.3 step 4): https,
 * a native-shell origin, or http on a local host outside production. The
 * grant's `parentOrigin` must then equal it exactly.
 */
export function isBindableParentOrigin(origin: unknown, opts: {production: boolean}): origin is string {
  if (!isCanonicalParentOrigin(origin)) return false;
  if ((NATIVE_SHELL_ORIGINS as readonly string[]).includes(origin) || origin.startsWith('https://')) return true;
  return !opts.production && isLocalHost(new URL(origin).hostname);
}

/**
 * Classifies one `origins` entry, or says why it is refused. A wildcard needs
 * `publicSuffixList` (the authoritative list) to say its base is registrable,
 * and must also clear the embedded floor; without the list it is refused as
 * `public_suffix_unverified` (fail closed).
 */
export function classifyEmbedOrigin(entry: unknown, opts: {production: boolean; publicSuffixList?: PublicSuffixPredicate}):
  {ok: true; kind: EmbedOriginKind} | {ok: false; reason: EmbedOriginRejectReason} {
  if (typeof entry !== 'string') return {ok: false, reason: 'not_a_string'};
  if (entry.length > EMBED_ORIGIN_MAX_LENGTH) return {ok: false, reason: 'too_long'};
  // Native-shell origins belong in `nativeOrigins`; only `https://localhost` doubles as a dev origin outside production.
  if ((NATIVE_SHELL_ORIGINS as readonly string[]).includes(entry) && (opts.production || !entry.startsWith('https://'))) {
    return {ok: false, reason: 'native_shell_origin'};
  }

  const wildcard = entry.startsWith(WILDCARD_PREFIX) || entry.startsWith('http://*.');
  const bare = wildcard ? entry.replace('*.', '') : entry;
  const any = ANY_SCHEME_SHAPE.exec(bare);
  if (!any) return {ok: false, reason: 'malformed'};
  const m = ORIGIN_SHAPE.exec(bare);
  if (!m) return {ok: false, reason: /^https?$/i.test(any[1]) ? 'not_canonical' : 'scheme_not_allowed'};
  const [, scheme, host, port] = m;
  const canonical = canonicalOrigin(scheme, host, port === '*' ? undefined : port);
  if (canonical === null) return {ok: false, reason: 'malformed'};
  if (canonical + (port === '*' ? ':*' : '') !== bare) return {ok: false, reason: 'not_canonical'};
  if (isNatzarHost(host)) return {ok: false, reason: 'natzar_domain'};

  if (isLocalHost(host)) {
    if (opts.production) return {ok: false, reason: 'localhost_in_production'};
    if (wildcard) return {ok: false, reason: 'wildcard_not_allowed'};
    return {ok: true, kind: 'localhost'};
  }
  if (opts.production && isSpecialUseHost(host)) return {ok: false, reason: 'special_use_domain'};
  if (IPV4.test(host)) return {ok: false, reason: 'ip_address'};
  if (scheme !== 'https') return {ok: false, reason: 'scheme_not_allowed'};
  if (port === '*') return {ok: false, reason: 'wildcard_not_allowed'};
  if (!host.includes('.')) return {ok: false, reason: 'too_few_labels'};
  if (!DNS_HOST.test(host)) return {ok: false, reason: 'malformed'};
  if (!wildcard) return {ok: true, kind: 'exact'};
  if (isPublicSuffix(host)) return {ok: false, reason: 'public_suffix'};
  if (!opts.publicSuffixList) return {ok: false, reason: 'public_suffix_unverified'};
  if (opts.publicSuffixList(host)) return {ok: false, reason: 'public_suffix'};
  return {ok: true, kind: 'wildcard'};
}

/** Whether a `nativeOrigins` entry is accepted (one of {@link NATIVE_SHELL_ORIGINS}, in every environment). */
export function classifyNativeOrigin(entry: unknown): {ok: true} | {ok: false; reason: EmbedOriginRejectReason} {
  if (typeof entry !== 'string') return {ok: false, reason: 'not_a_string'};
  return (NATIVE_SHELL_ORIGINS as readonly string[]).includes(entry) ? {ok: true} : {ok: false, reason: 'not_native_shell_origin'};
}

/** One refused entry of a `PUT /v1/embed/origins` body. */
export interface EmbedOriginsIssue {
  /** `['origins', i]`, `['nativeOrigins', i]`, or `[]` for the whole list. */
  path: Array<string | number>;
  /** Why. */
  reason: EmbedOriginRejectReason;
}

/**
 * Every issue of an origins body (empty = valid): each entry classified
 * (wildcards against `publicSuffixList`, see {@link classifyEmbedOrigin}),
 * duplicates refused, and `origins` + `nativeOrigins` at most `maxEntries`:
 * an integer 1–{@link EMBED_ORIGINS_OPERATOR_MAX}, anything else (absent,
 * NaN, 0, above the ceiling) means {@link EMBED_ORIGINS_DEFAULT_MAX}. An
 * empty list is valid and turns embedding off.
 */
export function validateEmbedOrigins(
  body: {origins: readonly unknown[]; nativeOrigins?: readonly unknown[]},
  opts: {production: boolean; maxEntries?: number; publicSuffixList?: PublicSuffixPredicate},
): EmbedOriginsIssue[] {
  const issues: EmbedOriginsIssue[] = [];
  const requested = opts.maxEntries;
  const max = typeof requested === 'number' && Number.isInteger(requested) && requested >= 1 && requested <= EMBED_ORIGINS_OPERATOR_MAX
    ? requested
    : EMBED_ORIGINS_DEFAULT_MAX;
  const natives = body.nativeOrigins ?? [];
  if (body.origins.length + natives.length > max) issues.push({path: [], reason: 'too_many'});
  const seen = new Set<unknown>();
  body.origins.forEach((entry, i) => {
    const r = classifyEmbedOrigin(entry, opts);
    if (!r.ok) issues.push({path: ['origins', i], reason: r.reason});
    else if (seen.has(entry)) issues.push({path: ['origins', i], reason: 'duplicate'});
    seen.add(entry);
  });
  natives.forEach((entry, i) => {
    const r = classifyNativeOrigin(entry);
    if (!r.ok) issues.push({path: ['nativeOrigins', i], reason: r.reason});
    else if (seen.has(entry)) issues.push({path: ['nativeOrigins', i], reason: 'duplicate'});
    seen.add(entry);
  });
  return issues;
}

/** A partner's stored origin policy (already validated). */
export interface EmbedOriginPolicy {
  /** Exact, wildcard and local entries. */
  origins: readonly string[];
  /** Native-shell entries. */
  nativeOrigins?: readonly string[];
}

/**
 * How `origin` is allowed by `policy` for this request, or null. Clinicians
 * match exact entries only; patients also match wildcards and the local port
 * wildcard `:*`. A native-shell entry matches only a bearer-authenticated
 * request. A wildcard never matches its own apex (`https://*.acme.com` does
 * not match `https://acme.com`, as in CSP) and, without a port, matches only
 * the default port. In production a plain-http, local or special-use origin
 * never matches, whatever the stored list says (RG0 N2).
 */
export function matchEmbedOrigin(
  origin: unknown,
  policy: EmbedOriginPolicy,
  ctx: {audience: SessionAudience; requestAuth: 'ambient' | 'bearer'; production: boolean},
): EmbedOriginKind | 'native' | null {
  if (!isCanonicalParentOrigin(origin)) return null;
  if ((policy.nativeOrigins ?? []).includes(origin)) return ctx.requestAuth === 'bearer' ? 'native' : null;
  if ((NATIVE_SHELL_ORIGINS as readonly string[]).includes(origin) && !origin.startsWith('https://')) return null;
  if (ctx.production) {
    const host = new URL(origin).hostname;
    if (!origin.startsWith('https://') || isLocalHost(host) || isSpecialUseHost(host)) return null;
  }
  if (policy.origins.includes(origin)) return 'exact';
  if (ctx.audience !== 'patient') return null;
  const url = new URL(origin);
  for (const entry of policy.origins) {
    const wildcard = entry.startsWith(WILDCARD_PREFIX);
    const m = ORIGIN_SHAPE.exec(wildcard ? entry.replace('*.', '') : entry);
    if (!m || `${m[1]}:` !== url.protocol) continue;
    const [, , host, port] = m;
    if (port === '*') {
      if (!wildcard && isLocalHost(host) && url.hostname === host) return 'localhost';
    } else if (wildcard && url.hostname.endsWith(`.${host}`) && url.port === (port ?? '')) {
      return 'wildcard';
    }
  }
  return null;
}
