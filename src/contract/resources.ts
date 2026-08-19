// GENERATED FILE — do not edit.
//
// Copied verbatim from provider-portal's shared/partner-api by
// scripts/sync-contract.mjs. Edit the source there; this copy exists only so
// the published package is self-contained.
/**
 * Wire representations ("resources") returned by the Natzar Partner API.
 *
 * These are the READ shapes: what GET endpoints return and what webhook
 * payloads embed. Request (write) shapes live in `./schemas` (zod-validated)
 * and `./endpoints`.
 *
 * The literal unions below ({@link AsyncConsultStatus},
 * {@link AsyncClosedReason}, {@link TelehealthStatus}, …) MIRROR the
 * authoritative data-model enums in `amplify/data/resource.ts` verbatim.
 * If a value is ever added there it will appear on the wire here, so treat
 * unknown members of these unions as forward-compatible (ignore, don't
 * crash).
 *
 * All timestamps are ISO-8601 UTC strings (e.g. `2026-08-13T09:30:00.000Z`);
 * calendar dates (birthdate) are `YYYY-MM-DD`.
 *
 * @packageDocumentation
 */

/** ISO-8601 UTC timestamp string, e.g. `2026-08-13T09:30:00.000Z`. */
export type IsoDateTime = string;

/** ISO-8601 calendar date string, e.g. `1990-04-17`. */
export type IsoDate = string;

/**
 * Lifecycle of an async (messaging-based) consult thread. Mirrors the
 * `AsyncConsultStatus` enum in `amplify/data/resource.ts`.
 *
 * - `invited` — consult created, patient hasn't consented yet. With
 *   `consent: 'embed'` the embedded widget collects consent; partner-origin
 *   invites stay valid for 7 days before auto-closing (`consent_timeout`).
 * - `queued` — patient consented but no physician had capacity yet; assigned
 *   automatically the moment one becomes available.
 * - `active` — assigned to exactly one physician; patient messages route to
 *   them and their replies flow back.
 * - `resolve_requested` — the physician marked it resolved; the patient has a
 *   bounded window to reply (reply reopens to `active`, silence closes as
 *   accepted).
 * - `closed` — terminal; why is in {@link AsyncConsultResource.closedReason}.
 */
export type AsyncConsultStatus =
  | 'invited'
  | 'queued'
  | 'active'
  | 'resolve_requested'
  | 'closed';

/**
 * Why an async consult closed. Mirrors `AsyncClosedReason` in
 * `amplify/data/resource.ts`.
 *
 * - `accept_timeout` — resolve notice delivered, patient stayed silent
 *   through the acceptance window: resolved and accepted by timeout.
 * - `inactivity` — patient went quiet mid-thread; warned, then closed.
 * - `consent_timeout` — the invite was never consented within its validity
 *   window (7 days for partner-origin consults).
 * - `no_capacity` — consented but no physician could be assigned in time.
 * - `opted_out` — the patient opted out of messaging while the thread was
 *   open.
 * - `cancelled` — closed via `POST /v1/async-consults/{id}/close` or by a
 *   physician/admin from the portal.
 * - `escalated` — the physician escalated to a live video consult.
 * - `declined` — the patient answered the consent prompt with "no"; no
 *   thread ever started (never rateable).
 * - `patient_closed` — the patient ended the open thread themselves.
 */
export type AsyncClosedReason =
  | 'accept_timeout'
  | 'inactivity'
  | 'consent_timeout'
  | 'no_capacity'
  | 'opted_out'
  | 'cancelled'
  | 'escalated'
  | 'declined'
  | 'patient_closed';

/**
 * Lifecycle of a live (video) telehealth consult. Mirrors the
 * `ConsultStatus` enum in `amplify/data/resource.ts`.
 *
 * - `invited` — consult created; the patient hasn't opened the embed yet.
 * - `waiting` — the patient is in the waiting room (embed open, presence
 *   heartbeating).
 * - `in_progress` — a physician claimed it; the video call is live.
 * - `completed` — the call ended. A recording/transcript may follow
 *   (`telehealth.recording_ready` webhook).
 * - `cancelled` — cancelled via the API or the patient left the queue.
 * - `no_show` — invited but the patient never joined.
 */
export type TelehealthStatus =
  | 'invited'
  | 'waiting'
  /**
   * A physician has been reserved and the patient's client is being asked to
   * confirm it is still there. The call has not started and the physician has
   * not been sent in; an unanswered ring returns the consult to `waiting` and
   * frees the physician for the next patient.
   */
  | 'ringing'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show';

