// GENERATED FILE — do not edit.
//
// Copied verbatim from natzar-core's shared/partner-api by
// scripts/sync-contract.mjs. Edit the source there; this copy exists only so
// the published package is self-contained.
/**
 * Embed contract: the `<natzar-telehealth>` / `<natzar-async>` /
 * `<natzar-agent>` custom elements, their attributes, the DOM events they
 * dispatch, and the v1 `postMessage` envelope between the embedded iframe and
 * its host page.
 *
 * ## Quickstart (protocol v2, `./sessions`)
 *
 * ```html
 * <script src="/natzar/embed.js" async></script>
 * <natzar-async locale="en" theme="auto"></natzar-async>
 * ```
 *
 * Your server mounts the `natzar()` middleware of `@natzar/client/server` at
 * `/natzar`; it maps your login to a patient in `identify` and mints the
 * session through `POST /v1/sessions` (`./sessions`). The element finds
 * `/natzar` on its own origin, obtains its credential sealed to its frame and
 * renews it by itself: no credential ever appears in an attribute, a URL or
 * the page. The embedding page's origin must be registered for your account
 * (`PUT /v1/embed/origins`), or the element reports `origin_not_allowed`.
 *
 * The telehealth iframe requests camera/microphone access, the in-frame
 * pharmacy picker (a prescription's "choose a pharmacy" step) asks for the
 * device's location, and the in-frame checkout can offer wallet payments —
 * the embed script sets
 * `allow="camera; microphone; display-capture; geolocation; payment"` on the
 * iframe it creates; no host-page permissions policy changes are usually
 * needed. If you build the iframe yourself, carry the same `allow` list.
 *
 * ## Event plumbing
 *
 * The element re-dispatches what its frame reports as DOM `CustomEvent`s
 * named `natzar:<event>` (see {@link EmbedDomEventName}). The element renews
 * its own session; `natzar:expired` fires only when renewal is impossible.
 * Listen on the element when you want to react:
 *
 * ```js
 * const el = document.querySelector('natzar-async');
 * el.addEventListener('natzar:message', (e) => bumpBadge(e.detail.consultId));
 * ```
 *
 * This module is imported by the embed script itself and by partner
 * TypeScript: it is intentionally runtime-free apart from string constants.
 *
 * REPLACED BY ./sessions (embed redesign M1/M4) — delete when the last consumer
 * moves: the `session-token` attribute, `refresh()`, the raw
 * `{source:'natzar-embed'}` postMessage protocol ({@link EmbedPostMessage}) and
 * the `message`/`expired`/`error` details (D2). The tag names, the 12 event
 * names, the other details and the presentation attributes stay. The
 * per-consult `/embed-session` mint routes and the HS256 patient tokens are
 * gone (M2).
 *
 * @packageDocumentation
 */

import type {AsyncClosedReason, AsyncMessageResource} from './resources';

/** Tag name of the live-video embed element. */
export const EMBED_TAG_TELEHEALTH = 'natzar-telehealth';

/** Tag name of the async-chat embed element. */
export const EMBED_TAG_ASYNC = 'natzar-async';

/** Either embed tag name. */
/**
 * Tag name of the AI-agent chat element.
 *
 * Unlike the two consult tags, its session (surface `agent`) is scoped to a
 * PATIENT rather than a consult. The conversation continues across consults,
 * so the same widget shows the agent's answers and any stretch where a
 * physician took over.
 */
export const EMBED_TAG_AGENT = 'natzar-agent';

/** Any embed tag name. */
export type EmbedTagName =
  | typeof EMBED_TAG_TELEHEALTH
  | typeof EMBED_TAG_ASYNC
  | typeof EMBED_TAG_AGENT;

/**
 * The `source` field of every {@link EmbedPostMessage} — how host-page code
 * (and the embed script itself) tells our messages apart from other iframes'
 * postMessage traffic.
 */
export const EMBED_MESSAGE_SOURCE = 'natzar-embed';

/** Prefix of the DOM `CustomEvent` names dispatched on the element. */
export const EMBED_DOM_EVENT_PREFIX = 'natzar:';

/**
 * UI locale of the widget. Base languages of the platform's supported
 * patient locales. When omitted, the widget follows the browser language,
 * falling back to English.
 */
