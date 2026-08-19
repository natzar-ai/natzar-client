import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {watch, DEFAULT_TUNING, type SyncState} from '../dist/esm/subscribe.js';

// The engine that replaces every partner's hand-rolled poll loop. These cover
// the behaviours partners got wrong when they wrote it themselves: hammering a
// failing endpoint, re-rendering on unchanged data, polling a finished record
// forever, and firing a callback after teardown.

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const FAST = {...DEFAULT_TUNING, intervalMs: 5, maxBackoffMs: 20, idleIntervalMs: 10, idleAfterUnchanged: 3};

describe('watch', () => {
  it('reports connecting first, then live with the value', async () => {
    const seen: Array<[unknown, SyncState['phase']]> = [];
    const stop = watch({read: async () => 'a'}, (v, s) => seen.push([v, s.phase]), {pauseWhenHidden: false}, FAST);
    await tick(20);
    stop();
    assert.equal(seen[0][1], 'connecting');
    assert.deepEqual(seen[1], ['a', 'live']);
  });

  // The point of the engine: a poll that returns the same thing must not wake
  // the partner's renderer. Without this a 2.5s loop re-renders 24x a minute
  // over an unchanged transcript.
  it('does NOT call back when the value is unchanged', async () => {
    let calls = 0;
    const stop = watch(
      {read: async () => ({v: 1}), same: (a, b) => a.v === b.v},
      (_v, s) => {
        if (s.phase === 'live') calls++;
      },
      {pauseWhenHidden: false},
      FAST,
    );
    await tick(60);
    stop();
    assert.equal(calls, 1, 'should emit once, not once per poll');
  });

  it('calls back again as soon as the value really changes', async () => {
    let n = 0;
    const values: unknown[] = [];
    const stop = watch(
      {read: async () => ({v: n++}), same: (a, b) => a.v === b.v},
      (v, s) => {
        if (s.phase === 'live') values.push(v);
      },
      {pauseWhenHidden: false},
      FAST,
    );
    await tick(40);
    stop();
    assert.ok(values.length >= 3, `expected several changes, got ${values.length}`);
  });

  // A failing read must back off, and must NOT blank the caller's data — a
  // network blip should not empty a patient's chat.
  it('backs off on failure and keeps the last good value', async () => {
    let attempts = 0;
    const seen: Array<[unknown, SyncState['phase']]> = [];
    const stop = watch(
      {
        read: async () => {
          attempts++;
          if (attempts === 1) return 'good';
          throw new Error('network');
        },
      },
      (v, s) => seen.push([v, s.phase]),
      {pauseWhenHidden: false},
      FAST,
    );
    await tick(60);
    stop();
    const retrying = seen.find(([, p]) => p === 'retrying');
    assert.ok(retrying, 'should report retrying');
    assert.equal(retrying![0], 'good', 'last good value must survive the failure');
  });

  it('surfaces failures to onError without stopping', async () => {
    const errors: Error[] = [];
    const stop = watch(
      {read: async () => { throw new Error('boom'); }},
      () => {},
      {pauseWhenHidden: false, onError: (e) => errors.push(e)},
      FAST,
    );
    await tick(50);
    stop();
    assert.ok(errors.length >= 2, 'keeps retrying after an error');
    assert.equal(errors[0].message, 'boom');
  });

  // A closed consult must not cost a request every few seconds forever.
  it('stops for good when the value is final', async () => {
    let reads = 0;
    let stoppedPhase = false;
    watch(
      {
        read: async () => {
          reads++;
          return {done: reads >= 2};
        },
        same: (a, b) => a.done === b.done,
        isFinal: (v) => v.done,
      },
      (_v, s) => {
        if (s.phase === 'stopped') stoppedPhase = true;
      },
      {pauseWhenHidden: false},
      FAST,
    );
    await tick(60);
    assert.ok(stoppedPhase, 'should report stopped');
    assert.ok(reads <= 3, `should stop reading once final, did ${reads} reads`);
  });

  // The unmount race: an in-flight read resolving after teardown must not call
  // back. This is what produces "setState on an unmounted component".
  it('never calls back after unsubscribe, including for an in-flight read', async () => {
    let afterStop = 0;
    let stopped = false;
    const stop = watch(
      {read: async () => { await tick(15); return Math.random(); }},
      (_v, s) => {
        if (stopped && s.phase !== 'stopped') afterStop++;
      },
      {pauseWhenHidden: false},
      FAST,
    );
    await tick(5);
    stopped = true;
    stop();
    await tick(40);
    assert.equal(afterStop, 0);
  });

  it('is safe to unsubscribe twice', async () => {
    const stop = watch({read: async () => 1}, () => {}, {pauseWhenHidden: false}, FAST);
    stop();
    assert.doesNotThrow(() => stop());
  });

  it('stops when an external AbortSignal fires', async () => {
    const ac = new AbortController();
    let stoppedPhase = false;
    watch({read: async () => 1}, (_v, s) => { if (s.phase === 'stopped') stoppedPhase = true; }, {pauseWhenHidden: false, signal: ac.signal}, FAST);
    await tick(10);
    ac.abort();
    await tick(10);
    assert.ok(stoppedPhase);
  });

  // Backoff must be jittered, or every patient who lost wifi in the same tunnel
  // retries in lockstep and we get synchronized spikes.
  it('jitters backoff rather than retrying on a fixed cadence', async () => {
    const gaps: number[] = [];
    let lastAt = Date.now();
    const stop = watch(
      {read: async () => { throw new Error('x'); }},
      (_v, s) => {
        if (s.phase === 'retrying') {
          gaps.push(Date.now() - lastAt);
          lastAt = Date.now();
        }
      },
      {pauseWhenHidden: false},
      {...FAST, maxBackoffMs: 60},
    );
    await tick(220);
    stop();
    assert.ok(gaps.length >= 3, 'need several retries to compare');
    assert.ok(new Set(gaps.map((g) => Math.round(g / 5))).size > 1, 'gaps should vary');
  });

  // A surface can mount while ALREADY hidden — a background tab, a prerender,
  // an offscreen route, a headless/automated browser. Pausing before the first
  // read ever happens leaves it stuck on its empty state forever instead of
  // being ready the moment it is revealed. Found by running the real SDK inside
  // an automation pane, which reports document.hidden permanently.
  it('still performs the FIRST read when mounted into an already-hidden document', async () => {
    const realDoc = (globalThis as {document?: unknown}).document;
    (globalThis as {document?: unknown}).document = {
      hidden: true,
      addEventListener() {},
      removeEventListener() {},
    };
    try {
      let reads = 0;
      let got: unknown;
      const stop = watch(
        {read: async () => { reads++; return 'value'; }},
        (v, s) => { if (s.phase === 'live') got = v; },
        {}, // pauseWhenHidden defaults to true — the point of the test
        FAST,
      );
      await tick(40);
      stop();
      assert.equal(got, 'value', 'the first read must land even while hidden');
      // ...and it must not then poll on: one read, not a loop.
      assert.equal(reads, 1, `expected exactly one read while hidden, got ${reads}`);
    } finally {
      if (realDoc === undefined) delete (globalThis as {document?: unknown}).document;
      else (globalThis as {document?: unknown}).document = realDoc;
    }
  });
});
