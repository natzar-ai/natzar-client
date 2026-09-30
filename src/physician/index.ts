// The PHYSICIAN surface — a clinician's screen inside YOUR portal.
//
//   import {connectPhysician} from '@natzar/client/physician';
//
//   const desk = connectPhysician(session);              // session from your server
//   const stop = desk.workspace.subscribe(render);       // queue, inbox, calls, presence
//   await desk.presence.ready();                         // on the live rota — the SDK heartbeats
//   const {livekit} = await desk.telehealth.room(id);    // once the workspace says in_progress
//
// That is the whole integration: no poll loop, no heartbeat timer, no API key
// in the bundle, and no second login for the clinician — your server exchanges
// your own session for a Natzar physician session (`physicians.session`) and
// hands the response to the browser as-is.
//
// Design notes worth knowing:
//
// * SNAPSHOTS ARE PLAIN DATA. A workspace or thread snapshot is the contract's
//   own JSON — no methods, no closures. It survives a store, a `postMessage`
//   or an RSC boundary; actions live on the stable `desk.*` objects. Putting
//   commands inside snapshots would allocate new function identities on every
//   poll and silently defeat memoised rendering.
//
// * ONE READ, POLLED. The platform publishes the whole clinician screen as one
//   document (`GET /v1/physicians/me/workspace`) precisely so a portal does
//   not fan out across six reads and diff them. The subscription polls it,
//   fingerprints it, and calls back only when something that drives a render
//   actually changed — a queue reordering, a ring, a reply landing — never on
//   the server's clock ticking.
//
// * PRESENCE IS A HEARTBEAT, AND THE SDK OWNS IT. A physician is on the live
//   rota only while beats keep arriving (every 15 s, 45 s TTL). The SDK beats
//   while the physician is engaged (`ready` or on a call) AND a workspace
//   subscription is open — the subscription being the one signal it has that a
//   screen is actually in front of someone. Unsubscribe, go offline, or let the
//   session expire and the beats stop, so a closed laptop never keeps a
//   physician on a rota patients are being rung against.
//
// * EXPIRY IS ONE CALLBACK. Sessions are short-lived. The first `401` flips the
//   client into a parked state — no polling, no beats — and calls `onExpired`
//   once; `refresh(session)` with a re-mint resumes everything where it was.
//
// * A DISCONNECT IS NEVER AN END. The platform may retire a call's room and
//   open a new one; `ROOM_DELETED` means "pull `room()` / `ready()` again",
//   and only `telehealth.end()` ends the consult. `connectPhysicianRoom` runs
//   a LiveKit `Room` you construct by those rules.

import {NatzarClient} from '../client';
import {isNatzarApiError, NatzarApiError} from '../errors';
import {assertUsableKey, type FetchLike} from '../http';
import {NatzarSessionError} from '../session-error';
import {DEFAULT_TUNING, watch, type PollTuning, type SyncState, type Unsubscribe, type WatchOptions} from '../subscribe';
import {PHYSICIAN_HEARTBEAT_INTERVAL_SECONDS} from '../contract/resources';
import type {
  AsyncConsultResource,
  MessageResource,
  PhysicianPresence,
  PhysicianResource,
  PhysicianWorkspace,
  TelehealthConsultResource,
} from '../contract/resources';
import type {
  CloseAsyncConsultRequest,
  EndTelehealthConsultResponse,
  EscalateAsyncConsultResponse,
  IssueReferralResponse,
  IssuePrescriptionResponse,
  PhysicianAgendaQuery,
  PresenceResponse,
  SpecialtyResource,
  TelehealthReadyResponse,
  TelehealthRoomResponse,
} from '../contract/endpoints';
import {baseLanguageOf, type PhysicianLanguage} from '../contract/languages';
import type {ReferralDraft, ReferralLanguage} from '../contract/referrals';
import type {IssuePrescriptionRequest} from '../contract/schemas';
import {
  parseRoomMetadata,
  roomCarriesNonce,
  startRoomSession,
  type RoomPull,
  type RoomSession,
  type RoomSessionOptions,
  type RoomSessionState,
} from '../room';

export type {SyncState, Unsubscribe, WatchOptions, FetchLike};
export {NatzarSessionError};
export {DISCONNECT_REASON, NO_RECONNECT_POLICY, parseRoomMetadata, roomCarriesNonce, roomOptions} from '../room';
export type {LiveKitRoomLike, ReconnectPolicyLike, RepullReason, RoomPull, RoomSession, RoomSessionState} from '../room';
export type {PhysicianSurfaceErrorCode} from './codes';
export type {
  AsyncConsultResource,
  EndTelehealthConsultResponse,
  EscalateAsyncConsultResponse,
  IssueReferralResponse,
  IssuePrescriptionResponse,
  MessageResource,
  PhysicianAgendaQuery,
  PhysicianLanguage,
  PhysicianPresence,
  PhysicianResource,
  PhysicianWorkspace,
  PresenceResponse,
  SpecialtyResource,
  TelehealthConsultResource,
  TelehealthReadyResponse,
  TelehealthRoomResponse,
};
export type {ReferralDraft, ReferralLanguage};
export type {IssuePrescriptionRequest};

/**
 * Everything the browser needs to talk to the physician surface — exactly the
 * response your server got from `physicians.session(id)`. Hand it over as-is.
 */
export interface PhysicianSession {
  /** The physician-scoped credential. Short-lived; see {@link expiresAt}. */
  sessionToken: string;
  /** When {@link sessionToken} stops working. */
  expiresAt?: string;
  /**
   * The REST base URL (through `/v1`), returned with the mint so nothing about
   * our deployment is baked into your bundle. Required unless
   * {@link ConnectOptions.apiUrl} supplies it.
   */
  apiUrl?: string;
  /** The physician the session was minted for, as the mint reported them. */
  physician?: PhysicianResource;
}

