// The PATIENT surface — what a partner's front end talks to.
//
//   import {connectPatient} from '@natzar/client/patient';
//
//   const care = connectPatient(session);           // session from your server
//   const stop = care.conversation.subscribe(render);
//   await care.conversation.send({text: 'sore throat'});
//
// That is the whole integration. No poll loop, no cursor, no consult lifecycle
// to re-implement, no API key in the bundle, and no backend-for-frontend.
//
// Design notes worth knowing:
//
// * SNAPSHOTS ARE PLAIN DATA. A snapshot is JSON — no methods, no closures, no
//   client reference. It survives `structuredClone`, a Redux store, a
//   `postMessage`, or an RSC boundary, and comparing two of them is cheap.
//   Actions live on the stable `care.*` objects instead. That split is
//   deliberate: putting commands inside snapshots makes every poll allocate new
//   function identities, which silently defeats memoised rendering.
//
// * ONE TIMELINE. The platform keeps the assistant chat and each consult
//   transcript as separate records; a patient experiences one conversation.
//   The SDK merges them in order and marks each entry with where it came from,
//   so the common case is `timeline.map(render)` and the rare case can still
//   filter on `entry.source`.
//
// * INVITES ARE ANSWERABLE ENTRIES. When the agent offers a consult, the entry
//   carries `awaiting: 'consent'` and you call `care.respond(entry, true)`.
//   When it invites the patient to a video call, the entry carries
//   `awaiting: 'join'` and a `link.consultId` for `care.telehealth.join(...)`.
//   Partners were parsing link URLs out of message text to reconstruct this —
//   the SDK does that once, here, and strips the URL from `text` so the prose
//   reads as the button-bearing card it was written to be.
//
// * ONE SESSION, MANY TOKENS. The session your server minted names a PATIENT.
//   A video consult inside that conversation runs on its own consult-scoped
//   token, minted on demand from the patient session (the same thing the embed
//   widget does). `care.telehealth.*` hides that: name the consult, and the
//   SDK mints, caches and re-mints the consult token as needed.
//
// * A PRESCRIPTION IS ANSWERED IN PLACE. When a physician prescribes, the
//   thread carries a "choose your pharmacy" link (`/pharmacy?id=`). The public
//   page behind it is birthdate-gated and refuses partner-origin patients by
//   design — the partner authenticated them — so the entry carries
//   `awaiting: 'pharmacy'` and `care.prescriptions.*` drives the picker on the
//   patient session: search, choose, add a pharmacy no directory covers.
//
// * A REFERRAL IS A FILE CARD. When a physician refers the patient (to a
//   specialist, for lab tests, for imaging), the thread carries a "view your
//   referral" link (`/referral?id=`) to a signed PDF. The page behind it is
//   birthdate-gated, refuses partner-origin patients and dies after 30 days;
//   on this session the document has NO window, so the entry's `link` reads
//   `view` for as long as the referral stands, the "active for 30 days"
//   sentence is stripped from `text`, and `care.referrals.document(id)` mints
//   a fresh short-lived URL on every open. Nothing awaits the patient — a
//   referral is carried, not answered — so no `awaiting` is set.
//
// * A PRICED INVITE IS ONE BUTTON. When the tenant charges for the visit an
//   invite offers, its entry's `link.payment` carries the price BEFORE the
//   click ("Yes & pay CA$100"), and `care.acceptAndPay(entry, {mount})` runs
//   the whole round from that one press: the action is asked FIRST with
//   `checkout: true` (so an invite that would fold into an open consult, or
//   has expired, is never charged for), the refusal hands back a checkout
//   bound to that invite, your `mount` shows Stripe's form, the SDK waits for
//   the platform to confirm `paid` — Stripe.js's onComplete is not proof, the
//   signed webhook is — and repeats the action with the payment. Because the
//   checkout is bound to the invite, a patient who paid and then reloaded is
//   let in by pressing again: no second charge, no payment id to carry.
//
// * A VIDEO ROOM IS SINGLE-USE. The platform may retire the room mid-call and
//   hand out a new one; a `ROOM_DELETED` disconnect means "join again", not
//   "the call is over", and the patient must not publish into a room whose
//   metadata lacks the grant's `roomNonce`. `connectPatientRoom` runs a
//   LiveKit `Room` you construct by those rules.

import {watch, type SyncState, type Unsubscribe, type WatchOptions} from '../subscribe';
import {NatzarApiError, isNatzarApiError} from '../errors';
import type {
  PharmacyLinkAction,
  PharmacyResource,
  PharmacySearchOrigin,
  PHARMACY_SEARCH_RADII_KM,
  PrescriptionStatus,
} from '../contract/prescriptions';
import {REFERRAL_LINK_VALIDITY_SENTENCES, type ReferralKind, type ReferralLinkAction} from '../contract/referrals';
import {
  assertConnectable,
  callPatientOp,
  type FetchLike,
  type PatientSession,
  type TransportOptions,
} from './transport';
import {
  roomCarriesNonce,
  startRoomSession,
  type RoomPull,
  type RoomSession,
  type RoomSessionOptions,
  type RoomSessionState,
} from '../room';

export type {PatientSession, Unsubscribe, SyncState, WatchOptions, TransportOptions, FetchLike};
export {NatzarSessionError} from './transport';
export {DISCONNECT_REASON, NO_RECONNECT_POLICY, parseRoomMetadata, roomCarriesNonce, roomOptions} from '../room';
export type {LiveKitRoomLike, ReconnectPolicyLike, RepullReason, RoomPull, RoomSession} from '../room';
// The contract shapes this entry's own signatures name, so a browser-only
// consumer can type a picker row or the origin it builds without a second
// import (`@natzar/client/contract` remains their canonical home).
export type {PharmacyLinkAction, PharmacyResource, PharmacySearchOrigin, PrescriptionStatus, ReferralKind, ReferralLinkAction};
export type {PatientSurfaceErrorCode} from './codes';
export type {NatzarErrorCode} from '../errors';

/**
 * What a platform link inside a message can currently be used for.
 *
 * The terminal ones are distinct rather than a single "nothing" because a good
 * UI keeps the control visible and disabled with a label saying what happened
 * ("Rated", "Consultation ended") — a button that vanishes after a tap leaves
 * the patient unsure whether it registered.
 *
 * - `consent` / `rate` / `join` / `book` / `choose` — actionable; mirrored on `awaiting`.
 * - `view` — actionable, NOT mirrored on `awaiting`: a referral's signed PDF
 *   can be opened with `care.referrals.document(link.consultId)`. Nothing is
 *   owed — the patient carries the document.
 * - `open` — the consult is live and the conversation itself is the surface.
 * - `rated` — already rated. `ended` — finished, nothing left to do.
 * - `sent` — the prescription went to the chosen pharmacy (`link.pharmacyName`
 *   names it when known). `expired` — the 24-hour pharmacy link lapsed
 *   unused, or the prescription (or referral) is not this patient's.
 *   `revoked` — the physician withdrew it. All three keep the button visible
 *   and disabled.
 * - `none` — the platform could not resolve it; say nothing rather than guess.
 */
export type LinkAction =
  | 'consent'
  | 'rate'
  | 'join'
  | 'book'
  | 'open'
  | 'rated'
  | 'ended'
  | PharmacyLinkAction
  | ReferralLinkAction
  | 'none';

/** The kinds of link a message can carry, by the page it would have led to. */
export type LinkKind = 'async' | 'telehealth' | 'book' | 'pharmacy' | 'referral';

/** One entry in the patient's care timeline. Plain, serializable data. */
export interface TimelineEntry {
  /** Stable id — safe as a list key, and stable across polls. */
  id: string;
  /** Who produced it. `system` entries are lifecycle notices, not prose. */
  author: 'patient' | 'agent' | 'physician' | 'system';
  /**
   * Display text, already localized by the platform. When the message carried
   * one of the platform's consult links the URL is removed here and surfaced
   * as {@link link} instead — render a button, never the URL.
   */
  text: string;
  /** ISO timestamp. Entries are always sorted oldest-first. */
  sentAt: string;
  /** Which record it came from — the assistant chat, or a specific consult. */
  source: 'agent' | 'consult';
  /**
   * The consult this entry is about: the thread it was written on when
   * `source` is `consult`, or the consult a link in it refers to.
   */
  consultId?: string;
  /**
   * Attachments the patient or clinician sent. On a `pending` entry the `url`
   * is the `previewUrl` you passed to `send()`, or empty when you passed none.
   */
  attachments?: Array<{fileName: string; mimeType: string; url: string}>;
  /**
   * Set when this entry is waiting on the patient. `consent` — a clinician
   * consult is being offered; answer with `care.respond(entry, accept)`.
   * `rating` — a finished consult can be rated; answer with `care.rate(...)`.
   * `join` — a video consult is waiting; `care.telehealth.join(entry.consultId)`.
   * `book` — an appointment can be booked; `care.telehealth.slots(entry.consultId)`.
   * `pharmacy` — a prescription is waiting for its pharmacy;
   * `care.prescriptions.pharmacies(entry.link.consultId, …)` then `choose`.
   * Absent once answered, so a rendered button disappears on its own.
   */
  awaiting?: 'consent' | 'rating' | 'join' | 'book' | 'pharmacy';
  /** True while a locally-sent entry has not yet been confirmed by the server. */
  pending?: boolean;
  /**
   * The platform's deterministic emergency line (911/988). Render it loudly
   * and unmistakably apart from ordinary advice — it is the highest-stakes
   * message the platform sends. Its `author` is `system`.
   */
  emergency?: boolean;
  /** The clinician's signature ("Dr. Sarah Chen MD") on a `physician` entry. */
  signature?: string;
  /** The platform's lifecycle tag on a consult notice (e.g. `async:assigned`). */
  classification?: string;
  /**
   * The submission id of a patient message. Set on the optimistic entry from
   * the moment you call `send()` (a local id until the platform acknowledges,
   * then the platform's own id), and repeated on the durable echo — the
   * platform mints a fresh `id` for the transcript, so this is the one field
   * shared between the two.
   */
  clientRef?: string;
  /**
   * A platform link the message carried, resolved to what it can do now.
   *
   * `consultId` is the id the link named — a consult for `async` /
   * `telehealth` / `book`, the PRESCRIPTION id for `pharmacy` and the
   * REFERRAL id for `referral`. One field for every kind, deliberately: a
   * card renders `link.action` and hands `link.consultId` to the matching
   * `care.*` call, and a second id field would only give a partner two
   * places to read the same value. The entry's own `consultId` is untouched
   * by a pharmacy or referral link (it still names the thread the physician
   * wrote on).
   */
  link?: {
    kind: LinkKind;
    consultId: string;
    action: LinkAction;
    /** For a `pharmacy` link: the chosen pharmacy once one was chosen ("Sent to …"). */
    pharmacyName?: string | null;
    /** For a `referral` link: the document's title ("Laboratory requisition"), for the file card. */
    title?: string | null;
    /**
     * What taking this invite costs, while it is actionable (`consent` /
     * `join` / `book`) and the tenant charges for it — label the button
     * "Yes & pay CA$100" and press it with `care.acceptAndPay(entry, …)`.
     * ABSENT means "show no price", never "free": a free scenario, one that
     * is already paid, or a price the platform could not read right now.
     * The action stays authoritative either way.
     */
    payment?: InvitePrice;
  };
}

/**
 * A price, in minor units. Format it with the patient's locale:
 * `new Intl.NumberFormat(lang, {style: 'currency', currency: currency.toUpperCase()}).format(amountCents / 100)`.
 */
export interface InvitePrice {
  amountCents: number;
  /** ISO 4217, lowercase as Stripe reports it (`cad`). */
  currency: string;
}

/**
 * The checkout a payment refusal carries when the action was asked with
 * `checkout: true` — bound to that invite (read it with {@link checkoutOf}).
 *
 * - `clientSecret` (+ `publishableKey` when the platform has one configured;
 *   otherwise mount with your own key of the same Stripe account): an
 *   embedded Checkout Session for Stripe.js `createEmbeddedCheckoutPage`.
 * - `checkoutUrl`: a hosted session to send the patient to instead.
 * - `alreadyPaid`: nothing to pay — a payment already covers this invite
 *   (`settling`: the patient finished Stripe's form, the platform has not
 *   confirmed it yet). Wait for `paid`, then repeat the action.
 *
 * Asking again for the same invite hands back the SAME checkout while it is
 * payable (a double click, a remount) rather than a second one.
 */
