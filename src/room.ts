// Keeping a LiveKit room connected across a room RETIREMENT — the one piece of
// call plumbing a partner cannot work out from the routes alone.
//
// The platform's video rooms are single-use. When one has to go (a clinician's
// access was revoked mid-call, or the room was replaced), the platform deletes
// it: everyone inside is disconnected with LiveKit's `ROOM_DELETED` reason. On
// a server that does not create rooms on join, every token naming it is
// refused from then on; on one that does (LiveKit Cloud is not yet verified
// either way), an old token can recreate the room EMPTY — which is why nothing
// here reconnects with an old token, and why the patient checks the nonce.
// The consult itself carries on in a NEW room, which the next pull of the same
// route hands out. So:
//
// * A disconnect is not the end of the call. Only the consult's status is.
//   `ROOM_DELETED` (and any drop you did not cause) means "pull again and
//   reconnect".
// * `DUPLICATE_IDENTITY` is the exception: the same patient (or physician) is
//   in the call from another device or window. Re-joining automatically would
//   displace that one, which would re-join and displace this one, forever. It
//   waits for a person to press "resume".
// * LiveKit's own automatic reconnection is OFF. It replays the old token into
//   the old room name, which on a server that creates rooms on join recreates
//   an empty retired room. The next pull is the reconnection.
// * The PATIENT publishes nothing until the room proves it is the consult's
//   current room: its metadata must carry the grant's `roomNonce`. A room that
//   does not (retired, or recreated empty by a stale token) gets a disconnect
//   and a fresh pull, never the patient's camera and microphone.
// * NO DEVICE CONTROL OUTSIDE `live`. livekit-client queues a
//   `setMicrophoneEnabled` / `setCameraEnabled` / `setScreenShareEnabled` /
//   `publishTrack` asked for while the room is not connected, and sends it the
//   moment the next connection's signal is up — BEFORE `connect()` resolves,
//   so before the room check. Anything that can turn a device on (LiveKit's
//   `VideoConference`, `ControlBar`, `TrackToggle`, or your own mute/camera
//   button) is mounted only while the session's phase is `live`; `connecting`
//   and `repulling` render a placeholder. The helper cannot enforce this.
//
// This module never imports `livekit-client`. The helpers take a `Room` YOU
// construct (with `roomOptions()`), typed structurally, so a consumer that
// does not use video pulls in nothing, and the peer dependency stays optional.

import {isNatzarApiError} from './errors';

/**
 * The LiveKit `DisconnectReason` values the helpers branch on — the same
 * numbers `livekit-client` 2.x reports on `RoomEvent.Disconnected`.
 */
export const DISCONNECT_REASON = Object.freeze({
  /** This client disconnected itself (a hang-up, or `room.disconnect()`). */
  CLIENT_INITIATED: 1,
  /** The same identity joined from another device, tab or window. */
  DUPLICATE_IDENTITY: 2,
  /** The server removed this participant. */
  PARTICIPANT_REMOVED: 4,
  /** The room was deleted — retired by the platform. Pull again. */
  ROOM_DELETED: 5,
} as const);

/** The part of LiveKit's `ReconnectContext` a policy is handed. */
export interface ReconnectContextLike {
  readonly retryCount: number;
  readonly elapsedMs: number;
}

/** LiveKit's `ReconnectPolicy`, structurally. */
export interface ReconnectPolicyLike {
  nextRetryDelayInMs(context: ReconnectContextLike): number | null;
}

/** A reconnect policy that never retries. The only one the helpers accept. */
export const NO_RECONNECT_POLICY: ReconnectPolicyLike = Object.freeze({
  nextRetryDelayInMs: (): number | null => null,
});

/**
 * Options for `new Room(...)` with automatic reconnection off. Anything you
 * pass is kept, except a `reconnectPolicy` of your own, which is replaced:
 *
 * ```ts
 * import {Room} from 'livekit-client';
 * const room = new Room(roomOptions({adaptiveStream: true}));
 * ```
 */
