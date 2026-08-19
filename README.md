# @natzar/client

Official TypeScript client for the **Natzar Partner API** — AI health-assistant
chat, async physician consults, live video consults, and webhooks.

- **[API reference →](https://natzar-ai.github.io/natzar-client/)** — generated
  from the contract, every route, field, error code and webhook payload.
- Works in Node 18+ and in the browser (two entry points — see below).
- No framework dependency. Subscriptions are plain callbacks.

```bash
npm install @natzar/client
```

---

## The 30-second version

Your **server** holds the API key and mints a session for one patient. Your
**browser** takes that session and subscribes. That is the whole integration.

```ts
// ── your server ────────────────────────────────────────────────────────────
import {NatzarClient} from '@natzar/client';

const natzar = new NatzarClient({apiKey: process.env.NATZAR_API_KEY!});

await natzar.patients.upsert({
  externalId: user.id,          // your id for this person
  phone: user.phone, email: user.email,
  givenName: user.firstName, familyName: user.lastName,
  birthdate: user.dob, sex: user.sex,
});

const session = await natzar.agent.embedSession({externalPatientId: user.id});
// → send `session` to the browser as-is
```

```ts
// ── your browser ───────────────────────────────────────────────────────────
import {connectPatient} from '@natzar/client/patient';

const care = connectPatient(session);

const stop = care.conversation.subscribe((snapshot, sync) => {
  if (!snapshot) return;                       // still connecting
  render(snapshot.timeline);                   // the whole conversation, in order
  if (snapshot.awaitingReply) showTypingDots();
  if (sync.phase === 'retrying') showOfflineHint();
});

await care.conversation.send({text: 'I have had a sore throat for three days.'});
// stop() when you unmount
```

There is **no poll loop, no cursor, no consult state machine and no API key** in
that browser code — and no backend-for-frontend. That is deliberate; see
[Why there are two entry points](#why-there-are-two-entry-points).

---

## Concepts

### The timeline

`snapshot.timeline` is the patient's whole care conversation in one ordered
array — the assistant chat and any clinician thread merged, because that is how
a patient experiences it. Each entry says where it came from:

```ts
for (const entry of snapshot.timeline) {
  entry.author;      // 'patient' | 'agent' | 'physician' | 'system'
  entry.text;        // already localized by the platform
  entry.source;      // 'agent' | 'consult'
  entry.attachments; // images and documents, when present
}
```

`system` entries are lifecycle notices ("a physician has taken your case"), not
prose. Render them as chips if you like, or filter them out.

### Things that need an answer

When the platform needs the patient to act, the entry says so — you never parse
a link out of message text:

```ts
if (entry.awaiting === 'consent') {
  // the agent is offering a physician consult
  await care.respond(entry, true);   // or false to decline
}

if (entry.awaiting === 'rating') {
  await care.rate(entry, {stars: 5, feedback: 'Very helpful'});
}
```

The prompt disappears from the next snapshot on its own once answered.

### The live consult

`snapshot.consult` is present while something is in flight. `phase` is a closed
set you can switch on:

```ts
switch (snapshot.consult?.phase) {
  case 'awaiting_consent': return <Consent />;
  case 'queued':           return <Waiting position={snapshot.consult.position} />;
  case 'active':           return <Thread with={snapshot.consult.physician} />;
  case 'ringing':          return <IncomingCall />;
  case 'in_call':          return <Call />;
  case 'closed':           return <Ended rateable={snapshot.consult.rateable} />;
  case 'unknown':          return <Generic />;   // a phase we added after you shipped
  case undefined:          return null;          // nothing in flight
}
```

`unknown` exists so that adding a phase on our side never crashes your switch.

### Connection health

The second callback argument reports the subscription itself, so a network blip
shows a hint instead of blanking the screen:

```ts
sync.phase; // 'connecting' | 'live' | 'retrying' | 'stopped'
```

Your last good snapshot is retained while `retrying`, and the SDK backs off with
jitter and resumes on its own. When a consult reaches a terminal state the
subscription reports `stopped` and stops polling — a finished consult costs you
nothing.

---

## Why there are two entry points

| | `@natzar/client` | `@natzar/client/patient` |
|---|---|---|
| Runs in | your server | the browser |
| Credential | `pp_live_…` API key | a session your server minted |
| Scope | your whole tenant | one patient |
| Use for | provisioning, clinician tools, webhooks | patient-facing UI |

The API key is tenant-scoped: it can read **every** patient you have, so it must
never reach a browser bundle. The session token is scoped to one patient and
expires, so it can. It is the same split as Stripe's secret and publishable
keys.

This is why you do not need to build a relay: mint a session on your server,
hand it to the browser, done.

> Sessions are **self-describing** — the mint response carries the endpoint and
> the public transport key alongside the token, so nothing about our deployment
> is baked into your bundle and key rotation is invisible to you. Pass the whole
> response to `connectPatient()`.

---

## Server-side

The server client covers every route, one method per endpoint.

```ts
const natzar = new NatzarClient({
  apiKey: process.env.NATZAR_API_KEY!,
  environment: 'prod',   // 'local' | 'dev' | 'stage' | 'prod' (default prod)
});

await natzar.patients.upsert({...});
await natzar.asyncConsults.create({externalPatientId: 'u_1', consent: 'collected'});
await natzar.telehealth.create({externalPatientId: 'u_1'});
```

### Sending messages safely

Message posts are **not** retried automatically, because a retry the platform
cannot recognise would put the same clinical message on a transcript twice. Pin
an `idempotencyKey` and retrying becomes safe — send the same key on every
attempt and the message is delivered exactly once:

```ts
const key = crypto.randomUUID();          // once, before the first attempt
await natzar.agent.send({externalPatientId: 'u_1', text: 'hello', idempotencyKey: key});
```

### Clinician actions

Actions taken *as a physician* need that clinician's own credential — an API key
identifies your application, not a person. Sign them in against the Natzar
provider pool and pass their ID token:

```ts
await natzar.asyncConsults.postReply(
  consultId,
  {text: 'Take 400mg ibuprofen twice daily.'},
  {physicianToken: clinicianIdToken},
);
```

### Errors

Everything throws `NatzarApiError` with a stable `code` — branch on the code,
never the message.

```ts
import {isNatzarApiError, isErrorCode} from '@natzar/client';

try {
  await natzar.asyncConsults.create({externalPatientId: 'u_1', consent: 'embed'});
} catch (e) {
  if (isErrorCode(e, 'has_open_thread')) return showExistingConsult();
  if (isNatzarApiError(e)) log(e.code, e.status, e.route);
  throw e;
}
```

### Webhooks

Verify the signature against the **raw** body, before parsing:

```ts
import {constructEvent} from '@natzar/client';

app.post('/natzar/webhooks', express.raw({type: '*/*'}), (req, res) => {
  const event = constructEvent({
    payload: req.body,                        // Buffer/string — never re-serialized
    signature: req.header('X-Natzar-Signature')!,
    secret: process.env.NATZAR_WEBHOOK_SECRET!,
  });
  switch (event.type) {
    case 'async_consult.assigned': ...
    case 'telehealth.completed':   ...
  }
  res.sendStatus(200);
});
```

---

## Escape hatches

The ergonomic layer never traps you.

```ts
// Any REST route, typed by you
await natzar.raw({method: 'POST', path: '/some/new/route', body: {...}});

// Any patient-surface operation
await care.call({kind: 'query', name: 'embedState', args: {token: session.sessionToken}});

// The subscription engine, for something we do not model
import {watch} from '@natzar/client';
const stop = watch({read: () => myThing(), same: (a, b) => a.v === b.v}, render);

// Our zod schemas, if you want them (not exported by default — they are not
// your dependency unless you ask)
import {postAgentMessageSchema} from '@natzar/client/contract';
```

---

## Reference

Full generated reference — every route, request/response shape, error code,
webhook payload and embed attribute:

**https://natzar-ai.github.io/natzar-client/**

## Development

```bash
npm run sync-contract   # pull shared/partner-api into src/contract
npm run build           # dual ESM + CJS
npm test
```

`src/contract/` is generated. Edit `shared/partner-api/` in the platform repo,
then re-sync — `prepublishOnly` fails the publish on drift.

## License

MIT
