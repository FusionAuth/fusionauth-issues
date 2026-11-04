#!/usr/bin/env python3
"""Exercise disposable local instances. Credentials are supplied via the environment."""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


BASE = os.environ.get("FA", "http://localhost:9013").rstrip("/")
if urllib.parse.urlsplit(BASE).hostname not in ("localhost", "127.0.0.1"):
    raise SystemExit("Use a disposable local FusionAuth instance.")
API_KEY = os.environ["API_KEY"]
PASSWORD = os.environ["TEST_PASSWORD"]
APP_ID = "35860000-0000-4000-8000-000000000001"
USER_ID = "35860000-0000-4000-8000-000000000002"
TEMPLATE_ID = "35860000-0000-4000-8000-000000000003"


def request(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        BASE + path, data=data, method=method,
        headers={"Authorization": API_KEY, "Content-Type": "application/json"},
    )
    try:
        response = urllib.request.urlopen(req, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        text = response.read().decode()
        try:
            result = json.loads(text) if text else {}
        except ValueError:
            result = {"text": text[:1000]}
        return response.status, result


def setup(path, body):
    method = "POST"
    if path.startswith(("/api/application/", "/api/email/template/")):
        existing, _ = request("GET", path)
        if existing == 200:
            method = "PUT"
    status, result = request(method, path, body)
    print(json.dumps({"setup": path, "method": method, "status": status}))
    if status != 200:
        raise SystemExit(json.dumps(result))


status, result = request("GET", "/api/status")
if status != 200:
    raise SystemExit(f"Instance not ready: HTTP {status}")
print(json.dumps({"base": BASE, "version": result.get("version")}))
setup("/api/email/template/" + TEMPLATE_ID, {"emailTemplate": {
    "name": "Issue 3586 reset", "defaultSubject": "Local reset test",
    "defaultFromEmail": "triage@example.com",
    "defaultHtmlTemplate": "<p>Local reset test</p>",
    "defaultTextTemplate": "Local reset test",
}})
status, tenants = request("GET", "/api/tenant")
if status != 200 or len(tenants.get("tenants", [])) != 1:
    raise SystemExit("Expected one tenant in a fresh disposable instance.")
tenant_id = tenants["tenants"][0]["id"]
status, result = request("PATCH", "/api/tenant/" + tenant_id, {"tenant": {
    "emailConfiguration": {"forgotPasswordEmailTemplateId": TEMPLATE_ID,
                           "host": "localhost", "port": 25},
}})
print(json.dumps({"setup": "/api/tenant/" + tenant_id, "status": status}))
if status != 200:
    raise SystemExit(json.dumps(result))
setup("/api/application/" + APP_ID, {"application": {
    "name": "Issue 3586 reproduction", "active": True,
    "oauthConfiguration": {"authorizedRedirectURLs": [BASE + "/callback"],
                           "enabledGrants": ["authorization_code"]},
}})
setup("/api/user/registration/" + USER_ID, {
    "user": {"email": "user@example.com", "username": "username", "password": PASSWORD},
    "registration": {"applicationId": APP_ID},
})

cases = [
    "user@example.com", "USER@EXAMPLE.COM", "user@example.com ",
    "user@example.com  ", "USER@EXAMPLE.COM ", "username", "username ",
    " user@example.com", "user@example.com\t", "user@example.com\n",
    "user@example.com\u00a0",
]
observations = []
for login_id in cases:
    for path in ("/api/login", "/api/user/forgot-password"):
        body = {"loginId": login_id, "applicationId": APP_ID}
        if path == "/api/login":
            body["password"] = PASSWORD
        else:
            body["sendForgotPasswordEmail"] = True
        status, result = request("POST", path, body)
        # Never print tokens, password-reset IDs, user objects, or credentials.
        summary = {k: result[k] for k in ("generalErrors", "fieldErrors") if k in result}
        observation = {"endpoint": path, "loginId": login_id, "status": status,
                       "errors": summary, "emptyBody": not result}
        observations.append(observation)
        print(json.dumps(observation, ensure_ascii=True), flush=True)

# Controls must work for the matrix to be meaningful.
controls = [r for r in observations
            if r["loginId"] in ("user@example.com", "USER@EXAMPLE.COM", "username")]
sys.exit(0 if all(r["status"] == 200 for r in controls) else 1)
