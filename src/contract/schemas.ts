// GENERATED FILE — do not edit.
//
// Copied verbatim from provider-portal's shared/partner-api by
// scripts/sync-contract.mjs. Edit the source there; this copy exists only so
// the published package is self-contained.
/**
 * Zod validation schemas for every Partner API request body and query
 * string.
 *
 * These schemas ARE the request contract: the API validates each request
 * against the schema for its route and rejects anything that fails with
 * `400 invalid_request` (the zod issues appear in `error.details`). The
 * request types in `./endpoints` are inferred from these schemas
 * (`z.infer`), so the documented types and the runtime validation cannot
 * drift apart.
 *
 * Conventions:
 * - Every object schema is `.strict()`: unknown keys are REJECTED, not
 *   silently dropped. This catches typos (`extenalId`) at the boundary
 *   instead of producing surprising upserts.
 * - Query-string schemas use `z.coerce` for numerics, since query values
 *   arrive as strings.
 * - Phone numbers must be E.164 ({@link E164_PHONE_REGEX}); the server also
 *   normalizes/validates with a full phone library, but non-E.164 input is
 *   rejected before it gets that far.
 * - `externalId` values are 1–128 characters with no whitespace
 *   ({@link EXTERNAL_ID_REGEX}) — they are used as join keys and appear in
 *   query strings.
 *
 * @packageDocumentation
 */

import {z} from 'zod';
import {ASYNC_REQUEST_SUBJECT_MAX} from './resources';
import {
  MAX_EXCEPTIONS_PER_WRITE,
  MAX_EXCEPTION_REASON_LENGTH,
  MAX_RULES_PER_PHYSICIAN,
  MAX_RULE_INTERVAL_WEEKS,
} from './schedule';
import {IANA_ZONE_REGEX, MAX_ZONE_ID_LENGTH} from './timezones';
import {MAX_PHYSICIAN_LANGUAGES, PHYSICIAN_LANGUAGES} from './languages';
import {PHARMACY_SEARCH_RADII_KM} from './prescriptions';

// The fields every visit-checkout body shares, whichever way it names the
// visit. A plain shape (not a schema) so each variant below stays its own
// `.strict()` object — a key belonging to the OTHER variant is then an
// unknown key, and exactly one variant can ever match.
const visitCheckoutCommon = {
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
  /**
   * `'embedded'` answers a `clientSecret` + `publishableKey` to mount Stripe's
   * card form inside your own page (Stripe.js `createEmbeddedCheckoutPage`)
   * instead of a `checkoutUrl` to send the patient to. There is no redirect:
   * the form's completion callback is your cue to check `billing.payment(id)`
   * — it is NOT proof of payment; only the platform's `paid` is.
   * Default `'hosted'`.
   */
  uiMode: z.enum(['hosted', 'embedded']).optional(),
};

/**
 * Body of `POST /v1/billing/visit-checkout`, in one of three shapes:
 *
 * - **By consult** (recommended for an invite): `{asyncConsultId}` or
 *   `{telehealthConsultId}`. The platform loads the consult, checks it is
 *   this tenant's and its patient one you provisioned, refuses a consult
 *   that can no longer be paid for (`409 thread_not_active` — not `invited`,
 *   or its link expired), works out the scenario itself, and BINDS the
 *   checkout to that consult: a second call for the same consult hands back
 *   the checkout already in progress instead of minting another, a consult
 *   already paid for answers `alreadyPaid`, and the consent / join / book
 *   that follows adopts the paid row even without a `paymentId`.
 * - **By scenario** (the original shape): `{patientId, modality, mode}` —
 *   a payment for "a visit of this kind", bound to nothing until a consent,
 *   join or booking spends it.
 *
 * The three are mutually exclusive: every variant is `.strict()`, so a body
 * mixing `asyncConsultId` with `patientId` (or with `telehealthConsultId`) is
 * `400 invalid_request`.
 */
export const visitBillingCheckoutSchema = z.union([
  z.object({
    patientId: z.string().min(1),
    modality: z.enum(['async', 'telehealth', 'in_person']),
    mode: z.enum(['live', 'book']),
    ...visitCheckoutCommon,
  }).strict(),
  z.object({
    /** An async consult invite (`status: 'invited'`) — pays for consenting to it. */
    asyncConsultId: z.string().min(1).max(128),
    ...visitCheckoutCommon,
  }).strict(),
  z.object({
    /**
     * A video consult: an on-demand one still `invited`/`waiting` (pays for
     * joining the queue) or a `scheduled` one not yet booked (pays for the
     * booking).
     */
    telehealthConsultId: z.string().min(1).max(128),
    ...visitCheckoutCommon,
  }).strict(),
]);
export type VisitBillingCheckoutRequest = z.infer<typeof visitBillingCheckoutSchema>;

export const membershipBillingCheckoutSchema = z.object({
  patientId: z.string().min(1),
  interval: z.enum(['month', 'year']),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
}).strict();
export type MembershipBillingCheckoutRequest = z.infer<typeof membershipBillingCheckoutSchema>;

// ---------------------------------------------------------------------------
// Primitives & limits
// ---------------------------------------------------------------------------

/**
 * E.164 phone format: `+`, a non-zero country-code digit, then 6–14 more
 * digits (7–15 digits total). Example: `+15551234567`.
 */
export const E164_PHONE_REGEX = /^\+[1-9]\d{6,14}$/;

/**
 * Partner-side external ids: 1–128 characters, no whitespace anywhere.
 * (They ride in query strings and composite keys.)
 */
export const EXTERNAL_ID_REGEX = /^\S{1,128}$/;

/** Maximum attachments on a single async message or reply. */
export const MAX_MESSAGE_ATTACHMENTS = 5;

/** Maximum files per `POST /v1/attachments/upload-urls` call. */
export const MAX_UPLOAD_FILES = 5;

/**
 * Maximum size of a single uploaded attachment, in bytes (25 MiB). Also
 * enforced by the presigned upload itself.
 */
export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024;

/** Maximum length of a message/reply body. */
export const MAX_MESSAGE_LENGTH = 4000;

/** Maximum length of the clinical `context` supplied at consult creation. */
export const MAX_CONTEXT_LENGTH = 4000;

/** E.164 phone number. */
const phoneSchema = z
  .string()
  .regex(E164_PHONE_REGEX, 'must be E.164, e.g. +15551234567');

/** Partner external id: 1–128 chars, no whitespace. */
const externalIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^\S+$/, 'must not contain whitespace');

/** A Natzar resource id (opaque; length-bounded to reject junk early). */
const idSchema = z.string().min(1).max(128);

/**
 * ISO calendar date `YYYY-MM-DD`, checked for actual calendar validity
 * (rejects `2026-02-30`).
 */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return (
      date.getUTCFullYear() === y &&
      date.getUTCMonth() === m - 1 &&
      date.getUTCDate() === d
    );
  }, 'not a valid calendar date');

/** ISO-8601 timestamp (offset or `Z`), for the `since` query parameter. */
const isoDateTimeSchema = z.string().datetime({offset: true});

/** Opaque pagination cursor, as returned in a previous page's `nextCursor`. */
const cursorSchema = z.string().min(1).max(4096);

/**
 * Page-size hint. Coerced from the query string; 1–100, server default
 * applies when omitted.
 */
const limitSchema = z.coerce.number().int().min(1).max(100);

/** Patient locale. Mirrors the `Languages` data-model enum. */
const langSchema = z.enum(['en_US', 'es_US', 'de_CH', 'fr_CH', 'it_CH']);

/** Biological sex, as required by the patient record. */
const sexSchema = z.enum(['male', 'female']);

/**
 * An IANA time zone id (`Europe/Zurich`, `America/Los_Angeles`) — the shape
 * only ({@link IANA_ZONE_REGEX}, at most {@link MAX_ZONE_ID_LENGTH} chars).
 * The server then checks it against the tz database and refuses an unknown
 * one — an abbreviation like `CEST`, a typo — with `400 invalid_request`
 * ("timezone: unknown IANA zone"); validate client-side with
 * `isKnownTimeZone` from `./timezones` to catch it first. Offsets (`+02:00`)
 * fail the shape itself: they do not survive daylight saving.
 */
export const ianaZoneSchema = z
  .string()
  .min(1)
  .max(MAX_ZONE_ID_LENGTH)
  .regex(IANA_ZONE_REGEX, 'must be an IANA zone id such as Europe/Zurich');

/**
 * A tenant specialty slug: lowercase kebab, as `GET /v1/specialties` lists
 * them. Declared with the primitives because both the physician schemas
 * (`/specialties`, `/schedule`) and the telehealth ones use it — a `const`
 * referenced before its declaration would throw at import.
 */
export const specialtySlugSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'must be a lowercase slug');

/**
 * One language a physician may declare: exactly a base code from
 * `PHYSICIAN_LANGUAGES` (`en`, `es`, `de`, `fr`, `it`). A full locale such
 * as `fr_CH` is REFUSED (`400 invalid_request`), not collapsed — the region
 * half says where a patient is, never what a clinician speaks, and a caller
 * that sends one has confused the patient's `lang` with the physician's
 * list. Same placement rule as {@link specialtySlugSchema}: declared with
 * the primitives because both the physician create and the languages route
 * use it.
 */
export const physicianLanguageSchema = z.enum(PHYSICIAN_LANGUAGES);

/**
 * A staged attachment reference: the `stagingKey` returned by
 * `POST /v1/attachments/upload-urls` after you PUT the bytes. Keys are
 * tenant- and patient-scoped; a key outside the addressed patient's staging
 * area is rejected.
 */
