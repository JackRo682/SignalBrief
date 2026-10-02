import os
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

import jwt
import pytest
from alembic import command
from alembic.config import Config
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from signalbrief import models as m
from signalbrief.app import create_app
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]


def migration_config():
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "supabase/migrations"))
    return config


def test_sqlite_frozen_migration_round_trip(tmp_path, monkeypatch):
    url = "sqlite:///" + str(tmp_path / "migration.db")
    monkeypatch.setenv("SB_DATABASE_URL", url)
    monkeypatch.setenv("SB_ENVIRONMENT", "test")
    monkeypatch.setenv("SB_DEMO_MODE", "true")
    monkeypatch.setenv("SB_AUTH_MODE", "demo")
    config = migration_config()
    command.upgrade(config, "head")
    engine = create_engine(url)
    assert set(m.Base.metadata.tables).issubset(inspect(engine).get_table_names())
    for name, table in m.Base.metadata.tables.items():
        assert set(table.columns.keys()) == {x["name"] for x in inspect(engine).get_columns(name)}
    with engine.connect() as conn:
        assert conn.execute(text("select version_num from alembic_version")).scalar() == "002_rls"
    engine.dispose()
    command.downgrade(config, "base")
    engine = create_engine(url)
    assert set(inspect(engine).get_table_names()) <= {"alembic_version"}
    engine.dispose()


@pytest.mark.parametrize("mutation", ["valid", "issuer", "audience", "role", "anonymous", "algorithm"])
def test_real_asymmetric_jwt_contract(db, mutation):
    # Real cryptographic verification with a locally injected public key; no live OAuth claim.
    settings = db.settings.model_copy(
        update={
            "demo_mode": False,
            "auth_mode": "supabase",
            "supabase_url": "https://unit.supabase.co",
            "demo_admin": False,
        }
    )
    app = create_app(settings, db.engine)
    key = ec.generate_private_key(ec.SECP256R1())
    claims = {
        "sub": "00000000-0000-4000-8000-000000000099",
        "iss": settings.supabase_url + "/auth/v1",
        "aud": "authenticated",
        "role": "authenticated",
        "iat": m.now(),
        "exp": m.now() + timedelta(hours=1),
        "user_metadata": {"is_admin": True},
        "app_metadata": {"role": "admin"},
    }
    if mutation == "issuer":
        claims["iss"] = "https://other.supabase.co/auth/v1"
    if mutation == "audience":
        claims["aud"] = "service_role"
    if mutation == "role":
        claims["role"] = "anon"
    if mutation == "anonymous":
        claims["is_anonymous"] = True
    encoded = jwt.encode(claims, key, algorithm="ES256", headers={"kid": "unit"})
    if mutation == "algorithm":
        encoded = jwt.encode(claims, "x" * 40, algorithm="HS256")
    with TestClient(app) as client:
        app.state.jwks = SimpleNamespace(
            get_signing_key_from_jwt=lambda token: SimpleNamespace(key=key.public_key())
        )
        response = client.get("/v1/me", headers={"Authorization": "Bearer " + encoded})
        assert response.status_code == (200 if mutation == "valid" else 401)
        if mutation == "valid":
            assert response.json()["is_admin"] is False


@pytest.mark.postgres
def test_postgres_migrations_and_rls(monkeypatch):
    url = os.getenv("SB_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("SB_TEST_POSTGRES_URL not supplied; PostgreSQL/RLS not verified in this environment")
    # Only use an explicitly disposable database. This test intentionally upgrades/downgrades it.
    monkeypatch.setenv("SB_DATABASE_URL", url)
    monkeypatch.setenv("SB_ENVIRONMENT", "test")
    monkeypatch.setenv("SB_DEMO_MODE", "true")
    monkeypatch.setenv("SB_AUTH_MODE", "demo")
    engine = create_engine(url)
    with engine.begin() as conn:
        for role in ("anon", "authenticated"):
            conn.execute(
                text(
                    f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{role}') THEN CREATE ROLE {role} NOLOGIN; END IF; END $$"
                )
            )
    config = migration_config()
    command.upgrade(config, "head")
    try:
        with Session(engine) as session:
            session.add_all([m.User(id="owner-a"), m.User(id="owner-b")])
            session.add(
                m.Company(
                    id="company-rls",
                    name="Synthetic RLS",
                    ticker="RLS",
                    market="test",
                    provider="fixture",
                    provider_company_id="rls",
                )
            )
            session.flush()
            session.add_all(
                [
                    m.Portfolio(id="portfolio-a", user_id="owner-a", name="a"),
                    m.Portfolio(id="portfolio-b", user_id="owner-b", name="b"),
                ]
            )
            session.flush()
            session.add_all(
                [
                    m.Position(
                        id="position-a", portfolio_id="portfolio-a", company_id="company-rls", quantity=1
                    ),
                    m.Position(
                        id="position-b", portfolio_id="portfolio-b", company_id="company-rls", quantity=2
                    ),
                ]
            )
            session.commit()
        for owner, position in [("owner-a", "position-a"), ("owner-b", "position-b")]:
            with engine.begin() as conn:
                conn.execute(text("SET LOCAL ROLE authenticated"))
                conn.execute(
                    text("SELECT set_config('request.jwt.claim.sub', :owner, true)"), {"owner": owner}
                )
                assert conn.execute(text("SELECT id FROM positions")).scalars().all() == [position]
                assert conn.execute(text("SELECT id FROM users")).scalars().all() == [owner]
                assert conn.execute(text("SELECT user_id FROM portfolios")).scalars().all() == [owner]
        with engine.begin() as conn:
            conn.execute(text("SET LOCAL ROLE authenticated"))
            assert conn.execute(text("SELECT id FROM positions")).scalars().all() == []
        denied_operations = [
            ("anon", "SELECT id FROM positions"),
            ("authenticated", "UPDATE positions SET quantity=999 WHERE id='position-b'"),
            ("authenticated", "DELETE FROM positions WHERE id='position-b'"),
            ("authenticated", "UPDATE users SET display_name='spoofed admin' WHERE id='owner-b'"),
            ("authenticated", "INSERT INTO users (id) VALUES ('forbidden-user')"),
        ] + [
            ("authenticated", f"SELECT * FROM {table}")
            for table in ("documents", "raw_blobs", "ai_runs", "jobs", "audit_logs", "eval_results")
        ]
        for role, sql in denied_operations:
            with pytest.raises(DBAPIError) as failure:
                with engine.begin() as conn:
                    conn.execute(text(f"SET LOCAL ROLE {role}"))
                    conn.execute(text("SELECT set_config('request.jwt.claim.sub', 'owner-a', true)"))
                    conn.execute(text(sql))
            assert failure.value.orig.sqlstate == "42501"
        with engine.connect() as conn:
            assert conn.execute(text("SELECT quantity FROM positions WHERE id='position-b'")).scalar() == 2
            assert conn.execute(text("SELECT count(*) FROM users")).scalar() == 2
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT relname, relrowsecurity FROM pg_class JOIN pg_namespace n ON n.oid=relnamespace WHERE n.nspname='public' AND relkind='r'"
                )
            ).all()
            assert all(enabled for name, enabled in rows if name in m.Base.metadata.tables)
            assert not conn.execute(
                text("SELECT has_table_privilege('authenticated','documents','SELECT')")
            ).scalar()
            assert not conn.execute(
                text("SELECT has_table_privilege('authenticated','users','INSERT')")
            ).scalar()
            assert conn.execute(text("SELECT has_table_privilege('authenticated','users','SELECT')")).scalar()
    finally:
        engine.dispose()
        command.downgrade(config, "base")
