/**
 * # @natzar/client/react
 *
 * The four tags as React components. Each one injects the loader
 * (`/natzar/embed.js`, from your `natzar()` mount) once, renders the tag, keeps
 * its attributes in sync and maps the colon-named DOM events React cannot
 * bind (`natzar:message`, `natzar:provider:unread-change`, …) to typed props.
 *
 * ```tsx
 * import {NatzarAsync, NatzarProvider} from '@natzar/client/react';
 *
 * <NatzarAsync onMessage={bumpBadge} />                    // patient page
 * <NatzarProvider guardUnload onUnreadChange={({count}) => setTitle(count)} />   // clinician page
 * ```
 *
 * Every handler receives `(detail, event)`: the detail is ids, states and
 * counts only; `event` is the `CustomEvent`, for the two cancelable events
 * (`onPayment` phase `started`, `onSwitchRequest`) call `event.preventDefault()`.
 *
 * A `ref` gives the element itself (`logout()`, `canLeave()`, `navigate()`…).
 * React is a peer dependency; nothing here runs on the server beyond
 * rendering the tag.
 *
 * @packageDocumentation
 */

import {createElement, forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties, type DetailedHTMLProps, type HTMLAttributes, type ReactElement, type Ref} from 'react';
import {
  EMBED_TAG_AGENT,
  EMBED_TAG_ASYNC,
  EMBED_TAG_TELEHEALTH,
} from '../contract/embed';
import {PROVIDER_EMBED_ELEMENT_TAG} from '../contract/provider-embed';
import {
  ENDPOINT_DEFAULT_PATH,
  PATIENT_EVENT_NAMES,
  PROVIDER_EVENT_NAMES,
  endpointRouteUrl,
  isConfigEndpoint,
  isEndpointPath,
  type PatientEventName,
  type ProviderEventName,
  type ProviderNavigationMode,
  type ProviderView,
} from '../contract/sessions';
import type {PatientEventDetailMap, ProviderEventDetailMap} from '../contract/sessions-schemas';
import type {
  NatzarAgentElement,
  NatzarAsyncElement,
  NatzarPatientAttributes,
  NatzarProviderAttributes,
  NatzarProviderElement,
  NatzarTelehealthElement,
} from '../elements/index';

export type {
  NatzarAgentElement,
  NatzarAsyncElement,
  NatzarProviderElement,
  NatzarTelehealthElement,
  PatientEventDetailMap,
  ProviderEventDetailMap,
  ProviderView,
  ProviderNavigationMode,
};

// ------------------------------------------------------------------ props

type Camel<S extends string> = S extends `${infer H}-${infer T}` ? `${H}${Capitalize<Camel<T>>}` : S;
type HandlerName<E extends string> = `on${Capitalize<Camel<E>>}`;

/** `onReady`, `onMessage`, `onPayment`, … — one per patient event. */
export type NatzarPatientEventProps = {
  [E in PatientEventName as HandlerName<E>]?: (detail: Readonly<PatientEventDetailMap[E]>, event: CustomEvent<Readonly<PatientEventDetailMap[E]>>) => void;
};

/** `onReady`, `onUnreadChange`, `onOpen`, `onSwitchRequest`, … — one per provider event. */
export type NatzarProviderEventProps = {
  [E in ProviderEventName as HandlerName<E>]?: (detail: Readonly<ProviderEventDetailMap[E]>, event: CustomEvent<Readonly<ProviderEventDetailMap[E]>>) => void;
};

/** Props every component takes. */
export interface NatzarCommonProps {
  /** Your `natzar()` mount (a same-origin path). Default `window.natzarConfig.endpoint`, else `/natzar`. */
  endpoint?: string;
  /** No auto-connect: call `ref.current.connect({getSession})`. */
  manual?: boolean;
  /** Narrow to one consult (`kind:id` or an id of the tag's kind). Changing it rescopes in place. */
  consult?: string;
  /** Patient tags: which of the login's patients. Provider: patient mode. */
  patient?: string;
  theme?: 'light' | 'dark' | 'auto';
  locale?: 'en' | 'es' | 'de' | 'fr' | 'it';
  /** Hex color. */
  accent?: string;
  /** Corner radius in px (0–24). */
  radius?: number;
  /**
   * The loader script to inject. Default `{endpoint}/embed.js`; pass a pinned
   * URL (strict CSP / SRI), or `false` when you load it yourself.
   */
  loader?: string | false;
  id?: string;
  className?: string;
  style?: CSSProperties;
}

/** `<NatzarAsync>`, `<NatzarTelehealth>`, `<NatzarAgent>`. */
export interface NatzarPatientProps extends NatzarCommonProps, NatzarPatientEventProps {
  accentForeground?: string;
  background?: string;
  surface?: string;
  fontFamily?: string;
}