export function roomOptions<T extends object = Record<never, never>>(
  options?: T,
): Omit<T, 'reconnectPolicy'> & {reconnectPolicy: ReconnectPolicyLike} {
  return {...options, reconnectPolicy: NO_RECONNECT_POLICY} as Omit<T, 'reconnectPolicy'> & {reconnectPolicy: ReconnectPolicyLike};
}

/**
 * The slice of a `livekit-client` `Room` the helpers use. A real `Room`
 * satisfies it; so does a test double.
 */
export interface LiveKitRoomLike {
  /** The room's metadata as the server reported it on join. */
  readonly metadata: string | undefined;
  /** The options the room was constructed with. */
  readonly options: {readonly reconnectPolicy: ReconnectPolicyLike};
  readonly localParticipant: {
    setMicrophoneEnabled(enabled: boolean): Promise<unknown>;
    setCameraEnabled(enabled: boolean): Promise<unknown>;
  };
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
  on(event: 'disconnected', listener: (reason?: number) => void): unknown;
  off(event: 'disconnected', listener: (reason?: number) => void): unknown;
}

/** What a pull (`/join`, `/room`, `/ready`, a beat) answered, as the helpers need it. */
export type RoomPull<G> =
  /** The call is on: connect to this grant. */
  | {kind: 'live'; grant: G}
  /** The call is not on for now (back in the queue, or the waiting room): stop, never reconnect. */
  | {kind: 'waiting'}
  /** The call is over; `status` says how. */
  | {kind: 'ended'; status: string}
  /** Live, but no usable grant came back this time: pull again shortly. */
  | {kind: 'retry'};

/** Why the helper is pulling again. */
export type RepullReason =
  | 'room_deleted'
  | 'disconnected'
  | 'removed'
  | 'room_mismatch'
  | 'connect_failed'
  | 'pull_failed'
  | 'grant_pending'
  | 'resume';

/**
 * Where a room session stands. Render from `phase`:
 *
 * - `connecting` — joining `roomName`. Nothing is published yet. Render a
 *   placeholder: no control that can turn on a microphone, camera or screen
 *   share (see {@link RoomSessionOptions.room}).
 * - `live` — in the consult's current room; the helper has published. The
 *   ONLY phase in which the call UI and its device controls are mounted.
 * - `repulling` — the connection went (or the room was not the current one);
 *   the helper is pulling a new grant. Show "Reconnecting…", NOT the end of
 *   the call — a placeholder, with no device control, as for `connecting`.
 * - `waiting` — the pull answered that the call is not on right now (the
 *   patient is back in the queue, or a booked appointment's waiting room).
 *   The session is over; go back to your waiting-room heartbeat, which will
 *   hand you the next grant. Never the rating screen.
 * - `ended` — the consult is over (`status`): the rating or outcome screen.
 * - `displaced` — the same person is in the call elsewhere
 *   (`DUPLICATE_IDENTITY`). Show "open on another device" with a button that
 *   calls `resume()`. Nothing happens until it is pressed.
 * - `removed` — (physician helper only) the server removed this participant.
 *   Show "removed" with a rejoin button that calls `resume()`.
 * - `left` — the room was left from inside your UI (a LiveKit control called
 *   `room.disconnect()`). Treat it as the hang-up. `session.leave()` does not
 *   report this: you already know.
 * - `error` — `refused` (a pull was refused outright, e.g. the session
 *   expired: refresh it, then `resume()`) or `exhausted` (the re-pull budget
 *   ran out: offer a retry that calls `resume()`).
 */
export type RoomSessionState =
  | {phase: 'connecting'; roomName: string}
  | {phase: 'live'; roomName: string}
  | {phase: 'repulling'; reason: RepullReason; attempt: number}
  | {phase: 'waiting'}
  | {phase: 'ended'; status: string}
  | {phase: 'displaced'}
  | {phase: 'removed'}
  | {phase: 'left'}
  | {phase: 'error'; reason: 'refused' | 'exhausted'; error?: unknown};

