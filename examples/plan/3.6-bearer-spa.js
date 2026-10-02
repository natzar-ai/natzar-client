// Plan §3.6, verbatim. Front (1 line, plus the 2-line tag):
//   window.natzarConfig = {auth: () => getAuth().currentUser?.getIdToken()};
import {natzar} from '@natzar/client/server';
import {getAuth} from 'firebase-admin/auth';

app.use('/natzar', natzar({
  identify: async (req, {token}) => {
    const t = await getAuth().verifyIdToken(token ?? '').catch(() => null);
    const u = t && (await users.get(t.uid));
    return u && {patient: {externalId: u.id, phone: u.phone, email: u.email, givenName: u.first,
                           familyName: u.last, birthdate: u.dob, sex: u.sex}, login: `${t.uid}:${t.auth_time}`};
  },
}));
