// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import type {GuestCare, GuestOffer} from '../contract/guest';

/** The same enabled-care buttons on the welcome screen and in a conversation. */
export function GuestCareOptions({offers, choice, busy, freeLabel, messageClinicianLabel, videoNowLabel, formatPrice, onChoose}: {
  offers: GuestOffer[];
  choice?: GuestCare;
  busy: boolean;
  freeLabel: string;
  messageClinicianLabel: string;
  videoNowLabel: string;
  formatPrice(amount: number, currency: string): string;
  onChoose(choice: GuestCare): void;
}) {
  if (!offers.length) return null;
  return <div className="guest-offers">{offers.map(offer => <button className="guest-offer" type="button" disabled={busy}
    key={`${offer.modality}-${offer.mode}`} aria-pressed={offer.modality === choice?.modality && offer.mode === choice.mode}
    onClick={() => onChoose({modality: offer.modality, mode: offer.mode})}>
    <strong>{offer.modality === 'async' ? messageClinicianLabel : offer.modality === 'telehealth' && offer.mode === 'live' ? videoNowLabel : offer.label}</strong><span>{offer.amountCents ? formatPrice(offer.amountCents, offer.currency) : freeLabel}</span><span aria-hidden="true">↗</span>
  </button>)}</div>;
}
