// GENERATED FILE — do not edit.
//
// Copied verbatim from provider-portal's shared/partner-api by
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
   * Vendor catalogue reference when the item came from an e-prescribing
   * catalogue (e.g. Photon `treatmentId`), or a drug database id (Health
   * Canada DPD DIN). Opaque here; the adapter that minted it knows.
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
 * exists (United States), `fax` where it does not (Canada). Affects one thing
 * on this surface: adding a pharmacy by hand (`POST …/pharmacies`) exists in
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
  /** Great-circle distance from the search origin, km, one decimal. Absent without an origin or a pin. */
  distanceKm?: number;
}

/**
 * The search radii the list endpoint accepts (`radiusKm`), km. Offer them as
 * "search wider" steps: the default is the first, and a search that comes
 * back short is worth repeating at the next.
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