export interface CheckoutPayload extends InvitePrice {
  paymentId: string;
  clientSecret?: string;
  publishableKey?: string;
  checkoutUrl?: string;
  alreadyPaid?: boolean;
  settling?: boolean;
}

/** Payment inputs for `respond` / `telehealth.join` (and, inline, `telehealth.book`). */
export interface PaymentOptions {
  /**
   * A payment you already hold for this visit (`paid`, from a checkout). Not
   * needed after a checkout bound to the invite: its paid row is adopted.
   */
  paymentId?: string;
  /**
   * On a payment refusal, attach a checkout bound to this invite to the
   * error (`checkoutOf(error)`) — the one-press "accept & pay". Ignored when
   * `paymentId` is set: a presented payment's refusal is that payment's story.
   */
  checkout?: boolean;
  signal?: AbortSignal;
}

/** One payment's state, as the platform sees it. Only `paid` entitles a visit. */
export interface PaymentState {
  paymentId: string;
  status: 'pending' | 'paid' | 'failed' | 'expired' | 'refunded' | 'unknown';
  /** The platform's verdict, from Stripe's signed webhook — never from the browser. */
  paid: boolean;
}

export interface AcceptAndPayOptions {
  /**
   * Show the payment step and resolve once the patient completed it —
   * mount Stripe.js with `clientSecret` + `publishableKey` and resolve from
   * its `onComplete` (or open `checkoutUrl` and resolve when they are back).
   * Reject to abandon (the patient backed out): the checkout stays bound to
   * the invite and the next press resumes it. Not called when nothing is
   * owed or the invite is already paid for.
   */
  mount: (checkout: CheckoutPayload) => Promise<void>;
  /** A `book` entry's chosen slot — required there, ignored elsewhere. */
  booking?: {startsAt: string; practitionerId?: string; timezone?: string};
  signal?: AbortSignal;
  /**
   * How long to wait, after `mount` resolves, for the platform to confirm
   * the payment. On timeout it rejects `payment_not_completed` with
   * `details.paymentId` — press again later: the paid row is adopted.
   * @defaultValue 120000
   */
  confirmTimeoutMs?: number;
  /** Poll cadence while waiting for `paid`. @defaultValue 2000 */
  pollIntervalMs?: number;
}

/** What `acceptAndPay` did. */
export interface AcceptAndPayResult {
  action: 'consent' | 'join' | 'book';
  /**
   * The payment this press paid with (or resumed). Null when the action went
   * through on the first ask — nothing was owed, or a payment already bound
   * to the invite was adopted.
   */
  paymentId: string | null;
  /** For `join`: the waiting-room state after the (paid) join. */
  join?: JoinState;
  /** For `book`: the appointment. */
  booking?: BookingResult;
}

/** Everything a patient screen needs, in one object. */
export interface CareSnapshot {
  /** The merged conversation, oldest first. */
  timeline: TimelineEntry[];
  /** True when the patient has sent something the platform has not answered yet. */
  awaitingReply: boolean;
  /** The live consult, if any — drives a waiting room or a "join call" button. */
  consult?: {
    id: string;
    kind: 'async' | 'telehealth';
    /**
     * A closed set you can switch on exhaustively. `unknown` exists so a
     * status added after you shipped renders as "in progress" rather than
     * crashing your switch.
     */
    phase: 'awaiting_consent' | 'queued' | 'active' | 'ringing' | 'in_call' | 'closed' | 'unknown';
    /** Queue position and estimate, while `queued`. */
    position?: number;
    estimatedMinutes?: number;
    /** The clinician, once one is on the case. `shortName` fits a corner tile ("Dr. Chen"). */
    physician?: {name: string; shortName?: string};
    /** True when this consult can be rated right now. */
    rateable?: boolean;
    /** True when the patient can enter the call right now (`care.telehealth.join`). */
    joinable?: boolean;
    /**
     * Which live modality a telehealth consult is: an on-demand `queue` (the
     * waiting room) or a `scheduled` appointment (the slot grid). Absent means
     * `queue` — every consult minted before booking existed.
     */
    mode?: 'queue' | 'scheduled';
    /**
     * A consult-scoped session's price while its next step is still owed
     * (consent, the first join, the booking). Absent = no price to show —
     * see `TimelineEntry.link.payment`.
     */
    payment?: InvitePrice;
  };
}

/** A staged upload, ready to attach to a message. */
export interface StagedAttachment {
  /** The platform's handle for the staged bytes. Pass it to `send()` as-is. */
  stagingKey: string;
  fileName: string;
  mimeType: string;
}

export interface SendInput {
  text?: string;
  /**
   * A staged upload from `care.attachments.upload()`. `previewUrl` is optional
   * and purely local: it becomes the optimistic entry's attachment `url` so the
   * patient sees their photo immediately (an object URL is the usual choice —
   * revoke it once the durable echo arrives).
   */
  attachment?: StagedAttachment & {previewUrl?: string};
}

/** A consult-scoped video session, minted from the patient session. */
export interface TelehealthSession {
  embedToken: string;
  consultId: string;
  /** Which surface to mount: the waiting room, or the slot grid. */
  mode: 'queue' | 'scheduled';
}

/**
 * What a video room needs — hand it to {@link connectPatientRoom} with the
 * LiveKit `Room` you render. The SDK only hands one over when it carries a
 * `roomNonce`: a grant without one could not be checked, so it is never
 * offered to connect with.
 */
export interface LiveKitGrant {
  token: string;
  url: string;
  roomName: string;
  /**
   * The nonce the room's metadata must carry (`{"v":1,"n":roomNonce}`) before
   * the patient publishes anything. Never empty.
   */
  roomNonce: string;
}

/**
 * The waiting-room state machine, one step per `join()` call. Statuses map the
 * platform's onto a closed set, `unknown` reserved for one added after you
 * shipped.
 */
export interface JoinState {
  status: 'waiting' | 'in_progress' | 'completed' | 'cancelled' | 'no_show' | 'expired' | 'unknown';
  /** Place in line while `waiting`; 0 while connecting. */
  position: number;
  estimatedMinutes: number;
  /**
   * Present when the call is on — `status === 'in_progress'`. An
   * `in_progress` state without it is transient: beat again.
   */
  livekit?: LiveKitGrant;
  /** Who the patient is looking at ("Dr. Sarah Chen MD") and the tile form ("Dr. Chen"). */
  physicianName?: string;
  physicianShortName?: string;
  /** Whether feedback was already given, once the consult has ended. */
  rated: boolean;
}

/** One offerable start on the slot grid. */
export interface SlotOffer {
  /** ISO instant of the start — the identity of a slot, everywhere. */
  startsAt: string;
  /** ISO instant of the consultation's end. */
  endsAt: string;
  /**
   * Local date in the grid's `timezone` (the zone you asked for, else the
   * clinic's), for grouping the grid into days. Never recompute it from
   * `startsAt`: a start near midnight files under a different day in a
   * different zone, and this one is already in the zone the grid is drawn in.
   */
  localDate: string;
  /** Physicians who could take this start. */
  practitionerIds: string[];
  /**
   * Every language at least one of those physicians consults in, as base
   * codes (`fr`) in catalogue order — so a grid can badge the times that come
   * with a speaker of the patient's language (`BookingSlots.patientLang`).
   * Absent when none of them recorded any. Who actually takes the booking is
   * decided at book time (the patient's language first, then English, then
   * least loaded), never by this list.
   */
  languages?: string[];
}

/**
 * A booked appointment, as every booking call reports it. The instants are
 * absolute; the zone fields say whose clock to show them on.
 */
export interface Appointment {
  consultId: string;
  startsAt: string;
  endsAt: string;
  practitionerId: string | null;
  practitionerName: string | null;
  status: string;
  /** Instant from which the waiting room accepts either side. */
  waitingRoomOpensAt: string;
  /** Instant past which cancelling is refused. */
  cancellableUntil: string;
  /**
   * The zone to render `startsAt` in: the `timezone` the call carried, else
   * the clinic's. Label it — an unlabelled appointment time is a support call.
   */
  timezone: string;
  /** The clinic's zone. */
  clinicTimezone: string;
  /**
   * The physician's calendar zone once one is assigned, else null. When its
   * clock differs from `timezone`'s at `startsAt`, show it as a second line
   * ("08:00 CEST for Dr Morin") — the confirmation notices do the same.
   */
  physicianTimezone: string | null;
  /** The zone the patient booked from (`timezone` on `book`), or null when none was sent. */
  patientTimezone: string | null;
}

/**
 * The slot grid plus everything needed to render it without guessing. Three
 * things to render: group `slots` by `localDate`, label the grid with
 * `timezone`, and — when it differs — say where the clinic is with
 * `clinicTimezone`.
 */
export interface BookingSlots {
  /** The consult's own status. */
  status: string;
  slots: SlotOffer[];
  /**
   * The zone this grid is expressed in — the `timezone` you passed to
   * `slots()` (the patient's device zone, typically), else the clinic's.
   * Every `localDate` and `nextFrom` are in it.
   */
  timezone: string;
  /** The clinic's zone, for a "the clinic is in …" note when it differs from `timezone`. */
  clinicTimezone: string;
  /**
   * True when the window held more offers than one response carries; the
   * tail was dropped. Page with `slots(consultId, {from: nextFrom, timezone})`.
   */
  truncated: boolean;
  /** When `truncated`, the local date (in `timezone`) of the first dropped offer. Null otherwise. */
  nextFrom: string | null;
  slotMinutes: number;
  bookingHorizonDays: number;
  cancellationWindowMinutes: number;
  waitingRoomOpensMinutes: number;
  /** The consult's current appointment, when it has one. */
  appointment: Appointment | null;
  specialty: {slug: string; name: string; description: string | null} | null;
  /**
   * The patient's language this grid was ranked for, as a base code (`fr`),
   * or null when the platform does not know it. Pair it with each offer's
   * `languages` to say "with a French-speaking physician" on the right times.
   */
  patientLang: string | null;
  /** True when nobody in the clinic can serve this consult at all. */
  noEligiblePhysicians: boolean;
  /** Why, when licensure is the reason for an empty grid. Null otherwise. */
  licenseBlock: unknown | null;
  /**
   * What booking costs, while the consult is not booked yet and the tenant
   * charges for it — label the confirm button "Confirm 3:00 PM · Pay CA$100"
   * and book with `checkout: true` (or `care.acceptAndPay`). Absent = no
   * price to show.
   */
  payment?: InvitePrice;
}

export interface BookingResult {
  appointment: Appointment;
  /** True when this booking replaced an earlier one for the same consult. */
  rescheduled: boolean;
}

/** One presence beat in a booked appointment's waiting room. */
export interface AppointmentBeat {
  state: {
    /**
     * `early` — the room is not open yet (`opensAt`). `waiting` — here before
     * the physician. `connecting` — both present, the call is starting.
     * `in_progress` — the call is on (`livekit` is set). `missed` / `closed` —
     * over. `unknown` — a phase added after you shipped.
     */
    phase: 'early' | 'waiting' | 'connecting' | 'in_progress' | 'missed' | 'closed' | 'unknown';
    startsAt?: string | null;
    opensAt?: string;
    otherSidePresent?: boolean;
    status?: string;
  };
  appointment: Appointment | null;
  /** Present when the call is on (never without its `roomNonce`). */
  livekit?: LiveKitGrant;
}

/**
 * What a prescription's pharmacy link can be used for right now. NEVER a
 * rejection for a miss: a prescription that is not this patient's, or that
 * no longer exists, reads as an expired link — the same answer the page
 * gives, and the one a card can render without a second code path.
 */
export interface PrescriptionLinkState {
  /**
   * The EFFECTIVE status: `expired` the moment the 24-hour window lapses,
   * even before the platform's sweep stamps the row.
   */
  status: PrescriptionStatus;
  expired: boolean;
  /** ISO instant the link dies, for a countdown. Null when it carries no window. */
  expiresAt: string | null;
  /** The chosen pharmacy, once one was chosen. */
  pharmacyName: string | null;
  /** How the platform transmits in this zone: e-prescribing or fax. Null on a miss. */
  transport: 'erx' | 'fax' | null;
  /** The button — `choose` is the only actionable one; the rest label a disabled control. */
  action: PharmacyLinkAction;
}

