# Triage #3586: confirmed

Relates to #3586.

**Verdict:** confirmed  
**Confidence:** high

Trailing ASCII spaces reproduce HTTP 500 and the reported NullPointerExceptions in both Login and Forgot Password APIs on MySQL, including latest. The hosted pages display the reported error. PostgreSQL rejects the same IDs with HTTP 404.

## Environment

Tested 2026-11-04 using public Docker images; no paid license or application source code.

| Instance | Version | Database | Search | Startup |
|---|---|---|---|---|
| `http://localhost:9012` | 1.69.4 | PostgreSQL 16.15 | OpenSearch 2.11.0 | Started using supplied `reported` profile |
| `http://localhost:9011` | latest = 1.70.0 | PostgreSQL 16.15 | OpenSearch 2.11.0 | Already running; initial authenticated system-configuration request succeeded |
| `http://localhost:9013` | 1.69.4 | MySQL 8.0.46, `fa_reported` | Database search | Started for this triage |
| `http://localhost:9014` | latest = 1.70.0 | MySQL 8.0.46, `fa_latest` | Database search | Started for this triage |

Latest image digest: `sha256:c5de9a5df542f14397eaf0b857a959a2d8beb0d26044480c896726893679566f`.
MySQL image digest: `sha256:7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b`.
MySQL Connector/J 9.4.0 was downloaded from Maven Central and copied into the disposable app containers; their public images did not include a MySQL driver. Browser: Playwright with Chromium 131.0.6778.33, `--no-sandbox`, 1280×900.

Both MySQL identity columns use `utf8mb4_bin`; MySQL reports `PAD SPACE`.
The MySQL setup deliberately uses database search, so reproducing the failure does not require OpenSearch.
SMTP is deliberately `localhost:25` without a mail server. No external email is sent; successful reset workflow creation is tested, not delivery.

## Results by version

| Version / database | Exact email, uppercase email, exact username (both APIs) | Trailing ASCII spaces (both APIs) | Other tested whitespace (both APIs) | Hosted pages |
|---|---|---|---|---|
| 1.69.4 / MySQL | 200 | **500 + NPE** | 404 | Both display unexpected-exception message |
| 1.70.0 latest / MySQL | 200 | **500 + NPE** | 404 | Both display unexpected-exception message |
| 1.69.4 / PostgreSQL | 200 | 404 | 404 | Not tested |
| 1.70.0 latest / PostgreSQL | 200 | 404 | 404 | Not tested |

Trailing-space cases: email + one space, email + two spaces, uppercase email + one space, username + one space.
Other whitespace: leading ASCII space on email; trailing tab, newline, or NBSP on email.
This confirms these cases only, not every version since the identity-model introduction. MFA was not tested.

## Replication steps

Use only disposable local instances. Requirements: Docker Compose, curl, OpenSSL, Python 3, and the environment's preinstalled Playwright/Chromium. All repository paths below are absolute; change `ROOT` if the checkout is elsewhere.

1. Define paths and credentials. Obtain `API_KEY` from the supplied local kickstart configuration without committing it. Generated passwords are local throwaway credentials.

   ```bash
   export ROOT=/home/runner/work/fusionauth-issues/fusionauth-issues
   export CASE="$ROOT/triage/issue-3586"
   export API_KEY="$(python3 -c 'import json,os; print(json.load(open(os.environ["ROOT"]+"/.github/triage/kickstart/kickstart.json"))["variables"]["apiKey"])')"
   export TEST_PASSWORD="$(openssl rand -hex 18)"
   export MYSQL_ROOT_PASSWORD="$(openssl rand -hex 18)"
   export MYSQL_APP_PASSWORD="$(openssl rand -hex 18)"
   curl -sS -H "Authorization: $API_KEY" http://localhost:9011/api/system-configuration
   ```

2. Start the reported PostgreSQL instance; latest was already running. The supplied profile creates its own search cluster:

   ```bash
   REPORTED_VERSION=1.69.4 docker compose -p triage \
     -f "$ROOT/.github/triage/docker-compose.yml" --profile reported \
     up -d fusionauth-reported
   ```

3. Start the isolated MySQL setup. The first boot logs `MySQL driver is missing but the database configuration is pointing to a MySQL database.` Install the public JDBC driver and restart:

   ```bash
   docker pull mysql:8.0
   docker compose -f "$CASE/compose.yml" up -d reported latest
   curl -fSL https://repo.maven.apache.org/maven2/com/mysql/mysql-connector-j/9.4.0/mysql-connector-j-9.4.0.jar \
     -o /tmp/mysql-connector-j-9.4.0.jar
   docker cp /tmp/mysql-connector-j-9.4.0.jar issue3586-reported-1:/usr/local/fusionauth/fusionauth-app/lib/
   docker cp /tmp/mysql-connector-j-9.4.0.jar issue3586-latest-1:/usr/local/fusionauth/fusionauth-app/lib/
   docker restart issue3586-reported-1 issue3586-latest-1
   ```

   The JDBC file is not committed. Reinstall it if containers are recreated. The database is on an internal network; app ports bind only to host loopback.
   An initial internal-only app-network attempt could not expose the ports; `compose.yml` includes the default app network to make those ports reachable.

