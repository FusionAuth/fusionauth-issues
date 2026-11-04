# Triage #3554: confirmed

Relates to #3554.

**Verdict:** confirmed  
**Confidence:** high

System reset changes Tenant Manager's access-token signing-key assignment to the
Default tenant's newly generated key on both the reported version and latest.
No FusionAuth source changes were made.

## Environment

Tested on November 4, 2026, using public `fusionauth/fusionauth-app` Docker images:

| Instance | Version from `GET /api/status` | Initial state |
| --- | --- | --- |
| `http://localhost:9012` | 1.68.0 | Not running; pulled and started for this test |
| `http://localhost:9011` | 1.70.1 (`latest`) | Already running; initial authenticated system-configuration request succeeded |

- Both instances: development runtime mode, no paid license.
- Database: PostgreSQL 16.15 (`postgres:16-bookworm`), separate `fa_reported` and
  `fa_latest` databases.
- Search: separate OpenSearch 2.11.0 containers, configured with
  `SEARCH_TYPE=elasticsearch`. The version was checked inside the search container;
  the host-side `localhost:9200` probe did not return a response.
- Browser: installed Playwright/Chromium, headless, `--no-sandbox`, 1440 × 1000.
- No extra tenant, application, or signing key was created. Initial setup came
  from the repository's existing kickstart. The reset kickstart only recreates
  the disposable API key and admin registration; it contains no JWT settings.

## Replication steps

**Warning:** reset destroys instance data. Use disposable instances only.
The script deliberately refuses non-local URLs and requires explicit reset consent.
Use fresh databases: it also refuses a baseline where the keys already match.

1. Set the repository path and credentials in your shell. Obtain the disposable
   API key and admin password from the triage environment; do not commit them.

   ```sh
   export REPO=/home/runner/work/fusionauth-issues/fusionauth-issues
   export API_KEY='<disposable superuser API key>'
   export ADMIN_PASSWORD='<disposable admin password>'
   export NODE_PATH="$(npm root -g)"
   ```

2. Check latest, then start the reported version. These were the startup commands
   used; latest was already healthy, so no latest startup was necessary.

   ```sh
   curl -fs -H "Authorization: $API_KEY" \
     http://localhost:9011/api/system-configuration
   REPORTED_VERSION=1.68.0 docker compose -p triage \
     -f "$REPO/.github/triage/docker-compose.yml" \
     --profile reported up -d fusionauth-reported
   ```

   Wait until this returns HTTP 200:

   ```sh
   curl -fs -H "Authorization: $API_KEY" \
     http://localhost:9012/api/system-configuration
   ```

3. Test 1.68.0 first. Set `BASE_URL=http://localhost:9012`. Record the version and
   baseline configuration using these three GET requests (no request bodies):

   ```sh
   export BASE_URL=http://localhost:9012
   curl -fs -H "Authorization: $API_KEY" "$BASE_URL/api/status" |
     jq '{version, database: .healthChecks["Database-primary"]}'
   curl -fs -H "Authorization: $API_KEY" "$BASE_URL/api/tenant" |
     jq '[.tenants[] | {id, name, jwtConfiguration}]'
   curl -fs -H "Authorization: $API_KEY" "$BASE_URL/api/application" |
     jq '[.applications[] | {id, name, tenantId, jwtConfiguration}]'
   ```

   Find tenant `Default` and application `Tenant manager`. Compare their
   `jwtConfiguration.accessTokenKeyId` values: they must initially differ.
   The application has `jwtConfiguration.enabled=true`.

4. Create a temporary file named exactly `kickstart.json` outside the repository.
   Use the following JSON, replacing `$API_KEY` and `$ADMIN_PASSWORD` with the
   disposable credentials. Leave `#{...}` references literal.

   ```json
   {
     "variables": {
       "apiKey": "$API_KEY",
       "adminEmail": "admin@example.com",
       "adminPassword": "$ADMIN_PASSWORD"
     },
     "apiKeys": [
       {
         "key": "#{apiKey}",
         "description": "Disposable issue 3554 triage"
       }
     ],
     "requests": [
       {
         "method": "POST",
         "url": "/api/user/registration",
         "body": {
           "user": {
             "email": "#{adminEmail}",
             "password": "#{adminPassword}"
           },
           "registration": {
             "applicationId": "#{FUSIONAUTH_APPLICATION_ID}",
             "roles": ["admin"]
           }
         }
       }
     ]
   }
   ```

   The embedded POST is executed by kickstart against the local FusionAuth
   instance. No tenant, application, JWT, or key-update API call is included.
   `repro.cjs` creates this file with mode `0600` in a temporary directory and
   removes it on exit.

5. In a fresh browser session, open `$BASE_URL/admin`. Fill **Login** with
   `admin@example.com`, **Password** with the disposable admin password, and click
   **Submit**. Open **System → Reset** (or `$BASE_URL/admin/system/reset/`).
   Under **Upload**, choose `kickstart.json` and click **Upload**. Select
   `kickstart.json` in **Select a kickstart**, type `RESET` in **Confirm**, and
   click **Save**. Both the upload and reset submit
   `POST /admin/system/reset`, returning HTTP 302 in the recorded runs. These are
   browser form submissions, not JSON API requests.

