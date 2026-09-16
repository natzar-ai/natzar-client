// The subscription engine — the thing that means a partner never writes a poll
// loop.
//
// Every live surface in this SDK (a conversation, a consult, a waiting room) is
// the same shape underneath: re-read something on a cadence, hand the caller a
// new snapshot only when it actually changed, and stop cleanly. Partners kept
// re-implementing that by hand, badly and differently in the same app — two
// idioms, two visibility strategies, no backoff anywhere, and a transcript loop
// that hammered every 2.5s forever once the network failed. All of it lives
// here now, once.
//
// Deliberately NOT an EventEmitter and NOT an async iterator: a plain callback
// that returns an unsubscribe function is the only shape that reads the same in
// React, Vue, Svelte, a Node worker and a bare <script>. Frameworks wrap it in
// three lines; the SDK stays framework-free.

/** Cancels a subscription. Safe to call more than once. */
export type Unsubscribe = () => void;

/** What a subscription reports about its own health, alongside your data. */
export interface SyncState {
  /**
   * `live` — the last read succeeded.
   * `connecting` — the first read has not landed yet.
   * `retrying` — a read failed and the SDK is backing off; your last good
   *   snapshot is still the one you were given, so a blip does not blank the UI.
   * `stopped` — terminal: either you unsubscribed, or the thing being watched
   *   reached a state that can never change again (a closed consult).
   */
  phase: 'connecting' | 'live' | 'retrying' | 'stopped';
  /** The error from the most recent failed read, if it is still failing. */
  error?: Error;
  /** Milliseconds until the next read. Useful for a "reconnecting…" hint. */
  nextPollInMs?: number;
}

export interface WatchOptions {
  /**
   * Base interval between reads. The engine adapts around it — see
   * {@link PollTuning} — so this is a target, not a guarantee.
   * @defaultValue 2500
   */
  intervalMs?: number;
  /**
   * Stop polling when the document is hidden and read once immediately on
   * return. Browser only; a no-op server-side. Turning this off keeps a
   * background tab polling, which is almost never what you want.
   * @defaultValue true
   */
  pauseWhenHidden?: boolean;
  /** Abort the subscription from an existing controller. */
  signal?: AbortSignal;
  /**
   * Called when a read fails. The subscription keeps retrying regardless —
   * this is for logging, not control flow. `sync.phase` already tells your UI.
   */
  onError?: (error: Error) => void;
  /**
   * Receives a handle to the running subscription as soon as it starts.
   *
   * `refresh()` reads NOW rather than waiting for the next tick. It exists so
   * that an action the user just took — sending a message, accepting a
   * consult — shows its result immediately instead of after a poll interval,
   * and so it works even while the document is hidden (a user acting on a page
   * is not a background tab, whatever `document.hidden` claims).
   */
  onReady?: (controls: {refresh: () => void}) => void;
}

/** Internal knobs, exposed for tests rather than for partners. */
export interface PollTuning {
  intervalMs: number;
  maxBackoffMs: number;
  /** Slow to this when nothing has changed for a while. */
  idleIntervalMs: number;
  /** Consecutive unchanged reads before easing off to `idleIntervalMs`. */
  idleAfterUnchanged: number;
}

export const DEFAULT_TUNING: PollTuning = {
  intervalMs: 2_500,
  maxBackoffMs: 30_000,
  idleIntervalMs: 10_000,
  idleAfterUnchanged: 8,
};

/** What the engine needs to know about the thing it is watching. */
export interface PollSource<T> {
  /** Read current state. Throwing schedules a backed-off retry. */
  read: (signal: AbortSignal) => Promise<T>;
  /**
   * Compare two reads. Returning true suppresses the callback entirely, which
   * is what keeps a 2.5s poll from re-rendering a partner's UI 24 times a
   * minute over an unchanged transcript.
   */
  same?: (a: T, b: T) => boolean;
  /**
   * Whether this state can still change. Returning true stops the loop for
   * good and reports `phase: 'stopped'` — a closed consult should not cost a
   * request every 2.5s until the tab closes.
   */
  isFinal?: (value: T) => boolean;
}

const isBrowser = () => typeof document !== 'undefined' && typeof document.addEventListener === 'function';

// Full jitter (AWS's "Exponential Backoff and Jitter"): random across the whole
// window rather than a fixed multiple. Partners' patients reconnect in herds
// after a network drop — a wifi handover, a train tunnel — and undithered
// backoff reconverges them into synchronized spikes against our API.
const backoffFor = (attempt: number, tuning: PollTuning): number => {
  const ceiling = Math.min(tuning.maxBackoffMs, tuning.intervalMs * 2 ** attempt);
  return Math.random() * ceiling;
};

