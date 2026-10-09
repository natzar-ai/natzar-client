// GENERATED FILE — do not edit.
//
// Copied verbatim from natzar-core's shared/partner-api by
// scripts/sync-contract.mjs. Edit the source there; this copy exists only so
// the published package is self-contained.
/**
 * Prescriptions on the Partner API — the patient-side pharmacy choice.
 *
 * A physician writing on an async consult can issue a prescription without
 * leaving the thread. The patient is then handed a **pharmacy link** on the
 * transcript — a message classified `async:prescription_issued` whose body
 * carries `<host>/pharmacy?id=<prescriptionId>` — and has 24 hours to choose
 * the pharmacy the script goes to. Once chosen, the platform transmits it
 * (e-prescribing where the deployment's jurisdiction has a network, fax where
 * it does not) and the outcome lands on the same transcript as
 * `async:prescription_sent` / `async:prescription_failed`; a withdrawal is
 * `async:prescription_revoked`.
 *
 * The public `/pharmacy` page refuses partner-origin consults (their patients
 * are yours to render), so a partner rendering its own chat resolves the
 * link over these routes instead — exactly what the embed widget does:
 *
 * 1. Detect the link in the message body with {@link PHARMACY_LINK_REGEX}
 *    (strip it from the prose, render a button).
 * 2. `GET /v1/prescriptions/{id}` → {@link PrescriptionResource}; its
 *    {@link PrescriptionResource.action | action} says what the button does.
 * 3. While `action === 'choose'`: `GET /v1/prescriptions/{id}/pharmacies`
 *    for the list (sorted by distance from the origin you pass, else the
 *    patient's cached home), `POST /v1/prescriptions/{id}/pharmacy` to choose.
 *    In an e-prescribing deployment the list first answers an ADDRESS STEP
 *    ({@link PrescriptionAddressStep}): while `address.step` is set, collect
 *    or confirm the patient's home address and send it with
 *    `PUT /v1/prescriptions/{id}/address` (or with the choice itself); the
 *    answer is the list. Pre-select `preferred`, the pharmacy the patient's
 *    last prescription reached; show `licensure` (when set) as a calm notice
 *    above the list ({@link PrescriberLicensureNotice}), and every distance
 *    in the list's `distanceUnit` ({@link distanceInUnit}).
 * 4. Poll `GET /v1/prescriptions/{id}` until `action` is `sent` (or the
 *    transcript says `prescription_failed`, which re-opens the choice).
 *
 * No webhook event type is added for prescriptions: the four notices arrive
 * as ordinary `async_consult.message` events, distinguished by their
 * {@link MessageClassification | classification}.
 *
 * This module is self-contained on purpose: it is copied verbatim into the
 * published client package, so the platform's internal prescription module
 * (`shared/prescriptions.ts`) is mirrored here rather than imported, and a
 * test pins the two in lockstep.
 *
 * @packageDocumentation
 */

import type {IsoDateTime} from './resources';

/** Result of signing a prescription in a physician session. */
export interface IssuePrescriptionResponse {
  prescription: {id: string; issuedAt: IsoDateTime; link: string};
}

/**
 * The route and frequency vocabulary the structured sig builder understands
 * — mirrors `RX_ROUTES/RX_FREQUENCIES` in the platform's `shared/prescriptions.ts`
 * (a test pins the two in lockstep, see `shared/__tests__/prescriptions-contract.test.ts`).
 */
export type PrescriptionRoute = 'oral' | 'sublingual' | 'topical' | 'inhaled' | 'nasal' | 'ophthalmic' | 'otic' | 'rectal' | 'vaginal' | 'subcutaneous' | 'intramuscular' | 'other';
export type PrescriptionFrequency = 'once' | 'daily' | 'bid' | 'tid' | 'qid' | 'q4h' | 'q6h' | 'q8h' | 'q12h' | 'qhs' | 'qam' | 'weekly' | 'prn' | 'other';

/** One medication line of a prescription draft. Mirrors `RxItem`. */
export interface PrescriptionDraftItem {
  /** Drug name as it should appear on the script (brand or generic). */
  medication: string;
  /** "500 mg", "0.1%", "10 mg/mL" — free text, shown verbatim. */
  strength?: string;
  /** "tablet", "capsule", "cream" — free text, shown verbatim. */
  form?: string;
  /** Dose per administration, e.g. "1 tablet", "5 mL", "1 application". */
  dose: string;
  route: PrescriptionRoute;
  frequency: PrescriptionFrequency;
  /** Days; 0 or absent = open-ended / as needed. */
  durationDays?: number;
  /** Total quantity to dispense, with its unit ("30 tablets", "100 g"). */
  quantity: string;
  /** Refills allowed (0–11). */
  refills: number;
  /** "No substitution" / dispense as written. */
  noSubstitution?: boolean;
  /** Extra directions for the patient (max 500 chars). */
  instructions?: string;
  /**
   * The drug database entry the line was picked from: `ndc:<11 digits>` (an
   * NDC package, US e-prescribing) or `dpd:<DIN>` (Health Canada's Drug
   * Product Database, fax). Opaque here; the composer that minted it knows.
   */
  catalogRef?: string;
}

