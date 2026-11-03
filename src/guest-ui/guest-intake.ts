// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import {signupMedicationQuestions} from './signup-medication-questions';
/** Canonical adapter shared by the quick form and its server-side chart writer. */
import type {GuestIdentity, GuestIntake, GuestIntakeSelections} from '../contract/guest';
import {canonicalSignupMedications, CONDITION_VALUES, isOtherEntry, NO_MEDICATION, UNSURE_MEDICATION, OTHER_MAX_ENTRIES, OTHER_MAX_LENGTH, otherEntryText, signupCatalogue, signupConditionOptions} from './signup-catalogue';
import {searchKey} from './searchable-selection';

export type GuestIntakeIdentity = Pick<Partial<GuestIdentity>, 'country' | 'sexAssignedAtBirth' | 'birthdate'>;
export class GuestIntakeSelectionError extends Error {
  constructor(readonly field: string) {super('invalid_intake_selection');}
}
const fail = (field: string): never => {throw new GuestIntakeSelectionError(field);};
const strip = (value: string) => value.replace(': ______', '');
export function guestIntakeOptions(identity: GuestIntakeIdentity) {
  return {conditions: signupConditionOptions(identity.sexAssignedAtBirth).map(option => ({value: option.id, label: option.label})),
    medications: [...canonicalSignupMedications(identity.country === 'CA' ? 'ca' : 'us').map(option => ({value: option.id, label: option.label})), {value: UNSURE_MEDICATION, label: 'I’m not sure'}],
    allergies: signupCatalogue.allergies.map(option => ({value: option.id, label: strip(option.label)})),
    reactions: signupCatalogue.reactions.map(option => ({value: option.id, label: strip(option.label)}))};
}
function values(raw: unknown, allowed: Set<string>, exclusive: readonly string[], field: string): string[] {
  if (!Array.isArray(raw) || !raw.length || raw.some(value => typeof value !== 'string') || new Set(raw).size !== raw.length) return fail(field);
  const others = raw.filter(isOtherEntry);
  if (raw.some(value => !allowed.has(value) && !isOtherEntry(value)) || (raw.length > 1 && raw.some(value => exclusive.includes(value))) || others.length > OTHER_MAX_ENTRIES || others.some(value => !otherEntryText(value) || otherEntryText(value).length > OTHER_MAX_LENGTH)) return fail(field);
  return raw.map(value => isOtherEntry(value) ? `other:${otherEntryText(value).replace(/\s+/g, ' ')}` : value);
}
/** Metadata is authoritative. Human-readable posted labels never become clinical codes. */
export function normalizeGuestIntake(intake: GuestIntake, identity: GuestIntakeIdentity): GuestIntake {
  if (intake.selections === undefined) return intake;
  if (identity.country !== 'US' && identity.country !== 'CA') return fail('country');
  const raw = intake.selections;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('selections');
  const options = guestIntakeOptions(identity);
  const conditions = values(raw.conditions, new Set(options.conditions.map(option => option.value)), ['C00'], 'chronicConditions');
  let medications = values(raw.medications, new Set([...options.medications.map(option => option.value), NO_MEDICATION]), [NO_MEDICATION, UNSURE_MEDICATION], 'medications');
  let medicationAnswers: Record<string, string[]> | undefined;
  if (raw.medicationAnswers !== undefined) {
    if (!raw.medicationAnswers || typeof raw.medicationAnswers !== 'object' || Array.isArray(raw.medicationAnswers)) return fail('medications');
    const questions = signupMedicationQuestions({signupSex: identity.sexAssignedAtBirth ? [identity.sexAssignedAtBirth] : [], birthdate: identity.birthdate, signupConditions: conditions}, identity.country === 'CA' ? 'ca' : 'us');
    if (Object.keys(raw.medicationAnswers).length !== questions.length) return fail('medications');
    medicationAnswers = Object.fromEntries(questions.map(question => [question.id, values(raw.medicationAnswers![question.id], new Set([...question.medications.map(drug => drug.id), ...question.exclusive]), question.exclusive, 'medications')]));
    const all = [...new Set(Object.values(medicationAnswers).flat())];
    const reported = all.filter(value => value !== NO_MEDICATION && value !== UNSURE_MEDICATION);
    medications = reported.length ? reported : [all.includes(UNSURE_MEDICATION) ? UNSURE_MEDICATION : NO_MEDICATION];
  }
  if (!Array.isArray(raw.allergies) || raw.allergies.length > 30) return fail('allergies');
  const seen = new Set<string>();
  const allergies = raw.allergies.map(item => {
    if (!item || typeof item !== 'object' || typeof item.code !== 'string' || typeof item.reactionCode !== 'string' || !signupCatalogue.allergies.some(option => option.id !== 'A00' && option.id === item.code) || !options.reactions.some(option => option.value === item.reactionCode)) return fail('allergies');
    const name = item.code === 'A99' ? (typeof item.name === 'string' ? item.name.trim().replace(/\s+/g, ' ') : '') : undefined;
    const reaction = item.reactionCode === 'R06' ? (typeof item.reaction === 'string' ? item.reaction.trim().replace(/\s+/g, ' ') : '') : undefined;
    if ((item.code === 'A99' && (!name || name.length > OTHER_MAX_LENGTH)) || (item.reactionCode === 'R06' && (!reaction || reaction.length > OTHER_MAX_LENGTH))) return fail('allergies');
    const key = `${item.code}:${name ? searchKey(name) : ''}`;
    if (seen.has(key)) return fail('allergies'); seen.add(key);
    return {code: item.code, reactionCode: item.reactionCode, ...(name ? {name} : {}), ...(reaction ? {reaction} : {})};
  });
  const selections: GuestIntakeSelections = {conditions, medications, ...(medicationAnswers ? {medicationAnswers} : {}), allergies};
  return {confirmed: intake.confirmed, selections,
    chronicConditions: conditions.filter(value => value !== 'C00').map(value => isOtherEntry(value) ? otherEntryText(value) : options.conditions.find(option => option.value === value)!.label),
    medications: medications.filter(value => value !== NO_MEDICATION).map(value => isOtherEntry(value) ? otherEntryText(value) : options.medications.find(option => option.value === value)!.label),
    allergies: allergies.map(item => ({name: item.code === 'A99' ? item.name! : signupCatalogue.allergies.find(option => option.id === item.code)!.label,
      reaction: item.reactionCode === 'R06' ? item.reaction! : options.reactions.find(option => option.value === item.reactionCode)!.label}))};
}
/** Same persisted structures as the existing signup form. Call only after complete patient confirmation. */
export function guestIntakeChart(intake: GuestIntake, identity: GuestIntakeIdentity) {
  const normalized = normalizeGuestIntake(intake, identity), selected = normalized.selections;
  if (!selected) return null;
  const medications = canonicalSignupMedications(identity.country === 'CA' ? 'ca' : 'us');
  return {chronicConditions: selected.conditions.flatMap(value => value in CONDITION_VALUES ? [CONDITION_VALUES[value as keyof typeof CONDITION_VALUES]] : []),
    chronicConditionsOther: selected.conditions.filter(isOtherEntry).map(otherEntryText).join('; ') || undefined,
    medications: selected.medications.filter(value => value !== NO_MEDICATION && value !== UNSURE_MEDICATION && !isOtherEntry(value)).map(value => {const medication = medications.find(option => option.id === value)!; return {code: medication.id, name: medication.generic, label: medication.label, group: medication.group};}),
    medicationsOther: selected.medications.filter(isOtherEntry).map(otherEntryText).join('; ') || undefined,
    medicationStatus: selected.medications.includes(NO_MEDICATION) ? 'none' as const : selected.medications.includes(UNSURE_MEDICATION) ? 'unsure' as const : 'reported' as const,
    noKnownAllergies: selected.allergies.length === 0,
    allergies: selected.allergies.map(item => ({code: item.code, name: item.code === 'A99' ? item.name! : signupCatalogue.allergies.find(option => option.id === item.code)!.label,
      reactionCode: item.reactionCode, reaction: signupCatalogue.reactions.find(option => option.id === item.reactionCode)!.label, ...(item.reactionCode === 'R06' ? {details: item.reaction!} : {})}))};
}

