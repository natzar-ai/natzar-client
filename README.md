# @natzar/client

Official TypeScript client for the **Natzar Partner API** — AI health-assistant
chat, async physician consults, live video consults, prescriptions with an
in-app pharmacy picker, and webhooks — plus the embed integration: the
`natzar()` middleware that is your whole server side, React components for the
four tags, and two headless browser surfaces (a patient's care conversation, a
physician's workspace inside your own portal).

- **[API reference →](https://natzar-ai.github.io/natzar-client/)** — generated
  from the contract, every route, field, error code and webhook payload.
- Works in Node 20+, Fetch runtimes (Workers, Bun, Deno) and the browser.
- No framework dependency (React is an optional peer, for `/react` only).

```bash
npm install @natzar/client
```

Each hosted deployment serves its REST API from a fixed host, built in:
`https://api.natzar.ai/v1` (US production), `https://api.ca.natzar.ai/v1`
(Canada production), `https://api-stage.natzar.dev/v1` and
`https://api-dev.natzar.dev/v1`. Your key's prefix picks the right one.
`NATZAR_API_URL` (or `baseUrl`) is needed only for a sandbox, or to override.

---

## The 30-second version

Your **server** mounts one middleware and says who the signed-in user is. Your
**page** adds a script and a tag. That is the whole integration: no session
plumbing, no CSRF code, no API key in the browser.

```js
// ── your server (Express) ─ AFTER your session middleware, BEFORE body parsers,
//    CSRF middleware and login redirects
import {natzar} from '@natzar/client/server';

app.use('/natzar', natzar({
  identify: (req) => req.user && {
    patient: {externalId: req.user.id, phone: req.user.phone, email: req.user.email,
              givenName: req.user.firstName, familyName: req.user.lastName,
              birthdate: req.user.birthdate, sex: req.user.sex},
    login: req.sessionID, until: req.session.cookie.expires,
  },
}));
```

```html
<!-- ── your page -->
<script src="/natzar/embed.js" async></script>
<natzar-async></natzar-async>                  <!-- or <natzar-telehealth>, <natzar-agent>, <natzar-provider> -->
```

Configuration, not code: `NATZAR_API_KEY` in the server environment (its prefix
selects the environment and zone, and with it the API host), and the
page origin registered in the console's **Embedding** panel (or
`client.embed.setOrigins`). See [The embed middleware](#the-embed-middleware-natzarclientserver).

Building your own UI instead of a tag? The same middleware serves the headless
SDK (list `'headless'` in its `surfaces`):

```ts
import {connectPatient} from '@natzar/client/patient';

const care = await connectPatient({endpoint: '/natzar'});   // sealed to this page, renews by itself

const stop = care.conversation.subscribe((snapshot, sync) => {
  if (!snapshot) return;                       // still connecting
  render(snapshot.timeline);                   // the whole conversation, in order
  if (snapshot.awaitingReply) showTypingDots();
  if (sync.phase === 'retrying') showOfflineHint();
});

await care.conversation.send({text: 'I have had a sore throat for three days.'});
// stop() when you unmount
```

There is **no poll loop, no cursor, no consult state machine, no token renewal
and no API key** in that browser code — and no backend-for-frontend beyond the
middleware. See [Why there are several entry points](#why-there-are-several-entry-points).

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

if (entry.awaiting === 'pharmacy') {
  // a prescription is waiting for its pharmacy — see "Prescriptions" below
  const {pharmacies} = await care.prescriptions.pharmacies(entry.link!.consultId);
}

if (entry.link?.action === 'view') {
  // a referral's signed PDF — nothing is awaited, see "Referrals" below
  const doc = await care.referrals.document(entry.link.consultId);
}
```

The prompt disappears from the next snapshot on its own once answered. When a
message carried one of the platform's links, `entry.text` is the prose without
the URL and `entry.link` says what the link can do right now (`consent` /
`rate` / `join` / `book` / `choose` / `view`, or `open` / `rated` / `ended` /
`sent` / `expired` / `revoked` / `none` for a control you keep visible but
disabled — a `sent` pharmacy link carries `link.pharmacyName` for its label, a
referral link carries `link.title` for its file card).

Two more flags worth rendering: `entry.emergency` marks the platform's
deterministic emergency line (show it loudly, apart from ordinary advice), and
`entry.signature` carries the clinician's signature on a `physician` entry.

### Priced invites — "Yes & pay" in one press (0.16.0+)

When the clinic charges for the visit an invite offers, `entry.link.payment`
carries the price **before** the click, so the button can say so — and
`care.acceptAndPay` runs the whole round from that one press:

```ts
const price = entry.link?.payment;                       // {amountCents, currency} | undefined
const label = price
  ? `Yes & pay ${new Intl.NumberFormat(locale, {style: 'currency', currency: price.currency.toUpperCase()}).format(price.amountCents / 100)}`
  : 'Yes';

await care.acceptAndPay(entry, {                         // entry.awaiting: 'consent' | 'join' | 'book'
  mount: async ({clientSecret, publishableKey}) => {
    // mount Stripe.js (createEmbeddedCheckoutPage) and resolve from its onComplete;
    // reject if the patient backs out — the next press resumes the same checkout
  },
  // booking: {startsAt, timezone},                      // required for a `book` entry
});
```

It asks the action first with `checkout: true` — so an invite that has
expired, or would fold into the patient's open consult for free, is never
charged for — mounts the checkout the refusal carries (bound to that invite),
waits for the platform to confirm `paid` (Stripe's `onComplete` is not proof;
the signed webhook is), then repeats the action with the payment. A free
invite goes straight through. Because the checkout is bound to the invite, a
patient who paid and reloaded just presses again: the paid payment is adopted,
never charged twice.

The pieces, for your own flow: `care.respond(entry, true, {checkout: true})`,
`care.telehealth.join(id, {checkout: true})` and
`care.telehealth.book(id, {startsAt, checkout: true})` attach the bound
checkout to a payment refusal — read it with `checkoutOf(error)` (exported
from `@natzar/client/patient`); `{paymentId}` presents a payment you hold;
`care.payments.status(paymentId)` is the platform's verdict. The slot grid
carries `BookingSlots.payment` for a "Confirm 3:00 PM · Pay CA$100" button.
The old positional `AbortSignal` argument of `respond` / `join` still works.
See the **Payments** guide in the [API reference](https://natzar-ai.github.io/natzar-client/).

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
by the consult id on the entry: the same patient session covers every consult
the conversation references. Whether it is a waiting room or a booking is
`snapshot.consult.mode` (and the entry's `awaiting`: `join` or `book`). A join
the platform refuses for too little session time (§4.11) switches to a fresh
session and retries once, by itself.

```ts
const mode = snapshot.consult?.mode;                       // 'queue' | 'scheduled'

// On-demand: join() is the presence beat — call it every ~10s while waiting.
const state = await care.telehealth.join(consultId);
if (state.status === 'waiting') showQueue(state.position, state.estimatedMinutes);
if (state.livekit) startCall(state.livekit);                // {token, url, roomName, roomNonce} — see below
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

#### The room (0.17.0+)

A video room is **single-use**. The platform may retire it mid-call (a
clinician's access was revoked, the consult went back to the queue); everyone
is disconnected with LiveKit's `ROOM_DELETED` and the consult carries on in a
new room that the next `join()` hands out. Old tokens are refused only on a
LiveKit server that does not create rooms on join; on one that does, an old
token can recreate the retired room empty — hence the rules below. So a disconnect is not the end of
the call, LiveKit must not reconnect on its own, and the patient must not
publish until the room's metadata carries the grant's `roomNonce`.
`connectPatientRoom` runs a `Room` you construct by those rules:

```ts
import {Room} from 'livekit-client';                        // an optional peer — install it yourself
import {RoomContext, VideoConference} from '@livekit/components-react';
import {connectPatientRoom, patientPullFromJoin, roomOptions} from '@natzar/client/patient';

const room = new Room(roomOptions());                       // automatic reconnection OFF (enforced)
const session = connectPatientRoom({
  room,
  grant: state.livekit!,
  pull: (signal) => care.telehealth.join(consultId, signal).then(patientPullFromJoin),
  onState: setCall,
});
// <RoomContext.Provider value={room}>                      — not <LiveKitRoom audio video>
//   {call.phase === 'live' ? <VideoConference /> : <Reconnecting />}
// </RoomContext.Provider>
// on unmount or hang-up: await session.leave()
```

**Device controls only while `live`.** Mount anything that can turn a device
on — `VideoConference`, `ControlBar`, `TrackToggle`, your own mute or camera
button — only while `call.phase === 'live'`, and render a placeholder in
`connecting` and `repulling`. livekit-client queues a microphone or camera
switched on while the room is not connected and publishes it the moment the
next connection's signal is up, **before** the helper has checked the room: a
tap on "unmute" during "Reconnecting…" could otherwise reach a room an old
token recreated empty. The helper cannot enforce this for you.

Render from `call.phase`: `connecting` (a placeholder); `live` (the call);
`repulling` ("Reconnecting…", a placeholder, never the end of the call); `waiting` (back in the queue — your waiting room,
never the rating screen); `ended` (the rating or outcome screen); `displaced`
(the patient opened the call on another device or tab — show a Resume button
that calls `session.resume()`, never reconnect automatically); `left` (a
LiveKit control in your UI hung up); `error` (`refused` or `exhausted` — offer
`resume()`). For a booked appointment, pull
`care.telehealth.appointmentBeat(consultId, true, signal)` through
`patientPullFromAppointmentBeat`. `livekit` is only ever handed over with its
`roomNonce`. The full rules: the Partner API's Video calls guide.

On a clinic that charges for video, the first `join()` of an on-demand consult
and a `book()` reject `payment_required` until the visit is paid — see
[Priced invites](#priced-invites--yes--pay-in-one-press-0160). Once a payment
is attached to the consult, later `join()` beats need nothing.

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

### Prescriptions

When a physician prescribes, the thread carries a "choose your pharmacy" link.
The page behind it asks for a birthdate and refuses patients you provisioned —
you already authenticated them — so the entry arrives as `awaiting:
'pharmacy'` and the picker runs on `care.prescriptions`, keyed by the
prescription id on the link (`entry.link.consultId`). The link is good for 24
hours.

```ts
const id = entry.link!.consultId;

// 1. Search around the best origin you have — a device fix, the geocoded
//    home address, or a place the patient typed. With none, the platform
//    ranks around the cached home point, or answers `homeAddress` for you
//    to geocode (cache it with setHomeLocation so the next search is ranked).
const list = await care.prescriptions.pharmacies(id, {
  origin: {lat: 43.65, lng: -79.38, source: 'device'},   // 'address' | 'device' | 'ip' | 'manual'
  query: 'main st',                                       // optional: name, city or postal code
  radiusKm: 50,                                           // 25 (default) | 50 | 100 — "search wider"
});
if (list.homeAddress) {
  const point = await myGeocoder(list.homeAddress);
  await care.prescriptions.setHomeLocation(id, point);
}

// 2. The patient picks a `reachable` row — `list.preferred` (the pharmacy
//    their last prescription reached) pre-selected. Fax zones: a row without
//    a fax on file cannot be chosen — offer addPharmacy (below) instead.
const chosen = await care.prescriptions.choose(id, (list.preferred ?? list.pharmacies[0]).directoryId);
// → {status: 'transmitting', pharmacyName, transport: 'erx' | 'fax'}

// 3. Poll the state until it settles; the thread gets the confirmation too.
const state = await care.prescriptions.state(id);
state.action;   // 'choose' | 'sent' | 'expired' | 'revoked' — never throws for a miss
state.status;   // 'awaiting_pharmacy' | 'transmitting' | 'sent' | 'failed' | 'revoked' | 'expired'
```

**The address step (US, e-prescribing).** The network needs a structured
delivery address and the platform's signup asks for a ZIP code only, so in an
e-prescribing zone `pharmacies()` first answers `address.step` — with an
EMPTY list — until the patient has given their home address once and
confirmed it for this prescription (`state.addressRequired` says the same on
the card):

```ts
const list = await care.prescriptions.pharmacies(id);
if (list.address.step) {
  // 'collect' — no address on file: ask for street, apt/unit, city, state,
  //             ZIP (prefill the ZIP with list.address.zipHint)
  // 'confirm' — list.address.onFile: "Yes, use this address" (send it back
  //             unchanged) or "Change address" (the same form, prefilled)
  const {address, point} = await askForAddress(list.address);   // {street, street2?, city, state, zipCode}, the pick's {lat, lng}?
  const listed = await care.prescriptions.setAddress(id, address, point);
  // → the list itself: address.step null, ranked from the point; choose() next
}
```

Run the autocomplete in the patient's own browser (Google Places, or yours) —
the platform receives only the submitted address and the point, rounded to 3
decimals. The address is saved as the patient's home address (every later
prescription only asks to confirm it) and frozen on this prescription, so a
re-choice after a failed transmission is not asked again. `setAddress`
rejects with `invalid_address` (`error.details.code`: `street` / `city` /
`state` / `zipCode` / `tooLong` — the field to fix), `not_choosable`, or
`not_available` in a fax zone, where `address.step` is always null; a
`choose()` before the step is answered rejects with `address_required`.

**The licensure notice and the distance unit.** Every list carries two more
fields:

```ts
import {distanceInUnit} from '@natzar/client/contract';

// A NON-BLOCKING notice: the confirmed delivery address is in a state the
// prescribing physician is not licensed in (only where your tenant enforces
// licensure). Show it calmly above the list — not as an error — and let the
// patient choose as usual.
if (list.licensure) {
  showNotice(`Your prescribing doctor isn't registered in ${list.licensure.stateName}. ` +
    'Most states and pharmacies accept prescriptions from out-of-state doctors, ' +
    'but some pharmacies in some states may refuse it.');
}

// Distances stay km on the wire; print them in the deployment's unit
// ('mi' in the United States, 'km' elsewhere).
const label = (km: number) => {
  const n = distanceInUnit(km, list.distanceUnit);
  return n === 0 ? `< 0.1 ${list.distanceUnit}` : `${n.toLocaleString()} ${list.distanceUnit}`;
};
```

`licensure` is null while the address step is pending, so look for it on the
list `setAddress` answers (it is judged against the address just confirmed)
and on every later read. `stateName` is English; localise from the
two-letter `state` when you render another language. `radiusKm` stays km
too: label the "search wider" steps in the list's unit, rounded to the
nearest whole unit (the platform's own pickers read 25 / 50 / 100 km as
16 / 31 / 62 mi; the US search covers that many whole miles, so never round
down).

`state.status === 'failed'` means the transport gave up — the action reads
`choose` again and the patient picks another pharmacy. In fax zones a
pharmacy no directory covers can be typed in:

```ts
const added = await care.prescriptions.addPharmacy(id, {name, address, city, region, postalCode, fax});
// → {directoryId, pharmacy, status: 'pending_verification', probe: 'sent' | 'not_sent', faxIssue}
```

It is not chosen yet: the platform faxes a one-page probe to the line, and a
delivered probe chooses that pharmacy for this prescription on its own — keep
polling `state()` after `probe: 'sent'`. A refused choice rejects with
`not_choosable` / `expired` / `lost_race` (`error.details.status` says where
the prescription is now), `pharmacy_not_found`, `pharmacy_unreachable` or
`address_required`;
`addPharmacy` with `invalid_pharmacy` (`error.details.code` names the field)
or `not_available` outside fax zones. These are the patient surface's own
spellings (`PatientSurfaceErrorCode`), and `isErrorCode` accepts them:

```ts
import {isErrorCode} from '@natzar/client';   // the predicates live on the root; it tree-shakes

try {
  await care.prescriptions.choose(id, directoryId);
} catch (e) {
  if (isErrorCode(e, 'not_choosable') || isErrorCode(e, 'lost_race')) return reloadPicker();
  throw e;
}
```

**Where the origin comes from.** The platform's own page (and the embed
widget) walk this chain: the server's origin → the geocoded home address
(cached with `setHomeLocation`) → a device fix → a coarse point from the
patient's IP → a place the patient typed. The SDK stops one hop short — it has
no IP lookup — so with no fix and no home either ask for a postal code, or
resolve a coarse origin from the patient's IP with your own service and pass
it with `source: 'ip'` (distances then read as approximate).

### Referrals

When a physician refers the patient — to a specialist, for laboratory tests,
for an imaging exam — the thread carries a "view your referral" link to a
signed PDF requisition. The page behind it asks for a birthdate, refuses
patients you provisioned and dies after 30 days; on the patient session none
of that applies. The entry arrives with `link.kind === 'referral'` and
`link.action === 'view'` (keyed by the referral id, `entry.link.consultId`),
its `text` already without the URL **and** without the "active for the next
30 days" sentence, and `link.title` naming the document ("Laboratory
requisition"). Nothing is awaited — the patient carries the document — so
`awaiting` stays unset. Render a file card with an "Open referral" button:

```ts
const id = entry.link!.consultId;

// Open the tab FIRST, inside the click, then point it at the URL: a
// window.open that follows an await is a popup to every browser.
const tab = window.open('', '_blank');
if (tab) tab.opener = null;
const doc = await care.referrals.document(id);
if (doc.status === 'issued' && tab) tab.location.href = doc.document.url;
else tab?.close();

doc.status;             // 'issued' | 'revoked' — never 'expired' on this session
doc.title;              // "Laboratory requisition"
doc.physicianName;      // "Dr. Sarah Chen"
doc.document?.url;      // a presigned URL minted on THIS call, good for `expiresIn` seconds
doc.document?.fileName; // "Laboratory-requisition-<id>.pdf"
```

The URL is minted fresh on every call and expires in minutes — never store
it; call `document()` again inside the next tap. A withdrawn referral answers
`status: 'revoked'` with no document (and its link reads `revoked` — keep the
button visible, disabled, labelled "Referral withdrawn"). A referral that is
not this patient's rejects with `not_found`.

### Session lifetime

Renewal is automatic: the SDK renews the access credential 60 s before it
expires (and when the tab comes back, on focus, when the network returns, and
when an operation answers `session_expired`), on the same session, until the
session's absolute limit — then it asks your endpoint for a new one, which runs
your `identify` again. You write nothing for any of that.

`onExpired({reason, code})` fires once, only when no session can be had any
more: `signed_out` (your `identify` said no: the user signed out on your site),
`revoked`, `absolute`, `access`. Subscriptions pause until you call
`care.reconnect()` (typically after the user signed back in). `care.logout()`
revokes the session on the platform; `care.disconnect()` just stops.

```ts
const care = await connectPatient({endpoint: '/natzar'}, {
  onExpired: ({reason}) => (reason === 'signed_out' ? showSignIn() : showSessionEnded()),
});
```

The credential never touches storage, a URL or your server: in a browser it is
sealed to a non-extractable key this page generated, and opened only here.
React Native / Expo (no page to seal against) uses surface `native` with a
bearer: `connectPatient({endpoint: 'https://api.acme.com/natzar', auth: () => token, native: true})`
(list `'native'` in the middleware's `surfaces`). `native: true` is refused on
a web page.

**Video joins and your login (D12).** A join refused for too little session
time switches to a fresh session and retries once, by itself. When YOUR login
is the limit (a fresh session would end just as soon), the join rejects and
`joinAnywayOf(error)` says `joinAnywayAllowed: true`: show the expected end
time, and on the user's choice call `care.telehealth.join(id, {acceptShortSession: true})`
(`desk.telehealth.room(id, {acceptShortSession: true})` for clinicians).

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

## Organization billing

Your server can read the prices the organization saved in the provider portal and reconcile each patient with Stripe:

```ts
const catalog = await natzar.billing.catalog();
const payments = await natzar.billing.payments({limit: 50});
const customers = await natzar.billing.customers();
const memberships = await natzar.billing.memberships();
const checkout = await natzar.billing.visitCheckout({patientId, modality: 'async', mode: 'live',
  successUrl: 'https://your-platform.example/billing/complete',
  cancelUrl: 'https://your-platform.example/billing/cancelled'});
// Send checkout.checkoutUrl to your authenticated patient. Keep checkout.paymentId.
const payment = await natzar.billing.payment(checkout.paymentId!);
// Present payment.id to the visit API only after payment.paid is true.
const membershipCheckout = await natzar.billing.membershipCheckout({patientId, interval: 'month'});
```

To keep the patient on your page, ask for an embedded checkout and mount Stripe's card form yourself (0.15.0+):

```ts
// server
const embedded = await natzar.billing.visitCheckout({patientId, modality: 'async', mode: 'live', uiMode: 'embedded'});
// → {ok, paymentId, clientSecret, publishableKey}; hand the last two to the browser, keep paymentId
// browser
const stripe = await loadStripe(publishableKey);            // @stripe/stripe-js
const form = await stripe!.createEmbeddedCheckoutPage({clientSecret, onComplete: () => confirmOnServer(paymentId)});
form.mount('#payment');
```

An embedded checkout never redirects — `onComplete` is your cue to verify `billing.payment(paymentId)` server-side, exactly as for a hosted return. A deployment with no Stripe publishable key configured refuses `uiMode: 'embedded'` with `400 invalid_request`; fall back to the hosted `checkoutUrl`.

`catalog.visits` contains the five live and booking scenarios with their Stripe Product and Price IDs; on-demand visits use the corresponding live or booking price. `catalog.membership` contains monthly and annual recurring Price IDs. Payment, Customer, and Membership records are scoped to your organization and carry the Stripe IDs needed for reconciliation. The embedded patient module handles Checkout and waits for webhook confirmation before completing a paid visit.

Custom return URLs must use an origin in your partner app's allowed origins (https; `http://localhost` is also accepted outside production). Send both or neither: the default returns to Natzar's own payment page. The visit return URL receives `natzar_payment`; check its status through `billing.payment(id)` before using it. The redirect itself is never proof of payment. Don't put a `{PAYMENT_ID}` placeholder in your own URL: rely on the appended `natzar_payment` parameter.

`billing.visitCheckout` takes **our** patient id (`patients.upsert(...).patient.id`), not your `externalPatientId`. A free scenario answers `{ok: true, free: true, paymentId: null}`: create the visit without a `paymentId`. `{ok: false, error}` (`payments_unavailable`, `scenario_not_priced`, `stripe_error`) arrives as a 200, not as a thrown error. Once `payment.paid` is true, present `paymentId` on `asyncConsults.create` (`consent: 'collected'`) or `telehealth.book`. Without it, a priced scenario answers `402 payment_required` with `details.amountCents` / `details.currency` and — from 0.16.0 — `details.modality` / `details.mode`. A payment that isn't paid yet, belongs to another patient or scenario, or was already spent answers `402 payment_invalid` with `details.reason`. `payment_already_used` doubles as the dedupe for a create you retried after a timeout: on `asyncConsults.create` its `details.asyncConsultId` names the thread the payment already opened, when it is this patient's. Two creates racing with the same `paymentId` (a reloaded return page, a second tab) converge the same way: one opens the thread, the other gets `402 payment_invalid`; for a `referral_request` the loser's thread is closed, not left `invited`.

#### Paying for an invite (0.16.0+)

For an invite the patient is answering — an async consent, an on-demand video join, a booking — key the checkout on the **consult** rather than on a scenario, and read the price off the consult rather than the catalog:

```ts
// the price to put on the button, before any click
const {consult} = await natzar.asyncConsults.get(consultId);
consult.payment;   // {status: 'due', amountCents, currency, modality, mode} | {status: 'paid', paymentId, …} | undefined

// the patient pressed "Yes & pay": ask the ACTION first (it checks expiry and the fold before money)
async function acceptInvite(consultId: string) {
  try {
    await natzar.asyncConsults.consent(consultId, {accept: true});
    return;                                                        // free, folded, or already paid (adopted)
  } catch (e) {
    if (!isErrorCode(e, 'payment_required') && !isErrorCode(e, 'payment_invalid')) throw e;
  }
  const checkout = await natzar.billing.visitCheckout({asyncConsultId: consultId, uiMode: 'embedded'});
  if (!checkout.ok) throw new Error(checkout.error);               // payments_unavailable / scenario_not_priced / stripe_error (retry)
  if (checkout.free) {                                             // consent would fold: nothing to pay
    await natzar.asyncConsults.consent(consultId, {accept: true});
    return;
  }
  if (!checkout.alreadyPaid) {
    // {paymentId, clientSecret, publishableKey} — showPaymentForm is YOUR relay: the browser
    // mounts Stripe.js with the two and resolves on its onComplete
    await showPaymentForm(checkout.clientSecret!, checkout.publishableKey!);
  }                                                                // alreadyPaid (or settling): nothing to mount
  if (checkout.paymentId) await natzar.billing.waitForPayment(checkout.paymentId);   // the platform's `paid`, not the browser's
  await natzar.asyncConsults.consent(consultId, {accept: true});   // the bound payment is adopted — no id needed
}
```

`{telehealthConsultId}` does the same for a video consult (`telehealth.join(id)` / `telehealth.book(id, {startsAt})`). A consult-keyed checkout is **bound** to the consult: a second call hands back the checkout in progress (`reused: true`), a paid one answers `alreadyPaid` (`settling` while the webhook is in flight), a consult that can no longer be taken is `409 thread_not_active`, and the action that follows adopts the paid payment without its id. A **decline** (`consent(id, {accept: false})`) is refused while money is in play for the invite: `409 thread_not_active` with `details.reason: 'payment_settled'` once it is paid for (paying is consenting — accept it instead), `402 payment_invalid` (`payment_not_completed`) while its checkout is still in progress, `payment_check_failed` when that could not be checked (retry). `telehealth.join(id, {paymentId})` takes the payment explicitly when you have one (`join(id, opts)` still works). `billing.payment(id)` now reports `consultId`, `modality`, `mode` and `paidAt`. The full picture — hosted vs embedded, the 402 table, the edge cases — is the **Payments** guide in the [API reference](https://natzar-ai.github.io/natzar-client/).

> **Behaviour change in 0.16.0's platform release:** `POST /v1/telehealth-consults/{id}/join` is payment-gated. On a clinic that charges for on-demand video, the first join of an unpaid consult answers `402 payment_required` and queues nobody (it used to queue the patient for free). Clinics that do not charge see no change.

---

## Why there are several entry points

| Entry | Runs in | Credential | Use for |
|---|---|---|---|
| `@natzar/client` | your server | your API key (`pp_live_…`) | provisioning, every REST route, `resolveEndpoints({key})` |
| `@natzar/client/server` | your server | your API key | `natzar()`: the embed middleware — sessions, Start, the script redirect, webhooks |
| `@natzar/client/react` | the browser | none | the four tags as React components |
| `@natzar/client/elements` | types only | none | `HTMLElementTagNameMap` / JSX types of the tags and their events |
| `@natzar/client/patient` | the browser / RN | an `nz1` session from your middleware | a patient UI of your own (headless) |
| `@natzar/client/physician` | the browser / RN | an `nz1` session from your middleware | the clinician's screen in your portal (headless) |

The API key is tenant-scoped: it can read **every** patient you have, so it
must never reach a browser — and cannot by accident: a browser bundle that
imports `@natzar/client/server` fails at build (its `browser` export condition
resolves to a stub that exports nothing). A session is scoped to one person,
sealed to one page and short-lived, and your server only ever relays its
ciphertext.

---

## The physician surface

A clinician works inside **your** portal, signed in with **your** login, and
never sees a second sign-in. The same `natzar()` middleware vouches for them
(your `identify` returns `{clinician: {externalId}}` after YOUR role and MFA
check; the tenant's delegation is `delegated`, D9) and mints a headless
clinician session with today's physician route set; the browser does the rest.
For the embedded workspace instead, use the `<natzar-provider>` tag.

```ts
// your server: natzar({identify, surfaces: [..., 'headless']}) — see the middleware section

// your browser
import {connectPhysician} from '@natzar/client/physician';

const desk = await connectPhysician({endpoint: '/natzar'}, {onExpired: () => showSignIn()});
// split origin (rmc): connectPhysician({getSession: (ask) => mySessionRelay(ask), config})

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
- **The session.** Renewed by itself (300 s access credential); when it ends
  for good (`signed_out`, `revoked`, the idle lock) `onExpired` fires once,
  subscriptions park and beats stop; `desk.reconnect()` resumes everything.
  `desk.logout()` revokes the session with its own credential; call the
  middleware's `revokeLogin` in your logout route too.

The call itself runs on a LiveKit `Room` you construct, by the same rules as
the patient's ([The room](#the-room-0170)):

```ts
import {Room} from 'livekit-client';
import {connectPhysicianRoom, physicianPullFromRoom, roomOptions} from '@natzar/client/physician';

const room = new Room(roomOptions());
const session = connectPhysicianRoom({
  room,
  grant: livekit!,                                    // from desk.telehealth.room(id)
  pull: (signal) => desk.telehealth.room(id, signal).then(physicianPullFromRoom),
  onState: setCall,
});
```

`ROOM_DELETED` pulls `room()` again and reconnects; `DUPLICATE_IDENTITY` (the
same physician in another window, or in the provider embed) reports
`displaced` — show "in use in another window" with a "Use here" button that
calls `session.resume()`; `PARTICIPANT_REMOVED` reports `removed`. The helper
never ends the consult: only `desk.telehealth.end()` does. A booked
appointment pulls `desk.telehealth.ready(id, true, signal)` through
`physicianPullFromReady`. The token only has to connect (10 minutes); a
connected physician stays connected, and revoking them afterwards only
refuses their next pull. As on the patient side, the mic and camera switches
(and any `ControlBar` / `TrackToggle`) are mounted only while
`call.phase === 'live'`; `connecting` and `repulling` render a placeholder.

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

A session reaches only the `physician-rest` routes its capabilities allow
(`403` elsewhere) and always acts as its own physician — `desk.client` is the
typed REST client bound to the current credential, for routes this surface
does not model (`schedules`, `licenses`, `asyncConsults.list({assignee: 'me'})`).

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

## The embed middleware (`@natzar/client/server`)

One export for every framework:

```ts
import {natzar} from '@natzar/client/server';

// Express / Connect / Node — mount AFTER the middleware that sets the user
// (session, passport) and BEFORE body parsers, csurf/lusca and login redirects
app.use('/natzar', nz);

// Next.js App Router — app/natzar/[...natzar]/route.ts (and exclude /natzar/ from the middleware.ts / proxy.ts matcher)
export const {GET, POST} = natzar({identify: async (_req, {audience}) => …});

// Fetch runtimes — Hono, Workers, Bun, Deno, Remix, SvelteKit
app.all('/natzar/*', (c) => nz.fetch(c.req.raw, c.env));   // env may carry NATZAR_API_KEY
```

| Option | |
|---|---|
| `identify(req, ask)` | **Required.** Map YOUR login to `{patient}` or `{clinician}` (plus `login`, `until`, `consult?`, `capabilities?`, `clinicianToken?`), or anything falsy (→ the signed-out state). `ask` is `{audience, surface, consult?, patient?, token?, view?}`; `token` is the bearer from `window.natzarConfig.auth`. Runs on every mint AND renewal. |
| `onStart(req, {kind, mode, surface})` | In-widget Start, gated and billed by you (D1): `false` refuses, `true` opens, `{context}` opens with a note. The visit is opened with your key. |
| `onEvent(event, req)` / `dedupe` | Verified webhooks at `POST {mount}/webhook`. At-least-once: dedupe on `event.id` (`dedupe: {seen, forget?}`); a throw answers 500 so Natzar retries. |
| `surfaces` | Default the tags' surfaces; `'headless'` and `'native'` must be listed. |
| `origins` | Page origins allowed to call cross-origin (exact; CORS only for them). |
| `apiKey`, `webhookSecret`, `apiUrl` | Default `NATZAR_API_KEY`, `NATZAR_WEBHOOK_SECRET`, `NATZAR_API_URL`. The key prefix selects the environment, zone and built-in API host; `apiUrl` is needed only for a sandbox. |
| `basePath` | The full path you serve it under (`/api/natzar`): only `{basePath}/<route>` is answered. Recommended on Fetch runtimes and bare Node servers; an Express mount is detected. |

What it enforces so you do not have to: `POST` + JSON + ≤ 4 KB +
`X-Natzar-Request: 1`; same origin by `Sec-Fetch-Site` (else `Origin` host =
`Host`); cross-origin only from `origins`; no `Origin` only for `native` with a
bearer; a strict body; `identify` answers for the other audience refused;
`loginRef = sha256('natzar-login:' + login)` (your raw session id never
leaves); `parentOrigin` = the verified `Origin`; no browser header forwarded;
`no-store`, `nosniff`, `X-Natzar-Endpoint: 1` on every answer; errors from a
fixed allowlist, bodies never echoed; codes-only logs; a best-effort limit per
login; `GET /v1/embed/config` cached 5 min. A misplaced mount (after a body
parser, a CSRF guard or a login redirect) shows up as `endpoint_misconfigured`
in the browser console and the fix in your server log.

Routes below the mount: `POST /session`, `POST /start` (with `onStart`),
`GET /embed.js` (302 to the loader of your key's deployment), `GET /config`
(the deployment facts, with the API URL derived from YOUR key, which overrides
Natzar's), `POST /webhook` (with `onEvent`). Everything else is 404. Mount it at
`/natzar` (or set `basePath`), never at the app root: under Express only routes
directly below the mount answer.

What `identify` returns, precisely:
- `login`: a non-empty string or a finite number — never an object
  (`req.session`), which would put every user in one `loginRef`.
- `until`: a `Date`, an ISO string or epoch **milliseconds**; epoch seconds (a
  JWT `exp`) are refused rather than read as 1970.
- `patient.birthdate`: prefer `'YYYY-MM-DD'`. A `Date` is accepted only at
  midnight UTC or at midnight in the server's zone (node-postgres `DATE`);
  any other instant is refused, never guessed.
- With a bearer (`ask.token`), authenticate with the token only: the session
  is marked bearer-authenticated only when the request carried no cookie.
- `native` is minted only for an app (no `Origin`, or a native shell's:
  `capacitor://localhost`, `ionic://localhost`, `https://localhost`) with a
  bearer and no cookie; a web page always gets the sealed `headless` surface.

Notes:
- **The browser guard needs the `browser` condition.** esbuild
  (`platform: 'browser'`) and Vite set it, and the build fails (verified).
  webpack's web targets resolve the stub too; whether a missing export fails
  or only warns depends on its `exportsPresence`, and the stub throws at load
  either way. esbuild `platform: 'neutral'` and a Rollup
  `@rollup/plugin-node-resolve` without `browser: true` resolve the real
  middleware: there, nothing stops the import — keep the key out of browser
  code regardless (it is only ever read from the server environment).
- **`startConsult(req, …)` has no CSRF check of its own**: call it only from a
  CSRF-protected POST route of yours.
- **Webhook dedupe marks before your handler runs**: a duplicate delivered
  while the first is still running is acknowledged. Finish within 10 s, or make
  the handler idempotent.
- Without `Sec-Fetch-Site` (older browsers), same origin is proven by the
  `Origin` HOST against `Host` (the scheme is not compared); a browser cannot
  reach that path cross-origin, because the custom header forces a preflight
  that only your listed `origins` pass.

Helpers for your own routes:

```ts
await nz.client.physicians.create({externalId, email, givenName, familyName});  // NatzarClient from your key
await nz.revokeLogin(req.sessionID);        // logout: every session of that login, at once
await nz.revokePatient(externalId);         // or nz.revokeClinician(externalId)
await nz.deactivateClinician(externalId);   // offboarding: not routable, sessions revoked
await nz.startConsult(req, {kind: 'async', context: 'Follow-up'});   // your own flow; the tag finds it
await nz.startConsult(req, {kind: 'referral_request', subject: 'Lipid panel', context: '…'});
```

`examples/` type-checks the plan's samples (Express, Next.js, Hono/Workers,
bearer SPAs) and full Firebase and Auth0 integrations against this package.

## React (`@natzar/client/react`)

```tsx
import {NatzarAsync, NatzarProvider} from '@natzar/client/react';

<NatzarAsync onMessage={({consultId}) => bumpBadge(consultId)} />           // injects /natzar/embed.js once
<NatzarProvider view="inbox" navigation="host" guardUnload
  onUnreadChange={({count}) => setTitle(count)} onOpen={({kind, consultId}) => route(kind, consultId)} />
```

`NatzarAsync`, `NatzarTelehealth`, `NatzarAgent` and `NatzarProvider` take the
tag's attributes as props (`theme`, `locale`, `accent`, `consult`, `patient`,
`endpoint`, …; `view`, `navigation`, `guardUnload` on the provider) and one
`on…` prop per event, called with `(detail, event)` — call
`event.preventDefault()` on the cancelable `onPayment` (`started`) and
`onSwitchRequest`. A `ref` is the element (`logout()`, `canLeave()`,
`navigate()`). `loader={false}` when you place the script yourself (strict CSP
with a pinned, SRI-checked loader).

## Element types (`@natzar/client/elements`)

`import type {} from '@natzar/client/elements'` once types
`document.querySelector('natzar-async')`, `addEventListener('natzar:message', e => e.detail…)`,
`window.natzarConfig` and the global `JSX.IntrinsicElements`; importing
`@natzar/client/react` adds the tags to React 19's `React.JSX`.

## Server-side

The server client covers every route, one method per endpoint.

```ts
const natzar = new NatzarClient({
  apiKey: process.env.NATZAR_API_KEY!, // the prefix selects environment, zone and API host
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
| a Natzar clinician session | the browser | `await connectPhysician({endpoint: '/natzar'})` — see above |
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

### Prescriptions and links, server-side

The same pharmacy picker is reachable from your server, for a surface you
build over the REST API rather than the browser module:

```ts
const {prescription} = await natzar.prescriptions.get(id);           // status, window, action, addressRequired
const list = await natzar.prescriptions.pharmacies(id, {lat, lng, source: 'device', radiusKm: 50});
// e-prescribing zones: while list.address.step is 'collect' | 'confirm' the list is empty
await natzar.prescriptions.setAddress(id, {address: {street, street2, city, state, zipCode}, lat, lng});   // → the list
await natzar.prescriptions.choosePharmacy(id, {directoryId});         // 409 prescription_not_choosable past choosing
await natzar.prescriptions.choosePharmacy(id, {directoryId, address}); // or confirm the address with the choice
await natzar.prescriptions.setHomeLocation(id, {lat, lng});
await natzar.prescriptions.addPharmacy(id, {name, address, fax});     // fax zones; 201 pending_verification
```

The list's `preferred` is the patient's remembered pharmacy (the one their
last prescription reached, on any surface) — pre-select it. In an
e-prescribing deployment the list carries an address step first
(`address.step`, the patient's address on file as `address.onFile` for the
confirmation): answer it with `setAddress` (`422 invalid_address` with
`details.code` naming the field) or pass `address` with the choice; a choice
without one is `409 address_required`. `list.licensure` (`{state,
stateName}` or null) is the non-blocking prescriber-licensure notice to show
above the list, and `list.distanceUnit` (`'mi'` | `'km'`) the unit to print
`distanceKm` in (`distanceInUnit` from `@natzar/client/contract`). See the
Partner API's prescriptions guide for the whole flow.

`GET /v1/patients/state` also carries `prescription` — the newest one still
waiting for its pharmacy — so a screen can offer the picker without reading
the transcript.

To render a transcript you fetched over REST (`agent.messages`,
`asyncConsults.messages`), `detectLink` / `stripLink` / `resolveLinkActions`
turn every platform link — consent, rating, video, booking and pharmacy —
into a button with the right label. The prescription routes are tenant-key
only (a physician session gets `403 forbidden` on them), so on a session
client `resolveLinkActions` still resolves the consult links and leaves a
pharmacy link unresolved — `actionFor` then falls back to `choose`:

```ts
import {detectLink, stripLink, resolveLinkActions, actionFor, pharmacyActionFor} from '@natzar/client';

const actions = await resolveLinkActions(natzar, items);   // one read per referenced consult / prescription
for (const m of items) {
  const link = detectLink(m.body ?? '');
  if (!link) continue;
  render(stripLink(m.body!), actionFor(link, actions), actions[link.consultId]?.pharmacyName);
}
```

`pharmacyActionFor(prescription, nowMs)` recomputes a pharmacy link's action
against your own clock, so a card flips to `expired` the moment the 24-hour
window lapses rather than at the next read.

### Referrals, server-side

A referral is one read — the link state plus a short-lived URL to the signed
PDF, minted on that read:

```ts
const {referral} = await natzar.referrals.get(id);   // status, action, title, physicianName, document
referral.action;          // 'view' | 'revoked' — never 'expired' for a referral of yours
referral.document?.url;   // presigned GET, expires in minutes (document.expiresAt); null once revoked
referral.document?.downloadUrl;   // the same object served as an attachment, for a Download control
```

`resolveLinkActions` resolves `/referral?id=` links too (`{kind: 'referral',
action, title}` — the URL is deliberately not kept; `get` again on the tap
that opens it), `stripLink` drops the notice's "active for the next 30 days"
sentence along with the URL, and `referralActionFor(referral)` derives the
action from the status. The referral route is tenant-key only like the
prescription routes; on a physician session `resolveLinkActions` leaves the
link unresolved and `actionFor` falls back to `view`. The two notices —
`async:referral_issued`, `async:referral_revoked` — are ordinary
`async_consult.message` events, and webhook payloads never carry the document.

### Referral requests — non-blocking async consults

An async consult is, by default, a **conversation**: the assistant goes silent,
the patient's messages reach the physician, one open thread per patient. When
the patient needs a *document* rather than a dialogue — a requisition for a
test your own prevention module recommended, say — open a **request** instead:

```ts
const {consult} = await natzar.asyncConsults.create({
  externalPatientId: 'u_1',
  consent: 'collected',
  kind: 'referral_request',
  subject: 'Lipid panel (cholesterol)',           // the one-line label every notice names
  context: 'Male, 52, ... Requesting a fasting lipid panel requisition.',   // the ask the physician reads
});
consult.kind;   // 'referral_request'
```

The assigned clinician can sign and deliver the requisition from a physician
session. This is available in `@natzar/client` 0.11.0 and later:

```ts
const desk = await connectPhysician({endpoint: '/natzar'});
const referral = await desk.inbox.issueReferral(consult.id, {
  draft: {
    kind: 'laboratory',
    tests: ['lipid_panel', 'hba1c'],
    priority: 'routine',
    fasting: true,
  },
  lang: 'en',
});
// referral.id / referral.kind / referral.title / referral.issuedAt
```

The same operation is available on the raw client as
`natzar.asyncConsults.issueReferral(consultId, body, physicianOptions)`. It is
intentionally not retried automatically: an ambiguous timeout around a signed
clinical document must be reconciled from the thread before issuing another.

From 0.12.0, send up to five requisitions in one operation and one patient
link with `desk.inbox.issueReferrals(consultId, {drafts: [labDraft,
imagingDraft], lang: 'en'})`. Each referral is a separate signed PDF;
`care.referrals.document(linkId).files` lists them for a patient-session UI
(and `GET /v1/referrals/{id}` exposes the same `files` list). A physician
session also exposes `desk.inbox.issuePrescription(consultId, {draft:
{items: [...]}})` in fax jurisdictions. The prescription link lets the
patient choose their pharmacy. US e-prescriptions still require the vendor's
prescriber composer and cannot be issued through this free-text route.

A request never silences the assistant, may sit beside an open conversation
(and beside other requests — `has_open_thread` is never raised for or by one),
and carries no messages: `postMessage` and `reply` on it answer
`409 request_thread`. The physician's one move is to issue the referral, which
lands on the patient's transcript as the ordinary `async:referral_issued`
notice and closes the request `closedReason: 'fulfilled'`; if they need to ask
the patient something first they switch it to a conversation from the portal
(`kind` becomes `'conversation'`, the patient is told a physician now reads
what they write, and the thread behaves like any other from then on). Poll
`asyncConsults.get(id)` for `status` / `closedReason` if you show the request's
progress; `kind` is present on every consult, `'conversation'` for the ones
that predate it.

### Suggested referrals — pre-filled requests

From 0.13.0, a request can carry the referral drafts you already know it
needs, the same `ReferralDraft` shape `issueReferrals` signs, one to five per
request. The physician's "Generate referrals" step opens pre-filled. They
review, may edit, and sign:

```ts
const {consult} = await natzar.asyncConsults.create({
  externalPatientId: 'u_1',
  consent: 'collected',
  kind: 'referral_request',
  subject: 'Requisitions — prevention check-up (2)',
  context: 'Prevention questionnaire (2026-09-23). F, 67, hypertension, smoker 30 pack-years…',
  paymentId,                                      // when the tenant charges (see Organization billing)
  suggestedReferrals: [
    {kind: 'laboratory', tests: ['lipid_panel', 'hba1c'], priority: 'routine',
     clinicalInfo: 'Hypertension, high cholesterol — cardiovascular risk screening.'},
    {kind: 'imaging', modality: 'ct', examination: 'Low-dose chest CT (lung cancer screening)',
     clinicalIndication: 'Current smoker, 30 pack-years, age 67.', priority: 'routine'},
  ],
});
consult.suggestedReferrals;   // as validated and normalized, on every read of the consult
```

Each draft is validated with the same rules the signing step applies, so a
suggestion the physician could never sign is refused up front: `400
invalid_request`, and `details` names the draft's index and the rule it
breaks. `suggestedReferrals` is refused on a conversation. Health-card fields
are optional. Leave them out unless you have the patient's consent to share
them.

On the physician side, `desk.inbox.generateReferrals(consultId, {lang})` does
the whole step in one call. It reads the consult fresh, claims it when it is
still `queued`, and signs its suggestions as one bundle: one PDF each, one
patient link, in the patient's language (`consult.patientLang`) unless you
pass `lang`. Pass `drafts` to sign edited versions instead; an empty `drafts`
(nothing selected) is refused, never read as "all of them".
`desk.inbox.suggestedReferrals(consultId)` reads them for a review dialog. A
consult with nothing suggested throws `no_suggested_referrals` before any
write:

```ts
const drafts = await desk.inbox.suggestedReferrals(consult.id);   // [] when none
const {referral, referrals} = await desk.inbox.generateReferrals(consult.id, {drafts: edited, lang: 'fr'});
```

Follow the request to its documents from your server with
`asyncConsults.referrals(id)`: the referrals issued on the thread, newest
first, one entry per issue. A bundle appears once, as its lead with `files[]`
(which includes the lead's own PDF); a single-document issue carries only
`document` and no `files`; a revoked entry has `document: null`. Each
`document.url` is minted on that read and expires in minutes, so read again
right before opening. The route is tenant-key only:

```ts
const {referrals} = await natzar.asyncConsults.referrals(consult.id);
for (const r of referrals) {
  if (r.status !== 'issued') continue;   // revoked: withdrawn, no document
  const docs = r.files?.length ? r.files : r.document ? [{title: r.title, document: r.document}] : [];
  for (const f of docs) render(f.title, f.document.url);
}
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

`code` is `NatzarErrorCode`: the REST contract's `ErrorCode` from the server
half, plus `PatientSurfaceErrorCode` — the embed plane's own spellings
(`expired`, `not_choosable`, `lost_race`, `booking_disabled`…) that
`@natzar/client/patient` throws. A patient-surface refusal arrives in-band on
a 200, so its `status` is nominal: the one the contract assigns the same code
(`401` for a token, `404` for `not_found`, `422` for `invalid_location`) and
`409` for the embed-only codes. `PhysicianSurfaceErrorCode`
(`no_suggested_referrals`) is raised by `@natzar/client/physician` itself,
before any request. Branch on `code`.

### Webhooks

With the middleware, webhooks are one option: `onEvent` (and
`NATZAR_WEBHOOK_SECRET`), then register `https://you/natzar/webhook`. It
verifies the HMAC over the RAW body with a 5-minute window (a body some parser
already consumed fails loudly, naming the fix), and answers 500 when your
handler throws so the delivery is retried — delivery is at-least-once, so
dedupe on `event.id` (`dedupe: {seen: (id) => …}`).

There is no prescription event type: a prescription reaches you as an
`async_consult.message` whose `classification` is `async:prescription_issued`
/ `_sent` / `_failed` / `_revoked`, with the link in the body — resolve it with
`prescriptions.get` as above.

Without the middleware, verify the raw body yourself:

```ts
import {verifyWebhook} from '@natzar/client';

app.post('/hooks/natzar', express.raw({type: '*/*'}), async (req, res) => {
  const result = await verifyWebhook({
    secret: process.env.NATZAR_WEBHOOK_SECRET!,
    rawBody: req.body.toString('utf8'),        // the exact bytes — never re-serialized
    signature: req.header('X-Natzar-Signature'),
  });
  if (!result.valid) return res.sendStatus(400);
  switch (result.event.type) {
    case 'async_consult.assigned': …
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

// Any patient-surface operation (the credential rides in Authorization, never in args)
await care.call({kind: 'query', name: 'embedState', args: {}});

// The subscription engine, for something we do not model
import {watch} from '@natzar/client';
const stop = watch({read: () => myThing(), same: (a, b) => a.v === b.v}, render);

// Our zod schemas, if you want them (not exported by default — they are not
// your dependency unless you ask)
import {postAgentMessageSchema} from '@natzar/client/contract';
```

---

## Changelog

### 0.19.0 — the delivery address and the remembered pharmacy

- **Server client**: `prescriptions.setAddress(id, {address, lat?, lng?})`
  (`PUT /v1/prescriptions/{id}/address`) answers the e-prescribing picker's
  address step and returns the list; `choosePharmacy` accepts an optional
  `address` to confirm and choose in one call.
- **Patient client**: `care.prescriptions.setAddress(id, address, point?)`
  (the pick's point is rounded to 3 decimals before it is sent);
  `PharmacySearch.address` (`{step: 'collect' | 'confirm' | null, onFile,
  zipHint}`) and `PharmacySearch.preferred`; `PrescriptionLinkState.addressRequired`.
  New refusals `invalid_address` (`details.code` names the field) and
  `address_required`.
- **Contract**: `PrescriptionAddress`, `PrescriptionAddressStep`,
  `PrescriptionAddressError`, `PRESCRIPTION_ADDRESS_MAX`,
  `prescriptionAddressSchema` / `setPrescriptionAddressSchema`
  (`PrescriptionAddressInput`, `SetPrescriptionAddressRequest`,
  `SetPrescriptionAddressResponse`); `PrescriptionResource.addressRequired`;
  `ListPharmaciesResponse.address` and `.preferred`; error codes
  `invalid_address` (422), `address_required` (409) and
  `address_not_applicable` (409).
- **The prescriber-licensure notice**: `ListPharmaciesResponse.licensure`
  and `PharmacySearch.licensure` (`PrescriberLicensureNotice`, `{state,
  stateName}`, or null) — set when the delivery address confirmed for the
  prescription is in a state the prescribing physician holds no licence for,
  in a tenant that enforces licensure. Non-blocking: show it calmly above the
  list; the choice is unaffected. The patient client keeps a notice only
  when it names both the code and the name.
- **Miles in the United States**: `ListPharmaciesResponse.distanceUnit` and
  `PharmacySearch.distanceUnit` (`DistanceUnit`, `'mi' | 'km'`), the unit to
  print distances and radii in — `distanceKm`, `accuracyKm` and `radiusKm`
  stay kilometres on the wire. The patient client reads a missing or unknown
  unit as `'km'`. Contract helpers `distanceInUnit(distanceKm, unit)` (one
  decimal) and `KM_PER_MILE`, at `@natzar/client/contract`; the patient
  entry also re-exports the `DistanceUnit` and `PrescriberLicensureNotice`
  types.

### 0.18.0 — the embed integration redesign (greenfield; breaking)

- **`@natzar/client/server`**: `natzar(options)` — the embed middleware for
  Express/Connect/Node, Fetch runtimes (`.fetch(request, env?)`) and the
  Next.js App Router (`.GET`/`.POST`/`.OPTIONS`), with `revokeLogin`,
  `revokePatient`, `revokeClinician`, `deactivateClinician`, `startConsult`
  and `client`. A `browser` export condition makes a browser bundle that
  imports it fail at build.
- **`@natzar/client/react`** (React components for the four tags) and
  **`@natzar/client/elements`** (their DOM and JSX types).
- **`connectPatient` / `connectPhysician` are async and take a session
  source**: `{endpoint, auth?, native?}` (your middleware) or
  `{getSession, config}`. The SDK seals, renews and replaces `nz1` sessions
  itself; `refresh(session)`, `PatientSession`/`PhysicianSession`,
  `telehealth.session()` (consult tokens) and `ConnectOptions.apiUrl` are gone;
  `reconnect()`, `disconnect()`, `logout()` (patient) and `session` are new;
  `onExpired` receives `{reason, code}`. The patient transport sends the
  credential in `Authorization` (no public API key, no `token` argument).
- **`NatzarClient`**: `sessions.{create,delete,revoke}`, `embed.{config,setOrigins}`,
  `physicians.deactivate`; the v1 mints (`physicians.session`, the three
  `embedSession`s) are removed. A current-format key derives its endpoints
  (`resolveEndpoints({key})`; built-in API hosts per deployment, `NATZAR_API_URL` for a sandbox).
  `sessionToken` takes an `nz1` credential. `NatzarApiError.retryAfterSeconds`.
- Node ≥ 20 (global WebCrypto).
- `joinAnywayOf(error)` and `acceptShortSession` on joins (D12);
  `connectPhysician().logout()`; `physicians.deactivate({externalId})`;
  multi-patient (`connectPatient({patient})`, `ask.patient` → `askPatient`).

### 0.17.0

- **Single-use video rooms.** The platform may retire a call's room mid-call
  and hand out a new one: `ROOM_DELETED` now means "pull again", never "the
  call is over". New room helpers run a LiveKit `Room` you construct by the
  platform's rules — `connectPatientRoom` (`@natzar/client/patient`) and
  `connectPhysicianRoom` (`@natzar/client/physician`), with the pull adapters
  `patientPullFromJoin`, `patientPullFromAppointmentBeat`,
  `physicianPullFromRoom` and `physicianPullFromReady`, plus `roomOptions`,
  `DISCONNECT_REASON`, `parseRoomMetadata` and `roomCarriesNonce` from both
  entries. They refuse a `Room` that reconnects on its own, publish only once
  the room's metadata carries the grant's nonce, and never re-join on
  `DUPLICATE_IDENTITY` without a `resume()`.
- **`roomNonce` on grants.** The patient's `LiveKitGrant` (`join()`,
  `appointmentBeat()`) always carries it, and a grant without one is never
  handed over. Contract: `LiveKitGrant.roomNonce?`, `PatientLiveKitGrant` on
  `JoinTelehealthConsultResponse.livekit`; `dependency_unavailable` (503) on
  the video routes means "pull again".
- `livekit-client` (^2.22.0) is an **optional peer dependency**; the package
  never imports it.
- Corrected: a physician's 10-minute token bounds connecting, not the call —
  a connected physician is not disconnected by a later revocation.

### 0.16.0

- **Accept & pay in one action.** `TimelineEntry.link.payment` (and
  `CareSnapshot.consult.payment`, `BookingSlots.payment`) carry an invite's
  price before the click; `care.acceptAndPay(entry, {mount})` runs
  action → bound checkout → `paid` → action from one press;
  `respond` / `telehealth.join` / `telehealth.book` take `{paymentId, checkout}`
  (the positional `AbortSignal` still works); `care.payments.status(id)`;
  `checkoutOf(error)`.
- The patient transport declares `paymentId` (`String!`), `checkout` and
  `embedded` (`Boolean`) — raw `care.call` to `embedVisitCheckout` /
  `embedPaymentStatus` no longer fails GraphQL validation.
- Server client: `telehealth.join(id, {paymentId}, opts)` sends the body
  (`join(id, opts)` still works); `billing.visitCheckout` accepts
  `{asyncConsultId}` / `{telehealthConsultId}` and answers `consultId`,
  `alreadyPaid`, `settling`, `reused`; `billing.waitForPayment(id)`;
  `billing.payment(id)` adds `consultId`, `modality`, `mode`, `paidAt`.
- Contract: `ConsultPayment` on both consult resources; 402 `details` name
  `modality` / `mode`; `resolveLinkActions` carries a `due` consult's price.
  Documented platform refusals: a decline of a paid invite
  (`409 thread_not_active`, `details.reason: 'payment_settled'`) or of one
  whose checkout is in progress (`402 payment_invalid`); `slots` / `book` on
  a booking invite whose window lapsed (`409 thread_not_active`,
  `details.status: 'expired'`).

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
