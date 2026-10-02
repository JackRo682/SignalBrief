"""Relational model. JSON columns hold versioned, validated contracts, not raw LLM output."""

from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import TypeDecorator


class UTCDateTime(TypeDecorator):
    """Consistent aware UTC values in PostgreSQL AND SQLite round trips."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("Naive timestamp forbidden; specify the source timezone")
        return value.astimezone(timezone.utc)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def now() -> datetime:
    return datetime.now(timezone.utc)


def uid() -> str:
    return str(uuid4())


class Base(DeclarativeBase):
    pass


class Identity:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=now, nullable=False)


class User(Base, Identity):
    __tablename__ = "users"
    display_name: Mapped[str] = mapped_column(String(100), default="투자자")
    density: Mapped[str] = mapped_column(String(20), default="beginner")
    onboarding_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    analytics_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=now, onupdate=now)
    __table_args__ = (CheckConstraint("density in ('beginner','advanced')", name="ck_user_density"),)


class Company(Base, Identity):
    __tablename__ = "companies"
    name: Mapped[str] = mapped_column(String(200), index=True)
    ticker: Mapped[str] = mapped_column(String(30), index=True)
    market: Mapped[str] = mapped_column(String(30))
    provider: Mapped[str] = mapped_column(String(20))
    provider_company_id: Mapped[str] = mapped_column(String(30))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    last_ingested_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    __table_args__ = (UniqueConstraint("provider", "provider_company_id", name="uq_company_provider"),)


class Watchlist(Base, Identity):
    __tablename__ = "watchlists"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100), default="관심종목")
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_watchlist_name"),)


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"
    watchlist_id: Mapped[str] = mapped_column(
        ForeignKey("watchlists.id", ondelete="CASCADE"), primary_key=True
    )
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="RESTRICT"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=now)


class Portfolio(Base, Identity):
    __tablename__ = "portfolios"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100), default="내 포트폴리오")
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_portfolio_name"),)


class Position(Base, Identity):
    __tablename__ = "positions"
    portfolio_id: Mapped[str] = mapped_column(ForeignKey("portfolios.id", ondelete="CASCADE"), index=True)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="RESTRICT"))
    quantity: Mapped[Decimal] = mapped_column(Numeric(28, 8))
    average_cost: Mapped[Decimal | None] = mapped_column(Numeric(28, 8))
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=now, onupdate=now)
    __table_args__ = (
        UniqueConstraint("portfolio_id", "company_id", name="uq_position"),
        CheckConstraint("quantity > 0", name="ck_positive_quantity"),
        CheckConstraint("average_cost IS NULL OR average_cost >= 0", name="ck_positive_cost"),
    )


class RawBlob(Base):
    __tablename__ = "raw_blobs"
    sha256: Mapped[str] = mapped_column(String(64), primary_key=True)
    object_key: Mapped[str] = mapped_column(String(150), unique=True)
    byte_length: Mapped[int] = mapped_column(Integer)
    content_type: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=now)


class Document(Base, Identity):
    __tablename__ = "documents"
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="RESTRICT"), index=True)
    provider: Mapped[str] = mapped_column(String(20))
    external_id: Mapped[str] = mapped_column(String(100))
    title: Mapped[str] = mapped_column(String(500))
    form_type: Mapped[str] = mapped_column(String(100))
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    download_url: Mapped[str] = mapped_column(Text, nullable=False)
    published_at: Mapped[datetime] = mapped_column(UTCDateTime(), index=True)
    publication_date: Mapped[date] = mapped_column(Date)
    publication_precision: Mapped[str] = mapped_column(String(20))
    publication_timezone: Mapped[str] = mapped_column(String(60))
    ingested_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=now, index=True)
    provider_metadata: Mapped[dict] = mapped_column(JSON, default=dict)
    raw_sha256: Mapped[str] = mapped_column(ForeignKey("raw_blobs.sha256", ondelete="RESTRICT"))
    state: Mapped[str] = mapped_column(String(30), default="queued")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    __table_args__ = (
        UniqueConstraint("provider", "external_id", name="uq_document_provider_id"),
        CheckConstraint("length(source_url) > 0", name="ck_document_source_url"),
    )


class Chunk(Base, Identity):
    __tablename__ = "document_chunks"
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="RESTRICT"), index=True)
    ordinal: Mapped[int] = mapped_column(Integer)
    parser_version: Mapped[str] = mapped_column(String(40))
    text: Mapped[str] = mapped_column(Text)
    text_sha256: Mapped[str] = mapped_column(String(64))
    char_start: Mapped[int] = mapped_column(Integer)
    char_end: Mapped[int] = mapped_column(Integer)
    location: Mapped[str] = mapped_column(String(250))
    __table_args__ = (UniqueConstraint("document_id", "parser_version", "ordinal", name="uq_chunk"),)


class AIRun(Base, Identity):
    __tablename__ = "ai_runs"
    document_id: Mapped[str | None] = mapped_column(
        ForeignKey("documents.id", ondelete="RESTRICT"), index=True
    )
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    stage: Mapped[str] = mapped_column(String(40))
    model: Mapped[str] = mapped_column(String(100))
    model_version: Mapped[str | None] = mapped_column(String(100))
    prompt_version: Mapped[str] = mapped_column(String(80))
    pipeline_version: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(30), default="running", index=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(20, 8))
    error_code: Mapped[str | None] = mapped_column(String(100))
    validation_result: Mapped[dict] = mapped_column(JSON, default=dict)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class Event(Base, Identity):
    __tablename__ = "events"
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="RESTRICT"), index=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="RESTRICT"), index=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("ai_runs.id", ondelete="RESTRICT"))
    revision: Mapped[str] = mapped_column(String(100))
    title: Mapped[str] = mapped_column(String(500))
    event_type: Mapped[str] = mapped_column(String(40), index=True)
    state: Mapped[str] = mapped_column(String(30), default="needs_review", index=True)
    confidence: Mapped[float] = mapped_column(Float, default=0)
    materiality: Mapped[float] = mapped_column(Float, default=0)
    published_at: Mapped[datetime] = mapped_column(UTCDateTime(), index=True)
    duplicate_of: Mapped[str | None] = mapped_column(ForeignKey("events.id", ondelete="RESTRICT"))
    published_to_users_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    __table_args__ = (UniqueConstraint("document_id", "revision", name="uq_event_revision"),)


class Fact(Base, Identity):
    __tablename__ = "facts"
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id", ondelete="RESTRICT"), index=True)
    chunk_id: Mapped[str] = mapped_column(ForeignKey("document_chunks.id", ondelete="RESTRICT"))
    field: Mapped[str] = mapped_column(String(40))
    quote: Mapped[str] = mapped_column(Text)
    value_raw: Mapped[str | None] = mapped_column(String(100))
    unit: Mapped[str | None] = mapped_column(String(40))
    period: Mapped[str | None] = mapped_column(String(40))
    scope: Mapped[str] = mapped_column(String(30))
    basis: Mapped[str] = mapped_column(String(30))
    validation_status: Mapped[str] = mapped_column(String(30), default="supported")


class Change(Base, Identity):
    __tablename__ = "changes"
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id", ondelete="RESTRICT"), index=True)
    current_fact_id: Mapped[str] = mapped_column(ForeignKey("facts.id", ondelete="RESTRICT"))
    previous_fact_id: Mapped[str | None] = mapped_column(ForeignKey("facts.id", ondelete="RESTRICT"))
    field: Mapped[str] = mapped_column(String(40))
    change_type: Mapped[str] = mapped_column(String(40))
    comparison_kind: Mapped[str | None] = mapped_column(String(40))
    previous_value: Mapped[str | None] = mapped_column(Text)
    current_value: Mapped[str | None] = mapped_column(Text)
    absolute_change: Mapped[str | None] = mapped_column(String(100))
    percentage_change: Mapped[str | None] = mapped_column(String(100))
    materiality: Mapped[float] = mapped_column(Float, default=0)
    confidence: Mapped[float] = mapped_column(Float, default=0)
    __table_args__ = (UniqueConstraint("current_fact_id", name="uq_current_fact_change"),)


class EventSource(Base):
    __tablename__ = "event_sources"
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id", ondelete="RESTRICT"), primary_key=True)
    chunk_id: Mapped[str] = mapped_column(
        ForeignKey("document_chunks.id", ondelete="RESTRICT"), primary_key=True
    )
    role: Mapped[str] = mapped_column(String(20), primary_key=True)


class Brief(Base, Identity):
    __tablename__ = "briefs"
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id", ondelete="RESTRICT"), unique=True)
    headline: Mapped[str] = mapped_column(String(500))
    what_happened: Mapped[str] = mapped_column(Text)
    interpretation: Mapped[str] = mapped_column(Text)
    uncertainty: Mapped[str] = mapped_column(Text)
    monitor_next: Mapped[str] = mapped_column(Text)
    template_version: Mapped[str] = mapped_column(String(40))


class BriefSource(Base):
    __tablename__ = "brief_sources"
    brief_id: Mapped[str] = mapped_column(ForeignKey("briefs.id", ondelete="RESTRICT"), primary_key=True)
    fact_id: Mapped[str] = mapped_column(ForeignKey("facts.id", ondelete="RESTRICT"), primary_key=True)


class Validation(Base, Identity):
    __tablename__ = "validations"
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id", ondelete="RESTRICT"), index=True)
    claim_key: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(40), index=True)
    reason: Mapped[str] = mapped_column(String(500))
    validator_version: Mapped[str] = mapped_column(String(60))


class RankedEvent(Base, Identity):
    __tablename__ = "ranked_events"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id", ondelete="RESTRICT"))
    score: Mapped[float] = mapped_column(Float)
    breakdown: Mapped[dict] = mapped_column(JSON)
    scoring_version: Mapped[str] = mapped_column(String(40))
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=now, onupdate=now)
    __table_args__ = (UniqueConstraint("user_id", "event_id", name="uq_ranked_event"),)


class Alert(Base, Identity):
    __tablename__ = "alerts"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    event_types: Mapped[list] = mapped_column(JSON, default=list)
    min_score: Mapped[float] = mapped_column(Float, default=0.4)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class Notification(Base, Identity):
    __tablename__ = "notifications"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    alert_id: Mapped[str] = mapped_column(ForeignKey("alerts.id", ondelete="CASCADE"))
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id", ondelete="RESTRICT"))
    read_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    __table_args__ = (UniqueConstraint("alert_id", "event_id", name="uq_notification"),)


class CalendarItem(Base, Identity):
    __tablename__ = "calendar_items"
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    company_id: Mapped[str | None] = mapped_column(ForeignKey("companies.id", ondelete="RESTRICT"))
    event_id: Mapped[str | None] = mapped_column(ForeignKey("events.id", ondelete="RESTRICT"))
    title: Mapped[str] = mapped_column(String(200))
    occurs_on: Mapped[date] = mapped_column(Date, index=True)
    origin: Mapped[str] = mapped_column(String(20), default="user")
    chunk_id: Mapped[str | None] = mapped_column(ForeignKey("document_chunks.id", ondelete="RESTRICT"))
    quote: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (
        CheckConstraint(
            "(origin = 'user' AND user_id IS NOT NULL) OR "
            "(origin = 'official' AND chunk_id IS NOT NULL AND event_id IS NOT NULL)",
            name="ck_calendar_provenance",
        ),
    )


class Feedback(Base, Identity):
    __tablename__ = "feedback"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id", ondelete="RESTRICT"))
    rating: Mapped[str] = mapped_column(String(30))
    comment: Mapped[str] = mapped_column(String(1000), default="")
    state: Mapped[str] = mapped_column(String(30), default="open")
    __table_args__ = (UniqueConstraint("user_id", "event_id", name="uq_feedback"),)


class UserEvent(Base, Identity):
    __tablename__ = "user_events"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    event_name: Mapped[str] = mapped_column(String(60))
    properties: Mapped[dict] = mapped_column(JSON, default=dict)


class Job(Base, Identity):
    __tablename__ = "jobs"
    kind: Mapped[str] = mapped_column(String(40))
    dedupe_key: Mapped[str] = mapped_column(String(250), unique=True)
    payload: Mapped[dict] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=5)
    available_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=now, index=True)
    lease_until: Mapped[datetime | None] = mapped_column(UTCDateTime())
    lease_token: Mapped[str | None] = mapped_column(String(36))
    worker_id: Mapped[str | None] = mapped_column(String(100))
    last_error: Mapped[str | None] = mapped_column(String(500))
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    __table_args__ = (Index("ix_job_claim", "state", "available_at", "lease_until"),)


class ProviderLimit(Base):
    __tablename__ = "provider_limits"
    provider: Mapped[str] = mapped_column(String(40), primary_key=True)
    next_request_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=now)


class RateBucket(Base):
    __tablename__ = "rate_buckets"
    key: Mapped[str] = mapped_column(String(180), primary_key=True)
    hits: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime(), index=True)


class AuditLog(Base, Identity):
    __tablename__ = "audit_logs"
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    action: Mapped[str] = mapped_column(String(60))
    target_id: Mapped[str] = mapped_column(String(100))
    details: Mapped[dict] = mapped_column(JSON, default=dict)


class EvalResult(Base, Identity):
    __tablename__ = "eval_results"
    dataset_name: Mapped[str] = mapped_column(String(100))
    dataset_sha256: Mapped[str] = mapped_column(String(64))
    model_version: Mapped[str] = mapped_column(String(100))
    prompt_version: Mapped[str] = mapped_column(String(80))
    metrics: Mapped[dict] = mapped_column(JSON)


class Experiment(Base, Identity):
    __tablename__ = "experiments"
    name: Mapped[str] = mapped_column(String(100), unique=True)
    hypothesis: Mapped[str] = mapped_column(Text)
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