/**
 * A referral's signed PDF, as `care.referrals.document(id)` hands it over —
 * the same reply the platform's app and embed widget open from. `document`
 * exists while the referral is `issued`: a presigned URL minted on THIS
 * call and good for `expiresIn` seconds — open it at once (a new tab, the
 * OS viewer), never store it, and call again for a fresh one. A withdrawn
 * referral answers `revoked` with no document. Never `expired`: the 30-day
 * window is the anonymous web page's; on this session the document stays
 * reachable for as long as the referral exists. A referral that is not this
 * patient's rejects with `not_found`.
 */
export type ReferralDocument =
  | {
      status: 'issued';
      kind: ReferralKind;
      /** The document's title in its own language ("Imaging requisition — MRI"). */
      title: string;
      physicianName: string;
      /** ISO instant the referral was signed. */
      issuedAt: string;
      document: {
        url: string;
        /** Seconds the URL stays valid. */
        expiresIn: number;
        /** An ASCII-safe download name ("Laboratory-requisition-<id>.pdf"). */
        fileName: string;
        contentType: 'application/pdf';
      };
      /** All PDFs in a multi-referral operation; absent on older single referrals. */
      files?: Array<{id: string; kind: ReferralKind; title: string; document: {url: string; downloadUrl?: string; expiresIn: number; fileName: string; contentType: 'application/pdf'}}>;
    }
  | {status: 'revoked'; kind: ReferralKind; title: string; physicianName: string; issuedAt: string; revokedAt: string | null};

/** The radii `pharmacies()` accepts, km — default first, then "search wider". */
export type PharmacySearchRadiusKm = (typeof PHARMACY_SEARCH_RADII_KM)[number];

/** What to search around, and optionally for. */
export interface PharmacySearchInput {
  /**
   * Where to centre the search — the device fix, the geocoded home address,
   * or a place the patient typed. Omit it and the platform ranks around the
   * cached home point if it has one; otherwise the answer carries
   * `homeAddress` for you to geocode (then `setHomeLocation` so the next
   * search starts ranked).
   */
  origin?: PharmacySearchOrigin;
  /** Free text — name, city or postal code. */
  query?: string;
  /** Widen from the default (25 km). */
  radiusKm?: PharmacySearchRadiusKm;
}

/** The picker's list, framed by the state the caller has to settle on. */
export interface PharmacySearch {
  /** The effective status. When it is not choosable, `pharmacies` is empty — render the state instead. */
  status: PrescriptionStatus;
  transport: 'erx' | 'fax';
  pharmacyName: string | null;
  /** The origin the list was ranked by — yours, else the cached home. Absent when there was none. */
  origin?: PharmacySearchOrigin;
  /** The one-line home address on file when NO origin exists — geocode it, then `setHomeLocation`. */
  homeAddress?: string;
  /** Sorted by distance from `origin` when there is one. Only `reachable` rows can be chosen. */
  pharmacies: PharmacyResource[];
}

/** The choice was recorded; the prescription is on its way. */
export interface PharmacyChoice {
  status: 'transmitting';
  pharmacyName: string;
  transport: 'erx' | 'fax';
}

/** A pharmacy the patient typed in (fax zones only). */
export interface AddPharmacyInput {
  name: string;
  address: string;
  city?: string;
  region?: string;
  postalCode?: string;
  /** The pharmacy's fax line. Without one the row waits for a clinician to add it. */
  fax?: string;
}

/**
 * The added pharmacy. It is not chosen yet: the platform first faxes a
 * one-page probe to the line, and a delivered probe chooses it for this
 * prescription on its own — so after a `probe: 'sent'` keep polling
 * `state()` until the action moves off `choose`.
 */
export interface AddedPharmacy {
  directoryId: string;
  pharmacy: PharmacyResource;
  status: 'pending_verification';
  /** `not_sent` when no fax was given or it was refused (`faxIssue` says why). */
  probe: 'sent' | 'not_sent';
  /** Why the typed fax was refused (`same_as_phone` / `toll_free` / `invalid`), when it was. */
  faxIssue: string | null;
}

export interface ConnectOptions extends TransportOptions {
  /** Poll cadence for live surfaces. @defaultValue 2500 */
  intervalMs?: number;
  /**
   * Called ONCE when the session token has expired. Subscriptions pause (no
   * further requests) until you mint a fresh session on your server and hand
   * it to `care.refresh(session)`, at which point they resume where they were.
   * Actions taken in between reject with `embed_token_expired`.
   */
  onExpired?: () => void;
}

/** A patient-scoped handle. Create with {@link connectPatient}. */
export interface PatientClient {
  conversation: {
    /**
     * Subscribe to the care timeline. Calls back immediately, then on every
     * genuine change. Returns an unsubscribe function — call it on unmount.
     */
    subscribe(
      onChange: (snapshot: CareSnapshot | undefined, sync: SyncState) => void,
      options?: WatchOptions,
    ): Unsubscribe;
    /** Read once, without starting a subscription. */
    get(signal?: AbortSignal): Promise<CareSnapshot>;
    /**
     * Send a patient message — text, an attachment staged with
     * `care.attachments.upload()`, or both. Resolves when the platform has
     * ACCEPTED it, not when it has been answered — the reply arrives on your
     * subscription. The entry appears in the next snapshot immediately,
     * flagged `pending`, and is replaced by the durable one when it lands.
     *
     * A refused send takes the optimistic entry back down and rejects, so the
     * patient never sees a message that was not delivered.
     */
    send(input: SendInput, signal?: AbortSignal): Promise<void>;
  };
  /**
   * Answer a consent invite surfaced as `entry.awaiting === 'consent'`.
   *
   * On a priced invite an accept without a payment rejects
   * `payment_required` (`details` say what is owed). Pass
   * `{checkout: true}` and that refusal also carries a checkout bound to
   * the invite (`checkoutOf(error)`), or `{paymentId}` to accept with a
   * payment you hold — or let `care.acceptAndPay(entry, {mount})` do the
   * whole round. The third argument may still be a bare `AbortSignal`.
   */
  respond(entry: TimelineEntry, accept: boolean, options?: AbortSignal | PaymentOptions): Promise<void>;
  /**
   * The one-press "Yes & pay" / "Join & pay" / "Confirm · Pay" for an entry
   * `awaiting` `consent`, `join` or `book` (a `book` entry needs
   * `options.booking`). Asks the action first with `checkout: true`; when it
   * is refused for payment, `mount`s the bound checkout, waits for the
   * platform to confirm `paid` (never trusting the browser), and repeats the
   * action with the payment. A free (or already-paid) invite goes straight
   * through. Rejects with the action's own error otherwise — `slot_taken`
   * after a paid booking keeps the payment bound: book another time.
   */
  acceptAndPay(entry: TimelineEntry, options: AcceptAndPayOptions): Promise<AcceptAndPayResult>;
  /** Payments made on this patient's behalf — the state `acceptAndPay` waits on. */
  payments: {
    /** One payment's state. `paid` is the platform's word, from Stripe's signed webhook. */
    status(paymentId: string, signal?: AbortSignal): Promise<PaymentState>;
  };
  /**
   * Rate a finished consult surfaced as `entry.awaiting === 'rating'`. A video
   * consult is rated on two questions; `communication` defaults to `stars`
   * when you only ask one.
   */
  rate(
    entry: TimelineEntry,
    rating: {stars: number; communication?: number; feedback?: string},
    signal?: AbortSignal,
  ): Promise<void>;
  /**
   * The video consult surface, keyed by the consult a message invited the
   * patient to (`entry.consultId` on an `awaiting: 'join' | 'book'` entry).
   *
   * Each call runs on a consult-scoped token the SDK mints from the patient
   * session and caches until it expires — you never handle it. Call `join()`
   * every ~10s while waiting: it is the presence beat that keeps the patient's
   * place in line, and it returns the room grant the moment the call starts.
   */
  telehealth: {
    /** Mint (or reuse) the consult session. Mostly useful for `mode`. */
    session(consultId: string, signal?: AbortSignal): Promise<TelehealthSession>;
    /**
     * Enter / stay in the waiting room; returns the room grant once the call
     * is on. On a priced on-demand consult the first join rejects
     * `payment_required` until it is paid — `{checkout: true}` attaches the
     * bound checkout to that refusal, `{paymentId}` presents a payment you
     * hold. Once a payment is attached, later beats need neither. The second
     * argument may still be a bare `AbortSignal`.
     */
    join(consultId: string, options?: AbortSignal | PaymentOptions): Promise<JoinState>;
    /** Give up the place in line. `join()` again to re-enter. */
    leave(consultId: string, signal?: AbortSignal): Promise<{left: boolean}>;
    /** Post-call feedback: two star questions (1–5) plus optional free text. */
    rate(
      consultId: string,
      rating: {communication: number; overall: number; feedback?: string},
      signal?: AbortSignal,
    ): Promise<void>;
    /**
     * The slot grid for a `scheduled` consult. Pass the patient's zone as
     * `timezone` (`deviceTimeZone()` from `@natzar/client/contract`) and the
     * grid comes back in it — `from`/`to` are read in it, every `localDate`
     * is in it, and the response's `timezone` confirms it. Nothing is
     * guessed: without it the grid is in the clinic's zone, and says so.
     */
    slots(consultId: string, range?: {from?: string; to?: string; timezone?: string}, signal?: AbortSignal): Promise<BookingSlots>;
    /**
     * Book a start from the grid. Send the same `timezone` you rendered the
     * grid in: it is stored as the patient's zone (their confirmation and
     * reminders are written in it) and the returned appointment is expressed
     * in it. A lost race rejects with `slot_taken` (or `slot_unavailable`)
     * and `details.slots` holds a FRESH grid, so the retry is against times
     * that still exist; `too_many_open_bookings` means the patient must
     * cancel or attend one first. On a priced tenant an unpaid booking
     * rejects `payment_required`; `checkout: true` attaches the bound
     * checkout, `paymentId` presents a payment (not needed after a checkout
     * bound to this consult — it is adopted, including after a lost slot).
     */
    book(
      consultId: string,
      booking: {startsAt: string; practitionerId?: string; timezone?: string; paymentId?: string; checkout?: boolean},
      signal?: AbortSignal,
    ): Promise<BookingResult>;
    /** Cancel the booked appointment (refused with `too_late_to_cancel` inside the clinic's window). */
    cancelBooking(consultId: string, signal?: AbortSignal): Promise<void>;
    /**
     * Presence beat in a booked appointment's waiting room. Call every ~10s
     * from `waitingRoomOpensAt`; send `present: false` once when leaving.
     */
    appointmentBeat(consultId: string, present?: boolean, signal?: AbortSignal): Promise<AppointmentBeat>;
  };
  /**
   * The pharmacy picker, keyed by the prescription a message linked
   * (`entry.link.consultId` on an `awaiting: 'pharmacy'` entry). Runs on the
   * patient session itself — the prescription is the patient's, whatever
   * kind of session this is — and every call re-checks that on the platform.
   *
   * The flow the platform's own page runs: `pharmacies()` (with the best
   * origin you have), the patient picks a `reachable` row, `choose()`, then
   * poll `state()` until `action` reads `sent` — the fax transport confirms
   * in the thread, and a `failed` status re-opens the picker (choose again).
   *
   * The origin chain that page (and the embed widget) walks: the server's
   * own origin → the geocoded home address (cached via `setHomeLocation`) →
   * a device fix → a coarse point from the patient's IP → a place the
   * patient typed. This SDK stops one hop short: it has no IP lookup, so
   * with no fix and no home either ask for a postal code, or resolve a
   * coarse origin from the patient's IP with your own service and pass it
   * with `source: 'ip'` (distances then read as approximate).
   */
  prescriptions: {
    /** What the link can do now. Never rejects for a miss — reads `expired`. */
    state(id: string, signal?: AbortSignal): Promise<PrescriptionLinkState>;
    /**
     * The list, sorted by distance from `origin`. Refused with
     * `not_found` only when the prescription is not this patient's; a
     * prescription past choosing answers an EMPTY list with its status.
     */
    pharmacies(id: string, input?: PharmacySearchInput, signal?: AbortSignal): Promise<PharmacySearch>;
    /**
     * Send the prescription to one of the listed pharmacies. Refused with
     * `pharmacy_not_found`, `not_choosable` / `expired` / `lost_race` (the
     * error's `details.status` says where the prescription is now — re-read
     * `state()`), or `pharmacy_unreachable` (a fax zone and the row has no
     * verified fax line).
     */
    choose(id: string, directoryId: string, signal?: AbortSignal): Promise<PharmacyChoice>;
    /**
     * Cache the home point once you have geocoded `homeAddress`, so the next
     * picker for this patient starts ranked. Refused with `invalid_location`.
     */
    setHomeLocation(id: string, point: {lat: number; lng: number}, signal?: AbortSignal): Promise<void>;
    /**
     * Add a pharmacy no directory covers — fax zones only (`not_available`
     * elsewhere). Refused with `invalid_pharmacy` (the error's `details.code`
     * names the field) or `not_choosable`.
     */
    addPharmacy(id: string, pharmacy: AddPharmacyInput, signal?: AbortSignal): Promise<AddedPharmacy>;
  };
  /**
   * A referral the physician issued on the thread — a signed PDF the patient
   * carries to the laboratory, the imaging centre or the specialist. The
   * entry's `link` reads `view` (keyed by the referral id, `link.consultId`)
   * for as long as the referral stands; `revoked` once withdrawn.
   */
  referrals: {
    /**
     * The document, with a URL minted on this call. Open it inside the tap
     * that asked for it (a `window.open` after an `await` is a popup to
     * every browser — open the tab first, then point it at `document.url`).
     * Rejects with `not_found` for a referral that is not this patient's.
     */
    document(id: string, signal?: AbortSignal): Promise<ReferralDocument>;
  };
  attachments: {
    /**
     * Stage a file for a message: asks the platform for a one-shot upload
     * slot, PUTs the bytes, and returns the handle `send()` takes. Images and
     * PDFs are read by the assistant; other allowed types are stored and
     * acknowledged. Refused with `unsupported_type` / `file_too_large`.
     */
    upload(file: Blob & {name?: string}, options?: {fileName?: string; signal?: AbortSignal}): Promise<StagedAttachment>;
  };
  /**
   * Swap in a freshly minted session without rebuilding the client. Paused
   * subscriptions resume at once; cached consult tokens are discarded.
   */
  refresh(session: PatientSession): void;
  /** The raw patient-surface escape hatch, for anything this SDK does not model. */
  call<T = unknown>(
    op: {kind: 'query' | 'mutation'; name: string; args: Record<string, unknown>},
    signal?: AbortSignal,
  ): Promise<T>;
}

