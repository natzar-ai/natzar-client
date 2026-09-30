// GENERATED FILE — do not edit.
//
// Copied verbatim from provider-portal's shared/partner-api by
// scripts/sync-contract.mjs. Edit the source there; this copy exists only so
// the published package is self-contained.
/**
 * zod request schemas of the provider embed routes (`/v1/provider-embed`).
 * The server validates every body and query string against these after it
 * has authenticated the request and before the operation runs; the
 * hand-written interfaces in `./provider-embed` are the documented surface,
 * and a test holds the two in lockstep.
 *
 * Every object schema is `.strict()`: an unknown key is rejected. The one
 * exception depends on the zod major: zod 4 (the platform) drops an own
 * `__proto__` key, such as one `JSON.parse` produces, from the parsed result
 * instead of rejecting it, while zod 3 rejects it. Browser routes never take
 * identity (group, partner, clinician) from a body or query string; on the
 * server-only mint and renew routes your API key determines the group and
 * partner, and the body only names the clinician. Query strings arrive as
 * strings, so only `limit` is coerced.
 *
 * The schemas use a zod subset whose accept and reject decisions agree
 * between the platform's zod 4 and the published client's zod 3. Where the
 * two majors' built-ins differ (the timezone offsets
 * `z.string().datetime({offset: true})` accepts), an extra check narrows both
 * to the same set; the `__proto__` key above is the only known difference.
 * Validation failures are reported as issue paths and codes only; input
 * values are never echoed.
 *
 * Parsed types are named after their schema: `ProviderEmbed<Name>Body` for
 * bodies and `ProviderEmbed<Name>QueryParsed` for query strings.
 *
 * @packageDocumentation
 */

import {z} from 'zod';
import {
  PROVIDER_EMBED_AGENDA_MAX_WINDOW_MS,
  PROVIDER_EMBED_CAPABILITIES,
  PROVIDER_EMBED_CONSULT_KINDS,
  PROVIDER_EMBED_MAX_PAGE_LIMIT,
  PROVIDER_EMBED_MAX_PENDING_MESSAGE_IDS,
  PROVIDER_EMBED_MAX_REFERRAL_DRAFTS,
} from './provider-embed';
import {issuePrescriptionSchema, MAX_MESSAGE_LENGTH, referralDraftSchema} from './schemas';

