// GENERATED FILE — do not edit.
//
// Copied verbatim from provider-portal's shared/partner-api by
// scripts/sync-contract.mjs. Edit the source there; this copy exists only so
// the published package is self-contained.
/**
 * Outbound webhook contract: the events Natzar POSTs to your `webhookUrl`,
 * their payloads, and the signature scheme to verify them.
 *
 * ## Delivery
 *
 * Each delivery is a `POST` with a JSON body of shape
 * {@link WebhookEvent} — an envelope `{id, type, createdAt, partnerId,
 * data}` whose `data` is the event-specific payload (discriminated on
 * `type`). Two headers accompany every delivery:
 *
 * - `X-Natzar-Event`: the event `type` (route without parsing the body).
 * - `X-Natzar-Signature`: the HMAC signature — see below.
 *
 * Respond with any 2xx within 10 seconds. Anything else (including a
 * timeout) is retried with backoff; deliveries for the SAME consult are
 * strictly ordered (a failing event blocks later events for that consult
 * until it succeeds or exhausts retries), while different consults deliver
 * independently. Retries mean you MAY see a delivery twice — deduplicate on
 * the envelope `id`.
 *
 * Every event is also durably stored BEFORE delivery and replayable via
 * `GET /v1/events`, so missed webhooks (downtime, misconfigured URL) are
 * never lost.
 *
 * ## Signature verification (`X-Natzar-Signature`)
 *
 * The header has the form `t=<unix seconds>,v1=<hex digest>` where the
 * digest is `HMAC-SHA256(secret, "<t>" + "." + rawBody)` — `rawBody` being
 * the EXACT bytes of the request body (sign-then-parse; never re-serialize
 * JSON before verifying). `secret` is your webhook signing secret (shown
 * when the webhook is configured). Reject when the digest mismatches OR the
 * timestamp is older than your tolerance (5 minutes is a good default —
 * this bounds replay of captured deliveries).
 *
 * @example Node verification (e.g. an Express handler with a raw-body parser)
 * ```ts
 * import {createHmac, timingSafeEqual} from 'node:crypto';
 *
 * function verifyNatzarSignature(
 *   header: string,        // req.get('X-Natzar-Signature')
 *   rawBody: string,       // the exact request body bytes as a string
 *   secret: string,        // your webhook signing secret
 *   toleranceSeconds = 300,
 * ): boolean {
 *   const parts = Object.fromEntries(
 *     header.split(',').map((kv) => kv.split('=', 2) as [string, string]),
 *   );
 *   const t = Number(parts.t);
 *   if (!Number.isFinite(t) || !parts.v1) return false;
 *   if (Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
 *   const expected = createHmac('sha256', secret)
 *     .update(`${parts.t}.${rawBody}`)
 *     .digest('hex');
 *   const a = Buffer.from(parts.v1, 'hex');
 *   const b = Buffer.from(expected, 'hex');
 *   return a.length === b.length && timingSafeEqual(a, b);
 * }
 * ```
 *
 * @packageDocumentation
 */

import type {
  AsyncClosedReason,
  AsyncConsultResource,
  AsyncMessageResource,
  IsoDateTime,
  TelehealthConsultResource,
} from './resources';

/** Name of the signature header on every delivery. */
export const WEBHOOK_SIGNATURE_HEADER = 'X-Natzar-Signature';

/** Name of the event-type header on every delivery. */
export const WEBHOOK_EVENT_HEADER = 'X-Natzar-Event';

/** Signature scheme version tag used in the signature header. */
export const WEBHOOK_SIGNATURE_VERSION = 'v1';

/**
 * The delivery envelope every webhook body conforms to, before narrowing by
 * `type`. Prefer consuming {@link WebhookEvent} (the discriminated union);
 * this generic shape exists for logging/storage layers that don't care
 * which event they hold.
 */