4. Wait up to five minutes for each instance's authenticated configuration API, then retrieve the actual application version:

   ```bash
   for port in 9012 9011 9013 9014; do
     for attempt in $(seq 1 60); do
       curl -fsS -H "Authorization: $API_KEY" \
         "http://localhost:$port/api/system-configuration" >/dev/null && break
       sleep 5
     done
     curl -fsS -H "Authorization: $API_KEY" "http://localhost:$port/api/status" \
       | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])'
   done
   ```

5. On each instance, create the following setup. Set `FA` to the instance URL, testing 1.69.4 before latest. Requests use `Authorization: $API_KEY` and `Content-Type: application/json`.
   `repro.py` performs these calls; the exact fresh-instance calls and bodies are listed here so no script reading is needed:

   - `GET $FA/api/status`: no body; record `version`.
   - `GET $FA/api/email/template/35860000-0000-4000-8000-000000000003`: no body. If absent, `POST` to the same URL with the following body; if present from an earlier run, `PUT` with the same body:

     ```json
     {"emailTemplate":{"name":"Issue 3586 reset","defaultSubject":"Local reset test","defaultFromEmail":"triage@example.com","defaultHtmlTemplate":"<p>Local reset test</p>","defaultTextTemplate":"Local reset test"}}
     ```

   - `GET $FA/api/tenant`: no body. Use the sole tenant's `id` as `$TENANT_ID`.
   - `PATCH $FA/api/tenant/$TENANT_ID`:

     ```json
     {"tenant":{"emailConfiguration":{"forgotPasswordEmailTemplateId":"35860000-0000-4000-8000-000000000003","host":"localhost","port":25}}}
     ```

   - `GET $FA/api/application/35860000-0000-4000-8000-000000000001`: no body. If absent, `POST` to that URL with the following body; if present and active, `PUT` with the same body. Replace `$FA` inside the redirect URL with the actual base URL:

     ```json
     {"application":{"name":"Issue 3586 reproduction","active":true,"oauthConfiguration":{"authorizedRedirectURLs":["$FA/callback"],"enabledGrants":["authorization_code"]}}}
     ```

   - `POST $FA/api/user/registration/35860000-0000-4000-8000-000000000002`, substituting the generated `$TEST_PASSWORD`:

     ```json
     {"user":{"email":"user@example.com","username":"username","password":"$TEST_PASSWORD"},"registration":{"applicationId":"35860000-0000-4000-8000-000000000001"}}
     ```

   Each setup write must return 200. Initially, without the reset template, all forgot-password calls returned empty-body 403, including the exact-ID control. Those are configuration failures, not evidence against the bug.

   For reruns only, remove the fixed disposable user using `DELETE $FA/api/user/35860000-0000-4000-8000-000000000002?hardDelete=true` (no body), then recreate it.
   Plain DELETE soft-deactivates users/apps. If the test application was deactivated, reactivate it with `PUT $FA/api/application/35860000-0000-4000-8000-000000000001?reactivate=true` (no body).
   No other users/apps need to be removed.

6. Submit both requests below for **each** JSON-encoded login ID in this list:

   ```text
   "user@example.com"
   "USER@EXAMPLE.COM"
   "user@example.com "
   "user@example.com  "
   "USER@EXAMPLE.COM "
   "username"
   "username "
   " user@example.com"
   "user@example.com\t"
   "user@example.com\n"
   "user@example.com\u00a0"
   ```

   Assign a listed value, including its double quotes, to `LOGIN_ID_JSON`; for example `LOGIN_ID_JSON='"user@example.com "'`. The two exact request bodies are:

   ```bash
   curl -sS -i -X POST "$FA/api/login" \
     -H "Authorization: $API_KEY" -H "Content-Type: application/json" \
     -d "{\"loginId\":$LOGIN_ID_JSON,\"password\":\"$TEST_PASSWORD\",\"applicationId\":\"35860000-0000-4000-8000-000000000001\"}"
   curl -sS -i -X POST "$FA/api/user/forgot-password" \
     -H "Authorization: $API_KEY" -H "Content-Type: application/json" \
     -d "{\"loginId\":$LOGIN_ID_JSON,\"sendForgotPasswordEmail\":true,\"applicationId\":\"35860000-0000-4000-8000-000000000001\"}"
   ```

   Successful responses contain tokens/reset IDs; do not save those bodies. The script saves only statuses and error objects. To perform steps 5–6 automatically on fresh instances:

   ```bash
   for port in 9012 9011 9013 9014; do
     FA="http://localhost:$port" python3 "$CASE/repro.py"
   done
   ```

