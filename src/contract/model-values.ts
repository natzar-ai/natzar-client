// GENERATED FILE — do not edit.
//
// Copied verbatim from natzar-core's shared/partner-api by
// scripts/sync-contract.mjs. Edit the source there; this copy exists only so
// the published package is self-contained.
// Runtime model vocabularies, free of API types, validators and dependencies.
export const ASYNC_CONSULT_STATUSES = ['invited', 'queued', 'active', 'resolve_requested', 'closed'] as const;
export const ASYNC_CLOSED_REASONS = ['accept_timeout', 'inactivity', 'consent_timeout', 'no_capacity', 'opted_out', 'cancelled', 'escalated', 'declined', 'patient_closed', 'fulfilled'] as const;
export const TELEHEALTH_STATUSES = ['invited', 'scheduled', 'waiting', 'ringing', 'in_progress', 'completed', 'cancelled', 'no_show'] as const;
export const PATIENT_SEX_VALUES = ['female', 'male', 'intersex'] as const;
export const PATIENT_LANGUAGES = ['en_US', 'es_US', 'de_CH', 'fr_CH', 'it_CH'] as const;
