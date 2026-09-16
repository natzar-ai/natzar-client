/**
 * # @natzar/client
 *
 * The official TypeScript client for the **Natzar Partner API** — the REST
 * surface behind AI health-assistant chat, asynchronous physician consults and
 * live video consults.
 *
 * ```ts
 * import {NatzarClient} from '@natzar/client';
 *
 * // Server side only: the key identifies your tenant.
 * const natzar = new NatzarClient({apiKey: process.env.NATZAR_API_KEY!});   // prod by default
 *
 * await natzar.patients.upsert({
 *   externalId: 'u_42', phone: '+15551234567', email: 'a@b.co',
 *   givenName: 'Ada', familyName: 'Lovelace', birthdate: '1990-04-17', sex: 'female',
 * });
 * await natzar.agent.send({externalPatientId: 'u_42', text: 'I have a sore throat'});
 * const {items, cursor} = await natzar.agent.messages({externalPatientId: 'u_42'});
 * ```
 *
 * ## Environments
 *
 * Four: `local`, `dev`, `stage`, `prod`. **`prod` is the default** — a client
 * that quietly defaults to a test environment is discovered a week later, when
 * nothing has happened; one that defaults to production is discovered on the
 * first call. `local` points at `http://localhost:5173`. Override per client
 * (`{environment}` / `{baseUrl}`) or per process (`NATZAR_ENV`,
 * `NATZAR_API_URL`) — see `./environments`.
 *
 * ## What is in here
 *
 * - {@link NatzarClient} — every route, typed from the published contract.
 * - `verifyWebhook` / `handleWebhook` — signature verification over the RAW
 *   body, with the replay window enforced.
 * - `uploadAttachments` — presign + PUT + staging keys, in one call.
 * - `detectLink` / `resolveLinkActions` — turn the transcript's invite links
 *   into buttons, which is what an in-app surface should render instead of a
 *   URL that navigates the patient away.
 * - The whole contract (`./contract`): resource shapes, request schemas, error
 *   codes, webhook payloads, embed element types — re-exported here.
 *
 * The two BROWSER entry points live beside this one: `@natzar/client/patient`
 * (a patient's care conversation, on an embed session) and
 * `@natzar/client/physician` (a clinician's workspace, on a physician session
 * minted with `physicians.session`). Neither needs an API key.
 *
 * @packageDocumentation
 */

export {NatzarClient} from './client';
export type {CallOptions, NatzarClientOptions} from './client';

// Thrown by both browser entry points when a session is unusable before any
// request is made. Exported here too so a server-rendered app that imports
// only the root can still recognise it in one `catch`.
export {NatzarSessionError} from './session-error';

export {
  DEFAULT_ENVIRONMENT,
  DEFAULT_ZONE,
  NATZAR_ENDPOINTS,
  NATZAR_ENVIRONMENTS,
  NATZAR_ZONES,
  isNatzarEnvironment,
  isNatzarZone,
  normalizeBaseUrl,
  resolveEndpoints,
} from './environments';
export type {EndpointOverrides, NatzarEndpoints, NatzarEnvironment, NatzarZone} from './environments';

export {NatzarApiError, isErrorCode, isNatzarApiError, isRetryable} from './errors';

export type {CredentialKind, FetchLike, HttpConfig, RequestArgs} from './http';

export {
  DEFAULT_TOLERANCE_SECONDS,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_SIGNATURE_VERSION,
  handleWebhook,
  parseSignatureHeader,
  signWebhook,
  verifyWebhook,
  verifyWebhookRequest,
} from './webhooks';
export type {WebhookVerifyFailure, WebhookVerifyResult} from './webhooks';

export {uploadAttachments} from './uploads';
export type {StagedAttachment, UploadInput} from './uploads';

export {
  actionFor,
  asyncActionFor,
  detectLink,
  isActionable,
  linkIdsIn,
  resolveLinkActions,
  stripLink,
  telehealthActionFor,
} from './links';
export type {DetectedLink, LinkAction, LinkActions} from './links';

// The contract's TYPES — resources, request/response shapes, error codes,
// webhook payloads, embed element types. Re-exported so a consumer imports one
// package, not two that could drift.
//
// `export type *`, not `export *`, and that difference matters: the contract
// module also carries 29 runtime zod schemas, and re-exporting them put ~170
// symbols plus a hard `zod` dependency into every consumer's namespace and
// bundle. Partners validate with their own tools; the schemas stay reachable
// at `@natzar/client/contract` for the few who want ours.
export type * from './contract/index';

// The subscription primitive, for partners modelling something this SDK does
// not (a physician queue dashboard, a custom surface). Same engine the
// built-in subscriptions use — backoff, visibility-gating and teardown
// included, so nobody has to rebuild it.
export {watch} from './subscribe';
export type {SyncState, Unsubscribe, WatchOptions, PollSource} from './subscribe';
