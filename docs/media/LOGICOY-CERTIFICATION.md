# LogiCoy validation and rollout

This runbook preserves the unfinished live gates after the implementation plan
is removed. Offline tests, a successful deployment, and certification are
separate results. Never mark a live scenario passed from a fake, a historical
probe entity, an authenticated empty webhook, or an inferred vendor response.

## Current live evidence (2026-10-14)

Sandbox `nate` uses AWS account `685775558203`, profile `natzar`, region
`us-east-1`, project `natzar-core`, secrets deployment key
`sandbox-natzar-core-nate-4da8807687/local/us`, and API
`https://api-nate.natzar.dev/v1`.
Implementation source `905cdbc` was deployed successfully after repairing the
local checkout. Release `r-20261012T130238Z-7d4b55cf` completed with its lock
released and CloudFormation `UPDATE_COMPLETE`. The guarded deployment had
zero replacements. Main also contains `6f90e4f`, which preserves historical
credential names and versions in retained deployment metadata while projecting
only current catalog names into runtime manifests. Its mirror run
`38260156087` succeeded. That run preceded the final live prescribing checks below. Promotion
requires the reviewed source, successful mirror, and exact-commit hosting jobs.

The reviewed source corrections in `128327721acb387b7b86364695707b97abc5eceb`
were subsequently deployed to sandbox on 2026-10-13. Release
`r-20261013T193024Z-7d4b55cf` is active; root and data stacks are
`UPDATE_COMPLETE`, and lock/pending slots are absent. The guarded comparison
reported zero replacements. All 64 live functions are healthy; maximum
environment size is 3,089 bytes, with all 33 runtime manifest bindings matching
the prepared release. The LogiCoy key and webhook selectors remain confined
to prescriptions. The public browser's real DOB-gated response now displays
the clinic-review message for the existing terminal failure. The normal local
checkout has the same source and verified generated settings; all four prior
local edits were preserved unchanged. The adult live send gate below passed on this release, before final
API validation and promotion.

The final backend guard/diagnostic source `d3698342ad86c5abeb1dc5624a794396b646ee6a`
was deployed on 2026-10-14. Release `r-20261014T060524Z-7d4b55cf` is active;
root and data stacks are `UPDATE_COMPLETE`, the own deployment typecheck
passed, replacement count was zero, and release lock/pending slots are absent.
The read-only verifier confirmed the prepared file digests, live manifest,
fresh outputs, namespace identity, healthy prescriptions function and private
credential selectors. A genuine portal signing attempt for the unchanged
14-year-old fixture returned the actionable under-18 refusal and retained only
the original failed prescription. The final frontend-only catalog fix copies the clinic
contact messages into all five embedded pharmacy catalogs; backend source
remains identical to `d369834`. Local source/settings were synchronized while
preserving the user's four prior edits.

On 2026-10-12, genuine physician and tenant-admin sign-ins passed eight
GraphQL enrollment and request list/count reads with no errors. Both roles'
open/recent inboxes and counts were empty. One direct-IAM gateway status call
also passed, reporting `registration_failed`, `ready: false`, and zero open
or due-soon requests. That invocation verifies the gateway; it does not
certify partner REST actor authentication. No application writes or vendor
calls were made by these provider/gateway checks.

All 64 live functions measured below 3500 environment bytes (maximum 3082).
Partner-api fell from 2619 to 2541 bytes; provider-embed measured 2811 and
prescriptions 2707. The actual sandbox bundles contain the vendor SDK only
in prescriptions and one axios core per gateway/caller bundle. Sandbox synth
has 44 templates, FunctionDirectiveStack 387 resources, API 388, data template
822,645 bytes, and no nested-stack cycle.

