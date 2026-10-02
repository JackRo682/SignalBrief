from datetime import timedelta
from types import SimpleNamespace

import jwt
import pytest
from fastapi.testclient import TestClient
from signalbrief import models as m
from signalbrief.app import create_app
from signalbrief.db import create_development_schema, make_engine, session_factory
from signalbrief.settings import Settings


@pytest.fixture
def settings(tmp_path):
    return Settings(
        _env_file=None,
        environment="test",
        demo_mode=True,
        demo_admin=True,
        demo_seed_on_start=False,
        database_url="sqlite:///" + str(tmp_path / "test.db"),
        storage_path=tmp_path / "raw",
        api_requests_per_minute=100000,
        log_level="ERROR",
        max_retries=2,
    )


@pytest.fixture
def db(settings):
    engine = make_engine(settings)
    factory = session_factory(engine)
    create_development_schema(engine, settings)
    yield SimpleNamespace(engine=engine, factory=factory, settings=settings)
    engine.dispose()


@pytest.fixture
def client(db):
    with TestClient(create_app(db.settings, db.engine)) as c:
        yield c


@pytest.fixture
def seeded(db):
    from signalbrief.seed import seed_demo

    ids = seed_demo(db.settings, db.factory)
    return ids


@pytest.fixture
def token(client):
    response = client.post("/v1/auth/demo")
    assert response.status_code == 200
    return response.json()["access_token"]


@pytest.fixture
def headers(token):
    return {"Authorization": "Bearer " + token}


@pytest.fixture
def admin(client):
    response = client.post("/v1/auth/demo?admin=true")
    assert response.status_code == 200
    return {"Authorization": "Bearer " + response.json()["access_token"]}


def user_headers(settings, subject="00000000-0000-4000-8000-000000000009"):
    token = jwt.encode(
        {
            "sub": subject,
            "iss": "signalbrief-demo",
            "aud": "signalbrief-demo",
            "iat": m.now(),
            "exp": m.now() + timedelta(hours=1),
        },
        settings.demo_jwt_secret,
        algorithm="HS256",
    )
    return {"Authorization": "Bearer " + token}