export interface ConnectOptions {
  /** The `fetch` to use. Defaults to the global one. */
  fetch?: FetchLike;
  /** Per-request timeout. @defaultValue 30000 */
  timeoutMs?: number;
  /** Poll cadence of the workspace and thread subscriptions. @defaultValue 2500 */
  intervalMs?: number;
  /**
   * How often to beat while engaged and subscribed. The platform's own
   * cadence (15 s against a 45 s TTL — two beats may be lost before the
   * physician drops off the rota) is the right answer; this exists for tests.
   * @defaultValue 15000
   */
  heartbeatIntervalMs?: number;
  /**
   * The REST base URL, when the session does not carry one (a deployment
   * predating self-describing physician sessions, or a proxy of your own).
   * The session's own `apiUrl` wins when both are present.
   */
  apiUrl?: string;
  /** Extra headers on every request (tracing, tenant tagging…). */
  headers?: Record<string, string>;
  /**
   * Called ONCE when the session token has expired (or was invalidated by a
   * key rotation). Subscriptions park and heartbeats stop until you mint a
   * fresh session on your server and hand it to `desk.refresh(session)`, at
   * which point they resume where they were. Actions taken in between reject
   * with `unauthorized`.
   */
  onExpired?: () => void;
  /**
   * Called when an AUTOMATIC heartbeat fails. Logging only: the next beat is
   * 15 s away regardless, and the workspace's `telehealth.visible` /
   * `presence.stale` already tell the UI whether the rota still sees the
   * physician. Expiry is reported through `onExpired`, not here.
   */
  onHeartbeatError?: (error: Error) => void;
}

/** A messaging thread as the physician sees it: the consult plus its transcript. */
export interface ThreadSnapshot {
  /** The consult — status, assignee, SLA fields, the patient's header card. */
  consult: AsyncConsultResource;
  /**
   * The full transcript, oldest first, lifecycle notices included. Attachment
   * `url`s are presigned per read; fetch promptly, never persist them.
   */
  messages: MessageResource[];
}

/** A staged upload, ready to attach to a reply. */
export interface StagedAttachment {
  /** The platform's handle for the staged bytes. Pass it to `reply()` as-is. */
  stagingKey: string;
  fileName: string;
  mimeType: string;
}

/** Which patient an upload is for — ours or yours. */
export type PatientRef = {patientId: string; externalPatientId?: never} | {externalPatientId: string; patientId?: never};