// Private primitives (redeclared rather than imported: schemas.ts keeps its own private).
const idSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const externalIdSchema = z.string().min(1).max(128).regex(/^\S+$/);
const capabilitySchema = z.enum(PROVIDER_EMBED_CAPABILITIES);
const kindSchema = z.enum(PROVIDER_EMBED_CONSULT_KINDS);
const uniqueCaps = (a: readonly string[]) => new Set(a).size === a.length;
// zod 3 also accepts compact (`+0200`) and out-of-range (`+25:00`) offsets that
// zod 4 rejects; the regex narrows both majors to `Z` or a valid `±HH:MM`.
const isoDateTimeSchema = z.string().datetime({offset: true}).regex(/(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/);
const cursorSchema = z.string().min(1).max(2048).regex(/^c1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
const limitSchema = z.coerce.number().int().min(1).max(PROVIDER_EMBED_MAX_PAGE_LIMIT);
const referralLangSchema = z.enum(['en', 'es', 'de', 'fr', 'it']);

/** Exactly one of `physicianId` (ours) or `externalPhysicianId` (yours). */
export const providerEmbedClinicianRefSchema = z.union([
  z.object({physicianId: idSchema}).strict(),
  z.object({externalPhysicianId: externalIdSchema}).strict(),
]);
const mintCommon = {
  clinician: providerEmbedClinicianRefSchema,
  clinicianToken: z.string().min(20).max(8192).regex(/^[A-Za-z0-9_.-]+$/).optional(),
  parentOrigin: z.string().min(8).max(255),
  capabilities: z.array(capabilitySchema).min(1).max(PROVIDER_EMBED_CAPABILITIES.length).refine(uniqueCaps, {message: 'duplicate capability'}),
  optionalCapabilities: z.array(capabilitySchema).max(PROVIDER_EMBED_CAPABILITIES.length).refine(uniqueCaps, {message: 'duplicate capability'}).optional(),
  maxAbsoluteSeconds: z.number().int().min(300).max(28_800).optional(),
  idleTimeoutSeconds: z.number().int().min(60).max(900).optional(),
};
const workspaceMint = z.object({mode: z.literal('workspace'), ...mintCommon}).strict();
const consultationMint = z.object({
  mode: z.literal('consultation'),
  resource: z.object({kind: kindSchema, consultationId: idSchema}).strict(),
  ...mintCommon,
}).strict();
const patientMint = z.object({
  mode: z.literal('patient'),
  resource: z.union([z.object({patientId: idSchema}).strict(), z.object({externalPatientId: externalIdSchema}).strict()]),
  ...mintCommon,
}).strict();
/** v1 mint body (rejects `mode: 'patient'`). */
export const providerEmbedMintSchema = z.discriminatedUnion('mode', [workspaceMint, consultationMint]);
/** Mint body once PROVIDER_EMBED_PATIENT_MODE is on (server selects; D9). */
export const providerEmbedMintSchemaWithPatient = z.discriminatedUnion('mode', [workspaceMint, consultationMint, patientMint]);
/** Body of `POST /v1/provider-embed/sessions/{sessionId}/renew`. */
export const providerEmbedRenewSchema = z.object({
  clinician: providerEmbedClinicianRefSchema,
  clinicianToken: mintCommon.clinicianToken,
}).strict();
/** An empty body (`{}`), for the routes that take none. */
export const providerEmbedEmptySchema = z.object({}).strict();
/** Query of `GET /v1/provider-embed/agenda`: a window of 0 to 31 days. */
export const providerEmbedAgendaQuerySchema = z.object({from: isoDateTimeSchema.optional(), to: isoDateTimeSchema.optional()}).strict()
  .refine((q) => !q.from || !q.to || (Date.parse(q.to) >= Date.parse(q.from) && Date.parse(q.to) - Date.parse(q.from) <= PROVIDER_EMBED_AGENDA_MAX_WINDOW_MS), {message: 'window must be 0..31 days'});
/** Query of `GET /v1/provider-embed/consultations`. */
export const providerEmbedConsultationsQuerySchema = z.object({
  kind: kindSchema.optional(), state: z.enum(['open', 'closed']).optional(), cursor: cursorSchema.optional(), limit: limitSchema.optional(),
}).strict();
/** Query of `GET /v1/provider-embed/consultations/async/{id}/messages`. */
export const providerEmbedMessagesQuerySchema = z.object({
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  pending: z.string().max(PROVIDER_EMBED_MAX_PENDING_MESSAGE_IDS * 37 - 1)
    .regex(/^[0-9a-f-]{36}(,[0-9a-f-]{36})*$/)
    .refine((s) => s.split(',').length <= PROVIDER_EMBED_MAX_PENDING_MESSAGE_IDS, {message: 'too many ids'})
    .optional(),
}).strict();
/** Body of `POST …/consultations/async/{id}/replies`. */
export const providerEmbedReplySchema = z.object({
  text: z.string().min(1).max(MAX_MESSAGE_LENGTH).refine((t) => t.trim().length > 0, {message: 'text is blank'}),
  uploadId: z.string().regex(/^[A-Za-z0-9_-]{22}$/).optional(),
}).strict();
/** Body of `POST …/consultations/async/{id}/resolve`. */
export const providerEmbedResolveSchema = z.object({note: z.string().min(1).max(500).optional()}).strict();
/** Body of `POST …/consultations/{kind}/{id}/uploads`. */
export const providerEmbedUploadSchema = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z.string().min(3).max(127).regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/),
  contentLength: z.number().int().min(1).max(25 * 1024 * 1024),
}).strict();
/** Body of the referral preview and issue routes: one draft, or a bundle of 1–5. */
export const providerEmbedReferralSchema = z.union([
  z.object({draft: referralDraftSchema, lang: referralLangSchema.optional()}).strict(),
  z.object({drafts: z.array(referralDraftSchema).min(1).max(PROVIDER_EMBED_MAX_REFERRAL_DRAFTS), lang: referralLangSchema.optional()}).strict(),
]);
/** Body of the prescription preview and issue routes. */
export const providerEmbedPrescriptionSchema = z.object({draft: issuePrescriptionSchema.shape.draft}).strict();
/** Body of `POST …/telehealth/{id}/room`: absent `mediaSessionId` joins, present extends the media lease. */
export const providerEmbedRoomSchema = z.object({mediaSessionId: z.string().regex(/^[A-Za-z0-9_-]{22}$/).optional()}).strict();
/** Body of `POST …/telehealth/{id}/ready`. */
export const providerEmbedReadySchema = z.object({present: z.boolean().optional()}).strict();
/** Body of `POST …/telehealth/{id}/end`. */
export const providerEmbedEndSchema = z.object({goOffline: z.boolean().optional()}).strict();
/** Body of `POST …/telehealth/{id}/cancel`. */
export const providerEmbedCancelSchema = z.object({reason: z.string().min(1).max(500).optional()}).strict();
/** Body of `POST /v1/provider-embed/presence`. */
export const providerEmbedPresenceSchema = z.object({ready: z.boolean()}).strict();
/** Body of `POST /v1/provider-embed/availability`. */
export const providerEmbedAvailabilitySchema = z.object({asyncAvailable: z.boolean()}).strict();
/** Query of `GET /v1/provider-embed/patient/history`. */
export const providerEmbedPatientHistoryQuerySchema = z.object({cursor: cursorSchema.optional(), limit: limitSchema.optional()}).strict();

