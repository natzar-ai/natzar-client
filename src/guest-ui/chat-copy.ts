// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import {en} from './chat-locales-data';
import {fr} from './chat-locales-data';
import {es} from './chat-locales-data';
import {de} from './chat-locales-data';
import {it} from './chat-locales-data';

/** Guest chat reads the same canonical translations as the registered frame. */
export function chatCopy(locale: string) {
  const resources = {en, fr, es, de, it};
  return (resources[locale.slice(0, 2).toLowerCase() as keyof typeof resources] ?? en).embed;
}
