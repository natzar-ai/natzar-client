// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
/**
 * The multi-select block's rules, apart from React: what a click, Enter or
 * "Add “…”" does to the value, how the search matches and which choices the
 * list shows. The value is a list of choice values plus the patient's own
 * entries, each `other:<text>` (shared/signup-form.ts, which the server
 * validates with the same limits).
 */
import {isOtherEntry, OTHER_MAX_ENTRIES, OTHER_MAX_LENGTH, OTHER_PREFIX, otherEntryText, UNSURE_MEDICATION} from './signup-catalogue';
import {selectionOptionPriority, sortSelectionOptions} from './selection-order';
type Choice = {value: string; label: string};

/** The block's value as a clean list: a restored or foreign value can be anything. */
export function selectionOf(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return [...new Set(val.filter((item): item is string => typeof item === 'string'))];
}

/**
 * Select or unselect a choice. An exclusive choice ("None of these", "I'm not
 * sure") stands alone: selecting it clears everything else, selecting anything
 * else clears it.
 */
export function toggleChoice(selection: readonly string[], value: string, exclusive: readonly string[]): string[] {
  if (selection.includes(value)) return selection.filter(item => item !== value);
  if (exclusive.includes(value)) return [value];
  return [...selection.filter(item => !exclusive.includes(item)), value];
}

export function removeValue(selection: readonly string[], value: string): string[] {
  return selection.filter(item => item !== value);
}

/** The patient's text as stored: whitespace collapsed and trimmed. */
export const cleanEntryText = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Lowercase, accents and extra spaces removed: "Antidépresseurs " matches "antidepresseurs". */
export function searchKey(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Every word of the query appears in the label, in any order ("pressure high" finds "High blood pressure"). */
export function matchesSearch(label: string, query: string): boolean {
  const key = searchKey(label);
  return searchKey(query).split(' ').every(word => key.includes(word));
}

/** What a selected value shows: its choice label, or the patient's own text. */
export function selectionLabel(value: string, choices: readonly Choice[]): string {
  if (isOtherEntry(value)) return otherEntryText(value);
  return choices.find(choice => choice.value === value)?.label ?? value;
}

/**
 * Whether the "Add “…”" row shows for this search, and whether it can be used:
 * hidden for an empty search and for text that already is a choice or one of
 * the patient's entries; blocked when the entry is too long or the patient
 * already added the maximum.
 */
export type AddOtherState = 'hidden' | 'available' | 'tooLong' | 'tooMany';
export function addOtherState(choices: readonly Choice[], selection: readonly string[], query: string): AddOtherState {
  const text = cleanEntryText(query);
  if (!text) return 'hidden';
  const key = searchKey(text);
  if (choices.some(choice => searchKey(choice.label) === key)) return 'hidden';
  const others = selection.filter(isOtherEntry);
  if (others.some(other => searchKey(otherEntryText(other)) === key)) return 'hidden';
  if (text.length > OTHER_MAX_LENGTH) return 'tooLong';
  if (others.length >= OTHER_MAX_ENTRIES) return 'tooMany';
  return 'available';
}

/** Add the patient's own entry — it clears an exclusive choice — unless addOtherState refuses it (the selection then comes back unchanged). */
export function addOther(selection: readonly string[], query: string, choices: readonly Choice[], exclusive: readonly string[]): string[] {
  if (addOtherState(choices, selection, query) !== 'available') return [...selection];
  return [...selection.filter(item => !exclusive.includes(item)), `${OTHER_PREFIX}${cleanEntryText(query)}`];
}

/**
 * The choices the list shows (the dropdown scrolls, so every match is listed).
 * - `pinned`: the absence choices matching the search, always on top, so
 *   "None" is one tap away.
 * - `listed`: the remaining matches alphabetically, with Other last.
 * - `matchCount`: every matching choice, pinned ones included (0: no results).
 */
export type ChoiceListing = {pinned: Choice[]; listed: Choice[]; matchCount: number};
export function listChoices(choices: readonly Choice[], exclusive: readonly string[], query: string, locale?: string, otherValues?: readonly string[]): ChoiceListing {
  const matching = cleanEntryText(query) ? choices.filter(choice => matchesSearch(choice.label, query)) : [...choices];
  const order = {locale, noneValues: exclusive.filter(value => value !== UNSURE_MEDICATION), ...(otherValues ? {otherValues} : {})};
  const sorted = sortSelectionOptions(matching, order);
  const pinned = sorted.filter(choice => selectionOptionPriority(choice, order) < 0);
  const listed = sorted.filter(choice => selectionOptionPriority(choice, order) >= 0);
  return {pinned, listed, matchCount: matching.length};
}