/** Patient biological sex as stored on the record. */
export type PatientSex = 'male' | 'female';

/**
 * Patient locale — drives the language of every system-generated message on
 * the consult transcript and of the embedded widgets. Mirrors the
 * `Languages` enum in `amplify/data/resource.ts`. Defaults to `en_US`.
 */
export type PatientLang = 'en_US' | 'es_US' | 'de_CH' | 'fr_CH' | 'it_CH';

/**
 * Semantic type of a system-generated notice on an async consult thread.
 * Mirrors `AsyncSendNotice` in `amplify/services/async/send-task.ts` — the
 * exhaustive vocabulary of deterministic lifecycle messages the platform
 * writes onto the transcript (physician assigned, inactivity warning, …).
 *
 * On the wire it appears prefixed as {@link MessageClassification}, letting a
 * headless partner render its own UI for a notice instead of (or alongside)
 * the localized `body` text.
 */
export type AsyncNotice =
  | 'physician_reply'
  | 'queued_confirm'
  | 'assigned'
  | 'reassigned'
  | 'queue_delay'
  | 'no_capacity_closed'
  | 'resolve_requested'
  | 'closed_resolved'
  | 'cancelled_closed'
  | 'declined_closed'
  | 'patient_closed'
  | 'inactivity_warning'
  | 'inactivity_closed'
  | 'escalated'
  | 'awaiting_ack';

/**
 * Machine-readable classification of a stored async-thread message:
 * `async:` + the {@link AsyncNotice} that produced it. Present on
 * system/physician messages generated by the async lifecycle; absent on
 * plain patient messages.
 */
export type MessageClassification = `async:${AsyncNotice}`;

/**
 * Who authored a message.
 *
 * - `'patient'` — the patient's own turn, wherever it came from.
 * - `'agent'` — our AI clinician. Only ever appears in the agent
 *   conversation (`GET /v1/agent/messages`); an async consult transcript is
 *   a human thread by construction and never contains one.
 * - `'physician'` — a human clinician, carrying a {@link
 *   MessageResource.signature}.
 * - `'system'` — a platform-generated notice (lifecycle notices, the
 *   emergency safety response).
 */
export type MessageAuthor = 'patient' | 'agent' | 'physician' | 'system';

/**
 * Cursor-paginated list envelope. Every list endpoint returns this shape.
 *
 * Pass `nextCursor` back as the `cursor` query parameter to fetch the next
 * page; its absence means you have reached the end. Cursors are opaque —
 * do not parse, store long-term, or share them across endpoints.
 *
 * @typeParam T - The resource type being listed.
 */
export interface Page<T> {
  /** The page of results, in the endpoint's documented order. */
  items: T[];
  /** Opaque cursor for the next page; absent on the last page. */
  nextCursor?: string;
}

/**
 * A patient you provisioned via `POST /v1/patients`.
 *
 * Partner-provisioned patients have `messageChannel: 'partner'`: the
 * platform never contacts them over WhatsApp/SMS — every outbound message is
 * persisted to the consult transcript and surfaced to you via webhooks
 * (`async_consult.message`) and the embed widgets.
 */
export interface PatientResource {
  /** Our id for the patient. Use it or `externalId` interchangeably in consult creation. */
  id: string;
  /** Your id for the patient, as supplied at provisioning. Unique within your tenant. */
  externalId: string;
  /**
   * E.164 phone number, e.g. `+15551234567`. The patient's identity key —
   * immutable after creation (a phone change requires re-provisioning
   * through support).
   */
  phone: string;
  /** Contact email. */
  email: string;
  /** Given (first) name. */
  givenName: string;
  /** Family (last) name. */
  familyName: string;
  /** Date of birth, `YYYY-MM-DD`. */
  birthdate: IsoDate;
  /** Biological sex. */
  sex: PatientSex;
  /** Locale for system messages and embeds; defaults to `en_US`. */
  lang: PatientLang;
  /**
   * Always `'partner'` for API-provisioned patients: delivery happens via
   * your integration (webhooks/embeds), never over WhatsApp/SMS.
   */
  messageChannel: 'partner';
  /** When the patient record was created. */
  createdAt: IsoDateTime;
  /** When the patient record was last modified. */
  updatedAt: IsoDateTime;
}

/**
 * A physician you provisioned via `POST /v1/physicians`.
 *
 * Every partner physician is backed by a real portal account (they can sign
 * in to the Natzar portal if you send them a portal invite) and participates
 * in automatic async assignment unless `asyncAvailable` is false.
 */
