"""DB-backed budgets shared by all workers/API processes; no in-memory global limiter."""

import hashlib
import time
from datetime import datetime, timedelta, timezone
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .models import ProviderLimit, RateBucket, now


def reserve_ai_cost(factory, amount: Decimal, ceiling: Decimal) -> bool:
    """Atomically reserve microdollars before sending, retaining uncertain/failed calls.

    Reuses the existing durable counter schema. The lifetime row does not expire
    during normal cleanup. No refund: a timed-out request may still be billable.
    All processes sharing this database share the same ceiling.
    """
    units = int((Decimal(str(amount)) * 1_000_000).to_integral_value(rounding=ROUND_CEILING))
    limit = int((Decimal(str(ceiling)) * 1_000_000).to_integral_value(rounding=ROUND_FLOOR))
    if units <= 0 or units > limit or limit > 1_000_000_000:
        return False
    with factory.begin() as session:
        statement = dialect_insert(session, RateBucket).values(
            key="openai-lifetime-reserved-microusd-v1",
            hits=units,
            expires_at=datetime(9999, 1, 1, tzinfo=timezone.utc),
        )
        statement = statement.on_conflict_do_update(
            index_elements=[RateBucket.key],
            set_={"hits": RateBucket.hits + units},
            where=RateBucket.hits + units <= limit,
        ).returning(RateBucket.hits)
        return session.execute(statement).scalar_one_or_none() is not None


def aware(dt):
    from datetime import timezone

    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def dialect_insert(session, model):
    return pg_insert(model) if session.bind.dialect.name == "postgresql" else sqlite_insert(model)


def consume_budget(factory, subject: str, limit: int, period_seconds: int = 60, instant=None) -> bool:
    stamp = instant or now()
    window = int(stamp.timestamp()) // period_seconds
    key = hashlib.sha256(subject.encode()).hexdigest() + f":{window}:{period_seconds}"
    with factory.begin() as s:
        stmt = dialect_insert(s, RateBucket).values(
            key=key, hits=1, expires_at=stamp + timedelta(seconds=period_seconds * 2)
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[RateBucket.key], set_={"hits": RateBucket.hits + 1}
        ).returning(RateBucket.hits)
        return s.execute(stmt).scalar_one() <= limit


class ProviderLimiter:
    def __init__(self, factory, provider: str, rps: float, sleep=time.sleep):
        self.factory, self.provider, self.interval, self.sleep = factory, provider, 1 / rps, sleep

    def acquire(self):
        # Serialize reservations in PostgreSQL. SQLite uses BEGIN IMMEDIATE for the local demo.
        with self.factory() as s:
            if s.bind.dialect.name == "sqlite":
                from sqlalchemy import text

                s.execute(text("BEGIN IMMEDIATE"))
            stmt = dialect_insert(s, ProviderLimit).values(provider=self.provider, next_request_at=now())
            s.execute(stmt.on_conflict_do_nothing(index_elements=[ProviderLimit.provider]))
            row = s.execute(
                select(ProviderLimit).where(ProviderLimit.provider == self.provider).with_for_update()
            ).scalar_one()
            stamp = now()
            reserved = max(aware(row.next_request_at), stamp)
            row.next_request_at = reserved + timedelta(seconds=self.interval)
            wait = max(0.0, (reserved - stamp).total_seconds())
            s.commit()
        if wait:
            self.sleep(wait)
