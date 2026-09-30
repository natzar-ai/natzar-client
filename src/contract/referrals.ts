// GENERATED FILE — do not edit.
//
// Copied verbatim from provider-portal's shared/partner-api by
// scripts/sync-contract.mjs. Edit the source there; this copy exists only so
// the published package is self-contained.
/**
 * Referrals on the Partner API — the signed requisition the patient carries.
 *
 * A physician writing on an async consult can refer the patient without
 * leaving the thread — to a specialist, for laboratory tests, or for an
 * imaging exam. The platform renders a signed **PDF requisition** and hands
 * the patient a **referral link** on the transcript — a message classified
 * `async:referral_issued` whose body carries `<host>/referral?id=<referralId>`
 * and, as its own last paragraph, a validity sentence ("This link is active
 * for the next 30 days."). Nothing is transmitted anywhere: the patient
 * shows the document, or hands it over, at the laboratory, the imaging centre
 * or the specialist's office. A withdrawal lands as `async:referral_revoked`.
 *
 * The public `/referral` page is birthdate-gated, refuses partner-origin
 * consults (their patients are yours to render) and dies after 30 days. A
 * partner rendering its own chat therefore resolves the link over this API
 * instead — exactly what the embed widget does — and inside such a surface
 * the document has **no window**: it stays openable for as long as the
 * referral exists. So:
 *
 * 1. Detect the link in the message body with {@link REFERRAL_LINK_REGEX}
 *    (strip it from the prose, render a file card with an "Open referral"
 *    button) — and strip the validity sentence too
 *    ({@link REFERRAL_LINK_VALIDITY_SENTENCES}): it describes the anonymous
 *    web link, not your surface.
 * 2. `GET /v1/referrals/{id}` → {@link ReferralResource}; its
 *    {@link ReferralResource.action | action} says what the button does,
 *    and {@link ReferralResource.document | document} carries a short-lived
 *    URL to the PDF while the referral is issued.
 * 3. On tap, read the resource again. Open `document.url` for a single
 *    referral, or show `files` and open each file's URL for a bundle. URLs
 *    are minted per read and expire in minutes; never cache them.
 *
 * No webhook event type is added for referrals: the two notices arrive as
 * ordinary `async_consult.message` events, distinguished by their
 * {@link MessageClassification | classification}. Webhook payloads never
 * carry `document`.
 *
 * This module is self-contained on purpose: it is copied verbatim into the
 * published client package, so the platform's internal referral module
 * (`shared/referrals.ts`) is mirrored here rather than imported, and a test
 * pins the two in lockstep.
 *
 * @packageDocumentation
 */

import type {IsoDateTime} from './resources';

/**
 * WHAT was requested. Mirrors `REFERRAL_KINDS` in the platform's
 * `shared/referrals.ts` — the three pages of a paper requisition pad.
 *
 * - `specialist` — a consultation with a named specialty.
 * - `laboratory` — a list of laboratory tests.
 * - `imaging` — an imaging exam (X-ray, ultrasound, CT, MRI, …).
 */
export type ReferralKind = 'specialist' | 'laboratory' | 'imaging';

/** The urgency printed on a specialist or imaging requisition. */
export type ReferralPriority = 'routine' | 'semi_urgent' | 'urgent';

/** Language used for the requisition itself (not the patient's chat locale). */
export type ReferralLanguage = 'en' | 'es' | 'de' | 'fr' | 'it';

/** The laboratory tests the structured requisition can name. */
export type ReferralLabTest =
  | 'cbc'
  | 'fasting_glucose'
  | 'hba1c'
  | 'creatinine_egfr'
  | 'electrolytes'
  | 'lipid_panel'
  | 'alt_ast'
  | 'tsh'
  | 'ferritin'
  | 'vitamin_b12'
  | 'urinalysis'
  | 'urine_acr'
  | 'inr'
  | 'psa'
  | 'hcg_serum'
  | 'urine_culture'
  | 'throat_swab';

/** A physician's structured, signable referral requisition. */
export type ReferralDraft =
  | {
      kind: 'specialist';
      specialty: string;
      priority: ReferralPriority;
      reason: string;
      clinicalInfo?: string;
      healthCardNumber?: string;
      healthCardExpiry?: string;
    }
  | {
      kind: 'laboratory';
      tests: ReferralLabTest[];
      otherTests?: string;
      clinicalInfo?: string;
      priority: 'routine' | 'urgent';
      fasting?: boolean;
      healthCardNumber?: string;
      healthCardExpiry?: string;
    }
  | {
      kind: 'imaging';
      modality: 'xray' | 'ultrasound' | 'ct' | 'mri' | 'mammography' | 'other';
      otherModality?: string;
      examination: string;
      clinicalIndication: string;
      priority: ReferralPriority;
      contrast?: boolean;
      healthCardNumber?: string;
      healthCardExpiry?: string;
    };

/**
 * Lifecycle of a referral. Mirrors `REFERRAL_STATUSES` in the platform's
 * `shared/referrals.ts`. Forward-only: a referral is never edited — a
 * mistake is a revoke plus a new referral.
 *
 * - `issued` — signed; the document is available.
 * - `revoked` — withdrawn by the physician (or an administrator).
 *
 * There is deliberately no `expired` status: only the anonymous web link has
 * a window. On this API a referral of yours never expires.
 */