const attachmentRefSchema = z
  .object({
    /** The staging key from `upload-urls` (after a successful PUT). */
    stagingKey: z.string().min(1).max(1024),
    /** Display file name; defaults to the uploaded name. */
    fileName: z.string().min(1).max(256).optional(),
    /** MIME type, e.g. `image/jpeg`. */
    mimeType: z
      .string()
      .max(255)
      .regex(/^[-\w.+]+\/[-\w.+]+$/, 'must be a type/subtype MIME string')
      .optional(),
  })
  .strict();

/**
 * Shared refinement: endpoints addressing a patient accept EXACTLY ONE of
 * `patientId` (our id) or `externalPatientId` (your id).
 */
const exactlyOnePatientRef = (data: {
  patientId?: string;
  externalPatientId?: string;
}) => (data.patientId ? !data.externalPatientId : !!data.externalPatientId);

const patientRefMessage = 'provide exactly one of patientId or externalPatientId';

/**
 * Shared refinement for LIST filters, where addressing a patient is optional:
 * pass `patientId`, or `externalPatientId`, or neither (the whole tenant) —
 * but never both.
 */
const atMostOnePatientRef = (data: {
  patientId?: string;
  externalPatientId?: string;
}) => !(data.patientId && data.externalPatientId);

const atMostOnePatientRefMessage = 'provide at most one of patientId or externalPatientId';

// ---------------------------------------------------------------------------
// Patients
// ---------------------------------------------------------------------------

/**
 * Body of `POST /v1/patients` — idempotent upsert keyed on `externalId`.
 *
 * Repeating the call with the same `externalId` updates the mutable fields
 * instead of creating a duplicate. `phone` is identity-bearing: it must be
 * E.164, unique across the platform, and cannot be changed after creation
 * (a conflicting phone yields `409 phone_unavailable`).
 */
export const upsertPatientSchema = z
  .object({
    /** Your id for the patient — the upsert key. 1–128 chars, no whitespace. */
    externalId: externalIdSchema,
    /** E.164 phone, e.g. `+15551234567`. Immutable after creation. */
    phone: phoneSchema,
    /** Contact email. */
    email: z.string().email().max(254),
    /** Given (first) name. */
    givenName: z.string().min(1).max(100),
    /** Family (last) name. */
    familyName: z.string().min(1).max(100),
    /** Date of birth, `YYYY-MM-DD`. */
    birthdate: isoDateSchema,
    /** Biological sex. */
    sex: sexSchema,
    /** Locale for system messages/embeds. Default `en_US`. */
    lang: langSchema.optional(),
    /**
     * Where the patient is, for STATE LICENSURE (docs/SCHEDULED-CONSULTS.md).
     *
     * ISO 3166-2 subdivision code without the country prefix (`CA`, not
     * `US-CA`); `country` is ISO 3166-1 alpha-2 and defaults to the tenant's
     * own. Only consulted by tenants that have licence enforcement switched on
     * — for everyone else these are simply recorded.
     *
     * Send it if you have it: with enforcement on, a consult for a patient
     * whose state we do not know cannot be routed at all, and the patient is
     * asked for it before they can book.
     */
    state: z.string().min(2).max(3).optional(),
    country: z.string().length(2).optional(),
  })
  .strict();

/** Query of `GET /v1/patients` — filter by your id, or page the full list. */
export const listPatientsQuerySchema = z
  .object({
    /** Return only the patient with this external id. */
    externalId: externalIdSchema.optional(),
    /** Opaque cursor from the previous page. */
    cursor: cursorSchema.optional(),
    /** Page size, 1–100. */
    limit: limitSchema.optional(),
  })
  .strict();

/**
 * Body of `PATCH /v1/patients/{id}` — the editable subset. `phone`,
 * `externalId`, and tenancy are NOT patchable (the strict schema rejects
 * them), and at least one field must be present.
 */
export const updatePatientSchema = z
  .object({
    /** Contact email. */
    email: z.string().email().max(254).optional(),
    /** Given (first) name. */
    givenName: z.string().min(1).max(100).optional(),
    /** Family (last) name. */
    familyName: z.string().min(1).max(100).optional(),
    /** Date of birth, `YYYY-MM-DD`. */
    birthdate: isoDateSchema.optional(),
    /** Biological sex. */
    sex: sexSchema.optional(),
    /** Locale for system messages/embeds. */
    lang: langSchema.optional(),
  })
  .strict()
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'at least one field must be provided',
  });

// ---------------------------------------------------------------------------
// Physicians
// ---------------------------------------------------------------------------

/**
 * Body of `POST /v1/physicians`.
 *
 * Creates the backing portal account (keyed by `email`) plus the physician
 * profile. NOT an upsert — no field can be changed by re-POSTing, but an
 * IDENTICAL repeat (same `externalId`, same `email` case-insensitively) is
 * idempotent: 200, `givenName`/`familyName` refreshed, never a second
 * account. Repeating an `externalId` with a different email yields
 * `409 external_id_conflict`; a new `externalId` with an email that already
 * backs a portal account yields `409 email_in_use`. By
 * default no invitation email is sent — set `sendPortalInvite: true` to
 * invite the physician to the Natzar portal immediately, or call
 * `POST /v1/physicians/{id}/portal-invite` later.
 */
export const createPhysicianSchema = z
  .object({
    /** Your id for the physician. 1–128 chars, no whitespace. */
    externalId: externalIdSchema,
    /** Sign-in email for the portal account. Must be unique platform-wide. */
    email: z.string().email().max(254),
    /** Given (first) name. */
    givenName: z.string().min(1).max(100).optional(),
    /** Family (last) name. */
    familyName: z.string().min(1).max(100).optional(),
    /**
     * The languages the physician consults in, as base codes (`fr`, not
     * `fr_CH`). A ranked routing preference, never a filter — see
     * {@link setPhysicianLanguagesSchema}, which replaces the list later.
     * Omit to record nothing (ranks last, never assumed English).
     */
    languages: z.array(physicianLanguageSchema).max(MAX_PHYSICIAN_LANGUAGES).optional(),
    /** Send the portal invitation email immediately. Default false. */
    sendPortalInvite: z.boolean().optional(),
  })
  .strict();

/** Query of `GET /v1/physicians`. */
export const listPhysiciansQuerySchema = z
  .object({
    /** Return only the physician with this external id. */
    externalId: externalIdSchema.optional(),
    /** Opaque cursor from the previous page. */
    cursor: cursorSchema.optional(),
    /** Page size, 1–100. */
    limit: limitSchema.optional(),
  })
  .strict();

/**
 * Body of `POST /v1/physicians/{id}/availability`.
 *
 * Toggles participation in automatic async assignment. Setting it to `true`
 * can immediately assign queued consults to this physician.
 */
export const setPhysicianAvailabilitySchema = z
  .object({
    /** May the assignment engine give this physician new async consults? */
    asyncAvailable: z.boolean(),
  })
  .strict();

/**
 * Body of `POST /v1/physicians/{id}/session` — mint a short-lived PHYSICIAN
 * SESSION token, the credential a clinician's browser uses to call the
 * physician-side routes directly (no API key in the page, no relay through
 * your server on every poll).
 *
 * Requires the tenant API key: a session may not mint another (`403
 * forbidden`), which is what keeps a leaked browser token from renewing
 * itself. Mint it from your backend after YOUR authentication of the user —
 * this is the token-exchange half of single sign-on. If you also sent a
 * physician header on this call it must name the same physician (`400`).
 *
 * The token is invalidated by an API-key rotation (like embed sessions):
 * re-mint on `401 unauthorized`.
 */
export const createPhysicianSessionSchema = z
  .object({
    /** Token lifetime in seconds, 60–86400. Default 3600 (1 hour). */
    ttlSeconds: z.number().int().min(60).max(86400).optional(),
  })
  .strict();

/**
 * Body of `POST /v1/physicians/{id}/presence` — go on or off the LIVE video
 * queue. Self-only: the acting physician (any of the three credentials) must
 * be the addressed one; `me` is accepted as the id.
 *
 * `ready: true` puts the physician on the rota and immediately tries to match
 * them with a waiting patient — the response's `activeConsult` is the consult
 * now ringing for them, if any. It also counts as a heartbeat; keep beating
 * (`/heartbeat`) every 15 s or presence lapses after 45 s.
 * `ready: false` takes them off (`busy`), clearing any pending ring.
 */
export const setPhysicianPresenceSchema = z
  .object({
    /** On the live queue (`true`) or off it (`false`). */
    ready: z.boolean(),
  })
  .strict();

/**
 * Body of `POST /v1/physicians/{id}/heartbeat` — keep a `ready` physician on
 * the rota. An empty object (or omit it). Self-only.
 *
 * Presence expires 45 seconds after the last beat; call this every 15 seconds
 * while the physician is `ready` and your page is open, and STOP when they
 * close it — a physician nobody is watching for must fall off the rota, or
 * patients are rung for a clinician who never answers. A heartbeat on a
 * physician who is not `ready` records `lastSeenAt` and changes nothing else
 * (it does not revive a lapsed `ready`; post presence again for that). While
 * `ready`, a beat also retries the match, so `activeConsult` may appear here.
 */
export const physicianHeartbeatSchema = z.object({}).strict();

/** The longest agenda window one read may cover: 31 days. */
export const AGENDA_MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

/**
 * Query of `GET /v1/physicians/{id}/agenda` — the physician's booked
 * appointments in a window, soonest first. Both bounds are ISO-8601 instants;
 * `from` defaults to now and `to` to `from` + 7 days. A window may span at
 * most 31 days.
 */
export const physicianAgendaQuerySchema = z
  .object({
    /** Start of the window (inclusive). Default: now. */
    from: isoDateTimeSchema.optional(),
    /** End of the window (inclusive). Default: `from` + 7 days. Max 31 days after `from`. */
    to: isoDateTimeSchema.optional(),
  })
  .strict()
  .refine(
    (q) => {
      if (!q.from || !q.to) return true;
      const span = Date.parse(q.to) - Date.parse(q.from);
      return span >= 0 && span <= AGENDA_MAX_WINDOW_MS;
    },
    {message: 'to must be at or after from and at most 31 days later'},
  );

