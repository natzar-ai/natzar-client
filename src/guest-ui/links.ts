// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
// Turning the platform's PREDICTABLE links into in-frame actions.
//
// The messaging services emit exactly five URL shapes
// (services/messaging/async-consult.ts, telehealth.ts, booking;
// services/prescriptions/notices.ts; services/referrals/notices.ts):
//
//   ${formBaseUrl}/async?id=<threadId>       consent invite AND rating invite
//   ${formBaseUrl}/telehealth?id=<consultId> video invite
//   ${formBaseUrl}/book?id=<consultId>       appointment booking
//   ${formBaseUrl}/visit?id=<consultId>      in-person appointment booking
//   ${formBaseUrl}/pharmacy?id=<rxId>        "choose your pharmacy"
//   ${formBaseUrl}/referral?id=<referralId>  "view your referral" (a signed PDF)
//
// Inside an embedded widget a URL is the wrong answer twice over: it navigates
// the patient out of the host page, and the destination is our own anonymous
// browser page, which re-asks for a date of birth the partner already
// authenticated — and, for a partner-origin patient, refuses outright. The
// patient app never shows one either — it renders a button. So every surface
// here strips the link from the body and renders an action.
//
// Note the async shape is REUSED for two different intents, which is why the
// action can't be derived from the URL: only the consult's state distinguishes
// "consent to this" from "rate this". The server resolves that
// (embed-api resolveLinkStates) and sends it back as `linkStates`.

import {REFERRAL_LINK_VALIDITY_SENTENCES} from "../contract/referrals";

/**
 * What a resolved link can currently be used for.
 *
 * The terminal ones are distinct rather than a single "none" because the
 * widget keeps the button VISIBLE and disabled with a label saying what
 * happened — the patient app's behaviour. A button that disappears after a tap
 * leaves the patient unsure whether it registered.
 *
 * - `consent` / `rate` / `join` / `book` / `choose` / `view` — actionable.
 * - `open`  — the consult is live; the conversation itself is the surface.
 * - `rated` — already rated (disabled, "Rated").
 * - `ended` — finished with nothing left to do (disabled).
 * - `sent` / `expired` / `revoked` — a pharmacy link past choosing (disabled,
 *   "Sent to <pharmacy>" / "Link expired" / "Withdrawn"). A referral link
 *   shares `revoked` ("Referral withdrawn") and `expired` (a row the session
 *   cannot see); `view` opens its document.
 * - `none`  — unresolved; we can't say anything truthful about it.
 */
export type LinkAction =
  | "consent"
  | "rate"
  | "join"
  | "book"
  | "change"
  | "choose"
  | "view"
  | "open"
  | "rated"
  | "ended"
  | "sent"
  | "expired"
  | "revoked"
  | "none";

/** Actions the patient can still perform. Everything else renders disabled. */
export function isActionable(action: LinkAction): boolean {
  return (
    action === "consent" || action === "rate" || action === "join" || action === "book" || action === "choose" || action === "change" || action === "view"
  );
}

export type LinkKind = "async" | "telehealth" | "book" | "pharmacy" | "referral";

/** What a priced invite will charge, in the smallest currency unit (embed-api `payment`). */
export type LinkPrice = {amountCents: number; currency: string};

/**
 * Server-resolved state for every link referenced in a transcript, keyed by
 * the id in the link. `pharmacyName` only ever rides on a pharmacy link past
 * choosing — the "Sent to <pharmacy>" label. `title` and `referralKind` ride
 * on a referral link — the file row the card draws above its button.
 * `payment` rides on an invite that is still an offer AND costs money
 * (consent / join / book before a slot): the price the one press will charge.
 * Its absence means "show no price" — free, or a price the server could not
 * vouch for — never "free" to the widget: the server's gate still decides.
 */
export type LinkStates = Record<
  string,
  {
    kind: LinkKind;
    action: LinkAction;
    pharmacyName?: string | null;
    title?: string | null;
    referralKind?: string | null;
    payment?: LinkPrice | null;
    /**
     * A video link's modality, when the server resolved it: the waiting room
     * (`queue`) or the slot grid (`scheduled`). The agent's video hop opens
     * that surface on its own session; without it the link's kind decides
     * (`/book` is a booking, `/telehealth` the on-demand queue).
     */
    mode?: "queue" | "scheduled";
  }
>;

