---
title: Video calls
group: Guides
---

# Video calls — connecting, and staying connected

This guide is for partners who render a video call themselves, over the REST
routes or the `@natzar/client` SDK, on the patient side, the physician side or
both. If you embed `<natzar-telehealth>` for patients, the widget already
follows every rule below and you have nothing to do.

A call runs in a LiveKit room. The platform hands each side a **grant**: a
token, the server URL, the room name and, for the patient, the room's nonce.
Two facts decide how a client must behave:

1. **A room is single-use.** The platform can retire a call's room at any
   time, for example when a clinician's access is revoked mid-call. Everyone in
   the room is disconnected with LiveKit's `ROOM_DELETED` reason. On a LiveKit
   server that does not create rooms on join, every token for that room is
   refused from then on. On one that does (LiveKit Cloud is not yet verified
   either way), an old token can recreate the room **empty**, which is why you
   must never reconnect with an old token and must check the room's nonce
   (§2). The **consult carries on** in a new room, and the next pull of the
   same route hands out a grant for it.
2. **Only the consult's status says the call is over.** A disconnect never
   does. A client that treats `ROOM_DELETED` as "call ended" shows the patient
   the rating screen, or leaves the physician on an error, while the consult is
   still `in_progress`.

## 1. The grant

| Route | Who | Grant |
|---|---|---|
| `POST /v1/telehealth-consults/{id}/join` (server SDK `telehealth.join`; browser SDK `care.telehealth.join`) | patient, on-demand | `livekit` while `status` is `in_progress` |
| browser SDK `care.telehealth.appointmentBeat` | patient, booked | `livekit` while `state.phase` is `in_progress` |
| `POST /v1/telehealth-consults/{id}/room` (SDK `desk.telehealth.room`) | physician, on-demand | `livekit` while `status` is `in_progress` |
| `POST /v1/telehealth-consults/{id}/ready` (SDK `desk.telehealth.ready`) | physician, booked | `livekit` once the call is live |

Each grant is `{token, url, roomName, roomNonce?}`:

- **`roomNonce`** is the value the room carries in its metadata,
  `{"v":1,"n":"<roomNonce>"}`. It is **always** present on a patient's grant
  ({@link PatientLiveKitGrant}). A physician's grant may omit it.
- **`token` connects; it is not a session.** A patient's token is valid for 3
  hours. A physician's is valid for 10 minutes, and that figure is the **pull
  cadence**, not a bound on the call: pull a fresh grant for every connection
  and every reconnection, and never store one to reuse later.
- **A connection outlives its token.** Once connected, a client stays
  connected until it disconnects or the room is retired. For a physician this
  means that revoking them afterwards (their account, your key, their session)
  does **not** disconnect a call already in progress. It only refuses their
  next pull. Plan your own offboarding with that in mind (see §6).

A pull that answers `503 dependency_unavailable` means the platform could not
confirm the consult's current room right now. Pull again with backoff. It is
never "the call is over".

## 2. The rules for every client

These apply to the patient and to the physician.

- **Turn LiveKit's automatic reconnection off.** Construct the `Room` with a
  `reconnectPolicy` whose `nextRetryDelayInMs` returns `null`
  (`roomOptions()` in the SDK does this). LiveKit's own reconnection replays
  the old token into the old room name. The next pull is your reconnection.
- **Connect with the microphone and camera off.** With
  `@livekit/components-react`, that means `<LiveKitRoom audio={false}
  video={false}>`, or a `Room` you connect yourself and provide with
  `<RoomContext.Provider value={room}>`. Never `<LiveKitRoom audio video>`,
  which publishes before you have checked the room.
- **Check the room before you publish.** After connecting, parse
  `room.metadata`:
  - patient: it must be exactly `{"v":1,"n":<the grant's roomNonce>}`;
  - physician: it must match the grant's `roomNonce` when the grant carries
    one, and must at least be `{"v":1,"n":"…"}` when it does not.

  Anything else (no metadata at all included) means this is not the consult's
  current room. It was retired, or an old token recreated it empty on a server
  that creates rooms on join. Disconnect, pull again, and never publish into
  it.
- **Mount device controls only once the room has checked out.** Anything
  that can turn on a microphone, camera or screen share (`VideoConference`,
  `ControlBar`, `TrackToggle`, your own mute or camera button, any call to
  `setMicrophoneEnabled` / `setCameraEnabled` / `setScreenShareEnabled`) is
  rendered only while you are connected to a room that passed the check. While
  connecting or reconnecting, render a placeholder instead. livekit-client
  queues a device switched on while the room is not connected and publishes it
  the moment the next connection's signal is up, **before** `connect()`
  resolves and so before you can check the room: a tap on "unmute" during
  "Reconnecting…" would otherwise reach a room an old token recreated.
- **Decide what to do from the disconnect reason** (next section). Never end
  the consult because the connection went away.
- **Never call `connect()` on a `Room` whose previous `connect()` has not
  settled.** livekit-client (2.22.0 included) answers it with the earlier
  attempt's promise instead of connecting. A room retired while an attempt
  is still waiting for its peer connection (a `ROOM_DELETED` during the join)
  disconnects the `Room` at once, yet leaves that attempt pending until its
  own 15 s timeout. Reconnect with a new `Room`, or wait for the attempt to
  end. The SDK helpers end such an attempt when the disconnect arrives and
  connect again only after it has ended.

## 3. Disconnect reasons

