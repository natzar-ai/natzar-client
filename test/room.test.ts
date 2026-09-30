import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  DISCONNECT_REASON,
  NO_RECONNECT_POLICY,
  connectPatientRoom,
  patientPullFromAppointmentBeat,
  patientPullFromJoin,
  roomOptions,
} from '../dist/esm/patient/index.js';
import type {LiveKitGrant, PatientRoomState, ReconnectPolicyLike, RoomPull} from '../dist/esm/patient/index.js';
import {connectPhysicianRoom, physicianPullFromReady, physicianPullFromRoom} from '../dist/esm/physician/index.js';
import type {PhysicianRoomGrant, RoomSessionState} from '../dist/esm/physician/index.js';
import {NatzarApiError} from '../dist/esm/errors.js';

// The room helpers keep a LiveKit room connected across a room RETIREMENT
// (the platform deletes the room; the consult carries on in a new one). They
// run against a structural `Room`, so a scripted double stands in for
// livekit-client here: every connect, disconnect and publish is logged with
// the token of the connection it happened on, which is what lets a test say
// "nothing was ever published into THAT room".

const here = dirname(fileURLToPath(import.meta.url));
const meta = (n: string) => JSON.stringify({v: 1, n});

type Listener = (reason?: number) => void;
type Script = {metadata?: string; fail?: boolean; during?: (room: FakeRoom) => void};

class FakeRoom {
  metadata: string | undefined;
  // Typed as the helpers expect; the negative cases below force other policies in.
  options: {reconnectPolicy: ReconnectPolicyLike} = {reconnectPolicy: NO_RECONNECT_POLICY};
  readonly log: string[] = [];
  readonly listeners = new Set<Listener>();
  /** What each token's room looks like on connect. */
  readonly rooms: Record<string, Script> = {};
  private current: string | null = null;
  readonly localParticipant = {
    setMicrophoneEnabled: async (on: boolean) => {
      this.log.push(`mic:${on}:${this.current}`);
    },
    setCameraEnabled: async (on: boolean) => {
      if (this.rooms[this.current ?? '']?.fail === undefined && this.cameraFails) throw new Error('no camera');
      this.log.push(`cam:${on}:${this.current}`);
    },
  };
  cameraFails = false;

  async connect(_url: string, token: string): Promise<void> {
    this.log.push(`connect:${token}`);
    const script = this.rooms[token] ?? {};
    await Promise.resolve();
    script.during?.(this);
    if (script.fail) throw new Error('could not establish signal connection: room does not exist');
    this.current = token;
    this.metadata = script.metadata;
  }

  async disconnect(): Promise<void> {
    if (this.current === null) return;
    this.log.push(`disconnect:${this.current}`);
    this.current = null;
    // livekit-client reports its own disconnect before the promise resolves.
    this.emit(DISCONNECT_REASON.CLIENT_INITIATED);
  }

  /** The server (or another device) ended this connection. */
  drop(reason?: number) {
    this.log.push(`drop:${String(reason)}:${this.current}`);
    this.current = null;
    this.emit(reason);
  }

  on(_event: 'disconnected', listener: Listener) {
    this.listeners.add(listener);
    return this;
  }

  off(_event: 'disconnected', listener: Listener) {
    this.listeners.delete(listener);
    return this;
  }

  private emit(reason?: number) {
    for (const l of [...this.listeners]) l(reason);
  }

  published(): string[] {
    return this.log.filter((l) => l.startsWith('mic:') || l.startsWith('cam:'));
  }

  connects(): string[] {
    return this.log.filter((l) => l.startsWith('connect:'));
  }
}

type Lk222Script = {metadata?: string; leaveBeforePc?: number};

/**
 * livekit-client 2.22's connect bookkeeping, as the helpers meet it
 * (`Room.connect` / `Room.disconnect`, `RTCEngine`'s leave handling,
 * `PCTransportManager.ensureTransportConnected`):
 *
 * - `connect()` while an attempt is pending returns THAT attempt's promise
 *   (its `connectFuture`); it does not connect again;
 * - a server leave after the signal join, before the peer connection is up:
 *   the room reports `disconnected` and emits the reason at once, but the
 *   attempt keeps waiting for a peer connection until its
 *   `peerConnectionTimeout` (15 s) or an abort of the room's
 *   `abortController`, then rejects — with no second disconnect event;
 * - `disconnect()` on a room that reports `disconnected` does nothing; while
 *   `connecting` it aborts the attempt.
 */
class Lk222Room {
  state: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
  metadata: string | undefined;
  options: {reconnectPolicy: ReconnectPolicyLike} = {reconnectPolicy: NO_RECONNECT_POLICY};
  readonly log: string[] = [];
  readonly listeners = new Set<Listener>();
  readonly rooms: Record<string, Lk222Script> = {};
  peerConnectionTimeoutMs = 15_000;
  /** false: the attempt's controller is not visible on the room (another build, a wrapper). */
  exposeAbortController = true;
  private controller: AbortController | undefined;
  private connectFuture: Promise<void> | undefined;
  private current: string | null = null;
  readonly localParticipant = {
    setMicrophoneEnabled: async (on: boolean) => {
      this.log.push(`mic:${on}:${this.current}`);
    },
    setCameraEnabled: async (on: boolean) => {
      this.log.push(`cam:${on}:${this.current}`);
    },
  };