/** `<NatzarProvider>`. */
export interface NatzarProviderProps extends NatzarCommonProps, NatzarProviderEventProps {
  /** The provider module (D13): `workspace` (default), `inbox`, `agenda`, `availability`. */
  view?: ProviderView;
  /** `module` (default) or `host` (clicks become `onOpen({kind, consultId})`). */
  navigation?: ProviderNavigationMode;
  /** Ask before the page unloads while work would be lost. */
  guardUnload?: boolean;
  density?: 'comfortable' | 'compact';
}

// ----------------------------------------------------------------- loader

const injected = new Set<string>();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * The loader URL for an `endpoint` prop: the prop when it is a valid
 * same-origin path, else `window.natzarConfig.endpoint` (a plain object only —
 * a DOM-clobbered `natzarConfig` is ignored), else `/natzar`.
 */
export function natzarLoaderSrc(endpoint?: string): string {
  if (isEndpointPath(endpoint)) return endpointRouteUrl(endpoint, 'embed.js');
  const config = typeof window === 'undefined' ? undefined : (window as {natzarConfig?: unknown}).natzarConfig;
  const fromConfig = isPlainObject(config) ? config.endpoint : undefined;
  return endpointRouteUrl(isConfigEndpoint(fromConfig, {production: false}) ? fromConfig : ENDPOINT_DEFAULT_PATH, 'embed.js');
}

/**
 * Add the loader `<script async>` once per URL (and not at all when the tag is
 * already defined or the same script is on the page). Safe to call on every
 * render; a no-op without a document (SSR).
 */
export function ensureNatzarLoader(src: string, tag?: string, doc: Document | undefined = typeof document === 'undefined' ? undefined : document): void {
  if (!doc || injected.has(src)) return;
  const registry = (globalThis as {customElements?: {get(name: string): unknown}}).customElements;
  if (tag && registry?.get(tag)) return;
  for (const s of Array.from(doc.getElementsByTagName('script'))) {
    if (s.getAttribute('src') === src) {
      injected.add(src);
      return;
    }
  }
  const append = (attempt: number) => {
    const script = doc.createElement('script');
    script.src = src;
    script.async = true;
    script.setAttribute('data-natzar-loader', '');
    script.addEventListener('error', () => {
      script.remove();
      injected.delete(src);
      // A transient CDN/network failure gets one fresh request. A later mount
      // can retry after both attempts fail; failures never poison this cache.
      if (attempt === 0) append(1);
    }, {once: true});
    injected.add(src);
    (doc.head ?? doc.body ?? doc.documentElement).appendChild(script);
  };
  append(0);
}

// ------------------------------------------------------- the one component

type AttrValue = string | number | boolean | undefined | null;

/**
 * Keep attributes as attributes: presence-only booleans (`manual`,
 * `guard-unload`) set to `''` or removed, never `"false"`; React 19 would
 * otherwise set a same-named PROPERTY once the element upgraded.
 *
 * @internal exported for tests
 */
export function syncAttributes(el: Element, attrs: Record<string, AttrValue>): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) {
      if (el.hasAttribute(name)) el.removeAttribute(name);
    } else {
      const text = value === true ? '' : String(value);
      if (el.getAttribute(name) !== text) el.setAttribute(name, text);
    }
  }
}

/**
 * Bind the colon-named events to the LATEST handlers (read at dispatch time,
 * so a re-render never rebinds). Returns the unbind.
 *
 * @internal exported for tests
 */
export function bindNatzarEvents(
  el: EventTarget,
  events: ReadonlyArray<readonly [type: string, prop: string]>,
  handlers: () => Record<string, unknown>,
): () => void {
  const offs = events.map(([type, prop]) => {
    const listener = (e: Event) => {
      const fn = handlers()[prop];
      if (typeof fn === 'function') fn((e as CustomEvent).detail, e);
    };
    el.addEventListener(type, listener);
    return () => el.removeEventListener(type, listener);
  });
  return () => offs.forEach((off) => off());
}

const handlerName = (name: string): string =>
  `on${name.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')}`;

/** `natzar:<name>` → `onName`, for the patient tags. @internal */
export const PATIENT_EVENT_PROPS: ReadonlyArray<readonly [string, string]> = PATIENT_EVENT_NAMES.map((n) => [`natzar:${n}`, handlerName(n)] as const);
/** `natzar:provider:<name>` → `onName`, for the provider tag. @internal */
export const PROVIDER_EVENT_PROPS: ReadonlyArray<readonly [string, string]> = PROVIDER_EVENT_NAMES.map((n) => [`natzar:provider:${n}`, handlerName(n)] as const);