export type EmbedLocale = 'en' | 'es' | 'de' | 'fr' | 'it';

/**
 * Color scheme of the widget. `auto` (the default) follows
 * `prefers-color-scheme`.
 */
export type EmbedTheme = 'light' | 'dark' | 'auto';

/**
 * HTML attributes of both embed elements. All attributes are observed:
 * changing one re-renders the widget (changing `session-token` is
 * equivalent to calling `refresh`).
 */
export interface EmbedAttributes {
  /**
   * REPLACED (v1 only; removed with the v2 loader, M4): v2 elements take no
   * credential attribute. Was: the consult-scoped session token minted
   * server-side (never mint tokens in the browser — that
   * would expose your API key). Determines which consult the widget shows;
   * the token's type must match the tag (`telehealth` vs `async`).
   */
  'session-token': string;
  /** UI language. Default: browser language, falling back to `en`. */
  locale?: EmbedLocale;
  /** Color scheme. Default `auto`. */
  theme?: EmbedTheme;
  /**
   * Accent color — the patient's own message bubbles, primary buttons and
   * focus rings. **Hex only** (`#0f7b6c`, `#fff`, 3/4/6/8 digits); anything
   * else is ignored and the default is kept.
   *
   * The widget runs in a cross-origin iframe, so your page's CSS cannot reach
   * inside it. These attributes are the supported way to make it look like
   * your product. They are a deliberately small, strictly validated set
   * rather than arbitrary CSS: the frame renders health information, and a
   * free-form style channel into it is a channel worth not having.
   *
   * Defaults to your tenant's brand color when one is configured, else the
   * theme's own accent.
   */
  accent?: string;
  /** Text/icon color used ON `accent`. Hex only. Default white. */
  'accent-foreground'?: string;
  /** Page background behind the conversation. Hex only. */
  background?: string;
  /** Surface color for bubbles, header and composer. Hex only. */
  surface?: string;
  /**
   * Corner radius of bubbles, buttons and cards, in px (0–24). Larger values
   * are clamped. Default 18.
   */
  radius?: string;
  /**
   * Font family for the widget's text, e.g. `Inter, system-ui, sans-serif`.
   * Letters, digits, spaces, commas, quotes and hyphens only — enough to name
   * a stack, not enough to smuggle another declaration. The font must already
   * be available to the browser; the widget loads no external fonts.
   */
  'font-family'?: string;
}

/**
 * Imperative API of both embed elements (beyond standard DOM methods).
 */
export interface NatzarEmbedElementApi {
  /**
   * Swap in a freshly minted session token without tearing down the widget
   * — the intended reaction to the `natzar:expired` event. In-flight calls
   * and (for telehealth) a live video call continue uninterrupted.
   *
   * REPLACED (v1 only): v2 elements renew by themselves (`connect({getSession})` in manual mode).
   *
   * @param sessionToken - A fresh v1 session token.
   */
  refresh(sessionToken: string): void;
}

/**
 * Every embed lifecycle event name (the `event` field of the postMessage
 * envelope; DOM listeners use the `natzar:`-prefixed form, see
 * {@link EmbedDomEventName}).
 */
export type EmbedEventName =
  | 'ready'
  | 'consented'
  | 'queued'
  | 'assigned'
  | 'message'
  | 'joined'
  | 'ended'
  | 'rated'
  | 'closed'
  | 'expired'
  | 'error'
  | 'payment';

/** Runtime list of every embed event name. */
export const EMBED_EVENT_NAMES = [
  'ready',
  'consented',
  'queued',
  'assigned',
  'message',
  'joined',
  'ended',
  'rated',
  'closed',
  'expired',
  'error',
  'payment',
] as const satisfies readonly EmbedEventName[];

/**
 * Per-event `detail` payloads: what each DOM `CustomEvent`'s `detail` (and
 * each postMessage envelope's `data`) contains.
 *
 * Events by surface:
 * - Both: `ready`, `closed`, `expired`, `error`, `rated`.
 * - Async chat only: `consented`, `queued`, `assigned`, `message`.
 * - Telehealth only: `joined`, `ended` (plus `queued` while in the waiting
 *   room and `assigned` when a physician picks up).
 * - Any surface whose visit the clinic charges for: `payment`.
 */
