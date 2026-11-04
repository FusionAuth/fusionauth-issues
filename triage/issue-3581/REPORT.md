# Triage #3581: confirmed

Relates to #3581.

**Verdict:** confirmed

**Confidence:** high

## Environment

Tested on 2026-11-04 using public Docker images and the repository's existing
`/home/runner/work/fusionauth-issues/fusionauth-issues/.github/triage/docker-compose.yml`.

| Instance | Version from API | Initial state | Database | Search |
| --- | --- | --- | --- | --- |
| `http://localhost:9012` | 1.69.4 | Not running; started for this test | PostgreSQL 16.15, `fa_reported` | Separate OpenSearch 2.11.0 |
| `http://localhost:9011` | 1.70.0 (`latest`) | Already running and API-ready | PostgreSQL 16.15, `fa_latest` | Separate OpenSearch 2.11.0 |

Both use development runtime mode, the built-in theme, and the existing Compose
kickstart configuration. No application, user, tenant, theme, or webhook was created
or modified for this reproduction. No paid license was needed.

Image digests:

- 1.69.4: `sha256:830efe2c5ba263b4145dd8a5579022f1c0781ae9d01c9f31a40f24074800234c`
- latest: `sha256:525cc1bda141ee6a0d4e62c689acb3f24aefd0ec1802954d464ac17990bcc565`

## Replication steps

1. Use the existing triage Compose configuration and set `API_KEY` to its local
   superuser API key without writing it into a file. Check the existing latest instance:

   ```sh
   export API_KEY='<local superuser API key>'
   cd /home/runner/work/fusionauth-issues/fusionauth-issues
   curl -fsS -H "Authorization: $API_KEY" http://localhost:9011/api/system-configuration
   ```

   This returned HTTP 200; latest did not need starting.

2. Start the reported version, then wait for its system configuration API to return
   HTTP 200 (poll every five seconds, up to five minutes):

   ```sh
   REPORTED_VERSION=1.69.4 docker compose -p triage \
     -f /home/runner/work/fusionauth-issues/fusionauth-issues/.github/triage/docker-compose.yml \
     --profile reported up -d fusionauth-reported
   curl -fsS -H "Authorization: $API_KEY" http://localhost:9012/api/system-configuration
   ```

   The image pulled and the instance became ready. Verify actual versions:

   ```sh
   curl -fsS -H "Authorization: $API_KEY" http://localhost:9012/api/system/version
   curl -fsS -H "Authorization: $API_KEY" http://localhost:9011/api/system/version
   docker exec triage-db-1 psql -U postgres -Atc 'SELECT version();'
   docker exec triage-search-reported-1 curl -s http://localhost:9200/
   docker exec triage-search-latest-1 curl -s http://localhost:9200/
   docker image inspect fusionauth/fusionauth-app:1.69.4 fusionauth/fusionauth-app:latest \
     --format '{{json .RepoTags}} {{json .RepoDigests}}'
   ```

3. Test 1.69.4 first. Set `BASE=http://localhost:9012`. Before **each** OAuth
   request in step 4, obtain the existing event IDs:

   ```sh
   BASE=http://localhost:9012
   curl -fsS -H "Authorization: $API_KEY" \
     "$BASE/api/system/event-log/search?numberOfResults=1000&startRow=0&orderBy=insertInstant%20DESC"
   ```

   This is a GET with no JSON body. On this isolated instance, the newest 1,000
   events cover all events generated during testing.

4. Send these four GET requests, one at a time, without an Authorization header,
   cookies, request body, or redirect following. Repeat the event search from step 3
   immediately after **each** request; compare event IDs and count new `Error` events
   whose message contains `A FreeMarker exception occurred`.

   ```sh
   curl -sS -i "$BASE/oauth2/register"
   curl -sS -i "$BASE/oauth2/register?resource%5B-1%5D=x"
   curl -sS -i "$BASE/oauth2/authorize"
   curl -sS -i "$BASE/oauth2/authorize?resource%5B-1%5D=x"
   ```

   The bare URLs are controls, not valid complete OAuth flows. They return the
   standard error page without template exceptions. The malformed URLs require
   no additional application or OAuth configuration.

5. Repeat steps 3–4 with `BASE=http://localhost:9011` for latest, using precisely
   the same requests and event-ID comparison.