The deployed webhook returned 200 for an authenticated empty body and 401
without its header on `2026-10-12T04:53:31Z`. The owned scheduler is enabled,
runs every 15 minutes in UTC and passes `{"source":"aws.events"}`. Twenty-seven
ordinary polls completed from `2026-10-11T22:00:31Z` through
`2026-10-12T04:30:31Z`, with no enqueue failures and cursor writes confirmed.
At 04:45 UTC, the vendor token endpoint returned HTTP 502; that poll remained
incomplete and correctly preserved the cursor. The next ordinary tick at
`2026-10-12T05:00:29.894Z` recovered, read 13 notifications, completed with no
enqueue failures and wrote the cursor. Of 29 post-release ticks, 28 completed
and one deferred on vendor authentication failure. These checks prove wiring,
not real prescription event delivery.

The deployment-owned synthetic fixture is
`ERX_SMOKE_1791708633366_5f44d5a8`, physician
`349894f8-70f1-70c0-3d42-9b4aa333c717`. LogiCoy confirmed it fixed the database
insertion failure behind the earlier HTTP 500 / `PHARM_ERC_8052` refusals.
The supported portal registration retry on 2026-10-12 successfully created
practice `d8a86dbd-b22e-4d59-8f18-393a5e859de5`, location
`6c62ebaa-7710-4587-af5d-439b94de60aa`, and clinician
`05b0aab5-f164-48d2-9ae1-960738671197`. No historical vendor entities were
adopted. Practice transaction `7f882705-e933-412f-b605-f120f71f1d71`, tracking
ID `3cd36374-1669-422b-bb5e-3b9de77041d8`, returned HTTP 200 and business
status OK; the signed-in vendor portal independently displayed the same new
practice ID and success response. Location transaction
`a1683e53-39ca-49b5-95fd-5efeb1a9ff46` and clinician transaction
`3b60b68b-233f-4cad-87c8-4062c16a863e` also returned HTTP 200 and saved their
owned identifiers.

The updated vendor test-scenarios PDF supplied on 2026-10-13 includes the
previously missing code-generator URL, `https://account.idmelabs.com/`, in
section 7.5.2 (physical page 35, printed page 34). Its visible text and embedded
link agree. The URL redirects to the ID.me sandbox wallet. The subsequently
supplied `ID.me.docx` explains that the Code Generator method supplies a
system-generated value: leave it unchanged and click Continue. That flow
successfully authenticated the vendor's test persona. The redacted DOM value
is not evidence of an invalid code. No personal phone, MFA method, or account
security setting was changed.

A fresh verification initiated from our app then completed the genuine ID.me
browser return. The app saved identity proof at
`2026-10-13T15:32:56.520Z`, reports `verified`, `ready: true`, and expiry
2026-10-23. The two-day margin permits issuing through 2026-10-21 UTC.
Return-check transaction `d3fb2c49-c4f0-4ce7-b04a-3c6f8c8aa4ee`, tracking ID
`2545573a-e830-4306-831e-ae4e64cc402e`, returned HTTP 200. This evidence comes
from the actual app-issued flow and saved proof, not a manufactured callback.

The physician portal issued synthetic prescription `MbYC73TJex9x` at
`2026-10-13T15:40:10.620Z`: lisinopril 10 MG tablet, NDC `60687032511`,
one tablet daily, quantity 30, 30 days, zero refills. The public pharmacy
page accepted the patient's real fixture birthdate after fixing its
adult-only calendar, collected the Petaluma delivery address, displayed
eight nearby pharmacies and accepted Shollenberger as the choice. The
consultation signup's adult age limit remains unchanged.

The first transmission attempt failed at `patient_add`, HTTP 400, on
`2026-10-13T15:55:39.828Z`, transaction
`96674655-18ba-44ab-abf4-927432835e59`, tracking ID
`95f5a876-ea88-43fa-a047-13a7853121f7`. No draft, medication PK, or send was
created. The prescription is terminal `failed` with `erx:validation`; its
24-hour link had not expired. The existing blocked-link representation
caused misleading public expiry text. Pharmacy replies now include a
non-sensitive blocked-choice indicator so the public page asks the patient
to contact their clinic while preserving the existing retry refusal. The signed-in vendor trace subsequently identified four nested
`patientList[0].validationErrorInfo` entries: `heightInFeet`, `weightInLb`,
`heightObservationDate`, and `weightObservationDate`, all required for patients
under 18. There was no phone validation error. The patient model has no
validated measured-vitals fields, so the final source refuses under-18 eRx
before vendor preparation or clinical writes with reason
`pediatric_measurements_unavailable`. Portal, action-plan, REST, and provider
frame replies explain the limitation. Fax, referrals, intake, and all-age
identity checks retain their existing behavior. The original minor record and
failed prescription are preserved; no measurements or replacement birthdate
were invented. Nested vendor diagnostics now retain bounded reviewed field
paths without logging patient values or raw vendor messages.