/** A physician-scoped handle. Create with {@link connectPhysician}. */
export interface PhysicianClient {
  workspace: {
    /**
     * Subscribe to the whole clinician screen. Calls back immediately, then
     * on every genuine change — never on the server's clock alone. Returns an
     * unsubscribe function; call it on unmount. While at least one workspace
     * subscription is open and the physician is engaged, the SDK heartbeats
     * for them.
     */
    subscribe(
      onChange: (snapshot: PhysicianWorkspace | undefined, sync: SyncState) => void,
      options?: WatchOptions,
    ): Unsubscribe;
    /** Read once, without starting a subscription (and without heartbeats). */
    get(signal?: AbortSignal): Promise<PhysicianWorkspace>;
  };
  presence: {
    /**
     * Go on the live video queue. Matches immediately — `activeConsult` is the
     * patient now ringing, if any — and, with a workspace subscription open,
     * starts the automatic heartbeat that keeps the physician on the rota.
     */
    ready(signal?: AbortSignal): Promise<PresenceResponse>;
    /** Leave the live queue (`busy`), clearing any pending ring. Heartbeats stop. */
    offline(signal?: AbortSignal): Promise<PresenceResponse>;
    /**
     * One beat, now. The SDK beats on its own every 15 s while engaged and
     * subscribed; this is for a surface that polls the workspace itself with
     * `get()` and so has no subscription to hang the automatic beat on.
     */
    heartbeat(signal?: AbortSignal): Promise<PresenceResponse>;
  };
  telehealth: {
    /**
     * The way into a call this physician is on. `in_progress` carries the
     * LiveKit grant; `ringing` carries none — the patient is confirming, so
     * keep rendering the workspace and call again once `telehealth.active`
     * reads `in_progress`. `409 not_assigned` for a consult that is not theirs.
     */
    room(consultId: string, signal?: AbortSignal): Promise<TelehealthRoomResponse>;
    /**
     * Hang up. The physician returns to `ready` and the queue is re-matched
     * at once — `next` is the patient now ringing, if any. `goOffline` ends
     * the shift instead: `next` is always null and heartbeats stop.
     */
    end(consultId: string, options?: {goOffline?: boolean}, signal?: AbortSignal): Promise<EndTelehealthConsultResponse>;
    /**
     * Presence in a BOOKED appointment's waiting room — the twin of the
     * patient's join. Call when the physician opens the appointment and every
     * ~10 s while they stay; `livekit` appears the moment both sides are
     * present inside the window. `present: false` once when they step away.
     */
    ready(consultId: string, present?: boolean, signal?: AbortSignal): Promise<TelehealthReadyResponse>;
    /**
     * Cancel an appointment of theirs before it starts. The patient is told,
     * with `reason` relayed in the notice.
     */
    cancel(consultId: string, options?: {reason?: string}, signal?: AbortSignal): Promise<TelehealthConsultResource>;
    /**
     * Booked appointments in a window (default now → +7 days, at most 31),
     * soonest first. The workspace already carries the next 7 days as
     * `telehealth.upcoming`; this is the calendar view.
     */
    agenda(range?: PhysicianAgendaQuery, signal?: AbortSignal): Promise<TelehealthConsultResource[]>;
    /** One consult, fresh — including a presigned `recordingUrl` once it exists. */
    get(consultId: string, signal?: AbortSignal): Promise<TelehealthConsultResource>;
  };
  inbox: {
    /** Take a `queued` thread (`workspace.async.queued`). */
    claim(consultId: string, signal?: AbortSignal): Promise<AsyncConsultResource>;
    /** Take over an `overdue` thread held by someone else (`409 sla_not_overdue` before). */
    takeover(consultId: string, signal?: AbortSignal): Promise<AsyncConsultResource>;
    /** Mark a thread of theirs resolved; the patient gets the note with the notice. */
    resolve(consultId: string, options?: {note?: string}, signal?: AbortSignal): Promise<AsyncConsultResource>;
    /** Close a thread of theirs outright, without the resolve/accept exchange. */
    close(consultId: string, options?: CloseAsyncConsultRequest, signal?: AbortSignal): Promise<AsyncConsultResource>;
    /**
     * Turn a thread into a live video consult: it closes as `escalated`, a
     * telehealth consult opens for the patient and they are sent the link.
     * Go `ready` to take it when they follow it.
     */
    escalate(consultId: string, signal?: AbortSignal): Promise<EscalateAsyncConsultResponse>;
    /**
     * Sign and send a specialist, laboratory or imaging requisition. On a
     * `referral_request` thread, delivering it fulfils and closes the request;
     * on a normal conversation, the thread stays open for follow-up care.
     */
    issueReferral(
      consultId: string,
      input: {draft: ReferralDraft; lang?: ReferralLanguage},
      signal?: AbortSignal,
    ): Promise<IssueReferralResponse['referral']>;
    /** Sign up to five requisitions in one operation and send one patient link. */
    issueReferrals(consultId: string, input: {drafts: ReferralDraft[]; lang?: ReferralLanguage}, signal?: AbortSignal): Promise<IssueReferralResponse>;
    /**
     * The referral drafts the partner suggested on a `referral_request`
     * (`consult.suggestedReferrals`), read fresh — `[]` when there are none.
     * What a "Generate referrals" dialog pre-fills; the physician reviews and
     * may edit them before {@link generateReferrals}. From 0.13.0.
     */
    suggestedReferrals(consultId: string, signal?: AbortSignal): Promise<ReferralDraft[]>;
    /**
     * "Generate referrals" in one call: signs `input.drafts` — or, when
     * `drafts` is omitted, the consult's `suggestedReferrals` read fresh — as
     * one bundle (one PDF each, one patient link), exactly like
     * {@link issueReferrals}. An explicit empty `drafts` (the physician
     * unchecked every card) signs NOTHING: it is refused, never read as
     * "use the suggestions". Signing the suggestions without a `lang` prints
     * them in the patient's language (`consult.patientLang`, e.g. `fr_CH` →
     * `fr`) — the language the partner wrote their text in — rather than the
     * platform default; pass `lang` to choose. A consult still `queued` is
     * claimed first: the physician asked to answer it. Throws a
     * {@link NatzarApiError} with code `no_suggested_referrals` (before any
     * request) for an empty `drafts`, or (before any write) when the consult
     * carries nothing to sign — open the blank composer instead. Refreshes
     * the thread and the workspace like `issueReferrals`. From 0.13.0;
     * empty-list refusal and patient-language default from 0.13.1.
     */
    generateReferrals(
      consultId: string,
      input?: {drafts?: ReferralDraft[]; lang?: ReferralLanguage},
      signal?: AbortSignal,
    ): Promise<IssueReferralResponse>;
    /** Sign and send a prescription using the jurisdiction's fax workflow. */
    issuePrescription(consultId: string, input: IssuePrescriptionRequest, signal?: AbortSignal): Promise<IssuePrescriptionResponse['prescription']>;
    /**
     * Post the physician's reply. Resolves when the platform has ACCEPTED it
     * — it appears on the thread subscription once delivered, typically
     * within a poll. Retried safely: the SDK pins an idempotency key per
     * call, so a retry after a timeout never posts the reply twice.
     */
    reply(consultId: string, input: {text: string; attachment?: StagedAttachment}, signal?: AbortSignal): Promise<{messageId: string}>;
    /** One thread, as a live surface. */
    thread(consultId: string): {
      /**
       * Subscribe to the consult and its transcript. Stops on its own
       * (`phase: 'stopped'`) once the thread is closed — a finished thread
       * should not cost a request every few seconds.
       */
      subscribe(onChange: (snapshot: ThreadSnapshot | undefined, sync: SyncState) => void, options?: WatchOptions): Unsubscribe;
      /** Read once. */
      get(signal?: AbortSignal): Promise<ThreadSnapshot>;
    };
  };
  specialties: {
    /** The tenant's catalogue, in display order. */
    list(signal?: AbortSignal): Promise<SpecialtyResource[]>;
    /**
     * REPLACE the physician's own specialties (slugs from `list()`). An unknown
     * slug is dropped, not refused — read the returned `specialties` for what
     * stuck. An empty list means "covers everything".
     */
    set(input: {specialties: string[]; acceptsAllSpecialties?: boolean}, signal?: AbortSignal): Promise<PhysicianResource>;
  };
  languages: {
    /**
     * REPLACE the languages the physician consults in — base codes from
     * `PHYSICIAN_LANGUAGES` in the contract (`fr`, never `fr_CH`; a locale is
     * refused with `400 invalid_request`). A ranked routing PREFERENCE, never
     * a filter: a patient is offered first to a physician who speaks their
     * language, then to one who speaks English, then to anyone — so the list
     * can never exclude this physician, and an empty one means "nothing
     * recorded" (ranks last, never assumed English). Read the returned
     * `languages` for the stored list; the workspace re-reads at once.
     */
    set(input: {languages: PhysicianLanguage[]}, signal?: AbortSignal): Promise<PhysicianResource>;
  };
  attachments: {
    /**
     * Stage a file for a reply to one of the tenant's patients: asks the
     * platform for a one-shot upload slot in that patient's staging area, PUTs
     * the bytes, and returns the handle `reply()` takes. Refused with
     * `unsupported_type` / `file_too_large`.
     */
    upload(
      patient: PatientRef,
      file: Blob & {name?: string},
      options?: {fileName?: string; signal?: AbortSignal},
    ): Promise<StagedAttachment>;
  };
  /** The acting physician, fresh — `GET /v1/physicians/me`. */
  me(signal?: AbortSignal): Promise<PhysicianResource>;
  /**
   * Swap in a freshly minted session without rebuilding the client. Parked
   * subscriptions resume at once and heartbeats restart.
   */
  refresh(session: PhysicianSession): void;
  /**
   * The typed REST client bound to the CURRENT session, for any
   * physician-session route this surface does not model (`asyncConsults.list`
   * with `assignee`, `schedules`, `licenses`…). Read it at call time rather
   * than caching it: `refresh()` replaces it.
   */
  readonly client: NatzarClient;
}

