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
 *
 * @packageDocumentation
 */

export * from './errors';
export * from './resources';
export * from './schemas';
export * from './endpoints';
export * from './webhooks';
export * from './embed';