/**
 * A prescription as written, before it is signed and issued — the shape
 * `POST /v1/async-consults/{id}/prescriptions` accepts (`draft`) and the
 * shape `AsyncConsultResource.recommendedPrescription` reads (an AI-drafted
 * one, awaiting the physician's review and signature). Mirrors `RxDraft`.
 */
export interface PrescriptionDraft {
  items: PrescriptionDraftItem[];
  /** Note to the pharmacist (max 500 chars). */
  pharmacistNote?: string;
  /** Diagnosis / indication as free text (optional, printed on the script). */
  indication?: string;
}

/**
 * Lifecycle of a prescription. Mirrors `PRESCRIPTION_STATUSES` in the
 * platform's `shared/prescriptions.ts`. Forward-only except `revoked`, which
 * any non-terminal status may reach; a prescription is never edited — a
 * mistake is a revoke plus a new prescription.
 *
 * - `awaiting_pharmacy` — issued; the patient holds a link to choose a pharmacy.
 * - `transmitting` — pharmacy chosen; the transmission is queued or in flight.
 * - `sent` — accepted by the transport (fax delivered / order placed).
 * - `failed` — the transport gave up after its retries. The patient may
 *   choose another pharmacy, which re-enters `transmitting`.
 * - `revoked` — withdrawn by the physician (or an administrator).
 * - `expired` — the pharmacy link ran out unused.
 */
export type PrescriptionStatus =
  | 'awaiting_pharmacy'
  | 'transmitting'
  | 'sent'
  | 'failed'
  | 'revoked'
  | 'expired';

/**
 * What the pharmacy button can DO, derived server-side from the effective
 * state so every surface (our widget, our app, your UI) agrees:
 *
 * - `choose` — actionable: the patient may pick (or re-pick, after a
 *   failure) a pharmacy. The only actionable value.
 * - `sent` — chosen and on its way, or delivered. Render a disabled button
 *   reading "Sent to {pharmacyName}" (or plainly "Sent" when the name is not
 *   known).
 * - `expired` — the 24-hour window lapsed, or the link does not resolve
 *   (never a 404 on the state read: a dead link is an ordinary answer).
 * - `revoked` — withdrawn by the physician.
 *
 * Keep the button visible for the non-actionable values, with a label that
 * says what happened — the convention the embed widget follows.
 */
export type PharmacyLinkAction = 'choose' | 'sent' | 'expired' | 'revoked';

/**
 * How the prescription reaches the pharmacy. Decided by the deployment's
 * jurisdiction, never per tenant: `erx` where an e-prescribing network
 * exists (United States), `fax` where it does not (Canada). Affects two
 * things on this surface: the delivery-address step
 * ({@link PrescriptionAddressStep}, `PUT …/address`) exists in `erx`
 * deployments only, and adding a pharmacy by hand (`POST …/pharmacies`) in
 * `fax` deployments only.
 */
export type PrescriptionTransport = 'erx' | 'fax';

/**
 * A prescription as this API reads it — the link state, never the clinical
 * content. What was prescribed is between the physician and the pharmacy;
 * this resource is exactly what a patient-facing screen needs to render the
 * "choose your pharmacy" button and its outcome.
 */
export interface PrescriptionResource {
  /** Our id — the `id` in the `/pharmacy?id=…` link. */
  id: string;
  /**
   * Your id of the patient it was written for — always the patient you
   * provisioned: a prescription on a patient you did not provision is not
   * visible to this key (404), so this is never null.
   */
  externalPatientId: string;
  /** The async consult it was written on. */
  consultId: string | null;
  /**
   * The EFFECTIVE status: `expired` as soon as the 24-hour window closes,
   * even before the platform's sweep stamps it.
   */
  status: PrescriptionStatus;
  /** True once the pharmacy link is no longer usable. */
  expired: boolean;
  /** When the link dies; null when the prescription carries no window. */
  expiresAt: IsoDateTime | null;
  transport: PrescriptionTransport;
  /** The chosen pharmacy's name once one was chosen (`transmitting`, `sent`, `failed`). */
  pharmacyName: string | null;
  /** What the button does. See {@link PharmacyLinkAction}. */
  action: PharmacyLinkAction;
  /**
   * The picker will open on the delivery-address step: an e-prescribed
   * prescription (`transport: 'erx'`) that can still be chosen and has no
   * delivery address confirmed yet. Choosing it without one is
   * `409 address_required`; confirm it with `PUT …/address`, or send
   * `address` with the choice. Always false in a fax deployment and once
   * `action` is not `choose`. Added after the fields above; `/v1` only ever
   * grows.
   */
  addressRequired: boolean;
  /** When the prescription was issued. */
  createdAt: IsoDateTime;
}

