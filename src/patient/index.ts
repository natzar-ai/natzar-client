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
//   Partners were parsing link URLs out of message text to reconstruct this.

import {watch, type SyncState, type Unsubscribe, type WatchOptions} from '../subscribe';
import {assertConnectable, callPatientOp, type PatientSession, type TransportOptions} from './transport';

export type {PatientSession, Unsubscribe, SyncState, WatchOptions};
export {NatzarSessionError} from './transport';

/** One entry in the patient's care timeline. Plain, serializable data. */
export interface TimelineEntry {
  /** Stable id — safe as a list key, and stable across polls. */
  id: string;
  /** Who produced it. `system` entries are lifecycle notices, not prose. */
  author: 'patient' | 'agent' | 'physician' | 'system';
  /** Display text, already localized by the platform. */
  text: string;
  /** ISO timestamp. Entries are always sorted oldest-first. */
  sentAt: string;
  /** Which record it came from — the assistant chat, or a specific consult. */
  source: 'agent' | 'consult';
  /** The consult this belongs to, when `source` is `consult`. */
  consultId?: string;
  /** Attachments the patient or clinician sent. */
  attachments?: Array<{fileName: string; mimeType: string; url: string}>;
  /**
   * Set when this entry is waiting on the patient. `consent` — a clinician
   * consult is being offered; answer with `care.respond(entry, accept)`.
   * `rating` — a finished consult can be rated; answer with `care.rate(...)`.
   * Absent once answered, so a rendered button disappears on its own.
   */
  awaiting?: 'consent' | 'rating';
  /** True while a locally-sent entry has not yet been confirmed by the server. */
  pending?: boolean;
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
    /** The clinician, once one is on the case. */
    physician?: {name: string};
    /** True when this consult can be rated right now. */
    rateable?: boolean;
  };
}