/**
 * Connect to the physician surface using a session your server minted.
 *
 * ```ts
 * // your server, after YOUR authentication of the clinician
 * const session = await natzar.physicians.session(physicianId);
 * // → send `session` to the browser as-is
 *
 * // your browser
 * const desk = connectPhysician(session, {onExpired: () => remintAndRefresh()});
 * ```
 */
export function connectPhysician(session: PhysicianSession, options: ConnectOptions = {}): PhysicianClient {
  // Fail at CONSTRUCTION, not on first use — the same rule the server client
  // applies to its API key. A session that can never connect is a wiring
  // mistake, and wiring mistakes should surface where they were made rather
  // than inside whatever component happened to call first.
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? PHYSICIAN_HEARTBEAT_INTERVAL_SECONDS * 1000;

  // The client in force, bound to the session's token. `refresh()` replaces
  // it; every call reads `client` at call time rather than closing over the
  // original, which is what lets a re-mint land without re-subscribing.
  let client = build(session, options);

  // --- expiry ---------------------------------------------------------------
  //
  // One flag, one callback. The first `401 unauthorized` flips it and tells
  // the partner; every subscription then parks on `resumed` instead of
  // polling a dead token every 2.5 s (and backing off into a "retrying" state
  // that looks like a network problem when it is not), and the heartbeat
  // stops. A `403 forbidden` is NOT expiry: it is a route outside what a
  // session may call, and the caller should see it as such.
  let expired = false;
  let resumeWaiters: Array<() => void> = [];

  const markExpired = () => {
    if (expired) return;
    expired = true;
    syncHeartbeat();
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

  const isExpiry = (e: unknown): boolean => isNatzarApiError(e) && e.code === 'unauthorized';

  // Every request goes through here, so expiry is observed in one place and
  // no caller can forget to.
  const call = async <T>(run: (c: NatzarClient) => Promise<T>): Promise<T> => {
    try {
      return await run(client);
    } catch (e) {
      if (isExpiry(e)) markExpired();
      throw e;
    }
  };

  // The subscription's read: parked while the session is expired. Parking
  // INSIDE the read (rather than throwing) keeps the poller from backing off
  // into `retrying` — nothing is being retried — and resumes the very same
  // tick, with the new token, the moment `refresh()` lands.
  const whileValid = async <T>(signal: AbortSignal, read: () => Promise<T>): Promise<T> => {
    for (;;) {
      if (expired) await resumed(signal);
      try {
        return await read();
      } catch (e) {
        if (!isExpiry(e)) throw e;
      }
    }
  };

  // --- presence & heartbeat -------------------------------------------------
  //
  // `engaged` is the last thing the platform told us about the physician's
  // presence: `ready` (on the rota) or `busy` ON A CALL. A beat while on a
  // call is a no-op server-side beyond refreshing `lastSeenAt`, and keeping
  // the timer through a call means there is no gap to cover when `end` puts
  // them straight back on the rota — the moment a patient is most likely to
  // be rung for them.
  //
  // `busy` is ALSO what the platform stores for a physician who stepped off
  // the queue (`ready: false`, or `end` with `goOffline`) — the same status,
  // told apart by the active consult: on a call there is one, paused there is
  // none. A paused physician must NOT be beaten for: nothing on the server
  // would revive them (only `ready: true` does), and the beat is the SDK's
  // promise that someone is watching the screen for a patient — a promise
  // that means nothing while they are off the rota.
  //
  // Presence writes and reads race: a workspace read that left before a
  // `ready()` write can land after it and report the OLD state. `epoch`
  // stamps every presence-bearing request when it starts; a response from
  // before the latest write is not allowed to overrule that write.
  let engaged = false;
  let epoch = 0;
  let subscribers = 0;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let beating = false;
  let knownActiveId: string | null = null;

  const applyPresence = (
    presence: PhysicianPresence | undefined,
    seenEpoch: number,
    activeConsult: TelehealthConsultResource | null | undefined,
  ) => {
    if (!presence || seenEpoch !== epoch) return;
    // Two independent signs of "on a call" — the presence's own
    // `activeConsultId` and the consult the same response carried — because
    // either alone is enough and a response that names one but not the other
    // still means the physician is mid-call.
    const onCall = presence.status === 'busy' && (!!presence.activeConsultId || !!activeConsult);
    engaged = (presence.status === 'ready' || onCall) && !presence.stale;
    syncHeartbeat();
  };

  // A match is the one thing a clinician wants to hear about at once: the
  // instant a beat or a presence write comes back naming a consult, the
  // workspace is re-read rather than left to the next tick.
  const noteActive = (active: TelehealthConsultResource | null) => {
    const id = active?.id ?? null;
    if (id === knownActiveId) return;
    knownActiveId = id;
    refreshNow();
  };

  const syncHeartbeat = () => {
    const wanted = engaged && subscribers > 0 && !expired;
    if (wanted && heartbeatTimer === undefined) {
      heartbeatTimer = setInterval(() => void beat(), heartbeatIntervalMs);
      // Never the reason a Node process stays alive: a server-rendered
      // surface that forgot to unsubscribe should exit, not hang on a beat.
      unref(heartbeatTimer);
    } else if (!wanted && heartbeatTimer !== undefined) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  };

  const beat = async (): Promise<void> => {
    // One beat at a time: a slow beat must not stack behind the next tick.
    if (beating || expired) return;
    beating = true;
    const seen = epoch;
    try {
      const res = await call((c) => c.physicians.heartbeat('me'));
      applyPresence(res.presence, seen, res.activeConsult);
      noteActive(res.activeConsult);
    } catch (e) {
      // Expiry was already reported by `call`; anything else is a blip the
      // next beat covers, and the workspace shows `visible: false` if not.
      if (!isExpiry(e)) options.onHeartbeatError?.(e instanceof Error ? e : new Error(String(e)));
    } finally {
      beating = false;
    }
  };

  const setPresence = async (ready: boolean, signal?: AbortSignal): Promise<PresenceResponse> => {
    epoch += 1;
    const seen = epoch;
    const res = await call((c) => c.physicians.presence('me', {ready}, {...(signal ? {signal} : {})}));
    applyPresence(res.presence, seen, res.activeConsult);
    noteActive(res.activeConsult);
    refreshNow();
    return res;
  };

  // --- reads ----------------------------------------------------------------

  // Live subscriptions, so an action the physician just took refreshes the
  // view at once instead of waiting out a poll interval — and refreshes it
  // even while the document is hidden, since someone acting on a page is not
  // a background tab whatever `document.hidden` claims.
  const refreshers = new Set<() => void>();
  const refreshNow = () => refreshers.forEach((r) => r());
  const threadRefreshers = new Map<string, Set<() => void>>();
  const refreshThread = (consultId: string) => threadRefreshers.get(consultId)?.forEach((r) => r());

  const readWorkspace = async (signal?: AbortSignal): Promise<PhysicianWorkspace> => {
    const seen = epoch;
    const ws = await call((c) => c.physicians.workspace('me', {...(signal ? {signal} : {})}));
    applyPresence(ws.physician.presence, seen, ws.telehealth.active);
    knownActiveId = ws.telehealth.active?.id ?? null;
    return ws;
  };

  const readThread = async (consultId: string, signal?: AbortSignal): Promise<ThreadSnapshot> => {
    const [{consult}, messages] = await Promise.all([
      call((c) => c.asyncConsults.get(consultId, {...(signal ? {signal} : {})})),
      readTranscript(consultId, signal),
    ]);
    return {consult, messages};
  };

  // The whole transcript, following `hasMore`. A thread rarely exceeds one
  // page; the cap keeps a runaway one from turning a 2.5 s poll into a crawl.
  const readTranscript = async (consultId: string, signal?: AbortSignal): Promise<MessageResource[]> => {
    const out: MessageResource[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_TRANSCRIPT_PAGES; page++) {
      const res = await call((c) =>
        c.asyncConsults.messages(consultId, {limit: 100, ...(cursor ? {cursor} : {})}, {...(signal ? {signal} : {})}),
      );
      out.push(...res.items);
      if (!res.hasMore || !res.cursor) break;
      cursor = res.cursor;
    }
    return out;
  };

  // The poll engine eases a subscription that has not changed in a while off
  // to a slower cadence — right for a quiet messaging thread, wrong for the
  // workspace: it IS the live queue, and a patient who just joined it must
  // show within the poll interval, not after an idle one. Hidden-tab gating
  // still applies, so a steady cadence costs nothing on a screen nobody is
  // looking at.
  const steady = (watchOptions: WatchOptions): PollTuning => {
    const intervalMs = watchOptions.intervalMs ?? options.intervalMs ?? DEFAULT_TUNING.intervalMs;
    return {...DEFAULT_TUNING, intervalMs, idleIntervalMs: intervalMs};
  };

  const subscribeTo = <T>(
    read: (signal: AbortSignal) => Promise<T>,
    onChange: (value: T | undefined, sync: SyncState) => void,
    watchOptions: WatchOptions,
    registry: Set<() => void>,
    extra: {isFinal?: (value: T) => boolean; tuning?: PollTuning} = {},
  ): Unsubscribe => {
    let mine: (() => void) | undefined;
    const stop = watch<T>(
      {
        read: (signal) => whileValid(signal, () => read(signal)),
        // Compare on content, not identity: a poll that returns the same
        // screen must not re-render the partner's UI.
        same: (a, b) => fingerprint(a) === fingerprint(b),
        ...(extra.isFinal ? {isFinal: extra.isFinal} : {}),
      },
      onChange,
      {
        ...(options.intervalMs !== undefined ? {intervalMs: options.intervalMs} : {}),
        ...watchOptions,
        onReady: ({refresh}) => {
          mine = refresh;
          registry.add(refresh);
          watchOptions.onReady?.({refresh});
        },
      },
      extra.tuning ?? DEFAULT_TUNING,
    );
    return () => {
      if (mine) registry.delete(mine);
      stop();
    };
  };

  // --- the handle -----------------------------------------------------------

  const desk: PhysicianClient = {
    workspace: {
      subscribe: (onChange, watchOptions = {}) => {
        subscribers += 1;
        syncHeartbeat();
        const stop = subscribeTo(readWorkspace, onChange, watchOptions, refreshers, {tuning: steady(watchOptions)});
        let stopped = false;
        return () => {
          // Idempotent, like every unsubscribe: a component that tears down
          // twice must not count the subscription out twice and strand a
          // beat with no subscriber behind it.
          if (stopped) return;
          stopped = true;
          subscribers -= 1;
          syncHeartbeat();
          stop();
        };
      },
      get: (signal) => readWorkspace(signal),
    },

    presence: {
      ready: (signal) => setPresence(true, signal),
      offline: (signal) => setPresence(false, signal),
      heartbeat: async (signal) => {
        const seen = epoch;
        const res = await call((c) => c.physicians.heartbeat('me', {...(signal ? {signal} : {})}));
        applyPresence(res.presence, seen, res.activeConsult);
        noteActive(res.activeConsult);
        return res;
      },
    },

    telehealth: {
      room: async (consultId, signal) => {
        const res = await call((c) => c.telehealth.room(consultId, {...(signal ? {signal} : {})}));
        refreshNow();
        return res;
      },

      end: async (consultId, endOptions = {}, signal) => {
        const res = await call((c) =>
          c.telehealth.end(
            consultId,
            {...(endOptions.goOffline !== undefined ? {goOffline: endOptions.goOffline} : {})},
            {...(signal ? {signal} : {})},
          ),
        );
        // Ending moves presence server-side (back to `ready`, or `offline`
        // with `goOffline`) without returning it; the refresh reads it back
        // and the heartbeat follows what it says.
        epoch += 1;
        noteActive(res.next);
        refreshNow();
        return res;
      },

      ready: async (consultId, present = true, signal) => {
        const res = await call((c) => c.telehealth.ready(consultId, {present}, {...(signal ? {signal} : {})}));
        // A ~10 s beat loop should not re-read the workspace on every beat;
        // only a change of phase is worth showing at once.
        if (res.state.phase !== 'early' && res.state.phase !== 'waiting') refreshNow();
        return res;
      },

      cancel: async (consultId, cancelOptions = {}, signal) => {
        const reason = cancelOptions.reason?.trim();
        const {consult} = await call((c) =>
          c.telehealth.cancel(consultId, {...(reason ? {reason} : {})}, {...(signal ? {signal} : {})}),
        );
        refreshNow();
        return consult;
      },

      agenda: async (range = {}, signal) => {
        const {appointments} = await call((c) => c.physicians.agenda('me', range, {...(signal ? {signal} : {})}));
        return appointments;
      },

      get: async (consultId, signal) => {
        const {consult} = await call((c) => c.telehealth.get(consultId, {...(signal ? {signal} : {})}));
        return consult;
      },
    },

    inbox: {
      claim: async (consultId, signal) => {
        const {consult} = await call((c) => c.asyncConsults.claim(consultId, {}, {...(signal ? {signal} : {})}));
        refreshNow();
        refreshThread(consultId);
        return consult;
      },

      takeover: async (consultId, signal) => {
        const {consult} = await call((c) => c.asyncConsults.takeover(consultId, {}, {...(signal ? {signal} : {})}));
        refreshNow();
        refreshThread(consultId);
        return consult;
      },

      resolve: async (consultId, resolveOptions = {}, signal) => {
        const note = resolveOptions.note?.trim();
        const {consult} = await call((c) =>
          c.asyncConsults.resolve(consultId, {...(note ? {note} : {})}, {...(signal ? {signal} : {})}),
        );
        refreshNow();
        refreshThread(consultId);
        return consult;
      },

      close: async (consultId, closeOptions, signal) => {
        const {consult} = await call((c) => c.asyncConsults.close(consultId, closeOptions, {...(signal ? {signal} : {})}));
        refreshNow();
        refreshThread(consultId);
        return consult;
      },

      escalate: async (consultId, signal) => {
        const res = await call((c) => c.asyncConsults.escalate(consultId, {...(signal ? {signal} : {})}));
        refreshNow();
        refreshThread(consultId);
        return res;
      },

      issueReferral: async (consultId, input, signal) => {
        const {referral} = await call((c) =>
          c.asyncConsults.issueReferral(
            consultId,
            input,
            {...(signal ? {signal} : {})},
          ),
        );
        refreshThread(consultId);
        refreshNow();
        return referral;
      },

      issueReferrals: async (consultId, input, signal) => {
        const response = await call((c) => c.asyncConsults.issueReferral(consultId, input, {...(signal ? {signal} : {})}));
        refreshThread(consultId);
        refreshNow();
        return response;
      },

      suggestedReferrals: async (consultId, signal) => {
        const {consult} = await call((c) => c.asyncConsults.get(consultId, {...(signal ? {signal} : {})}));
        return consult.suggestedReferrals ?? [];
      },

      generateReferrals: async (consultId, input = {}, signal) => {
        const opts = {...(signal ? {signal} : {})};
        const route = `POST /async-consults/${encodeURIComponent(consultId)}/referrals`;
        // `drafts: []` is a selection with nothing in it — never "not given".
        // Falling back would sign and send every suggestion the physician
        // just deselected.
        if (input.drafts !== undefined && input.drafts.length === 0) {
          throw new NatzarApiError({code: 'no_suggested_referrals', status: 409, message: 'No drafts selected; nothing to sign', route});
        }
        // Read fresh even when drafts are given: the status decides whether to
        // claim, and the suggestions must be the ones on the row NOW.
        const {consult} = await call((c) => c.asyncConsults.get(consultId, opts));
        const suggested = input.drafts === undefined;
        const drafts = input.drafts ?? consult.suggestedReferrals ?? [];
        if (!drafts.length) {
          throw new NatzarApiError({
            code: 'no_suggested_referrals',
            status: 409,
            message: 'This consult carries no suggested referrals; pass drafts, or open the composer',
            route,
          });
        }
        // The partner wrote the suggestions' free text (reason, indication…)
        // in the patient's language; print the document's own labels in the
        // same one unless the caller chose. An unknown language is left to
        // the platform's default rather than guessed.
        const lang = input.lang ?? (suggested ? baseLanguageOf(consult.patientLang) : null);
        if (consult.status === 'queued') {
          await call((c) => c.asyncConsults.claim(consultId, {}, opts));
          refreshNow();
        }
        const response = await call((c) =>
          c.asyncConsults.issueReferral(
            consultId,
            {drafts, ...(lang ? {lang} : {})},
            opts,
          ),
        );
        refreshThread(consultId);
        refreshNow();
        return response;
      },

      issuePrescription: async (consultId, input, signal) => {
        const {prescription} = await call((c) => c.asyncConsults.issuePrescription(consultId, input, {...(signal ? {signal} : {})}));
        refreshThread(consultId);
        refreshNow();
        return prescription;
      },

      reply: async (consultId, input, signal) => {
        const text = input.text.trim();
        if (!text) throw new Error('reply() needs text');
        const attachment = input.attachment;
        const {messageId} = await call((c) =>
          c.asyncConsults.postReply(
            consultId,
            {
              // Minted per call, never per attempt: the platform dedupes
              // delivery on it, so the client's retry of a timed-out post
              // collapses into the first — the difference between a reply
              // and the same clinical advice on the record twice.
              idempotencyKey: newIdempotencyKey(),
              text,
              ...(attachment
                ? {attachment: {stagingKey: attachment.stagingKey, fileName: attachment.fileName, mimeType: attachment.mimeType}}
                : {}),
            },
            {...(signal ? {signal} : {})},
          ),
        );
        refreshThread(consultId);
        refreshNow();
        return {messageId};
      },

      thread: (consultId) => ({
        subscribe: (onChange, watchOptions = {}) => {
          let registry = threadRefreshers.get(consultId);
          if (!registry) {
            registry = new Set();
            threadRefreshers.set(consultId, registry);
          }
          const stop = subscribeTo(
            (signal) => readThread(consultId, signal),
            onChange,
            watchOptions,
            registry,
            // A closed thread can never change again on this surface.
            {isFinal: (t) => t.consult.status === 'closed'},
          );
          return () => {
            stop();
            if (registry.size === 0) threadRefreshers.delete(consultId);
          };
        },
        get: (signal) => readThread(consultId, signal),
      }),
    },

    specialties: {
      list: async (signal) => {
        const {specialties} = await call((c) => c.specialties.list({...(signal ? {signal} : {})}));
        return specialties;
      },
      set: async (input, signal) => {
        const {physician} = await call((c) =>
          c.physicians.setSpecialties(
            'me',
            {
              specialties: input.specialties,
              ...(input.acceptsAllSpecialties !== undefined ? {acceptsAllSpecialties: input.acceptsAllSpecialties} : {}),
            },
            {...(signal ? {signal} : {})},
          ),
        );
        refreshNow();
        return physician;
      },
    },

    languages: {
      set: async (input, signal) => {
        const {physician} = await call((c) =>
          c.physicians.setLanguages('me', {languages: input.languages}, {...(signal ? {signal} : {})}),
        );
        refreshNow();
        return physician;
      },
    },

    attachments: {
      upload: async (patient, file, uploadOptions = {}) => {
        const doFetch = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
        if (!doFetch) throw new Error('No fetch implementation available.');
        const mimeType = file.type || 'application/octet-stream';
        const fileName = uploadOptions.fileName ?? file.name ?? 'attachment';
        const signal = uploadOptions.signal;
        const {uploads} = await call((c) =>
          c.attachments.createUploadUrls(
            {
              ...(patient.patientId ? {patientId: patient.patientId} : {}),
              ...(patient.externalPatientId ? {externalPatientId: patient.externalPatientId} : {}),
              files: [{fileName, mimeType, sizeBytes: file.size}],
            },
            {...(signal ? {signal} : {})},
          ),
        );
        const slot = uploads[0];
        if (!slot?.uploadUrl || !slot.stagingKey) {
          throw new NatzarApiError({
            code: 'internal_error',
            status: 500,
            message: 'The platform returned no upload slot',
            route: 'POST /attachments/upload-urls',
            details: uploads,
          });
        }
        // The presigned PUT binds the content type: the bytes must go up
        // under the type the slot was minted for, or S3 refuses the signature.
        const put = await doFetch(slot.uploadUrl, {
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
            route: 'PUT <upload-url>',
            rawBody: await put.text().catch(() => ''),
          });
        }
        return {stagingKey: slot.stagingKey, fileName, mimeType};
      },
    },

    me: async (signal) => {
      const {physician} = await call((c) => c.physicians.me({...(signal ? {signal} : {})}));
      return physician;
    },

    refresh: (next) => {
      client = build(next, options);
      expired = false;
      // Presence is whatever the platform says now; the first read under the
      // new token re-arms the heartbeat from it.
      epoch += 1;
      const waiting = resumeWaiters;
      resumeWaiters = [];
      // A parked subscription continues its own tick with the new token —
      // that IS the refresh. Only one that was not parked (expiry seen by an
      // action, the poll not yet due) needs a nudge, and nudging both would
      // start a second read chain beside the first.
      if (waiting.length) waiting.forEach((wake) => wake());
      else refreshNow();
      syncHeartbeat();
    },

    get client() {
      return client;
    },
  };

  return desk;
}

