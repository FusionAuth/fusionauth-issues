#!/usr/bin/env python3
"""Reproduce #3587 using only the Python standard library."""
import html
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:9012"
API_KEY = os.environ["API_KEY"]
APP_ID = "35873587-3587-4587-8587-358735873587"
REDIRECT = "http://localhost:8080/callback"


def request(path, method="GET", body=None, api=False):
    headers = {"Authorization": API_KEY} if api else {}
    if isinstance(body, dict):
        body = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    elif isinstance(body, str):
        body = body.encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(BASE + path, data=body, headers=headers, method=method)
    try:
        response = urllib.request.urlopen(req, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.read().decode()


def api(path, method="GET", body=None):
    status, text = request(path, method, body, api=True)
    if not 200 <= status < 300:
        raise RuntimeError(f"{method} {path}: HTTP {status}: {text}")
    return json.loads(text)


version = api("/api/status")["version"]
tenants = api("/api/tenant")["tenants"]
tenant = next(t for t in tenants if t["name"] == "Default")
status, _ = request("/api/application/" + APP_ID, api=True)
if status == 404:
    api("/api/application/" + APP_ID, "POST", {
        "application": {
            "name": "Issue 3587 registration triage",
            "tenantId": tenant["id"],
            "oauthConfiguration": {
                "authorizedRedirectURLs": [REDIRECT],
                "enabledGrants": ["authorization_code"],
                "requireRegistration": True
            },
            "registrationConfiguration": {
                "enabled": True,
                "type": "basic",
                "loginIdType": "email"
            }
        }
    })
elif status != 200:
    raise RuntimeError(f"Application lookup: HTTP {status}")

query = urllib.parse.urlencode({
    "client_id": APP_ID,
    "redirect_uri": REDIRECT,
    "response_type": "code",
    "scope": "openid",
    "code_challenge": "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopq",
    "code_challenge_method": "S256",
    "state": "x"
})
fields = "&" + urllib.parse.urlencode({
    "user.email": "a@example.com",
    "user.password": "Triage-" + APP_ID + "!"
})
cases = [
    ("get-normal", "GET", ""),
    ("get-email", "GET", "&user.email=prefill%40example.com"),
    ("get-firstName", "GET", "&user.firstName=Max"),
    ("post-no-state", "POST", fields),
    ("post-garbage-state", "POST", fields + "&registrationState=garbage"),
    ("post-garbage-state-no-user", "POST", "&registrationState=garbage"),
    ("post-no-state-no-user", "POST", "")
]
results = []
for name, method, suffix in cases:
    data = query + suffix
    status, body = request(
        "/oauth2/register" + ("?" + data if method == "GET" else ""),
        method, data if method == "POST" else None
    )
    title = re.search(r"<title>(.*?)</title>", body, re.S)
    results.append({
        "case": name,
        "status": status,
        "title": html.unescape(title.group(1).strip()) if title else None,
        "unexpectedException": "An unexpected exception occurred" in body,
        "registrationForm": 'name="user.email"' in body
    })
print(json.dumps({"base": BASE, "version": version, "results": results}, indent=2))