/**
 * Body of `PUT /v1/physicians/{id}/specialties` — which of the tenant's
 * specialties this physician covers. A whole-list replace.
 *
 * Slugs must exist in the tenant's catalogue (`GET /v1/specialties`); an
 * unknown one is dropped rather than refused, because a typo that narrowed a
 * physician to nothing routable would be worse than a typo ignored — read
 * the returned `physician.specialties` to see what stuck. An EMPTY list means
 * "covers everything" (the permissive default that lets a clinic turn on
 * specialty routing without emptying its rota); `acceptsAllSpecialties`
 * says the same thing explicitly and survives a later non-empty list.
 */
export const setPhysicianSpecialtiesSchema = z
  .object({
    /** Specialty slugs from the tenant's catalogue. Empty = covers all. */
    specialties: z.array(specialtySlugSchema).max(100),
    /** Explicit "takes every specialty", independent of the list. Default false. */
    acceptsAllSpecialties: z.boolean().optional(),
  })
  .strict();

/**
 * Body of `PUT /v1/physicians/{id}/languages` — the languages this physician
 * consults in. A whole-list replace, like the specialties.
 *
 * Base codes only (`fr`, `en`); a full locale such as `fr_CH` is refused
 * with `400 invalid_request` rather than collapsed, because the region is a
 * fact about a patient and a caller sending one has the two lists confused.
 * Order is kept as sent (the physician's own preference), duplicates are
 * dropped, and at most {@link MAX_PHYSICIAN_LANGUAGES} entries fit — the
 * whole catalogue.
 *
 * This is a RANKED PREFERENCE, not a constraint: language never excludes a
 * physician from a patient. Among the physicians a consult may go to, the
 * platform offers it first to one who speaks the patient's language, then
 * to one who speaks English, then to anyone — so an EMPTY list means
 * "nothing recorded" and ranks last (it is never read as English), and
 * turning the feature on can never leave a rota empty.
 */
export const setPhysicianLanguagesSchema = z
  .object({
    /** Base language codes, in the physician's order. Empty = nothing recorded. */
    languages: z.array(physicianLanguageSchema).max(MAX_PHYSICIAN_LANGUAGES),
  })
  .strict();

/**
 * Query of `GET /v1/patients/state` — everything a patient-facing screen
 * needs, in ONE call.
 *
 * Built for exactly the integration this API is meant to make easy: an app
 * opens, and needs to know whether to show the agent chat, a consult
 * waiting for consent, a queued thread, a live video room, or a rating
 * prompt. Rather than fanning out across three list endpoints and diffing,
 * ask for the patient's current state and render it.
 */
export const getPatientStateQuerySchema = z
  .object({
    /** Our patient id. Provide this OR `externalPatientId`. */
    patientId: idSchema.optional(),
    /** Your patient id. Provide this OR `patientId`. */
    externalPatientId: externalIdSchema.optional(),
  })
  .strict()
  .refine(exactlyOnePatientRef, {message: patientRefMessage});

// ---------------------------------------------------------------------------
// Agent chat
// ---------------------------------------------------------------------------

/**
 * Body of `POST /v1/agent/messages` — a patient turn in the AI agent
 * conversation.
 *
 * The message enters the SAME per-patient pipeline every other channel uses,
 * so it is subject to the same safety layers (moderation, emergency
 * detection, scope classification) and the same escalation rules: if an
 * async consult or telehealth invite is already open for this patient, the
 * message is routed to the human clinician instead of being answered by the
 * agent. Accepted with `202` — the reply appears on
 * `GET /v1/agent/messages` a few seconds later.
 *
 * At least one of `text` / `attachments` is required.
 */
export const postAgentMessageSchema = z
  .object({
    /** Our patient id. Provide this OR `externalPatientId`. */
    patientId: idSchema.optional(),
    /** Your patient id. Provide this OR `patientId`. */
    externalPatientId: externalIdSchema.optional(),
    /** The patient's message. */
    text: z.string().min(1).max(MAX_MESSAGE_LENGTH).optional(),
    /**
     * Your own id for this submission, echoed into the delivery pipeline's
     * deduplication key. Send the SAME value when retrying a request whose
     * response you never saw, and the message is delivered EXACTLY ONCE.
     *
     * Without it a retry is a second, independent message: the server mints a
     * fresh dedup id per request, so a network timeout on a clinical message
     * could otherwise put it on the transcript twice. Any stable string up to
     * 128 chars — a UUID you generate before the first attempt is ideal.
     */
    idempotencyKey: z.string().min(1).max(128).optional(),
    /**
     * Staged attachments (see `POST /v1/attachments/upload-urls`). Images and
     * PDFs are read by the agent; other file types are stored and
     * acknowledged.
     */
    attachments: z.array(attachmentRefSchema).min(1).max(MAX_MESSAGE_ATTACHMENTS).optional(),
  })
  .strict()
  .refine(exactlyOnePatientRef, {message: patientRefMessage})
  .refine((data) => (data.text?.trim().length ?? 0) > 0 || !!data.attachments?.length, {
    message: 'text or attachments required',
  });

/**
 * Body of `POST /v1/agent/embed-session` — a session token for the
 * `<natzar-agent>` widget.
 *
 * Unlike the consult embed sessions this is scoped to a PATIENT, not to a
 * consult: the agent conversation is the patient's continuous history, so
 * there is no episode to name. Mint it server-side and pass the token to the
 * tag; the key never reaches the browser.
 */
export const createAgentEmbedSessionSchema = z
  .object({
    /** Our patient id. Provide this OR `externalPatientId`. */
    patientId: idSchema.optional(),
    /** Your patient id. Provide this OR `patientId`. */
    externalPatientId: externalIdSchema.optional(),
    /** Token lifetime in seconds, 60–86400. Default 3600 (1 hour). */
    ttlSeconds: z.number().int().min(60).max(86400).optional(),
  })
  .strict()
  .refine(exactlyOnePatientRef, {message: patientRefMessage});

/**
 * Query of `GET /v1/agent/messages` — the patient's agent conversation,
 * oldest first.
 *
 * Addressed by patient (exactly one of `patientId` / `externalPatientId`),
 * not by conversation id: conversation rotation is ours to manage, and this
 * endpoint reads across the whole chain.
 *
 * Poll it by holding on to the response's `cursor` and passing it back — it
 * always marks the position after the last message you were given, so a poll
 * that returns no items leaves your cursor valid.
 */
export const listAgentMessagesQuerySchema = z
  .object({
    /** Our patient id. Provide this OR `externalPatientId`. */
    patientId: idSchema.optional(),
    /** Your patient id. Provide this OR `patientId`. */
    externalPatientId: externalIdSchema.optional(),
    /** Opaque cursor from the previous response. */
    cursor: cursorSchema.optional(),
    /** Page size, 1–100. */
    limit: limitSchema.optional(),
  })
  .strict()
  .refine(exactlyOnePatientRef, {message: patientRefMessage});

// ---------------------------------------------------------------------------
// Async consults
// ---------------------------------------------------------------------------

// Referral drafts. Defined ahead of the async-consult schemas because a
// referral_request carries them as `suggestedReferrals`, and a referral is
// issued ON a physician-owned thread. The document core validates again
// before signing; this boundary schema rejects malformed API input before it
// can reach PHI reads or the PDF renderer.
const referralOptionalFields = {
  healthCardNumber: z.string().max(40).optional(),
  healthCardExpiry: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
};
const referralPrioritySchema = z.enum(['routine', 'semi_urgent', 'urgent']);
const referralLanguageSchema = z.enum(['en', 'es', 'de', 'fr', 'it']);
/**
 * One referral draft — specialist, laboratory or imaging requisition. Used by
 * the issue body below and by `suggestedReferrals` on a `referral_request`.
 */
export const referralDraftSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('specialist'),
    specialty: z.string().min(1).max(120),
    priority: referralPrioritySchema,
    reason: z.string().min(1).max(2000),
    clinicalInfo: z.string().max(2000).optional(),
    ...referralOptionalFields,
  }).strict(),
  z.object({
    kind: z.literal('laboratory'),
    tests: z.array(z.enum([
      'cbc', 'fasting_glucose', 'hba1c', 'creatinine_egfr', 'electrolytes', 'lipid_panel', 'alt_ast', 'tsh', 'ferritin',
      'vitamin_b12', 'urinalysis', 'urine_acr', 'inr', 'psa', 'hcg_serum', 'urine_culture', 'throat_swab',
    ])).max(17),
    otherTests: z.string().max(2000).optional(),
    clinicalInfo: z.string().max(2000).optional(),
    priority: z.enum(['routine', 'urgent']),
    fasting: z.boolean().optional(),
    ...referralOptionalFields,
  }).strict(),
  z.object({
    kind: z.literal('imaging'),
    modality: z.enum(['xray', 'ultrasound', 'ct', 'mri', 'mammography', 'other']),
    otherModality: z.string().max(120).optional(),
    examination: z.string().min(1).max(2000),
    clinicalIndication: z.string().min(1).max(2000),
    priority: referralPrioritySchema,
    contrast: z.boolean().optional(),
    ...referralOptionalFields,
  }).strict(),
]);

/**
 * Body of `POST /v1/async-consults`.
 *
 * `consent` declares how patient consent is handled:
 * - `'collected'` — YOU already collected consent in your own UX; the
 *   consult skips the invite phase and is queued/assigned immediately.
 * - `'embed'` — the `<natzar-async>` embed collects consent from the
 *   patient; the consult stays `invited` until they answer, and the create
 *   response carries a `sessionToken` for the widget.
 */
