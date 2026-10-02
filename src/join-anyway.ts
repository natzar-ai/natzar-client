// D12 "Join anyway" (plan §4.11), shared by both browser entry points.
//
// A video join on a session that would end before the call answers
// `409 session_renewal_required {needSeconds, joinAnywayAllowed}`. The SDK
// first switches to a fresh session and retries once, by itself. When YOUR
// login is the limit (`joinAnywayAllowed`), a fresh session could not help:
// the join's error reaches you, and the user may choose to join anyway on the
// current session — retry the join with `acceptShortSession: true`. The
// server honours the flag only in exactly that case.

import {isNatzarApiError} from './errors';

/** What a refused join says about Join anyway. */
export interface JoinAnyway {
  /** Seconds of session lifetime the join needed. */
  needSeconds: number;
  /** Your login is the limit: offer "Join anyway" and retry with `acceptShortSession: true`. */
  joinAnywayAllowed: boolean;
}

/**
 * The Join-anyway facts of a join's error, or null when the error is not a
 * `session_renewal_required` refusal.
 *
 * ```ts
 * try {
 *   await care.telehealth.join(id);
 * } catch (e) {
 *   const short = joinAnywayOf(e);
 *   if (short?.joinAnywayAllowed && (await askUser(short.needSeconds))) await care.telehealth.join(id, {acceptShortSession: true});
 * }
 * ```
 */
export function joinAnywayOf(error: unknown): JoinAnyway | null {
  if (!isNatzarApiError(error) || error.code !== 'session_renewal_required') return null;
  const d = error.details as {needSeconds?: unknown; joinAnywayAllowed?: unknown} | null | undefined;
  const needSeconds = typeof d?.needSeconds === 'number' && Number.isFinite(d.needSeconds) ? d.needSeconds : 0;
  return {needSeconds, joinAnywayAllowed: d?.joinAnywayAllowed === true};
}
