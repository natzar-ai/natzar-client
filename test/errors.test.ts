// The error class is shared by both halves of the SDK, so its `code` type
// must admit BOTH vocabularies: the REST contract's and the patient
// surface's own spellings. The static half of this file is the test — a
// `NatzarErrorCode` that dropped `not_choosable` fails `tsc`, not `node`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {NatzarApiError, isErrorCode, isNatzarApiError, isRetryable} from '../dist/esm/index.js';
import type {NatzarErrorCode, PatientSurfaceErrorCode} from '../dist/esm/index.js';
import type {PatientSurfaceErrorCode as PatientEntryCode} from '../dist/esm/patient/index.js';
import {PATIENT_SURFACE_CODES} from '../dist/esm/patient/codes.js';

test('isErrorCode typechecks against the patient surface vocabulary as well as the REST contract', () => {
  const e = new NatzarApiError({code: 'not_choosable', status: 409, message: 'no', route: 'embedPrescriptionChoose'});
  // Both spellings are accepted statically — these lines are the assertion.
  assert.equal(isErrorCode(e, 'not_choosable'), true);
  assert.equal(isErrorCode(e, 'prescription_not_choosable'), false);
  assert.equal(isErrorCode(e, 'lost_race'), false);
  assert.equal(isErrorCode(e, 'has_open_thread'), false);
  // And the plain comparison a partner writes by hand has overlap to compare.
  assert.equal(isNatzarApiError(e) && e.code === 'not_choosable', true);
  const code: NatzarErrorCode = e.code;
  const patientCode: PatientSurfaceErrorCode = 'not_available';
  const fromPatientEntry: PatientEntryCode = patientCode;
  assert.equal(typeof code, 'string');
  assert.equal(fromPatientEntry, 'not_available');
});

test('the patient vocabulary is a closed list the transport pins verbatim', () => {
  for (const c of ['not_choosable', 'lost_race', 'not_available', 'expired', 'booking_disabled', 'not_rateable']) {
    assert.ok((PATIENT_SURFACE_CODES as readonly string[]).includes(c), c);
  }
  assert.equal(new Set(PATIENT_SURFACE_CODES).size, PATIENT_SURFACE_CODES.length, 'no duplicates');
});

test('retry stays a REST-plane decision: no patient-surface refusal is retryable', () => {
  for (const c of PATIENT_SURFACE_CODES) {
    const e = new NatzarApiError({code: c, status: 409, message: 'no', route: 'op'});
    assert.equal(isRetryable(e), c === 'internal_error', c);
  }
});
