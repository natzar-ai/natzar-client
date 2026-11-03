import {useMemo} from 'react';
import {createGuestClient, type GuestClientOptions} from './index';
import {GuestJourney, type GuestJourneyProps} from '../guest-ui/GuestJourney';

export interface NatzarGuestProps extends GuestClientOptions, Pick<GuestJourneyProps, 'clinicName' | 'getAccountToken' | 'onSignIn' | 'onReady'> {}

/**
 * Guest chat and quick intake on the customer's actual origin. The clinic's
 * server-side guest allowlist must include that origin. It deliberately uses
 * neither the authenticated natzar() endpoint nor patient SDK credentials.
 */
export function NatzarGuest({clinicId, graphqlUrl, apiKey, locale, storage, rememberStorage, cookieStorage, credential, fetch: send, ...props}: NatzarGuestProps) {
  const client = useMemo(() => {
    let browserStorage = storage;
    if (browserStorage === undefined) {try {browserStorage = globalThis.sessionStorage;} catch {browserStorage = null;}}
    let persistentStorage = rememberStorage;
    if (persistentStorage === undefined) {try {persistentStorage = globalThis.localStorage;} catch {persistentStorage = null;}}
    return createGuestClient({clinicId, graphqlUrl, apiKey, locale, storage: browserStorage, rememberStorage: persistentStorage, cookieStorage, credential, fetch: send});
  }, [clinicId, graphqlUrl, apiKey, locale, storage, rememberStorage, cookieStorage, credential, send]);
  return <GuestJourney key={`${graphqlUrl}:${clinicId}:${credential ?? 'stored'}`} client={client} locale={locale} {...props}/>;
}