/** A running room session. */
export interface RoomSession {
  /** The current state (the last one `onState` was given). */
  readonly state: RoomSessionState;
  /**
   * Tear down: stop pulling, detach from the room and disconnect it. Call it
   * on unmount and when the user hangs up. Reports no state (you asked).
   * Once the session has reported `waiting`, `ended` or `left` it is already
   * over and this does nothing — it never disconnects a newer session you
   * started on the same `Room`.
   */
  leave(): Promise<void>;
  /**
   * The manual resume behind a button: from `displaced`, `removed` or
   * `error`, pull a fresh grant and reconnect. A no-op in any other state.
   */
  resume(): void;
}

/** The fields every grant the helpers connect with carries. */
export interface RoomGrantLike {
  token: string;
  url: string;
  roomName?: string;
  roomNonce?: string;
}

/** Options shared by `connectPatientRoom` and `connectPhysicianRoom`. */
export interface RoomSessionOptions<G extends RoomGrantLike, S> {
  /**
   * A `livekit-client` `Room` constructed with {@link roomOptions}. The helper
   * connects it, disconnects it and publishes on it; render it with
   * `<RoomContext.Provider value={room}>` — NOT `<LiveKitRoom audio video>`,
   * which would publish before the room is checked, and NOT
   * `<LiveKitRoom connect={false}>`, which disconnects it.
   *
   * Mount anything that can turn a device on — `VideoConference`,
   * `ControlBar`, `TrackToggle`, your own mute or camera button, any call to
   * `setMicrophoneEnabled` / `setCameraEnabled` / `setScreenShareEnabled` /
   * `publishTrack` — ONLY while `session.state.phase === 'live'`, and render a
   * placeholder in `connecting` and `repulling`. livekit-client queues a
   * device switched on while the room is not connected and publishes it as
   * soon as the next connection's signal is up, before `connect()` resolves
   * and so before the helper's room check: a tap on "unmute" during
   * "Reconnecting…" would otherwise reach a room that fails the check.
   */
  room: LiveKitRoomLike;
  /** The grant to connect with first (from the pull that said `in_progress`). */
  grant: G;
  /**
   * Pull a fresh grant: the same route that produced `grant`, mapped with the
   * matching `…PullFrom…` adapter. Called only after a disconnect, a room
   * check failure or `resume()` — never on a timer.
   */
  pull: (signal: AbortSignal) => Promise<RoomPull<G>>;
  /** Every state change. See {@link RoomSessionState}. */
  onState: (state: S) => void;
  /**
   * What to publish once the room checks out. Both default to true. Turning
   * one off leaves it to your own control, which must follow the `live`-only
   * rule on {@link RoomSessionOptions.room}.
   */
  publish?: {audio?: boolean; video?: boolean};
  /** A device that could not be published (no camera, permission denied). The call goes on. */
  onPublishError?: (kind: 'audio' | 'video', error: unknown) => void;
  /** Consecutive failed re-pulls before `error: exhausted`. @defaultValue 5 */
  maxAttempts?: number;
  /** Delay before each consecutive re-pull; the last repeats. @defaultValue [0, 500, 1000, 2000, 4000] */
  retryDelaysMs?: readonly number[];
}

const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [0, 500, 1000, 2000, 4000];
const DEFAULT_MAX_ATTEMPTS = 5;
// Refusals worth pulling again for: a throttle, a 5xx, and the platform's
// "could not confirm the room right now" 503. Anything else from the API is an
// answer (not yours, session expired, …), and a network failure is transient.
const TRANSIENT_CODES = new Set<string>(['rate_limited', 'internal_error', 'dependency_unavailable']);

/**
 * Parse a platform room's metadata. Our rooms carry `{"v":1,"n":"<nonce>"}`;
 * anything else (none at all, a room created by a join) is not one of ours.
 */
export function parseRoomMetadata(metadata: string | undefined): {v: 1; n: string} | null {
  if (typeof metadata !== 'string' || metadata.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadata);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const {v, n} = parsed as {v?: unknown; n?: unknown};
  if (v !== 1 || typeof n !== 'string' || n.length === 0) return null;
  return {v: 1, n};
}

