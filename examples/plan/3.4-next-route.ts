// Plan §3.4, verbatim: app/natzar/[...natzar]/route.ts
// app/natzar/[...natzar]/route.ts        (the convention: /natzar/* on your own origin)
import {natzar} from '@natzar/client/server';
import {auth} from '@/auth';

export const {GET, POST} = natzar({
  identify: async (_req, {audience}) => {
    const s = await auth();
    const u = s?.user;
    if (!u) return null;
    if (audience === 'clinician')
      return u.role === 'clinician' && u.mfa && {clinician: {externalId: u.id}, until: s.expires};
    return {patient: {externalId: u.id, phone: u.phone, email: u.email, givenName: u.givenName,
                      familyName: u.familyName, birthdate: u.birthdate, sex: u.sex}, until: s.expires};
  },
});
