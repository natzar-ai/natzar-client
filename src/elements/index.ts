/**
 * # @natzar/client/elements
 *
 * Types for the four tags the loader (`/natzar/embed.js`) defines —
 * `<natzar-async>`, `<natzar-telehealth>`, `<natzar-agent>` and
 * `<natzar-provider>` — their attributes, methods and DOM events. Types only:
 * importing this entry adds nothing to a bundle.
 *
 * ```ts
 * import type {} from '@natzar/client/elements';   // once, anywhere
 *
 * const el = document.querySelector('natzar-async')!;      // NatzarAsyncElement
 * el.addEventListener('natzar:message', (e) => bump(e.detail.consultId));   // typed detail
 * ```
 *
 * It augments `HTMLElementTagNameMap` (so `querySelector` / `createElement`
 * return the element types) and the global `JSX.IntrinsicElements` (Preact,
 * Solid, React ≤ 18 typings). React 19 keeps JSX under `React.JSX`: import
 * anything from `@natzar/client/react` and the four tags are typed in TSX
 * too.
 *
 * Event names are the contract's: patient `natzar:<name>` (12 events),
 * provider `natzar:provider:<name>` (11). Details carry ids, states and counts
 * only — never message text or names (D2, T12).
 *
 * @packageDocumentation
 */

import type {ElementErrorCode, PatientEventName, ProviderEventName, ProviderNavigationMode, ProviderView} from '../contract/sessions';
import type {PatientEventDetailMap, ProviderEventDetailMap, SessionGrant} from '../contract/sessions-schemas';
import type {SessionAsk} from '../broker';

export type {PatientEventDetailMap, ProviderEventDetailMap, PatientEventName, ProviderEventName, ProviderView, ProviderNavigationMode, ElementErrorCode};

/** `natzar:<name>` → the `CustomEvent` a patient tag dispatches. */
export type NatzarPatientEventMap = {
  [E in PatientEventName as `natzar:${E}`]: CustomEvent<Readonly<PatientEventDetailMap[E]>>;
};

/** `natzar:provider:<name>` → the `CustomEvent` the provider tag dispatches. */
export type NatzarProviderEventMap = {
  [E in ProviderEventName as `natzar:provider:${E}`]: CustomEvent<Readonly<ProviderEventDetailMap[E]>>;
};

/** Lifecycle of an element's connection. */
export type NatzarElementState = 'idle' | 'connecting' | 'connected' | 'signed_out' | 'expired' | 'error' | 'disconnected';

/** Manual mode (`manual` attribute): your callback returns the grant for each ask (mint and renew). */
export interface NatzarConnectOptions {
  getSession(ask: SessionAsk): Promise<SessionGrant> | SessionGrant;
}

/** Methods every tag has. */
export interface NatzarElementMethods {
  /** Manual mode only: connect with your own session source. */
  connect(options: NatzarConnectOptions): Promise<void>;
  /** Drop the session and the frame's state (no revoke). */
  disconnect(): void;
  /** Revoke this session (self-revoke), clear the UI. */
  logout(): Promise<{revoked: boolean}>;
  /** The connection state. */
  readonly state: NatzarElementState;
}

type Listener<M, K extends keyof M, E> = (this: E, ev: M[K]) => unknown;

