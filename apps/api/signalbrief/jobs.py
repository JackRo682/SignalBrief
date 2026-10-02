import random
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import and_, or_, select, update

from .errors import LostLease
from .limits import dialect_insert
from .models import Job, now, uid


@dataclass(frozen=True)
class Lease:
    job_id: str
    token: str
    kind: str
    payload: dict
    attempts: int


def enqueue(session, kind: str, payload: dict, dedupe_key: str, available_at=None) -> str:
    identity = uid()
    stmt = dialect_insert(session, Job).values(
        id=identity,
        kind=kind,
        payload=payload,
        dedupe_key=dedupe_key,
        state="queued",
        attempts=0,
        max_attempts=5,
        created_at=now(),
        available_at=available_at or now(),
    )
    session.execute(stmt.on_conflict_do_nothing(index_elements=[Job.dedupe_key]))
    return session.execute(select(Job.id).where(Job.dedupe_key == dedupe_key)).scalar_one()


def claim(factory, worker_id: str, lease_seconds=240, instant=None) -> Lease | None:
    stamp = instant or now()
    eligible = or_(
        and_(Job.state.in_(["queued", "retry"]), Job.available_at <= stamp),
        and_(Job.state == "running", Job.lease_until < stamp),
    )
    with factory.begin() as s:
        # An expired final attempt must not remain a zombie forever.
        s.execute(
            update(Job)
            .execution_options(synchronize_session=False)
            .where(eligible, Job.attempts >= Job.max_attempts)
            .values(state="dead", last_error="attempts_exhausted_after_lease_expiry", finished_at=stamp)
        )
        job = s.execute(
            select(Job)
            .where(eligible, Job.attempts < Job.max_attempts)
            .order_by(Job.available_at, Job.created_at)
            .limit(1)
            .with_for_update(skip_locked=True)
        ).scalar_one_or_none()
        if not job:
            return None
        token = uid()
        row = s.execute(
            update(Job)
            .execution_options(synchronize_session=False)
            .where(Job.id == job.id, eligible, Job.attempts == job.attempts)
            .values(
                state="running",
                attempts=Job.attempts + 1,
                lease_token=token,
                lease_until=stamp + timedelta(seconds=lease_seconds),
                worker_id=worker_id,
            )
            .returning(Job.id, Job.kind, Job.payload, Job.attempts)
        ).first()
        return Lease(row.id, token, row.kind, row.payload, row.attempts) if row else None


def assert_lease(session, lease: Lease, instant=None):
    job = session.execute(
        select(Job)
        .where(
            Job.id == lease.job_id,
            Job.state == "running",
            Job.lease_token == lease.token,
            Job.lease_until > (instant or now()),
        )
        .with_for_update()
    ).scalar_one_or_none()
    if not job:
        raise LostLease("job_lease_lost")


def heartbeat(factory, lease: Lease, seconds: int) -> bool:
    stamp = now()
    with factory.begin() as s:
        result = s.execute(
            update(Job)
            .execution_options(synchronize_session=False)
            .where(
                Job.id == lease.job_id,
                Job.lease_token == lease.token,
                Job.state == "running",
                Job.lease_until > stamp,
            )
            .values(lease_until=stamp + timedelta(seconds=seconds))
        )
        return result.rowcount == 1


def succeed(factory, lease: Lease):
    with factory.begin() as s:
        assert_lease(s, lease)
        s.execute(
            update(Job)
            .execution_options(synchronize_session=False)
            .where(Job.id == lease.job_id, Job.lease_token == lease.token)
            .values(state="succeeded", finished_at=now(), lease_until=None, lease_token=None)
        )


def fail(factory, lease: Lease, error: Exception):
    # Exception messages from HTTP clients can contain secrets. Store codes/types only.
    code = getattr(error, "code", type(error).__name__)[:100]
    retryable = getattr(error, "retryable", True)
    cooldown = max(
        min(3600, 2**lease.attempts * 10 + random.random()), getattr(error, "retry_after", None) or 0
    )
    with factory.begin() as s:
        job = s.execute(
            select(Job)
            .where(Job.id == lease.job_id, Job.lease_token == lease.token, Job.state == "running")
            .with_for_update()
        ).scalar_one_or_none()
        if not job:
            return
        terminal = not retryable or job.attempts >= job.max_attempts
        job.state = "dead" if terminal else "retry"
        job.last_error = code
        job.available_at = now() + timedelta(seconds=cooldown)
        job.lease_token, job.lease_until = None, None
        if terminal:
            job.finished_at = now()
