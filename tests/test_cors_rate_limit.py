from fastapi.testclient import TestClient
from signalbrief.app import create_app
from signalbrief.settings import Settings


def test_rate_limit_response_keeps_cors_and_retry_header(tmp_path):
    settings = Settings(
        _env_file=None,
        database_url=f"sqlite:///{tmp_path / 'cors-test.db'}",
        environment="development",
        demo_mode=True,
        demo_seed_on_start=False,
        auth_mode="demo",
        api_requests_per_minute=1,
        allowed_origins="http://127.0.0.1:3000",
    )
    app = create_app(settings)
    with TestClient(app) as client:
        headers = {"Origin": "http://127.0.0.1:3000"}
        assert client.get("/v1/config", headers=headers).status_code == 200
        response = client.get("/v1/config", headers=headers)
        assert response.status_code == 429
        assert response.headers["access-control-allow-origin"] == headers["Origin"]
        assert response.headers["retry-after"] == "60"
    assert "Retry-After" in response.headers["access-control-expose-headers"]


def test_malformed_host_cannot_bypass_api_rate_limit(tmp_path):
    settings = Settings(
        _env_file=None,
        database_url=f"sqlite:///{tmp_path / 'host-rate-test.db'}",
        environment="development",
        demo_mode=True,
        demo_seed_on_start=False,
        auth_mode="demo",
        api_requests_per_minute=1,
    )
    with TestClient(create_app(settings)) as client:
        assert client.get("/v1/config").status_code == 200
        response = client.get("/v1/config", headers={"Host": "testserver/health?ignored="})
        assert response.status_code == 429
        assert response.headers["retry-after"] == "60"
