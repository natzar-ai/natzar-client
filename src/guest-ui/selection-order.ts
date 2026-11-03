// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
export type SelectionOrder = {
  locale?: string;
  /** Stable values keep special options in place after translation. */
  noneValues?: readonly string[];
  otherValues?: readonly string[];
};

type Option = {value: string; label: string};

/** Only absence answers go first; an exclusive “I'm not sure” still sorts alphabetically. */
export function selectionOptionPriority(option: Option, order: SelectionOrder = {}): number {
  const label = option.label.trim();
  const none = order.noneValues ? order.noneValues.includes(option.value)
    : /^(?:no|none|non of these)\b/i.test(label) || /^(?:no|none)$/i.test(option.value);
  const other = order.otherValues ? order.otherValues.includes(option.value)
    : /^other\b/i.test(label) || /^other(?::|$)/i.test(option.value);
  if (none) return -1;
  if (other) return 1;
  return 0;
}

/** A fresh list in displayed-label order: none/no first, Other last. */
export function sortSelectionOptions<T extends Option>(options: readonly T[], order: SelectionOrder = {}): T[] {
  const collator = new Intl.Collator(order.locale?.replace(/_/g, '-') || 'en', {sensitivity: 'base', numeric: true});
  return [...options].sort((a, b) => selectionOptionPriority(a, order) - selectionOptionPriority(b, order) || collator.compare(a.label.trim(), b.label.trim()));
}
