// Plan §3.5, verbatim: Hono (Workers, Bun, Deno, Remix and SvelteKit hand nz.fetch a Request the same way).
import {natzar} from '@natzar/client/server';
const nz = natzar({identify: async (req) => {
  const u = await currentUser(req);
  return u && {patient: {externalId: u.id, phone: u.phone, email: u.email, givenName: u.first,
                         familyName: u.last, birthdate: u.dob, sex: u.sex}, login: u.sessionId};
}});
app.all('/natzar/*', (c) => nz.fetch(c.req.raw, c.env));