  get abortController(): AbortController | undefined {
    return this.exposeAbortController ? this.controller : undefined;
  }

  connect(_url: string, token: string): Promise<void> {
    this.log.push(`connect:${token}`);
    if (this.state === 'connected') return Promise.resolve();
    if (this.connectFuture) {
      this.log.push(`handed-pending-attempt:${token}`);
      return this.connectFuture;
    }
    this.state = 'connecting';
    const controller = new AbortController();
    this.controller = controller;
    this.connectFuture = this.attempt(token, this.rooms[token] ?? {}, controller).finally(() => {
      this.connectFuture = undefined;
    });
    return this.connectFuture;
  }

  private async attempt(token: string, script: Lk222Script, controller: AbortController): Promise<void> {
    await Promise.resolve(); // the signal join
    if (controller.signal.aborted) throw new Error('Connection attempt aborted');
    this.metadata = script.metadata;
    const leave = script.leaveBeforePc;
    if (leave !== undefined) {
      // The server's leave lands while the attempt waits for its peer connection.
      setTimeout(() => this.serverLeave(leave), 5);
      await new Promise<void>((_, reject) => {
        const timer = setTimeout(() => {
          this.log.push(`attempt-timed-out:${token}`);
          reject(new Error('could not establish pc connection'));
        }, this.peerConnectionTimeoutMs);
        controller.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            this.log.push(`attempt-cancelled:${token}`);
            reject(new Error('room connection has been cancelled'));
          },
          {once: true},
        );
      });
    }
    this.state = 'connected';
    this.current = token;
    this.controller = undefined;
  }

  private serverLeave(reason: number) {
    this.log.push(`leave:${reason}`);
    this.state = 'disconnected';
    this.current = null;
    for (const l of [...this.listeners]) l(reason);
  }

  async disconnect(): Promise<void> {
    if (this.state === 'disconnected') return;
    if (this.state === 'connecting') this.controller?.abort();
    this.log.push(`disconnect:${this.current}`);
    this.state = 'disconnected';
    this.current = null;
    for (const l of [...this.listeners]) l(DISCONNECT_REASON.CLIENT_INITIATED);
  }

  on(_event: 'disconnected', listener: Listener) {
    this.listeners.add(listener);
    return this;
  }

  off(_event: 'disconnected', listener: Listener) {
    this.listeners.delete(listener);
    return this;
  }

  published(): string[] {
    return this.log.filter((l) => l.startsWith('mic:') || l.startsWith('cam:'));
  }

  connects(): string[] {
    return this.log.filter((l) => l.startsWith('connect:'));
  }

  /** Every `connect()` that livekit-client would have answered with an older attempt's promise. */
  handedPending(): string[] {
    return this.log.filter((l) => l.startsWith('handed-pending-attempt:'));
  }
}

const settle = (ms = 25) => new Promise((r) => setTimeout(r, ms));
/** Poll until `pred` holds or `ms` pass; true when it held. */
async function until(pred: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) return false;
    await settle(5);
  }
  return true;
}
const grant = (token: string, roomNonce = `n-${token}`): LiveKitGrant => ({token, url: 'wss://lk.test', roomName: `room-${token}`, roomNonce});