export const createAsyncConsultSchema = z
  .object({
    /** Our patient id. Provide this OR `externalPatientId`. */
    patientId: idSchema.optional(),
    /** Your patient id. Provide this OR `patientId`. */
    externalPatientId: externalIdSchema.optional(),
    /**
     * Clinical context — the physician's handoff summary ("why they're
     * here"). For a `referral_request` it is REQUIRED and it is the ask
     * itself: what the physician reads before issuing the referral.
     */
    context: z.string().min(1).max(MAX_CONTEXT_LENGTH).optional(),
    /** Consent mode — see the schema description. */
    consent: z.enum(['collected', 'embed']),
    /**
     * Which kind of thread to open — see `AsyncConsultKind` in `./resources`.
     * Default `conversation`: the assistant goes silent, the patient's
     * messages reach the physician, one open thread per patient.
     * `referral_request` opens a NON-BLOCKING request instead: a
     * self-contained ask (`context`) labelled by `subject`, answered by one
     * referral document posted into the same conversation, that never
     * silences the assistant, may sit beside an open consultation (and
     * beside other requests), and closes `fulfilled` when the document is
     * delivered. Requires `consent: "collected"`, `subject` and `context`.
     */
    kind: z.enum(['conversation', 'referral_request']).optional(),
    /**
     * `referral_request` only: the one-line label of the ask ("Lipid panel
     * (cholesterol)"), 1–120 characters. Every notice the patient receives
     * about the request names it, since several may be open at once.
     */
    subject: z.string().min(1).max(ASYNC_REQUEST_SUBJECT_MAX).optional(),
    /**
     * The Payment row that bought this consult, when the tenant charges for it
     * (`payment_required` says so, with the amount). Must be `paid`, for this
     * patient and this scenario, and not yet spent on another visit; the
     * entitlement is asserted inside the same write that opens the thread (`consent: "collected"` only — with `"embed"` the widget presents it at consent).
     * Omit on a free scenario — it is ignored there.
     */
    paymentId: idSchema.optional(),
    /**
     * `referral_request` only: up to five referral drafts you suggest for the
     * ask (the same shape `POST /v1/async-consults/{id}/referrals` takes).
     * They pre-fill the physician's "Generate referrals" step — the physician
     * reviews them, may edit them, and signs. Refused on a conversation.
     */
    suggestedReferrals: z.array(referralDraftSchema).min(1).max(5).optional(),
  })
  .strict()
  .refine(exactlyOnePatientRef, {message: patientRefMessage})
  .refine((data) => data.suggestedReferrals === undefined || data.kind === 'referral_request', {
    message: 'suggestedReferrals is only accepted with kind "referral_request"',
    path: ['suggestedReferrals'],
  });

/**
 * Which consults a list read covers, by who opened them (see `ConsultOrigin`
 * in `./resources`). The default is CREDENTIAL-dependent: the tenant key
 * alone lists `partner`-origin consults (yours); a physician credential
 * lists `any`, since the clinician works the whole clinic.
 */
const originFilterSchema = z.enum(['partner', 'platform', 'any']);

/** Query of `GET /v1/async-consults`. Sorted by `lastActivityAt` descending. */
export const listAsyncConsultsQuerySchema = z
  .object({
    /** Filter to one patient by our id. Combine with neither or `externalPatientId`. */
    patientId: idSchema.optional(),
    /** Filter to one patient by your id. */
    externalPatientId: externalIdSchema.optional(),
    /** Filter to one lifecycle state. */
    status: z
      .enum(['invited', 'queued', 'active', 'resolve_requested', 'closed'])
      .optional(),
    /**
     * Filter by who holds the thread:
     * - `me` — the acting physician's (requires a physician credential):
     *   their open threads, or with `status=closed` their history.
     * - `unassigned` — `queued` threads nobody holds yet (the claimable pool).
     * - any other value — our id of a physician: that physician's threads.
     */
    assignee: idSchema.optional(),
    /** Which origins to include. See the note on the default above. */
    origin: originFilterSchema.optional(),
    /** Opaque cursor from the previous page. */
    cursor: cursorSchema.optional(),
    /** Page size, 1–100. */
    limit: limitSchema.optional(),
  })
  .strict()
  .refine(atMostOnePatientRef, {message: atMostOnePatientRefMessage});

/**
 * Query of `GET /v1/async-consults/{id}/messages`. Messages are returned in
 * transcript order (oldest first); page forward with `cursor`.
 */
export const listAsyncMessagesQuerySchema = z
  .object({
    /** Opaque cursor from the previous page. */
    cursor: cursorSchema.optional(),
    /** Page size, 1–100. */
    limit: limitSchema.optional(),
  })
  .strict();

/**
 * Body of `POST /v1/async-consults/{id}/messages` — a PATIENT-authored
 * message from your own chat UI (headless integration).
 *
 * Accepted with `202`: the message is enqueued into the per-patient FIFO
 * pipeline (same lane as every other channel) and appears on the transcript
 * (and as an `async_consult.message` webhook) moments later. If the thread
 * closes before processing, you receive `async_consult.message_rejected`
 * instead — a patient message is never silently dropped.
 *
 * At least one of `text` / `attachments` is required.
 */
export const postAsyncMessageSchema = z
  .object({
    /**
     * Your own id for this submission, echoed into the delivery pipeline's
     * deduplication key. Send the SAME value when retrying a request whose
     * response you never saw and the message is delivered EXACTLY ONCE;
     * without it a retry becomes a second, independent message.
     */
    idempotencyKey: z.string().min(1).max(128).optional(),
    /** The message text. */
    text: z.string().min(1).max(MAX_MESSAGE_LENGTH).optional(),
    /** Staged attachments (see `POST /v1/attachments/upload-urls`). */
    attachments: z.array(attachmentRefSchema).min(1).max(MAX_MESSAGE_ATTACHMENTS).optional(),
  })
  .strict()
  .refine((data) => (data.text?.trim().length ?? 0) > 0 || !!data.attachments?.length, {
    message: 'text or attachments required',
  });

/**
 * Body of `POST /v1/async-consults/{id}/replies` — a PHYSICIAN-authored
 * reply from your own clinician UI (headless integration).
 *
 * REQUIRES the acting clinician's own credential: send their Cognito ID token
 * in the `X-Natzar-Physician` header alongside your API key. Your key proves
 * which APPLICATION is calling; the header proves which PERSON is writing. A
 * reply lands on a patient's permanent record signed with a named clinician,
 * so it cannot be authorized by an application credential alone.
 *
 * The acting physician must be the consult's CURRENT assignee (`409
 * not_assigned` otherwise — assignment may have moved via SLA reassignment).
 * Accepted with `202` and delivered through the same FIFO pipeline as portal
 * replies.
 */