Normal partner API patient creation and a genuine platform-origin adult
consultation also passed. DOB-gated consent and a genuine physician-token
claim produced active consultation `RCAgEqYpMNO6`. The separate REST patient's
address remains absent for the smoke runner's initial collection assertion.
No parity prescription or SDK clinical smoke was issued before that pause.
The temporary test partner was suspended on resume, its old key returned
401 after the authorizer cache interval, and the tenant's complete profile
and original product flags were restored.

A separate adult fixture (birthdate 1980-09-01) used the genuine platform
consultation `RCAgEqYpMNO6`. The physician portal issued `vCmYqKbY1sCv` at
`2026-10-13T20:43:44.584Z`. The DOB-gated public page collected its address and
sent it to Shollenberger on `2026-10-14T05:44:52.471Z`. Vendor patient creation
succeeded; draft transaction `02899b6e-29db-474b-aba2-4184e55612b1` returned
medication PK `aa94b39b-f03e-4c6f-8f63-0dd041305796`. Send transaction
`e95307ca-6a8c-4be8-b35d-d16ddacd5833`, tracking
`8c73fc6e-c426-43e0-a329-f43bb439ee9c`, returned HTTP 200 and business
`SUCCESS`. The vendor portal independently confirmed those identifiers and
its status endpoint reported “Successfully sent ePrescription and verified.”
The saved prescription is `sent`, attempts 1, with the same medication PK and
transaction. The patient saw the successful pharmacy page and received the
normal sent notice; the physician rail displayed Sent with its timestamp.
These are actual sandbox transactions for a synthetic patient, not dispensing
of medication to a real person. Cancellation and API/frame results are
recorded separately when their final outcomes are known.

A genuine NewRx webhook, notification `0f703821-4d6e-42e6-b395-8fd6d4f655be`,
was applied at 05:46 UTC on 2026-10-14 and drove the successful vendor status
verification. The physician then revoked the sent synthetic prescription through
the normal portal. Cancellation request transaction
`1c738eb7-0425-47f4-905b-732dbe9a7f3f`, tracking
`c662ed11-1067-4e33-9731-6773a4f94afd`, returned HTTP 200/business `SUCCESS`
at 06:04 UTC. The UI accurately displays “Cancellation sent — waiting for
Shollenberger Pharmacy's answer.” The ordinary 06:15 poll and cancel sweep
completed without failure, with empty queues and dead-letter queues. No
second cancellation was sent. Final pharmacy approval/denial remains unverified.

The supported SDK additionally created adult REST consultation `V-adOHbF-rak`
and issued coded prescription `RW32-M_vlN0q` with HTTP 201. Live controlled
and uncoded requests were refused, initial address collection was required,
normal address/geocoding and Shollenberger selection succeeded, and the
prescription reached genuine `sent` with its patient transcript notice.
The separate untouched platform prescription `QiawwuUFiHs8` returned the same
eight pharmacy IDs through public GraphQL and authenticated patient-frame API.
A real Chrome parent on port 6197 used the SDK middleware and loader,
browser-generated frame key, sealed grant and scoped patient session. Its
actual frame displayed the owned consultation, genuine transcript and eight
pharmacies, including reachable Shollenberger. This is browser evidence in
addition to direct API parity. The parity prescription was left unchosen.
The original child fixtures and birthdates were preserved. All recorded
temporary sessions were revoked, the exact partner app was suspended, the
former key returned 401 after the authorizer cache interval, the complete
tenant profile and original product flags were verified unchanged, and the
owned local parent server stopped. No active temporary access was left behind.

