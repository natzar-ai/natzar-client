// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
const locks = new WeakMap<Document, {count: number; overflow: string; gutter: string}>();

/** Questionnaire and payment surfaces can overlap briefly during a transition. */
export function lockGuestScroll(doc: Document): () => void {
  let state = locks.get(doc);
  if (!state) {
    state = {count: 0, overflow: doc.documentElement.style.overflow, gutter: doc.documentElement.style.scrollbarGutter};
    locks.set(doc, state);
    doc.documentElement.style.scrollbarGutter = 'stable';
    doc.documentElement.style.overflow = 'hidden';
  }
  state.count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--state.count > 0) return;
    doc.documentElement.style.overflow = state.overflow;
    doc.documentElement.style.scrollbarGutter = state.gutter;
    locks.delete(doc);
  };
}
