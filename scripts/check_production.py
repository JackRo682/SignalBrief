"""Read-only production probes. No account data, vendor calls, or secrets are used."""

import json

from check_hosted_api import main as check_backend
from check_hosted_api import read

ORIGIN = "https://signalbrief.online"


def main():
    check_backend()
    passed = []
    for path in ("/", "/login", "/privacy", "/terms"):
        status, _, body = read(ORIGIN + path)
        assert status == 200 and "SignalBrief" in body, f"public_page_failed:{path}:{status}"
    passed.append("production_https_public_pages")
    status, headers, _ = read("https://www.signalbrief.online/")
    assert status == 308 and headers.get("Location") == ORIGIN + "/", "www_redirect_failed"
    passed.append("www_canonical_redirect")
    status, _, body = read(ORIGIN + "/api/release")
    release = json.loads(body)
    assert status == 200 and len(release.get("commit") or "") == 40, "release_identity_missing"
    passed.append("production_release_identified")
    status, _, body = read(ORIGIN + "/api/health/ready")
    assert status == 200 and json.loads(body).get("database_ready") is True, "web_proxy_unready"
    passed.append("production_proxy_and_database_ready")
    status, _, body = read(ORIGIN + "/api/v1/config")
    config = json.loads(body)
    assert status == 200 and config.get("auth_mode") == "supabase" and config.get("demo_mode") is False
    passed.append("production_proxy_no_demo_auth")
    for path in ("/api/v1/me", "/api/v1/portfolio", "/api/v1/ops/dashboard"):
        assert read(ORIGIN + path)[0] == 401, f"private_route_not_denied:{path}"
    passed.append("production_proxy_requires_login")
    status, _, _ = read(ORIGIN + "/api/internal/dart", {"Content-Type": "application/json"})
    assert status in (401, 405), "dart_relay_unexpected_public_access"
    passed.append("private_relay_not_publicly_readable")
    print(json.dumps({"origin": ORIGIN, "commit": release["commit"], "passed": passed}, indent=2))


if __name__ == "__main__":
    main()
