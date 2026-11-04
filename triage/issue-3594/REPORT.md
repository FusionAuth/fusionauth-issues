# Triage #3594: Can't disable an application

**Verdict:** working-as-designed | **Confidence:** high

## Environment

| Version | Instance status | Database | Search engine |
| --- | --- | --- | --- |
| 1.68.0 (reported) | Not running initially; started for this test with the reported-version Compose command below | PostgreSQL 16 (`postgres:16-bookworm`) | OpenSearch 2.11.0 (separate reported-version cluster) |
| 1.70.0 (latest) | Already running when checked | PostgreSQL 16 (`postgres:16-bookworm`) | OpenSearch 2.11.0 (separate latest cluster) |

Both instances were reachable at the start of API testing. The 1.68.0 instance reported `{"version":"1.68.0"}` from `GET /api/system/version`; latest reported `{"version":"1.70.0"}`.

## Replication steps

1. Set `API_KEY` to a FusionAuth superuser API key. For this test environment, the value is the key used in the repository's triage setup; use `$API_KEY` in the requests below.
2. The latest instance was already running at `http://localhost:9011`; verify it with:
   ```sh
   curl -sS -H "Authorization: $API_KEY" http://localhost:9011/api/system-configuration
   curl -sS -H "Authorization: $API_KEY" http://localhost:9011/api/system/version
   ```
   Start the reported version using:
   ```sh
   REPORTED_VERSION=1.68.0 docker compose -p triage -f .github/triage/docker-compose.yml --profile reported up -d fusionauth-reported
   ```
   Wait until this readiness request succeeds:
   ```sh
   curl -sS -H "Authorization: $API_KEY" http://localhost:9012/api/system-configuration
   ```
   Then verify its version:
   ```sh
   curl -sS -H "Authorization: $API_KEY" http://localhost:9012/api/system/version
   ```
3. On each base URL (`http://localhost:9012` for 1.68.0 and `http://localhost:9011` for 1.70.0), create an application with a unique suffix in its name:
   ```sh
   curl -sS -H "Authorization: $API_KEY" -H 'Content-Type: application/json' \
     -X POST "$BASE_URL/api/application" \
     -d '{"application":{"name":"Triage #3594 soft-disable check <unique-suffix>"}}'
   ```
   Both calls returned HTTP 200 and the new application had `active: true`.
4. Soft-delete (deactivate) that application, using the returned application ID:
   ```sh
   curl -sS -i -H "Authorization: $API_KEY" \
     -X DELETE "$BASE_URL/api/application/$APP_ID"
   ```
   Do not add `?hardDelete=true`. Both calls returned HTTP 200 with an empty body.
5. Verify the inactive application:
   ```sh
   curl -sS -H "Authorization: $API_KEY" \
     "$BASE_URL/api/application/$APP_ID?inactive=true"
   ```
   Both calls returned HTTP 200 and showed `active: false` and `state: "Inactive"`.
6. To repeat the API checks exactly, run:
   ```sh
   API_KEY="$API_KEY" ./triage/issue-3594/repro.sh
   ```

The [Delete an Application API](https://fusionauth.io/docs/apis/applications/delete-an-application) documentation describes `DELETE /api/application/{applicationId}` as a reversible soft delete that marks the application inactive; `?hardDelete=true` permanently deletes it. The [`application.active` response property](https://fusionauth.io/docs/apis/applications/retrieve-an-application) is deprecated in favor of `state` (deprecated since 1.22.0).

## Results by version

| Version | Result |
| --- | --- |
| 1.68.0 | Soft-delete returned 200; retrieving with `inactive=true` showed `active: false`, `state: "Inactive"`. |
| 1.70.0 | Same result as 1.68.0. |

## Expected

An application can be disabled without being permanently removed. The documented reversible soft-delete API should mark the application inactive and allow it to be reactivated.

## Actual

The documented operation works on both tested versions. For example, on each version, `DELETE /api/application/{id}` returned HTTP 200 and the subsequent inactive-application retrieval returned:

```json
{"active":false,"state":"Inactive","name":"Triage #3594 soft-disable check"}
```

By contrast, attempting to change only the deprecated `active` field with an application update did not disable the application. On 1.68.0, `PUT /api/application/{id}` with `{"application":{"active":false}}` returned HTTP 400 (`You must specify the [application.name] property`). Including the name (`{"application":{"name":"Triage #3594 disable repro","active":false}}`) returned HTTP 200 but still returned `active:true`, `state:"Active"`. `PATCH /api/application/{id}` with either `{"application":{"active":false}}` or `{"application":{"state":"Inactive"}}` also returned HTTP 200 without changing the state. The issue description does not include the request used by the reporter, so it is not possible to determine whether one of these was their specific method.

## Evidence

- `repro.sh` — runnable API reproduction for both versions; it prints response status and selected application fields, never client secrets.
- No screenshots: this was an API-only issue.
- Key observations: both soft-delete requests returned HTTP 200 with empty response bodies; both subsequent `GET ...?inactive=true` requests returned HTTP 200 with `active:false` and `state:"Inactive"`.