/** Parsed clinician reference. See {@link providerEmbedClinicianRefSchema}. */
export type ProviderEmbedClinicianRefBody = z.infer<typeof providerEmbedClinicianRefSchema>;
/** Parsed v1 mint body. See {@link providerEmbedMintSchema}. */
export type ProviderEmbedMintV1Body = z.infer<typeof providerEmbedMintSchema>;
/** Parsed mint body including patient mode. See {@link providerEmbedMintSchemaWithPatient}. */
export type ProviderEmbedMintBody = z.infer<typeof providerEmbedMintSchemaWithPatient>;
/** Parsed renew body. See {@link providerEmbedRenewSchema}. */
export type ProviderEmbedRenewBody = z.infer<typeof providerEmbedRenewSchema>;
/** Parsed empty body. See {@link providerEmbedEmptySchema}. */
export type ProviderEmbedEmptyBody = z.infer<typeof providerEmbedEmptySchema>;
/** Parsed agenda query. See {@link providerEmbedAgendaQuerySchema}. */
export type ProviderEmbedAgendaQueryParsed = z.infer<typeof providerEmbedAgendaQuerySchema>;
/** Parsed consultations query. See {@link providerEmbedConsultationsQuerySchema}. */
export type ProviderEmbedConsultationsQueryParsed = z.infer<typeof providerEmbedConsultationsQuerySchema>;
/** Parsed transcript query. See {@link providerEmbedMessagesQuerySchema}. */
export type ProviderEmbedMessagesQueryParsed = z.infer<typeof providerEmbedMessagesQuerySchema>;
/** Parsed reply body. See {@link providerEmbedReplySchema}. */
export type ProviderEmbedReplyBody = z.infer<typeof providerEmbedReplySchema>;
/** Parsed resolve body. See {@link providerEmbedResolveSchema}. */
export type ProviderEmbedResolveBody = z.infer<typeof providerEmbedResolveSchema>;
/** Parsed upload body. See {@link providerEmbedUploadSchema}. */
export type ProviderEmbedUploadBody = z.infer<typeof providerEmbedUploadSchema>;
/** Parsed referral body. See {@link providerEmbedReferralSchema}. */
export type ProviderEmbedReferralBody = z.infer<typeof providerEmbedReferralSchema>;
/** Parsed prescription body. See {@link providerEmbedPrescriptionSchema}. */
export type ProviderEmbedPrescriptionBody = z.infer<typeof providerEmbedPrescriptionSchema>;
/** Parsed room body. See {@link providerEmbedRoomSchema}. */
export type ProviderEmbedRoomBody = z.infer<typeof providerEmbedRoomSchema>;
/** Parsed ready body. See {@link providerEmbedReadySchema}. */
export type ProviderEmbedReadyBody = z.infer<typeof providerEmbedReadySchema>;
/** Parsed end body. See {@link providerEmbedEndSchema}. */
export type ProviderEmbedEndBody = z.infer<typeof providerEmbedEndSchema>;
/** Parsed cancel body. See {@link providerEmbedCancelSchema}. */
export type ProviderEmbedCancelBody = z.infer<typeof providerEmbedCancelSchema>;
/** Parsed presence body. See {@link providerEmbedPresenceSchema}. */
export type ProviderEmbedPresenceBody = z.infer<typeof providerEmbedPresenceSchema>;
/** Parsed availability body. See {@link providerEmbedAvailabilitySchema}. */
export type ProviderEmbedAvailabilityBody = z.infer<typeof providerEmbedAvailabilitySchema>;
/** Parsed patient-history query. See {@link providerEmbedPatientHistoryQuerySchema}. */
export type ProviderEmbedPatientHistoryQueryParsed = z.infer<typeof providerEmbedPatientHistoryQuerySchema>;