function useNatzarElement<El extends HTMLElement>(
  tag: string,
  props: NatzarCommonProps & Record<string, unknown>,
  attrs: Record<string, AttrValue>,
  events: ReadonlyArray<readonly [string, string]>,
  forwarded: Ref<El>,
): ReactElement {
  const ref = useRef<El | null>(null);
  const latest = useRef(props);
  latest.current = props;
  useImperativeHandle(forwarded, () => ref.current as El, []);

  const {loader, endpoint} = props;
  useEffect(() => {
    if (loader === false) return;
    ensureNatzarLoader(typeof loader === 'string' ? loader : natzarLoaderSrc(endpoint), tag);
  }, [loader, endpoint, tag]);

  useEffect(() => {
    if (ref.current) syncAttributes(ref.current, attrs);
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    return bindNatzarEvents(el, events, () => latest.current as Record<string, unknown>);
  }, [events]);

  // Presence booleans go to React as `true` (RG5 S6): React 19 then sets the
  // attribute to "" on an undefined element and the PROPERTY to `true` on an
  // upgraded one (never a falsy ""), React 18 renders a present attribute.
  const initial: Record<string, string | true> = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    initial[name] = value === true ? true : String(value);
  }
  return createElement(tag, {
    ref,
    ...initial,
    ...(props.id !== undefined ? {id: props.id} : {}),
    ...(props.className !== undefined ? {className: props.className} : {}),
    ...(props.style !== undefined ? {style: props.style} : {}),
  });
}

const commonAttrs = (p: NatzarCommonProps): Record<string, AttrValue> => ({
  endpoint: p.endpoint,
  manual: p.manual === true,
  consult: p.consult,
  patient: p.patient,
  theme: p.theme,
  locale: p.locale,
  accent: p.accent,
  radius: p.radius,
});

const patientAttrs = (p: NatzarPatientProps): Record<string, AttrValue> => ({
  ...commonAttrs(p),
  'accent-foreground': p.accentForeground,
  background: p.background,
  surface: p.surface,
  'font-family': p.fontFamily,
});

function patientComponent<El extends HTMLElement>(tag: string, displayName: string) {
  const Component = forwardRef<El, NatzarPatientProps>(function NatzarPatientTag(props, forwarded) {
    return useNatzarElement<El>(tag, props as NatzarPatientProps & Record<string, unknown>, patientAttrs(props), PATIENT_EVENT_PROPS, forwarded);
  });
  Component.displayName = displayName;
  return Component;
}

/** `<natzar-async>`: the async consult (chat with the physician, consent, attachments, rating, payment). */
export const NatzarAsync = patientComponent<NatzarAsyncElement>(EMBED_TAG_ASYNC, 'NatzarAsync');
/** `<natzar-telehealth>`: video with booking and the waiting room. */
export const NatzarTelehealth = patientComponent<NatzarTelehealthElement>(EMBED_TAG_TELEHEALTH, 'NatzarTelehealth');
/** `<natzar-agent>`: the AI agent, the patient hub (escalation, async and video inside the same frame). */
export const NatzarAgent = patientComponent<NatzarAgentElement>(EMBED_TAG_AGENT, 'NatzarAgent');

/** `<natzar-provider>`: the clinician workspace, or one module of it (`view`). */
export const NatzarProvider = forwardRef<NatzarProviderElement, NatzarProviderProps>(function NatzarProvider(props, forwarded) {
  return useNatzarElement<NatzarProviderElement>(
    PROVIDER_EMBED_ELEMENT_TAG,
    props as NatzarProviderProps & Record<string, unknown>,
    {
      ...commonAttrs(props),
      view: props.view,
      navigation: props.navigation,
      'guard-unload': props.guardUnload === true,
      density: props.density,
    },
    PROVIDER_EVENT_PROPS,
    forwarded,
  );
});
NatzarProvider.displayName = 'NatzarProvider';

// ------------------------------------------- React 19 JSX for the raw tags

type ReactTag<El extends HTMLElement, A> = DetailedHTMLProps<HTMLAttributes<El>, El> & Omit<A, 'style' | 'class' | 'className' | 'id' | 'hidden' | 'slot'>;

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'natzar-async': ReactTag<NatzarAsyncElement, NatzarPatientAttributes>;
      'natzar-telehealth': ReactTag<NatzarTelehealthElement, NatzarPatientAttributes>;
      'natzar-agent': ReactTag<NatzarAgentElement, NatzarPatientAttributes>;
      'natzar-provider': ReactTag<NatzarProviderElement, NatzarProviderAttributes>;
    }
  }
}