/**
 * Watch something that changes over time.
 *
 * The callback fires immediately with `phase: 'connecting'`, then on every
 * genuine change. It is never called after you unsubscribe — including for a
 * read that was already in flight, which is the race that leaves partners
 * setting state on unmounted components.
 */
export function watch<T>(
  source: PollSource<T>,
  onChange: (value: T | undefined, sync: SyncState) => void,
  options: WatchOptions = {},
  tuning: PollTuning = DEFAULT_TUNING,
): Unsubscribe {
  const interval = options.intervalMs ?? tuning.intervalMs;
  const pauseWhenHidden = options.pauseWhenHidden ?? true;
  const controller = new AbortController();

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let unchanged = 0;
  let last: T | undefined;

  const emit = (sync: SyncState) => {
    if (stopped && sync.phase !== 'stopped') return;
    onChange(last, sync);
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    controller.abort();
    if (pauseWhenHidden && isBrowser()) document.removeEventListener('visibilitychange', onVisibility);
    options.signal?.removeEventListener('abort', stop);
    onChange(last, {phase: 'stopped'});
  };

  const schedule = (ms: number) => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), ms);
  };

  // ONE read at a time. A `refresh()` (or a visibility return) that lands
  // while a read is still in flight must not start a second tick beside it:
  // every tick schedules the next, so two concurrent ticks become two poll
  // chains for the life of the subscription — double the requests, and one of
  // them un-cancellable by `stop()` because only the last timer is tracked.
  // Instead the request is noted and honoured the moment the current read
  // settles, which is at least as fresh as a parallel read would have been.
  let inFlight = false;
  let refreshRequested = false;

  const tick = async (args: {force?: boolean} = {}): Promise<void> => {
    if (stopped) return;
    if (inFlight) {
      refreshRequested = refreshRequested || !!args.force;
      return;
    }
    // A hidden tab costs nothing: skip the read and re-arm. The
    // visibilitychange listener reads immediately on return, so the first
    // thing a returning user sees is fresh.
    //
    // The FIRST read is exempt. A surface can be mounted while already hidden —
    // a background tab, a prerender, an offscreen route, a headless browser —
    // and pausing before ever reading leaves it stuck on its empty state
    // forever rather than being ready the moment it is revealed. One read is
    // the cost of correctness here; the sustained polling is what visibility
    // gating exists to prevent.
    if (!args.force && last !== undefined && pauseWhenHidden && isBrowser() && document.hidden) return schedule(interval);

    inFlight = true;
    try {
      await run();
    } finally {
      inFlight = false;
      if (refreshRequested && !stopped) {
        refreshRequested = false;
        if (timer) clearTimeout(timer);
        void tick({force: true});
      }
    }
  };

  const run = async (): Promise<void> => {
    try {
      const value = await source.read(controller.signal);
      if (stopped) return;
      failures = 0;

      const changed = last === undefined || !source.same?.(last, value);
      last = value;

      if (changed) {
        unchanged = 0;
        emit({phase: 'live'});
      } else {
        unchanged += 1;
      }

      // Nothing left to watch — stop rather than bill the partner for a
      // request every few seconds against a record that is finished.
      if (source.isFinal?.(value)) return stop();

      // Quiet conversations ease off. A thread nobody has touched in 20
      // seconds does not need the same cadence as one mid-exchange.
      schedule(unchanged >= tuning.idleAfterUnchanged ? tuning.idleIntervalMs : interval);
    } catch (error) {
      if (stopped) return;
      // An aborted in-flight read is a teardown, not a failure.
      if (controller.signal.aborted) return;
      const err = error instanceof Error ? error : new Error(String(error));
      failures += 1;
      options.onError?.(err);
      const wait = backoffFor(failures, tuning);
      // The last good snapshot is deliberately kept as `last`, so a UI bound
      // to this subscription shows stale-but-real data during an outage
      // instead of blanking.
      emit({phase: 'retrying', error: err, nextPollInMs: Math.round(wait)});
      schedule(wait);
    }
  };

  function onVisibility() {
    if (stopped || document.hidden) return;
    if (timer) clearTimeout(timer);
    void tick();
  }

  if (pauseWhenHidden && isBrowser()) document.addEventListener('visibilitychange', onVisibility);
  if (options.signal) {
    if (options.signal.aborted) {
      // Already aborted before we began: report stopped and never read.
      queueMicrotask(() => onChange(undefined, {phase: 'stopped'}));
      return () => {};
    }
    options.signal.addEventListener('abort', stop, {once: true});
  }

  // An explicit read, now. Cancels the pending timer so a refresh cannot
  // double up with a tick that was about to fire anyway.
  const refresh = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    void tick({force: true});
  };
  options.onReady?.({refresh});

  emit({phase: 'connecting'});
  void tick();

  return stop;
}
