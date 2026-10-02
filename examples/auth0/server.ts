// Auth0 (a bearer-token SPA) — the server: a Fetch runtime (Hono on Workers).
// The SPA's Auth0 ACCESS token for your API arrives as `ask.token` (the auth
// hook in ./browser.ts); `identify` verifies it against your tenant's JWKS.
import {natzar} from '@natzar/client/server';
import {createRemoteJWKSet, jwtVerify} from 'jose';

const ISSUER = 'https://acme.eu.auth0.com/';
const jwks = createRemoteJWKSet(new URL(`${ISSUER}.well-known/jwks.json`));

export const nz = natzar({
  identify: async (_req, {token}) => {
    const v = token ? await jwtVerify(token, jwks, {issuer: ISSUER, audience: 'https://api.acme.com'}).catch(() => null) : null;
    const u = v?.payload.sub ? await users.byAuth0Id(v.payload.sub) : null;
    return v && u && {
      patient: {externalId: u.id, phone: u.phone, email: u.email, givenName: u.first,
                familyName: u.last, birthdate: u.dob, sex: u.sex},
      login: v.payload.sub,   // per user: revokeLogin(sub) at logout ends all of their sessions
    };
  },
});
// NATZAR_API_KEY comes from the Worker's env (a wrangler secret), per request.
app.all('/natzar/*', (c) => nz.fetch(c.req.raw, c.env));
