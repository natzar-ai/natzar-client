// Plan §3.8, the one-liners, each as printed, on one middleware.
import {natzar} from '@natzar/client/server';

const nz = natzar({
  identify: (req, ask) => req.user && (!ask.patient || req.user.children.includes(ask.patient)) &&   // several patients per login
    {patient: {externalId: ask.patient ?? req.user.id}, login: req.sessionID},
  onEvent: async (event) => { console.log(event.type); },                       // webhooks
  dedupe: {seen: (id) => redis.set(id, 1, {NX: true, EX: 86400}).then((r) => !r)},
});
app.use('/natzar', nz);

export async function routes(req) {
  await nz.revokeLogin(req.sessionID);                                           // immediate revoke at logout
  await nz.startConsult(req, {kind: 'async', context: 'Follow-up'});             // your own flow
  await nz.startConsult(req, {kind: 'referral_request', subject: 'Lipid panel', context: 'Annual check'});
}
