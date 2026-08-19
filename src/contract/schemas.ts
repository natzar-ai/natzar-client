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
    /** Clinical context — the physician's handoff summary ("why they're here"). */
    context: z.string().min(1).max(MAX_CONTEXT_LENGTH).optional(),
    /** Consent mode — see the schema description. */
    consent: z.enum(['collected', 'embed']),
  })
  .strict()
  .refine(exactlyOnePatientRef, {message: patientRefMessage});

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
export const createTelehealthConsultSchema = z
  .object({
    /** Our patient id. Provide this OR `externalPatientId`. */
    patientId: idSchema.optional(),
    /** Your patient id. Provide this OR `patientId`. */
    externalPatientId: externalIdSchema.optional(),
    /** Clinical context — the physician's handoff summary. */
    context: z.string().min(1).max(MAX_CONTEXT_LENGTH).optional(),
  })
  .strict()
  .refine(exactlyOnePatientRef, {message: patientRefMessage});

/** Query of `GET /v1/telehealth-consults`. Sorted by `sentAt` descending. */
export const listTelehealthConsultsQuerySchema = z
  .object({
    /** Filter to one patient by our id. Combine with neither or `externalPatientId`. */
    patientId: idSchema.optional(),
    /** Filter to one patient by your id. */
    externalPatientId: externalIdSchema.optional(),
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
 */
export const joinTelehealthConsultSchema = z.object({}).strict();

/**
 * Body of `POST /v1/telehealth-consults/{id}/rate` — the patient's
 * post-call feedback. Write-once: the first rating stands and later calls
 * return the consult unchanged. Only valid once the call has ended
 * (`409 not_ended` before).
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
 * Body of `POST /v1/telehealth-consults/{id}/cancel`. Only valid while the
 * consult is `invited` or `waiting` (`409 consult_not_cancellable` after the
 * call starts). The body is an empty object (or omit it entirely).
 */
export const cancelTelehealthConsultSchema = z.object({}).strict();

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
/** Inferred query of `GET /v1/events`. See {@link listEventsQuerySchema}. */
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