/** Keep every draft fact visible; exact known labels become selections, others use the form's Other escape. */
export function guestIntakeDraft(initial: GuestIntake | undefined, identity: GuestIntakeIdentity) {
  const options = guestIntakeOptions(identity);
  if (initial?.selections) {
    try {const value = normalizeGuestIntake(initial, identity); return {conditions: value.selections!.conditions, medications: value.selections!.medications,
      allergies: value.selections!.allergies.length ? value.selections!.allergies.map(item => ({value: item.code === 'A99' ? `other:${item.name}` : item.code, reaction: item.reactionCode, otherReaction: item.reaction ?? ''})) : [{value: 'A00', reaction: '', otherReaction: ''}]};} catch { /* Legacy display facts remain reviewable below. */ }
  }
  const mapValues = (raw: string[] | null | undefined, choices: Array<{value: string; label: string}>, none: string, condition = false) => raw == null ? [] : raw.length === 0 ? [none] : raw.map(value => choices.find(option => searchKey(option.label) === searchKey(value) || option.value === value || (condition && CONDITION_VALUES[option.value as keyof typeof CONDITION_VALUES] === value))?.value ?? (isOtherEntry(value) ? value : `other:${value}`));
  const medicationChoices = options.medications.map(option => ({...option}));
  for (const medication of canonicalSignupMedications(identity.country === 'CA' ? 'ca' : 'us')) medicationChoices.push({value: medication.id, label: medication.generic});
  return {conditions: mapValues(initial?.chronicConditions, options.conditions, 'C00', true), medications: mapValues(initial?.medications, medicationChoices, NO_MEDICATION),
    allergies: initial?.allergies == null ? [] : initial.allergies.length === 0 ? [{value: 'A00', reaction: '', otherReaction: ''}] : initial.allergies.map(item => {
      const allergy = options.allergies.find(option => searchKey(option.label) === searchKey(item.name)), reaction = options.reactions.find(option => searchKey(option.label) === searchKey(item.reaction));
      return {value: allergy?.value ?? `other:${item.name}`, reaction: reaction?.value ?? (item.reaction ? 'R06' : ''), otherReaction: reaction ? '' : item.reaction};
    })};
}
