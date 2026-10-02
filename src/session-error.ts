// The one error both browser-side surfaces (`./patient`, `./physician`) throw
// when a session cannot be used at all — before any request is attempted.
//
// Defined once, here, rather than per surface: a partner's `catch` should not
// have to know which entry point a session came from to recognise "this is a
// wiring mistake, not a network or API failure". Shared by both entry points
// without dragging either surface's transport into the other's bundle.

import type {ElementErrorCode} from './contract/sessions';

/**
 * Thrown when a session is unusable: before any network call (a wiring
 * mistake), or when the session broker gave up (the user signed out on your
 * site, the endpoint is misplaced, a grant failed its checks). `code` is one
 * of the element error codes (`signed_out`, `endpoint_misconfigured`,
 * `unseal_failed`, …) whenever the broker raised it; branch on it, never on
 * `message`.
 */
export class NatzarSessionError extends Error {
  override readonly name = 'NatzarSessionError';
  /** Machine-readable reason, when the session broker raised this. */
  readonly code?: ElementErrorCode;

  constructor(message: string, code?: ElementErrorCode) {
    super(message);
    if (code !== undefined) this.code = code;
  }
}

/** True for a {@link NatzarSessionError}, across realms (no instanceof trap). */
export function isNatzarSessionError(e: unknown): e is NatzarSessionError {
  return !!e && typeof e === 'object' && (e as {name?: string}).name === 'NatzarSessionError';
}