export type ReferralStatus = 'issued' | 'revoked';

/**
 * What the referral button can DO, derived server-side so every surface
 * (our widget, our app, your UI) agrees:
 *
 * - `view` — actionable: open the document. The only actionable value.
 * - `revoked` — withdrawn by the physician. Render a disabled button
 *   reading "Referral withdrawn".
 * - `expired` — the link does not resolve to a referral this surface may
 *   show. On this API a referral you can read is never `expired` (the 30-day
 *   window belongs to the anonymous web page alone); the value exists so a
 *   client falls back to it for a link it could not resolve, rather than
 *   inventing a state.
 *
 * Keep the button visible for the non-actionable values, with a label that
 * says what happened — the convention the embed widget follows.
 */
export type ReferralLinkAction = 'view' | 'revoked' | 'expired';

/**
 * A referral as this API reads it — the link state and the document, never
 * the clinical content. What was requested is printed on the PDF the patient
 * carries; this resource is exactly what a patient-facing screen needs to
 * render the file card and open it.
 */
export interface ReferralResource {
  /** Our id — the `id` in the `/referral?id=…` link. */
  id: string;
  /**
   * Your id of the patient it was written for — always the patient you
   * provisioned: a referral on a patient you did not provision is not
   * visible to this key (404), so this is never null.
   */
  externalPatientId: string;
  /** The async consult it was written on. */
  consultId: string | null;
  kind: ReferralKind;
  status: ReferralStatus;
  /** What the button does. See {@link ReferralLinkAction}. */
  action: ReferralLinkAction;
  /**
   * The document's title in its own language — "Laboratory requisition",
   * "Imaging requisition — MRI", "Specialist referral — Cardiology". The
   * file card's headline.
   */
  title: string;
  /** The signing physician's display name ("Dr. Sarah Chen"). */
  physicianName: string;
  /** When the referral was signed. */
  issuedAt: IsoDateTime;
  /** When it was withdrawn; null while `issued`. */
  revokedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  /**
   * The PDF, while `status` is `issued`; null once revoked. `url` is a
   * short-lived presigned GET minted on THIS read — open it at once, never
   * store it, and read the resource again for a fresh one. Omitted from
   * webhook payloads (they are stored durably).
   */
  document: {
    /** Served inline — open it in a tab or a viewer. */
    url: string;
    /** The same object served as an attachment, for a "download" control. Same lifetime as `url`. */
    downloadUrl?: string;
    /** When `url` stops working. Minutes, not days: re-read for a fresh one. */
    expiresAt: IsoDateTime;
    /** An ASCII-safe file name for a download ("Laboratory-requisition-<id>.pdf"). */
    fileName: string;
    contentType: 'application/pdf';
  } | null;
  /**
   * Present only on a BUNDLE (several documents signed in one operation):
   * every PDF under this link, the lead's own first. A single-document issue
   * carries no `files` — its PDF is `document`. Absent once revoked.
   */
  files?: Array<{id: string; kind: ReferralKind; title: string; document: NonNullable<ReferralResource['document']>}>;
}

/** The durable result of a physician issuing one referral on an async consult. */
export interface IssueReferralResponse {
  referral: Pick<ReferralResource, 'id' | 'kind' | 'title' | 'issuedAt'>;
  referrals?: Array<Pick<ReferralResource, 'id' | 'kind' | 'title' | 'issuedAt'>>;
}

/** Path segment of the referral link — `<host>/referral?id=<referralId>`. */
export const REFERRAL_LINK_PATH = 'referral';

/**
 * Finds the referral link in a message body. Group 1 is the referral id to
 * resolve with `GET /v1/referrals/{id}`; the whole match is the URL to strip
 * from the prose before rendering (the same shape as the consent, video,
 * booking and pharmacy links). One link per message.
 *
 * @example
 * ```ts
 * const m = REFERRAL_LINK_REGEX.exec(message.body);
 * if (m) render({text: message.body.replace(m[0], '').trim(), referralId: m[1]});
 * ```
 */
export const REFERRAL_LINK_REGEX = /\S*\/referral\?id=([A-Za-z0-9_-]+)\S*/;

/**
 * The validity sentence a `referral_issued` notice ends with, in each of the
 * platform's five languages — "This link is active for the next 30 days."
 * It describes the ANONYMOUS web link (birthdate-gated, 30 days). Inside a
 * partner's surface the document never expires, so remove the sentence
 * (exact match) along with the URL before rendering the prose — the
 * platform's own app and widget do. Always its own paragraph, after the
 * link.
 */
export const REFERRAL_LINK_VALIDITY_SENTENCES: readonly string[] = [
  'This link is active for the next 30 days.',
  'Este enlace está activo durante los próximos 30 días.',
  'Dieser Link ist die nächsten 30 Tage aktiv.',
  'Ce lien est actif pendant les 30 prochains jours.',
  'Questo link è attivo per i prossimi 30 giorni.',
];
