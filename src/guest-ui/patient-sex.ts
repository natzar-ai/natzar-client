// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
/** Patient sex at birth; never infer anatomy or map Intersex to male/female. */
import {PATIENT_SEX_VALUES} from '../contract/model-values';
export {PATIENT_SEX_VALUES};
export type PatientSexAtBirth = (typeof PATIENT_SEX_VALUES)[number];
export function isPatientSex(value: unknown): value is PatientSexAtBirth {return (PATIENT_SEX_VALUES as readonly unknown[]).includes(value);}
/** One canonical patient field. Legacy sex is handled by the deployment migration. */
export function patientSexOf(row: {sexAssignedAtBirth?: unknown} | null | undefined): PatientSexAtBirth | undefined {
  return isPatientSex(row?.sexAssignedAtBirth) ? row.sexAssignedAtBirth : undefined;
}