| LiveKit `DisconnectReason` | Patient | Physician |
|---|---|---|
| `CLIENT_INITIATED` (your own hang-up) | the call is over for this screen: rating or back to the chat | your hang-up flow (`/end` if the physician chose to end) |
| `ROOM_DELETED` | pull `/join` (or the appointment beat) again, then connect to the new grant | pull `/room` (or `/ready`) again, then connect to the new grant |
| `DUPLICATE_IDENTITY` | the patient opened the call on another device or tab. Show "open elsewhere" with a **manual** resume button | the physician opened the call in another window or in the provider embed. Show "in use in another window" with a **manual** "Use here" button |
| `PARTICIPANT_REMOVED` | pull again, as for `ROOM_DELETED` | show "removed" with a manual rejoin button |
| anything else (network loss, signal close, server shutdown) | pull again | pull again |

**Never re-join automatically on `DUPLICATE_IDENTITY`.** Both screens share one
identity. If each re-joined when displaced, they would displace each other
forever.

After a pull, render from what it answers:

| Pull answer | Patient | Physician |
|---|---|---|
| `in_progress` with a grant | connect to the new room | connect to the new room |
| `in_progress` without a grant | pull again shortly | pull again shortly |
| `waiting` (the consult went back to the queue while you were disconnected), or an early appointment phase | the waiting room. **Not** the rating screen, and no reconnect | the appointment's waiting room and its ~10 s `/ready` beat |
| `completed` / `cancelled` / `no_show` / `expired` / `missed` / `closed` | the rating screen when `rateable`, else the outcome | the ended state. Do **not** call `/end`: the consult is already over |

Bound your re-pulls (the SDK stops after five failures in a row) and offer a
manual retry when they run out.

## 4. With the SDK

`@natzar/client` 0.17.0 runs these rules for a LiveKit `Room` you construct.
`livekit-client` stays an optional peer dependency: the SDK never imports it.

```ts
import {Room} from 'livekit-client';
import {RoomContext, VideoConference} from '@livekit/components-react';
import {connectPatientRoom, patientPullFromJoin, roomOptions} from '@natzar/client/patient';

const room = new Room(roomOptions());               // automatic reconnection off
const session = connectPatientRoom({
  room,
  grant: state.livekit!,                            // from care.telehealth.join()
  pull: (signal) => care.telehealth.join(consultId, signal).then(patientPullFromJoin),
  onState: setCall,                                 // render from call.phase
});
// render:
// <RoomContext.Provider value={room}>
//   {call.phase === 'live' ? <VideoConference /> : <Reconnecting />}
// </RoomContext.Provider>
// on unmount or hang-up: await session.leave()
```

For a booked appointment, pull with
`care.telehealth.appointmentBeat(consultId, true, signal).then(patientPullFromAppointmentBeat)`.
The physician side is the same with `connectPhysicianRoom` from
`@natzar/client/physician`, pulling `desk.telehealth.room(consultId, signal)`
through `physicianPullFromRoom`, or `desk.telehealth.ready(consultId, true,
signal)` through `physicianPullFromReady`.

The helper throws if the `Room` would reconnect on its own. It publishes the
microphone and camera only once the room checks out. It cannot stop **your**
controls from switching a device on, so mount the call UI and every device
control (`VideoConference`, `ControlBar`, `TrackToggle`, your own mute or
camera button) only while `call.phase === 'live'`, as §2 requires. It reports
one of these phases:

| `phase` | Show |
|---|---|
| `connecting` | "Connecting…", a placeholder with no device control. Nothing is published yet |
| `live` | the call, with its device controls. The only phase that mounts them |
| `repulling` | "Reconnecting…", a placeholder with no device control. Never the end of the call |
| `waiting` | your waiting room. The session is over; your heartbeat hands you the next grant |
| `ended` | the outcome (`status`) or the rating screen |
| `displaced` | "open elsewhere", with a button that calls `session.resume()` |
| `removed` | (physician only) "removed", with a rejoin button that calls `resume()` |
| `left` | a LiveKit control in your UI disconnected the room: treat it as the hang-up |
| `error` | `refused` (a pull was refused outright, for example an expired session: refresh it, then `resume()`) or `exhausted` (offer a retry that calls `resume()`) |

## 5. Migrating from SDK 0.16 and earlier

What changed, and what you must do:

1. **Patient grants carry `roomNonce`.** Pass it through untouched if your
   server relays the join answer to the browser (for example through your own
   API): without it the SDK and the rules above refuse to publish.
2. **`ROOM_DELETED` means pull again**, on both sides. Remove any code that
   ends the call, shows the rating screen or calls `/end` on a disconnect.
3. **`DUPLICATE_IDENTITY` means a manual resume state**, never an automatic
   reconnect.
4. **Automatic reconnection is off**, and the room is checked before
   anything is published. Replace `<LiveKitRoom connect audio video>` with a
   `Room` built with `roomOptions()` and run by `connectPatientRoom` /
   `connectPhysicianRoom` (or your own code that follows §2 and §3), and
   render the call UI and its device controls only while the phase is `live`.
5. **Never reuse a stored grant** to reconnect. Pull a fresh one every time.
6. **"Physician tokens last 10 minutes" was never a bound on the call.** Ten
   minutes is how long a physician's token can be used to connect. A connected
   physician stays connected until they disconnect, and a later revocation
   only refuses their next pull.

## 6. What remains your responsibility

- **A client that skips these rules is not protected by them.** On a LiveKit
  server that creates rooms on join, an old token can recreate a retired room,
  empty. A client that auto-reconnects with an old token, or publishes without
  checking the nonce, can publish into such a room until the platform deletes
  it. Clients that follow §2 never do.
- **Offboarding a physician does not cut a call in progress.** To stop a
  physician's media at once, end the consult with `POST …/end` (your server
  can call it with your key and `X-Natzar-Physician-Id`, [Physicians](physicians.md)
  §1): ending deletes the room. Otherwise revocation takes effect at their
  next pull.