export const postAsyncReplySchema = z
  .object({
    /**
     * Your own id for this submission, echoed into the delivery pipeline's
     * deduplication key. Send the SAME value when retrying a request whose
     * response you never saw and the message is delivered EXACTLY ONCE;
     * without it a retry becomes a second, independent message.
     */
    idempotencyKey: z.string().min(1).max(128).optional(),
    /**
     * Our id of the acting physician. OPTIONAL and purely a cross-check: the
     * acting identity comes from the `X-Natzar-Physician` header (the
     * clinician's Cognito ID token), never from the body. Send it and it must
     * MATCH the token, or the request is refused — so a UI with the wrong
     * clinician selected fails loudly instead of filing the note under
     * whoever the token named.
     */
    physicianId: idSchema.optional(),
    /** The reply text. */
    text: z.string().min(1).max(MAX_MESSAGE_LENGTH),
    /** One staged attachment to send with the reply. */
    attachment: attachmentRefSchema.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Referrals
// ---------------------------------------------------------------------------

/**
 * Body of `POST /v1/async-consults/{id}/referrals` — issue the assignee's
 * signed specialist, laboratory or imaging requisition. Physician session.
 */
export const issueReferralSchema = z.object({
  draft: referralDraftSchema,
  lang: referralLanguageSchema.optional(),
}).strict().or(z.object({
  drafts: z.array(referralDraftSchema).min(1).max(5),
  lang: referralLanguageSchema.optional(),
}).strict());

/** Signed prescription in a physician session (fax jurisdictions only). */
export const issuePrescriptionSchema = z.object({
  draft: z.object({
    items: z.array(z.object({
      medication: z.string().min(1).max(120),
      strength: z.string().max(120).optional(),
      form: z.string().max(120).optional(),
      dose: z.string().min(1).max(120),
      route: z.enum(['oral', 'sublingual', 'topical', 'inhaled', 'nasal', 'ophthalmic', 'otic', 'rectal', 'vaginal', 'subcutaneous', 'intramuscular', 'other']),
      frequency: z.enum(['once', 'daily', 'bid', 'tid', 'qid', 'q4h', 'q6h', 'q8h', 'q12h', 'qhs', 'qam', 'weekly', 'prn', 'other']),
      durationDays: z.number().int().min(0).optional(),
      quantity: z.string().min(1).max(120),
      refills: z.number().int().min(0).max(11),
      noSubstitution: z.boolean().optional(),
      instructions: z.string().max(500).optional(),
      catalogRef: z.string().max(120).optional(),
    }).strict()).min(1).max(8),
    pharmacistNote: z.string().max(500).optional(),
    indication: z.string().max(500).optional(),
  }).strict(),
}).strict();

/**
 * Body of `POST /v1/async-consults/{id}/claim` — assign a queued consult to
 * a specific physician (instead of waiting for auto-assignment).
 */
export const claimAsyncConsultSchema = z
  .object({
    /**
     * Our id of the acting physician. OPTIONAL and purely a cross-check: the
     * acting identity comes from the `X-Natzar-Physician` header (the
     * clinician's Cognito ID token), never from the body. Send it and it must
     * MATCH the token, or the request is refused — so a UI with the wrong
     * clinician selected fails loudly instead of filing the note under
     * whoever the token named.
     */
    physicianId: idSchema.optional(),
  })
  .strict();

/**
 * Body of `POST /v1/async-consults/{id}/takeover` — forcibly reassign an
 * ACTIVE consult whose current assignee has blown the response SLA
 * (`409 sla_not_overdue` before that point).
 */
export const takeoverAsyncConsultSchema = z
  .object({
    /**
     * Our id of the acting physician. OPTIONAL and purely a cross-check: the
     * acting identity comes from the `X-Natzar-Physician` header (the
     * clinician's Cognito ID token), never from the body. Send it and it must
     * MATCH the token, or the request is refused — so a UI with the wrong
     * clinician selected fails loudly instead of filing the note under
     * whoever the token named.
     */
    physicianId: idSchema.optional(),
  })
  .strict();

/**
 * Body of `POST /v1/async-consults/{id}/resolve` — the assigned physician
 * marks the consult resolved. The patient gets a bounded window to reply
 * (which reopens the thread); silence closes it as accepted.
 */
export const resolveAsyncConsultSchema = z
  .object({
    /**
     * Our id of the acting physician. OPTIONAL and purely a cross-check: the
     * acting identity comes from the `X-Natzar-Physician` header (the
     * clinician's Cognito ID token), never from the body. Send it and it must
     * MATCH the token, or the request is refused — so a UI with the wrong
     * clinician selected fails loudly instead of filing the note under
     * whoever the token named.
     */
    physicianId: idSchema.optional(),
    /** Optional resolution note shown to the patient with the notice. */
    note: z.string().min(1).max(2000).optional(),
  })
  .strict();

/**
 * Body of `POST /v1/async-consults/{id}/close` — administratively close an
 * open consult (recorded as `closedReason: 'cancelled'`). The body is an
 * empty object (or omit it entirely).
 */
export const closeAsyncConsultSchema = z
  .object({
    /**
     * Who is ending the thread, which is what the patient sees and what the
     * `async_consult.closed` webhook reports:
     * - `'cancelled'` (default) — YOU are closing it administratively.
     * - `'patient_closed'` — the PATIENT ended it from your UI. Use this
     *   whenever the action came from the patient, so the transcript and the
     *   close notice tell the truth.
     */
    reason: z.enum(['cancelled', 'patient_closed']).optional(),
  })
  .strict();

/**
 * Body of `POST /v1/async-consults/{id}/escalate` — the assigned physician
 * turns the messaging thread into a live video consult. An empty object (or
 * omit it).
 *
 * Requires a physician credential naming the CURRENT assignee (`409
 * not_assigned`) and an open thread (`409 thread_not_active`). The platform
 * opens a telehealth consult for the same patient, closes the thread with
 * `closedReason: 'escalated'`, and sends the patient the `escalated` notice
 * with their join link through their usual channel — for your patients, onto
 * the transcript and the `async_consult.message` webhook, exactly as the
 * portal does it. The response names the new consult so your physician UI can
 * go `ready` for it.
 */
export const escalateAsyncConsultSchema = z.object({}).strict();

/**
 * Body of `POST /v1/async-consults/{id}/consent` — the PATIENT's answer to
 * a consult invite, from your own UI.
 *
 * The headless twin of the `<natzar-async>` widget's consent step, and the
 * alternative to asserting `consent: 'collected'` at creation time: create
 * the consult with `consent: 'embed'`, render your own consent screen, then
 * post the answer here. `accept: false` closes the consult
 * (`closedReason: 'declined'`).
 *
 * Only valid while the consult is `invited` (`409 thread_not_active`
 * otherwise). Repeating an accept is idempotent.
 */
export const respondAsyncConsentSchema = z
  .object({
    /** True to consent and enter the queue; false to decline and close. */
    accept: z.boolean(),
    /**
     * The Payment row that bought this consult, when the tenant charges for it
     * (`payment_required` says so, with the amount). Must be `paid`, for this
     * patient and this scenario, and not yet spent on another visit; the
     * entitlement is asserted inside the same write that opens the thread.
     * Omit on a free scenario — it is ignored there — and when the patient
     * paid through a checkout started for THIS consult
     * (`POST /v1/billing/visit-checkout {asyncConsultId}`): that payment is
     * bound to the consult and adopted without its id.
     */
    paymentId: idSchema.optional(),
  })
  .strict();

/**
 * Body of `POST /v1/async-consults/{id}/rate` — the patient's rating of a
 * finished consult.
 *
 * Write-once, and only while the consult's `rateable` flag is true (a closed
 * thread that a physician actually held, not yet rated). A repeat returns
 * the consult unchanged rather than erroring.
 */
export const rateAsyncConsultSchema = z
  .object({
    /** 1–5 star rating of the physician. */
    stars: z.number().int().min(1).max(5),
    /** Optional free-text comment. */
    feedback: z.string().min(1).max(MAX_CONTEXT_LENGTH).optional(),
  })
  .strict();

/**
 * Body of `POST /v1/…/{id}/embed-session` (both consult kinds) — mint a
 * fresh embed session token for the consult's patient-facing widget.
 */
export const createEmbedSessionSchema = z
  .object({
    /** Token lifetime in seconds, 60–86400. Default 3600 (1 hour). */
    ttlSeconds: z.number().int().min(60).max(86400).optional(),
  })
  .strict();

/**
 * Body of `POST /v1/attachments/upload-urls` — presigned upload slots in the
 * addressed patient's staging area. PUT each file's bytes to its
 * `uploadUrl`, then reference the returned `stagingKey` in a message/reply
 * post. Staged files that are never referenced are garbage-collected.
 */
export const createUploadUrlsSchema = z
  .object({
    /** Our patient id. Provide this OR `externalPatientId`. */
    patientId: idSchema.optional(),
    /** Your patient id. Provide this OR `patientId`. */
    externalPatientId: externalIdSchema.optional(),
    /** The files you intend to upload (1–5 per call). */
    files: z
      .array(
        z
          .object({
            /** File name (kept as the attachment display name). */
            fileName: z.string().min(1).max(256),
            /** MIME type, e.g. `image/jpeg`. */
            mimeType: z
              .string()
              .max(255)
              .regex(/^[-\w.+]+\/[-\w.+]+$/, 'must be a type/subtype MIME string'),
            /** Expected size in bytes (max 25 MiB); also enforced at upload. */
            sizeBytes: z.number().int().positive().max(MAX_ATTACHMENT_SIZE_BYTES).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_UPLOAD_FILES),
  })
  .strict()
  .refine(exactlyOnePatientRef, {message: patientRefMessage});

// ---------------------------------------------------------------------------
// Telehealth
// ---------------------------------------------------------------------------

/**
 * Body of `POST /v1/telehealth-consults`.
 *
 * Creates a live video consult in the `invited` state. The patient joins
 * exclusively through the `<natzar-telehealth>` embed — mint a session token
 * via `POST /v1/telehealth-consults/{id}/embed-session` and render the tag.
 */
/**
 * ONE medical licence, as a partner records it.
 *
 * `state` is an ISO 3166-2 subdivision code WITHOUT the country prefix (`CA`,
 * not `US-CA`); `country` defaults to the tenant's own. The pair is what
 * matters — "CA" is California to a US tenant and Canada to a Canadian one.
 */
export const physicianLicenseSchema = z
  .object({
    state: z.string().min(2).max(3),
    country: z.string().length(2).optional(),
    licenseNumber: z.string().max(64).optional(),
    /** Local date, YYYY-MM-DD. A lapsed licence stops routing automatically. */
    expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    /** Absent/true = usable. False keeps the record but stops routing on it. */
    active: z.boolean().optional(),
  })
  .strict();

/** Body of `PUT /v1/physicians/{id}/licenses`. A whole-list replace. */
export const setPhysicianLicensesSchema = z
  .object({
    licenses: z.array(physicianLicenseSchema).max(100),
  })
  .strict();

export const createTelehealthConsultSchema = z
  .object({
    /** Our patient id. Provide this OR `externalPatientId`. */
    patientId: idSchema.optional(),
    /** Your patient id. Provide this OR `patientId`. */
    externalPatientId: externalIdSchema.optional(),
    /** Clinical context — the physician's handoff summary. */
    context: z.string().min(1).max(MAX_CONTEXT_LENGTH).optional(),
    /**
     * Which live modality to open (docs/SCHEDULED-CONSULTS.md).
     *
     * `queue` (the default, and every consult created before this existed) puts
     * the patient in the on-demand waiting room. `scheduled` creates a consult
     * with no time yet: read `/slots`, then `/book` one. A `scheduled` consult
     * is never matched to whoever happens to be free — the whole point is that
     * the physician is chosen with the time.
     */
    mode: z.enum(['queue', 'scheduled']).optional(),
    /**
     * Route to one of the tenant's specialties, by slug. An unknown or inactive
     * slug is not an error: it degrades to the tenant's catch-all specialty,
     * because a bad routing hint must cost a generalist, never a consultation.
     * Omit to leave the consult unrouted (any physician may take it).
     */
    specialty: specialtySlugSchema.optional(),
  })
  .strict()
  .refine(exactlyOnePatientRef, {message: patientRefMessage});

/**
 * Query of `GET /v1/telehealth-consults/{id}/slots`. Pass the PATIENT's zone
 * as `timezone` and the whole grid comes back in it — `from`/`to` are read
 * in it, every slot's `localDate` is in it, and the response's `timezone`
 * confirms it — so a day grid groups by the patient's days, not the
 * clinic's. Without it the grid is in the clinic's zone.
 */
export const listTelehealthSlotsQuerySchema = z
  .object({
    /** First local date to offer, YYYY-MM-DD in `timezone` when given, else the clinic zone. */
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    /** Last local date to offer, likewise. Clamped to the tenant's booking horizon. */
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    /**
     * The zone to express the grid in — the patient's device zone. An
     * unknown id is `400 invalid_request`. Default: the clinic's zone.
     */
    timezone: ianaZoneSchema.optional(),
  })
  .strict();

/** Body of `POST /v1/telehealth-consults/{id}/book`. */
export const bookTelehealthConsultSchema = z
  .object({
    /** Exact `startsAt` of an offered slot. Anything else is `409 slot_taken`. */
    startsAt: z.string().datetime(),
    /**
     * Pin one of the physicians the slot was offered for. Optional: without
     * it the platform picks the least-loaded eligible physician within the
     * language tier — one who speaks the patient's language first, then
     * English, then anyone (see `./languages`). With it the booking is that
     * physician's or nobody's — a pin whose time was taken
     * meanwhile, or that was never offered, is `409 slot_taken` with a fresh
     * grid, never a silent re-route to a colleague the patient did not pick.
     */
    practitionerId: idSchema.optional(),
    /**
     * The PATIENT's zone (their device zone). Stored on the consult, echoed as
     * `appointment.patientTimezone`, and what the patient's own confirmation
     * and reminders are written in — with the physician's clock beside it
     * when the two differ. Omit and notices fall back to the clinic's zone.
     * Also the zone the returned `appointment` is expressed in.
     */
    patientTimezone: ianaZoneSchema.optional(),
    /**
     * The Payment row that bought this visit, when the tenant charges for it
     * (`payment_required` says so, with the amount). Must be `paid`, for this
     * patient and this scenario, and not yet spent on another visit; the
     * entitlement is asserted inside the same write that books the slot.
     * Omit on a free scenario — it is ignored there — and when the patient
     * paid through a checkout started for THIS consult
     * (`POST /v1/billing/visit-checkout {telehealthConsultId}`): that payment
     * is bound to the consult and adopted without its id. A slot lost after
     * paying (`409 slot_taken`) keeps the payment: book another time.
     */
    paymentId: idSchema.optional(),
  })
  .strict();

/** A local calendar date, `YYYY-MM-DD`. Real-date checks happen in the schedule engine. */
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

/**
 * One recurring window, as the schedule routes take it. The shape of
 * {@link ScheduleRule} minus the server id; the semantic checks (window order,
 * a real date, the every-N-weeks anchor) are the engine's
 * `normalizeScheduleRule`, applied after this schema — see `./schedule`.
 */
const scheduleRuleInputSchema = z
  .object({
    /** 0 = Sunday … 6 = Saturday, in the physician's calendar zone. */
    weekday: z.number().int().min(0).max(6),
    /** Minutes from local midnight; `endMinute` must exceed `startMinute`. */
    startMinute: z.number().int().min(0).max(1440),
    endMinute: z.number().int().min(0).max(1440),
    /**
     * Legacy — leave it out. Every rule is read in the physician's calendar
     * zone, which is set with `timezone` on the schedule body, not per rule.
     * A value equal to that zone is accepted (and stored as null); any other
     * value refuses the row with `rule_zone_mismatch`.
     */
    timezone: z.string().min(1).max(64).nullish(),
    /** Inclusive local-date validity range, YYYY-MM-DD. */
    effectiveFrom: localDateSchema.nullish(),
    effectiveUntil: localDateSchema.nullish(),
    /**
     * Repeat every N weeks (default 1). N > 1 REQUIRES `effectiveFrom`: the
     * first occurrence is the first `weekday` on or after it.
     */
    intervalWeeks: z.number().int().min(1).max(MAX_RULE_INTERVAL_WEEKS).nullish(),
    /** Restrict this window to one specialty slug. */
    specialty: specialtySlugSchema.nullish(),
    /** False keeps the rule but publishes nothing from it. Default true. */
    active: z.boolean().nullish(),
  })
  .strict();

/**
 * One dated exception, as the schedule routes take it. `endDate` makes it a
 * range (inclusive, at most `MAX_EXCEPTION_SPAN_DAYS` long). `block` beats
 * `open` wherever they overlap.
 */
const scheduleExceptionInputSchema = z
  .object({
    /** First (or only) local date. */
    date: localDateSchema,
    /** Last local date, inclusive. Omit for a single day. */
    endDate: localDateSchema.nullish(),
    kind: z.enum(['block', 'open']),
    /** BOTH or NEITHER — omitting both means the whole of each day. */
    startMinute: z.number().int().min(0).max(1440).nullish(),
    endMinute: z.number().int().min(0).max(1440).nullish(),
    /** `open` only: restrict the extra hours to one specialty slug. */
    specialty: specialtySlugSchema.nullish(),
    /** Shown to the physician only. */
    reason: z.string().max(MAX_EXCEPTION_REASON_LENGTH).nullish(),
  })
  .strict();

/**
 * Body of `PUT /v1/physicians/{id}/schedule`. A WHOLE replace: every rule
 * and every exception the physician has — on any date, past or future — is
 * replaced by what is sent.
 */
export const setPhysicianScheduleSchema = z
  .object({
    /** Recurring windows. Replaces every existing rule for this physician. */
    rules: z.array(scheduleRuleInputSchema).max(MAX_RULES_PER_PHYSICIAN),
    /** Dated exceptions. Replaces every existing exception, whatever its date. */
    exceptions: z.array(scheduleExceptionInputSchema).max(MAX_EXCEPTIONS_PER_WRITE).optional(),
    /**
     * The physician's calendar zone — the ONE zone every rule and exception
     * of theirs is read in, and the zone the response is expressed in.
     * Applied before the rules, so a rota and its zone land together. Omit
     * to leave the stored zone as it is (the clinic's when none was ever
     * set); use `PATCH` with `null` to clear it. Changing it keeps every
     * rule's clock time ("Tuesday 09:00" stays 09:00) and moves the instants
     * patients can book; booked appointments do not move.
     */
    timezone: ianaZoneSchema.optional(),
  })
  .strict();

/**
 * Body of `PATCH /v1/physicians/{id}/schedule` — a CHANGE SET, the way a
 * calendar edits: rows with an `id` (from a prior read) are updated, rows
 * without are created, and the two id lists are deleted. Rows not mentioned
 * are untouched, however far in the future they lie. Any field may be omitted.
 *
 * This is what `diffSchedule` in `./schedule` produces from an edited
 * document, and what the platform's own calendars send.
 */
export const updatePhysicianScheduleSchema = z
  .object({
    /** Rules to create (no `id`) or update (`id` of an existing rule of this physician). */
    rules: z.array(scheduleRuleInputSchema.extend({id: idSchema.optional()})).max(MAX_RULES_PER_PHYSICIAN).optional(),
    /** Exceptions to create or update, likewise. */
    exceptions: z
      .array(scheduleExceptionInputSchema.extend({id: idSchema.optional()}))
      .max(MAX_EXCEPTIONS_PER_WRITE)
      .optional(),
    /** Rules to delete. Ids that are not this physician's are ignored. */
    deletedRuleIds: z.array(idSchema).max(MAX_RULES_PER_PHYSICIAN).optional(),
    /** Exceptions to delete, likewise. */
    deletedExceptionIds: z.array(idSchema).max(MAX_EXCEPTIONS_PER_WRITE).optional(),
    /**
     * Set (a zone id) or clear (`null` → back to the clinic's zone) the
     * physician's calendar zone; absent = unchanged. Applied BEFORE the rows
     * of this change set, so a rule sent alongside is read in the new zone.
     * A body carrying only `timezone` is a valid, zone-only save. Rules keep
     * their clock times across the change; appointments keep their instants.
     */
    timezone: ianaZoneSchema.nullable().optional(),
  })
  .strict();

/**
 * Query of `GET`, `PUT` and `PATCH /v1/physicians/{id}/schedule`: the
 * calendar range the response describes, as inclusive local dates in the
 * physician's calendar zone (the response's `timezone`). Default: today →
 * the tenant's planning horizon. Longer than `MAX_SCHEDULE_RANGE_DAYS` is
 * clamped; page by range to go further. Rules are always returned whole.
 */
export const physicianScheduleQuerySchema = z
  .object({
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
  })
  .strict();

/** Query of `GET /v1/telehealth-consults`. Sorted by `sentAt` descending. */
export const listTelehealthConsultsQuerySchema = z
  .object({
    /** Filter to one patient by our id. Combine with neither or `externalPatientId`. */
    patientId: idSchema.optional(),
    /** Filter to one patient by your id. */
    externalPatientId: externalIdSchema.optional(),
    /** Filter to one lifecycle state. */
    status: z
      .enum(['invited', 'scheduled', 'waiting', 'ringing', 'in_progress', 'completed', 'cancelled', 'no_show'])
      .optional(),
    /**
     * Filter to the consults a physician took or is booked for — our id of
     * the physician, or `me` for the acting one (requires a physician
     * credential).
     */
    practitionerId: idSchema.optional(),
    /** Filter to the live queue (`queue`) or booked appointments (`scheduled`). */
    mode: z.enum(['queue', 'scheduled']).optional(),
    /**
     * Which origins to include. Defaults to `partner` for the tenant key
     * alone and `any` with a physician credential — see `ConsultOrigin`.
     */
    origin: originFilterSchema.optional(),
    /** Opaque cursor from the previous page. */
    cursor: cursorSchema.optional(),
    /** Page size, 1–100. */
    limit: limitSchema.optional(),
  })
  .strict()
  .refine(atMostOnePatientRef, {message: atMostOnePatientRefMessage});

/**
 * Body of `POST /v1/telehealth-consults/{id}/join` — the patient's presence
 * heartbeat AND the waiting-room read, in one call.
 *
 * Call it when the patient opens your waiting-room screen and every ~10
 * seconds while it stays open: presence is a 30-second TTL, so a client that
 * stops calling simply leaves the queue (there is no explicit "leave"). The
 * response tells you what to render — queue position while `waiting`, and
 * the LiveKit `token`/`url` the moment a physician picks the call up.
 *
 * STOP calling it when the patient backgrounds the screen; continuing to
 * heartbeat for a patient who isn't watching holds a queue slot they can't
 * use.
 *
 * PAYMENT: when the tenant charges for on-demand video, the FIRST join of an
 * unpaid consult answers `402 payment_required` (with the amount and
 * scenario) instead of queueing the patient. Pay, then join again — with the
 * `paymentId`, or without it when the checkout was started for this consult
 * (`POST /v1/billing/visit-checkout {telehealthConsultId}`): a paid payment
 * bound to the consult is adopted. Once a payment is attached, later joins
 * need nothing.
 */
export const joinTelehealthConsultSchema = z
  .object({
    /**
     * The Payment row that pays for this call, when the tenant charges for
     * it. Must be `paid`, for this patient and the telehealth `live`
     * scenario, and not spent on another visit; it is attached to the
     * consult by a conditional write before the patient is queued. Omit on a
     * free scenario, on a consult already paid for, or when a checkout bound
     * to this consult was paid (it is adopted).
     */
    paymentId: idSchema.optional(),
  })
  .strict();

/**
 * Body of `POST /v1/telehealth-consults/{id}/rate` — the patient's
 * post-call feedback. Write-once: the first rating stands and later calls
 * return the consult unchanged. Only valid once the call has ended
 * (`409 thread_not_active` before, and for a consult that never held a call).
 */
export const rateTelehealthConsultSchema = z
  .object({
    /** 1–5: how well the physician communicated. */
    communicationRating: z.number().int().min(1).max(5),
    /** 1–5: overall impression of the physician. */
    overallPhysicianRating: z.number().int().min(1).max(5),
    /** Optional free-text comment. */
    feedback: z.string().min(1).max(MAX_CONTEXT_LENGTH).optional(),
  })
  .strict();

/**
 * Body of `POST /v1/telehealth-consults/{id}/cancel`. Only valid before the
 * call starts — `invited`, `scheduled` or `waiting` (`409
 * consult_not_cancellable` from `in_progress` on). The body may be omitted
 * entirely.
 *
 * With a physician credential on a BOOKED consult this is the clinician
 * cancelling their own appointment: the slot is released in the same write,
 * the patient is notified, and `reason` (if given) is what they are told.
 */
export const cancelTelehealthConsultSchema = z
  .object({
    /**
     * Why the appointment is being cancelled, in the patient's own words'
     * worth of plain text — relayed to them with the cancellation notice.
     * Recorded on the consult either way.
     */
    reason: z.string().min(1).max(500).optional(),
  })
  .strict();

/**
 * Body of `POST /v1/telehealth-consults/{id}/room` — the acting physician
 * asks for the way into their call. An empty object (or omit it).
 *
 * Requires a physician credential, and the consult must be assigned to that
 * physician (`409 not_assigned` otherwise — including while it is still
 * `waiting` for a match). What comes back depends on the consult's state:
 * `in_progress` carries a LiveKit grant; `ringing` carries none (the patient's
 * client is still confirming — keep polling the workspace); a terminal state
 * carries only `status`. Calling it also counts as a presence heartbeat.
 */
export const telehealthRoomSchema = z.object({}).strict();

/**
 * Body of `POST /v1/telehealth-consults/{id}/end` — hang up. Idempotent on a
 * consult that already ended (returns it unchanged, `next: null`).
 *
 * With a physician credential the caller must be the consult's practitioner
 * (`409 not_assigned`). With the tenant key alone this is an administrative
 * end of somebody else's call; the practitioner on the row is still put back
 * on the rota (or offline) exactly as if they had hung up themselves.
 */
export const endTelehealthConsultSchema = z
  .object({
    /**
     * What the physician does next. `false` (default) — back to `ready`, and
     * the queue is re-matched immediately: the response's `next` is the
     * consult now ringing for them, if any. `true` — go `offline` after this
     * call; `next` is always null.
     */
    goOffline: z.boolean().optional(),
  })
  .strict();

/**
 * Body of `POST /v1/telehealth-consults/{id}/ready` — the BOOKED physician's
 * presence in the waiting room of a `scheduled` consult, the twin of the
 * patient's `/join` for appointments.
 *
 * Call it when the physician opens the appointment and every ~10 seconds
 * while they stay; the call starts the moment both sides are present inside
 * the appointment window. Only the practitioner the slot was booked with may
 * call it (`409 not_assigned`).
 */
export const telehealthReadySchema = z
  .object({
    /**
     * `true` (default) — I am here, keep me present. `false` — I stepped away:
     * releases presence without ending anything, so the patient's screen can
     * say the clinician is not in the room rather than showing a stale
     * "connecting".
     */
    present: z.boolean().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Prescriptions (./prescriptions)
// ---------------------------------------------------------------------------

/**
 * A coordinate as the platform's own pickers send it: a finite number. Only
 * the SHAPE is checked here — a latitude of 200 passes the schema and is
 * refused by the route as `422 invalid_location`, because "not a place on
 * Earth" is a fact about the values, not about the request being well-formed.
 *
 * The query form parses a decimal string itself rather than `z.coerce`,
 * which would read an empty `?lat=` as 0 (a real latitude) instead of a
 * malformed one.
 */
const coordinateSchema = z.number().finite();
const coordinateQuerySchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'must be a decimal number')
  .transform(Number);

/**
 * Query of `GET /v1/prescriptions/{id}/pharmacies` — the picker's list.
 *
 * Pass the origin you resolved (`lat`/`lng`, with `source` saying how) and
 * the list comes back ranked by distance from it; without one the server
 * ranks by the patient's cached home location, and without THAT it answers
 * `homeAddress` for you to geocode (then store with `POST …/home-location`
 * so the next search needs no geocoding). `query` filters by name, city or
 * postal code; `radiusKm` widens the search in the steps of
 * `PHARMACY_SEARCH_RADII_KM`.
 */
export const listPharmaciesQuerySchema = z
  .object({
    /** Origin latitude, with `lng`. Both or neither. */
    lat: coordinateQuerySchema.optional(),
    /** Origin longitude, with `lat`. Both or neither. */
    lng: coordinateQuerySchema.optional(),
    /** How the origin was arrived at; defaults to `manual`. See `PharmacySearchOrigin`. */
    source: z.enum(['address', 'device', 'ip', 'manual']).optional(),
    /** Human label of the origin, echoed back ("Home", "Near Toronto"). */
    label: z.string().min(1).max(80).optional(),
    /** Name / city / postal-code filter. */
    query: z.string().min(1).max(120).optional(),
    /** Search radius, km — one of `PHARMACY_SEARCH_RADII_KM`. Default: the smallest. */
    radiusKm: z.coerce
      .number()
      .refine((n) => (PHARMACY_SEARCH_RADII_KM as readonly number[]).includes(n), {
        message: `must be one of ${PHARMACY_SEARCH_RADII_KM.join(', ')}`,
      })
      .optional(),
  })
  .strict()
  .refine((q) => (q.lat === undefined) === (q.lng === undefined), {
    message: 'lat and lng must be provided together',
    path: ['lat'],
  });

/** Body of `POST /v1/prescriptions/{id}/pharmacy` — the patient's choice. */
export const choosePharmacySchema = z
  .object({
    /** `directoryId` of a pharmacy from `GET …/pharmacies`. */
    directoryId: idSchema,
  })
  .strict();

/**
 * Body of `POST /v1/prescriptions/{id}/home-location` — the patient's home,
 * geocoded on your side, cached on their record so every later pharmacy
 * search (yours, the app's, the widget's) starts from it.
 */
export const setHomeLocationSchema = z
  .object({
    lat: coordinateSchema,
    lng: coordinateSchema,
  })
  .strict();

/**
 * Body of `POST /v1/prescriptions/{id}/pharmacies` — a pharmacy the
 * directory does not list (fax deployments only). Name and address are what
 * places it; the fax line is optional, and until it is verified the row is
 * `reachable: false`. The platform's directory normaliser bounds the lengths
 * further and decides the province.
 */
export const addPharmacySchema = z
  .object({
    name: z.string().min(1).max(120),
    address: z.string().min(1).max(200),
    city: z.string().min(1).max(80).optional(),
    /** Province / state code or name; defaults to the patient's. */
    region: z.string().min(1).max(40).optional(),
    postalCode: z.string().min(1).max(12).optional(),
    /** The pharmacy's fax line, as printed — normalised server-side. */
    fax: z.string().min(1).max(40).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * Query of `GET /v1/events` — the durable webhook replay log, oldest first.
 * Use `since` to start from a timestamp, then follow `nextCursor`.
 */
export const listEventsQuerySchema = z
  .object({
    /** Return events created at/after this ISO-8601 timestamp. */
    since: isoDateTimeSchema.optional(),
    /** Opaque cursor from the previous page. */
    cursor: cursorSchema.optional(),
    /** Page size, 1–100. */
    limit: limitSchema.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Inferred request types (consumed and re-exported by ./endpoints)
// ---------------------------------------------------------------------------

/** Inferred body of `POST /v1/patients`. See {@link upsertPatientSchema}. */
export type UpsertPatientRequest = z.infer<typeof upsertPatientSchema>;
/** Inferred query of `GET /v1/patients`. See {@link listPatientsQuerySchema}. */
export type ListPatientsQuery = z.infer<typeof listPatientsQuerySchema>;
/** Inferred body of `PATCH /v1/patients/{id}`. See {@link updatePatientSchema}. */
export type UpdatePatientRequest = z.infer<typeof updatePatientSchema>;
/** Inferred body of `POST /v1/physicians`. See {@link createPhysicianSchema}. */
export type CreatePhysicianRequest = z.infer<typeof createPhysicianSchema>;
/** Inferred query of `GET /v1/physicians`. See {@link listPhysiciansQuerySchema}. */
export type ListPhysiciansQuery = z.infer<typeof listPhysiciansQuerySchema>;
/** Inferred body of `POST /v1/physicians/{id}/availability`. See {@link setPhysicianAvailabilitySchema}. */
export type SetPhysicianAvailabilityRequest = z.infer<typeof setPhysicianAvailabilitySchema>;
/** Inferred body of `POST /v1/physicians/{id}/session`. See {@link createPhysicianSessionSchema}. */
export type CreatePhysicianSessionRequest = z.infer<typeof createPhysicianSessionSchema>;
/** Inferred body of `POST /v1/physicians/{id}/presence`. See {@link setPhysicianPresenceSchema}. */
export type SetPhysicianPresenceRequest = z.infer<typeof setPhysicianPresenceSchema>;
/** Inferred body of `POST /v1/physicians/{id}/heartbeat`. See {@link physicianHeartbeatSchema}. */
export type PhysicianHeartbeatRequest = z.infer<typeof physicianHeartbeatSchema>;
/** Inferred query of `GET /v1/physicians/{id}/agenda`. See {@link physicianAgendaQuerySchema}. */
export type PhysicianAgendaQuery = z.infer<typeof physicianAgendaQuerySchema>;
/** Inferred body of `PUT /v1/physicians/{id}/specialties`. See {@link setPhysicianSpecialtiesSchema}. */
export type SetPhysicianSpecialtiesRequest = z.infer<typeof setPhysicianSpecialtiesSchema>;
/** Inferred body of `PUT /v1/physicians/{id}/languages`. See {@link setPhysicianLanguagesSchema}. */
export type SetPhysicianLanguagesRequest = z.infer<typeof setPhysicianLanguagesSchema>;
/** Inferred body of `POST /v1/async-consults/{id}/escalate`. See {@link escalateAsyncConsultSchema}. */
export type EscalateAsyncConsultRequest = z.infer<typeof escalateAsyncConsultSchema>;
/** Inferred body of `POST /v1/telehealth-consults/{id}/room`. See {@link telehealthRoomSchema}. */
export type TelehealthRoomRequest = z.infer<typeof telehealthRoomSchema>;
/** Inferred body of `POST /v1/telehealth-consults/{id}/end`. See {@link endTelehealthConsultSchema}. */
export type EndTelehealthConsultRequest = z.infer<typeof endTelehealthConsultSchema>;
/** Inferred body of `POST /v1/telehealth-consults/{id}/ready`. See {@link telehealthReadySchema}. */
export type TelehealthReadyRequest = z.infer<typeof telehealthReadySchema>;
/** Inferred query of `GET /v1/patients/state`. See {@link getPatientStateQuerySchema}. */
export type GetPatientStateQuery = z.infer<typeof getPatientStateQuerySchema>;
/** Inferred body of `POST /v1/async-consults/{id}/consent`. See {@link respondAsyncConsentSchema}. */
export type RespondAsyncConsentRequest = z.infer<typeof respondAsyncConsentSchema>;
/** Inferred body of `POST /v1/async-consults/{id}/rate`. See {@link rateAsyncConsultSchema}. */
export type RateAsyncConsultRequest = z.infer<typeof rateAsyncConsultSchema>;
/** Inferred body of `POST /v1/telehealth-consults/{id}/join`. See {@link joinTelehealthConsultSchema}. */
export type JoinTelehealthConsultRequest = z.infer<typeof joinTelehealthConsultSchema>;
/** Inferred body of `POST /v1/telehealth-consults/{id}/rate`. See {@link rateTelehealthConsultSchema}. */
export type RateTelehealthConsultRequest = z.infer<typeof rateTelehealthConsultSchema>;
/** Inferred body of `POST /v1/agent/embed-session`. See {@link createAgentEmbedSessionSchema}. */
export type CreateAgentEmbedSessionRequest = z.infer<typeof createAgentEmbedSessionSchema>;
/** Inferred body of `POST /v1/agent/messages`. See {@link postAgentMessageSchema}. */
export type PostAgentMessageRequest = z.infer<typeof postAgentMessageSchema>;
/** Inferred query of `GET /v1/agent/messages`. See {@link listAgentMessagesQuerySchema}. */
export type ListAgentMessagesQuery = z.infer<typeof listAgentMessagesQuerySchema>;
/** Inferred body of `POST /v1/async-consults`. See {@link createAsyncConsultSchema}. */
export type CreateAsyncConsultRequest = z.infer<typeof createAsyncConsultSchema>;
/** Inferred query of `GET /v1/async-consults`. See {@link listAsyncConsultsQuerySchema}. */
export type ListAsyncConsultsQuery = z.infer<typeof listAsyncConsultsQuerySchema>;
/** Inferred query of `GET /v1/async-consults/{id}/messages`. See {@link listAsyncMessagesQuerySchema}. */
export type ListAsyncMessagesQuery = z.infer<typeof listAsyncMessagesQuerySchema>;
/** Inferred body of `POST /v1/async-consults/{id}/messages`. See {@link postAsyncMessageSchema}. */
export type PostAsyncMessageRequest = z.infer<typeof postAsyncMessageSchema>;
/** Inferred body of `POST /v1/async-consults/{id}/replies`. See {@link postAsyncReplySchema}. */
export type PostAsyncReplyRequest = z.infer<typeof postAsyncReplySchema>;
/** Inferred body of `POST /v1/async-consults/{id}/referrals`. See {@link issueReferralSchema}. */
export type IssueReferralRequest = z.infer<typeof issueReferralSchema>;
export type IssuePrescriptionRequest = z.infer<typeof issuePrescriptionSchema>;
/** Inferred body of `POST /v1/async-consults/{id}/claim`. See {@link claimAsyncConsultSchema}. */
export type ClaimAsyncConsultRequest = z.infer<typeof claimAsyncConsultSchema>;
/** Inferred body of `POST /v1/async-consults/{id}/takeover`. See {@link takeoverAsyncConsultSchema}. */
export type TakeoverAsyncConsultRequest = z.infer<typeof takeoverAsyncConsultSchema>;
/** Inferred body of `POST /v1/async-consults/{id}/resolve`. See {@link resolveAsyncConsultSchema}. */
export type ResolveAsyncConsultRequest = z.infer<typeof resolveAsyncConsultSchema>;
/** Inferred body of `POST /v1/async-consults/{id}/close`. See {@link closeAsyncConsultSchema}. */
export type CloseAsyncConsultRequest = z.infer<typeof closeAsyncConsultSchema>;
/** Inferred body of `POST /v1/…/{id}/embed-session`. See {@link createEmbedSessionSchema}. */
export type CreateEmbedSessionRequest = z.infer<typeof createEmbedSessionSchema>;
/** Inferred body of `POST /v1/attachments/upload-urls`. See {@link createUploadUrlsSchema}. */
export type CreateUploadUrlsRequest = z.infer<typeof createUploadUrlsSchema>;
/** Inferred body of `POST /v1/telehealth-consults`. See {@link createTelehealthConsultSchema}. */
export type CreateTelehealthConsultRequest = z.infer<typeof createTelehealthConsultSchema>;
/** Inferred query of `GET /v1/telehealth-consults`. See {@link listTelehealthConsultsQuerySchema}. */
export type ListTelehealthConsultsQuery = z.infer<typeof listTelehealthConsultsQuerySchema>;
/** Inferred body of `POST /v1/telehealth-consults/{id}/cancel`. See {@link cancelTelehealthConsultSchema}. */
export type CancelTelehealthConsultRequest = z.infer<typeof cancelTelehealthConsultSchema>;
/** Inferred query of `GET /v1/telehealth-consults/{id}/slots`. See {@link listTelehealthSlotsQuerySchema}. */
export type ListTelehealthSlotsQuery = z.infer<typeof listTelehealthSlotsQuerySchema>;
/** Inferred body of `POST /v1/telehealth-consults/{id}/book`. See {@link bookTelehealthConsultSchema}. */
export type BookTelehealthConsultRequest = z.infer<typeof bookTelehealthConsultSchema>;
/** Inferred body of `PUT /v1/physicians/{id}/schedule`. See {@link setPhysicianScheduleSchema}. */
export type SetPhysicianScheduleRequest = z.infer<typeof setPhysicianScheduleSchema>;
/** Inferred body of `PATCH /v1/physicians/{id}/schedule`. See {@link updatePhysicianScheduleSchema}. */
export type UpdatePhysicianScheduleRequest = z.infer<typeof updatePhysicianScheduleSchema>;
/** Inferred query of the `/v1/physicians/{id}/schedule` routes. See {@link physicianScheduleQuerySchema}. */
export type PhysicianScheduleQuery = z.infer<typeof physicianScheduleQuerySchema>;
/** Inferred body of `PUT /v1/physicians/{id}/licenses`. See {@link setPhysicianLicensesSchema}. */
export type SetPhysicianLicensesRequest = z.infer<typeof setPhysicianLicensesSchema>;
/** One licence entry. See {@link physicianLicenseSchema}. */
export type PhysicianLicenseInput = z.infer<typeof physicianLicenseSchema>;
/** Inferred query of `GET /v1/events`. See {@link listEventsQuerySchema}. */
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;

/** Inferred query of `GET /v1/prescriptions/{id}/pharmacies`. See {@link listPharmaciesQuerySchema}. */
export type ListPharmaciesQuery = z.infer<typeof listPharmaciesQuerySchema>;

/** Inferred body of `POST /v1/prescriptions/{id}/pharmacy`. See {@link choosePharmacySchema}. */
export type ChoosePharmacyRequest = z.infer<typeof choosePharmacySchema>;

/** Inferred body of `POST /v1/prescriptions/{id}/home-location`. See {@link setHomeLocationSchema}. */
export type SetHomeLocationRequest = z.infer<typeof setHomeLocationSchema>;

/** Inferred body of `POST /v1/prescriptions/{id}/pharmacies`. See {@link addPharmacySchema}. */
export type AddPharmacyRequest = z.infer<typeof addPharmacySchema>;
