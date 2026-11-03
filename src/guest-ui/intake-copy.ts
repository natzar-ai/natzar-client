// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import {en} from './intake-locales-data';
import {fr} from './intake-locales-data';
import {es} from './intake-locales-data';
import {de} from './intake-locales-data';
import {it} from './intake-locales-data';
const catalogues = {en: en.signup.catalogue, fr: fr.signup.catalogue, es: es.signup.catalogue, de: de.signup.catalogue, it: it.signup.catalogue};
/** The guest and signup forms display the same translated catalogue labels. */
export function intakeLabel(locale: string, category: 'conditions' | 'allergies' | 'reactions', code: string, fallback: string): string {
  const language = locale.slice(0, 2) as keyof typeof catalogues;
  const values = (catalogues[language] ?? catalogues.en)[category] as Record<string, string>;
  return (values[code] ?? fallback).replace(': ______', '');
}

const resources = {en: en.signup, fr: fr.signup, es: es.signup, de: de.signup, it: it.signup};
/** Exact form-authored labels, including medication negatives and allergy Other. */
export function intakeText(locale: string, path: string, fallback: string, vars: Record<string, string> = {}): string {
  let value: unknown = resources[locale.slice(0, 2).toLowerCase() as keyof typeof resources] ?? resources.en;
  for (const part of path.split('.')) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined;
  return (typeof value === 'string' ? value : fallback).replace(/\{\{(\w+)\}\}/g, (token, key: string) => vars[key] ?? token);
}
