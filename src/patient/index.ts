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

import {watch, type SyncState, type Unsubscribe, type WatchOptions} from '../subscribe';
import {NatzarApiError, isNatzarApiError} from '../errors';
import {
  assertConnectable,
  callPatientOp,
  type FetchLike,
  type PatientSession,
  type TransportOptions,
} from './transport';

export type {PatientSession, Unsubscribe, SyncState, WatchOptions, TransportOptions, FetchLike};
export {NatzarSessionError} from './transport';

/**
 * What a platform link inside a message can currently be used for.
 *
 * The terminal ones are distinct rather than a single "nothing" because a good
 * UI keeps the control visible and disabled with a label saying what happened
 * ("Rated", "Consultation ended") — a button that vanishes after a tap leaves
 * the patient unsure whether it registered.
 *
 * - `consent` / `rate` / `join` / `book` — actionable; mirrored on `awaiting`.
 * - `open` — the consult is live and the conversation itself is the surface.
 * - `rated` — already rated. `ended` — finished, nothing left to do.
 * - `none` — the platform could not resolve it; say nothing rather than guess.
 */
export type LinkAction = 'consent' | 'rate' | 'join' | 'book' | 'open' | 'rated' | 'ended' | 'none';

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
   * Absent once answered, so a rendered button disappears on its own.
   */
  awaiting?: 'consent' | 'rating' | 'join' | 'book';
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
  /** A consult link the message carried, resolved to what it can do now. */
  link?: {kind: 'async' | 'telehealth' | 'book'; consultId: string; action: LinkAction};
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

