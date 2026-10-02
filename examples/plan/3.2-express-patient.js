// Plan §3.2, verbatim (server). The page adds 2 lines:
//   <script src="/natzar/embed.js" async></script>
//   <natzar-async></natzar-async>
import {natzar} from '@natzar/client/server';

app.use('/natzar', natzar({
  identify: (req) => req.user && {
    patient: {externalId: req.user.id, phone: req.user.phone, email: req.user.email,
              givenName: req.user.firstName, familyName: req.user.lastName,
              birthdate: req.user.birthdate, sex: req.user.sex},
    login: req.sessionID, until: req.session.cookie.expires,
  },
  onStart: (req, {kind}) => req.user.plan === 'care',   // optional: in-widget Start, gated and billed by you (D1)
}));