/** True when the room's metadata carries exactly this (non-empty) nonce. */
export function roomCarriesNonce(metadata: string | undefined, nonce: string | undefined): boolean {
  if (typeof nonce !== 'string' || nonce.length === 0) return false;
  const meta = parseRoomMetadata(metadata);
  return meta !== null && meta.n === nonce;
}

/** Internal: the per-surface rules the shared machine is run with. */
export interface RoomPolicy<G extends RoomGrantLike> {
  /** Used in the refusal message. */
  label: string;
  /** Whether a grant is worth connecting with at all. */
  usable(grant: G | null | undefined): grant is G;
  /** Whether the connected room is the one to publish into. */
  verify(metadata: string | undefined, grant: G): boolean;
  /** `PARTICIPANT_REMOVED`: pull again, or wait for a manual rejoin. */
  removed: 'repull' | 'manual';
}

function reconnectDelay(policy: unknown): unknown {
  if (!policy || typeof (policy as ReconnectPolicyLike).nextRetryDelayInMs !== 'function') return undefined;
  try {
    return (policy as ReconnectPolicyLike).nextRetryDelayInMs({retryCount: 0, elapsedMs: 0});
  } catch {
    return undefined;
  }
}

/**
 * Refuse a room that would reconnect on its own. The room's options are what
 * `new Room(...)` was given; the engine it built from them, when visible, must
 * agree (a policy swapped in after construction never reaches that engine).
 */
function assertNoReconnect(room: LiveKitRoomLike, label: string): void {
  const own = reconnectDelay(room?.options?.reconnectPolicy);
  const engine = (room as unknown as {engine?: {reconnectPolicy?: unknown}} | null)?.engine;
  const engineOk = !engine || typeof engine !== 'object' || !('reconnectPolicy' in engine) || reconnectDelay(engine.reconnectPolicy) === null;
  if (own !== null || !engineOk) {
    throw new TypeError(
      `${label}: construct the Room with roomOptions() — LiveKit's automatic reconnection must be off (a reconnectPolicy that returns null).`,
    );
  }
}

/**
 * End a connect attempt the room is still waiting on although it already
 * reports `disconnected` — the way livekit-client ends one itself.
 *
 * livekit-client 2.x keeps an attempt's promise until that attempt settles,
 * and a `connect()` called meanwhile returns THAT promise: it does not
 * connect again. A server leave (`ROOM_DELETED`) that lands after the
 * signal join but before the peer connection is up disconnects the room at
 * once, yet leaves the attempt waiting for a peer connection that can no
 * longer come, until its own `peerConnectionTimeout` (15 s) ends it; and
 * `disconnect()` is a no-op on a disconnected room. What `disconnect()` does
 * to an attempt while the room is still `connecting` is abort the attempt's
 * `abortController`; this does the same, which makes the attempt reject at
 * once through livekit-client's own clean-up path (engine recreated, pending
 * promise cleared, no second disconnect event).
 *
 * Only for a room that reports `disconnected` (a room still `connecting` is
 * `disconnect()`'s to cancel), and only when that controller is visible:
 * otherwise the helper waits for the attempt to end on its own (see
 * `connect` below), which is correct, only slower.
 */
function abortStaleConnectAttempt(room: LiveKitRoomLike): void {
  const internals = room as unknown as {state?: unknown; abortController?: {abort?: unknown}};
  if (typeof internals.state === 'string' && internals.state !== 'disconnected') return;
  const pending = internals.abortController;
  if (!pending || typeof pending.abort !== 'function') return;
  try {
    (pending.abort as (reason?: unknown) => void).call(pending, 'natzar-client: the room was disconnected during this connect');
  } catch {
    // Already settled; the wait below still holds.
  }
}

function isTransient(e: unknown): boolean {
  if (isNatzarApiError(e)) return TRANSIENT_CODES.has(e.code);
  if (e && typeof e === 'object' && (e as {name?: unknown}).name === 'NatzarSessionError') return false;
  return true;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, {once: true});
  });
}