6. Repeat the three GET requests in step 3 while reset completes. Compare the
   new Default and Tenant Manager `jwtConfiguration.accessTokenKeyId` values.
   Verify that Default's key changed, Tenant Manager still has JWT enabled,
   and its access-token key now equals Default's. Open `$BASE_URL/admin` in
   another fresh browser session to capture the login page without stale
   admin-session state. Wait for the container log to show successful kickstart
   completion of `POST /api/user/registration`.

7. Run the exact same steps on latest with
   `export BASE_URL=http://localhost:9011`. To automate steps 3–6 and save the
   supplied API snapshots and screenshots, these were the final successful commands:

   ```sh
   node --check "$REPO/triage/issue-3554/repro.cjs"
   RESET_SYSTEM=1 BASE_URL=http://localhost:9012 \
     node "$REPO/triage/issue-3554/repro.cjs"
   RESET_SYSTEM=1 BASE_URL=http://localhost:9011 \
     node "$REPO/triage/issue-3554/repro.cjs"
   ```

   Both executions exited successfully. Each writes only selected, non-secret
   response fields, HTTP statuses, and screenshots to this directory.

## Results by version

| Version | Before reset | After reset | Observation |
| --- | --- | --- | --- |
| 1.68.0 | Tenant Manager access-token key differs from Default | Both use `966e747f-f402-4abf-9e15-8ef68acbc97b` | Reproduced |
| 1.70.1 (latest) | Tenant Manager access-token key differs from Default | Both use `48e3572d-d11e-400a-a367-7bfaba762e88` | Reproduced |

## Expected

Tenant Manager retains its separate default access-token signing key or receives
a newly generated separate default key, rather than Default's key.

## Actual

Selected API response fields, normalized in the evidence JSON:

| Version | Default access-token key before | Tenant Manager access-token key before | Shared access-token key after |
| --- | --- | --- | --- |
| 1.68.0 | `7fd22eae-5ae4-4d92-b78e-d10225ec3b52` | `866a3a09-1ded-43cb-a9e7-8f26c24f9c91` | `966e747f-f402-4abf-9e15-8ef68acbc97b` |
| 1.70.1 | `c9fb890c-e1c4-4fbb-8e23-3284fb6ab858` | `9a77b03a-6153-4479-8571-70a807b0f1d6` | `48e3572d-d11e-400a-a367-7bfaba762e88` |

On both versions, Tenant Manager's `jwtConfiguration.enabled` stays `true` and
its `idTokenKeyId` stays `80ccfe1e-209e-1725-bb37-6c4214dea375`.
Default tenant and Tenant Manager application IDs are retained across reset.
All recorded configuration GET requests returned HTTP 200.

This confirms the configuration-assignment bug. JWT issuance/signature behavior,
production-mode reset restrictions, and other affected versions were not tested.
No license-gated feature was necessary for this reproduction.

## Evidence

- `repro.cjs`: runnable reproduction, with destructive-operation and baseline checks.
- `reported-results.json`, `latest-results.json`: selected before/after API fields
  and reset HTTP statuses. Key UUIDs are identifiers, not signing-key material.
- `01-reported-before.png`: 1.68.0 reset form, kickstart selected and `RESET` entered.
- `02-reported-after.png`: fresh-session login page after the 1.68.0 reset.
- `03-latest-before.png`: latest reset form, same selection and confirmation.
- `04-latest-after.png`: fresh-session login page after the latest reset.
  Screenshots document the UI operation, not key values; the API snapshots are
  the evidence of the signing-key assignment. There were no issue attachments
  to compare against.

Key lines read with `docker logs --tail 60 triage-fusionauth-reported-1` and
`docker logs --tail 60 triage-fusionauth-latest-1`:

```text
1.68.0, 2026-11-04 05:26:41.612 PM:
  DefaultResetService - Reset complete. Total duration [867] ms
1.68.0, 2026-11-04 05:26:54.333 PM:
  KickstartRunner - Summary:
  - Completed [POST] request to [/api/user/registration]
1.70.1, 2026-11-04 05:26:44.828 PM:
  DefaultResetService -   [Reset Tenant Manager Configuration]
1.70.1, 2026-11-04 05:26:45.732 PM:
  DefaultResetService - Reset complete. Total duration [911] ms
1.70.1, 2026-11-04 05:26:58.778 PM:
  KickstartRunner - Summary:
  - Completed [POST] request to [/api/user/registration]
```

### Preliminary attempts and recovery

An initial upload named `issue-3554-kickstart.json` failed after reset with
`NoSuchFileException: /tmp/_kickstart.../kickstart.json`. Subsequent attempts used
the required basename. Early automation also incorrectly expected the tenant ID
to change and attempted to reuse stale browser state. Those assumptions were
removed; they are not the basis for the verdict.

Before each retry, only the disposable reported-version database was recreated:

```sh
docker stop triage-fusionauth-reported-1
docker exec triage-db-1 dropdb -U postgres --force fa_reported
docker start triage-fusionauth-reported-1
```

After each recreation, the authenticated readiness request in step 2 was repeated.
The committed evidence is from the final successful runs, not these preliminary
attempts. Latest was reset only once.
