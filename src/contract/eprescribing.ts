// GENERATED FILE — do not edit.
//
// Copied verbatim from natzar-core's shared/partner-api by
// scripts/sync-contract.mjs. Edit the source there; this copy exists only so
// the published package is self-contained.
/** US e-prescribing drug search and physician readiness. No vendor credentials or personal enrollment details. */
import type {PrescriptionTransport} from './prescriptions';

/** One 11-digit NDC package. */
export interface DrugPackage {ndc: string; description: string; manufacturer: string; packageLabel: string}
/** A strength/form option. Controlled options are visible but cannot be selected. */
export interface DrugOption {key: string; strength: string; form: string; route: string | null; unit: string; controlled: boolean; controlledReason?: string; packages: DrugPackage[]}
export interface DrugProduct {key: string; name: string; generic?: string; options: DrugOption[]}
export interface SearchDrugsQuery {q: string}
export interface SearchDrugsResponse {products: DrugProduct[]; truncated: boolean}
export const EPRESCRIBING_REQUIREMENTS = ['organization_details', 'npi', 'prescriber_details', 'registration', 'identity_verification', 'identity_renewal', 'deactivated', 'service_unavailable'] as const;
export type EprescribingRequirement = typeof EPRESCRIBING_REQUIREMENTS[number];
export type EprescribingIdentityStatus = 'none' | 'pending' | 'verified' | 'not_verified' | 'expired';
export interface PhysicianEprescribing {
  transport: PrescriptionTransport;
  ready: boolean;
  requirements: EprescribingRequirement[];
  identity: {status: EprescribingIdentityStatus; verifiedUntil: string | null} | null;
  /** SSO-only physicians must request a portal invite before completing enrollment. Null in Canada. */
  portalAccess: 'active' | 'invite_required' | null;
  setupUrl: string | null;
  pharmacyRequests: {open: number; dueSoon: number; inboxUrl: string} | null;
}
export interface GetPhysicianEprescribingResponse {eprescribing: PhysicianEprescribing}
