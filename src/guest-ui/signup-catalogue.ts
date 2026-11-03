// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
/** Canonical signup catalogues, also used by guest health-history selections. */
import {catalogue} from './intake-catalogue-data';
import {medicationsCa} from './intake-catalogue-data';
import {medicationsUs} from './intake-catalogue-data';
export type SignupVariant = 'us' | 'ca';
export type SignupConditionOption = {id: string; label: string; shownTo: string};
/** A catalogue drug. `triggers`: the condition ids it is listed for ('C03, C04'), or 'Female, age 12+'. */
export type SignupMedicationOption = {id: string; triggers: string; group: string; generic: string; brands?: string; label: string};
export type SignupAllergyOption = {id: string; label: string; examples?: string};
export type SignupReactionOption = {id: string; label: string};
export type SignupCatalogue = {
  conditions: readonly SignupConditionOption[];
  medications: readonly SignupMedicationOption[];
  allergies: readonly SignupAllergyOption[];
  reactions: readonly SignupReactionOption[];
};

/** Conditions, allergies and reactions: the same list in every zone. */
export const signupCatalogue: Omit<SignupCatalogue, 'medications'> = catalogue;
const MEDICATIONS: Record<SignupVariant, readonly SignupMedicationOption[]> = {ca: medicationsCa, us: medicationsUs};

/** The whole catalogue the variant's form renders and its server validates against. */
export function signupCatalogueFor(variant: SignupVariant): SignupCatalogue {
  return {...signupCatalogue, medications: MEDICATIONS[variant]};
}

export const CONDITION_VALUES = {
  C01: 'hypertension', C02: 'cholesterol', C03: 'diabetes1', C04: 'diabetes2',
  C05: 'asthma', C06: 'copd', C07: 'cardio', C08: 'heart_failure',
  C09: 'atrial_fibrillation', C10: 'stroke', C11: 'blood_clots', C12: 'ckd',
  C13: 'liver', C14: 'thyroid', C15: 'reflux_ulcers', C16: 'depression',
  C17: 'anxiety', C18: 'adhd', C19: 'epilepsy', C20: 'migraine',
  C21: 'arthritis_chronic_pain', C22: 'osteoporosis', C23: 'gout',
  C24: 'enlarged_prostate', C25: 'seasonal_allergies', C26: 'immunocompromised',
} as const;

export function signupConditionOptions(sex?: string): readonly SignupConditionOption[] {
  return signupCatalogue.conditions.filter(condition => condition.shownTo !== 'Male only' || sex === 'male');
}
/** First catalogue id per generic, exactly as the signup's medication groups store it. */
export function canonicalSignupMedications(variant: SignupVariant): readonly SignupMedicationOption[] {
  const byGeneric = new Map<string, SignupMedicationOption>();
  for (const medication of signupCatalogueFor(variant).medications) if (!byGeneric.has(medication.generic)) byGeneric.set(medication.generic, medication);
  return [...byGeneric.values()];
}
export const OTHER_PREFIX = 'other:';
export const OTHER_MAX_LENGTH = 100;
export const OTHER_MAX_ENTRIES = 10;
export const isOtherEntry = (value: string): boolean => value.startsWith(OTHER_PREFIX);
export const otherEntryText = (value: string): string => value.slice(OTHER_PREFIX.length).trim();
export const NO_MEDICATION = 'none';
export const UNSURE_MEDICATION = 'unsure';
