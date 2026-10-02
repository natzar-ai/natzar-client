// The refusal vocabulary of the embed surface, verbatim from embed-api and the
// booking/consent/prescription cores it calls. Anything outside this list is
// reported as `internal_error` rather than passed through, so a partner never
// ends up branching on a string the surface emitted once by accident.
//
// Its own module (not `transport.ts`) so `../errors` can name the type
// without importing the transport: `NatzarApiError.code` is the union of this
// and the REST contract's `ErrorCode`, and the two halves throw the same class.
//
// Deliberately NOT folded into the contract's `ErrorCode`: `ERROR_HTTP_STATUS`
// there is exhaustive over that union, and the REST plane never emits these
// spellings (it maps `not_choosable` onto `prescription_not_choosable`), so
// widening it would force fake statuses for codes no REST response carries.

export const PATIENT_SURFACE_CODES = [
  // The `nz1` session (every operation checks it): `session_expired` is
  // renewed and retried by the SDK; the rest end the session — `revoked`,
  // `ended` and `invalid` get a new one (your `identify` runs again),
  // `locked` and `embedding_disabled` stick. `session_renewal_required`
  // (409) is a video join that needs a fresher session (§4.11);
  // `not_in_view` is outside the session's scope.
  'session_expired',
  'session_invalid',
  'session_ended',
  'session_revoked',
  'session_locked',
  'embedding_disabled',
  'session_renewal_required',
  'origin_not_allowed',
  'not_found',
  'thread_not_active',
  'already_rated',
  'already_closed',
  'invalid_request',
  'internal_error',
  'not_ended',
  'not_rateable',
  'not_closed',
  'invalid_rating',
  'empty_rating',
  // Attachments (embedUploadUrls).
  'unsupported_type',
  'file_too_large',
  // Video (embedConsultJoin / embedAppointmentBeat).
  'livekit_unconfigured',
  'expired',
  // Scheduled consultations (embedBookingSlots / embedBook / embedCancelBooking).
  'booking_disabled',
  'too_many_open_bookings',
  'slot_taken',
  'slot_unavailable',
  'too_late_to_cancel',
  'not_booked',
  'already_started',
  'wrong_modality',
  // Payment gate (embedAgentConsent / embedAsyncConsent / embedConsultJoin /
  // embedBook) — the tenant charges for this scenario;
  // `details.amountCents`/`currency`/`modality`/`mode` ride on
  // `payment_required`. Ask with `checkout: true` (respond / join / book) and
  // the refusal carries `details.checkout` — a checkout bound to the invite,
  // ready to mount (`checkoutOf(error)`); `care.acceptAndPay` runs the whole
  // round (mount → wait for `paid` → retry). `payment_not_completed` with no
  // id presented means a bound checkout is still in progress: finish or
  // resume it, never start a second.
  'payment_required',
  'payment_not_completed',
  'payment_mismatch',
  'payment_already_used',
  'payment_check_failed',
  // Prescriptions (embedPrescriptionPharmacies / embedPrescriptionChoose /
  // embedPrescriptionHomeLocation / embedPrescriptionAddPharmacy) — the
  // patient-ops vocabulary, which the REST plane maps onto its own codes
  // (`not_choosable` there is `prescription_not_choosable`); the embed
  // surface reports it verbatim, so it is pinned verbatim here.
  'pharmacy_not_found',
  'not_choosable',
  'pharmacy_unreachable',
  'lost_race',
  'invalid_location',
  'not_available',
  'invalid_pharmacy',
  // Clinical protocols (consent / join / book / checkout): the clinic's
  // required symptom intake is not complete, needs an explicit clinician
  // handoff, could not be read, or the link's authorization went stale. The
  // patient continues in their conversation with the assistant — never a
  // retry loop on this surface.
  'protocol_pending',
  'protocol_handoff_required',
  'protocol_unavailable',
  'protocol_authorization_stale',
] as const;

/**
 * A code the PATIENT surface (`@natzar/client/patient`) can refuse with.
 *
 * Overlaps the REST contract's `ErrorCode` where the two planes agree
 * (`not_found`, `invalid_request`, `origin_not_allowed`…) and adds the
 * embed-only spellings (`expired`, `not_choosable`, `lost_race`,
 * `not_available`, `booking_disabled`…). `isErrorCode` accepts either.
 */
export type PatientSurfaceErrorCode = (typeof PATIENT_SURFACE_CODES)[number];

export const PATIENT_SURFACE_CODE_SET: ReadonlySet<string> = new Set<string>(PATIENT_SURFACE_CODES);