export interface PhysicianResource {
  /**
   * Our id for the physician (their portal identity id). This is the value
   * to pass as `physicianId` on reply/claim/takeover/resolve calls.
   */
  id: string;
  /** Your id for the physician, as supplied at provisioning. */
  externalId: string;
  /** Sign-in email of the backing portal account. */
  email: string;
  /** Given (first) name, if set. */
  givenName?: string;
  /** Family (last) name, if set. */
  familyName?: string;
  /**
   * Whether the automatic async-assignment engine may assign new consults to
   * this physician. Defaults to true at creation; toggle via
   * `POST /v1/physicians/{id}/availability`. Turning it ON can immediately
   * drain queued consults to this physician.
   */
  asyncAvailable: boolean;
  /** When the physician record was created. */
  createdAt: IsoDateTime;
}

/**
 * Who opened a consult.
 *
 * - `partner` — you did, through this API.
 * - `platform` — OUR agent did, mid-conversation, because the patient asked
 *   for a clinician or the assistant judged one was warranted. You will see
 *   these on your own patients: the agent conversation and the consult
 *   lifecycle are one product, and a consult the patient started by asking is
 *   still their consult.
 *
 * The distinction is about PROVENANCE, not permission. Everything a patient
 * can do — consent, rate, join, read the transcript — works on both. The
 * management operations (`claim`, `takeover`, `resolve`, `replies`) are
 * partner-origin only: a platform-origin thread is routed and answered by our
 * own clinicians, and reassigning it from outside would leave the patient with
 * a physician nobody told.
 */
export type ConsultOrigin = 'partner' | 'platform';

/**
 * Patient feedback recorded on a closed async consult. Write-once; both
 * fields optional because a patient may leave stars, a comment, or both.
 */
export interface AsyncConsultRating {
  /** 1–5 star rating of the physician, if given. */
  stars?: number;
  /** Free-text comment, if given. */
  feedback?: string;
  /** When the rating was submitted. */
  ratedAt: IsoDateTime;
}

/**
 * An async (messaging-based) physician consult thread.
 *
 * The consult's MESSAGES are not embedded here — page them via
 * `GET /v1/async-consults/{id}/messages` or receive them in real time via
 * the `async_consult.message` webhook.
 */
export interface AsyncConsultResource {
  /** Consult id (also the webhook `consultId` and the embed token subject). */
  id: string;
  /** Our id of the patient on the thread. */
  patientId: string;
  /** Your id of the patient, when the patient was API-provisioned. */
  externalPatientId?: string;
  /** Current lifecycle state. */
  status: AsyncConsultStatus;
  /** Why the consult closed. Present exactly when `status === 'closed'`. */
  closedReason?: AsyncClosedReason;
  /**
   * Clinical context you supplied at creation ("why they're here") — shown
   * to the physician as the handoff summary.
   */
  context?: string;
  /**
   * Our id of the currently assigned physician (or the last assignee on a
   * closed thread). Absent before first assignment.
   */
  assignedPhysicianId?: string;
  /** Your id of the assigned physician, when API-provisioned. */
  assignedPhysicianExternalId?: string;
  /** Display name frozen at assignment (e.g. `Dr. Sarah Chen, MD`). */
  assignedPhysicianName?: string;
  /** When the current physician was assigned. */
  assignedAt?: IsoDateTime;
  /** Prior assignees, oldest first, when the thread was reassigned. */
  previousPhysicianIds?: string[];
  /** When the consult was created. */
  createdAt: IsoDateTime;
  /** When the invite went out (creation time for API-origin consults). */
  sentAt?: IsoDateTime;
  /** When the patient consented. Absent while `invited` (or if declined). */
  consentedAt?: IsoDateTime;
  /** Bumped on every message and lifecycle transition — the natural sort key. */
  lastActivityAt?: IsoDateTime;
  /** When the consult reached its terminal state. */
  endedAt?: IsoDateTime;
  /**
   * Set when the platform's safety layer detected a possible emergency in a
   * patient message mid-thread. The patient already received a deterministic
   * emergency response; this flags the thread for clinical attention.
   */
  emergencyFlaggedAt?: IsoDateTime;
  /**
   * Whether the patient may (still) rate this consult. Server-owned: true
   * only for closed threads whose close reason earns a rating prompt and
   * that have not been rated yet.
   */
  rateable: boolean;
  /** The rating, once submitted. Write-once. */
  rating?: AsyncConsultRating;
  /** Who opened it — see {@link ConsultOrigin}. */
  origin: ConsultOrigin;
}