const ASYNC_LINK = /\S*\/async\?id=([A-Za-z0-9_-]+)\S*/;
const TELEHEALTH_LINK = /\S*\/telehealth\?id=([A-Za-z0-9_-]+)\S*/;
// SCHEDULED CONSULTATIONS (docs/SCHEDULED-CONSULTS.md). A booking link inside
// the widget's transcript must be stripped like the other two — the destination
// is our own page, and the embed mounts the slot grid itself.
const BOOKING_LINK = /\S*\/(?:book|visit)\?id=([A-Za-z0-9_-]+)\S*/;
// PRESCRIPTIONS (docs/PRESCRIPTIONS.md §5). The pharmacy link is stripped for
// the same reason and one more: the /pharmacy page is DOB-gated and refuses
// partner-origin patients outright, so inside the widget the ONLY way to
// choose a pharmacy is the picker the embed mounts itself (EmbedPharmacy).
export const PHARMACY_LINK = /\S*\/pharmacy\?id=([A-Za-z0-9_-]+)\S*/;
// REFERRALS (docs/REFERRALS.md §5.5). The /referral page is DOB-gated and
// refuses partner-origin patients like /pharmacy does; inside the widget the
// document opens straight from the card (embedReferralDocument). The notice
// also ends with a "valid for 30 days" sentence that describes the web link
// only — in here the document has no window, so it goes too (stripLink).
export const REFERRAL_LINK = /\S*\/referral\?id=([A-Za-z0-9_-]+)\S*/;
export const MEMBERSHIP_LINK = /https:\/\/[^\s]+\/membership\?id=[A-Za-z0-9_-]+/;

/**
 * An attachment URL the frame may render as an image or a link: `https:` (the presigned
 * download) or `blob:` (the patient's own optimistic bubble), nothing else — no `data:`,
 * no `javascript:` (RG4B N9; React only blocks the latter).
 */
export function safeAttachmentUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'https:' || protocol === 'blob:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * The id a message body links to. `consultId` is the field name for every
 * kind, INCLUDING `pharmacy`, where it is the prescription id: the link
 * regexes all capture "the id in the link", the cards key their busy state
 * on it, and linkStates is keyed on it — one shape, one lookup, and no
 * surface has to know which record type the id names before it asks the
 * server. Read it as "linked id".
 */
export type DetectedLink = {kind: LinkKind; consultId: string};

/** The consult, prescription or referral a message body links to, if any. */
export function detectLink(body: string): DetectedLink | null {
  const async = ASYNC_LINK.exec(body);
  if (async) return {kind: "async", consultId: async[1]};
  const tele = TELEHEALTH_LINK.exec(body);
  if (tele) return {kind: "telehealth", consultId: tele[1]};
  const book = BOOKING_LINK.exec(body);
  if (book) return {kind: "book", consultId: book[1]};
  const pharmacy = PHARMACY_LINK.exec(body);
  if (pharmacy) return {kind: "pharmacy", consultId: pharmacy[1]};
  const referral = REFERRAL_LINK.exec(body);
  if (referral) return {kind: "referral", consultId: referral[1]};
  return null;
}

/**
 * The prose without the URL. Also collapses the whitespace the removal leaves
 * behind, so a message written as "…tap here:\n\n<url>" doesn't render with a
 * trailing blank line where the link used to be.
 *
 * A referral notice additionally loses its validity sentence ("This link is
 * active for the next 30 days.", in whichever of the five languages it was
 * sent): it is true of the anonymous web link and false of this card, whose
 * document stays openable for as long as the referral exists. Exact match
 * against the contract's copies of the catalogue, so a reworded sentence
 * fails the parity test rather than silently surviving here. A pharmacy
 * notice keeps its 24-hour sentence — that link does expire in-frame too.
 */
