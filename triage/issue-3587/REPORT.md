# Triage #3587: confirmed

Relates to #3587.

**Verdict:** confirmed

**Confidence:** high

The reported null-state registration failure reproduces on both 1.69.4 and
latest (1.70.0). This is triage only; no FusionAuth application code was changed.

## Environment

Tested on 2026-11-04 using public `fusionauth/fusionauth-app` Docker images.

| Instance | Version from `GET /api/status` | Startup | Database | Search |
|---|---|---|---|---|
| `http://localhost:9012` | 1.69.4 | Started for this triage; image pulled successfully | PostgreSQL 16.15, `fa_reported` | Dedicated OpenSearch 2.11.0 |
| `http://localhost:9011` | 1.70.0 (`latest`) | Already running; initial authenticated system-configuration request succeeded | PostgreSQL 16.15, `fa_latest` | Dedicated OpenSearch 2.11.0 |

Both instances use development mode, the default tenant/theme, basic self-service
registration, and no paid license. The database server is shared, but databases
and search instances are separate. The reporter's MySQL 8.0 environment was not
tested. No issue screenshots were attached.

## Replication steps

Prerequisites: Docker Compose, curl, jq, Python 3; for screenshots, the environment's
preinstalled Playwright package and Chromium. Set `API_KEY` to the environment's
superuser key; it is deliberately not included in committed files.

1. Check the already-running latest instance:

   ```bash
   export API_KEY='<environment superuser API key>'
   curl -fsS -H "Authorization: $API_KEY" \
     http://localhost:9011/api/system-configuration
   ```

   This returned HTTP 200; latest did not need starting.

2. Start the reported version, then wait for its authenticated health check:

   ```bash
   REPORTED_VERSION=1.69.4 docker compose -p triage \
     -f /home/runner/work/fusionauth-issues/fusionauth-issues/.github/triage/docker-compose.yml \
     --profile reported up -d fusionauth-reported

   for attempt in $(seq 1 60); do
     if curl -fsS --max-time 3 -H "Authorization: $API_KEY" \
       http://localhost:9012/api/system-configuration >/dev/null; then
       break
     fi
     sleep 5
   done
   ```

3. Perform steps 3–6 first with `FA=http://localhost:9012`, then with
   `FA=http://localhost:9011`. Obtain version and default tenant ID:

   ```bash
   FA=http://localhost:9012
   curl -fsS -H "Authorization: $API_KEY" "$FA/api/status" | jq .version
   TENANT_ID=$(curl -fsS -H "Authorization: $API_KEY" "$FA/api/tenant" |
     jq -r '.tenants[] | select(.name == "Default") | .id')
   APP_ID=35873587-3587-4587-8587-358735873587
   ```

   Observed default tenant IDs were
   `ffe707be-b623-4f0a-bc7d-4ed77b421097` on 1.69.4 and
   `52d29162-65b9-4a86-92c3-ecafa213f9b8` on 1.70.0.
   These GET requests have no request body.

4. Create an isolated application with self-service registration enabled.
   The reproduction script first sends
   `GET $FA/api/application/$APP_ID` with `Authorization: $API_KEY`;
   on a fresh instance this returns 404. Then send:

   ```bash
   curl -fsS -X POST -H "Authorization: $API_KEY" \
     -H 'Content-Type: application/json' \
     "$FA/api/application/$APP_ID" \
     --data "$(jq -n --arg tenant "$TENANT_ID" '{
       application: {
         name: "Issue 3587 registration triage",
         tenantId: $tenant,
         oauthConfiguration: {
           authorizedRedirectURLs: ["http://localhost:8080/callback"],
           enabledGrants: ["authorization_code"],
           requireRegistration: true
         },
         registrationConfiguration: {
           enabled: true,
           type: "basic",
           loginIdType: "email"
         }
       }
     }')"
   ```

   This succeeded on both instances. On subsequent runs skip POST if the
   application GET returns 200. The script reuses this application's configuration;
   use a clean instance or verify its configuration if reusing the ID elsewhere.
   No user account is created by setup.