/**
 * Connect to the patient surface using a session your server minted.
 *
 * ```ts
 * // your server
 * const session = await natzar.agent.embedSession({externalPatientId: userId});
 * // → send `session` to the browser as-is
 *
 * // your browser
 * const care = connectPatient(session);
 * ```
 */
export function connectPatient(session: PatientSession, options: ConnectOptions = {}): PatientClient {
  // Fail at CONSTRUCTION, not on first use — the same rule the server client
  // applies to its API key. A session that can never connect is a wiring
  // mistake, and wiring mistakes should surface where they were made rather
  // than inside whatever component happened to call first.
  assertConnectable(session);

  // The session in force. `refresh()` replaces it; every call reads it at
  // call time rather than closing over the original, which is what lets a
  // re-mint land without rebuilding the client or re-subscribing.
  let current: PatientSession = session;

  // What kind of session this is — the ops for consent and rating differ by
  // it (a patient-scoped `agent` session answers through the agent ops, a
  // consult-scoped `async` one through the thread ops). Read from the token's
  // own `typ` claim so the first action does not depend on a read having
  // happened; the platform still verifies the token, this is only routing.
  const sessionTyp = (): 'agent' | 'async' | 'telehealth' => {
    const typ = decodeJwtClaims(current.sessionToken)?.typ;
    return typ === 'async' || typ === 'telehealth' ? typ : 'agent';
  };

  // --- expiry ---------------------------------------------------------------
  //
  // One flag, one callback. The first call to come back `embed_token_expired`
  // flips it and tells the partner; every subscription then parks on `resumed`
  // instead of polling a dead token every 2.5s (and backing off into a
  // "retrying" state that looks like a network problem when it is not).
  let expired = false;
  let resumeWaiters: Array<() => void> = [];

  const markExpired = () => {
    if (expired) return;
    expired = true;
    options.onExpired?.();
  };

  const resumed = (signal: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!expired) return resolve();
      if (signal.aborted) return reject(signal.reason ?? new Error('aborted'));
      const wake = () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        resumeWaiters = resumeWaiters.filter((w) => w !== wake);
        reject(signal.reason ?? new Error('aborted'));
      };
      resumeWaiters.push(wake);
      signal.addEventListener('abort', onAbort, {once: true});
    });

  const isExpiry = (e: unknown): boolean => isNatzarApiError(e) && e.code === 'embed_token_expired';

  // --- calls ----------------------------------------------------------------

  // A patient-session call. The token is injected here so no caller ever
  // spells it, and expiry is observed here so no caller can forget to.
  const op = async <T>(
    kind: 'query' | 'mutation',
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> => {
    try {
      return await callPatientOp<T>(current, {kind, name, args: {token: current.sessionToken, ...args}}, options, signal);
    } catch (e) {
      if (isExpiry(e)) markExpired();
      throw e;
    }
  };

  // Consult-scoped tokens for the video surface, one per consult, minted on
  // demand from the patient session and kept until they expire (the `exp`
  // claim, read locally — the platform still verifies). A consult token that
  // the platform nonetheless refuses is dropped and minted once more, so a
  // rotation or clock skew costs one extra round trip rather than a dead
  // waiting room.
  const consultTokens = new Map<string, {session: TelehealthSession; expiresAtMs?: number}>();

  const telehealthSession = async (consultId: string, signal?: AbortSignal): Promise<TelehealthSession> => {
    const cached = consultTokens.get(consultId);
    if (cached && (cached.expiresAtMs === undefined || cached.expiresAtMs - Date.now() > EXPIRY_MARGIN_MS)) {
      return cached.session;
    }
    const raw = await op<{embedToken?: string; consultId?: string; mode?: string}>(
      'mutation',
      'embedAgentTelehealthSession',
      {consultId},
      signal,
    );
    if (!raw?.embedToken) {
      throw new NatzarApiError({
        code: 'internal_error',
        status: 500,
        message: 'The platform minted no consult session',
        route: 'embedAgentTelehealthSession',
        details: raw,
      });
    }
    const minted: TelehealthSession = {
      embedToken: String(raw.embedToken),
      consultId: String(raw.consultId ?? consultId),
      mode: raw.mode === 'scheduled' ? 'scheduled' : 'queue',
    };
    const exp = decodeJwtClaims(minted.embedToken)?.exp;
    consultTokens.set(consultId, {session: minted, ...(typeof exp === 'number' ? {expiresAtMs: exp * 1000} : {})});
    return minted;
  };

  const consultOp = async <T>(
    consultId: string,
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> => {
    const attempt = async (retry: boolean): Promise<T> => {
      const {embedToken} = await telehealthSession(consultId, signal);
      try {
        return await callPatientOp<T>(current, {kind: 'mutation', name, args: {token: embedToken, ...args}}, options, signal);
      } catch (e) {
        // The CONSULT token was refused, not the patient session — so this is
        // not the partner's expiry. Re-mint (which does go through the patient
        // session, and reports ITS expiry the normal way) and go once more.
        if (retry && isNatzarApiError(e) && (e.code === 'embed_token_expired' || e.code === 'embed_token_invalid')) {
          consultTokens.delete(consultId);
          return attempt(false);
        }
        throw e;
      }
    };
    return attempt(true);
  };

  // --- optimistic sends -----------------------------------------------------

  // Messages the caller has sent but the server has not echoed back yet. The
  // platform accepts writes asynchronously (202-style), so without this a
  // patient watches their own message vanish for a beat after hitting send —
  // the single most common complaint about chat integrations.
  const pending: TimelineEntry[] = [];
  let sequence = 0;
  // Every server entry id seen so far, so a read can tell a NEW echo from
  // history. Only new echoes may claim a pending entry by text — otherwise a
  // second "yes" would be swallowed by the first one, already on the record.
  const seen = new Set<string>();

  // Drop optimistic entries the server has now confirmed.
  //
  // First on `clientRef`: the platform stores the submission id we were given
  // on acknowledgement and repeats it on the echo, which is the only field the
  // two share (the transcript id is minted fresh). Then, for echoes without a
  // usable ref — an echo that landed before our acknowledgement did, or an
  // older deployment — by text, one pending per NEW echo, newest echo against
  // the oldest pending, so repeated identical messages retire one at a time
  // instead of all at once.
  const reconcile = (timeline: TimelineEntry[]) => {
    const echoes = timeline.filter((e) => e.author === 'patient');
    const fresh = echoes.filter((e) => !seen.has(e.id));
    for (const e of timeline) seen.add(e.id);

    const claimed = new Set<TimelineEntry>();
    for (const echo of echoes) {
      if (!echo.clientRef) continue;
      const at = pending.findIndex((p) => p.clientRef === echo.clientRef);
      if (at >= 0) {
        pending.splice(at, 1);
        claimed.add(echo);
      }
    }
    for (let i = fresh.length - 1; i >= 0; i--) {
      const echo = fresh[i];
      if (claimed.has(echo)) continue;
      const at = pending.findIndex((p) => p.text === echo.text);
      if (at >= 0) pending.splice(at, 1);
    }
  };

  // Live subscriptions, so an action the patient just took refreshes the view
  // at once instead of waiting out a poll interval. Without this, sending a
  // message left the sender staring at an unchanged screen for up to
  // `intervalMs` — and forever on a surface whose polling is visibility-paused.
  const refreshers = new Set<() => void>();
  const refreshNow = () => refreshers.forEach((r) => r());

  const read = async (signal?: AbortSignal): Promise<CareSnapshot> => {
    const [state, messages] = await Promise.all([
      op<RawState>('query', 'embedState', {}, signal),
      op<RawMessages>('query', 'embedAgentMessages', {}, signal),
    ]);
    const snapshot = toSnapshot(state, messages);
    reconcile(snapshot.timeline);
    if (pending.length) {
      // Copies, not the tracked objects: a snapshot is plain data the partner
      // may hold onto, and the tracked entry still changes (its `clientRef`
      // on acknowledgement).
      snapshot.timeline = [...snapshot.timeline, ...pending.map((p) => ({...p}))];
      snapshot.awaitingReply = true;
    }
    return snapshot;
  };

  // The subscription's read: the same read, parked while the session is
  // expired. Parking INSIDE the read (rather than throwing) keeps the poller
  // from backing off into `retrying` — nothing is being retried — and resumes
  // the very same tick, with the new token, the moment `refresh()` lands.
  const readWhileValid = async (signal: AbortSignal): Promise<CareSnapshot> => {
    for (;;) {
      if (expired) await resumed(signal);
      try {
        return await read(signal);
      } catch (e) {
        if (!isExpiry(e)) throw e;
      }
    }
  };

  // --- the three payable actions -------------------------------------------
  //
  // Named here rather than inline in the returned object so acceptAndPay can
  // run the very same calls a partner would — one wire path per action.

  const respond = async (_entry: TimelineEntry, accept: boolean, options?: AbortSignal | PaymentOptions): Promise<void> => {
    const {signal, pay} = paymentArgs(options);
    // The token is what scopes the answer — a patient session resolves the
    // patient's own open invite, a consult session its own thread — so the
    // entry is only the thing the partner rendered the buttons on. Payment
    // arguments ride only on an accept: a decline is never charged.
    await op(
      'mutation',
      sessionTyp() === 'async' ? 'embedAsyncConsent' : 'embedAgentConsent',
      {accept, ...(accept ? pay : {})},
      signal,
    );
    refreshNow();
  };

  const join = async (consultId: string, options?: AbortSignal | PaymentOptions): Promise<JoinState> => {
    const {signal, pay} = paymentArgs(options);
    const raw = await consultOp<RawJoin>(consultId, 'embedConsultJoin', pay, signal);
    const result = toJoinState(raw);
    // The transcript gains lifecycle notices as the call starts and ends;
    // a conversation rendered beside the video should not lag them.
    if (result.status !== 'waiting') refreshNow();
    return result;
  };

  const book = async (
    consultId: string,
    booking: {startsAt: string; practitionerId?: string; timezone?: string; paymentId?: string; checkout?: boolean},
    signal?: AbortSignal,
  ): Promise<BookingResult> => {
    const {pay} = paymentArgs({paymentId: booking.paymentId, checkout: booking.checkout});
    const raw = await consultOp<{appointment?: RawAppointment | null; rescheduled?: boolean}>(
      consultId,
      'embedBook',
      {
        startsAt: booking.startsAt,
        ...(booking.practitionerId ? {practitionerId: booking.practitionerId} : {}),
        ...(booking.timezone ? {timezone: booking.timezone} : {}),
        ...pay,
      },
      signal,
    );
    if (!raw?.appointment) {
      throw new NatzarApiError({
        code: 'internal_error',
        status: 500,
        message: 'The platform confirmed no appointment',
        route: 'embedBook',
        details: raw,
      });
    }
    refreshNow();
    return {appointment: toAppointment(raw.appointment), rescheduled: raw.rescheduled === true};
  };

  // On the PATIENT session whatever the action ran on: the platform scopes a
  // payment to the session's patient and tenant, which every token of this
  // patient shares, so a consult token is never needed to read one.
  const paymentStatus = async (paymentId: string, signal?: AbortSignal): Promise<PaymentState> => {
    const raw = await op<{status?: string; paid?: boolean}>('mutation', 'embedPaymentStatus', {paymentId}, signal);
    const status = PAYMENT_STATUSES.has(raw?.status as PaymentState['status']) ? (raw!.status as PaymentState['status']) : 'unknown';
    // `paid` only when the platform says so — never inferred from a status we
    // could not read.
    return {paymentId, status, paid: raw?.paid === true && status === 'paid'};
  };

  // Poll until the platform confirms the payment. Rejects on a status that
  // can no longer become `paid`, and on timeout — both as
  // `payment_not_completed` carrying the id, so the caller can resume: the
  // row stays bound to the invite and the next press adopts it once paid.
  const untilPaid = async (paymentId: string, opts: AcceptAndPayOptions): Promise<void> => {
    const interval = opts.pollIntervalMs ?? 2000;
    const deadline = Date.now() + (opts.confirmTimeoutMs ?? 120_000);
    for (;;) {
      const state = await paymentStatus(paymentId, opts.signal);
      if (state.paid) return;
      const dead = state.status === 'failed' || state.status === 'expired' || state.status === 'refunded';
      if (dead || Date.now() >= deadline) {
        throw new NatzarApiError({
          code: 'payment_not_completed',
          status: 409,
          message: dead ? `The payment ${state.status}` : 'The payment was not confirmed in time',
          route: 'embedPaymentStatus',
          details: {paymentId, status: state.status, ...(dead ? {} : {timedOut: true})},
        });
      }
      await delay(interval, opts.signal);
    }
  };

  const acceptAndPay = async (entry: TimelineEntry, opts: AcceptAndPayOptions): Promise<AcceptAndPayResult> => {
    const action = entry.awaiting === 'consent' || entry.awaiting === 'join' || entry.awaiting === 'book'
      ? entry.awaiting
      : null;
    if (!action) throw new Error('acceptAndPay() needs an entry awaiting consent, join or book.');
    const consultId = entry.link?.consultId ?? entry.consultId;
    if (action !== 'consent' && !consultId) throw new Error('That entry names no consult.');
    if (action === 'book' && !opts.booking?.startsAt) throw new Error('acceptAndPay() on a booking needs options.booking.startsAt.');
    const signal = opts.signal;

    const attempt = async (pay: {paymentId?: string; checkout?: boolean}): Promise<Omit<AcceptAndPayResult, 'action' | 'paymentId'>> => {
      if (action === 'consent') {
        await respond(entry, true, {...pay, signal});
        return {};
      }
      if (action === 'join') return {join: await join(consultId!, {...pay, signal})};
      return {booking: await book(consultId!, {...opts.booking!, ...pay}, signal)};
    };

    // The action FIRST, never a checkout ahead of it: the platform decides
    // expiry, state and the fold into an open consult before it asks for
    // money, so an invite that cannot be taken — or is free to take — is
    // never charged for. `checkout: true` makes a payment refusal carry the
    // invite's bound checkout.
    let checkout: CheckoutPayload | null;
    try {
      const done = await attempt({checkout: true});
      return {action, paymentId: null, ...done};
    } catch (e) {
      checkout = checkoutOf(e);
      if (!checkout) throw e;
    }
    // Nothing to mount when a payment already covers the invite (paid, or
    // completed at Stripe and settling) — only the confirmation is awaited.
    if (!checkout.alreadyPaid) await opts.mount(checkout);
    await untilPaid(checkout.paymentId, opts);
    const done = await attempt({paymentId: checkout.paymentId});
    refreshNow();
    return {action, paymentId: checkout.paymentId, ...done};
  };

  return {
    conversation: {
      subscribe: (onChange, watchOptions = {}) => {
        let mine: (() => void) | undefined;
        const stop = watch<CareSnapshot>(
          {
            read: readWhileValid,
            // Compare on content, not identity: a poll that returns the same
            // conversation must not re-render the partner's UI.
            same: (a, b) => fingerprint(a) === fingerprint(b),
          },
          onChange,
          {
            intervalMs: options.intervalMs,
            ...watchOptions,
            onReady: ({refresh}) => {
              mine = refresh;
              refreshers.add(refresh);
              watchOptions.onReady?.({refresh});
            },
          },
        );
        return () => {
          if (mine) refreshers.delete(mine);
          stop();
        };
      },
      get: (signal) => read(signal),
      send: async (input, signal) => {
        const text = input.text?.trim() ?? '';
        const attachment = input.attachment;
        if (!text && !attachment) throw new Error('send() needs text or an attachment');
        sequence += 1;
        const entry: TimelineEntry = {
          id: `pending-${sequence}`,
          author: 'patient',
          text,
          sentAt: new Date().toISOString(),
          source: 'agent',
          pending: true,
          // Local until acknowledged — replaced by the platform's submission
          // id below, which is what the durable echo will carry.
          clientRef: `local-${sequence}-${Math.random().toString(36).slice(2)}`,
          ...(attachment
            ? {attachments: [{fileName: attachment.fileName, mimeType: attachment.mimeType, url: attachment.previewUrl ?? ''}]}
            : {}),
        };
        pending.push(entry);
        // Show the optimistic entry immediately, then reconcile on the read
        // this triggers — rather than waiting for the next poll tick.
        refreshNow();
        let accepted: {messageId?: string} | undefined;
        try {
          accepted = await op<{messageId?: string}>(
            'mutation',
            'embedAgentSend',
            {
              ...(text ? {text} : {}),
              // AWSJSON travels stringified — the platform refuses a raw object.
              ...(attachment
                ? {attachment: JSON.stringify({stagingKey: attachment.stagingKey, mimeType: attachment.mimeType, fileName: attachment.fileName})}
                : {}),
            },
            signal,
          );
        } catch (e) {
          // Take the entry back down: a message the platform refused must not
          // sit on the transcript looking sent.
          const at = pending.indexOf(entry);
          if (at >= 0) pending.splice(at, 1);
          refreshNow();
          throw e;
        }
        if (accepted?.messageId) entry.clientRef = String(accepted.messageId);
        refreshNow();
      },
    },

    respond,
    acceptAndPay,
    payments: {
      status: paymentStatus,
    },

    rate: async (entry, rating, signal) => {
      const feedback = rating.feedback?.trim() || undefined;
      if (entry.link?.kind === 'telehealth') {
        // A video consult is rated on its own consult token, with the two
        // questions the post-call form asks.
        await consultOp(
          entry.link.consultId,
          'embedRate',
          {
            communicationRating: rating.communication ?? rating.stars,
            overallPhysicianRating: rating.stars,
            ...(feedback ? {feedback} : {}),
          },
          signal,
        );
        refreshNow();
        return;
      }
      if (sessionTyp() === 'async') {
        // A consult-scoped session rates the thread it names.
        await op('mutation', 'embedRate', {overallPhysicianRating: rating.stars, ...(feedback ? {feedback} : {})}, signal);
        refreshNow();
        return;
      }
      if (!entry.consultId) throw new Error('That entry is not a rating prompt.');
      await op(
        'mutation',
        'embedAgentRate',
        {consultId: entry.consultId, overallPhysicianRating: rating.stars, ...(feedback ? {feedback} : {})},
        signal,
      );
      refreshNow();
    },

    telehealth: {
      session: (consultId, signal) => telehealthSession(consultId, signal),

      join,

      leave: async (consultId, signal) => {
        const raw = await consultOp<{left?: boolean}>(consultId, 'embedConsultLeave', {}, signal);
        return {left: raw?.left === true};
      },

      rate: async (consultId, rating, signal) => {
        const feedback = rating.feedback?.trim() || undefined;
        await consultOp(
          consultId,
          'embedRate',
          {
            communicationRating: rating.communication,
            overallPhysicianRating: rating.overall,
            ...(feedback ? {feedback} : {}),
          },
          signal,
        );
        refreshNow();
      },

      slots: async (consultId, range = {}, signal) => {
        const raw = await consultOp<RawBookingSlots>(
          consultId,
          'embedBookingSlots',
          {
            ...(range.from ? {from: range.from} : {}),
            ...(range.to ? {to: range.to} : {}),
            ...(range.timezone ? {timezone: range.timezone} : {}),
          },
          signal,
        );
        return toBookingSlots(raw);
      },

      book,

      cancelBooking: async (consultId, signal) => {
        await consultOp(consultId, 'embedCancelBooking', {}, signal);
        refreshNow();
      },

      appointmentBeat: async (consultId, present = true, signal) => {
        const raw = await consultOp<RawAppointmentBeat>(consultId, 'embedAppointmentBeat', {present}, signal);
        return toAppointmentBeat(raw);
      },
    },

    prescriptions: {
      // The state op never answers `ok: false` (a miss IS a state), so
      // nothing here can throw for a stale id — which is what lets a card
      // poll it after `choose()` without a second error path.
      state: async (id, signal) => toPrescriptionLinkState(await op<RawPrescriptionLinkState>('query', 'embedPrescriptionState', {id}, signal)),

      pharmacies: async (id, input = {}, signal) => {
        const raw = await op<RawPharmacySearch>(
          'query',
          'embedPrescriptionPharmacies',
          {
            id,
            // AWSJSON travels stringified — the platform refuses a raw object.
            ...(input.origin ? {origin: JSON.stringify(input.origin)} : {}),
            ...(input.query?.trim() ? {query: input.query.trim()} : {}),
            ...(input.radiusKm !== undefined ? {radiusKm: input.radiusKm} : {}),
          },
          signal,
        );
        return toPharmacySearch(raw);
      },

      choose: async (id, directoryId, signal) => {
        const raw = await op<RawPharmacyChoice>('mutation', 'embedPrescriptionChoose', {id, directoryId}, signal);
        // The thread gains the "sent to …" notice once the transport
        // confirms; a conversation rendered beside the picker should not
        // lag the card that just changed.
        refreshNow();
        return {
          status: 'transmitting',
          pharmacyName: String(raw?.pharmacyName ?? ''),
          transport: raw?.transport === 'fax' ? 'fax' : 'erx',
        };
      },

      setHomeLocation: async (id, point, signal) => {
        await op('mutation', 'embedPrescriptionHomeLocation', {id, lat: point.lat, lng: point.lng}, signal);
      },

      addPharmacy: async (id, pharmacy, signal) => {
        const raw = await op<RawAddedPharmacy>(
          'mutation',
          'embedPrescriptionAddPharmacy',
          {id, pharmacy: JSON.stringify(pharmacy)},
          signal,
        );
        if (!raw?.directoryId || !raw.pharmacy) {
          throw new NatzarApiError({
            code: 'internal_error',
            status: 500,
            message: 'The platform recorded no pharmacy',
            route: 'embedPrescriptionAddPharmacy',
            details: raw,
          });
        }
        return {
          directoryId: String(raw.directoryId),
          pharmacy: raw.pharmacy,
          status: 'pending_verification',
          probe: raw.probe === 'sent' ? 'sent' : 'not_sent',
          faxIssue: typeof raw.faxIssue === 'string' && raw.faxIssue ? raw.faxIssue : null,
        };
      },
    },

    referrals: {
      document: async (id, signal) => toReferralDocument(await op<RawReferralDocument>('query', 'embedReferralDocument', {id}, signal)),
    },

    attachments: {
      upload: async (file, uploadOptions = {}) => {
        const doFetch = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
        if (!doFetch) throw new Error('No fetch implementation available.');
        const mimeType = file.type || 'application/octet-stream';
        const fileName = uploadOptions.fileName ?? file.name ?? 'attachment';
        const signal = uploadOptions.signal;
        // One file per slot request, exactly as the surface accepts — the
        // array shape is the contract's, kept so a multi-file slot request
        // is a one-line change on the platform.
        const staged = await op<{files?: Array<{url?: string; key?: string}>}>(
          'mutation',
          'embedUploadUrls',
          {files: JSON.stringify([{contentType: mimeType, contentLength: file.size}])},
          signal,
        );
        const target = staged?.files?.[0];
        if (!target?.url || !target.key) {
          throw new NatzarApiError({
            code: 'internal_error',
            status: 500,
            message: 'The platform returned no upload slot',
            route: 'embedUploadUrls',
            details: staged,
          });
        }
        // The presigned PUT binds the content type: the bytes must go up
        // under the type the slot was minted for, or S3 refuses the signature.
        const put = await doFetch(target.url, {
          method: 'PUT',
          headers: {'content-type': mimeType},
          body: file,
          ...(signal ? {signal} : {}),
        });
        if (!put.ok) {
          throw new NatzarApiError({
            code: 'internal_error',
            status: put.status,
            message: `Attachment upload failed (${put.status})`,
            route: 'embedUploadUrls',
            rawBody: await put.text().catch(() => ''),
          });
        }
        return {stagingKey: target.key, fileName, mimeType};
      },
    },

    refresh: (next) => {
      assertConnectable(next);
      current = next;
      // Consult tokens were minted under the old session's key generation and
      // may not outlive it; the next consult call re-mints — one round trip.
      consultTokens.clear();
      expired = false;
      const waiting = resumeWaiters;
      resumeWaiters = [];
      // A parked subscription continues its own tick with the new token —
      // that IS the refresh. Only one that was not parked (expiry seen by an
      // action, the poll not yet due) needs a nudge, and nudging both would
      // start a second read chain beside the first.
      if (waiting.length) waiting.forEach((wake) => wake());
      else refreshNow();
    },

    call: async (rawOp, signal) => {
      try {
        return await callPatientOp(current, rawOp, options, signal);
      } catch (e) {
        if (isExpiry(e)) markExpired();
        throw e;
      }
    },
  };
}

// --- payments ----------------------------------------------------------------

/**
 * The checkout a payment refusal carries, or null — the `checkout: true`
 * half of the one-press "accept & pay":
 *
 * ```ts
 * try {
 *   await care.respond(entry, true, {checkout: true});
 * } catch (e) {
 *   const checkout = checkoutOf(e);
 *   if (!checkout) throw e;            // not a payment refusal, or none could start
 *   // mount checkout.clientSecret … then wait for care.payments.status(…).paid
 * }
 * ```
 *
 * Null for any other error, for a refusal asked without `checkout: true`,
 * and when the platform could not start one (`details.checkoutError` says
 * why: `payments_unavailable`, `scenario_not_priced`, `stripe_error`). A
 * payload with nothing to mount and nothing paid is treated as none.
 */
export function checkoutOf(error: unknown): CheckoutPayload | null {
  if (!isNatzarApiError(error) || (error.code !== 'payment_required' && error.code !== 'payment_not_completed')) return null;
  const raw = (error.details as {checkout?: unknown} | null | undefined)?.checkout;
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const text = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  const price = toPrice(c);
  const paymentId = text(c.paymentId);
  if (!paymentId || !price) return null;
  const clientSecret = text(c.clientSecret);
  const publishableKey = text(c.publishableKey);
  const checkoutUrl = text(c.checkoutUrl);
  const alreadyPaid = c.alreadyPaid === true;
  if (!alreadyPaid && !clientSecret && !checkoutUrl) return null;
  return {
    paymentId,
    ...price,
    ...(clientSecret ? {clientSecret} : {}),
    ...(publishableKey ? {publishableKey} : {}),
    ...(checkoutUrl ? {checkoutUrl} : {}),
    ...(alreadyPaid ? {alreadyPaid: true} : {}),
    ...(alreadyPaid && c.settling === true ? {settling: true} : {}),
  };
}

// --- the video room ------------------------------------------------------------

/**
 * Where a patient's room session stands — {@link RoomSessionState} without
 * `removed`, which only the physician helper reports (a patient's removal is
 * pulled through like any other drop).
 */
export type PatientRoomState = Exclude<RoomSessionState, {phase: 'removed'}>;

/** Options for {@link connectPatientRoom}. */
export type PatientRoomOptions = RoomSessionOptions<LiveKitGrant, PatientRoomState>;

/**
 * Run a patient's LiveKit room by the platform's rules, from the grant a
 * join (or appointment beat) returned until the call is over:
 *
 * - connects with nothing published, then publishes the microphone and
 *   camera ONLY when the room's metadata carries the grant's `roomNonce`;
 *   otherwise it disconnects and pulls a fresh grant (never publishing);
 * - `ROOM_DELETED` or any drop it did not cause → pulls again: `live` in a
 *   new room, `waiting` (back in the queue — your waiting room, never the
 *   rating screen), or `ended` (the rating screen, as before). A drop while
 *   a connect is still pending ends that attempt at once; the helper never
 *   calls `room.connect()` on top of an attempt that has not settled;
 * - `DUPLICATE_IDENTITY` (the patient opened the call on another device or
 *   tab) → `displaced`, and nothing more until `session.resume()` — the two
 *   screens must not keep re-joining each other;
 * - never lets LiveKit reconnect on its own: the `Room` must be built with
 *   {@link roomOptions}, or this throws.
 *
 * What it cannot do for you: keep YOUR device controls away from an
 * unchecked room. Mount `VideoConference`, `ControlBar`, `TrackToggle` or any
 * mute/camera button of your own only while `call.phase === 'live'`, and
 * render a placeholder in `connecting` and `repulling`. livekit-client queues
 * a microphone or camera switched on while the room is not connected and
 * publishes it as soon as the next connection's signal is up — before the
 * room check — so a tap on "unmute" during "Reconnecting…" could reach a
 * room recreated empty by a stale token.
 *
 * ```ts
 * import {Room} from 'livekit-client';
 * import {RoomContext, VideoConference} from '@livekit/components-react';
 * import {connectPatientRoom, patientPullFromJoin, roomOptions} from '@natzar/client/patient';
 *
 * const room = new Room(roomOptions());
 * const session = connectPatientRoom({
 *   room,
 *   grant: state.livekit!,                                   // from care.telehealth.join()
 *   pull: (signal) => care.telehealth.join(consultId, signal).then(patientPullFromJoin),
 *   onState: (s) => setCall(s),                              // render from s.phase
 * });
 * // <RoomContext.Provider value={room}>
 * //   {call.phase === 'live' ? <VideoConference /> : <Reconnecting />}   // no device control outside `live`
 * // </RoomContext.Provider>; on unmount: session.leave()
 * ```
 */
export function connectPatientRoom(options: PatientRoomOptions): RoomSession {
  return startRoomSession<LiveKitGrant>(options as RoomSessionOptions<LiveKitGrant, RoomSessionState>, {
    label: 'connectPatientRoom',
    usable: (grant): grant is LiveKitGrant =>
      !!grant && typeof grant.token === 'string' && !!grant.token && typeof grant.url === 'string' && !!grant.url &&
      typeof grant.roomNonce === 'string' && !!grant.roomNonce,
    verify: (metadata, grant) => roomCarriesNonce(metadata, grant.roomNonce),
    // A patient is never removed by design; if it happens, pull through it.
    removed: 'repull',
  });
}

const JOIN_ENDED = new Set(['completed', 'cancelled', 'no_show', 'expired']);

/**
 * Map a `care.telehealth.join()` answer (or a server-side
 * `POST /v1/telehealth-consults/{id}/join` body) for {@link connectPatientRoom}:
 * `in_progress` with a grant → `live`, without one → `retry`; a finished
 * consult → `ended`; anything else — `waiting` above all, or a status added
 * after you shipped — → `waiting`, never a reconnect.
 */
export function patientPullFromJoin(state: {status?: string | null; livekit?: LiveKitGrantLike | null} | null | undefined): RoomPull<LiveKitGrant> {
  const status = String(state?.status ?? '');
  if (status === 'in_progress') {
    const grant = toLiveKitGrant(state?.livekit ?? undefined);
    return grant ? {kind: 'live', grant} : {kind: 'retry'};
  }
  if (JOIN_ENDED.has(status)) return {kind: 'ended', status};
  return {kind: 'waiting'};
}

/**
 * Map a `care.telehealth.appointmentBeat()` answer for
 * {@link connectPatientRoom}: `in_progress` with a grant → `live`; `missed` /
 * `closed` → `ended`; `early` / `waiting` / `connecting` (and anything
 * unknown) → `waiting` — back to the appointment's waiting room.
 */
export function patientPullFromAppointmentBeat(
  beat: {state?: {phase?: string | null; status?: string | null} | null; livekit?: LiveKitGrantLike | null} | null | undefined,
): RoomPull<LiveKitGrant> {
  const phase = String(beat?.state?.phase ?? '');
  if (phase === 'in_progress') {
    const grant = toLiveKitGrant(beat?.livekit ?? undefined);
    return grant ? {kind: 'live', grant} : {kind: 'retry'};
  }
  if (phase === 'missed') return {kind: 'ended', status: String(beat?.state?.status ?? 'no_show')};
  if (phase === 'closed') return {kind: 'ended', status: String(beat?.state?.status ?? 'completed')};
  return {kind: 'waiting'};
}


const PAYMENT_STATUSES = new Set<PaymentState['status']>(['pending', 'paid', 'failed', 'expired', 'refunded']);

// A price off the wire: a positive whole amount and a currency, or nothing —
// a malformed price is not shown, the same "absent is not free" rule the
// platform applies.
function toPrice(raw: unknown): InvitePrice | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const {amountCents, currency} = raw as {amountCents?: unknown; currency?: unknown};
  if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents <= 0) return undefined;
  if (typeof currency !== 'string' || !currency) return undefined;
  return {amountCents, currency};
}

