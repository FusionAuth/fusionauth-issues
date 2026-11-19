import base64
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import uuid


EMAIL_FORMAT = "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"
IDP = "https://idp.example.test"
SP = "urn:triage:issue-3600:sp"
EMAIL = "saml-user@example.test"
SIGNER = Path(__file__).with_name("SignAssertion.java")


def api(base, method, path, body=None, authenticated=True, expected=200):
    headers = {"Content-Type": "application/json"}
    if authenticated:
        headers["Authorization"] = os.environ["API_KEY"]
    req = urllib.request.Request(base + path, method=method, headers=headers,
                                 data=None if body is None else json.dumps(body).encode())
    try:
        response = urllib.request.urlopen(req, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        status = response.code
        data = response.read()
    if expected is not None and status != expected:
        raise SystemExit(f"{method} {path}: HTTP {status}, expected {expected}: {data.decode()}")
    return status, json.loads(data) if data else {}


def make_response(work, acs, request_id, typed):
    now = datetime.datetime.now(datetime.timezone.utc)
    instant = now.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    expiry = (now + datetime.timedelta(minutes=5)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    type_attrs = (' xmlns:xsd="http://www.w3.org/2001/XMLSchema"'
                  ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="xsd:anyType"') if typed else ""
    xml = f"""<saml2p:Response xmlns:saml2p="urn:oasis:names:tc:SAML:2.0:protocol" ID="_{uuid.uuid4()}" Version="2.0" IssueInstant="{instant}" Destination="{acs}" InResponseTo="{request_id}">
<saml2:Issuer xmlns:saml2="urn:oasis:names:tc:SAML:2.0:assertion">{IDP}</saml2:Issuer>
<saml2p:Status><saml2p:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></saml2p:Status>
<saml2:Assertion xmlns:saml2="urn:oasis:names:tc:SAML:2.0:assertion" ID="_{uuid.uuid4()}" Version="2.0" IssueInstant="{instant}"><saml2:Issuer>{IDP}</saml2:Issuer>
<saml2:Subject><saml2:NameID Format="{EMAIL_FORMAT}">{EMAIL}</saml2:NameID>
<saml2:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml2:SubjectConfirmationData Recipient="{acs}" InResponseTo="{request_id}" NotOnOrAfter="{expiry}"/></saml2:SubjectConfirmation></saml2:Subject>
<saml2:Conditions NotBefore="{instant}" NotOnOrAfter="{expiry}"><saml2:AudienceRestriction><saml2:Audience>{SP}</saml2:Audience></saml2:AudienceRestriction></saml2:Conditions>
<saml2:AuthnStatement AuthnInstant="{instant}"><saml2:AuthnContext><saml2:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml2:AuthnContextClassRef></saml2:AuthnContext></saml2:AuthnStatement>
<saml2:AttributeStatement><saml2:Attribute Name="email"><saml2:AttributeValue{type_attrs}>{EMAIL}</saml2:AttributeValue></saml2:Attribute></saml2:AttributeStatement></saml2:Assertion></saml2p:Response>"""
    unsigned = work / "response.xml"
    unsigned.write_text(xml, encoding="utf-8")
    signed = subprocess.check_output(["java", str(SIGNER), str(unsigned), str(work / "key.der")])
    return base64.b64encode(signed).decode()


def run(port, work):
    base = f"http://localhost:{port}"
    api(base, "GET", "/api/system-configuration")
    name = f"SAML QName triage {uuid.uuid4()}"
    app = api(base, "POST", "/api/application", {"application": {"name": name}})[1]["application"]["id"]
    key = api(base, "POST", "/api/key/import", {"key": {
        "name": name, "algorithm": "RS256", "certificate": (work / "cert.pem").read_text(),
    }})[1]["key"]["id"]
    provider = api(base, "POST", "/api/identity-provider", {"identityProvider": {
        "name": name, "type": "SAMLv2", "enabled": True, "debug": True,
        "idpEndpoint": IDP + "/login", "expectedIssuer": IDP, "issuer": SP,
        "verificationKeyIds": [key], "postRequest": True, "signRequest": False,
        "nameIdFormat": EMAIL_FORMAT, "linkingStrategy": "CreatePendingLink",
        "applicationConfiguration": {app: {"enabled": True, "createRegistration": True}},
    }})[1]["identityProvider"]["id"]
    for typed in (True, False):
        ids = {"applicationId": app, "identityProviderId": provider}
        request_id = "_" + str(uuid.uuid4())
        _, start = api(base, "POST", "/api/identity-provider/start", {**ids, "data": {"requestId": request_id}},
                       authenticated=False, expected=202)
        saml = make_response(work, base + "/samlv2/acs", request_id, typed)
        status, result = api(base, "POST", "/api/identity-provider/login", {
            **ids, "data": {"samlResponse": saml, "code": start["code"]},
        }, authenticated=False, expected=None)
        # Do not print login or link tokens.
        summary = {k: result[k] for k in ("generalErrors", "fieldErrors") if k in result}
        print(f"{port} {'typed' if typed else 'untyped'}: HTTP {status} {json.dumps(summary)}", flush=True)


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in ("9011", "9012"):
        raise SystemExit("Usage: API_KEY=... python3 repro.py 9011|9012")
    with tempfile.TemporaryDirectory() as directory:
        work = Path(directory)
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                        "-subj", "/CN=issue-3600-test-idp", "-keyout", "key.pem", "-out", "cert.pem"],
                       cwd=work, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        subprocess.run(["openssl", "pkcs8", "-topk8", "-nocrypt", "-in", "key.pem", "-outform", "DER",
                        "-out", "key.der"], cwd=work, check=True)
        run(sys.argv[1], work)