/** What a video room needs — hand it to your LiveKit client. */
export interface LiveKitGrant {
  token: string;
  url: string;
  roomName: string;
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
  /** Present exactly when the call is on — `status === 'in_progress'`. */
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
  /** Present exactly when the call is on. */
  livekit?: LiveKitGrant;
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
  /** Answer a consent invite surfaced as `entry.awaiting === 'consent'`. */
  respond(entry: TimelineEntry, accept: boolean, signal?: AbortSignal): Promise<void>;
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
    /** Enter / stay in the waiting room; returns the room grant once the call is on. */
    join(consultId: string, signal?: AbortSignal): Promise<JoinState>;
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
     * cancel or attend one first.
     */
    book(
      consultId: string,
      booking: {startsAt: string; practitionerId?: string; timezone?: string},
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

    respond: async (_entry, accept, signal) => {
      // The token is what scopes the answer — a patient session resolves the
      // patient's own open invite, a consult session its own thread — so the
      // entry is only the thing the partner rendered the buttons on.
      await op('mutation', sessionTyp() === 'async' ? 'embedAsyncConsent' : 'embedAgentConsent', {accept}, signal);
      refreshNow();
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

      join: async (consultId, signal) => {
        const raw = await consultOp<RawJoin>(consultId, 'embedConsultJoin', {}, signal);
        const result = toJoinState(raw);
        // The transcript gains lifecycle notices as the call starts and ends;
        // a conversation rendered beside the video should not lag them.
        if (result.status !== 'waiting') refreshNow();
        return result;
      },

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

      book: async (consultId, booking, signal) => {
        const raw = await consultOp<{appointment?: RawAppointment | null; rescheduled?: boolean}>(
          consultId,
          'embedBook',
          {
            startsAt: booking.startsAt,
            ...(booking.practitionerId ? {practitionerId: booking.practitionerId} : {}),
            ...(booking.timezone ? {timezone: booking.timezone} : {}),
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
      },

      cancelBooking: async (consultId, signal) => {
        await consultOp(consultId, 'embedCancelBooking', {}, signal);
        refreshNow();
      },

      appointmentBeat: async (consultId, present = true, signal) => {
        const raw = await consultOp<RawAppointmentBeat>(consultId, 'embedAppointmentBeat', {present}, signal);
        return toAppointmentBeat(raw);
      },
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
  /** What each consult linked from the transcript can be used for right now. */
  linkStates?: Record<string, {kind?: string; action?: string}>;
}
interface RawJoin {
  status?: string;
  position?: number;
  estimatedMinutes?: number;
  rated?: boolean;
  token?: string;
  url?: string;
  roomName?: string;
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
interface RawBookingSlots extends Partial<Omit<BookingSlots, 'status' | 'slots' | 'appointment' | 'clinicTimezone' | 'nextFrom' | 'patientLang'>> {
  status?: string;
  slots?: SlotOffer[];
  clinicTimezone?: string | null;
  nextFrom?: string | null;
  patientLang?: string | null;
  appointment?: RawAppointment | null;
}
interface RawAppointmentBeat {
  state?: {phase?: string; startsAt?: string | null; opensAt?: string; otherSidePresent?: boolean; status?: string} | null;
  appointment?: RawAppointment | null;
  token?: string;
  url?: string;
  roomName?: string;
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
const LINK_ACTIONS = new Set<LinkAction>(['consent', 'rate', 'join', 'book', 'open', 'rated', 'ended', 'none']);

// The consult links the platform writes into messages (the same two shapes
// the embed widget strips, plus the booking one). Matched with their
// surrounding non-space run so the WHOLE URL comes out of the prose.
const LINKS: Array<{kind: 'async' | 'telehealth' | 'book'; pattern: RegExp}> = [
  {kind: 'async', pattern: /\S*\/async\?id=([A-Za-z0-9_-]+)\S*/},
  {kind: 'telehealth', pattern: /\S*\/telehealth\?id=([A-Za-z0-9_-]+)\S*/},
  {kind: 'book', pattern: /\S*\/book\?id=([A-Za-z0-9_-]+)\S*/},
];

function detectLink(body: string): {kind: 'async' | 'telehealth' | 'book'; consultId: string} | null {
  for (const {kind, pattern} of LINKS) {
    const m = pattern.exec(body);
    if (m) return {kind, consultId: m[1]};
  }
  return null;
}

// The prose without the URL — and without the blank line the removal leaves
// behind when the link sat on its own line.
function stripLink(body: string): string {
  let out = body;
  for (const {pattern} of LINKS) out = out.replace(pattern, '');
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
      // Unresolved (the server answers for async and telehealth ids; a
      // booking link is never dead — its page is the appointment's own):
      // the same defaults the embed widget applies (frontend/partner-embed/links.ts).
      const action = LINK_ACTIONS.has(resolved?.action as LinkAction)
        ? (resolved?.action as LinkAction)
        : link.kind === 'book'
          ? 'book'
          : link.kind === 'telehealth'
            ? 'join'
            : 'none';
      entry.text = stripLink(body);
      entry.link = {kind: link.kind, consultId: link.consultId, action};
      entry.consultId = link.consultId;
      if (action === 'consent') entry.awaiting = 'consent';
      else if (action === 'rate') entry.awaiting = 'rating';
      else if (action === 'join') entry.awaiting = 'join';
      else if (action === 'book') entry.awaiting = 'book';
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

function toJoinState(raw: RawJoin): JoinState {
  const status = JOIN_STATUSES.has(raw?.status as JoinState['status']) ? (raw.status as JoinState['status']) : 'unknown';
  const result: JoinState = {
    status,
    position: Number(raw?.position ?? 0),
    estimatedMinutes: Number(raw?.estimatedMinutes ?? 0),
    rated: raw?.rated === true,
  };
  if (raw?.token && raw.url) result.livekit = {token: String(raw.token), url: String(raw.url), roomName: String(raw.roomName ?? '')};
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
  if (raw?.token && raw.url) result.livekit = {token: String(raw.token), url: String(raw.url), roomName: String(raw.roomName ?? '')};
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
    // without the timeline growing; the button must follow.
    s.timeline.map((e) => (e.link ? `${e.id}:${e.link.action}` : '')).filter(Boolean).join(','),
    s.awaitingReply ? '1' : '0',
    s.consult?.id ?? '',
    s.consult?.phase ?? '',
    s.consult?.position ?? '',
    s.consult?.rateable ? '1' : '0',
    s.consult?.joinable ? '1' : '0',
  ].join('|');
