// Plan §3.3, verbatim (server). The page adds 2 lines:
//   <script src="/natzar/embed.js" async></script>
//   <natzar-provider guard-unload></natzar-provider>
import {natzar} from '@natzar/client/server';

const nz = natzar({
  identify: (req) => req.user?.role === 'clinician' && req.user.mfa && {   // YOUR role and MFA rule
    clinician: {externalId: req.user.id},
    login: req.sessionID, until: req.session.cookie.expires,
  },
});
app.use('/natzar', nz);

await nz.client.physicians.create({externalId: user.id, email: user.email,        // once, in your add-clinician flow
                                   givenName: user.firstName, familyName: user.lastName});
await nz.revokeLogin(req.sessionID);                  // in your logout route
await nz.deactivateClinician(user.id);                // in your offboarding job: stops routing and revokes sessions
