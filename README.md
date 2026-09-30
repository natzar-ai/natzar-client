# @natzar/client

Official TypeScript client for the **Natzar Partner API** — AI health-assistant
chat, async physician consults, live video consults, prescriptions with an
in-app pharmacy picker, and webhooks — plus the two browser surfaces built on
it: a patient's care conversation and a physician's workspace inside your own
portal.

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
by the consult id on the entry. The SDK mints and caches the consult-scoped
session for you.

```ts
const {mode} = await care.telehealth.session(consultId);   // 'queue' | 'scheduled'

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

// 2. The patient picks a `reachable` row. Fax zones: a row without a fax on
//    file cannot be chosen — offer addPharmacy (below) instead.
const chosen = await care.prescriptions.choose(id, list.pharmacies[0].directoryId);
// → {status: 'transmitting', pharmacyName, transport: 'erx' | 'fax'}

// 3. Poll the state until it settles; the thread gets the confirmation too.
const state = await care.prescriptions.state(id);
state.action;   // 'choose' | 'sent' | 'expired' | 'revoked' — never throws for a miss
state.status;   // 'awaiting_pharmacy' | 'transmitting' | 'sent' | 'failed' | 'revoked' | 'expired'
```

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
the prescription is now), `pharmacy_not_found` or `pharmacy_unreachable`;
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

### Prescriptions and links, server-side

The same pharmacy picker is reachable from your server, for a surface you
build over the REST API rather than the browser module:

```ts
const {prescription} = await natzar.prescriptions.get(id);           // status, window, action
const {pharmacies} = await natzar.prescriptions.pharmacies(id, {lat, lng, source: 'device', radiusKm: 50});
await natzar.prescriptions.choosePharmacy(id, {directoryId});         // 409 prescription_not_choosable past choosing
await natzar.prescriptions.setHomeLocation(id, {lat, lng});
await natzar.prescriptions.addPharmacy(id, {name, address, fax});     // fax zones; 201 pending_verification
```

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
const desk = connectPhysician(session);
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

Verify the signature against the **raw** body, before parsing. There is no
prescription event type: a prescription reaches you as an
`async_consult.message` whose `classification` is `async:prescription_issued`
/ `_sent` / `_failed` / `_revoked`, with the link in the body — resolve it with
`prescriptions.get` as above.

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

## Changelog

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
