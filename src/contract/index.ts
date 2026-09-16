// GENERATED FILE — do not edit.
//
// Copied verbatim from provider-portal's shared/partner-api by
// scripts/sync-contract.mjs. Edit the source there; this copy exists only so
// the published package is self-contained.
/**
 * # Natzar Partner API — typed contract
 *
 * The single source of truth for the Partner API's public surface: every
 * REST route, wire shape, error code, webhook payload, and embed-widget
 * event is typed and documented here. The server validates requests against
 * the zod schemas in this package, and this package is what the published
 * API reference is generated from — contract, validation, and documentation
 * cannot drift apart.
 *
 * ## Base URL & versioning
 *
 * All routes live under `/v1` on your assigned API host. `/v1` evolves
 * additively only: new endpoints, new OPTIONAL request fields, new response
 * fields, and new enum/union members (statuses, error codes, event types)
 * may appear without notice — write clients that ignore unknown fields and
 * tolerate unknown union members. Anything breaking ships as `/v2` with a
 * migration window; `/v1` will not be removed out from under you.
 *
 * ## Authentication
 *
 * Every request carries your API key:
 *
 * ```
 * Authorization: Bearer pp_live_…   (pp_test_… outside production)
 * ```
 *
 * The key identifies your partner account AND your tenant — every resource
 * you create or read is scoped to it; other tenants' resources are
 * indistinguishable from nonexistent ones (404). Keys are secrets: server
 * side only, never in a browser (the embed widgets use short-lived
 * consult-scoped session tokens instead — see `./embed`).
 *
 * Routes that act AS A CLINICIAN (replying, going on the video rota, taking
 * a call) additionally need to know which person, and take any one of three
 * physician credentials:
 *
 * - `X-Natzar-Physician: <Cognito ID token>` beside the key — PROVEN: the
 *   clinician signed in to us.
 * - `Authorization: Bearer <physician session token>` INSTEAD of the key —
 *   SESSION: your backend exchanged its own login for it via
 *   `POST /v1/physicians/{id}/session`. The browser-safe form, restricted to
 *   the physician-side routes (`403 forbidden` elsewhere).
 * - `X-Natzar-Physician-Id: <physician id>` beside the key — ASSERTED: your
 *   server vouches; refused with `403 forbidden` when your account has
 *   assertion switched off.
 *
 * `{id}` on the `/v1/physicians/{id}/…` routes may be `me`, the acting
 * physician. The full rules are in `./endpoints`, "Acting as a physician".
 *
 * ## Error model
 *
 * Non-2xx responses carry `{error: {code, message, details?}}` with a
 * stable machine-readable `code` (see `./errors`). 409s signal a state
 * conflict on the consult lifecycle — re-read, then retry only if the
 * operation still applies.
 *
 * ## Module map
 *
 * - `./errors` — error codes, wire shape, HTTP status mapping.
 * - `./resources` — the read (response) resource shapes.
 * - `./schemas` — zod schemas for every request body/query (the runtime
 *   validation contract).
 * - `./endpoints` — per-route request/response pairs + the `Endpoints`
 *   route table.
 * - `./webhooks` — outbound webhook events, payloads, and the
 *   `X-Natzar-Signature` verification scheme.
 * - `./embed` — the `<natzar-telehealth>`/`<natzar-async>` custom-element
 *   contract (attributes, DOM events, postMessage protocol).
 * - `./schedule` — the physician availability engine: how a schedule is
 *   stored (rules + dated exceptions), resolved into a calendar, edited by
 *   date, and diffed into a `PATCH /schedule` body. Pure; the platform runs
 *   the same code.
 * - `./timezones` — the IANA-zone helpers a zone picker or a zone label
 *   needs (the id list, validation, the device zone, offset labels, "9 h
 *   ahead" in five languages). Pure; the platform's own pickers use them.
 * - `./languages` — the physician-language preference: the five codes a
 *   physician may declare, their names, the base-code normalizer
 *   (`fr_CH` → `fr`) and the tier ranking every assigner applies (the
 *   patient's language, then English, then anyone). Pure; the platform
 *   routes with it.
 *
 * @packageDocumentation
 */

export * from './errors';
export * from './resources';
export * from './schemas';
export * from './endpoints';
export * from './webhooks';
export * from './embed';
export * from './schedule';
export * from './timezones';
export * from './languages';
