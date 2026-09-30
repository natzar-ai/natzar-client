// The physician surface's OWN refusals — raised by `@natzar/client/physician`
// before any request is made, when a convenience method has nothing to act
// on. Same reasoning as `../patient/codes`: its own module so `../errors` can
// name the type without importing the surface, and deliberately NOT folded
// into the contract's `ErrorCode` (no REST response carries these spellings,
// and `ERROR_HTTP_STATUS` there is exhaustive over that union).

export const PHYSICIAN_SURFACE_CODES = [
  // `inbox.generateReferrals` with `drafts: []` (nothing selected), or
  // without `drafts` on a consult that carries no `suggestedReferrals` —
  // open the blank composer instead.
  'no_suggested_referrals',
] as const;

/** A refusal the physician surface raises itself, before any request. */
export type PhysicianSurfaceErrorCode = (typeof PHYSICIAN_SURFACE_CODES)[number];