// --- the video room ----------------------------------------------------------

/** A physician's room credentials, as `room()` / `ready()` return them. */
export interface PhysicianRoomGrant {
  token: string;
  url: string;
  roomName: string;
  /** Checked against the room's metadata when present (see the contract's `LiveKitGrant`). */
  roomNonce?: string;
}

/** Options for {@link connectPhysicianRoom}. */
export type PhysicianRoomOptions = RoomSessionOptions<PhysicianRoomGrant, RoomSessionState>;

/**
 * Run a physician's LiveKit room by the platform's rules, from the grant
 * `telehealth.room()` (or `telehealth.ready()`) returned:
 *
 * - `ROOM_DELETED`, a network drop, or a room that is not a platform room
 *   (its metadata is not `{"v":1,"n":…}`, or not the grant's `roomNonce`
 *   when it carries one) → pulls again and reconnects. A pull that says the
 *   call is over reports `ended`; this helper NEVER ends the consult — only
 *   your own `telehealth.end()` does.
 * - `DUPLICATE_IDENTITY` (the same physician joined from another window or
 *   the provider embed) → `displaced`: show "in use in another window" with a
 *   "Use here" button that calls `session.resume()`. Never automatic — the
 *   two would displace each other forever.
 * - `PARTICIPANT_REMOVED` → `removed`, with a rejoin button (`resume()`).
 * - never lets LiveKit reconnect on its own: build the `Room` with
 *   {@link roomOptions}, or this throws.
 *
 * Your device controls (mic/camera switches, `ControlBar`, `TrackToggle`)
 * are mounted only while `call.phase === 'live'`; `connecting` and
 * `repulling` render a placeholder. livekit-client queues a device switched
 * on while the room is not connected and publishes it as soon as the next
 * connection's signal is up, before the room check.
 *
 * ```ts
 * const room = new Room(roomOptions());
 * const {livekit} = await desk.telehealth.room(consultId);
 * const session = connectPhysicianRoom({
 *   room,
 *   grant: livekit!,
 *   pull: (signal) => desk.telehealth.room(consultId, signal).then(physicianPullFromRoom),
 *   onState: (s) => setCall(s),
 * });
 * // render the call and its device controls only when call.phase === 'live'
 * ```
 */