/**
 * Where a pharmacy search is centred, and how that point was arrived at —
 * the origin the list is ranked by. On the list response it is the origin
 * the server actually used: yours when you passed one, else the patient's
 * cached home. Absent when neither exists, in which case `homeAddress` is
 * offered for you to geocode (and store back with `POST …/home-location`).
 */
export interface PharmacySearchOrigin {
  lat: number;
  lng: number;
  /**
   * - `address` — the patient's home address on file (or one they typed)
   * - `device` — browser / phone geolocation
   * - `ip` — coarse, from the requester's IP; show distances as approximate
   * - `manual` — a postal code / city the patient entered
   */
  source: 'address' | 'device' | 'ip' | 'manual';
  /** Human label of the origin ("Home", "Your location", "Near Toronto"). */
  label?: string;
  /** Uncertainty radius in km when known (`ip`). */
  accuracyKm?: number;
}

/** One pharmacy of the picker. */
export interface PharmacyResource {
  /** The id to send back in `POST …/pharmacy`. Opaque. */
  directoryId: string;
  name: string;
  address: string;
  city?: string;
  region?: string;
  postalCode?: string;
  phone?: string;
  /**
   * Whether the transport can actually deliver there (a verified fax line on
   * file / a network id). Offer unreachable pharmacies greyed out, or not at
   * all: choosing one is refused with `409 pharmacy_unreachable`.
   */
  reachable: boolean;
  lat?: number;
  lng?: number;
  /**
   * Great-circle distance from the search origin, km, one decimal. Absent
   * without an origin or a pin. Always km on the wire: show it in the list's
   * `distanceUnit` ({@link distanceInUnit}).
   */
  distanceKm?: number;
}

/**
 * A US home / delivery address, structured as the e-prescribing network
 * takes it — never one line. It is both the patient's home address on file
 * ({@link PrescriptionAddressStep.onFile}) and, once confirmed for a
 * prescription, the address that prescription's order carries. Mirrors
 * `RxAddress` in the platform's `shared/prescriptions.ts`.
 */
export interface PrescriptionAddress {
  /** Street number and name ("350 Fifth Avenue"). */
  street: string;
  /** Apartment, suite or unit ("Suite 3300"), when there is one. */
  street2?: string;
  city: string;
  /** Two-letter code of a US state, DC or an inhabited territory ("NY"). Never a military "state" (AA/AE/AP). */
  state: string;
  /** Five-digit ZIP code, or ZIP+4 written `12345-6789`. */
  zipCode: string;
  /** Always `US`: the only jurisdiction this platform e-prescribes in. */
  country: 'US';
}

/**
 * Why an address was refused — `details.code` of `422 invalid_address`,
 * naming the field to fix (the codes the platform's own pickers render):
 *
 * - `street` / `city` — missing (empty after trimming);
 * - `state` — not a US state, DC or inhabited territory code, or a `country`
 *   other than the US;
 * - `zipCode` — not five digits (or ZIP+4);
 * - `tooLong` — `street`, `street2` or `city` over
 *   {@link PRESCRIPTION_ADDRESS_MAX} characters.
 *
 * Mirrors `RxAddressError`.
 */
export type PrescriptionAddressError = 'street' | 'city' | 'state' | 'zipCode' | 'tooLong';

/** Longest `street` / `street2` / `city` accepted, in characters. Mirrors `RX_ADDRESS_MAX`. */
export const PRESCRIPTION_ADDRESS_MAX = 100;

/**
 * The step the picker shows BEFORE its list, in an e-prescribing deployment:
 * the network needs a structured delivery address, and the platform's signup
 * asks for a ZIP code only, so the first prescription a patient chooses a
 * pharmacy for asks for the full home address, and every later one only has
 * it confirmed. Server-driven — branch on `step`, never on the deployment:
 *
 * - `collect` — no home address on file: ask for it (street, apt/unit, city,
 *   state, ZIP), prefilled with `zipHint`;
 * - `confirm` — `onFile` is the address on file: "Yes, use this address",
 *   or "Change address" (the same form, prefilled);
 * - `null` — nothing to ask: a fax deployment, a prescription that can no
 *   longer be chosen, or an address already confirmed for THIS prescription
 *   (a re-choice after a failed transmission, a lost race).
 *
 * While `step` is set the list is EMPTY and no search ran. Answer it with
 * `PUT /v1/prescriptions/{id}/address` (confirming sends `onFile` back
 * unchanged), whose response is the list itself — or send the address with
 * the choice (`POST …/pharmacy` `address`). Mirrors `PharmacyAddressStep`.
 */