export interface EmbedEventDetailMap {
  /** The widget loaded, verified its token, and rendered. */
  ready: {
    /** Which widget kind fired. */
    type: 'telehealth' | 'async' | 'agent';
    /**
     * The consult the widget is bound to. EMPTY for `agent`: that session is
     * scoped to a patient, not to a consult.
     */
    consultId: string;
  };
  /** Async: the patient accepted the consent prompt. */
  consented: {consultId: string};
  /**
   * The consult is waiting for a physician (async: consented but no
   * capacity yet; telehealth: patient is in the waiting room).
   */
  queued: {consultId: string};
  /** A physician took the consult. */
  assigned: {
    consultId: string;
    /** Display name to show the patient, when available. */
    physicianName?: string;
  };
  /**
   * Async: a new message appeared on the thread (any author). Mirrors what
   * the widget just rendered — useful for host-page unread badges.
   */
  message: {
    consultId: string;
    /** The message, without fresh attachment URLs (the widget handles those). */
    message: AsyncMessageResource;
  };
  /** Telehealth: the patient entered the live call. */
  joined: {consultId: string};
  /** Telehealth: the call ended (the rating step may follow). */
  ended: {consultId: string};
  /** The patient submitted a rating. */
  rated: {
    consultId: string;
    /** The overall star rating, if stars were given. */
    stars?: number;
  };
  /**
   * The consult reached a terminal state (including a declined consent,
   * which surfaces as `closed` with `closedReason: 'declined'`).
   */
  closed: {
    consultId: string;
    /** Async consults: why it closed. */
    closedReason?: AsyncClosedReason;
  };
  /**
   * The session ended and could not be renewed (v2: `./sessions`
   * `patientEventDetailSchemas.expired` adds the reason). The widget freezes
   * (read-only).
   */
  expired: {consultId: string};
  /** Something went wrong (invalid token, disallowed origin, network…). */
  error: {
    /** Machine-readable code when the failure maps to an API error code. */
    code?: string;
    /** Human-readable description for logging. */
    message: string;
  };
  /**
   * The widget opened (`started`) or closed (`ended`) its payment step: the
   * secure card form a patient completes inside the frame before a visit the
   * clinic charges for goes ahead. Every surface can reach one — the agent
   * chat, an async consent, a telehealth waiting room, a booking — and
   * `ended` follows however the step closes: paid, backed out of, failed, a
   * session that expired under it, or the frame reloading.
   *
   * The frame is sized for a conversation and a checkout form is taller than
   * one, so the element presents itself as a modal dialog over the page
   * while the step is open, and puts itself back when it closes — nothing
   * for the host to do. This event is the only CANCELABLE one:
   * `preventDefault()` on `started` keeps the step inline, for a host that
   * presents it itself. Such a host must never move the element to another
   * parent: re-inserting an iframe reloads it, and the checkout in progress
   * goes with it.
   */
  payment: {
    /**
     * The consult being paid for. EMPTY when the surface has none to name —
     * a booking opened from the agent chat.
     */
    consultId: string;
    /** `started` when the payment step opens, `ended` when it closes. */
    phase: 'started' | 'ended';
  };
}

/**
 * DOM `CustomEvent` names dispatched on the custom element — each embed
 * event, `natzar:`-prefixed (namespaced so `error`/`message` cannot collide
 * with native DOM events).
 */
export type EmbedDomEventName = `${typeof EMBED_DOM_EVENT_PREFIX}${EmbedEventName}`;

/**
 * The `window.postMessage` envelope the embedded iframe sends to its host
 * page. The embed script consumes these and re-dispatches them as DOM
 * events; listen for the postMessage directly only if you are building your
 * own host-side plumbing instead of using the provided custom elements —
 * and always check `source === EMBED_MESSAGE_SOURCE` AND the message origin
 * before trusting one.
 *
 * @typeParam E - The event name; narrows `data` via {@link EmbedEventDetailMap}.
 */
export type EmbedPostMessage<E extends EmbedEventName = EmbedEventName> = {
  [K in E]: {
    /** Always {@link EMBED_MESSAGE_SOURCE}. */
    source: typeof EMBED_MESSAGE_SOURCE;
    /** The event name. */
    event: K;
    /** The event payload — same shape as the DOM event's `detail`. */
    data: EmbedEventDetailMap[K];
  };
}[E];