5. Define the shared OAuth parameters and synthetic test fields:

   ```bash
   Q="client_id=$APP_ID&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&response_type=code&scope=openid&code_challenge=abcdefghijklmnopqrstuvwxyzabcdefghijklmnopq&code_challenge_method=S256&state=x"
   FIELDS=$(python3 -c 'import urllib.parse; print(urllib.parse.urlencode({
     "user.email": "a@example.com",
     "user.password": "Triage-" + "35873587-3587-4587-8587-358735873587" + "!"
   }))')
   ```

   The password is only synthetic test input derived from the public application
   ID, not a credential for any account. No callback listener is needed; none of
   these requests redirects to it.

6. Make these seven requests in order. Do not retain cookies between requests or
   supply a registration state from a previous response. Hosted-page requests do
   not use the API key. POST bodies are form-encoded; GET requests have no body.

   ```bash
   # Baseline GET.
   curl -sS -o /dev/null -w '%{http_code}\n' "$FA/oauth2/register?$Q"
   # Prefilled GETs with no registration state.
   curl -sS -o /dev/null -w '%{http_code}\n' \
     "$FA/oauth2/register?$Q&user.email=prefill%40example.com"
   curl -sS -o /dev/null -w '%{http_code}\n' \
     "$FA/oauth2/register?$Q&user.firstName=Max"
   # Direct POST with user fields and no registration state.
   curl -sS -o /dev/null -w '%{http_code}\n' \
     "$FA/oauth2/register" --data "$Q&$FIELDS"
   # Invalid-state POST with user fields.
   curl -sS -o /dev/null -w '%{http_code}\n' \
     "$FA/oauth2/register" --data "$Q&$FIELDS&registrationState=garbage"
   # Invalid-state POST without user fields.
   curl -sS -o /dev/null -w '%{http_code}\n' \
     "$FA/oauth2/register" --data "$Q&registrationState=garbage"
   # Control POST without state or user fields.
   curl -sS -o /dev/null -w '%{http_code}\n' \
     "$FA/oauth2/register" --data "$Q"
   ```

   To read response bodies, omit `-o /dev/null`. The committed Python script sends
   this matrix and extracts the page title and presence of the error/form text.
   Actual script runs, including a repeat run to verify consistent results:

   ```bash
   python3 /home/runner/work/fusionauth-issues/fusionauth-issues/triage/issue-3587/repro.py \
     http://localhost:9012 \
     > /home/runner/work/fusionauth-issues/fusionauth-issues/triage/issue-3587/results-1.69.4.json
   python3 /home/runner/work/fusionauth-issues/fusionauth-issues/triage/issue-3587/repro.py \
     http://localhost:9011 \
     > /home/runner/work/fusionauth-issues/fusionauth-issues/triage/issue-3587/results-1.70.0.json
   ```

7. Capture browser evidence after API setup:

   ```bash
   export NODE_PATH=$(npm root -g)
   node /home/runner/work/fusionauth-issues/fusionauth-issues/triage/issue-3587/screenshots.cjs
   ```

   The script launches Chromium with `--no-sandbox`. It opens the step 6 baseline
   GET and then the email-prefilled GET in separate fresh browser contexts, on
   1.69.4 first and then 1.70.0. No UI clicks or login are necessary. It records
   status, URL, DOM body text and console messages and saves four screenshots.

8. Inspect server exceptions and verify infrastructure versions:

   ```bash
   docker ps --format '{{.Names}} {{.Image}} {{.Status}}'
   docker logs triage-fusionauth-reported-1 2>&1 |
     grep -A 9 -B 2 -E 'Cannot read field "user"|registrationState|garbage'
   docker logs triage-fusionauth-latest-1 2>&1 |
     grep -A 9 -B 2 -E 'Cannot read field "user"|registrationState|garbage'
   docker exec triage-db-1 psql -U postgres -Atc 'select version();'
   docker exec triage-search-latest-1 curl -s http://localhost:9200 |
     jq '{version: .version.number, distribution: .version.distribution}'
   ```

