# Triage #3604

**Verdict:** inconclusive: requires a license  
**Confidence:** high for the observations, low for the production cause

## Environment

The latest instance was already running; it reports 1.71.1. The 1.71.0
instance was started for this investigation. Both use a separate database on
PostgreSQL 16 and separate OpenSearch 2.11.0 instances, development runtime
mode, a single node, HTTP on localhost, and the default `All` proxy trust
policy. Neither has a paid license. The reported installation instead uses
production mode, database search, an HTTPS proxy chain, `OnlyConfigured` proxy
trust and two isolated nodes sharing a database. No SAML IdP was configured.

Assigning the password-only form to an application requires a license in both
test versions. Therefore the following unlicensed baseline exercises the
callback but **does not reproduce the full reported configuration**. The
baseline also shows an incomplete-configuration notice because the application
has no self-service form assigned.

## Replication steps

Run these commands from the repository root with Docker and the globally
installed Playwright package and Chromium available. Use a disposable stack;
the script creates new forms, applications and users and does not delete them.
Supply the configured superuser key and a password suitable for a disposable
test user as environment variables; do not use production credentials.

1. Check the already-running latest instance:
   `curl -s -H "Authorization: $API_KEY" http://localhost:9011/api/system-configuration`.
   Check its version with
   `curl -s http://localhost:9011/api/system/version`.
2. Start the reported version:
   `REPORTED_VERSION=1.71.0 docker compose -p triage -f .github/triage/docker-compose.yml --profile reported up -d fusionauth-reported`.
   Wait until `curl -s -H "Authorization: $API_KEY" http://localhost:9012/api/system-configuration`
   returns HTTP 200; `curl -s http://localhost:9012/api/system/version` reports 1.71.0.
3. Set `API_KEY` and `TEST_PASSWORD` in the environment, then run, in order:
   ```
   export NODE_PATH="$(npm root -g)"
   node triage/issue-3604/repro.cjs 9012
   node triage/issue-3604/repro.cjs 9011
   ```
   For each port, the script makes the following API calls to
   `http://localhost:<port>`. All include `Authorization: $API_KEY`; POST
   requests also include `Content-Type: application/json`. IDs and email
   addresses marked with angle brackets are generated for that run:
   1. `GET /api/system/version` and `GET /api/form/field`; select the ID of
      `[Self Service User] password`.
   2. `POST /api/form` with
      `{"form":{"name":"Triage 3604 <random-uuid>","type":"selfServiceUser","steps":[{"type":"collectData","fields":["<password-field-id>"]}]}}`.
      Save the returned form ID.
   3. `POST /api/application` with
      `{"application":{"name":"Triage 3604 <random-uuid>","formConfiguration":{"selfServiceFormId":"<form-id>","selfServiceFormConfiguration":{"requireCurrentPasswordOnPasswordChange":true}},"oauthConfiguration":{"authorizedRedirectURLs":["http://localhost:<port>/account/login"],"enabledGrants":["authorization_code","refresh_token"],"generateRefreshTokens":true,"debug":true},"roles":[{"name":"user"}]}}`.
      Observe the 400 `[notLicensed]` error. Repeat the same POST with
      `selfServiceFormId` omitted, and save the returned application ID.
   4. `POST /api/user/registration` with
      `{"user":{"email":"triage-3604-<random-uuid>@example.com","password":"<TEST_PASSWORD>","verified":true},"registration":{"applicationId":"<application-id>","roles":["user"]}}`.
   5. In a fresh Chromium context, open
      `http://localhost:<port>/account/?client_id=<application-id>`, enter the
      generated email and test password, and click **Submit**. Record
      `/account/login` and `/oauth2/consent` response statuses, final path and
      page text. The script blocks requests outside the local origin.
   6. `POST /api/system/event-log/search` with
      `{"search":{"numberOfResults":100,"startRow":0,"orderBy":"insertInstant desc"}}`.
      Find an event containing both the application ID and
      `The authorization code has been successfully exchanged for an access token.`

## Results by version

| Version | Observation |
| --- | --- |
| 1.71.0 | Form assignment: 400 `[notLicensed]`. Baseline: consent 302, callback 200, `/account/`; matching successful exchange event. |
| 1.71.1 (latest) | Form assignment: 400 `[notLicensed]`. Baseline: consent 302, callback 200, `/account/`; matching successful exchange event. |

## Expected and actual

**Expected:** after a successful exchange, the account session opens for the
requested application. The reporter instead expects help identifying the cause
of a 401 and the apparent application-ID mismatch in their production setup.

**Actual:** both baselines exchanged the code successfully and returned 200
for the callback, then displayed `/account/` with
`Configuration is incomplete. The administrator must configure a form for this application.`
The licensed form and production topology were not tested. Consequently this
does not establish that the production failure is fixed or that it cannot
occur on latest.

The reporter's follow-up attributes their 401 to a debug message from
`FusionAuthUserLoginSecurityContext` stating that the expected application ID
was the built-in FusionAuth application ID rather than the requested client
ID. That is reporter-supplied evidence, not a local observation. It identifies
the failing validation in that capture but does not establish how the expected
ID was selected or whether node URL, proxy trust, runtime mode or inter-node
communication caused it. No definitive answer to those questions is available
from this reproduction.

The reporter says debug logging for `io.fusionauth` and
`org.primeframework.mvc` exposed the mismatch, using the Logging Level API;
this diagnostic was not independently tested here. Avoid sharing tokens,
cookies or production credentials in logs. The public
[configuration reference](https://fusionauth.io/docs/reference/configuration)
and [cluster guide](https://fusionauth.io/docs/operate/deploy/cluster) describe
the node URL's cluster-communication role, but do not establish its role in
this particular failure.

## Evidence

- `repro.cjs` creates the disposable data, drives the browser, and checks the
  corresponding OAuth event.
- `01-before-1.71.0.png` and `02-after-1.71.0.png`: reported version login
  and resulting account page.
- `01-before-1.71.1.png` and `02-after-1.71.1.png`: latest version login
  and resulting account page.
- Both runs logged `GET /oauth2/consent: 302`, `GET /account/login: 200`,
  `Final path: /account/`, and `Matching successful code-exchange event: true`.
  The console `net::ERR_FAILED` is from blocking non-local resources in the
  browser; it is not evidence of the reported authorization failure.
