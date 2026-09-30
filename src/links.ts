/**
 * Turning the links the platform writes into transcripts into ACTIONS.
 *
 * The messaging services emit exactly five URL shapes:
 *
 * ```
 * <host>/async?id=<consultId>            the consent invite AND the rating invite
 * <host>/telehealth?id=<consultId>       the video invite
 * <host>/book?id=<consultId>             the slot grid of a scheduled consult
 * <host>/pharmacy?id=<prescriptionId>    "choose your pharmacy" on a prescription
 * <host>/referral?id=<referralId>        "view your referral" — a signed PDF
 * ```
 *
 * They exist because SMS and WhatsApp have nothing but text. Inside an app —
 * yours or ours — a URL is the wrong answer twice over: it navigates the
 * patient out, and the destination is our own anonymous page, which re-asks
 * for a date of birth you already authenticated (and, for a partner-origin
 * patient, refuses outright). So a client should strip the link from the body
 * and render a BUTTON.
 *
 * The catch, and the reason this module is not four lines: the `/async` shape
 * is reused for two different intents, so the URL alone cannot tell you
 * whether the button says "Accept" or "Rate". Only the consult's current state
 * can. {@link resolveLinkActions} resolves that with the ids it found —
 * exactly what our own embedded widget does server-side before it paints, so a
 * headless integration reaches the same UI.
 *
 * @packageDocumentation
 */

import type {NatzarClient} from './client';
import type {ErrorCode} from './contract/errors';
import type {PharmacyLinkAction, PrescriptionResource} from './contract/prescriptions';
import {REFERRAL_LINK_VALIDITY_SENTENCES, type ReferralLinkAction, type ReferralResource} from './contract/referrals';
import type {AsyncConsultResource, MessageResource, TelehealthConsultResource} from './contract/resources';
import {isNatzarApiError} from './errors';

/**
 * What a link can currently be used for.
 *
 * The terminal states are distinct rather than one "nothing to do", because
 * the right UI keeps the button VISIBLE and disabled with a label saying what
 * happened. A control that disappears after a tap leaves the patient unsure
 * whether it registered; one that reads "Rated" answers the question.
 *
 * - `consent` / `rate` / `join` / `book` / `choose` / `view` — actionable.
 * - `open`  — the consult is live and the conversation itself is the surface;
 *   there was never a button here.
 * - `rated` — already rated (disabled, "Rated").
 * - `ended` — finished with nothing left to do (disabled).
 * - `sent` — the prescription went to the chosen pharmacy (disabled, "Sent to
 *   {pharmacyName}" when the name is known). `expired` — the 24-hour pharmacy
 *   link lapsed unused. `revoked` — the physician withdrew the prescription.
 * - `view` — a referral's signed PDF can be opened (`client.referrals.get`
 *   mints the URL). A referral shares `revoked` ("Referral withdrawn") and
 *   `expired` (a link that does not resolve) with the prescription.
 * - `none`  — unresolved. We could not read the consult, and inventing a label
 *   for an unknown state would be worse than saying nothing.
 */
export type LinkAction =
  | 'consent'
  | 'rate'
  | 'join'
  | 'book'
  | 'open'
  | 'rated'
  | 'ended'
  | PharmacyLinkAction
  | ReferralLinkAction
  | 'none';

/** Actions the patient can still perform. Everything else renders disabled. */
export function isActionable(action: LinkAction): boolean {
  return (
    action === 'consent' || action === 'rate' || action === 'join' || action === 'book' || action === 'choose' || action === 'view'
  );
}

/** The kinds of link a message can carry, by the page it would have led to. */
export type LinkKind = 'async' | 'telehealth' | 'book' | 'pharmacy' | 'referral';

/**
 * A link found in a message body.
 *
 * `consultId` is the id the link named: a consult for `async` / `telehealth`
 * / `book`, the PRESCRIPTION id for `pharmacy` and the REFERRAL id for
 * `referral`. One field for every kind, so a card can hand it to the matching
 * client call without a switch.
 */
export interface DetectedLink {
  kind: LinkKind;
  consultId: string;
}

/**
 * Resolved state for every consult, prescription and referral referenced
 * across a transcript. A `pharmacy` entry also carries the chosen pharmacy's
 * name once there is one, for the "Sent to …" label; a `referral` entry
 * carries the document's `title` for the file card. A consult entry whose
 * action is still owed (`consent` / `join` / `book`) and priced carries
 * `payment` — the consult resource's `payment` block while it is `due` — so
 * the button can read "Yes & pay CA$100" (docs/partner-api/guides/payments.md).
 * Absent = no price to show, never "free".
 */
