// GENERATED FILE — do not edit.
//
// Copied verbatim from natzar-core's shared/partner-api by
// scripts/sync-contract.mjs. Edit the source there; this copy exists only so
// the published package is self-contained.
/** Public guest journey contract. Guest credentials never authorize patient chart access. */
export type GuestChannel = 'web' | 'whatsapp' | 'sms';
export type GuestPhase = 'chat' | 'identity' | 'verification' | 'account' | 'offer' | 'payment' | 'intake' | 'ready';
export type GuestAction = 'begin' | 'resume' | 'state' | 'uploadAttachment' | 'message' | 'offerHistory' | 'sendHistoryCode' | 'verifyHistoryCode' | 'appendHistory' | 'deleteHistory' | 'declineHistory' | 'sendLoginCode' | 'verifyLoginCode' | 'profileIntake' | 'chooseCare' | 'identity' | 'sendCode' | 'verify' | 'checkout' | 'paymentStatus' | 'intake' | 'complete' | 'linkAccount' | 'logout';
/** Separately authenticated chat session. Never stored in the anonymous guest cookie. */
export type GuestAccount = {credential: string; firstName?: string; frameUrl: string; expiresAt: string;
  profileIntake?: Pick<GuestIdentity, 'birthdate' | 'sexAssignedAtBirth' | 'country'>};
export type GuestCare = {modality: 'async' | 'telehealth' | 'inPerson'; mode: 'live' | 'book'};
export type GuestIdentity = {
  phone: string; email: string; givenName: string; familyName: string; birthdate: string;
  sexAssignedAtBirth: 'male' | 'female' | 'intersex'; country: 'US' | 'CA'; state: string;
  zipCode?: string;
};
export type GuestSignup = Pick<GuestIdentity, 'givenName' | 'familyName' | 'birthdate' | 'sexAssignedAtBirth'> & {zipCode: string; email?: string};
/** null means unanswered; an empty list is an explicitly confirmed negative. */
export type GuestIntake = {
  chronicConditions: string[] | null;
  medications: string[] | null;
  allergies: Array<{name: string; reaction: string}> | null;
  confirmed: boolean;
  /** Optional canonical signup selections; the server derives display values and chart codes from these. */
  selections?: GuestIntakeSelections;
};
export type GuestIntakeSelections = {conditions: string[]; medications: string[]; medicationAnswers?: Record<string, string[]>; allergies: Array<{code: string; reactionCode: string; name?: string; reaction?: string}>};
export type GuestFile = {fileName: string; contentType: string; contentLength: number};
export type GuestAttachment = GuestFile & {key: string; ref?: string; url?: string};
export type GuestUpload = {url: string; attachment: GuestAttachment};
export type GuestMessage = {id: string; role: 'user' | 'assistant'; text: string; sentAt: string; channel?: GuestChannel; attachments?: GuestAttachment[]};
/** One durably accepted chat turn. It grants no care or patient-chart authority. */
export type GuestPendingMessage = {requestId: string; startedAt: string; status: 'queued' | 'processing'};
export type GuestOffer = GuestCare & {label: string; amountCents: number; currency: string};
export type GuestCareOffer = {
  messageId: string; care: GuestCare; expiresAt: string; available: boolean;
  price?: {amountCents: number; currency: string};
};
export type GuestPayment = {
  id: string | null; status: 'free' | 'pending' | 'paid' | 'failed' | 'refunded' | 'refund_pending' | 'refund_failed'; amountCents: number; currency: string;
  checkoutUrl?: string; clientSecret?: string; publishableKey?: string;
};
export type GuestView = {
  id: string; clinicId: string; clinicName: string; channel: GuestChannel; phase: GuestPhase;
  messages: GuestMessage[]; offers: GuestOffer[]; choice?: GuestCare;
  pendingMessage?: GuestPendingMessage;
  /** The assessed route for this conversation. Selection still requires verified eligibility. */
  recommendedCare?: GuestCare;
  /** A link to continue the current assessed offer within this guest journey. */
  careOfferLink?: {messageId: string; href: string};
  /** A care offer attached to the assistant message that issued it. */
  careOffer?: GuestCareOffer;
  /** In-chat appointment offer and its original validity window. */
  inPersonBooking?: {messageId: string; expiresAt: string; available: boolean};
  identity?: Partial<GuestIdentity>; phoneVerified: boolean; intake?: GuestIntake;
  payment?: GuestPayment; care?: {modality: GuestCare['modality']; id: string; url: string};
  /** Deployment clinical country, or the trusted demo country. Never selected by the patient. */
  country: 'US' | 'CA';
  expiresAt: string; signInUrl?: string;
  /** Identity state, never a patient credential or authority to read a chart. */
  profile?: 'guest' | 'patient';
  guestEnabled?: boolean;
  privacyUrl?: string; termsUrl?: string;
  /** Public draft-saving status. Signed-in account authority is returned separately. */
  history?: {
    saved: boolean; offered: boolean; canOffer: boolean; canSave: boolean;
    appendConfirmation?: boolean;
    verification?: {phone: string; channel: 'sms' | 'whatsapp'; sentAt: string};
  };
  login?: {appendConfirmation?: boolean; verification?: {phone: string; channel: 'sms' | 'whatsapp'; sentAt: string}};
};
export type GuestRequest = {
  action: GuestAction; credential?: string; clinicId?: string; locale?: string;
  file?: GuestFile; attachment?: GuestAttachment;
  text?: string; requestId?: string; choice?: GuestCare; careOfferId?: string; identity?: GuestIdentity;
  offerMessageId?: string;
  code?: string; verificationChannel?: 'sms' | 'whatsapp'; intake?: GuestIntake; consent?: boolean; resumeTicket?: string;
  healthConsent?: boolean; messagingConsent?: boolean;
  phone?: string;
  signup?: GuestSignup;
  accountCredential?: string;
  /** Client-generated random login capability; activated only after successful OTP proof. */
  newAccountCredential?: string;
};
export type GuestResult =
  | {ok: true; journey: GuestView; credential?: string; account?: GuestAccount; upload?: GuestUpload}
  | {ok: false; error: string; field?: string; retryAfterSeconds?: number};
export const GUEST_MAX_TEXT = 2000;
export const GUEST_SESSION_SECONDS = 7 * 24 * 60 * 60;
export const GUEST_PAID_SESSION_SECONDS = 30 * 24 * 60 * 60;
export const GUEST_MAX_MESSAGES = 80;
export const GUEST_HISTORY_PROMPT_MESSAGES = 3;
export const GUEST_SAVED_SESSION_SECONDS = 30 * 24 * 60 * 60;