/** A pull that answers from a list, then repeats the last answer. Counts calls. */
function pulls<G>(...answers: Array<RoomPull<G> | Error>) {
  const state = {count: 0};
  const pull = async (): Promise<RoomPull<G>> => {
    const answer = answers[Math.min(state.count, answers.length - 1)];
    state.count++;
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return {pull, state};
}

function patient(room: FakeRoom | Lk222Room, first: LiveKitGrant, pull: () => Promise<RoomPull<LiveKitGrant>>, extra: Record<string, unknown> = {}) {
  const states: PatientRoomState[] = [];
  const session = connectPatientRoom({
    room,
    grant: first,
    pull,
    onState: (s) => states.push(s),
    retryDelaysMs: [0],
    ...extra,
  });
  return {session, states, phases: () => states.map((s) => s.phase)};
}

// --- negative first -------------------------------------------------------

describe('connectPatientRoom — never reconnects on its own', () => {
  it('refuses a Room whose reconnect policy retries, before connecting anything', () => {
    for (const policy of [{nextRetryDelayInMs: () => 1000}, undefined, {}, {nextRetryDelayInMs: () => 0}]) {
      const room = new FakeRoom();
      room.options = {reconnectPolicy: policy as unknown as ReconnectPolicyLike};
      assert.throws(
        () => connectPatientRoom({room, grant: grant('t1'), pull: async () => ({kind: 'waiting'}), onState: () => {}}),
        (e: Error) => e instanceof TypeError && /roomOptions\(\)/.test(e.message),
      );
      assert.deepEqual(room.log, []);
      assert.equal(room.listeners.size, 0);
    }
  });

  it('refuses a Room whose engine was built with a retrying policy (a policy swapped in after construction)', () => {
    const room = new FakeRoom() as FakeRoom & {engine?: unknown};
    room.engine = {reconnectPolicy: {nextRetryDelayInMs: () => 500}};
    assert.throws(() => connectPatientRoom({room, grant: grant('t1'), pull: async () => ({kind: 'waiting'}), onState: () => {}}), TypeError);
    assert.deepEqual(room.log, []);
  });

  it('DUPLICATE_IDENTITY → displaced, and nothing more until resume() — no ping-pong', async () => {
    const room = new FakeRoom();
    room.rooms.t1 = {metadata: meta('n-t1')};
    room.rooms.t2 = {metadata: meta('n-t2')};
    const {pull, state} = pulls<LiveKitGrant>({kind: 'live', grant: grant('t2')});
    const {session, phases} = patient(room, grant('t1'), pull);
    await settle();
    room.drop(DISCONNECT_REASON.DUPLICATE_IDENTITY);
    await settle(60);
    assert.equal(session.state.phase, 'displaced');
    assert.equal(state.count, 0, 'no automatic re-pull');
    assert.deepEqual(room.connects(), ['connect:t1'], 'no automatic reconnect');
    assert.deepEqual(phases(), ['connecting', 'live', 'displaced']);

    session.resume();
    await settle();
    assert.equal(state.count, 1);
    assert.deepEqual(room.connects(), ['connect:t1', 'connect:t2']);
    assert.equal(session.state.phase, 'live');
  });

  it('a hang-up from inside the UI (CLIENT_INITIATED) → left, never a re-pull', async () => {
    const room = new FakeRoom();
    room.rooms.t1 = {metadata: meta('n-t1')};
    const {pull, state} = pulls<LiveKitGrant>({kind: 'live', grant: grant('t2')});
    const {session} = patient(room, grant('t1'), pull);
    await settle();
    await room.disconnect(); // a LiveKit control, not session.leave()
    await settle();
    assert.equal(session.state.phase, 'left');
    assert.equal(state.count, 0);
    assert.deepEqual(room.connects(), ['connect:t1']);
  });

  it('ROOM_DELETED with the consult back in the queue → waiting: never the rating screen, never a reconnect', async () => {
    const room = new FakeRoom();
    room.rooms.t1 = {metadata: meta('n-t1')};
    const {pull, state} = pulls<LiveKitGrant>({kind: 'waiting'});
    const {session, phases} = patient(room, grant('t1'), pull);
    await settle();
    room.drop(DISCONNECT_REASON.ROOM_DELETED);
    await settle();
    assert.equal(session.state.phase, 'waiting');
    assert.ok(!phases().includes('ended'));
    assert.equal(state.count, 1);
    assert.deepEqual(room.connects(), ['connect:t1']);
    assert.equal(room.listeners.size, 0, 'a settled session stops listening, so a new one can take the Room');
  });
});

describe('connectPatientRoom — never publishes outside the consult’s current room (I7)', () => {
  it('connects with nothing published, and publishes nothing when the nonce does not match', async () => {
    const room = new FakeRoom();
    room.rooms.t1 = {metadata: meta('someone-elses-nonce')};
    room.rooms.t2 = {metadata: meta('n-t2')};
    const {pull, state} = pulls<LiveKitGrant>({kind: 'live', grant: grant('t2')});
    const {phases} = patient(room, grant('t1'), pull);
    await settle();
    assert.equal(room.published().filter((p) => p.endsWith(':t1')).length, 0, 'nothing ever published into t1');
    assert.deepEqual(room.log.slice(0, 2), ['connect:t1', 'disconnect:t1']);
    assert.equal(state.count, 1, 'a mismatch is a re-pull');
    assert.deepEqual(room.published(), ['mic:true:t2', 'cam:true:t2']);
    assert.deepEqual(phases(), ['connecting', 'repulling', 'connecting', 'live']);
  });

  it('publishes nothing into a room with no platform metadata (a room recreated by a stale token)', async () => {
    for (const metadata of [undefined, '', 'not json', '[]', '{"v":2,"n":"n-t1"}', '{"v":1}', '{"v":1,"n":""}', '{"n":"n-t1"}']) {
      const room = new FakeRoom();
      room.rooms.t1 = {metadata};
      const {pull, state} = pulls<LiveKitGrant>({kind: 'ended', status: 'completed'});
      patient(room, grant('t1'), pull);
      await settle();
      assert.deepEqual(room.published(), [], `metadata ${String(metadata)}`);
      assert.equal(state.count, 1);
    }
  });

  it('never connects with a grant that carries no nonce', async () => {
    const room = new FakeRoom();
    room.rooms.t1 = {metadata: meta('')};
    room.rooms.t2 = {metadata: meta('n-t2')};
    const {pull, state} = pulls<LiveKitGrant>({kind: 'live', grant: grant('t2')});
    patient(room, grant('t1', ''), pull);
    await settle();
    assert.deepEqual(room.connects(), ['connect:t2']);
    assert.equal(state.count, 1);
    assert.deepEqual(room.published(), ['mic:true:t2', 'cam:true:t2']);
  });

  it('a drop racing the room check is never followed by a publish on that connection', async () => {
    const room = new FakeRoom();
    // The room is deleted while the join is still completing.
    room.rooms.t1 = {metadata: meta('n-t1'), during: (r) => r.drop(DISCONNECT_REASON.ROOM_DELETED)};
    room.rooms.t2 = {metadata: meta('n-t2')};
    const {pull, state} = pulls<LiveKitGrant>({kind: 'live', grant: grant('t2')});
    const {session} = patient(room, grant('t1'), pull);
    await settle();
    assert.equal(room.published().filter((p) => p.endsWith(':t1')).length, 0);
    assert.equal(state.count, 1, 'exactly one re-pull for one drop');
    assert.equal(session.state.phase, 'live');
    assert.deepEqual(room.published(), ['mic:true:t2', 'cam:true:t2']);
  });

  it('bounds re-pulls: a room that never checks out ends in error, having published nothing', async () => {
    const room = new FakeRoom();
    room.rooms.t1 = {metadata: meta('wrong')};
    room.rooms.t2 = {metadata: meta('still-wrong')};
    const {pull, state} = pulls<LiveKitGrant>({kind: 'live', grant: grant('t2')});
    const {session} = patient(room, grant('t1'), pull, {maxAttempts: 3});
    await settle(60);
    assert.deepEqual(session.state, {phase: 'error', reason: 'exhausted'});
    assert.equal(state.count, 3);
    assert.deepEqual(room.published(), []);
  });

  it('a refused pull (not transient) stops at once; a 503 is pulled through', async () => {
    const room = new FakeRoom();
    room.rooms.t1 = {fail: true};
    const refused = new NatzarApiError({code: 'not_found', status: 404, message: 'gone', route: 'POST /x'});
    const a = pulls<LiveKitGrant>(refused, {kind: 'live', grant: grant('t2')});
    const one = patient(room, grant('t1'), a.pull);
    await settle();
    assert.equal(one.session.state.phase, 'error');
    assert.equal((one.session.state as {reason?: string}).reason, 'refused');
    assert.equal(a.state.count, 1);

    const room2 = new FakeRoom();
    room2.rooms.t1 = {fail: true};
    room2.rooms.t2 = {metadata: meta('n-t2')};
    const busy = new NatzarApiError({code: 'dependency_unavailable', status: 503, message: 'retry', route: 'POST /x'});
    const b = pulls<LiveKitGrant>(busy, new TypeError('fetch failed'), {kind: 'live', grant: grant('t2')});
    const two = patient(room2, grant('t1'), b.pull);
    await settle(60);
    assert.equal(b.state.count, 3);
    assert.equal(two.session.state.phase, 'live');
  });

  it('leave() tears down silently: no state, no later pull, no later connect', async () => {
    const room = new FakeRoom();
    room.rooms.t1 = {metadata: meta('n-t1')};
    let release: (v: RoomPull<LiveKitGrant>) => void = () => {};
    let pullsMade = 0;
    const pull = () => {
      pullsMade++;
      return new Promise<RoomPull<LiveKitGrant>>((r) => (release = r));
    };
    const {session, states} = patient(room, grant('t1'), pull);
    await settle();
    room.drop(DISCONNECT_REASON.ROOM_DELETED);
    await settle();
    assert.equal(pullsMade, 1);
    const seen = states.length;
    await session.leave();
    release({kind: 'live', grant: grant('t2')});
    await settle();
    assert.equal(states.length, seen, 'leave() reports nothing');
    assert.deepEqual(room.connects(), ['connect:t1']);
    assert.equal(room.listeners.size, 0);
  });

  it('a settled session (waiting / ended / left) never disconnects a newer session on the same Room', async () => {
    const ends: Array<[string, (room: FakeRoom) => Promise<void>, RoomPull<LiveKitGrant>]> = [
      ['waiting', async (r) => r.drop(DISCONNECT_REASON.ROOM_DELETED), {kind: 'waiting'}],
      ['ended', async (r) => r.drop(DISCONNECT_REASON.ROOM_DELETED), {kind: 'ended', status: 'completed'}],
      ['left', (r) => r.disconnect(), {kind: 'waiting'}],
    ];
    for (const [phase, end, answer] of ends) {
      const room = new FakeRoom();
      room.rooms.t1 = {metadata: meta('n-t1')};
      room.rooms.t2 = {metadata: meta('n-t2')};
      const a = patient(room, grant('t1'), pulls<LiveKitGrant>(answer).pull);
      await settle();
      await end(room);
      await settle();
      assert.equal(a.session.state.phase, phase);
      const b = patient(room, grant('t2'), pulls<LiveKitGrant>({kind: 'waiting'}).pull);
      await settle();
      assert.equal(b.session.state.phase, 'live');
      const seen = a.states.length;

      await a.session.leave();
      a.session.resume();
      await settle();
      assert.ok(!room.log.includes('disconnect:t2'), `${phase}: the old session disconnected the new one`);
      assert.equal(b.session.state.phase, 'live', phase);
      assert.deepEqual(room.connects(), ['connect:t1', 'connect:t2'], phase);
      assert.equal(a.states.length, seen, `${phase}: the old session reports nothing more`);
      assert.equal(room.listeners.size, 1, `${phase}: only the new session listens`);

      await b.session.leave();
      assert.ok(room.log.includes('disconnect:t2'), `${phase}: the new session still tears down its own connection`);
    }
  });

  it('a leave() in the same tick as the start (StrictMode) never connects', async () => {
    const room = new FakeRoom();
    room.rooms.t1 = {metadata: meta('n-t1')};
    const {session} = patient(room, grant('t1'), async () => ({kind: 'waiting'}));
    await session.leave();
    await settle();
    assert.deepEqual(room.log, []);
  });
});

// G6-R S16: a room retired while the helper's FIRST connect is still pending
// (auto-create server: a stale grant recreates the room, the webhook deletes
// it before the peer connection is up). livekit-client 2.22 then keeps that
// attempt until its 15 s peer-connection timeout and answers any connect()
// meanwhile with the old attempt's promise — the 15.6–15.7 s recovery G6-R
// measured. The helper must end the attempt and connect afresh at once.
describe('connectPatientRoom — a room retired during its first connect (livekit-client 2.22 semantics, S16)', () => {
  it('never calls connect() on top of the pending attempt, and is live in the new room at once — not at the 15 s timeout', async () => {
    const room = new Lk222Room();
    room.rooms.t1 = {metadata: '', leaveBeforePc: DISCONNECT_REASON.ROOM_DELETED};
    room.rooms.t2 = {metadata: meta('n-t2')};
    const {pull, state} = pulls<LiveKitGrant>({kind: 'live', grant: grant('t2')});
    const t0 = Date.now();
    const {session, states, phases} = patient(room, grant('t1'), pull);
    const live = await until(() => session.state.phase === 'live', 2_000);
    const ms = Date.now() - t0;
    assert.ok(live, `not live after 2 s: ${JSON.stringify(states)} / ${room.log.join(' ')}`);
    assert.ok(ms < 500, `recovered in ${ms} ms (G6-R's figure was 15.6–15.7 s)`);
    assert.deepEqual(room.handedPending(), [], 'connect() was never called while the first attempt was pending');
    assert.ok(room.log.includes('attempt-cancelled:t1'), 'the stale attempt was ended, not left to time out');
    assert.ok(!room.log.includes('attempt-timed-out:t1'));
    assert.deepEqual(room.connects(), ['connect:t1', 'connect:t2']);
    assert.equal(state.count, 1, 'one re-pull for one drop');
    assert.deepEqual(session.state, {phase: 'live', roomName: 'room-t2'});
    assert.deepEqual(phases(), ['connecting', 'repulling', 'connecting', 'live']);
    assert.deepEqual(
      states.filter((s) => s.phase === 'repulling').map((s) => (s as {reason: string}).reason),
      ['room_deleted'],
      'never a connect_failed re-pull',
    );
    assert.deepEqual(room.published(), ['mic:true:t2', 'cam:true:t2'], 'nothing published before the new room checked out');
    await session.leave();
  });

  it('without a visible attempt controller it still never connects on top of the pending attempt: it waits for that attempt to end', async () => {
    const room = new Lk222Room();
    room.exposeAbortController = false;
    room.peerConnectionTimeoutMs = 150;
    room.rooms.t1 = {metadata: '', leaveBeforePc: DISCONNECT_REASON.ROOM_DELETED};
    room.rooms.t2 = {metadata: meta('n-t2')};
    const {pull, state} = pulls<LiveKitGrant>({kind: 'live', grant: grant('t2')});
    const t0 = Date.now();
    const {session, phases} = patient(room, grant('t1'), pull);
    assert.ok(await until(() => session.state.phase === 'live', 2_000));
    assert.ok(Date.now() - t0 >= 150, 'connected only once the first attempt had ended');
    assert.deepEqual(room.handedPending(), []);
    assert.ok(room.log.includes('attempt-timed-out:t1'));
    assert.deepEqual(room.connects(), ['connect:t1', 'connect:t2']);
    assert.equal(state.count, 1);
    assert.deepEqual(phases(), ['connecting', 'repulling', 'connecting', 'live']);
    assert.deepEqual(room.published(), ['mic:true:t2', 'cam:true:t2']);
    await session.leave();
  });

  it('DUPLICATE_IDENTITY during the first connect → displaced; resume() later connects at once (the attempt was ended at the drop)', async () => {
    const room = new Lk222Room();
    room.rooms.t1 = {metadata: meta('n-t1'), leaveBeforePc: DISCONNECT_REASON.DUPLICATE_IDENTITY};
    room.rooms.t2 = {metadata: meta('n-t2')};
    const {pull, state} = pulls<LiveKitGrant>({kind: 'live', grant: grant('t2')});
    const {session} = patient(room, grant('t1'), pull);
    assert.ok(await until(() => session.state.phase === 'displaced', 1_000));
    await settle(40);
    assert.equal(state.count, 0, 'no automatic re-pull');
    assert.ok(room.log.includes('attempt-cancelled:t1'));
    const t0 = Date.now();
    session.resume();
    assert.ok(await until(() => session.state.phase === 'live', 2_000));
    assert.ok(Date.now() - t0 < 500);
    assert.deepEqual(room.handedPending(), []);
    assert.deepEqual(room.published(), ['mic:true:t2', 'cam:true:t2']);
    await session.leave();
  });

  it('the physician helper recovers the same way', async () => {
    const room = new Lk222Room();
    room.rooms.p1 = {metadata: '', leaveBeforePc: DISCONNECT_REASON.ROOM_DELETED};
    room.rooms.p2 = {metadata: meta('n-p2')};
    const {pull} = pulls<PhysicianRoomGrant>({kind: 'live', grant: {token: 'p2', url: 'wss://lk.test', roomName: 'room-p2', roomNonce: 'n-p2'}});
    const session = connectPhysicianRoom({room, grant: {token: 'p1', url: 'wss://lk.test', roomName: 'room-p1'}, pull, onState: () => {}, retryDelaysMs: [0]});
    const t0 = Date.now();
    assert.ok(await until(() => session.state.phase === 'live', 2_000));
    assert.ok(Date.now() - t0 < 500);
    assert.deepEqual(room.handedPending(), []);
    assert.deepEqual(room.published(), ['mic:true:p2', 'cam:true:p2']);
    await session.leave();
  });

  // The fast path reads two livekit-client internals that Lk222Room imitates:
  // the Room's `abortController` field and its string `state`. A release that
  // renamed either would silently fall back to the 15 s wait with every test
  // above still green, so the real build is checked wherever one is installed
  // (the monorepo root's here; skipped otherwise — the peer stays optional).
  const lkBuild = installedLiveKitBuild();
  it('the installed livekit-client still exposes what the fast path reads', {skip: lkBuild ? false : 'livekit-client is not installed'}, () => {
    const src = readFileSync(lkBuild!, 'utf8');
    for (const line of [
      'this.abortController = abortController;',
      'ConnectionState["Disconnected"] = "disconnected";',
      'this.state = ConnectionState.Disconnected;',
    ]) {
      assert.ok(src.includes(line), `${lkBuild}: \`${line}\` is gone — re-check abortStaleConnectAttempt (S16) against this livekit-client`);
    }
  });
});

/** livekit-client's ESM build from the nearest `node_modules` up the tree, as Node resolves it; null when not installed. */
function installedLiveKitBuild(): string | null {
  for (let dir = here; ; dir = dirname(dir)) {
    const file = join(dir, 'node_modules', 'livekit-client', 'dist', 'livekit-client.esm.mjs');
    if (existsSync(file)) return file;
    if (dirname(dir) === dir) return null;
  }
}

// --- positive ---------------------------------------------------------------

describe('connectPatientRoom — the call carries on across a retirement', () => {
  it('publishes microphone and camera once the room carries the grant’s nonce', async () => {
    const room = new FakeRoom();
    room.rooms.t1 = {metadata: meta('n-t1')};
    const {session, phases} = patient(room, grant('t1'), async () => ({kind: 'waiting'}));
    await settle();
    assert.deepEqual(room.log, ['connect:t1', 'mic:true:t1', 'cam:true:t1']);
    assert.deepEqual(phases(), ['connecting', 'live']);
    assert.deepEqual(session.state, {phase: 'live', roomName: 'room-t1'});
  });

  it('ROOM_DELETED → pulls again → live in the new room', async () => {
    const room = new FakeRoom();
    room.rooms.t1 = {metadata: meta('n-t1')};
    room.rooms.t2 = {metadata: meta('n-t2')};
    const {pull, state} = pulls<LiveKitGrant>({kind: 'live', grant: grant('t2')});
    const {phases} = patient(room, grant('t1'), pull);
    await settle();
    room.drop(DISCONNECT_REASON.ROOM_DELETED);
    await settle();
    assert.equal(state.count, 1);
    assert.deepEqual(room.published(), ['mic:true:t1', 'cam:true:t1', 'mic:true:t2', 'cam:true:t2']);
    assert.deepEqual(phases(), ['connecting', 'live', 'repulling', 'connecting', 'live']);
  });

  it('ROOM_DELETED on a finished consult → ended with its status (the rating screen)', async () => {
    const room = new FakeRoom();
    room.rooms.t1 = {metadata: meta('n-t1')};
    const {session} = patient(room, grant('t1'), async () => ({kind: 'ended', status: 'completed'}));
    await settle();
    room.drop(DISCONNECT_REASON.ROOM_DELETED);
    await settle();
    assert.deepEqual(session.state, {phase: 'ended', status: 'completed'});
    assert.deepEqual(room.connects(), ['connect:t1']);
  });

  it('a patient removed by the server is pulled through, not parked', async () => {
    const room = new FakeRoom();
    room.rooms.t1 = {metadata: meta('n-t1')};
    room.rooms.t2 = {metadata: meta('n-t2')};
    const {pull} = pulls<LiveKitGrant>({kind: 'live', grant: grant('t2')});
    const {session} = patient(room, grant('t1'), pull);
    await settle();
    room.drop(DISCONNECT_REASON.PARTICIPANT_REMOVED);
    await settle();
    assert.equal(session.state.phase, 'live');
  });

  it('publishes only what was asked, and a device failure does not end the call', async () => {
    const room = new FakeRoom();
    room.rooms.t1 = {metadata: meta('n-t1')};
    room.cameraFails = true;
    const errors: string[] = [];
    const {session} = patient(room, grant('t1'), async () => ({kind: 'waiting'}), {onPublishError: (kind: string) => errors.push(kind)});
    await settle();
    assert.deepEqual(room.published(), ['mic:true:t1']);
    assert.deepEqual(errors, ['video']);
    assert.equal(session.state.phase, 'live');

    const audioOnly = new FakeRoom();
    audioOnly.rooms.t1 = {metadata: meta('n-t1')};
    patient(audioOnly, grant('t1'), async () => ({kind: 'waiting'}), {publish: {video: false}});
    await settle();
    assert.deepEqual(audioOnly.published(), ['mic:true:t1']);
  });

  it('roomOptions() keeps your options and replaces any reconnect policy', () => {
    const opts = roomOptions({adaptiveStream: true, reconnectPolicy: {nextRetryDelayInMs: () => 5}});
    assert.equal(opts.adaptiveStream, true);
    assert.equal(opts.reconnectPolicy, NO_RECONNECT_POLICY);
    assert.equal(opts.reconnectPolicy.nextRetryDelayInMs({retryCount: 0, elapsedMs: 0}), null);
    assert.equal(roomOptions().reconnectPolicy, NO_RECONNECT_POLICY);
  });
});

describe('connectPhysicianRoom', () => {
  const pgrant = (token: string, roomNonce?: string): PhysicianRoomGrant => ({token, url: 'wss://lk.test', roomName: `room-${token}`, ...(roomNonce ? {roomNonce} : {})});
  const physician = (room: FakeRoom, first: PhysicianRoomGrant, pull: () => Promise<RoomPull<PhysicianRoomGrant>>) => {
    const states: RoomSessionState[] = [];
    const session = connectPhysicianRoom({room, grant: first, pull, onState: (s) => states.push(s), retryDelaysMs: [0]});
    return {session, states};
  };

  it('refuses a Room that reconnects on its own', () => {
    const room = new FakeRoom();
    room.options = {reconnectPolicy: {nextRetryDelayInMs: () => 300}};
    assert.throws(() => connectPhysicianRoom({room, grant: pgrant('p1'), pull: async () => ({kind: 'waiting'}), onState: () => {}}), TypeError);
    assert.deepEqual(room.log, []);
  });

  it('DUPLICATE_IDENTITY → displaced and PARTICIPANT_REMOVED → removed: both wait for a person', async () => {
    for (const [reason, phase] of [
      [DISCONNECT_REASON.DUPLICATE_IDENTITY, 'displaced'],
      [DISCONNECT_REASON.PARTICIPANT_REMOVED, 'removed'],
    ] as const) {
      const room = new FakeRoom();
      room.rooms.p1 = {metadata: meta('x')};
      room.rooms.p2 = {metadata: meta('y')};
      const {pull, state} = pulls<PhysicianRoomGrant>({kind: 'live', grant: pgrant('p2')});
      const {session} = physician(room, pgrant('p1'), pull);
      await settle();
      room.drop(reason);
      await settle(60);
      assert.equal(session.state.phase, phase);
      assert.equal(state.count, 0);
      session.resume();
      await settle();
      assert.equal(state.count, 1);
      assert.equal(session.state.phase, 'live');
    }
  });

  it('publishes nothing into a room that is not a platform room, or not the grant’s', async () => {
    const room = new FakeRoom();
    room.rooms.p1 = {metadata: ''};
    room.rooms.p2 = {metadata: meta('other')};
    room.rooms.p3 = {metadata: meta('n3')};
    const {pull, state} = pulls<PhysicianRoomGrant>({kind: 'live', grant: pgrant('p2', 'n2')}, {kind: 'live', grant: pgrant('p3', 'n3')});
    const {session} = physician(room, pgrant('p1'), pull);
    await settle();
    assert.equal(state.count, 2);
    assert.deepEqual(room.published(), ['mic:true:p3', 'cam:true:p3']);
    assert.equal(session.state.phase, 'live');
  });

  it('a pull that says the call is over reports ended — and ends nothing itself', async () => {
    const room = new FakeRoom();
    room.rooms.p1 = {metadata: meta('x')};
    const calls: string[] = [];
    const pull = async (): Promise<RoomPull<PhysicianRoomGrant>> => {
      calls.push('room');
      return physicianPullFromRoom({status: 'completed'});
    };
    const {session} = physician(room, pgrant('p1'), pull);
    await settle();
    room.drop(DISCONNECT_REASON.ROOM_DELETED);
    await settle();
    assert.deepEqual(session.state, {phase: 'ended', status: 'completed'});
    assert.deepEqual(calls, ['room'], 'only the pull ran');
  });

  it('ROOM_DELETED → pulls again → reconnects', async () => {
    const room = new FakeRoom();
    room.rooms.p1 = {metadata: meta('x')};
    room.rooms.p2 = {metadata: meta('y')};
    const {pull, state} = pulls<PhysicianRoomGrant>({kind: 'live', grant: pgrant('p2')});
    const {session} = physician(room, pgrant('p1'), pull);
    await settle();
    room.drop(DISCONNECT_REASON.ROOM_DELETED);
    await settle();
    assert.equal(state.count, 1);
    assert.deepEqual(room.connects(), ['connect:p1', 'connect:p2']);
    assert.equal(session.state.phase, 'live');
  });
});

describe('pull adapters', () => {
  const g = {token: 't', url: 'wss://x', roomName: 'r', roomNonce: 'n'};

  it('patient join: a grant without its nonce is never live', () => {
    assert.deepEqual(patientPullFromJoin({status: 'in_progress', livekit: {...g, roomNonce: ''}}), {kind: 'retry'});
    assert.deepEqual(patientPullFromJoin({status: 'in_progress', livekit: {token: 't', url: 'wss://x', roomName: 'r'}}), {kind: 'retry'});
    assert.deepEqual(patientPullFromJoin({status: 'in_progress'}), {kind: 'retry'});
    assert.deepEqual(patientPullFromJoin({status: 'in_progress', livekit: g}), {kind: 'live', grant: g});
  });

  it('patient join: waiting (and anything unknown) is the waiting room; the finished ones are ended', () => {
    for (const status of ['waiting', 'teleported', '', null]) assert.deepEqual(patientPullFromJoin({status}), {kind: 'waiting'});
    for (const status of ['completed', 'cancelled', 'no_show', 'expired']) assert.deepEqual(patientPullFromJoin({status}), {kind: 'ended', status});
    assert.deepEqual(patientPullFromJoin(null), {kind: 'waiting'});
  });

  it('patient appointment beat', () => {
    assert.deepEqual(patientPullFromAppointmentBeat({state: {phase: 'in_progress'}, livekit: g}), {kind: 'live', grant: g});
    assert.deepEqual(patientPullFromAppointmentBeat({state: {phase: 'in_progress'}, livekit: {...g, roomNonce: null}}), {kind: 'retry'});
    for (const phase of ['early', 'waiting', 'connecting', 'surprise']) assert.deepEqual(patientPullFromAppointmentBeat({state: {phase}}), {kind: 'waiting'});
    assert.deepEqual(patientPullFromAppointmentBeat({state: {phase: 'missed'}}), {kind: 'ended', status: 'no_show'});
    assert.deepEqual(patientPullFromAppointmentBeat({state: {phase: 'closed', status: 'cancelled'}}), {kind: 'ended', status: 'cancelled'});
  });

  it('physician room / ready', () => {
    const pg = {token: 't', url: 'wss://x', roomName: 'r'};
    assert.deepEqual(physicianPullFromRoom({status: 'in_progress', livekit: pg}), {kind: 'live', grant: pg});
    assert.deepEqual(physicianPullFromRoom({status: 'in_progress', livekit: {...pg, roomNonce: 'n'}}), {kind: 'live', grant: {...pg, roomNonce: 'n'}});
    assert.deepEqual(physicianPullFromRoom({status: 'in_progress'}), {kind: 'retry'});
    assert.deepEqual(physicianPullFromRoom({status: 'completed'}), {kind: 'ended', status: 'completed'});
    assert.deepEqual(physicianPullFromReady({state: {phase: 'in_progress'}, livekit: pg}), {kind: 'live', grant: pg});
    assert.deepEqual(physicianPullFromReady({state: {phase: 'in_progress'}}), {kind: 'retry'});
    assert.deepEqual(physicianPullFromReady({state: {phase: 'waiting'}}), {kind: 'waiting'});
    assert.deepEqual(physicianPullFromReady({state: {phase: 'missed'}}), {kind: 'ended', status: 'missed'});
    assert.deepEqual(physicianPullFromReady({state: {phase: 'closed', status: 'completed'}}), {kind: 'ended', status: 'completed'});
  });
});

describe('livekit-client stays an optional peer', () => {
  const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as Record<string, Record<string, unknown> | undefined>;

  it('is never a dependency the package installs', () => {
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'bundleDependencies']) {
      assert.equal(pkg[field]?.['livekit-client'], undefined, field);
    }
  });

  it('is an OPTIONAL peer', () => {
    assert.equal(typeof pkg.peerDependencies?.['livekit-client'], 'string');
    assert.deepEqual(pkg.peerDependenciesMeta?.['livekit-client'], {optional: true});
  });

  it('is never imported by the built package', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
    const built = walk(join(here, '..', 'dist')).filter((f) => /\.(js|d\.ts)$/.test(f));
    assert.ok(built.length > 0);
    // Code only: the doc comments' usage examples (`import {Room} from
    // 'livekit-client'`) are the consumer's import, not the package's.
    const isComment = (line: string) => /^(\*|\/\/|\/\*)/.test(line.trim());
    for (const file of built) {
      const code = readFileSync(file, 'utf8').split('\n').filter((l) => !isComment(l)).join('\n');
      assert.doesNotMatch(code, /(from\s*|require\(\s*|import\(\s*)['"]livekit-client['"]/, file);
    }
    // The check itself still bites on a real import.
    assert.match(`const x = require("livekit-client");`, /(from\s*|require\(\s*|import\(\s*)['"]livekit-client['"]/);
  });
});
