// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
/** One medication branching implementation for /form, guest intake and chart validation. */
import {signupConditionOptions, signupCatalogueFor, canonicalSignupMedications, NO_MEDICATION, UNSURE_MEDICATION, type SignupMedicationOption, type SignupConditionOption, type SignupVariant} from './signup-catalogue';
type SignupAnswers = Record<string, unknown>;
const selected = (data: SignupAnswers, id: string): string[] => Array.isArray(data[id]) ? (data[id] as unknown[]).filter((value): value is string => typeof value === 'string') : [];

const BIRTH_CONTROL_TRIGGERS = 'Female, age 12+';
const BIRTH_CONTROL_MIN_AGE = 12;

// ---- Medication questions ---------------------------------------------------
// One `multi-select` per catalogue trigger set touching the selected conditions
// (several conditions share a list: 'C03, C04', 'C16, C17', …), then birth
// control for a female patient aged 12 or more, then — always — "any other
// medications", so a patient with no listed condition still answers.

export const MEDICATION_QUESTION_PREFIX = 'signupMeds_';
const BIRTH_CONTROL_QUESTION = `${MEDICATION_QUESTION_PREFIX}birthControl`;
const OTHER_MEDICATIONS_QUESTION = `${MEDICATION_QUESTION_PREFIX}other`;
/** The answers every medication question offers next to its drugs. */

export type SignupMedicationQuestion = {
  id: string;
  kind: 'conditions' | 'birthControl' | 'other';
  /** The selected conditions this question asks about ('conditions' only). */
  conditions: string[];
  /** The catalogue group of the question's list; null for 'other' (each drug keeps its own). */
  group: string | null;
  /** One entry per generic, under the generic's canonical (first) catalogue id. */
  medications: SignupMedicationOption[];
  exclusive: string[];
};

/** `signupMeds_<triggers>`: 'C03, C04' → signupMeds_C03_C04. */
const medicationQuestionId = (triggers: string) => `${MEDICATION_QUESTION_PREFIX}${triggers.split(', ').join('_')}`;

type MedicationIndex = {
  /** Trigger set → its drugs, in catalogue order. */
  sets: Map<string, SignupMedicationOption[]>;
  /** Generic → its first catalogue entry. The workbook repeats a drug under several groups with different ids; the first id is the one stored. */
  canonical: Map<string, SignupMedicationOption>;
};
const medicationIndexes = new Map<SignupVariant, MedicationIndex>();
function medicationIndex(variant: SignupVariant): MedicationIndex {
  const cached = medicationIndexes.get(variant);
  if (cached) return cached;
  const index: MedicationIndex = {sets: new Map(), canonical: new Map(canonicalSignupMedications(variant).map(medication => [medication.generic, medication]))};
  for (const medication of signupCatalogueFor(variant).medications) {
    index.sets.set(medication.triggers, [...(index.sets.get(medication.triggers) ?? []), medication]);
  }
  medicationIndexes.set(variant, index);
  return index;
}

function ageAt(birthdate: unknown, now: Date): number {
  if (typeof birthdate !== 'string') return -1;
  const dob = new Date(`${birthdate}T00:00:00Z`);
  if (!Number.isFinite(dob.getTime())) return -1;
  return now.getUTCFullYear() - dob.getUTCFullYear()
    - (now.getUTCMonth() < dob.getUTCMonth() || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate()) ? 1 : 0);
}

/** The conditions the patient is offered: the prostate only for a male patient. */
function conditionOptions(data: SignupAnswers): readonly SignupConditionOption[] {
  return signupConditionOptions(selected(data, 'signupSex')[0]);
}

/** The medication questions the answers so far make visible, in display order. */
export function signupMedicationQuestions(data: SignupAnswers, variant: SignupVariant, now = new Date()): SignupMedicationQuestion[] {
  const {sets, canonical} = medicationIndex(variant);
  const offered = new Set(conditionOptions(data).map(c => c.id));
  const conditions = selected(data, 'signupConditions').filter(id => offered.has(id));
  const canonicalList = (drugs: SignupMedicationOption[]) => [...new Set(drugs.map(d => d.generic))].map(generic => canonical.get(generic)!);
  const questions: SignupMedicationQuestion[] = [];
  for (const [triggers, drugs] of sets) {
    if (triggers === BIRTH_CONTROL_TRIGGERS) continue;
    const asked = triggers.split(', ').filter(id => conditions.includes(id));
    if (asked.length) questions.push({id: medicationQuestionId(triggers), kind: 'conditions', conditions: asked, group: drugs[0].group, medications: canonicalList(drugs), exclusive: [NO_MEDICATION, UNSURE_MEDICATION]});
  }
  const birthControl = sets.get(BIRTH_CONTROL_TRIGGERS);
  if (birthControl && selected(data, 'signupSex')[0] === 'female' && ageAt(data.birthdate, now) >= BIRTH_CONTROL_MIN_AGE) {
    questions.push({id: BIRTH_CONTROL_QUESTION, kind: 'birthControl', conditions: [], group: birthControl[0].group, medications: canonicalList(birthControl), exclusive: [NO_MEDICATION]});
  }
  questions.push({id: OTHER_MEDICATIONS_QUESTION, kind: 'other', conditions: [], group: null, medications: [...canonical.values()], exclusive: [NO_MEDICATION]});
  return questions;
}
