// The real-Next.js fixture's middleware config (test/real-stack.test.ts).
// The "login" is a `sid` cookie; NATZAR_API_KEY / NATZAR_API_URL come from the
// environment the test starts `next start` with (a mock Natzar API).
import {natzar} from '@natzar/client/server';

export const options = {
  identify: async (req) => {
    const sid = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.get('cookie') ?? '')?.[1];
    return sid === 'signed-in' && {patient: {externalId: 'u-1', phone: '+15551234567'}, login: sid};
  },
  surfaces: ['async', 'telehealth', 'agent', 'headless'],
};

export const make = () => natzar(options);