export function connectPhysicianRoom(options: PhysicianRoomOptions): RoomSession {
  return startRoomSession<PhysicianRoomGrant>(options, {
    label: 'connectPhysicianRoom',
    usable: (grant): grant is PhysicianRoomGrant =>
      !!grant && typeof grant.token === 'string' && !!grant.token && typeof grant.url === 'string' && !!grant.url,
    verify: (metadata, grant) =>
      typeof grant.roomNonce === 'string' && grant.roomNonce ? roomCarriesNonce(metadata, grant.roomNonce) : parseRoomMetadata(metadata) !== null,
    removed: 'manual',
  });
}

export type PhysicianGrantLike = {token?: string | null; url?: string | null; roomName?: string | null; roomNonce?: string | null};

function toPhysicianGrant(raw: PhysicianGrantLike | null | undefined): PhysicianRoomGrant | undefined {
  if (!raw?.token || !raw.url) return undefined;
  return {
    token: String(raw.token),
    url: String(raw.url),
    roomName: String(raw.roomName ?? ''),
    ...(typeof raw.roomNonce === 'string' && raw.roomNonce ? {roomNonce: raw.roomNonce} : {}),
  };
}

/**
 * Map a `telehealth.room()` answer for {@link connectPhysicianRoom}:
 * `in_progress` with a grant → `live`, without one → `retry`; any other
 * status → `ended` with it (the call is no longer this physician's live call —
 * render from the workspace; nothing is ended on your behalf).
 */