The official guide requires sharing a sent medication PK with LogiCoy so they
can trigger Change and Renewal requests through Surescripts Messenger
(sections 14–15, PDF pages 66–67 and 85–86). It provides no deterministic
negative-pharmacy fixture, automatic cancel-decision trigger, or fill trigger.
No arbitrary negative send was made. Failure/re-choice, final cancellation
response, Change, Renewal, Fill, patient-app parity and production certification
remain unverified. These external/manual gates are distinct from the successful
adult sandbox send, notification processing, REST and browser-frame checks.

Genuine physician-authenticated deployed drug searches succeeded for
lisinopril 10 MG tablets and controlled oxycodone. Exact NDC `60687032511`
returned one matching package. Actual source/SDK pharmacy searches reached
Shollenberger, NCPDP `1655458`, network ID `811873`, and advertised new,
cancel, change, refill and fill services. Google geocoding with key version 2
succeeded at `38.2300388/-122.5958932`, ZIP 94954; shared distance ranking
placed it 1.9 km from the configured public test origin. Repeated search
reused the trusted coordinates without further geocoding, cached resolution
made no vendor call, and a fresh NCPDP/ZIP lookup succeeded. These checks
do not prove public-web, embed, patient-app or partner REST parity. No
production certification or BAA approval has been recorded.

Private synthetic credentials and diagnostics are ignored, mode 0600, under
`.amplify/artifacts/logicoy-integration/`. The registration retry, vendor
portal screenshots, and read-only drug/pharmacy checks are saved privately
under `/Users/nate/.codex/recovery-backups/logicoy-rollout-20261012/live-verification/`.
The original implementation plan,
including probe fixtures and vendor references, is privately archived outside
the repository at
`/Users/nate/.codex/recovery-backups/logicoy/implementation-plan-20261011.tgz`.
No passwords or private keys belong in this runbook, logs, commits, or support
mail. All work relating to the retired sibling integration is out of scope.

## Source gates

Run from the checkout holding the final candidate. Use the pinned compilers by path; the
ordinary hoisted `tsc` is not the backend compiler.

```bash
npm run lint
npm run build
npm run typecheck:backend
node node_modules/@aws-amplify/backend-deployer/node_modules/typescript/bin/tsc -p amplify/tsconfig.json --noEmit
npm run typecheck:scripts
npm run typecheck:provider-embed-harness
npm run demo:typecheck
npm --prefix mobile-apps/patient-app run typecheck
npm --prefix packages/natzar-client run typecheck
npm --prefix packages/natzar-client run typecheck:examples
node packages/natzar-client/scripts/sync-contract.mjs --check
npm run docs:api
node node_modules/@dotenvx/dotenvx/src/cli/dotenvx.js run --env-file=.env.local -- npm run build:embed
npm run secrets:check -- source
```

Run each suite once on the final source: `test:prescriptions`, `test:partner`,
`test:provider-embed`, `test:embed`, `test:secrets`, `test:shared`,
`test:patient-frame`, `test:mobile`, `test:action-plan`, `test:data`,
`test:services`, `test:email`, `test:deploy-audit`, `test:logicoy-scripts`,
and the SDK's `npm test`.
Changes to notifications also require `test:messaging` and `test:async`.

The generated CloudFormation gate requires FunctionDirectiveStack to remain
387 resources, every API/custom-resource stack under 500, the production
reference data template at most 990,000 bytes, and an acyclic nested-stack
dependency graph. Check the synthesized environment and bundles:

```bash
npm run secrets:check -- env-bytes --cdk-out .amplify/artifacts/cdk.out
npx tsx scripts/logicoy/check-bundles.ts --cdk-out .amplify/artifacts/cdk.out
```

Only `prescriptions` may bundle the vendor SDK or receive the LogiCoy private
key and webhook secret. The server geocoding key is shared with
`pharmacy-directory-sync` as defined by the secrets catalog. The four gateway
callers receive only its function name and invoke grant for vendor access. Target every function at
3500 environment bytes; none may exceed 4096. The live partner-api baseline
before gateway deployment is 2619 bytes and must not grow.

## Offline evidence for the completed source