## Results by version

| Version | Normal GET / POST without user fields or state | GET with email / firstName | POST user fields, no state | POST garbage state, with / without user fields |
|---|---|---|---|---|
| 1.69.4 | 200 / 200, registration form | 500 / 500, NPE | 500, NPE | 500 / 500, generic error |
| 1.70.0 (latest) | 200 / 200, registration form | 500 / 500, NPE | 500, NPE | 500 / 500, generic error |

## Expected

Missing or invalid registration state should not cause an unhandled exception.
Requests should render an appropriate form/validation response or safely redirect
to the start of registration, rather than returning HTTP 500.

## Actual

The baseline page has title `Register`, an email input named `user.email`, and
DOM text including `Email *`, `Password *`, `Register`, and `Step 1 of 1`.

The no-state requests containing user fields return HTTP 500, title `Error`, no
registration form, and this DOM text (trimmed):

```text
An unexpected exception occurred.
Dismiss
Error
We're sorry, your request was malformed or was unable to be completed for some reason.
Try hitting the back button and restarting the process to see if it fixes the problem.
```

Garbage-state POSTs also return HTTP 500 and the generic `Error` page, but without
the `An unexpected exception occurred.` banner. The garbage-state outcome is
confirmed at the HTTP level only; no NPE is established for those requests.

Browser requests independently reproduced the 200-to-500 change on both versions.
Each failing browser navigation logged:

```text
console: error: Failed to load resource: the server responded with a status of 500 ()
```

## Evidence

All paths below are relative to this report:

- `repro.py`: runnable API setup and seven-request HTTP matrix, Python standard
  library only. Requires `API_KEY` in the environment.
- `results-1.69.4.json`, `results-1.70.0.json`: captured repeat-run HTTP status and
  response-content observations; identical statuses on the initial run.
- `screenshots.cjs`: runnable browser reproduction; requires the preinstalled
  Playwright/Chromium environment, but no API key.
- `01-1.69.4-before.png`: baseline registration form, HTTP 200.
- `02-1.69.4-after.png`: same query plus `user.email`, HTTP 500.
- `03-1.70.0-before.png`: latest baseline registration form, HTTP 200.
- `04-1.70.0-after.png`: latest query plus `user.email`, HTTP 500.

Key server log lines observed for the three no-state user-field cases:

```text
1.69.4 — 2026-11-04 03:29:19.457, 03:29:19.529, 03:29:19.538 AM
1.70.0 — 2026-11-04 03:29:20.055, 03:29:20.133, 03:29:20.139 AM
ERROR io.fusionauth.app.primeframework.error.ExceptionExceptionHandler - An unhandled exception was thrown
java.lang.NullPointerException: Cannot read field "user" because "this.registrationState" is null
    at io.fusionauth.app.action.oauth2.BaseRegisterAction.getUser(BaseRegisterAction.java:156)
    at org.primeframework.mvc.util.ReflectionUtils.invokeGetter(ReflectionUtils.java:495)
    at org.primeframework.mvc.parameter.el.MemberAccessor.get(MemberAccessor.java:141)
    at org.primeframework.mvc.parameter.el.Expression.traverseToEndForSet(Expression.java:118)
    at org.primeframework.mvc.parameter.el.DefaultExpressionEvaluator.setValue(DefaultExpressionEvaluator.java:133)
    at org.primeframework.mvc.parameter.DefaultParameterHandler.setValues(DefaultParameterHandler.java:223)
```

Intermediate reflection/accessor frames are omitted above. The observed stack
matches the reported parameter-binding path.

## Scope and limitations

- The secondary `/oauth2/authorize` tenant/CAPTCHA observation has no known
  reproduction and was not tested here; this verdict applies to registration.
- This confirms the symptom and observed stack, not a particular source-code fix.
- No production request volumes or bot attribution were verified.
- No product test/build infrastructure exists in this issues-only repository.
  Both reproduction scripts ran successfully; Python parsing and `node --check`
  passed. The baseline GET/POST controls still render normally.
