# @natzar/client

Official TypeScript client for the **Natzar Partner API** — AI health-assistant
chat, async physician consults, live video consults, and webhooks — plus the
two browser surfaces built on it: a patient's care conversation and a
physician's workspace inside your own portal.

- **[API reference →](https://natzar-ai.github.io/natzar-client/)** — generated
  from the contract, every route, field, error code and webhook payload.
- Works in Node 18+ and in the browser (three entry points — see below).
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

if (entry.awaiting === 'join') {
  // a video consult is waiting — see "Video consults" below
  const state = await care.telehealth.join(entry.consultId!);
}

if (entry.awaiting === 'book') {
  // an appointment can be booked — see "Video consults" below
  const grid = await care.telehealth.slots(entry.consultId!);
}
```

The prompt disappears from the next snapshot on its own once answered. When a
message carried one of the platform's consult links, `entry.text` is the prose
without the URL and `entry.link` says what the link can do right now
(`consent` / `rate` / `join` / `book`, or `open` / `rated` / `ended` / `none`
for a control you keep visible but disabled).

Two more flags worth rendering: `entry.emergency` marks the platform's
deterministic emergency line (show it loudly, apart from ordinary advice), and
`entry.signature` carries the clinician's signature on a `physician` entry.

### Attachments

Stage the file first, then attach the handle to a message. Images and PDFs are
read by the assistant.

```ts
const staged = await care.attachments.upload(file);          // a File or Blob
await care.conversation.send({
  text: 'Here is the rash',
  attachment: {...staged, previewUrl: URL.createObjectURL(file)},   // previewUrl is optional
});
```

Refused uploads reject with `unsupported_type` or `file_too_large`.

### Video consults

A video consult invited from the conversation runs on `care.telehealth`, keyed
by the consult id on the entry. The SDK mints and caches the consult-scoped
session for you.

```ts
const {mode} = await care.telehealth.session(consultId);   // 'queue' | 'scheduled'

// On-demand: join() is the presence beat — call it every ~10s while waiting.
const state = await care.telehealth.join(consultId);
if (state.status === 'waiting') showQueue(state.position, state.estimatedMinutes);
if (state.livekit) connectRoom(state.livekit);              // {token, url, roomName}
await care.telehealth.leave(consultId);                     // give up the place in line
await care.telehealth.rate(consultId, {communication: 5, overall: 5});

// Scheduled: pick a slot, then beat in the waiting room from `waitingRoomOpensAt`.
const timezone = deviceTimeZone() ?? undefined;                 // from '@natzar/client/contract'
const grid = await care.telehealth.slots(consultId, {timezone});
const {appointment} = await care.telehealth.book(consultId, {startsAt: grid.slots[0].startsAt, timezone});
const beat = await care.telehealth.appointmentBeat(consultId);   // beat.livekit once the call is on
await care.telehealth.cancelBooking(consultId);
```

A lost booking race rejects with `slot_taken`; `error.details.slots` holds a
fresh grid so the retry is against times that still exist.

#### Time zones

Pass the patient's zone (`deviceTimeZone()` in a browser) as `timezone` on
`slots` and `book`. The grid then comes back **in that zone**: every
`localDate` is the patient's own calendar day, `timezone` echoes what was
used, and the appointment is stamped with it so the confirmation and the
reminders the platform sends read in the patient's clock. Nothing is guessed:
omit it and the grid is in the clinic's zone (`clinicTimezone`, also on every
response) — say so on screen.

```ts
import {deviceTimeZone, describeTimeZone, offsetDifferenceMinutes, describeOffsetDifference} from '@natzar/client/contract';

const grid = await care.telehealth.slots(consultId, {timezone: deviceTimeZone() ?? undefined});
const days = groupBy(grid.slots, (s) => s.localDate);            // days in the patient's zone
label(`Times in ${describeTimeZone(grid.timezone).longName}`);
if (grid.clinicTimezone !== grid.timezone) {
  const at = new Date(grid.slots[0].startsAt);
  const diff = offsetDifferenceMinutes(grid.clinicTimezone, grid.timezone, at);   // clinic minus patient
  if (diff !== 0) note(`The clinic is in ${describeTimeZone(grid.clinicTimezone, at).longName} (${describeOffsetDifference(diff)})`);
}
if (grid.truncated) offerMore(() => care.telehealth.slots(consultId, {from: grid.nextFrom!, timezone: grid.timezone}));
```

A booked `appointment` carries three zones: `timezone` (the one you asked
for), `physicianTimezone` (the physician's calendar zone — show "their
clock" when it differs at `startsAt`) and `clinicTimezone`.

### Session expiry

Sessions are short-lived. Pass `onExpired` and re-mint on your server; the
subscription pauses (no requests) until you hand over the new session, then
resumes where it was.

```ts
const care = connectPatient(session, {
  onExpired: async () => care.refresh(await mintSessionOnMyServer()),
});
```

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

## Why there are three entry points

| | `@natzar/client` | `@natzar/client/patient` | `@natzar/client/physician` |
|---|---|---|---|
| Runs in | your server | the browser | the browser |
| Credential | `pp_live_…` API key | an embed session your server minted | a physician session your server minted |
| Scope | your whole tenant | one patient | one clinician |
| Use for | provisioning, webhooks, admin | patient-facing UI | the clinician's screen in your portal |

The API key is tenant-scoped: it can read **every** patient you have, so it must
never reach a browser bundle. A session token is scoped to one person and
expires, so it can. It is the same split as Stripe's secret and publishable
keys.

This is why you do not need to build a relay: mint a session on your server,
hand it to the browser, done.

> Sessions are **self-describing** — the mint response carries the endpoint
> alongside the token, so nothing about our deployment is baked into your
> bundle and key rotation is invisible to you. Pass the whole response to
> `connectPatient()` / `connectPhysician()`.

---

## The physician surface

A clinician works inside **your** portal, signed in with **your** login, and
never sees a second sign-in. Your server exchanges your session for a Natzar
physician session (single sign-on by token exchange); the browser does the rest.

```ts
// your server — after YOUR authentication of the clinician
const session = await natzar.physicians.session(physicianId);   // tenant key only
// → send `session` to the browser as-is ({sessionToken, expiresAt, apiUrl, physician})

// your browser
import {connectPhysician} from '@natzar/client/physician';

const desk = connectPhysician(session, {onExpired: () => remintAndRefresh()});

const stop = desk.workspace.subscribe((ws, sync) => {
  if (!ws) return;                                   // sync.phase === 'connecting'
  render({
    presence: ws.physician.presence,                 // 'ready' | 'busy' | 'offline'
    queue: ws.telehealth.queue,                      // patients waiting, in order
    ringing: ws.telehealth.active,                   // the call for THIS physician, or null
    inbox: {queued: ws.async.queued, mine: ws.async.mine, overdue: ws.async.overdue},
    upcoming: ws.telehealth.upcoming,                // next 7 days of appointments
  });
});

await desk.presence.ready();                          // on the live rota — the SDK heartbeats
const {livekit} = await desk.telehealth.room(id);     // once `active` reads in_progress
await desk.telehealth.end(id);                        // back on the rota; `next` may already ring
```

What the SDK owns so you do not have to:

- **One read, polled.** The workspace is the whole clinician screen in one
  document; the subscription polls it, fingerprints it, and calls back only when
  something that drives a render changed. Every action (`ready`, `claim`,
  `reply`, `end`…) re-reads at once instead of waiting out the interval.
- **The heartbeat.** A physician stays on the live rota only while beats arrive
  (every 15 s, 45 s TTL). The SDK beats while the physician is `ready` or on a
  call **and** a workspace subscription is open — unsubscribe on unmount and
  the beat stops, so a closed laptop never keeps a clinician on the rota.
- **Expiry.** The first `401` fires `onExpired` once; subscriptions park and
  beats stop. Mint a fresh session on your server and call
  `desk.refresh(session)` — everything resumes where it was.

The inbox is the messaging half:

```ts
await desk.inbox.claim(consultId);                    // take a queued thread
const stopThread = desk.inbox.thread(consultId).subscribe(({consult, messages}) => …);
const file = await desk.attachments.upload({patientId: consult.patientId}, blob);
await desk.inbox.reply(consultId, {text: 'Rest and fluids.', attachment: file});
await desk.inbox.resolve(consultId, {note: 'Take care.'});
await desk.inbox.escalate(consultId);                 // → a live video consult for the patient
```

`desk.languages.set({languages: ['fr', 'en']})` records the languages the
physician consults in (base codes; `PHYSICIAN_LANGUAGES` in the contract) — a
ranked routing preference, never a filter: a patient goes first to a physician
who speaks their language, then to an English speaker, then to anyone.

A session reaches only the physician-side routes (`403 forbidden` elsewhere)
and always acts as its own physician — `desk.client` is the typed REST client
bound to it, for routes this surface does not model (`schedules`, `licenses`,
`asyncConsults.list({assignee: 'me'})`).

### The availability calendar

The hours patients can book are a **schedule**: recurring rules ("Tuesdays
09:00–12:00", every week or every N weeks, optionally between two dates) plus
dated exceptions (time off or extra hours, on a day or across a range). The
engine that turns them into a calendar — and turns a calendar gesture back
into the smallest change — ships in the contract, and the platform runs the
same code, so what you draw is what patients see:

```ts
import {resolveDays, openWindow, closeWindow, blockDates, diffSchedule} from '@natzar/client/contract';

// Read a range (rules always come back whole; exceptions + resolved days for the range).
const schedule = await desk.client.schedules.get('me', {from: '2026-09-01', to: '2026-10-31'});
render(schedule.days);                                // [{date, intervals: [{start, end, specialty}]}]

// Edit by DATE, not by row — the engine picks the right rows to touch.
let draft = {rules: schedule.rules, exceptions: schedule.exceptions};
draft = closeWindow(draft, {date: '2026-09-14', start: 14 * 60, end: 16 * 60});  // this day only
draft = blockDates(draft, {from: '2026-12-21', to: '2027-01-04', reason: 'Leave'});
preview(resolveDays(draft, '2026-09-01', '2026-10-31'));  // live, before saving

// Save the difference — nothing else on the calendar moves.
await desk.client.schedules.update('me', diffSchedule(schedule, draft), undefined, {from: '2026-09-01', to: '2026-10-31'});
```

`schedules.replace` is the whole-rota alternative for a rostering system that
owns the schedule outright.

Every rule and exception is read in **one zone per physician**: the
physician's own (`schedulingTimezone`) when set, else the clinic's. The
schedule response names it as `timezone` (with `clinicTimezone` beside it and
`today` in it); set or clear it with `schedules.update(id, {timezone: 'America/Toronto'})`
/ `{timezone: null}`. A zone change keeps every rule's wall-clock meaning —
Tuesday 09:00 stays 09:00 — and existing appointments keep their instants
(`upcomingAppointments` on the response says how many will re-render on the
new clock). Per-rule `timezone` is refused when it differs from the
physician's zone (`rule_zone_mismatch`); it is the schedule's zone that
carries the meaning. `listTimeZoneIds()` and `describeTimeZone()` from the
contract feed a zone picker.

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
identifies your application, not a person. Three are accepted, strongest first:

| credential | where | pass as |
|---|---|---|
| a Natzar physician session | the browser | `connectPhysician(session)` — see above |
| their Cognito ID token (signed in to the Natzar provider pool) | your server | `{physicianToken}` per call |
| their physician id, asserted by your server | your server | `{physicianId}` per call — switched off per tenant with `403 forbidden` |

```ts
await natzar.asyncConsults.postReply(
  consultId,
  {text: 'Take 400mg ibuprofen twice daily.'},
  {physicianToken: clinicianIdToken},   // or {physicianId: 'phys_…'}
);
```

`{id}` on any `/physicians/{id}/…` route may be `'me'` — the acting physician.

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