// The payment arguments of respond / join. The 0.15 signatures took a bare
// AbortSignal in that position, and still may. A presented payment wins over
// `checkout` — the platform would ignore the flag anyway.
function paymentArgs(options?: AbortSignal | PaymentOptions): {signal?: AbortSignal; pay: {paymentId?: string; checkout?: true}} {
  if (!options) return {pay: {}};
  if (isAbortSignal(options)) return {signal: options, pay: {}};
  const paymentId = options.paymentId?.trim();
  return {
    ...(options.signal ? {signal: options.signal} : {}),
    pay: paymentId ? {paymentId} : options.checkout ? {checkout: true} : {},
  };
}

// Duck-typed rather than `instanceof`: a signal from another realm (an
// iframe, a test runner's) is still a signal.
function isAbortSignal(value: unknown): value is AbortSignal {
  return !!value && typeof value === 'object' && 'aborted' in value &&
    typeof (value as AbortSignal).addEventListener === 'function';
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, {once: true});
  });
}

// --- shaping -----------------------------------------------------------------

// A consult token is trusted for this long less than its `exp` says, so a
// beat minted right at the edge is not refused by the time it arrives.
const EXPIRY_MARGIN_MS = 30_000;

interface RawState {
  /** Which surface the session is scoped to. */
  typ?: string;
  /** Consult-scoped sessions report their consult at the top level… */
  consultId?: string;
  status?: string;
  rated?: boolean;
  rateable?: boolean;
  mode?: string;
  assignedPhysicianName?: string | null;
  /** The consult's price while its next step is owed (absent otherwise). */
  payment?: {amountCents?: number; currency?: string} | null;
  /** …and a nested form is tolerated too, for deployments that nest it. */
  consult?: {
    id?: string;
    type?: string;
    status?: string;
    position?: number;
    estimatedMinutes?: number;
    physicianName?: string;
    physicianShortName?: string;
    rateable?: boolean;
    joinable?: boolean;
    mode?: string;
    awaitingConsent?: boolean;
    payment?: {amountCents?: number; currency?: string} | null;
  };
}
interface RawMessages {
  messages?: Array<{
    id?: string;
    author?: string;
    body?: string;
    sentAt?: string;
    asyncConsultId?: string | null;
    attachments?: Array<{fileName: string; mimeType?: string; url: string}>;
    classification?: string | null;
    emergency?: boolean;
    signature?: string | null;
    clientRef?: string | null;
  }>;
  /**
   * What each consult (or prescription, or referral) linked from the
   * transcript can be used for right now. `pharmacyName` rides along on a
   * pharmacy link, `title` on a referral link.
   */
  linkStates?: Record<string, {
    kind?: string;
    action?: string;
    pharmacyName?: string | null;
    title?: string | null;
    /** An actionable, priced invite's price (consent / join / book). */
    payment?: {amountCents?: number; currency?: string} | null;
  }>;
}
interface RawReferralDocument {
  status?: string;
  kind?: string;
  title?: string;
  physicianName?: string;
  issuedAt?: string;
  revokedAt?: string | null;
  document?: {url?: string; expiresIn?: number; fileName?: string; contentType?: string} | null;
  files?: Array<{id?: string; kind?: string; title?: string; document?: {url?: string; downloadUrl?: string; expiresIn?: number; fileName?: string}}>;
}
interface RawPrescriptionLinkState {
  status?: string;
  expired?: boolean;
  expiresAt?: string | null;
  pharmacyName?: string | null;
  transport?: string | null;
  action?: string;
}
interface RawPharmacySearch {
  status?: string;
  transport?: string;
  pharmacyName?: string | null;
  origin?: PharmacySearchOrigin;
  homeAddress?: string;
  pharmacies?: PharmacyResource[];
}
interface RawPharmacyChoice {
  status?: string;
  pharmacyName?: string;
  transport?: string;
}
interface RawAddedPharmacy {
  directoryId?: string;
  pharmacy?: PharmacyResource;
  probe?: string;
  faxIssue?: string | null;
}
interface RawJoin {
  status?: string;
  position?: number;
  estimatedMinutes?: number;
  rated?: boolean;
  token?: string;
  url?: string;
  roomName?: string;
  roomNonce?: string;
  physicianName?: string;
  physicianShortName?: string;
}
// A platform that predates the zone fields (0.5.0 wire) sends an appointment
// without them; the mapper fills the gaps so a consumer's `clinicTimezone`
// is never undefined.
interface RawAppointment extends Partial<Omit<Appointment, 'clinicTimezone' | 'physicianTimezone' | 'patientTimezone'>> {
  clinicTimezone?: string | null;
  physicianTimezone?: string | null;
  patientTimezone?: string | null;
}
interface RawBookingSlots extends Partial<Omit<BookingSlots, 'status' | 'slots' | 'appointment' | 'clinicTimezone' | 'nextFrom' | 'patientLang' | 'payment'>> {
  status?: string;
  slots?: SlotOffer[];
  clinicTimezone?: string | null;
  nextFrom?: string | null;
  patientLang?: string | null;
  appointment?: RawAppointment | null;
  payment?: {amountCents?: number; currency?: string} | null;
}
interface RawAppointmentBeat {
  state?: {phase?: string; startsAt?: string | null; opensAt?: string; otherSidePresent?: boolean; status?: string} | null;
  appointment?: RawAppointment | null;
  token?: string;
  url?: string;
  roomName?: string;
  roomNonce?: string;
}

