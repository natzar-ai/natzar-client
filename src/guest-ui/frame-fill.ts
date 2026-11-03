// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
// Patient tag sizing (owner decision, RG4 2026-10-01): on phones the widget
// uses the WHOLE available height, its bottom (composer, call controls,
// actions) at the bottom of the visible viewport; on wider viewports the
// default heights stay 560 px (`natzar-async`, `natzar-agent`) and 640 px
// (`natzar-telehealth`).
//
// - The defaults are ONE adopted document stylesheet of zero-specificity
//   `:where(…)` rules: any rule of the customer's own CSS (`height`,
//   `display`, `width`) wins. Constructable stylesheets are CSSOM, so a
//   strict page CSP without 'unsafe-inline' still applies them.
// - Phones: `(max-width: 640px)` — the frames' own one-column breakpoint
//   (Tailwind `sm`), phones in portrait — or a short touch viewport,
//   `(max-height: 500px) and (pointer: coarse)` — phones in landscape
//   (orchestrator decision A11; desktop and tablets unchanged); the height is
//   `var(--natzar-fill-height, 100svh)`.
// - `--natzar-fill-height` is kept on each patient element: the visible
//   viewport (`visualViewport.height`, which shrinks when the on-screen
//   keyboard opens) minus the element's distance from the top of the page
//   when that distance is within the first screen (a header above the
//   widget), else the whole visible viewport (the widget scrolled into view
//   fills it). At least 480 px (at most 60 % of the visible viewport) when
//   the element starts low on the first screen; never taller than the
//   visible viewport (the bottom must stay above the keyboard). Recomputed once per
//   animation frame at most, on resize, orientationchange, visualViewport
//   resize/scroll, load and connection; reads are batched before writes and
//   unchanged values are not rewritten; nothing runs on wide viewports.
// - `color-scheme: light dark` on the tags (RG4B B11), inherited by the
//   iframe: Firefox resolves a frame's `prefers-color-scheme` from the used
//   color-scheme of its iframe element, so a page declaring
//   `:root{color-scheme:light}` would otherwise force `theme="auto"` frames
//   light whatever the system says. The frame paints its own background;
//   the page can still override it (zero specificity).

/** Phones: portrait (narrow) or landscape (a short touch viewport). */
export const FILL_MEDIA = '(max-width: 640px), (max-height: 500px) and (pointer: coarse)';
/** The smallest fill height when the visible viewport has room for it. */
export const FILL_MIN_PX = 480;

/** The default sizing of the patient tags (zero specificity: the page's own CSS wins). */
export const FILL_CSS =
  ':where(natzar-async,natzar-agent,natzar-telehealth){display:block;width:100%;height:560px;color-scheme:light dark}'
  + ':where(natzar-telehealth){height:640px}'
  + `@media ${FILL_MEDIA}{:where(natzar-async,natzar-agent,natzar-telehealth){height:var(--natzar-fill-height,100svh)}}`;

/**
 * The fill height in CSS px: `viewport − top` while the element starts within
 * the first screen of the page (`top` = its distance from the top of the
 * document) — its bottom then lands on the visible bottom without scrolling,
 * header above it or not, keyboard open or not — unless that leaves less than
 * a usable minimum (FILL_MIN_PX, at most 60 % of the visible viewport), when
 * it is that minimum (the user scrolls); an element further down fills the
 * whole visible viewport once scrolled into view. Never taller than the
 * visible viewport.
 */
export function fillHeight(viewportHeight: number, documentTop: number): number {
  const vh = Math.max(0, Math.floor(viewportHeight));
  const top = Math.max(0, documentTop);
  if (top >= vh) return vh;
  const room = Math.round(vh - top);
  const min = Math.min(FILL_MIN_PX, Math.round(vh * 0.6));
  return room >= min ? room : min;
}

type FillWindow = Window & typeof globalThis;

/** Keeps `--natzar-fill-height` of the tracked elements up to date (one instance per page). */
export function createFillTracker(win: FillWindow): {add(el: HTMLElement): void; remove(el: HTMLElement): void} {
  const els = new Set<HTMLElement>();
  const media = win.matchMedia?.(FILL_MEDIA) ?? null;
  let frame = 0;
  let listening = false;
  const last = new WeakMap<HTMLElement, string>();
  const update = () => {
    frame = 0;
    if (!media?.matches) return;
    const vv = win.visualViewport;
    const vh = vv ? vv.height : win.innerHeight;
    // Every read first, then only the writes that change something (N4: one layout per frame, no rewrite on scroll).
    const next = Array.from(els, (el) => [el, `${fillHeight(vh, el.getBoundingClientRect().top + win.scrollY)}px`] as const);
    for (const [el, v] of next) {
      if (last.get(el) === v) continue;
      last.set(el, v);
      el.style.setProperty('--natzar-fill-height', v);
    }
  };
  const schedule = () => {
    if (frame === 0) frame = win.requestAnimationFrame(update);
  };
  const targets: Array<[EventTarget | null | undefined, string]> = [
    [win, 'resize'], [win, 'orientationchange'], [win, 'load'], [win.visualViewport, 'resize'], [win.visualViewport, 'scroll'], [media, 'change'],
  ];
  const listen = (on: boolean) => {
    if (on === listening) return;
    listening = on;
    for (const [t, type] of targets) t?.[on ? 'addEventListener' : 'removeEventListener'](type, schedule, {passive: true} as AddEventListenerOptions);
  };
  return {
    add(el) {
      els.add(el);
      listen(true);
      schedule();
    },
    remove(el) {
      els.delete(el);
      if (els.size === 0) listen(false);
    },
  };
}

/**
 * Adopts `sheet` (or a new constructable sheet of `css`) into `target`, a
 * document or a shadow root, unless already there; the sheet, or null when
 * constructable stylesheets are unsupported. CSSOM, not a `<style>` element:
 * a strict page CSP without 'unsafe-inline' still applies it, and nothing is
 * added to the page's DOM. Shared by the sizing defaults, the provider's
 * `:host` sheet and the payment dialog.
 */
export function adopt(target: DocumentOrShadowRoot, css: string, sheet?: CSSStyleSheet | null): CSSStyleSheet | null {
  try {
    let s = sheet;
    if (!s) {
      const doc = (target as unknown as Node).ownerDocument ?? (target as unknown as Document);
      s = new (doc.defaultView as FillWindow).CSSStyleSheet();
      s.replaceSync(css);
    }
    if (!target.adoptedStyleSheets.includes(s)) target.adoptedStyleSheets = [...target.adoptedStyleSheets, s];
    return s;
  } catch {
    return null;
  }
}

/** Adopts the default sizing sheet into the page once (false when constructable stylesheets are unsupported). */
export const adoptFillSheet = (win: FillWindow): boolean => adopt(win.document, FILL_CSS) !== null;
