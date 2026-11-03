// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
/** Scroll only the questionnaire (or option list), never its host website. */
export function visibleFormBounds(container: HTMLElement, margin = 8) {
  const rect = container.getBoundingClientRect();
  const win = container.ownerDocument.defaultView;
  const viewport = win?.visualViewport;
  return {
    top: Math.max(rect.top, viewport?.offsetTop ?? 0) + margin,
    bottom: Math.min(rect.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? win?.innerHeight ?? rect.bottom)) - margin,
  };
}

export function revealWithin(container: HTMLElement | null, element: HTMLElement | null, margin = 8) {
  if (!container || !element) return;
  const box = visibleFormBounds(container, margin), target = element.getBoundingClientRect();
  if (target.top < box.top || target.height > box.bottom - box.top) container.scrollTop += target.top - box.top;
  else if (target.bottom > box.bottom) container.scrollTop += target.bottom - box.bottom;
}

export function focusFormField(element: HTMLElement | null) {
  if (!element?.isConnected || !element.getClientRects().length) return;
  element.focus({preventScroll: true});
  revealWithin(element.closest<HTMLElement>('.guest-overlay-body'), element, 12);
}