/**
 * One stored attachment on an async message.
 *
 * `url` is a short-lived presigned download link, minted fresh on every
 * `GET /v1/async-consults/{id}/messages` read — fetch promptly, never
 * persist the URL (persist the bytes if you need them). Webhook payloads
 * omit `url`; re-read the message endpoint to download.
 */
export interface AttachmentResource {
  /** Original file name as uploaded. */
  fileName: string;
  /** MIME type, e.g. `image/jpeg`, `application/pdf`. */
  mimeType: string;
  /** Short-lived presigned download URL. Omitted in webhook payloads. */
  url?: string;
}

/**
 * ONE message — the single message shape this API uses everywhere.
 *
 * The same object is returned by the agent conversation
 * (`GET /v1/agent/messages`), by an async consult transcript
 * (`GET /v1/async-consults/{id}/messages`), and inside message webhooks. A
 * client writes ONE renderer and reuses it for chat, consult threads, and
 * event replay.
 *
 * What differs between those surfaces is only which fields can appear:
 *
 * | | agent conversation | consult transcript |
 * |---|---|---|
 * | `author: 'agent'` | yes | never (a consult is a human thread) |
 * | `asyncConsultId` | on escalated turns only | always, and equal to that consult |
 * | `classification` | on lifecycle notices | on lifecycle notices |
 *
 * Transcripts are COMPLETE: patient turns, agent turns, physician replies and
 * every system-generated lifecycle notice appear in order, so rendering the
 * list verbatim always produces an honest history.
 */
export interface MessageResource {
  /** Stable message id (also the idempotency key you'll see in webhooks). */
  id: string;
  /** Who wrote it. */
  author: MessageAuthor;
  /**
   * The message text, in the patient's language. For system notices this is
   * the localized copy — exactly what our own surfaces show.
   */
  body: string;
  /**
   * True when this is the deterministic EMERGENCY safety response (the
   * "call 911/988" line) rather than ordinary clinical advice. It is
   * produced by rule, not by the model, and it is the highest-stakes message
   * the platform sends — render it prominently and never collapse it.
   */
  emergency?: boolean;
  /**
   * The async consult this message belongs to, when it belongs to one — the
   * same id you pass to `GET /v1/async-consults/{id}`. In the agent
   * conversation its presence is the signal that a HUMAN clinician, not the
   * agent, owns this stretch of the conversation.
   */
  asyncConsultId?: string;
  /**
   * Semantic tag for lifecycle-generated messages, so you can render your own
   * chip instead of the localized body text. Absent on ordinary turns.
   */
  classification?: MessageClassification;
  /**
   * Echo of the `messageId` you were given when you submitted this turn, on
   * `author: 'patient'` messages you sent through the API. Use it to match a
   * message you rendered optimistically against the one that came back, so
   * the patient never sees their own message twice.
   */
  clientRef?: string;
  /**
   * The physician's display signature at the time of the reply (e.g.
   * "Dr. Jane Doe, MD"), frozen per message. Present only on
   * `author: 'physician'` messages — render it as the sender line the same
   * way our own surfaces do.
   */
  signature?: string;
  /** Attachments, if any. */
  attachments?: AttachmentResource[];
  /** When the message was recorded. */
  sentAt: IsoDateTime;
}

/**
 * A message on an async consult transcript. Alias of {@link MessageResource}
 * — kept as a name because that is what the consult endpoints return; the
 * shape is identical everywhere.
 */
export type AsyncMessageResource = MessageResource;

/**
 * A message in the patient's agent conversation. Alias of {@link
 * MessageResource} — see that type for which fields appear where.
 */
export type AgentMessageResource = MessageResource;

/**
 * One segment of a telehealth consult transcript (speaker-attributed).
 * Mirrors the `TranscriptSegment` custom type in `amplify/data/resource.ts`.
 */
export interface TelehealthTranscriptSegment {
  /** Segment start, seconds from call start. */
  start: number;
  /** Segment end, seconds from call start. */
  end: number;
  /**
   * Channel-identified speaker. `Speaker`/`Transcript` appear when the
   * engine could not attribute a channel.
   */
  role: 'Physician' | 'Patient' | 'Speaker' | 'Transcript';
  /** What was said. */
  text: string;
}

/**
 * Machine transcript of a completed telehealth call. Mirrors the
 * `Transcript` custom type in `amplify/data/resource.ts`. Currently produced
 * for English-language calls only; absent otherwise.
 */