export interface ConnectOptions extends TransportOptions {
  /** Poll cadence for live surfaces. @defaultValue 2500 */
  intervalMs?: number;
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
     * Send a patient message. Resolves when the platform has ACCEPTED it, not
     * when it has been answered — the reply arrives on your subscription.
     *
     * Safe to retry: an `idempotencyKey` is generated per call and reused, so a
     * network timeout cannot put the same clinical message on the transcript
     * twice.
     */
    send(input: {text?: string; attachment?: unknown}): Promise<void>;
  };
  /** Answer a consent invite surfaced as `entry.awaiting === 'consent'`. */
  respond(entry: TimelineEntry, accept: boolean): Promise<void>;
  /** Rate a finished consult surfaced as `entry.awaiting === 'rating'`. */
  rate(entry: TimelineEntry, rating: {stars: number; feedback?: string}): Promise<void>;
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

  const call = <T>(
    op: {kind: 'query' | 'mutation'; name: string; args: Record<string, unknown>},
    signal?: AbortSignal,
  ) => callPatientOp<T>(session, op, options, signal);

  // Messages the caller has sent but the server has not echoed back yet. The
  // platform accepts writes asynchronously (202-style), so without this a
  // patient watches their own message vanish for a beat after hitting send —
  // the single most common complaint about chat integrations.
  const pending: TimelineEntry[] = [];

  // Live subscriptions, so an action the patient just took refreshes the view
  // at once instead of waiting out a poll interval. Without this, sending a
  // message left the sender staring at an unchanged screen for up to
  // `intervalMs` — and forever on a surface whose polling is visibility-paused.
  const refreshers = new Set<() => void>();
  const refreshNow = () => refreshers.forEach((r) => r());

  const read = async (signal?: AbortSignal): Promise<CareSnapshot> => {
    const [state, messages] = await Promise.all([
      call<RawState>({kind: 'query', name: 'embedState', args: {token: session.sessionToken}}, signal),
      call<RawMessages>({kind: 'query', name: 'embedAgentMessages', args: {token: session.sessionToken}}, signal),
    ]);
    const snapshot = toSnapshot(state, messages);
    // Drop optimistic entries the server has now confirmed. Matching on text
    // is deliberate: the platform assigns its own ids, so there is nothing
    // else shared between the local echo and the durable record.
    for (let i = pending.length - 1; i >= 0; i--) {
      if (snapshot.timeline.some((e) => e.author === 'patient' && e.text === pending[i].text)) pending.splice(i, 1);
    }
    if (pending.length) {
      snapshot.timeline = [...snapshot.timeline, ...pending];
      snapshot.awaitingReply = true;
    }
    return snapshot;
  };

  return {
    conversation: {
      subscribe: (onChange, watchOptions = {}) => {
        let mine: (() => void) | undefined;
        const stop = watch<CareSnapshot>(
          {
            read: (signal) => read(signal),
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
      send: async (input) => {
        const text = input.text?.trim();
        if (!text && !input.attachment) throw new Error('send() needs text or an attachment');
        if (text) pending.push({
          id: `pending-${Date.now()}`,
          author: 'patient',
          text,
          sentAt: new Date().toISOString(),
          source: 'agent',
          pending: true,
        });
        // Show the optimistic entry immediately, then reconcile on the read
        // this triggers — rather than waiting for the next poll tick.
        refreshNow();
        await call({
          kind: 'mutation',
          name: 'embedAgentSend',
          args: {token: session.sessionToken, text, attachment: input.attachment},
        });
        refreshNow();
      },
    },

    respond: async (entry, accept) => {
      await call({
        kind: 'mutation',
        name: entry.source === 'consult' ? 'embedAsyncConsent' : 'embedAgentConsent',
        args: {token: session.sessionToken, accept},
      });
      refreshNow();
    },

    rate: async (entry, rating) => {
      if (!entry.consultId) throw new Error('That entry is not a rating prompt.');
      await call({
        kind: 'mutation',
        name: 'embedAgentRate',
        args: {
          token: session.sessionToken,
          consultId: entry.consultId,
          overallPhysicianRating: rating.stars,
          feedback: rating.feedback,
        },
      });
      refreshNow();
    },

    call,
  };
}

// --- shaping -----------------------------------------------------------------

interface RawState {
  consult?: {
    id?: string;
    type?: string;
    status?: string;
    position?: number;
    estimatedMinutes?: number;
    physicianName?: string;
    rateable?: boolean;
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
    attachments?: Array<{fileName: string; mimeType: string; url: string}>;
    classification?: string | null;
  }>;
}

const PHASES: Record<string, CareSnapshot['consult'] extends infer C ? C extends {phase: infer P} ? P : never : never> = {
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

function toSnapshot(state: RawState, messages: RawMessages): CareSnapshot {
  const timeline: TimelineEntry[] = (messages.messages ?? []).map((m) => {
    const entry: TimelineEntry = {
      id: String(m.id ?? ''),
      author: (['patient', 'agent', 'physician', 'system'] as const).includes(m.author as never)
        ? (m.author as TimelineEntry['author'])
        : 'system',
      text: String(m.body ?? ''),
      sentAt: String(m.sentAt ?? ''),
      source: m.asyncConsultId ? 'consult' : 'agent',
    };
    if (m.asyncConsultId) entry.consultId = m.asyncConsultId;
    if (m.attachments?.length) entry.attachments = m.attachments;
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

  const raw = state.consult;
  const snapshot: CareSnapshot = {
    timeline,
    // The platform answers patient turns asynchronously; "the last thing said
    // was the patient's" is the honest signal for a typing indicator.
    awaitingReply: timeline.length > 0 && timeline[timeline.length - 1].author === 'patient',
  };

  if (raw?.id) {
    const phase = PHASES[String(raw.status ?? '')] ?? 'unknown';
    snapshot.consult = {
      id: raw.id,
      kind: raw.type === 'telehealth' ? 'telehealth' : 'async',
      phase,
      ...(raw.position !== undefined ? {position: raw.position} : {}),
      ...(raw.estimatedMinutes !== undefined ? {estimatedMinutes: raw.estimatedMinutes} : {}),
      ...(raw.physicianName ? {physician: {name: raw.physicianName}} : {}),
      ...(raw.rateable !== undefined ? {rateable: raw.rateable} : {}),
    };
    // Mark the entry the patient must act on, so the partner renders a button
    // from data instead of parsing a link out of message prose.
    const last = timeline[timeline.length - 1];
    if (last) {
      if (phase === 'awaiting_consent') last.awaiting = 'consent';
      else if (raw.rateable) last.awaiting = 'rating';
    }
  }
  return snapshot;
}

// Cheap change detection: ids + the fields that drive a re-render. Comparing
// whole objects would re-render on every server-side timestamp jitter.
const fingerprint = (s: CareSnapshot): string =>
  [
    s.timeline.length,
    s.timeline[s.timeline.length - 1]?.id ?? '',
    s.timeline[s.timeline.length - 1]?.awaiting ?? '',
    s.awaitingReply ? '1' : '0',
    s.consult?.id ?? '',
    s.consult?.phase ?? '',
    s.consult?.position ?? '',
    s.consult?.rateable ? '1' : '0',
  ].join('|');
