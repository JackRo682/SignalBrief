"""Read-only hosted health probes. Does not create accounts or run paid API calls."""

import json
import urllib.error
import urllib.request
from urllib.parse import parse_qs, urlsplit

BASE = "https://xabzzhtdmqsaqdauthbu.supabase.co"
KEY = "sb_publishable_WsJquNhxgSINdXksjvN8Jg_KNkgcvHj"  # Intentionally browser-public.
API = BASE + "/functions/v1/signalbrief-api"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def read(url, headers=None):
    request = urllib.request.Request(url, headers=headers or {})
    try:
        response = urllib.request.build_opener(NoRedirect()).open(request, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read().decode("utf-8")


def main():
    passed = []
    status, _, text = read(API + "/health/ready", {"apikey": KEY})
    assert status == 200, (status, text[:200])
    assert json.loads(text)["database_ready"] is True
    passed.append("live_edge_and_database_ready")
    status, _, text = read(API + "/v1/config", {"apikey": KEY})
    config = json.loads(text)
    assert status == 200 and config["auth_mode"] == "supabase" and not config["demo_mode"]
    passed.append("live_config_no_demo_auth")
    for suffix in ("/v1/me", "/v1/portfolio", "/v1/ops/dashboard"):
        assert read(API + suffix, {"apikey": KEY})[0] == 401
    passed.append("unauthenticated_private_routes_denied")
    assert read(API + "/v1/me", {"apikey": KEY, "Authorization": "Bearer " + "x" * 40})[0] == 401
    passed.append("invalid_bearer_denied")
    assert read(API + "/v1/config", {"apikey": KEY, "Origin": "https://untrusted.invalid"})[0] == 403
    passed.append("untrusted_origin_denied")
    assert read(API + "/v1/calendar/feed/" + "0" * 64 + ".ics", {"apikey": KEY})[0] == 404
    passed.append("invalid_calendar_capability_denied")
    status, _, text = read(BASE + "/auth/v1/settings", {"apikey": KEY})
    assert status == 200 and json.loads(text).get("external", {}).get("google") is True
    passed.append("google_provider_enabled")
    status, headers, _ = read(
        BASE + "/auth/v1/authorize?provider=google&redirect_to=https%3A%2F%2Fsignalbrief-beta.vercel.app%2Fauth%2Fcallback",
        {"apikey": KEY},
    )
    location = urlsplit(headers.get("Location", ""))
    assert status in (302, 303) and location.hostname == "accounts.google.com"
    params = parse_qs(location.query)
    assert params.get("redirect_uri") == [BASE + "/auth/v1/callback"]
    assert params.get("client_id", [""])[0].endswith(".apps.googleusercontent.com")
    passed.append("google_authorization_redirect_and_callback_configured")
    # Never print OAuth state, tokens, client secrets, or user data.
    print(json.dumps({"passed": passed, "google_interactive_signin": "not_tested"}, indent=2))


if __name__ == "__main__":
    main()