export function stripLink(body: string): string {
  let out = body.replace(ASYNC_LINK, "").replace(TELEHEALTH_LINK, "").replace(BOOKING_LINK, "").replace(PHARMACY_LINK, "").replace(MEMBERSHIP_LINK, "");
  if (REFERRAL_LINK.test(out)) {
    out = out.replace(REFERRAL_LINK, "");
    for (const sentence of REFERRAL_LINK_VALIDITY_SENTENCES) out = out.replace(sentence, "");
  }
  return out
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Which action to offer for a detected link.
 *
 * Falls back to the kind's most likely intent when the server didn't resolve
 * the id (a consult from a rotated-away conversation, say): an async link
 * defaults to nothing rather than guessing "consent" — offering to consent to
 * something we can't see the state of is the one wrong answer — while a
 * telehealth link defaults to `join`, which is safe because joining re-checks
 * everything server-side anyway.
 */
export function actionFor(link: DetectedLink, states: LinkStates | undefined): LinkAction {
  const resolved = states?.[link.consultId];
  if (resolved) return resolved.action;
  // A booking link always leads somewhere useful — the grid is also the
  // appointment's own page, so it is never a dead end — and the server
  // re-checks everything anyway. Same reasoning as telehealth's default.
  if (link.kind === "book") return "book";
  // A pharmacy link defaults to `choose` on the same reasoning: the picker's
  // first call answers with the row's real state and settles the surface on
  // it (expired / sent / withdrawn) before anything can be chosen — and the
  // server resolves every miss as `expired`, so an unresolved id here means a
  // transcript delivered before its states, not a link it could not vouch for.
  if (link.kind === "pharmacy") return "choose";
  // A referral link defaults to `view` likewise: the open is a server call
  // that answers with the row's real state (revoked / not this patient's)
  // before any document is handed over.
  if (link.kind === "referral") return "view";
  return link.kind === "telehealth" ? "join" : "none";
}

/**
 * The button's label for a link action — one table for both chats, so the
 * async surface and the agent surface read the same word for the same state.
 * A pharmacy link past choosing names the pharmacy when the server knows it
 * ("Sent to Shoppers Drug Mart"), which is the one label that carries data.
 *
 * `kind` matters for one action only: `revoked` reads "Prescription
 * withdrawn" on a pharmacy link and "Referral withdrawn" on a referral link —
 * the same state on two different documents.
 *
 * `price` (already formatted — formatPrice) turns the two offers that are
 * paid for at the press into "Yes & pay CA$100.00" / "Join & pay CA$100.00":
 * the press opens the payment step itself, so the price belongs on the
 * button, not in a surprise after it. A booking link keeps "Choose a time" —
 * its payment is taken when a slot is confirmed, on the grid's own button.
 */
export function linkLabel(
  t: (key: string, opts?: Record<string, unknown>) => string,
  action: LinkAction,
  pharmacyName?: string | null,
  kind?: LinkKind,
  price?: string | null,
): string {
  switch (action) {
    case "consent":
      return price ? t("embed.agent.inviteAcceptPay", {amount: price}) : t("embed.agent.inviteAccept");
    case "rate":
      return t("embed.agent.linkRate");
    case "join":
      return price ? t("embed.agent.linkJoinPay", {amount: price}) : t("embed.agent.linkJoin");
    case "book":
      return t("embed.agent.linkBook");
    case "change":
      return t("embed.agent.linkChangePharmacy");
    case "choose":
      return t("embed.agent.linkChoosePharmacy");
    case "view":
      return t("embed.agent.linkViewReferral");
    case "rated":
      return t("embed.agent.linkRated");
    case "open":
      return t("embed.agent.linkOpen");
    case "none":
      return t("embed.agent.linkUnavailable");
    case "sent":
      return pharmacyName ? t("embed.agent.linkSentTo", {name: pharmacyName}) : t("embed.agent.linkSent");
    case "expired":
      return t("embed.agent.linkExpired");
    case "revoked":
      return kind === "referral" ? t("embed.agent.linkReferralRevoked") : t("embed.agent.linkRevoked");
    default:
      return t("embed.agent.linkEnded");
  }
}

/**
 * The locale a price is written in, from the widget's catalog language.
 *
 * The catalogs are keyed by region-flavoured tags ("fr", "en" — see
 * main.tsx) that say which TRANSLATION to use, not where the patient lives:
 * formatting a Canadian clinic's price with the Swiss catalog's region would
 * write "CA$" the way Geneva does. So the BASE language is what counts, and
 * the region comes from the browser when it speaks that same language
 * ("fr-CA" for a Montreal browser → "100,00 $"); otherwise the bare language.
 */
export function priceLocale(language: string, preferred: readonly string[] = []): string {
  const base = (language || "en").replace("_", "-").split("-")[0].toLowerCase() || "en";
  const match = preferred.find((tag) => tag.toLowerCase().split("-")[0] === base);
  return match ?? base;
}

/**
 * An amount the way the patient reads money: `Intl.NumberFormat` in their
 * locale, in the charge's own currency (Stripe's lowercase code, upper-cased).
 * A currency Intl does not know still renders — as "100.00 XYZ" — rather than
 * throwing inside a button label.
 */
export function formatPrice(price: LinkPrice, locale: string): string {
  const code = price.currency.toUpperCase();
  const amount = price.amountCents / 100;
  try {
    return new Intl.NumberFormat(locale, {style: "currency", currency: code}).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}