export function physicianPullFromRoom(
  res: {status?: string | null; livekit?: PhysicianGrantLike | null} | null | undefined,
): RoomPull<PhysicianRoomGrant> {
  const status = String(res?.status ?? '');
  if (status === 'in_progress') {
    const grant = toPhysicianGrant(res?.livekit);
    return grant ? {kind: 'live', grant} : {kind: 'retry'};
  }
  return {kind: 'ended', status};
}

/**
 * Map a `telehealth.ready()` answer for {@link connectPhysicianRoom}: a grant
 * → `live`; `in_progress` without one → `retry`; `missed` / `closed` →
 * `ended`; `early` / `waiting` / `connecting` (and anything unknown) →
 * `waiting` — back to the appointment's waiting room and its ~10 s beat.
 */
export function physicianPullFromReady(
  res: {state?: {phase?: string | null; status?: string | null} | null; livekit?: PhysicianGrantLike | null} | null | undefined,
): RoomPull<PhysicianRoomGrant> {
  const grant = toPhysicianGrant(res?.livekit);
  if (grant) return {kind: 'live', grant};
  const phase = String(res?.state?.phase ?? '');
  if (phase === 'in_progress') return {kind: 'retry'};
  if (phase === 'missed') return {kind: 'ended', status: 'missed'};
  if (phase === 'closed') return {kind: 'ended', status: String(res?.state?.status ?? 'completed')};
  return {kind: 'waiting'};
}

