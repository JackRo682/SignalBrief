"""Run each published SQL file on real PostgreSQL with isolated synthetic temp tables."""

import json
import os
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "docs/career/sql"
PARAMS = {k: datetime(2026, 1, d, tzinfo=timezone.utc) for k, d in (("start", 1), ("end", 10), ("as_of", 12))}
FILES = sorted(SQL.glob("[0-9][0-9]_*.sql"))


@pytest.fixture
def career_db():
    url = os.getenv("SB_CAREER_POSTGRES_URL") or os.getenv("SB_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("Disposable PostgreSQL required; SQL exercises were NOT executed")
    parsed = make_url(url)
    if parsed.host not in {"localhost", "127.0.0.1", "::1"} or not (parsed.database or "").endswith("_test"):
        pytest.fail("Career SQL tests require a local disposable *_test database")
    engine = create_engine(url, connect_args={"connect_timeout": 5})
    with engine.connect() as conn:
        transaction = conn.begin()
        conn.exec_driver_sql("SET LOCAL search_path = pg_temp")
        conn.exec_driver_sql("SET LOCAL timezone = 'UTC'")
        conn.exec_driver_sql("SET LOCAL statement_timeout = '10s'")
        conn.exec_driver_sql((SQL / "fixture.sql").read_text(encoding="utf-8"))
        yield conn
        transaction.rollback()
    engine.dispose()


def run(conn, number, params=None):
    return conn.execute(text(FILES[number - 1].read_text(encoding="utf-8")), params or PARAMS).mappings().all()


RATES = {1: (1, 4, "0.2500"), 2: (2, 3, "0.6667"), 3: (3, 3, "1.0000"),
         4: (2, 5, "0.4000"), 5: (1, 3, "0.3333"), 6: (1, 5, "0.2000"),
         7: (2, 5, "0.4000"), 8: (2, 3, "0.6667"), 9: (1, 2, "0.5000"), 10: (2, 3, "0.6667")}


@pytest.mark.postgres
@pytest.mark.parametrize("number", range(1, 19))
def test_published_query(career_db, number):
    rows = run(career_db, number)
    if number in RATES:
        n, d, rate = RATES[number]
        assert len(rows) == 1
        assert (rows[0]["numerator"], rows[0]["denominator"], rows[0]["rate"]) == (n, d, Decimal(rate))
        if number in (9, 10):
            assert rows[0]["sampled"] == 4
            assert rows[0]["coverage"] == Decimal("0.5000" if number == 9 else "0.7500")
    elif number == 11:
        assert [tuple(r.values()) for r in rows] == [("u1", 2), ("u2", 1), ("u3", 0), ("u5", 0), ("u6", 0)]
    elif number == 12:
        assert [tuple(r.values()) for r in rows] == [("d1", "a5", "duplicate_skipped"), ("d2", "a3", "validation_failed"), ("d3", "a4", "running"), ("d4", "a7", "validated")]
    elif number == 13:
        assert dict(rows[0]) == {"cohort": 3, "watchlist": 2, "detail": 1}
    elif number == 14:
        assert [tuple(r.values()) for r in rows] == [(date(2025, 12, 29), 3, 1, Decimal("0.3333"))]
    elif number == 15:
        assert [r["active_users"] for r in rows] == [1, 2, 1, 0, 0, 0, 0, 1, 1]
        assert [r["trailing_observed_day_average"] for r in rows] == list(map(Decimal, ["1", "1.5", "1.3333", "1", ".8", ".6667", ".5714", ".5714", ".4286"]))
    elif number == 16:
        assert rows == []
        career_db.exec_driver_sql("""INSERT INTO user_events VALUES
          ('bad1','missing','login','{}','2026-01-01 00:00Z'),
          ('bad2','u1','brief_opened','{}','2026-01-01 00:00Z'),
          ('bad3','u1','login','{}','2026-02-01 00:00Z'),
          ('bad4','u1','login','[]','2026-01-01 00:00Z'),
          ('bad5','u1','login','{"question":"synthetic private text"}','2026-01-01 00:00Z')""")
        assert [tuple(r.values()) for r in run(career_db, 16)] == [("bad1", "orphan_user"), ("bad2", "missing_event_id"), ("bad3", "future_timestamp"), ("bad4", "invalid_properties"), ("bad5", "unexpected_property")]
    elif number == 17:
        assert [r["fact_id"] for r in rows] == ["f2", "f3", "f4", "f5"]
    elif number == 18:
        assert [tuple(r.values()) for r in rows] == [("n1", "consistent"), ("n2", "consistent"), ("n3", "undefined_percentage"), ("n4", "absolute_mismatch"), ("n5", "percentage_mismatch"), ("n6", "uncheckable"), ("n7", "undefined_percentage")]


@pytest.mark.postgres
@pytest.mark.parametrize("number", range(1, 19))
def test_every_query_on_empty_data(career_db, number):
    tables = career_db.exec_driver_sql("SELECT tablename FROM pg_tables WHERE schemaname LIKE 'pg_temp_%'").scalars()
    for name in tables:
        career_db.exec_driver_sql('TRUNCATE TABLE pg_temp."' + name + '"')
    rows = run(career_db, number)
    if number <= 10:
        assert rows[0]["numerator"] == rows[0]["denominator"] == 0
        assert rows[0]["rate"] is None
    elif number == 13:
        assert dict(rows[0]) == {"cohort": 0, "watchlist": 0, "detail": 0}
    elif number == 15:
        assert len(rows) == 9 and all(r["active_users"] == 0 for r in rows)
    else:
        assert rows == []


@pytest.mark.postgres
def test_time_boundaries_and_timezone_invariance(career_db):
    assert run(career_db, 5, {**PARAMS, "as_of": datetime(2026, 1, 8, tzinfo=timezone.utc)})[0]["denominator"] == 0
    # D7 begins exactly 168h after creation, and ends exclusively at 192h.
    career_db.exec_driver_sql("INSERT INTO user_events VALUES ('boundary','u3','brief_opened','{\"event_id\":\"e2\"}','2026-01-10 00:00Z')")
    assert run(career_db, 5)[0]["numerator"] == 2
    baseline = [run(career_db, n) for n in range(1, 19)]
    career_db.exec_driver_sql("SET LOCAL timezone = 'Asia/Seoul'")
    assert [run(career_db, n) for n in range(1, 19)] == baseline


@pytest.mark.postgres
def test_fixture_projection_matches_audited_schema(career_db):
    columns = json.loads((ROOT / "docs/career/evidence/schema-snapshot.json").read_text())["columns"]
    audited = {(c["table_name"], c["column_name"]): c["data_type"] for c in columns}
    projected = career_db.exec_driver_sql("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema LIKE 'pg_temp_%'").all()
    for table, column, datatype in projected:
        if table not in {"signup_attempts", "claim_reviews"}:
            assert audited[table, column] == datatype


def test_all_eighteen_exercises_have_tests():
    assert len(FILES) == 18
    assert [p.name[:2] for p in FILES] == [f"{i:02d}" for i in range(1, 19)]