type Phase = NonNullable<CareSnapshot['consult']>['phase'];

const PHASES: Record<string, Phase> = {
  invited: 'awaiting_consent',
  queued: 'queued',
  active: 'active',
  resolve_requested: 'active',
  waiting: 'queued',
  ringing: 'ringing',
  in_progress: 'in_call',
  closed: 'closed',
  completed: 'closed',
  cancelled: 'closed',
  no_show: 'closed',
};

const JOIN_STATUSES = new Set<JoinState['status']>(['waiting', 'in_progress', 'completed', 'cancelled', 'no_show', 'expired']);
const BEAT_PHASES = new Set<AppointmentBeat['state']['phase']>(['early', 'waiting', 'connecting', 'in_progress', 'missed', 'closed']);
const LINK_ACTIONS = new Set<LinkAction>([
  'consent',
  'rate',
  'join',
  'book',
  'open',
  'rated',
  'ended',
  'choose',
  'sent',
  'expired',
  'revoked',
  'view',
  'none',
]);
const PHARMACY_ACTIONS = new Set<PharmacyLinkAction>(['choose', 'sent', 'expired', 'revoked']);
const REFERRAL_KINDS = new Set<ReferralKind>(['specialist', 'laboratory', 'imaging']);
const PRESCRIPTION_STATUSES = new Set<PrescriptionStatus>(['awaiting_pharmacy', 'transmitting', 'sent', 'failed', 'revoked', 'expired']);