export type LinkActions = Record<string, {
  kind: LinkKind;
  action: LinkAction;
  pharmacyName?: string | null;
  title?: string | null;
  payment?: {amountCents: number; currency: string};
}>;

// The price a consult resource's `payment` block puts on its button: only
// while `due`, and only beside an action that is still owed — a price next to
// "Rated" or "Consultation ended" would be a bill for nothing.
const priceFor = (
  consult: {payment?: {status: string; amountCents: number; currency: string}},
  action: LinkAction,
): {payment?: {amountCents: number; currency: string}} =>
  consult.payment?.status === 'due' && (action === 'consent' || action === 'join' || action === 'book')
    ? {payment: {amountCents: consult.payment.amountCents, currency: consult.payment.currency}}
    : {};

const ASYNC_LINK = /\S*\/async\?id=([A-Za-z0-9_-]+)\S*/;
const TELEHEALTH_LINK = /\S*\/telehealth\?id=([A-Za-z0-9_-]+)\S*/;
const BOOKING_LINK = /\S*\/book\?id=([A-Za-z0-9_-]+)\S*/;
const PHARMACY_LINK = /\S*\/pharmacy\?id=([A-Za-z0-9_-]+)\S*/;
const REFERRAL_LINK = /\S*\/referral\?id=([A-Za-z0-9_-]+)\S*/;
const ASYNC_LINK_GLOBAL = /\/async\?id=([A-Za-z0-9_-]+)/g;
const TELEHEALTH_LINK_GLOBAL = /\/telehealth\?id=([A-Za-z0-9_-]+)/g;
const BOOKING_LINK_GLOBAL = /\/book\?id=([A-Za-z0-9_-]+)/g;
const PHARMACY_LINK_GLOBAL = /\/pharmacy\?id=([A-Za-z0-9_-]+)/g;
const REFERRAL_LINK_GLOBAL = /\/referral\?id=([A-Za-z0-9_-]+)/g;

/** The consult, prescription or referral a message body links to, if any. */
export function detectLink(body: string): DetectedLink | null {
  const asyncMatch = ASYNC_LINK.exec(body);
  if (asyncMatch) return {kind: 'async', consultId: asyncMatch[1]};
  const tele = TELEHEALTH_LINK.exec(body);
  if (tele) return {kind: 'telehealth', consultId: tele[1]};
  const book = BOOKING_LINK.exec(body);
  if (book) return {kind: 'book', consultId: book[1]};
  const pharmacy = PHARMACY_LINK.exec(body);
  if (pharmacy) return {kind: 'pharmacy', consultId: pharmacy[1]};
  const referral = REFERRAL_LINK.exec(body);
  if (referral) return {kind: 'referral', consultId: referral[1]};
  return null;
}

/**
 * The prose without the URL.
 *
 * Also collapses the whitespace removal leaves behind, so a message written as
 * `"…tap here:\n\n<url>"` does not render with a trailing blank line where the
 * link used to be.
 *
 * A referral notice additionally loses its validity sentence ("This link is
 * active for the next 30 days.", in whichever of the platform's five
 * languages it was sent — {@link REFERRAL_LINK_VALIDITY_SENTENCES}): it
 * describes the anonymous web link, and the document you open through
 * `client.referrals.get` has no window. A prescription notice keeps its
 * 24-hour sentence — that link does expire on every surface.
 */