const RESUMABLE = new Set<RoomSessionState['phase']>(['displaced', 'removed', 'error']);
const SETTLED = new Set<RoomSessionState['phase']>(['waiting', 'ended', 'left', 'displaced', 'removed', 'error']);

/** Internal: the machine both helpers run. */
export function startRoomSession<G extends RoomGrantLike>(
  options: RoomSessionOptions<G, RoomSessionState>,
  policy: RoomPolicy<G>,
): RoomSession {
  const {room, pull, onState} = options ?? ({} as RoomSessionOptions<G, RoomSessionState>);
  if (!room || typeof room.connect !== 'function' || typeof room.on !== 'function') {
    throw new TypeError(`${policy.label}: \`room\` must be a livekit-client Room.`);
  }
  if (typeof pull !== 'function' || typeof onState !== 'function') {
    throw new TypeError(`${policy.label}: \`pull\` and \`onState\` are required.`);
  }
  assertNoReconnect(room, policy.label);

  const publishAudio = options.publish?.audio !== false;
  const publishVideo = options.publish?.video !== false;
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const delays = options.retryDelaysMs && options.retryDelaysMs.length > 0 ? options.retryDelaysMs : DEFAULT_RETRY_DELAYS_MS;
  const controller = new AbortController();

  let state: RoomSessionState = {phase: 'connecting', roomName: options.grant?.roomName ?? ''};
  // Bumped by every transition that supersedes in-flight work: a connect or a
  // re-pull that finds it changed after an await stops there, so a disconnect
  // racing a connect can never be followed by a publish.
  let generation = 0;
  let attempts = 0;
  let closed = false;
  // True only while the helper itself is disconnecting the room (a failed room
  // check). livekit-client reports that disconnect before `disconnect()`
  // resolves, so the flag covers exactly the helper's own event.
  let ownDisconnect = false;
  // The helper's own `room.connect()` still in flight, as a promise that
  // settles (never rejects) with it; null once it has. A new `room.connect()`
  // is never started on top of it (livekit-client would hand back the old
  // attempt's promise instead of connecting).
  let inFlight: Promise<void> | null = null;

  const emit = (next: RoomSessionState) => {
    state = next;
    try {
      onState(next);
    } catch {
      // A throwing callback must not wedge the machine.
    }
  };

  const onDisconnected = (reason?: number) => {
    if (closed || ownDisconnect || SETTLED.has(state.phase)) return;
    generation++;
    // Dropped while its connect is still pending (a room retired mid-join):
    // end that attempt now rather than at livekit-client's 15 s timeout, so
    // the next connect can start as soon as the re-pull answers.
    if (inFlight) abortStaleConnectAttempt(room);
    if (reason === DISCONNECT_REASON.CLIENT_INITIATED) {
      settle({phase: 'left'});
      return;
    }
    if (reason === DISCONNECT_REASON.DUPLICATE_IDENTITY) {
      emit({phase: 'displaced'});
      return;
    }
    if (reason === DISCONNECT_REASON.PARTICIPANT_REMOVED && policy.removed === 'manual') {
      emit({phase: 'removed'});
      return;
    }
    void repull(
      reason === DISCONNECT_REASON.ROOM_DELETED
        ? 'room_deleted'
        : reason === DISCONNECT_REASON.PARTICIPANT_REMOVED
          ? 'removed'
          : 'disconnected',
    );
  };

  // The session is over for good: stop listening. `waiting` / `ended` / `left`
  // hand control back to the caller's own flow, which may start a new session
  // on the same Room — so this one is closed too: a later `leave()` or
  // `resume()` on it is a no-op and can never disconnect the new session's
  // connection. The room is already disconnected whenever this runs (every
  // path here follows a disconnect or a failed connect).
  const settle = (next: RoomSessionState) => {
    closed = true;
    generation++;
    controller.abort();
    room.off('disconnected', onDisconnected);
    emit(next);
  };

  const disconnectQuietly = async () => {
    ownDisconnect = true;
    try {
      await room.disconnect();
    } catch {
      // Already gone.
    } finally {
      ownDisconnect = false;
    }
  };

  // Each device is checked against the generation immediately before its
  // call — no await in between — so nothing is published once a disconnect
  // (or `leave()`) has superseded this connection.
  const publishOne = async (kind: 'audio' | 'video', gen: number) => {
    if (gen !== generation || closed) return;
    try {
      if (kind === 'audio') await room.localParticipant.setMicrophoneEnabled(true);
      else await room.localParticipant.setCameraEnabled(true);
    } catch (e) {
      try {
        options.onPublishError?.(kind, e);
      } catch {
        // Reporting only.
      }
    }
  };

  const connect = async (grant: G): Promise<void> => {
    if (closed) return;
    const gen = ++generation;
    if (!policy.usable(grant)) {
      void repull('grant_pending');
      return;
    }
    emit({phase: 'connecting', roomName: grant.roomName ?? ''});
    // Never connect on top of the previous attempt: wait until it has ended
    // (at once when `onDisconnected` aborted it; else when livekit-client
    // ends it).
    while (inFlight) {
      await inFlight;
      if (gen !== generation || closed) return;
    }
    let attempt: Promise<void>;
    try {
      attempt = Promise.resolve(room.connect(grant.url, grant.token));
    } catch (e) {
      attempt = Promise.reject(e);
    }
    const settled = attempt.then(
      () => undefined,
      () => undefined,
    );
    inFlight = settled;
    void settled.then(() => {
      if (inFlight === settled) inFlight = null;
    });
    try {
      await attempt;
    } catch {
      if (gen !== generation || closed) return;
      void repull('connect_failed');
      return;
    }
    if (gen !== generation || closed) return;
    if (!policy.verify(room.metadata, grant)) {
      await disconnectQuietly();
      if (gen !== generation || closed) return;
      void repull('room_mismatch');
      return;
    }
    attempts = 0;
    emit({phase: 'live', roomName: grant.roomName ?? ''});
    if (publishAudio) await publishOne('audio', gen);
    if (publishVideo) await publishOne('video', gen);
  };

  const repull = async (reason: RepullReason): Promise<void> => {
    if (closed) return;
    const gen = ++generation;
    if (attempts >= maxAttempts) {
      emit({phase: 'error', reason: 'exhausted'});
      return;
    }
    const delay = delays[Math.min(attempts, delays.length - 1)] ?? 0;
    attempts++;
    emit({phase: 'repulling', reason, attempt: attempts});
    try {
      await sleep(delay, controller.signal);
    } catch {
      return;
    }
    if (gen !== generation || closed) return;
    let pulled: RoomPull<G>;
    try {
      pulled = await pull(controller.signal);
    } catch (e) {
      if (gen !== generation || closed) return;
      if (!isTransient(e)) {
        emit({phase: 'error', reason: 'refused', error: e});
        return;
      }
      void repull('pull_failed');
      return;
    }
    if (gen !== generation || closed) return;
    switch (pulled?.kind) {
      case 'live':
        await connect(pulled.grant);
        return;
      case 'waiting':
        settle({phase: 'waiting'});
        return;
      case 'ended':
        settle({phase: 'ended', status: String(pulled.status ?? '')});
        return;
      default:
        void repull('grant_pending');
    }
  };

  room.on('disconnected', onDisconnected);
  // Deferred a microtask — the first state included — so a `leave()` in the
  // same tick (React StrictMode's mount → unmount → mount) cancels the first
  // session before it connects, and `onState` never runs inside the caller's
  // own effect body.
  void Promise.resolve().then(() => connect(options.grant));

  return {
    get state() {
      return state;
    },
    async leave() {
      if (closed) return;
      closed = true;
      generation++;
      controller.abort();
      room.off('disconnected', onDisconnected);
      state = {phase: 'left'};
      await disconnectQuietly();
    },
    resume() {
      if (closed || !RESUMABLE.has(state.phase)) return;
      attempts = 0;
      void repull('resume');
    },
  };
}