The managed `logicoy-erx` checkout passed lint and frontend/embed builds;
both backend compilers (TS7 and deployer TS5.8), scripts, provider-harness,
demo, mobile, SDK and SDK-example checks use the pinned toolchain and passed.
The deployed source and live wiring results are recorded above.

The 2026-10-13 corrections additionally passed 1,749 prescription, shared,
public-pharmacy and patient-embed regression tests, scoped lint, frontend
typechecking and bundling, SDK contract synchronization, and 26 guarded
smoke-runner tests with scripts typechecking. The DOB cutoff and blocked-send
feedback also passed independent source review. These offline checks do not
turn the vendor's live `patient_add` rejection into a successful send.
The final under-18 guard and nested HTTP diagnostics additionally passed
1,584 prescription tests, focused adapter and copy regressions, frontend and
backend native typechecks, scoped lint, and the source-secret scan. Full
provider-frame regression passed 2,556 tests with one existing skip; action-plan
regression passed 238 tests. The final catalog synchronization passed 32
locale tests, the full partner suite (917 passed, one existing skip), and the
normal embed build.
Both current backend compiler checks also passed (native TS7 and deployer
TS5.8), followed by the deployment's own successful type check. Sixteen
ordinary polls from 15:45 through 19:30 UTC completed at 15-minute intervals
without enqueue failures. None created an owned medication or send checkpoint
for the rejected prescription.

| Suite | Passing tests | Skipped |
| --- | ---: | ---: |
| Prescriptions | 1564 | 0 |
| Action plan / portal prescribing | 232 | 0 |
| Partner API / contract | 916 | 1 |
| Provider embed | 2560 | 1 |
| SDK 0.20 | 414 | 17 |
| Shared | 624 | 0 |
| Services | 310 | 0 |
| Data | 39 | 0 |
| Secrets | 307 | 0 |
| Messaging | 994 | 0 |
| Async | 310 | 0 |
| Patient embed | 129 | 0 |
| Patient frame | 175 | 0 |
| Mobile | 175 | 0 |
| Email | 9 | 0 |
| Deployment/removal audit | 46 | 0 |
| Guarded sandbox smoke script | 26 | 0 |

Skipped tests remain the existing optional/integration cases; they do not
count as live proof. The independent review found and fixed the actual
partner/provider core adapter's `erx` registration mapping, successful issue
HTTP 201, and request-count deadline propagation. Regression tests exercise
those boundaries alongside the real core's registration/coding tests.

The production-reference synth has 49 templates, data template 869,531 bytes,
FunctionDirectiveStack 387 resources, API stack 388, customResources 44 and
no dependency cycle. All 69 synthesized functions have estimated environment
bounds below 3500 bytes. The SDK appears only in prescriptions; each gateway
caller bundle has one axios core. Source secret scanning reported zero
findings, and the eight generated-output paths had zero outgoing-vendor hits.
The plan was archived privately, removed from the checkout, and the removal
test's exception list is empty and enforced to stay empty.

## Deployment gate

The owner authorized this agent to deploy and operate sandbox `nate` using
profile `natzar`. Production and hosted rollout require their own live gates
and environment-specific vendor applications. Check account, region,
namespace, current release, and replacements before each sandbox deployment.

```bash
npm run sandbox:deploy -- --identifier nate --profile natzar --region us-east-1 --diff --stop-on-replacement
```

Do not claim deployed source from synthesis alone. Verify the resulting
release is active, its lock is released, CloudFormation is complete, and the
ordinary scheduler still polls every 15 minutes. Re-measure live environment
bytes using the same profile after deployment. A sandbox model GSI change can
recreate its table; back up any needed fixture before such a change.

## Live prerequisites and smoke

1. Obtain a successful fresh practice creation for the owned fixture. Retry
   through the supported setup UI after the vendor identifies or fixes the
   failure; preserve ambiguous registration state and correlation IDs.
2. Register the fixture's own location and NON_EPCS clinician. Historical
   practice/location/clinician IDs are references, never deployment routing.
