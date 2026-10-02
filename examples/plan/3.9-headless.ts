// Plan §3.9, verbatim (the middleware also lists `surfaces: [..., 'headless']`).
import {connectPatient} from '@natzar/client/patient';
const care = await connectPatient({endpoint: '/natzar'});          // surface 'headless'; renews by itself
// React Native / Expo: connectPatient({endpoint: 'https://api.acme.com/natzar', auth: () => token, native: true})
// clinician: connectPhysician({endpoint: '/natzar'}) from '@natzar/client/physician'
export {care};

// The commented variants, compiled:
import {connectPhysician} from '@natzar/client/physician';
declare const token: string;
export const native = () => connectPatient({endpoint: 'https://api.acme.com/natzar', auth: () => token, native: true});
export const desk = () => connectPhysician({endpoint: '/natzar'});