// The links the platform writes into messages (the same shapes the embed
// widget strips: the two consult ones, the booking one, the pharmacy one a
// prescription notice carries, and the referral one a referral notice
// carries). Matched with their surrounding non-space run so the WHOLE URL
// comes out of the prose.
const LINKS: Array<{kind: LinkKind; pattern: RegExp}> = [
  {kind: 'async', pattern: /\S*\/async\?id=([A-Za-z0-9_-]+)\S*/},
  {kind: 'telehealth', pattern: /\S*\/telehealth\?id=([A-Za-z0-9_-]+)\S*/},
  {kind: 'book', pattern: /\S*\/book\?id=([A-Za-z0-9_-]+)\S*/},
  {kind: 'pharmacy', pattern: /\S*\/pharmacy\?id=([A-Za-z0-9_-]+)\S*/},
  {kind: 'referral', pattern: /\S*\/referral\?id=([A-Za-z0-9_-]+)\S*/},
];

function detectLink(body: string): {kind: LinkKind; consultId: string} | null {
  for (const {kind, pattern} of LINKS) {
    const m = pattern.exec(body);
    if (m) return {kind, consultId: m[1]};
  }
  return null;
}

// The prose without the URL — and without the blank line the removal leaves
// behind when the link sat on its own line. A referral notice also sheds its
// "active for 30 days" sentence (whichever of the five languages it came
// in): it describes the anonymous web link, and the document opened on this
// session has no window. The pharmacy notice keeps its 24-hour sentence —
// that link does expire here too.
function stripLink(body: string, kind: LinkKind): string {
  let out = body;
  for (const {pattern} of LINKS) out = out.replace(pattern, '');
  if (kind === 'referral') for (const sentence of REFERRAL_LINK_VALIDITY_SENTENCES) out = out.replace(sentence, '');
  return out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function toSnapshot(state: RawState, messages: RawMessages): CareSnapshot {
  const linkStates = messages.linkStates ?? {};
  const timeline: TimelineEntry[] = (messages.messages ?? []).map((m) => {
    const body = String(m.body ?? '');
    const entry: TimelineEntry = {
      id: String(m.id ?? ''),
      author: (['patient', 'agent', 'physician', 'system'] as const).includes(m.author as never)
        ? (m.author as TimelineEntry['author'])
        : 'system',
      text: body,
      sentAt: String(m.sentAt ?? ''),
      source: m.asyncConsultId ? 'consult' : 'agent',
    };
    if (m.asyncConsultId) entry.consultId = m.asyncConsultId;
    if (m.attachments?.length) {
      entry.attachments = m.attachments.map((a) => ({
        fileName: a.fileName,
        mimeType: a.mimeType ?? mimeFromName(a.fileName),
        url: a.url,
      }));
    }
    if (m.emergency) entry.emergency = true;
    if (m.signature) entry.signature = m.signature;
    if (m.classification) entry.classification = m.classification;
    if (m.clientRef) entry.clientRef = m.clientRef;

    // A platform link turns into an action. The URL leads to our own
    // anonymous page, which re-asks a date of birth the partner already
    // verified — inside a partner's UI it is the wrong destination twice
    // over, so it never reaches `text`. What the button should DO comes from
    // the server-resolved state: the async link shape is reused for both the
    // consent invite and the rating invite, so the URL alone cannot say.
    const link = entry.author !== 'patient' ? detectLink(body) : null;
    if (link) {
      const resolved = linkStates[link.consultId];
      // Unresolved (the server answers for async, telehealth, prescription
      // and referral ids; a booking link is never dead — its page is the
      // appointment's own; a pharmacy link opens a picker whose first call
      // re-reads the state anyway; a referral open IS a read): the same
      // defaults the embed widget applies (frontend/partner-embed/links.ts).
      const action = LINK_ACTIONS.has(resolved?.action as LinkAction)
        ? (resolved?.action as LinkAction)
        : link.kind === 'book'
          ? 'book'
          : link.kind === 'telehealth'
            ? 'join'
            : link.kind === 'pharmacy'
              ? 'choose'
              : link.kind === 'referral'
                ? 'view'
                : 'none';
      entry.text = stripLink(body, link.kind);
      entry.link = {kind: link.kind, consultId: link.consultId, action};
      // The price rides only on an ACTIONABLE invite: a price beside "Rated"
      // or "Consultation ended" would be a bill for nothing.
      const price = action === 'consent' || action === 'join' || action === 'book' ? toPrice(resolved?.payment) : undefined;
      if (price) entry.link.payment = price;
      if (link.kind === 'pharmacy') {
        // The id names a PRESCRIPTION, not the thread the notice was written
        // on — `entry.consultId` keeps naming the thread.
        entry.link.pharmacyName = typeof resolved?.pharmacyName === 'string' && resolved.pharmacyName ? resolved.pharmacyName : null;
      } else if (link.kind === 'referral') {
        // Likewise a REFERRAL id; the title is what the file card shows.
        entry.link.title = typeof resolved?.title === 'string' && resolved.title ? resolved.title : null;
      } else {
        entry.consultId = link.consultId;
      }
      // A referral sets nothing here on purpose: `view` is an offer, not a
      // debt — the patient carries the document, the platform waits on
      // nothing.
      if (action === 'consent') entry.awaiting = 'consent';
      else if (action === 'rate') entry.awaiting = 'rating';
      else if (action === 'join') entry.awaiting = 'join';
      else if (action === 'book') entry.awaiting = 'book';
      else if (action === 'choose') entry.awaiting = 'pharmacy';
    }
    return entry;
  });
  // Sort on the timestamp ONLY, and lean on Array#sort being stable so that
  // equal timestamps keep the order the platform sent them in.
  //
  // A patient turn and the reply it triggers are stamped with the SAME
  // `sentAt` — they are one exchange, persisted together. Adding an id
  // tiebreaker here therefore sorted them alphabetically by nanoid, which put
  // the answer before the question about half the time and left
  // `awaitingReply` stuck on. The server's order is the authority for ties.
  timeline.sort((a, b) => a.sentAt.localeCompare(b.sentAt));

  const snapshot: CareSnapshot = {
    timeline,
    // The platform answers patient turns asynchronously; "the last thing said
    // was the patient's" is the honest signal for a typing indicator.
    awaitingReply: timeline.length > 0 && timeline[timeline.length - 1].author === 'patient',
  };

  // A consult-scoped session reports its consult at the top level of the
  // state; the nested form is read too. A patient-scoped session has no
  // consult of its own — its invitations live on the timeline as `link`s.
  const raw: RawState['consult'] | undefined =
    state.consult?.id
      ? state.consult
      : (state.typ === 'async' || state.typ === 'telehealth') && state.consultId
        ? {
            id: state.consultId,
            type: state.typ,
            status: state.status,
            rateable: state.rateable,
            mode: state.mode,
            ...(state.assignedPhysicianName ? {physicianName: state.assignedPhysicianName} : {}),
            ...(state.payment ? {payment: state.payment} : {}),
          }
        : undefined;

  if (raw?.id) {
    const phase = PHASES[String(raw.status ?? '')] ?? 'unknown';
    snapshot.consult = {
      id: raw.id,
      kind: raw.type === 'telehealth' ? 'telehealth' : 'async',
      phase,
      ...(raw.position !== undefined ? {position: raw.position} : {}),
      ...(raw.estimatedMinutes !== undefined ? {estimatedMinutes: raw.estimatedMinutes} : {}),
      ...(raw.physicianName
        ? {physician: {name: raw.physicianName, ...(raw.physicianShortName ? {shortName: raw.physicianShortName} : {})}}
        : {}),
      ...(raw.rateable !== undefined ? {rateable: raw.rateable} : {}),
      ...(raw.joinable !== undefined
        ? {joinable: raw.joinable}
        : raw.type === 'telehealth' && (phase === 'queued' || phase === 'ringing' || phase === 'in_call')
          ? {joinable: true}
          : {}),
      ...(raw.type === 'telehealth' ? {mode: raw.mode === 'scheduled' ? ('scheduled' as const) : ('queue' as const)} : {}),
      ...(toPrice(raw.payment) ? {payment: toPrice(raw.payment)!} : {}),
    };
    // Mark the entry the patient must act on, so the partner renders a button
    // from data instead of parsing a link out of message prose.
    const last = timeline[timeline.length - 1];
    if (last && !last.awaiting) {
      if (phase === 'awaiting_consent') last.awaiting = 'consent';
      else if (raw.rateable) last.awaiting = 'rating';
    }
  }
  return snapshot;
}

/** A grant as a wire or a relay may carry it: any field missing or null. */
export type LiveKitGrantLike = {token?: string | null; url?: string | null; roomName?: string | null; roomNonce?: string | null};

// A grant is handed over only whole: a token without a URL cannot connect,
// and one without its room nonce could not be checked before publishing —
// so neither is offered (fail closed; the next beat brings a complete one).
function toLiveKitGrant(raw: LiveKitGrantLike | null | undefined): LiveKitGrant | undefined {
  if (!raw?.token || !raw.url || typeof raw.roomNonce !== 'string' || !raw.roomNonce) return undefined;
  return {token: String(raw.token), url: String(raw.url), roomName: String(raw.roomName ?? ''), roomNonce: raw.roomNonce};
}

function toJoinState(raw: RawJoin): JoinState {
  const status = JOIN_STATUSES.has(raw?.status as JoinState['status']) ? (raw.status as JoinState['status']) : 'unknown';
  const result: JoinState = {
    status,
    position: Number(raw?.position ?? 0),
    estimatedMinutes: Number(raw?.estimatedMinutes ?? 0),
    rated: raw?.rated === true,
  };
  const grant = toLiveKitGrant(raw);
  if (grant) result.livekit = grant;
  if (raw?.physicianName) result.physicianName = String(raw.physicianName);
  if (raw?.physicianShortName) result.physicianShortName = String(raw.physicianShortName);
  return result;
}

function toBookingSlots(raw: RawBookingSlots): BookingSlots {
  const timezone = String(raw?.timezone ?? 'UTC');
  return {
    status: String(raw?.status ?? ''),
    slots: Array.isArray(raw?.slots) ? raw.slots : [],
    timezone,
    // Before the platform reported the clinic zone separately, the grid's zone
    // WAS the clinic's — so that is the truthful fallback.
    clinicTimezone: String(raw?.clinicTimezone ?? timezone),
    truncated: raw?.truncated === true,
    nextFrom: typeof raw?.nextFrom === 'string' && raw.nextFrom ? raw.nextFrom : null,
    slotMinutes: Number(raw?.slotMinutes ?? 0),
    bookingHorizonDays: Number(raw?.bookingHorizonDays ?? 0),
    cancellationWindowMinutes: Number(raw?.cancellationWindowMinutes ?? 0),
    waitingRoomOpensMinutes: Number(raw?.waitingRoomOpensMinutes ?? 0),
    appointment: raw?.appointment ? toAppointment(raw.appointment) : null,
    specialty: raw?.specialty ?? null,
    // A deployment that predates language routing sends nothing here, which
    // is the same truth as "unknown" — null, never ''.
    patientLang: typeof raw?.patientLang === 'string' && raw.patientLang ? raw.patientLang : null,
    noEligiblePhysicians: raw?.noEligiblePhysicians === true,
    licenseBlock: raw?.licenseBlock ?? null,
    ...(toPrice(raw?.payment) ? {payment: toPrice(raw?.payment)!} : {}),
  };
}

function toAppointment(raw: RawAppointment): Appointment {
  const timezone = String(raw.timezone ?? 'UTC');
  return {
    consultId: String(raw.consultId ?? ''),
    startsAt: String(raw.startsAt ?? ''),
    endsAt: String(raw.endsAt ?? ''),
    practitionerId: raw.practitionerId ?? null,
    practitionerName: raw.practitionerName ?? null,
    status: String(raw.status ?? ''),
    waitingRoomOpensAt: String(raw.waitingRoomOpensAt ?? ''),
    cancellableUntil: String(raw.cancellableUntil ?? ''),
    timezone,
    clinicTimezone: String(raw.clinicTimezone ?? timezone),
    physicianTimezone: raw.physicianTimezone ?? null,
    patientTimezone: raw.patientTimezone ?? null,
  };
}

function toAppointmentBeat(raw: RawAppointmentBeat): AppointmentBeat {
  const state = raw?.state ?? {};
  const phase = BEAT_PHASES.has(state.phase as AppointmentBeat['state']['phase'])
    ? (state.phase as AppointmentBeat['state']['phase'])
    : 'unknown';
  const result: AppointmentBeat = {
    state: {
      phase,
      ...(state.startsAt !== undefined ? {startsAt: state.startsAt} : {}),
      ...(state.opensAt ? {opensAt: state.opensAt} : {}),
      ...(state.otherSidePresent !== undefined ? {otherSidePresent: state.otherSidePresent} : {}),
      ...(state.status ? {status: state.status} : {}),
    },
    appointment: raw?.appointment ? toAppointment(raw.appointment) : null,
  };
  const grant = toLiveKitGrant(raw);
  if (grant) result.livekit = grant;
  return result;
}

// A null answer on the wire (a row the platform will not show this patient)
// reads as an expired link — the platform's own rule, and the one answer a
// card can render safely. A deployment that predates the op is NOT masked
// this way: AppSync refuses the unknown field and `callPatientOp` surfaces
// that as `internal_error`, the package's convention for version skew.
function toPrescriptionLinkState(raw: RawPrescriptionLinkState | null | undefined): PrescriptionLinkState {
  const status = PRESCRIPTION_STATUSES.has(raw?.status as PrescriptionStatus) ? (raw!.status as PrescriptionStatus) : 'expired';
  const action = PHARMACY_ACTIONS.has(raw?.action as PharmacyLinkAction) ? (raw!.action as PharmacyLinkAction) : 'expired';
  return {
    status,
    expired: raw?.expired === true || action === 'expired',
    expiresAt: typeof raw?.expiresAt === 'string' && raw.expiresAt ? raw.expiresAt : null,
    pharmacyName: typeof raw?.pharmacyName === 'string' && raw.pharmacyName ? raw.pharmacyName : null,
    transport: raw?.transport === 'erx' || raw?.transport === 'fax' ? raw.transport : null,
    action,
  };
}

// The document op refuses in-band for a miss (`{ok:false, error:'not_found'}`,
// thrown by callPatientOp before this runs), so what reaches here is a row
// the platform will show this patient: issued with its URL, or revoked. A
// reply with neither a usable document nor `revoked` (a deployment that
// predates the op answers through AppSync's own refusal, never this) is
// reported as the package's version-skew code rather than rendered as a
// card that opens nothing.
function toReferralDocument(raw: RawReferralDocument | null | undefined): ReferralDocument {
  const kind = REFERRAL_KINDS.has(raw?.kind as ReferralKind) ? (raw!.kind as ReferralKind) : 'specialist';
  const base = {
    kind,
    title: String(raw?.title ?? ''),
    physicianName: String(raw?.physicianName ?? ''),
    issuedAt: String(raw?.issuedAt ?? ''),
  };
  if (raw?.status === 'revoked') {
    return {status: 'revoked', ...base, revokedAt: typeof raw.revokedAt === 'string' && raw.revokedAt ? raw.revokedAt : null};
  }
  const doc = raw?.document;
  if (raw?.status !== 'issued' || !doc?.url) {
    throw new NatzarApiError({
      code: 'internal_error',
      status: 500,
      message: 'The platform returned no referral document',
      route: 'embedReferralDocument',
      details: raw,
    });
  }
  return {
    status: 'issued',
    ...base,
    ...(Array.isArray(raw.files) ? {files: raw.files.filter((file) => !!file.document?.url).map((file) => ({
      id: String(file.id ?? ''),
      kind: REFERRAL_KINDS.has(file.kind as ReferralKind) ? file.kind as ReferralKind : kind,
      title: String(file.title ?? ''),
      document: {url: String(file.document!.url), ...(file.document?.downloadUrl ? {downloadUrl: file.document.downloadUrl} : {}), expiresIn: Number(file.document?.expiresIn ?? 0), fileName: String(file.document?.fileName ?? 'referral.pdf'), contentType: 'application/pdf' as const},
    }))} : {}),
    document: {
      url: String(doc.url),
      expiresIn: typeof doc.expiresIn === 'number' ? doc.expiresIn : 0,
      fileName: String(doc.fileName ?? 'referral.pdf'),
      contentType: 'application/pdf',
    },
  };
}

function toPharmacySearch(raw: RawPharmacySearch | null | undefined): PharmacySearch {
  const result: PharmacySearch = {
    status: PRESCRIPTION_STATUSES.has(raw?.status as PrescriptionStatus) ? (raw!.status as PrescriptionStatus) : 'expired',
    transport: raw?.transport === 'fax' ? 'fax' : 'erx',
    pharmacyName: typeof raw?.pharmacyName === 'string' && raw.pharmacyName ? raw.pharmacyName : null,
    pharmacies: Array.isArray(raw?.pharmacies) ? raw.pharmacies : [],
  };
  if (raw?.origin && typeof raw.origin === 'object') result.origin = raw.origin;
  if (typeof raw?.homeAddress === 'string' && raw.homeAddress) result.homeAddress = raw.homeAddress;
  return result;
}

// The platform names attachments by their stored ref and does not always
// carry a type; a best-effort guess from the extension keeps `mimeType`
// populated for the common cases a chat renders inline.
function mimeFromName(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const known: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    heic: 'image/heic',
    pdf: 'application/pdf',
    csv: 'text/csv',
    txt: 'text/plain',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return known[ext] ?? 'application/octet-stream';
}

// The token's claims, read WITHOUT verification — the platform verifies; this
// only reads `exp` (to know when a cached consult token is due) and `typ`
// (to route consent/rating to the op for this session kind). A token that
// is not a JWT yields nothing and every default applies. `atob` rather than
// Buffer: this file runs in browsers, and Node has had it globally since 16.
function decodeJwtClaims(token: string): {exp?: number; typ?: string} | undefined {
  const parts = token.split('.');
  if (parts.length !== 3 || typeof atob !== 'function') return undefined;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as Record<string, unknown>;
    return {
      ...(typeof claims.exp === 'number' ? {exp: claims.exp} : {}),
      ...(typeof claims.typ === 'string' ? {typ: claims.typ} : {}),
    };
  } catch {
    return undefined;
  }
}

// Cheap change detection: ids + the fields that drive a re-render. Comparing
// whole objects would re-render on every server-side timestamp jitter.
const fingerprint = (s: CareSnapshot): string =>
  [
    s.timeline.length,
    s.timeline[s.timeline.length - 1]?.id ?? '',
    s.timeline[s.timeline.length - 1]?.awaiting ?? '',
    // A link's action moves on its own (join → ended once the call is over)
    // without the timeline growing; the button must follow — and so must its
    // price, which appears, changes or goes (paid) on the same entry.
    s.timeline
      .map((e) => (e.link ? `${e.id}:${e.link.action}:${e.link.payment ? `${e.link.payment.amountCents}${e.link.payment.currency}` : ''}` : ''))
      .filter(Boolean)
      .join(','),
    s.awaitingReply ? '1' : '0',
    s.consult?.id ?? '',
    s.consult?.phase ?? '',
    s.consult?.position ?? '',
    s.consult?.rateable ? '1' : '0',
    s.consult?.joinable ? '1' : '0',
    s.consult?.payment ? `${s.consult.payment.amountCents}${s.consult.payment.currency}` : '',
  ].join('|');