3. Start ID.me from our portal and complete its browser return. A vendor status
   alone cannot substitute for app-initiated proof. The saved proof now expires
   on 2026-10-23, making 2026-10-21 UTC the last issue day under the two-day
   margin. Obtain a renewed persona if testing runs later. For the supplied
   sandbox persona, follow `ID.me.docx`: Code Generator, default authenticator,
   then Continue with its system-generated value unchanged.
4. Use a synthetic patient, reserved phone, and app messaging channel. Enable
   async consults and physician REST for the fixture tenant, provide a complete
   default US Clinic, and provision a sandbox-only partner credential.
5. Check readiness before any clinical writes. Test pharmacy 811873 is
   Shollenberger, NCPDP 1655458, Petaluma CA 94954.

`logicoy:smoke` defaults to read-only preflight. Its private external manifest
pins sandbox `nate`, the API URL, synthetic patient/physician IDs and their
external IDs. Full automated checks also require an address-confirmed,
choosable portal-origin prescription, its DOB, the sandbox AppSync URL and
private credential-file paths for public web and patient embed. Partner-origin
prescriptions cannot serve as the public-web parity fixture. Configure
`NATZAR_API_URL`, `NATZAR_SMOKE_API_KEY` and optional
`NATZAR_SMOKE_PHYSICIAN_TOKEN` in the shell; never commit their values.
For a portal-created physician without a partner mapping, omit
`physicianExternalId` and supply their genuine Cognito token. The runner
forwards it on the profile read and requires the API to return the exact
pinned physician ID with an empty external ID. An asserted physician ID
cannot substitute for that token. The patient still requires its real partner
mapping. Use a separate synthetic patient for the portal-origin parity
prescription so confirming its address does not bypass the REST smoke's
initial address-collection assertion.

```bash
npm run logicoy:smoke -- --config /private/path/smoke.json
npm run logicoy:smoke -- --config /private/path/smoke.json --apply
```

`--apply` creates/claims a synthetic consultation if needed, issues one
prescription and tests coding refusals. A second prescription for
pharmacy-failure/re-choice requires an explicit vendor-confirmed negative
destination in the manifest:
`negativePharmacyFixture: {directoryId: "us:ncpdp:…", vendorConfirmed: true}`.
Without it, that scenario is reported as not exercised and full automated
completion remains false; an arbitrary reachable pharmacy is not a negative
fixture.
It uses no automatic issuance retry, requires genuine `status: sent`, and
bounds notification/transcript polling. Patient-app parity, medication PKs,
certification screenshots and vendor agreements remain manual evidence.

Execute the platform smoke with SDK 0.20.0 and shell-only credentials. It must
check readiness, claim a synthetic consult, search lisinopril 10 MG tablets,
search oxycodone and reject its controlled package, verify exact 11-digit NDC
lookup, and issue one coded prescription. An uncoded line must return
`invalid_request` / `item_not_coded`; a controlled package must return
`controlled_substance` with the offending item index.

Collect a delivery address at 2002 S McDowell Blvd Ext, Petaluma CA 94954,
coordinates 38.2425/-122.6106. Verify the reachable test pharmacy, choose it,
and wait up to 20 minutes for `sent` through ordinary scheduled notification
polling. With a valid geocoding key, verify coordinates and distance below
3 km. Record the sent transcript notice, medication PK, send transaction,
and tracking ID. A failure at another pharmacy followed by a new choice is
an explicit live assertion; do not assume that its refusal is pharmacy-scoped.
Compare sets of pharmacy IDs across public web and patient embed, because
cached pins can change ordering. Check the patient app separately.

The Change/Renewal sink must be deployed before requesting vendor-triggered
events. Only the named physician may answer; the admin view is read-only.
Confirm both Change and Renewal ingestion, details, deadlines, responses,
request badge updates, due-soon notice, and linked rail/partner event. A send
with uncertain delivery must retain the complete original wire for an
explicit identical resend; it must not accept an edited answer.

## Certification evidence

Every row needs dated evidence and a screenshot where relevant. Vendor
exceptions require written agreement; absence of an implemented feature is
not an agreed exception.