6. For browser evidence, launch Chromium with `args: ['--no-sandbox']` and a
   1280 × 900 viewport. On each version, navigate directly to
   `/oauth2/register?resource%5B-1%5D=x` and then
   `/oauth2/authorize?resource%5B-1%5D=x` in separate fresh pages. No clicks or
   login are necessary. Wait for `networkidle`; record the navigation status,
   final URL, title, body text, form count, console errors, and a full-page
   screenshot. Bracket each navigation with the same event-log searches.
   These browser visits are additional requests, not included in the HTTP
   request counts in the table below.

7. The supplied script automates steps 3–6, obtains versions with
   `GET /api/system/version`, and writes `results.json` and the four screenshots.
   It tests the reported version before latest. Run with the preinstalled
   Playwright and Chromium:

   ```sh
   export NODE_PATH=$(npm root -g)
   node --check /home/runner/work/fusionauth-issues/fusionauth-issues/triage/issue-3581/repro.cjs
   node /home/runner/work/fusionauth-issues/fusionauth-issues/triage/issue-3581/repro.cjs
   ```

   `API_KEY` must still be exported. The script issues only GET requests, saves
   no API key or cookies, and deliberately does not save raw HTML containing
   generated form tokens. It does create event-log errors by reproducing the bug.

## Results by version

Counts are newly observed FreeMarker `Error` events per individual HTTP request.

| Version | Bare `/register` and `/authorize` controls | Malformed `/register` | Malformed `/authorize` |
| --- | --- | --- | --- |
| 1.69.4 | Both HTTP 200, title `Error`, no form, 0 events | HTTP 200, title `Register`, form present, **6 errors** | HTTP 200, title `Login`, form present, **3 errors** |
| 1.70.0 (latest) | Both HTTP 200, title `Error`, no form, 0 events | HTTP 200, title `Register`, form present, **6 errors** | HTTP 200, title `Login`, form present, **3 errors** |

Browser visits independently produced the same 6/3 error counts on each version,
with one form per page, no redirect, and no browser console/page errors.

## Expected

An unbindable parameter should yield HTTP 400 or a standard error page rather
than rendering an OAuth form against missing state. It should not generate
multiple FreeMarker exception events for a single rejected request.

## Actual

The malformed requests return HTTP 200 and OAuth forms containing template error
text, rather than the standard error page observed for the controls.
The browser body includes:

```text
A FreeMarker exception occurred. See the FusionAuth Event Log for additional details.
You requested an invalid number of items in a collection ([-1]).
You must supply a positive integer up to [10000].
```

Representative event-log excerpts from 1.69.4:

```text
A FreeMarker exception occurred.
When calling macro "alternativeLogins", required parameter "clientId" (parameter #1)
was specified, but had null/missing value.

Caused by: java.lang.NullPointerException: Cannot invoke
"io.fusionauth.app.service.user.RegistrationState.getStepIndex()"
because "this.registrationState" is null
at io.fusionauth.app.action.oauth2.BaseRegisterAction.getStep(BaseRegisterAction.java:146)
```

Latest still records the same registration-state exception. Its alternative-login
expressions instead report the missing `application` directly, for example:

```text
A FreeMarker exception occurred.
The following has evaluated to null or missing:
==> application  [in template "templates/oauth2/authorize.ftl" at line 122, column 44]
```

This confirms the core externally observable failure and null-state exceptions.
The test observed six registration errors, not seven. It did not independently
test custom-theme selection/query ordering, event-log webhooks, production daily
volumes, or the suggested theme workaround. No FusionAuth source is available
here to prove which internal setup methods were skipped. Development mode exposes
exception details in the page; production-mode page presentation was not tested.

## Evidence

- `repro.cjs`: runnable HTTP/browser reproduction, including event-ID comparisons.
- `results.json`: response metadata, visible browser text, event counts, and
  trimmed event messages with selected relevant stack-trace lines.
- `01-1.69.4-register.png`: reported-version registration page with template errors.
- `02-1.69.4-authorize.png`: reported-version login page with template errors.
- `03-1.70.0-register.png`: latest registration page with missing application and
  registration-state errors.
- `04-1.70.0-authorize.png`: latest login page with missing application errors.

There were no screenshots attached to the issue to compare against. Existing
instance-activation DNS errors were present before testing and excluded by
event-ID comparison; none was counted as a FreeMarker error.
