// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import type {GuestAction} from '../contract/guest';

export type HistoryAction = Extract<GuestAction, 'sendHistoryCode' | 'verifyHistoryCode' | 'appendHistory' | 'deleteHistory' | 'declineHistory'>;
export const isHistoryConfirmation = (action: HistoryAction | 'offerHistory') => action === 'appendHistory' || action === 'deleteHistory';