| Scenario | Required evidence | Current live status |
| --- | --- | --- |
| S1 Practice add | Practice ID and creating transaction | Passed supported portal retry; vendor portal confirms success |
| S2 Location add | Owned location ID and transaction | Passed; fresh owned ID saved |
| S3 Clinician add | Owned clinician ID; agreed NON_EPCS scope | Registration passed; scope agreement pending |
| S4 ID.me initiate/browser/return/check | App proof, verified badge and expiry | Passed genuine app return; proof saved; verified through 2026-10-23 |
| S5 Patient add | Vendor patient ID from actual transmit | Adult passed; minor required-vitals refusal diagnosed and guarded |
| S6 Pharmacy search | Web/embed/app test-pharmacy evidence | Public/API/frame parity passed (8 IDs); patient-app pending |
| S7 Drug name search | Portal, REST, and frame evidence | Genuine physician portal and SDK REST passed |
| S8 NDC search | Exact package and transaction | Deployed exact NDC lookup passed |
| S9 Draft add | Medication PK and transaction | Adult portal/public flow passed; IDs recorded above |
| S10 Send | Sent state, medication PK, send transaction/tracking ID | Adult portal/public flow passed, vendor status verified and patient notified |
| S11 Cancel | Requested then genuine Approved/Denied result | Request accepted, pending pharmacy decision |
| S12 Change | APPROVED, DENIED AA, APPROVED_WITH_CHANGES | Pending vendor triggers |
| S13 Renewal | APPROVED, APPROVED_WITH_CHANGES, DENIED AF, REPLACE | Pending vendor triggers |
| Fill | Genuine DISPENSED event and rail chip | Pending vendor trigger |
| S14 History / EPCS / MFA | Written reduced-scope agreement | Pending vendor agreement |

CloudWatch Logs Insights, in the prescriptions log group:

```text
fields @timestamp, op, transactionUuid, messageId, httpStatus, errorCode, medicationPk
| filter event = "logicoy_call" and medicationPk in ["<pk1>", "<pk2>"]
| sort @timestamp asc
```

```text
fields @timestamp, event, group, practiceId, locationId, practitionerId, clinicianId, transactionUuid, messageId
| filter event in ["logicoy_practice_created", "logicoy_location_created", "logicoy_clinician_registered"]
| sort @timestamp asc
```

The owner sends vendor-trigger requests to `erx.support@logicoy.com`; this
agent has no authorization to send them. Include the environment's client
and registration IDs, requested event, medication PK, original send
transaction, clinician/practice/location/patient IDs, pharmacy 811873 /
NCPDP 1655458, and sent UTC time. Include only the minimum synthetic evidence.

## Hosted rollout and credential cleanup

Dev, stage, and production each need their own vendor app, RSA key pair, and
webhook. Do not share the sandbox private key or webhook registration with
another namespace. Confirm production host/IP requirements, notification
scope, retry policy, rate limits, disabled-clinician behavior, identity
renewal, reduced certification scope, and the BAA before production use.
The Amplify console build specifications can override `amplify.yml`; check
each branch's actual specification and plain settings. Placeholder fax
settings must not advertise Canadian prescribing as ready.

Retire obsolete credentials only after the replacement release is successful
and retained rollback slots no longer pin their versions. The 2026-10-12 audit
found that retained `rb3` release `r-20261009T115003Z-aef5b209` originally
referenced the two outgoing credentials' versions 1 and 2. The current slot
records omit those original references, while the versions still carry all
five protection labels. Omission is not retirement clearance: preserve the
archived references until that release naturally leaves retention.

Reconcile both original references and label drift before retirement. The
tool's catalog must recognize the union of retained current and outgoing
names; a plain historical checkout's strict parser rejects current LogiCoy
names and cannot safely perform this cleanup. Never delete SSM parameters
directly or discard rollback labels to bypass the guard. Original metadata
is preserved privately in
`/Users/nate/.codex/recovery-backups/logicoy/nate-state-2026-10-10T18-56-19-233Z.json`.
After safe retirement, remove obsolete console settings/subscriptions/clients
in each affected namespace. Keep this operational cleanup pending until its
actual release and retention preconditions hold.
