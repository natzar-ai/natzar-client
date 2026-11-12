// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
// The newest message stays in view when the frame's height changes (owner
// decision, RG4 2026-10-01). On a phone the loader sizes the widget to the
// visible viewport, so opening the on-screen keyboard SHRINKS the frame: the
// transcript gets shorter from the bottom and, left alone, the last messages
// would slide under the composer. A patient who was reading the end of the
// conversation stays at the end; one who had scrolled up to read something
// older is left where they were.

import {useEffect, useRef, type RefObject} from 'react';

/** How close to the end still counts as "at the end" (a bubble's margin, a rounding pixel). */
export const NEAR_BOTTOM_PX = 48;

/** Whether a scroll region shows its end (within {@link NEAR_BOTTOM_PX}). */
export function nearBottom(el: {scrollTop: number; clientHeight: number; scrollHeight: number}, slackPx = NEAR_BOTTOM_PX): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= slackPx;
}

/**
 * Keeps the end of `ref`'s scroll region in view across height changes of
 * the region itself (keyboard, rotation, the loader's fill height) when it
 * was at the end before. Re-binds when the element behind `ref` changes
 * (a surface that mounts its transcript later).
 */
export function useKeepNewestInView(ref: RefObject<HTMLElement | null>): void {
  const bound = useRef<{el: HTMLElement; stop: () => void} | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (bound.current?.el === el) return;
    bound.current?.stop();
    bound.current = null;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let atEnd = nearBottom(el);
    let height = el.clientHeight;
    const onScroll = () => {
      atEnd = nearBottom(el);
    };
    const observer = new ResizeObserver(() => {
      if (el.clientHeight === height) return;
      height = el.clientHeight;
      if (atEnd) el.scrollTop = el.scrollHeight;
    });
    el.addEventListener('scroll', onScroll, {passive: true});
    observer.observe(el);
    bound.current = {
      el,
      stop: () => {
        observer.disconnect();
        el.removeEventListener('scroll', onScroll);
      },
    };
  });
  useEffect(
    () => () => {
      bound.current?.stop();
      bound.current = null;
    },
    [],
  );
}