export function stripLink(body: string): string {
  let out = body.replace(ASYNC_LINK, '').replace(TELEHEALTH_LINK, '').replace(BOOKING_LINK, '').replace(PHARMACY_LINK, '');
  if (REFERRAL_LINK.test(out)) {
    out = out.replace(REFERRAL_LINK, '');
    for (const sentence of REFERRAL_LINK_VALIDITY_SENTENCES) out = out.replace(sentence, '');
  }
  return out
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Every consult, prescription and referral id referenced by a set of message bodies, by kind. */
export function linkIdsIn(bodies: string[]): {
  async: string[];
  telehealth: string[];
  book: string[];
  pharmacy: string[];
  referral: string[];
} {
  const asyncIds = new Set<string>();
  const teleIds = new Set<string>();
  const bookIds = new Set<string>();
  const pharmacyIds = new Set<string>();
  const referralIds = new Set<string>();
  for (const body of bodies) {
    for (const m of body.matchAll(ASYNC_LINK_GLOBAL)) asyncIds.add(m[1]);
    for (const m of body.matchAll(TELEHEALTH_LINK_GLOBAL)) teleIds.add(m[1]);
    for (const m of body.matchAll(BOOKING_LINK_GLOBAL)) bookIds.add(m[1]);
    for (const m of body.matchAll(PHARMACY_LINK_GLOBAL)) pharmacyIds.add(m[1]);
    for (const m of body.matchAll(REFERRAL_LINK_GLOBAL)) referralIds.add(m[1]);
  }
  return {
    async: [...asyncIds],
    telehealth: [...teleIds],
    book: [...bookIds],
    pharmacy: [...pharmacyIds],
    referral: [...referralIds],
  };
}

/** The action an async consult's CURRENT state offers. */
export function asyncActionFor(consult: AsyncConsultResource): LinkAction {
  if (consult.status === 'invited') return 'consent';
  if (consult.status !== 'closed') return 'open';
  if (consult.rating) return 'rated';
  return consult.rateable ? 'rate' : 'ended';
}

/**
 * The action a telehealth consult's CURRENT state offers.
 *
 * `joinableUntil` is checked before the status, not after: an invite whose
 * window has closed is still `invited` on the record, so a status-only reading
 * offers a Join button forever and the patient discovers it is dead by pressing
 * it. `nowMs` is injectable so a client can run a countdown and re-render the
 * card the moment it lapses, rather than waiting for the next poll.
 */
export function telehealthActionFor(consult: TelehealthConsultResource, nowMs: number = Date.now()): LinkAction {
  const joinable = ['invited', 'waiting', 'ringing', 'in_progress'].includes(consult.status);
  if (joinable) {
    const until = consult.joinableUntil ? Date.parse(consult.joinableUntil) : NaN;
    // No window (partner-originated) never expires; an unparseable one fails
    // OPEN, matching the server's own rule.
    if (!Number.isFinite(until) || nowMs < until) return 'join';
    return 'ended';
  }
  if (consult.rating) return 'rated';
  // completed / cancelled / no_show with no rating yet — a finished call is
  // worth asking about even when it was short.
  return 'rate';
}

/**
 * The action a BOOKING link offers from the scheduled consult's CURRENT state.
 *
 * `book` for as long as the consult is open: the grid is also the
 * appointment's own page once a slot is taken, so the button reads "Choose a
 * time" before and opens the confirmed appointment after. What it must not do
 * is outlive the consult — a cancelled appointment with a live-looking button
 * whose tap fails is the bug this exists to prevent. A cancelled consult was
 * never a call, so it offers nothing to rate either.
 *
 * Deliberately no window check: the booking link's own window is not on the
 * resource (`joinableUntil` is the ten-minute QUEUE window, which a scheduled
 * consult is never judged by), and failing open costs one server-side refusal
 * where failing closed would hide a real appointment.
 */
export function bookActionFor(consult: TelehealthConsultResource): LinkAction {
  if (['invited', 'scheduled', 'waiting', 'ringing', 'in_progress'].includes(consult.status)) return 'book';
  if (consult.rating) return 'rated';
  return consult.status === 'cancelled' ? 'ended' : 'rate';
}

/**
 * The action a prescription's pharmacy link offers from its CURRENT state.
 *
 * The resource already carries the platform's `action`; this recomputes it
 * from `status` and `expiresAt` so that, like {@link telehealthActionFor}, a
 * client can pass `nowMs` and flip the card to `expired` the moment the
 * 24-hour window lapses rather than at the next read. Only a prescription
 * still waiting for its pharmacy (`awaiting_pharmacy`, or `failed` and
 * waiting for another) expires by the clock; once chosen, revoked or
 * expired, the status is the answer. No window on the resource never expires,
 * the platform's own rule.
 */
export function pharmacyActionFor(prescription: PrescriptionResource, nowMs: number = Date.now()): LinkAction {
  const {status} = prescription;
  if (status === 'transmitting' || status === 'sent') return 'sent';
  if (status === 'revoked') return 'revoked';
  if (status === 'awaiting_pharmacy' || status === 'failed') {
    if (prescription.expired) return 'expired';
    const until = prescription.expiresAt ? Date.parse(prescription.expiresAt) : NaN;
    return Number.isFinite(until) && nowMs >= until ? 'expired' : 'choose';
  }
  return 'expired';
}

/**
 * The action a referral's link offers from its CURRENT state.
 *
 * The resource already carries the platform's `action`; this derives it from
 * `status` alone so a client holding the resource never disagrees with it: a
 * referral is `view` while issued and `revoked` once withdrawn. Nothing
 * expires by the clock here — the 30-day window is the anonymous web page's,
 * and the document read over this API is minted fresh on every `get`.
 */
export function referralActionFor(referral: ReferralResource): LinkAction {
  return referral.status === 'revoked' ? 'revoked' : 'view';
}

/**
 * Resolve what every link in a transcript can currently be used for.
 *
 * Reads each referenced consult, prescription or referral once. An id that
 * cannot be read (another tenant's, one that went away, or — for a
 * prescription or a referral — one this credential may not read) is simply
 * absent from the result, which {@link actionFor} renders as `none` or the
 * kind's own fallback rather than guessing. Works on a physician session
 * too: the consult routes are on its allowlist and the patient-side document
 * routes are not, so a clinician's transcript resolves its consent and video
 * buttons and leaves the pharmacy and referral links to their `choose` /
 * `view` fallbacks.
 */
export async function resolveLinkActions(
  client: NatzarClient,
  messages: Pick<MessageResource, 'body'>[],
  nowMs: number = Date.now(),
): Promise<LinkActions> {
  const ids = linkIdsIn(messages.map((m) => m.body ?? ''));
  const out: LinkActions = {};
  const skip = (codes: ErrorCode[]) => async (run: () => Promise<void>) => {
    try {
      await run();
    } catch (e) {
      // Anything outside `codes` is worth propagating rather than silently
      // rendering a dead button.
      if (!isNatzarApiError(e) || !codes.includes(e.code as ErrorCode)) throw e;
    }
  };
  // 404 is the documented answer for "not yours / not there".
  const skipMissing = skip(['not_found']);
  // The prescription routes are patient-side, tenant-key only: a physician
  // session gets `403 forbidden` on every one of them. That is "not
  // resolvable here", not a fault — the id stays absent and `actionFor`
  // falls back to `choose`, which the picker's first read re-checks anyway.
  const skipUnresolvable = skip(['not_found', 'forbidden']);
  await Promise.all([
    ...ids.async.map((id) =>
      skipMissing(async () => {
        const {consult} = await client.asyncConsults.get(id);
        const action = asyncActionFor(consult);
        out[id] = {kind: 'async', action, ...priceFor(consult, action)};
      }),
    ),
    ...ids.telehealth.map((id) =>
      skipMissing(async () => {
        const {consult} = await client.telehealth.get(id);
        const action = telehealthActionFor(consult, nowMs);
        out[id] = {kind: 'telehealth', action, ...priceFor(consult, action)};
      }),
    ),
    ...ids.book.map((id) =>
      skipMissing(async () => {
        const {consult} = await client.telehealth.get(id);
        const action = bookActionFor(consult);
        out[id] = {kind: 'book', action, ...priceFor(consult, action)};
      }),
    ),
    ...ids.pharmacy.map((id) =>
      skipUnresolvable(async () => {
        const {prescription} = await client.prescriptions.get(id);
        out[id] = {kind: 'pharmacy', action: pharmacyActionFor(prescription, nowMs), pharmacyName: prescription.pharmacyName};
      }),
    ),
    // The read also mints a document URL that is NOT kept here: it expires
    // in minutes, and a card should `get` again on the tap it opens with.
    ...ids.referral.map((id) =>
      skipUnresolvable(async () => {
        const {referral} = await client.referrals.get(id);
        out[id] = {kind: 'referral', action: referralActionFor(referral), title: referral.title};
      }),
    ),
  ]);
  return out;
}

/**
 * Which action to offer for a detected link.
 *
 * The fallback when the id was not resolved is deliberately asymmetric: a
 * telehealth link defaults to `join`, a booking link to `book`, a pharmacy
 * link to `choose` and a referral link to `view`, which are safe because each
 * destination re-checks everything server-side anyway (a picker's first call
 * reads the state; a document open is a read), while an async link defaults
 * to `none` — offering to consent to something whose state we cannot see is
 * the one genuinely wrong answer.
 */
export function actionFor(link: DetectedLink, actions: LinkActions | undefined): LinkAction {
  const resolved = actions?.[link.consultId];
  if (resolved) return resolved.action;
  if (link.kind === 'telehealth') return 'join';
  if (link.kind === 'book') return 'book';
  if (link.kind === 'pharmacy') return 'choose';
  if (link.kind === 'referral') return 'view';
  return 'none';
}
