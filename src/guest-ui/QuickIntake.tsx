// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import {useRef, useState, type FormEvent} from 'react';
import type {GuestIdentity, GuestIntake, GuestIntakeSelections} from '../contract/guest';
import {guestIntakeDraft, guestIntakeOptions, normalizeGuestIntake} from './guest-intake';
import {signupMedicationQuestions} from './signup-medication-questions';
import {isOtherEntry, otherEntryText, OTHER_MAX_LENGTH} from './signup-catalogue';
import type {GuestCopy} from './copy';
import {IntakeSelect} from './IntakeSelect';
import {intakeLabel, intakeText} from './intake-copy';
import {focusFormField} from './form-focus';

export function QuickIntake({initial, identity = {}, locale = 'en', copy, busy, submitLabel, onSubmit}: {initial?: GuestIntake; identity?: Partial<GuestIdentity>; locale?: string; copy: GuestCopy; busy: boolean; submitLabel?: string; onSubmit(value: GuestIntake): void}) {
  const form = useRef<HTMLFormElement>(null), [draft] = useState(() => guestIntakeDraft(initial, identity));
  const variant = identity.country === 'CA' ? 'ca' : 'us';
  const medicationQuestions = (conditions: string[]) => signupMedicationQuestions({signupSex: identity.sexAssignedAtBirth ? [identity.sexAssignedAtBirth] : [], birthdate: identity.birthdate, signupConditions: conditions}, variant);
  const [conditions, setConditions] = useState(draft.conditions);
  const [medicationAnswers, setMedicationAnswers] = useState<Record<string, string[]>>(() => Object.fromEntries(medicationQuestions(draft.conditions).map(question => {
    const saved = initial?.selections?.medicationAnswers?.[question.id];
    const allowed = new Set(question.medications.map(drug => drug.id));
    const legacy = draft.medications.filter(value => allowed.has(value) || question.kind === 'other' && isOtherEntry(value));
    return [question.id, saved ?? (draft.medications.includes('none') ? ['none'] : legacy.length ? legacy : [])];
  })));
  const [allergies, setAllergies] = useState(draft.allergies.map(item => item.value));
  const [otherAllergy, setOtherAllergy] = useState('');
  const [reactions, setReactions] = useState<Record<string, {code: string; other: string}>>(() => Object.fromEntries(draft.allergies.filter(item => item.value !== 'A00').map(item => [item.value, {code: item.reaction, other: item.otherReaction}])));
  const [confirmed, setConfirmed] = useState(false), [error, setError] = useState(false), [reactionError, setReactionError] = useState(false);
  const options = guestIntakeOptions(identity), questions = medicationQuestions(conditions);
  const translated = (category: 'conditions' | 'allergies' | 'reactions') => options[category].map(option => ({...option, label: intakeLabel(locale, category, option.value, option.label)}));
  const tr = (path: string, fallback: string, vars?: Record<string, string>) => intakeText(locale, path, fallback, vars);
  function update(change: () => void) {change(); setConfirmed(false); setError(false); setReactionError(false);}
  function focusError(name?: string) {
    form.current?.ownerDocument.defaultView?.requestAnimationFrame(() => {
      const field = name ? Array.from(form.current?.querySelectorAll<HTMLElement>('[data-guest-select]') ?? []).find(element => element.dataset.guestSelect === name)?.querySelector<HTMLElement>('.guest-select-trigger')
        : form.current?.querySelector<HTMLElement>('input[type="checkbox"]');
      focusFormField(field ?? null);
    });
  }
  const questionName = (id: string) => id === 'signupMeds_other' ? 'medications' : id;
  function submit(event: FormEvent) {
    event.preventDefault();
    const missing = !conditions.length ? 'conditions' : questions.find(question => !medicationAnswers[question.id]?.length)?.id;
    if (!confirmed || missing || !allergies.length) {setError(true); focusError(missing ? questionName(missing) : !allergies.length ? 'allergies' : undefined); return;}
    if (allergies.includes('A99') && !otherAllergy.trim()) {setError(true); focusFormField(form.current?.querySelector<HTMLInputElement>('[data-other-allergy]') ?? null); return;}
    const selected = allergies.filter(value => value !== 'A00');
    const incomplete = selected.find(value => !reactions[value]?.code || (reactions[value].code === 'R06' && !reactions[value].other.trim()));
    if (incomplete) {setReactionError(true); if (reactions[incomplete]?.code === 'R06') focusFormField(form.current?.querySelector<HTMLElement>('[data-reaction-invalid="true"] input') ?? null); else focusError(`reaction-${incomplete}`); return;}
    const answers = Object.fromEntries(questions.map(question => [question.id, medicationAnswers[question.id]]));
    const all = [...new Set(Object.values(answers).flat())], reported = all.filter(value => value !== 'none' && value !== 'unsure');
    const selections: GuestIntakeSelections = {conditions, medications: reported.length ? reported : [all.includes('unsure') ? 'unsure' : 'none'], medicationAnswers: answers,
      allergies: selected.map(value => ({code: isOtherEntry(value) ? 'A99' : value, reactionCode: reactions[value].code,
        ...(value === 'A99' || isOtherEntry(value) ? {name: value === 'A99' ? otherAllergy.trim() : otherEntryText(value)} : {}), ...(reactions[value].code === 'R06' ? {reaction: reactions[value].other} : {})}))};
    try {onSubmit(normalizeGuestIntake({chronicConditions: [], medications: [], allergies: [], confirmed: true, selections}, identity));} catch {setError(true);}
  }
  return <form ref={form} className="guest-form" onSubmit={submit}>
    <p className="guest-description">{copy.intakeBody}</p>
    <fieldset disabled={busy}>
      <div className="guest-intake-section"><IntakeSelect name="conditions" label={copy.conditions} options={translated('conditions')} values={conditions} exclusive={['C00']} invalid={error && !conditions.length} allowOther locale={locale} copy={copy} onChange={value => update(() => {
        setConditions(value); const visible = new Set(medicationQuestions(value).map(question => question.id)); setMedicationAnswers(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => visible.has(id))));
      })}/></div>
      {questions.map(question => {
        const names = question.conditions.map(code => translated('conditions').find(option => option.value === code)?.label ?? code);
        const group = new Intl.ListFormat(locale.replace('_', '-'), {style: 'long', type: 'conjunction'}).format(names);
        const label = question.kind === 'conditions' ? tr('medications.forConditions', '{{conditions}}: which medications do you take?', {conditions: group}) : question.kind === 'birthControl' ? tr('medications.birthControl', 'Do you use any of these birth control methods?') : tr('medications.other', 'Do you take any other medications regularly?');
        const none = question.kind === 'conditions' ? tr('medications.none', 'I don’t take medication for this') : question.kind === 'birthControl' ? tr('medications.noneBirthControl', 'No') : tr('medications.noneOther', 'No other medications');
        return <div key={question.id} className="guest-intake-section" data-medication-question={question.id}><IntakeSelect name={questionName(question.id)} label={label}
          options={[...question.medications.map(drug => ({value: drug.id, label: drug.label})), {value: 'none', label: none}, ...(question.kind === 'conditions' ? [{value: 'unsure', label: tr('medications.unsure', 'I’m not sure')}] : [])]}
          values={medicationAnswers[question.id] ?? []} exclusive={question.exclusive} invalid={error && !medicationAnswers[question.id]?.length} allowOther locale={locale} copy={copy}
          onChange={value => update(() => setMedicationAnswers(previous => ({...previous, [question.id]: value})))}/></div>;
      })}
      <div className="guest-intake-section"><IntakeSelect name="allergies" label={copy.allergies} options={translated('allergies')} otherValues={['A99']} values={allergies} exclusive={['A00']} invalid={error && !allergies.length} locale={locale} copy={copy} onChange={value => update(() => setAllergies(value))}/></div>
      {allergies.includes('A99') && <label>{tr('blocks.signupAllergiesOther.label', 'What else have you had a reaction to?')}<input data-other-allergy required maxLength={OTHER_MAX_LENGTH} value={otherAllergy} aria-invalid={error && !otherAllergy.trim() || undefined} onChange={event => update(() => setOtherAllergy(event.target.value))}/></label>}
      {allergies.filter(value => value !== 'A00').map(value => {
        const name = value === 'A99' ? otherAllergy.trim() || intakeLabel(locale, 'allergies', 'A99', 'Other') : isOtherEntry(value) ? otherEntryText(value) : translated('allergies').find(option => option.value === value)?.label ?? value;
        const reaction = reactions[value] ?? {code: '', other: ''};
        return <div key={value} className="guest-intake-reaction" data-reaction-invalid={reactionError && reaction.code === 'R06' && !reaction.other.trim()}><IntakeSelect name={`reaction-${value}`} label={`${name}: ${copy.allergyReaction}`} options={translated('reactions')} otherValues={['R06']} values={reaction.code ? [reaction.code] : []} multiple={false} invalid={reactionError && !reaction.code} locale={locale} copy={copy} onChange={values => update(() => setReactions(previous => ({...previous, [value]: {...(previous[value] ?? {code: '', other: ''}), code: values[0] ?? ''}})))}/>
          {reaction.code === 'R06' && <label>{copy.otherReaction}<input value={reaction.other} maxLength={OTHER_MAX_LENGTH} aria-invalid={reactionError && !reaction.other.trim() || undefined} onChange={event => {const text = event.currentTarget.value; update(() => setReactions(previous => ({...previous, [value]: {...(previous[value] ?? {code: '', other: ''}), other: text}})));}}/></label>}
        </div>;
      })}
      <label className="guest-check guest-confirm"><input type="checkbox" checked={confirmed} aria-invalid={error && !confirmed || undefined} onChange={event => {setConfirmed(event.target.checked); if (event.target.checked) setError(false);}}/>{copy.confirm}</label>
    </fieldset>
    {error && <p className="guest-error" role="alert">{copy.selectAll}</p>}
    {reactionError && <p className="guest-error" role="alert">{copy.reactionRequired}</p>}
    <button className="guest-primary" disabled={busy}>{busy ? copy.busy : submitLabel ?? copy.saveIntake}</button>
  </form>;
}
