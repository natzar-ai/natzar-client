// Firebase Auth (the bearer-token SPA case, plan §3.6) — the server: Express.
// The SPA keeps its Firebase ID token out of cookies; the auth hook in
// ./browser.ts sends it as a Bearer header, and `identify` verifies it here.
//
//   app.use('/natzar', ...) AFTER nothing in particular (no cookie session),
//   BEFORE express.json() and any login redirect.
import {natzar} from '@natzar/client/server';
import {getAuth} from 'firebase-admin/auth';

export const nz = natzar({
  identify: async (_req, {token}) => {
    const t = await getAuth().verifyIdToken(token ?? '').catch(() => null);   // signature, audience, expiry
    const u = t && (await users.get(t.uid));
    return t && u && {
      patient: {externalId: u.id, phone: u.phone, email: u.email, givenName: u.first,
                familyName: u.last, birthdate: u.dob, sex: u.sex},
      login: `${t.uid}:${t.auth_time}`,   // one Firebase sign-in: stable across token refreshes
    };
  },
});
app.use('/natzar', nz);

/** Your sign-out route: ends every Natzar session of that Firebase sign-in at once. */
export async function signedOut(uid: string, authTime: number) {
  await nz.revokeLogin(`${uid}:${authTime}`);
}
