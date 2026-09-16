// The one error both browser-side surfaces (`./patient`, `./physician`) throw
// when a session cannot be used at all — before any request is attempted.
//
// Defined once, here, rather than per surface: a partner's `catch` should not
// have to know which entry point a session came from to recognise "this is a
// wiring mistake, not a network or API failure". Shared by both entry points
// without dragging either surface's transport into the other's bundle.

/** Thrown when a session is unusable, before any network call is attempted. */
export class NatzarSessionError extends Error {
  override readonly name = 'NatzarSessionError';
}