// --- helpers -----------------------------------------------------------------

const MAX_TRANSCRIPT_PAGES = 10;

/**
 * Check a session and bind a REST client to it.
 *
 * Throws {@link NatzarSessionError} — the one error both browser surfaces use
 * for "this cannot connect at all" — rather than the server client's plain
 * `Error`, so a partner's `catch` recognises a wiring mistake the same way
 * whichever entry point minted the session.
 */
function build(session: PhysicianSession, options: ConnectOptions): NatzarClient {
  if (!session?.sessionToken) throw new NatzarSessionError('This session has no sessionToken.');
  try {
    assertUsableKey(session.sessionToken, 'sessionToken');
  } catch (e) {
    throw new NatzarSessionError(e instanceof Error ? e.message : String(e));
  }
  const apiUrl = session.apiUrl ?? options.apiUrl;
  if (!apiUrl) {
    // Older deployments minted tokens without the API address. Say so
    // precisely — the alternative is a confusing failure deep inside fetch.
    throw new NatzarSessionError(
      'This session did not include apiUrl, so the browser cannot connect directly. ' +
        'Your Natzar deployment predates self-describing physician sessions — upgrade it, or pass `apiUrl` to connectPhysician().',
    );
  }
  let origin: string;
  try {
    const parsed = new URL(apiUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error(parsed.protocol);
    origin = parsed.origin;
  } catch {
    throw new NatzarSessionError(`apiUrl must be an absolute http(s) URL through /v1; got "${apiUrl}".`);
  }
  return new NatzarClient({
    sessionToken: session.sessionToken,
    baseUrl: apiUrl,
    // The REST client never uses the embed origin; it is named only so
    // endpoint resolution is fully explicit and cannot consult a built-in
    // table for a zone this deployment may not be in.
    embedOrigin: origin,
    ...(options.fetch ? {fetch: options.fetch} : {}),
    ...(options.timeoutMs !== undefined ? {timeoutMs: options.timeoutMs} : {}),
    ...(options.headers ? {headers: options.headers} : {}),
  });
}

// Fields that change on every read without anything having happened: the
// snapshot clock, the wait counters derived from it, heartbeat stamps, and
// URLs presigned per read. Comparing snapshots WITHOUT them is what lets a
// 2.5 s poll leave a partner's UI alone until something actually changed.
// Everything else — a new field included — counts, which is the right default
// for a contract that only ever grows.
const VOLATILE = new Set(['generatedAt', 'waitedSeconds', 'lastSeenAt', 'practitionerLastSeenAt', 'recordingUrl', 'url', 'expiresAt']);
const fingerprint = (value: unknown): string =>
  JSON.stringify(value, (key, v: unknown) => (VOLATILE.has(key) ? undefined : v));

// Never the reason a process stays alive. Node timers carry `unref`; browser
// timers are numbers and need nothing.
const unref = (timer: unknown) => {
  (timer as {unref?: () => void} | null)?.unref?.();
};

// `crypto.randomUUID` is on every supported runtime (Node 18+, all modern
// browsers); the fallback covers an insecure-context page, where the
// requirement is only uniqueness per submission, not unguessability.
const newIdempotencyKey = (): string => {
  const c = (globalThis as {crypto?: {randomUUID?: () => string}}).crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
};