/** `<natzar-async>`, `<natzar-telehealth>`, `<natzar-agent>`: light DOM, one iframe. */
export interface NatzarPatientElement extends HTMLElement, NatzarElementMethods {
  addEventListener<K extends keyof NatzarPatientEventMap>(type: K, listener: Listener<NatzarPatientEventMap, K, this>, options?: boolean | AddEventListenerOptions): void;
  addEventListener<K extends keyof HTMLElementEventMap>(type: K, listener: Listener<HTMLElementEventMap, K, this>, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  removeEventListener<K extends keyof NatzarPatientEventMap>(type: K, listener: Listener<NatzarPatientEventMap, K, this>, options?: boolean | EventListenerOptions): void;
  removeEventListener<K extends keyof HTMLElementEventMap>(type: K, listener: Listener<HTMLElementEventMap, K, this>, options?: boolean | EventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
}
/** `<natzar-async>`. */
export type NatzarAsyncElement = NatzarPatientElement;
/** `<natzar-telehealth>`. */
export type NatzarTelehealthElement = NatzarPatientElement;
/** `<natzar-agent>`. */
export type NatzarAgentElement = NatzarPatientElement;

/** `<natzar-provider>`: closed shadow root, sandboxed frame. */
export interface NatzarProviderElement extends HTMLElement, NatzarElementMethods {
  /** Whether leaving now loses work (a draft reply, a live call). */
  canLeave(): Promise<{canLeave: boolean; dirty: boolean; inCall: boolean}>;
  /** Navigate inside the session's scope. */
  navigate(target: ProviderEventDetailMap['navigation-request']['target']): Promise<{ok: true} | {ok: false; reason: 'out_of_scope' | 'dirty' | 'not_connected' | 'invalid_target'}>;
  /** Unsaved work in the frame. */
  readonly dirty: boolean;
  addEventListener<K extends keyof NatzarProviderEventMap>(type: K, listener: Listener<NatzarProviderEventMap, K, this>, options?: boolean | AddEventListenerOptions): void;
  addEventListener<K extends keyof HTMLElementEventMap>(type: K, listener: Listener<HTMLElementEventMap, K, this>, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  removeEventListener<K extends keyof NatzarProviderEventMap>(type: K, listener: Listener<NatzarProviderEventMap, K, this>, options?: boolean | EventListenerOptions): void;
  removeEventListener<K extends keyof HTMLElementEventMap>(type: K, listener: Listener<HTMLElementEventMap, K, this>, options?: boolean | EventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
}

/** Attributes shared by the four tags (all optional). */
export interface NatzarCommonAttributes {
  /** Your `natzar()` mount: a same-origin path (default `/natzar`). */
  endpoint?: string;
  /** No auto-connect; call `connect({getSession})`. Presence-only. */
  manual?: boolean | '';
  /** Narrow the session to one consult: `kind:id`, or an id of the tag's kind. Changing it rescopes in place. */
  consult?: string;
  /** Patient tags: which of the login's patients. Provider: patient mode. */
  patient?: string;
  /** `light`, `dark` or `auto` (follows `prefers-color-scheme` live). */
  theme?: 'light' | 'dark' | 'auto';
  /** `en`, `es`, `de`, `fr`, `it`. */
  locale?: 'en' | 'es' | 'de' | 'fr' | 'it';
  /** Hex color. */
  accent?: string;
  /** Corner radius in px (0–24). */
  radius?: string | number;
  id?: string;
  class?: string;
  className?: string;
  style?: unknown;
  slot?: string;
  hidden?: boolean;
}

/** `<natzar-async>`, `<natzar-telehealth>`, `<natzar-agent>` attributes (presentation applies in place). */
export interface NatzarPatientAttributes extends NatzarCommonAttributes {
  'accent-foreground'?: string;
  background?: string;
  surface?: string;
  'font-family'?: string;
}

/** `<natzar-provider>` attributes. */
export interface NatzarProviderAttributes extends NatzarCommonAttributes {
  /** The provider module (D13): `workspace` (default), `inbox`, `agenda`, `availability`. */
  view?: ProviderView;
  /** `module` (default) opens items inside the module; `host` emits `natzar:provider:open` instead. */
  navigation?: ProviderNavigationMode;
  /** Ask before the page unloads while work would be lost. Presence-only. */
  'guard-unload'?: boolean | '';
  density?: 'comfortable' | 'compact';
}

/** The four tags for a JSX `IntrinsicElements` interface. */
export interface NatzarIntrinsicElements {
  'natzar-async': NatzarPatientAttributes;
  'natzar-telehealth': NatzarPatientAttributes;
  'natzar-agent': NatzarPatientAttributes;
  'natzar-provider': NatzarProviderAttributes;
}

/** `window.natzarConfig`: read at each session request; must be a plain object. */
export interface NatzarConfig {
  /** Returns the bearer your `identify` receives as `ask.token` (Firebase, Auth0, Supabase ID tokens). */
  auth?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Your `natzar()` mount; here (script only) it may be an absolute https URL for a cross-origin API. */
  endpoint?: string;
}

declare global {
  interface HTMLElementTagNameMap {
    'natzar-async': NatzarAsyncElement;
    'natzar-telehealth': NatzarTelehealthElement;
    'natzar-agent': NatzarAgentElement;
    'natzar-provider': NatzarProviderElement;
  }
  interface Window {
    natzarConfig?: NatzarConfig;
  }
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface IntrinsicElements extends NatzarIntrinsicElements {}
  }
}