export interface PrescriptionAddressStep {
  step: 'collect' | 'confirm' | null;
  /**
   * The patient's home address on file — the one the last confirmation saved
   * (on any surface). Null when none is, and on a prescription that is not
   * e-prescribed or can no longer be chosen.
   */
  onFile: PrescriptionAddress | null;
  /** The patient's ZIP code on file (the one they signed up with), to prefill the form — while `step` is `collect`, else null. */
  zipHint: string | null;
}

/**
 * The prescriber-licensure notice of the picker's list
 * (`ListPharmaciesResponse.licensure`): the delivery address confirmed for
 * this prescription is in another state than the one it was issued for —
 * the patient's state at signing, or the state of the licence it was signed
 * under (so an address in the patient's own state can carry it too, when
 * the prescription was signed under another state's licence) —
 * your tenant enforces state licensure (`licenseEnforcement` on
 * `GET /v1/physicians/{id}/licenses`), and the prescribing physician holds
 * no usable licence in that state.
 *
 * NON-BLOCKING: the patient may still choose any pharmacy and send. Show it
 * as a calm, informational notice above the list — not in an error slot,
 * and never as a reason to disable the choice — for example:
 *
 * > Your prescribing doctor isn't registered in New Jersey. Most states and
 * > pharmacies accept prescriptions from out-of-state doctors, but some
 * > pharmacies in some states may refuse it.
 *
 * It names the state only, never a licence. Mirrors
 * `PrescriberLicensureNotice` in the platform's `shared/prescriptions.ts`.
 */
export interface PrescriberLicensureNotice {
  /** The delivery address's two-letter state code ("NJ"). */
  state: string;
  /** Its full name, in English ("New Jersey"). Localise from `state` when you render another language. */
  stateName: string;
}

/**
 * The unit to SHOW pharmacy distances and search radii in
 * (`ListPharmaciesResponse.distanceUnit`), chosen by the deployment: `mi`
 * in the United States, `km` elsewhere. The numbers on the wire stay
 * kilometres — `distanceKm`, `accuracyKm`, `radiusKm` — whatever the unit;
 * convert for display with {@link distanceInUnit}. Mirrors `DistanceUnit`.
 */
export type DistanceUnit = 'mi' | 'km';

/** Kilometres in one international mile. Mirrors `KM_PER_MILE`. */
export const KM_PER_MILE = 1.609344;

/**
 * A kilometre distance (`distanceKm`) in `unit`, rounded to one decimal —
 * the number to print before the unit label. A pharmacy a few steps away
 * rounds to 0: print it as "< 0.1 mi" rather than "0 mi". Mirrors
 * `distanceInUnit`.
 *
 * @example
 * ```ts
 * distanceInUnit(13.7, 'mi'); // 8.5  → "8.5 mi"
 * distanceInUnit(13.7, 'km'); // 13.7 → "13.7 km"
 * distanceInUnit(0.05, 'mi'); // 0    → "< 0.1 mi"
 * ```
 */
export function distanceInUnit(distanceKm: number, unit: DistanceUnit): number {
  const value = unit === 'mi' ? distanceKm / KM_PER_MILE : distanceKm;
  return Math.round(value * 10) / 10;
}

/**
 * The search radii the list endpoint accepts (`radiusKm`), km. Offer them as
 * "search wider" steps: the default is the first, and a search that comes
 * back short is worth repeating at the next. The value sent is always the
 * km one; label it in the list's `distanceUnit`, rounded to the NEAREST
 * whole unit (the platform's pickers read 25 / 50 / 100 km as 16 / 31 / 62
 * mi). Nearest, not down: in the United States the search itself covers
 * that many whole miles, so a rounded-down label ("15 mi") would sit above
 * a pharmacy listed at 15.8 mi.
 */
export const PHARMACY_SEARCH_RADII_KM = [25, 50, 100] as const;

/** Path segment of the pharmacy link — `<host>/pharmacy?id=<prescriptionId>`. */
export const PHARMACY_LINK_PATH = 'pharmacy';

/**
 * Finds the pharmacy link in a message body. Group 1 is the prescription id
 * to resolve with `GET /v1/prescriptions/{id}`; the whole match is the URL
 * to strip from the prose before rendering (the same shape as the consent,
 * video and booking links). One link per message.
 *
 * @example
 * ```ts
 * const m = PHARMACY_LINK_REGEX.exec(message.body);
 * if (m) render({text: message.body.replace(m[0], '').trim(), prescriptionId: m[1]});
 * ```
 */
export const PHARMACY_LINK_REGEX = /\S*\/pharmacy\?id=([A-Za-z0-9_-]+)\S*/;