export interface TelehealthTranscript {
  /** Transcription engine identifier. */
  engine: string;
  /** Transcription language tag, e.g. `en-US`. */
  language: string;
  /** The segments pre-joined as display lines (`[m:ss] Role: …`). */
  text: string;
  /** Structured source of truth. */
  segments: TelehealthTranscriptSegment[];
}

/** Patient feedback on a completed telehealth call. Write-once. */
export interface TelehealthRating {
  /** 1–5 stars for communication quality, if given. */
  communication?: number;
  /** 1–5 stars for the physician overall, if given. */
  overallPhysician?: number;
  /** Free-text comment, if given. */
  feedback?: string;
}

/**
 * A live (video) telehealth consult.
 *
 * The patient joins exclusively through the `<natzar-telehealth>` embed; the
 * physician takes the call in the Natzar portal. Once the call completes, a
 * composite recording and (for English calls) a transcript are produced
 * asynchronously — the `telehealth.recording_ready` webhook fires when they
 * are available.
 */
export interface TelehealthConsultResource {
  /** Consult id (also the webhook `consultId` and the embed token subject). */
  id: string;
  /** Our id of the patient. */
  patientId: string;
  /** Your id of the patient, when API-provisioned. */
  externalPatientId?: string;
  /** Current lifecycle state. */
  status: TelehealthStatus;
  /** Clinical context you supplied at creation — the physician's handoff summary. */
  context?: string;
  /** The physician who took (or is on) the call. Absent until claimed. */
  practitioner?: {
    /** Our physician id. */
    id: string;
    /** Your id of the physician, when API-provisioned. */
    externalId?: string;
    /** Display name, if their profile has one. */
    name?: string;
  };
  /** When the consult was created. */
  createdAt: IsoDateTime;
  /** When the invite went out (creation time for API-origin consults). */
  sentAt?: IsoDateTime;
  /**
   * When this consult stops being joinable, for invites that carry a window.
   *
   * Consults our own conversation flow opens are reachable for 10 minutes —
   * long enough to walk to a quiet room, short enough that a link in a message
   * history is not a standing door. Absent means no window: partner-originated
   * consults are governed by your own authentication instead, and never expire
   * on their own.
   *
   * Render a join control only while this is in the future. `join` enforces
   * the same rule server-side (answering `status: 'expired'`), so a button
   * left on screen is a UI bug rather than a way in — but a button that
   * silently stops working is exactly the thing that reads as broken.
   */
  joinableUntil?: IsoDateTime;
  /** When the call went live (physician joined). */
  startedAt?: IsoDateTime;
  /** When the call ended. */
  endedAt?: IsoDateTime;
  /**
   * Short-lived presigned URL of the composite call recording, minted fresh
   * on every GET once the recording exists. Never persist the URL. Omitted
   * in webhook payloads — re-read `GET /v1/telehealth-consults/{id}` after
   * `telehealth.recording_ready`.
   */
  recordingUrl?: string;
  /** Machine transcript, once produced (English calls only). */
  transcript?: TelehealthTranscript;
  /** The rating, once submitted. Write-once. */
  rating?: TelehealthRating;
  /** Who opened it — see {@link ConsultOrigin}. */
  origin: ConsultOrigin;
}

/**
 * A stored webhook event, as returned by `GET /v1/events` — the durable
 * replay log behind webhook delivery. Every event is written here BEFORE any
 * delivery attempt, so polling this endpoint is a complete, ordered
 * substitute for (or reconciliation against) receiving webhooks.
 *
 * `type`/`data` carry exactly the discriminated payloads documented in
 * `./webhooks` ({@link WebhookEvent}); `data` is typed
 * `unknown` here to keep this module dependency-free — narrow it via the
 * `type` field using the webhook union.
 */
export interface PartnerEventResource {
  /** Event id — same id the webhook envelope carried (deduplication key). */
  id: string;
  /** Event name, e.g. `async_consult.assigned`. See `./webhooks`. */
  type: string;
  /** Your partner id. */
  partnerId: string;
  /** The consult the event concerns, when applicable. */
  consultId?: string;
  /** Event payload — the `data` member of the webhook envelope. */
  data: unknown;
  /** When the event occurred (webhook `createdAt`). */
  createdAt: IsoDateTime;
  /** When a webhook delivery last succeeded (2xx). Absent if not yet delivered. */
  deliveredAt?: IsoDateTime;
  /** Number of delivery attempts so far (0 when no `webhookUrl` is configured). */
  attempts: number;
  /** HTTP status of the most recent delivery attempt, if any. */
  lastStatus?: number;
}