export interface WebhookEnvelope {
  /**
   * Unique event id — STABLE ACROSS RETRIES. Deduplicate on it: seeing the
   * same id twice means a redelivery, not a new event.
   */
  id: string;
  /** Event name, e.g. `async_consult.assigned`. */
  type: string;
  /** When the event occurred. */
  createdAt: IsoDateTime;
  /** Your partner id (useful when one endpoint serves several keys). */
  partnerId: string;
  /** Event-specific payload — see the {@link WebhookEvent} union. */
  data: unknown;
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/**
 * Shared payload of async-consult lifecycle events: a full snapshot of the
 * consult as of the event. Snapshots make handlers stateless — you never
 * need the previous event to interpret the current one.
 */
export interface AsyncConsultEventData {
  /** The consult after the transition the event reports. */
  consult: AsyncConsultResource;
}

/** Payload of `async_consult.assigned`. */
export interface AsyncConsultAssignedData extends AsyncConsultEventData {
  /** Our id of the newly assigned physician (= `consult.assignedPhysicianId`). */
  physicianId: string;
}

/** Payload of `async_consult.reassigned`. */
export interface AsyncConsultReassignedData extends AsyncConsultEventData {
  /** Our id of the physician now holding the consult. */
  physicianId: string;
  /** Our id of the physician who lost it. */
  previousPhysicianId?: string;
}

/** Payload of `async_consult.closed`. */
export interface AsyncConsultClosedData extends AsyncConsultEventData {
  /** Why it closed (= `consult.closedReason`, surfaced for convenience). */
  closedReason: AsyncClosedReason;
}

/** Payload of `async_consult.rated`. */
export interface AsyncConsultRatedData extends AsyncConsultEventData {
  /** The rating just recorded. */
  rating: {
    /** 1–5 stars, if given. */
    stars?: number;
    /** Free-text comment, if given. */
    feedback?: string;
  };
}

/**
 * Payload of `async_consult.message` — a message landed on the transcript
 * (patient message, physician reply, or system lifecycle notice; discriminate
 * on `message.author` / `message.classification`).
 *
 * Attachment `url`s are OMITTED here (webhook payloads are stored durably);
 * read `GET /v1/async-consults/{id}/messages` for fresh download links.
 */
export interface AsyncConsultMessageData {
  /** The consult the message belongs to. */
  asyncConsultId: string;
  /** The message, as it appears on the transcript. */
  message: AsyncMessageResource;
}

/**
 * Payload of `async_consult.message_rejected` — a patient message you
 * posted (202-accepted) could not be routed because the thread closed
 * before it processed. Surface this to your patient UI: a patient message
 * must never go unanswered silently.
 */
export interface AsyncConsultMessageRejectedData {
  /** The consult the message was addressed to. */
  asyncConsultId: string;
  /** Our id of the patient who authored the message. */
  patientId: string;
  /** The `messageId` the 202 response reported. */
  messageId: string;
  /** Why it was rejected. Currently always the thread closing underneath. */
  reason: 'thread_closed';
}

/**
 * Shared payload of telehealth lifecycle events: a full snapshot of the
 * consult as of the event. `recordingUrl` is always omitted in webhook
 * payloads — fetch `GET /v1/telehealth-consults/{id}` for a fresh presigned
 * link (that is the intended reaction to `telehealth.recording_ready`).
 */
export interface TelehealthEventData {
  /** The consult after the transition the event reports. */
  consult: TelehealthConsultResource;
}

/** Payload of `telehealth.rated`. */
export interface TelehealthRatedData extends TelehealthEventData {
  /** The rating just recorded. */
  rating: {
    /** 1–5 stars for communication quality, if given. */
    communication?: number;
    /** 1–5 stars for the physician overall, if given. */
    overallPhysician?: number;
    /** Free-text comment, if given. */
    feedback?: string;
  };
}

// ---------------------------------------------------------------------------
// The discriminated union
// ---------------------------------------------------------------------------

/** Envelope of one concrete event type. See {@link WebhookEvent}. */
interface Event<TType extends string, TData> {
  /** Unique event id — stable across retries; deduplicate on it. */
  id: string;
  /** The discriminant. */
  type: TType;
  /** When the event occurred. */
  createdAt: IsoDateTime;
  /** Your partner id. */
  partnerId: string;
  /** Event-specific payload. */
  data: TData;
}

/**
 * Every webhook delivery body, discriminated on `type`. Switch on `type`
 * and TypeScript narrows `data` to the right payload.
 *
 * Async consult lifecycle:
 * - `async_consult.created` — consult created via the API.
 * - `async_consult.consented` — patient accepted the consent prompt.
 * - `async_consult.declined` — patient declined; the consult closed without
 *   ever starting.
 * - `async_consult.queued` — consented but waiting for physician capacity.
 * - `async_consult.assigned` — a physician took the thread.
 * - `async_consult.reassigned` — the thread moved to another physician
 *   (SLA breach or takeover).
 * - `async_consult.message` — a message landed on the transcript (any
 *   author, including system notices).
 * - `async_consult.message_rejected` — a 202-accepted patient message could
 *   not be routed (thread closed underneath).
 * - `async_consult.resolve_requested` — the physician marked it resolved;
 *   the acceptance window is running.
 * - `async_consult.reopened` — the patient replied during the acceptance
 *   window; back to `active` with the same physician.
 * - `async_consult.closed` — terminal; `data.closedReason` says why.
 * - `async_consult.rated` — the patient rated the consult.
 *
 * Telehealth lifecycle:
 * - `telehealth.created` — consult created via the API.
 * - `telehealth.waiting` — the patient entered the waiting room.
 * - `telehealth.in_progress` — a physician joined; the call is live.
 * - `telehealth.completed` — the call ended.
 * - `telehealth.cancelled` — cancelled before/without a call.
 * - `telehealth.recording_ready` — composite recording (and transcript,
 *   when produced) are available; GET the consult for a fresh URL.
 * - `telehealth.rated` — the patient rated the call.
 *
 * @example
 * ```ts
 * function handle(event: WebhookEvent) {
 *   switch (event.type) {
 *     case 'async_consult.message':
 *       return renderMessage(event.data.asyncConsultId, event.data.message);
 *     case 'async_consult.closed':
 *       return markClosed(event.data.consult.id, event.data.closedReason);
 *     // …
 *   }
 * }
 * ```
 */
export type WebhookEvent =
  | Event<'async_consult.created', AsyncConsultEventData>
  | Event<'async_consult.consented', AsyncConsultEventData>
  | Event<'async_consult.declined', AsyncConsultEventData>
  | Event<'async_consult.queued', AsyncConsultEventData>
  | Event<'async_consult.assigned', AsyncConsultAssignedData>
  | Event<'async_consult.reassigned', AsyncConsultReassignedData>
  | Event<'async_consult.message', AsyncConsultMessageData>
  | Event<'async_consult.message_rejected', AsyncConsultMessageRejectedData>
  | Event<'async_consult.resolve_requested', AsyncConsultEventData>
  | Event<'async_consult.reopened', AsyncConsultEventData>
  | Event<'async_consult.closed', AsyncConsultClosedData>
  | Event<'async_consult.rated', AsyncConsultRatedData>
  | Event<'telehealth.created', TelehealthEventData>
  | Event<'telehealth.waiting', TelehealthEventData>
  | Event<'telehealth.in_progress', TelehealthEventData>
  | Event<'telehealth.completed', TelehealthEventData>
  | Event<'telehealth.cancelled', TelehealthEventData>
  | Event<'telehealth.recording_ready', TelehealthEventData>
  | Event<'telehealth.rated', TelehealthRatedData>;

/** Every event name, as the `type` discriminant / `X-Natzar-Event` value. */
export type WebhookEventType = WebhookEvent['type'];

/**
 * Runtime list of every event name — handy for subscription filtering and
 * for validating an incoming `X-Natzar-Event` header.
 */
export const WEBHOOK_EVENT_TYPES = [
  'async_consult.created',
  'async_consult.consented',
  'async_consult.declined',
  'async_consult.queued',
  'async_consult.assigned',
  'async_consult.reassigned',
  'async_consult.message',
  'async_consult.message_rejected',
  'async_consult.resolve_requested',
  'async_consult.reopened',
  'async_consult.closed',
  'async_consult.rated',
  'telehealth.created',
  'telehealth.waiting',
  'telehealth.in_progress',
  'telehealth.completed',
  'telehealth.cancelled',
  'telehealth.recording_ready',
  'telehealth.rated',
] as const satisfies readonly WebhookEventType[];
