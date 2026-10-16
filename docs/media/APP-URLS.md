# Canonical web app URLs

These are the platform app origins confirmed by the owner on 2026-10-06.
Use them for clinical app auth whitelists, invite links, SDK embed origins,
and mobile deep links.

| Environment | Residency zone | App origin |
|---|---|---|
| Local | US sandbox | `http://localhost:5173` |
| Dev | US | `https://app-dev.natzar.dev` |
| Stage | US | `https://app-stage.natzar.dev` |
| Production | US | `https://app.natzar.ai` |
| Production | Canada | `https://app.ca.natzar.ai` |

Canada dev/stage and EU app origins are not configured. Do not construct them
by combining environment or zone prefixes, or send those zones to a US app
as a fallback. Configure a new origin explicitly before enabling its links.
This table specifies canonical addresses; it does not certify DNS, TLS, or
backend deployment status.

The code source is `shared/partner-api/app-origins.ts`. The SDK gets a generated
copy through `packages/natzar-client/scripts/sync-contract.mjs`. Backend invite
links and fleet console links use the same registry. The mobile app explicitly
lists these hosted origins in `mobile-apps/patient-app/app.json`.

## REST API hosts

| Environment | Residency zone | REST base | Hosted zone |
|---|---|---|---|
| Local | US sandbox | `https://api-<developer>.natzar.dev/v1` (`VITE_DEVELOPER`; another zone: `api-<developer>.<zone>.natzar.dev`) | `natzar.dev` |
| Dev | US | `https://api-dev.natzar.dev/v1` | `natzar.dev` |
| Stage | US | `https://api-stage.natzar.dev/v1` | `natzar.dev` |
| Production | US | `https://api.natzar.ai/v1` | `natzar.ai` |
| Production | Canada | `https://api.ca.natzar.ai/v1` | `natzar.ai` |

Register vendor webhooks (Stripe, Telnyx, Meta, LogiCoy) and give partners
these hosts, never the execute-api URL: they survive a rebuilt backend.

Every deploy registers its own host. The api-stack creates an ACM
certificate in the API's region, DNS-validated in the hosted zone; a
regional API Gateway custom domain (TLS 1.2); a single base path mapping
`v1` → stage `v1`; and a Route 53 alias A record. Deleting the backend
removes them. The code is in `amplify/api-domain.ts`. The hosts are listed in
`PLATFORM_API_ORIGINS` in `shared/partner-api/app-origins.ts`, which the SDK
ships as its built-in `baseUrl`s. `amplify_outputs.json` `custom.API`
reports the public `endpoint` and webhook URLs on this host, and keeps
`executeApiEndpoint` for the deploy scripts' ownership checks.

The deploy **creates** the record and never overwrites one. If another
record already exists at an API host, CloudFormation fails the api-stack.
Delete the stale record and redeploy. For a new API host, add it to
`PLATFORM_API_ORIGINS`. Its hosted zone must be in `PUBLIC_HOSTED_ZONES`
(`amplify/api-domain.ts`) and in the same account as the deployment.

Intake (`checkup`) and dedicated patient/clinician embed frame hosts have their
own configuration. Their zone prefixes do not define the web app hostname.
White-label hosts retain their configured naming; they also need DNS, TLS,
auth whitelists, and mobile association files where applicable.

## US e-prescribing routes

| Route | Purpose |
| --- | --- |
| `/v1/webhooks/logicoy/{proxy+}` | LogiCoy event paths under the public API host; static webhook header required. |
| `/v1/erx/idme/{nonce}` | Single-use ID.me return; resolves the hashed nonce and redirects to the configured app. |
| `/portal/erx/idme` | Portal return page that refreshes the physician's setup status. |
| `/portal/pharmacy-requests` | Named physician's Change/Renewal inbox; tenant administrators have a read-only view. |

Use the environment's `logicoyWebhookUrl` output for vendor registration.
Every hosted environment needs its own LogiCoy application and key; the
sandbox registration does not certify a hosted deployment. See
[LogiCoy setup](LOGICOY-SANDBOX-SETUP.md).

DNS exports in `docs/dns/` are dated migration evidence, not app URL defaults.