7. Test hosted pages on MySQL, first `FA=http://localhost:9013`, then `FA=http://localhost:9014`. Reset the disposable user's password for this test with `PATCH $FA/api/user/35860000-0000-4000-8000-000000000002`, headers as above and body `{"user":{"password":"$TEST_PASSWORD"}}`; require 200.
   Open `$FA/oauth2/authorize?client_id=35860000-0000-4000-8000-000000000001&response_type=code&redirect_uri=<URL-encoded $FA/callback>&scope=openid`.
   Fill **Login** with `user@example.com ` (one trailing ASCII space), fill **Password**, and click **Submit**. Verify the unexpected-exception banner.
   Reopen that authorize URL, click **Forgot your password?**, fill **Login** with the same trailing-space value, then click **Submit**. Verify the same banner.
   The automated version records navigation status codes, the input's exact DOM value, and the banner text:

   ```bash
   export NODE_PATH="$(npm root -g)"
   FA=http://localhost:9013 node "$CASE/repro.cjs"
   FA=http://localhost:9014 SCREENSHOT_OFFSET=4 node "$CASE/repro.cjs"
   ```

8. Inspect server and database evidence:

   ```bash
   docker logs issue3586-reported-1 2>&1 | grep -A 4 'java.lang.NullPointerException'
   docker logs issue3586-latest-1 2>&1 | grep -A 4 'java.lang.NullPointerException'
   docker exec issue3586-mysql-1 sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -u root -e "
     SELECT VERSION();
     SELECT COLLATION_NAME, PAD_ATTRIBUTE FROM information_schema.COLLATIONS WHERE COLLATION_NAME = '\''utf8mb4_bin'\'';
     SELECT TABLE_SCHEMA, COLUMN_NAME, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA IN ('\''fa_reported'\'','\''fa_latest'\'') AND TABLE_NAME='\''identities'\'' AND COLUMN_NAME='\''value'\'';
     SELECT COUNT(*) AS trailing_match FROM fa_latest.identities WHERE value='\''user@example.com '\'';
     SELECT COUNT(*) AS leading_match FROM fa_latest.identities WHERE value='\'' user@example.com'\'';
     SELECT COUNT(*) AS null_identity_records FROM fa_reported.raw_logins WHERE users_id=UNHEX('\''35860000000040008000000000000002'\'') AND identities_type IS NULL AND identities_value IS NULL;
     SELECT COUNT(*) AS null_identity_records FROM fa_latest.raw_logins WHERE users_id=UNHEX('\''35860000000040008000000000000002'\'') AND identities_type IS NULL AND identities_value IS NULL;
   "'
   ```

## Expected and actual

**Expected:** A normal authentication/reset outcome (200 or a documented rejection such as 404), never an unhandled exception because an ID contains whitespace.

**Actual:** On both MySQL-backed versions, all four trailing-space variants return API HTTP 500 with:

```json
{"generalErrors":[{"code":"[Exception]","message":"An unexpected exception occurred."}],"fieldErrors":{}}
```

Nonmatching whitespace IDs return HTTP 404 with an empty body. Exact and uppercase-email controls, and exact username, return 200 on both APIs.
Hosted form POSTs return HTML HTTP 200 but display `An unexpected exception occurred.`; the submitted DOM input remains `"user@example.com "`.
No browser JavaScript error was observed; latest emitted one informational autofocus message.

MySQL SQL results: `utf8mb4_bin / PAD SPACE`; both identity columns use that collation; `trailing_match = 1`, `leading_match = 0`.
After the final API and UI runs, each MySQL database contained **6** raw login records for the test user with both identity fields NULL. These were counted after repeated testing, not correlated individually to specific requests.
These observations support the reporter's database-comparison explanation; the internal Java matching implementation was not inspected.

## Evidence

Scripts/configuration: `compose.yml`, `repro.py`, `repro.cjs`.
Sanitized run output: `api-1694-postgres.jsonl`, `api-latest-postgres.jsonl`, `api-1694-mysql.jsonl`, `api-latest-mysql.jsonl`, `ui-1694.jsonl`, `ui-latest.jsonl`.

Screenshots, in order:

| Files | Version / flow |
|---|---|
| `01-login-before.png`, `02-login-after.png` | 1.69.4 login |
| `03-forgot-before.png`, `04-forgot-after.png` | 1.69.4 forgot password |
| `05-login-before.png`, `06-login-after.png` | 1.70.0 login |
| `07-forgot-before.png`, `08-forgot-after.png` | 1.70.0 forgot password |

The latest login screenshot was visually inspected and matches the reported banner text; no screenshot attachments were present in the issue. Both flows' visible text was asserted from the DOM.

Key server log lines, observed on both versions:

```text
java.lang.NullPointerException: Cannot read field "type" because "<parameter4>.userIdentity" is null
    at io.fusionauth.app.action.api.BaseLoginAction.handleAuthenticationResult(BaseLoginAction.java:338)
    at io.fusionauth.app.action.api.BaseLoginAction.callLogin(BaseLoginAction.java:226)
```

`LoginAction.post` is line 151 on 1.69.4 and 152 on 1.70.0.
Forgot-password logs:

```text
java.lang.NullPointerException: Cannot read field "type" because "<parameter4>" is null
    at io.fusionauth.api.service.user.DefaultUserService.forgotPassword(DefaultUserService.java:1753)
    at io.fusionauth.app.action.api.user.ForgotPasswordAction.post(ForgotPasswordAction.java:99)
```

The service line is 1753 on 1.69.4 and 1791 on 1.70.0. These are runtime stack traces from the public images, not source-code inspection.
