// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
// The patient payment dialog (F11, F34, BS-8; owner-confirmed 2026-09-29):
// while a widget's payment step is open (`natzar:payment` `started`, not
// cancelled by the host), its frame is presented as a modal dialog in the
// browser's top layer over the WHOLE page (a desktop dialog, a phone bottom
// sheet), with the rest of the page inert and its scrolling locked; `ended`
// puts it back. The iframe is never moved (re-inserting an iframe reloads
// it and the checkout would go with it): its two wrappers, created with it,
// are what goes into the top layer. Where the Popover API is missing the
// step stays inline. Kept from the v1 loader (frontend/partner-embed/elements.ts).

import {adopt} from './frame-fill';

const OVERLAY_CLASS = 'natzar-embed-overlay';
const PANEL_CLASS = 'natzar-embed-panel';

// Sizes are !important because both wrappers' inline 100% × 100% must lose while lifted. Phones get a bottom sheet.
const DIALOG_CSS = `.${OVERLAY_CLASS}:popover-open{width:auto!important;height:auto!important;margin:0;padding:16px;border:0;display:flex;align-items:center;justify-content:center;overflow:hidden;background:rgba(15,23,42,.55);animation:natzar-embed-fade .2s ease both}`
  + `.${OVERLAY_CLASS}:popover-open>.${PANEL_CLASS}{width:min(760px,100%)!important;height:min(900px,100%)!important;border-radius:16px;overflow:hidden;box-shadow:0 24px 64px rgba(15,23,42,.32);animation:natzar-embed-rise .2s ease both}`
  + `@media (max-width:640px){.${OVERLAY_CLASS}:popover-open{padding:0;align-items:flex-end}.${OVERLAY_CLASS}:popover-open>.${PANEL_CLASS}{width:100%!important;height:94dvh!important;border-radius:16px 16px 0 0}}`
  + `@media (prefers-reduced-motion:reduce){.${OVERLAY_CLASS}:popover-open,.${OVERLAY_CLASS}:popover-open>.${PANEL_CLASS}{animation:none}}`
  + '@keyframes natzar-embed-rise{from{opacity:0;transform:translateY(12px)}}@keyframes natzar-embed-fade{from{opacity:0}}';

// The dialog's accessible name, in the widget's language (the locale attribute, else the browser's).
const DIALOG_LABEL: Record<string, string> = {en: 'Payment', fr: 'Paiement', es: 'Pago', de: 'Zahlung', it: 'Pagamento'};

let dialogSheet: CSSStyleSheet | null = null;

/**
 * Adopted into the page on first use: a constructable sheet, not a `<style>`
 * tag, so nothing is added to the page's DOM and a strict CSP has no inline
 * style to refuse. Re-checked on every use (the page may replace its sheets).
 */
function adoptDialogStyles(doc: Document): void {
  dialogSheet = adopt(doc, DIALOG_CSS, dialogSheet);
}

/** Everything outside `keep` inert (the siblings of each ancestor up to `<body>`); returns the undo. */
function inertOthers(keep: Element): () => void {
  const touched: HTMLElement[] = [];
  const body = keep.ownerDocument.body;
  for (let node: Element | null = keep; node && node !== body; node = node.parentElement) {
    for (const sibling of Array.from(node.parentElement?.children ?? [])) {
      if (sibling === node || !(sibling instanceof keep.ownerDocument.defaultView!.HTMLElement) || sibling.inert) continue;
      sibling.inert = true;
      touched.push(sibling);
    }
  }
  return () => {
    for (const el of touched) el.inert = false;
  };
}

/** Pins whatever scrolls behind `keep` (its scrolling ancestors and the document); returns the undo. */
function lockScroll(keep: Element): () => void {
  const doc = keep.ownerDocument;
  const view = doc.defaultView!;
  const root = doc.documentElement;
  const pinned: Array<[HTMLElement, string, string]> = [];
  for (let node = keep.parentElement; node; node = node.parentElement) {
    const style = view.getComputedStyle(node);
    const scrolls = node === root
      ? root.scrollHeight > root.clientHeight
      : (style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight;
    if (!scrolls) continue;
    const bar = node === root
      ? view.innerWidth - root.clientWidth
      : node.offsetWidth - node.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth);
    pinned.push([node, node.style.overflow, node.style.scrollbarGutter]);
    if (bar > 0) node.style.scrollbarGutter = 'stable';
    node.style.overflow = 'hidden';
  }
  return () => {
    for (const [node, overflow, gutter] of pinned) {
      node.style.overflow = overflow;
      node.style.scrollbarGutter = gutter;
    }
  };
}

/** The patient frame's light-DOM wrappers and its dialog controls. */
export interface PatientFrameShell {
  overlay: HTMLDivElement;
  panel: HTMLDivElement;
  present(iframe: HTMLIFrameElement, locale: string | null): void;
  dismiss(): void;
}

/** Creates the overlay and panel (inline 100% × 100%, the iframe goes into the panel) and the dialog controls. */
export function createPatientFrameShell(doc: Document, existing?: {overlay: HTMLDivElement; panel: HTMLDivElement}): PatientFrameShell {
  const panel = existing?.panel ?? doc.createElement('div');
  panel.className = PANEL_CLASS;
  const overlay = existing?.overlay ?? doc.createElement('div');
  overlay.className = OVERLAY_CLASS;
  for (const wrapper of [panel, overlay]) {
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';
  }
  if (panel.parentElement !== overlay) overlay.appendChild(panel);
  let undo: (() => void) | null = null;
  let frame: HTMLIFrameElement | null = null;
  // A click on the dimmed area around the dialog takes focus out of the frame; hand it back (the step's Escape keeps working).
  overlay.addEventListener('click', (event) => {
    if (undo && event.target === overlay) frame?.focus({preventScroll: true});
  });
  return {
    overlay,
    panel,
    present(iframe, locale) {
      const view = doc.defaultView;
      if (undo || !view || !('showPopover' in view.HTMLElement.prototype)) return;
      frame = iframe;
      adoptDialogStyles(doc);
      overlay.popover = 'manual';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      const base = (locale ?? view.navigator.language ?? 'en').slice(0, 2).toLowerCase();
      overlay.setAttribute('aria-label', DIALOG_LABEL[base] ?? DIALOG_LABEL.en);
      overlay.showPopover();
      iframe.focus({preventScroll: true});
      const restoreInert = inertOthers(overlay);
      const restoreScroll = lockScroll(overlay);
      undo = () => {
        restoreScroll();
        restoreInert();
        if (overlay.matches(':popover-open')) overlay.hidePopover();
        for (const attr of ['popover', 'role', 'aria-modal', 'aria-label']) overlay.removeAttribute(attr);
      };
    },
    dismiss() {
      const u = undo;
      undo = null;
      u?.();
    },
  };
}
