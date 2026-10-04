from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .ai.schemas import EventType, ValidationStatus


class APIModel(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)


class CompanyOut(APIModel):
    id: str
    name: str
    ticker: str
    market: str
    provider: str
    is_demo: bool
    last_ingested_at: datetime | None


class MeOut(APIModel):
    id: str
    display_name: str
    density: Literal["beginner", "advanced"]
    onboarding_completed: bool
    analytics_consent: bool
    is_admin: bool
    demo_mode: bool


class ProfileUpdate(APIModel):
    display_name: str | None = Field(None, min_length=1, max_length=100)
    density: Literal["beginner", "advanced"] | None = None
    analytics_consent: bool | None = None


class OnboardingIn(APIModel):
    company_ids: list[str] = Field(min_length=3, max_length=20)
    analytics_consent: bool = False

    @field_validator("company_ids")
    @classmethod
    def unique_companies(cls, values):
        if len(set(values)) < 3:
            raise ValueError("Select at least three distinct companies")
        return list(dict.fromkeys(values))


class WatchlistOut(APIModel):
    id: str
    name: str
    items: list[CompanyOut]


class PositionIn(APIModel):
    quantity: Decimal = Field(gt=0, max_digits=28, decimal_places=8)
    average_cost: Decimal | None = Field(None, ge=0, max_digits=28, decimal_places=8)
    currency: Literal["USD", "KRW"] = "USD"


class PositionOut(APIModel):
    id: str
    company: CompanyOut
    quantity: str
    average_cost: str | None
    currency: str


class PortfolioOut(APIModel):
    id: str
    name: str
    positions: list[PositionOut]
    weighting_note: str


class RankingOut(APIModel):
    score: float
    version: str
    components: dict[str, float | None]
    effective_weights: dict[str, float]
    missing_components: list[str]
    reason: str
    portfolio_weight_method: str
    market_reaction: str


class ChangeSummary(APIModel):
    field: str
    previous_value: str | None
    current_value: str | None


class SourceDocumentSummary(APIModel):
    id: str
    title: str
    provider: str
    source_url: str
    published_at: datetime


class EventCard(APIModel):
    id: str
    company: CompanyOut
    event_type: str
    state: str
    headline: str
    what_happened: str
    confidence: float
    materiality: float
    published_at: datetime
    publication_precision: str
    is_demo: bool
    source_tier: int | None
    source_provider: str
    source_url: str
    ranking: RankingOut
    change_count: int
    fact_summary: str | None
    change_summary: list[ChangeSummary]
    interpretation: str | None
    source_document: SourceDocumentSummary


class FeedOut(APIModel):
    items: list[EventCard]
    total: int
    has_more: bool
    truncated: bool
    latest_ingested_at: datetime | None
    stale: bool
    demo_mode: bool
    generated_at: datetime


class DocumentOut(APIModel):
    id: str
    title: str
    provider: str
    source_url: str
    download_url: str
    published_at: datetime
    publication_date: date
    publication_precision: str
    publication_timezone: str
    ingested_at: datetime
    raw_sha256: str
    is_demo: bool


class FactOut(APIModel):
    id: str
    field: str
    quote: str
    chunk_id: str
    value_raw: str | None
    unit: str | None
    period: str | None
    scope: str
    basis: str
    validation_status: str


class ChangeOut(APIModel):
    id: str
    field: str
    current_fact_id: str
    previous_fact_id: str | None
    change_type: str
    comparison_kind: str | None
    previous_value: str | None
    current_value: str | None
    absolute_change: str | None
    percentage_change: str | None
    materiality: float
    confidence: float


class EvidenceOut(APIModel):
    fact_id: str
    chunk_id: str
    document_id: str
    quote: str
    location: str
    source_url: str
    source_name: str
    source_tier: int | None
    published_at: datetime
    publication_precision: str
    is_demo: bool
    role: Literal["current", "previous"]


class BriefOut(APIModel):
    headline: str
    what_happened: str
    interpretation: str
    uncertainty: str
    monitor_next: str
    template_version: str


class ValidationOut(APIModel):
    claim_key: str
    status: ValidationStatus
    reason: str
    validator_version: str


class RunOut(APIModel):
    id: str
    stage: str
    model: str
    model_version: str | None
    prompt_version: str
    pipeline_version: str
    status: str
    latency_ms: int | None
    input_tokens: int | None
    output_tokens: int | None
    cost_usd: Decimal | None
    error_code: str | None
    created_at: datetime
    finished_at: datetime | None
    validation_result: dict


class EventDetailOut(APIModel):
    event: EventCard
    document: DocumentOut
    facts: list[FactOut]
    changes: list[ChangeOut]
    evidence: list[EvidenceOut]
    brief: BriefOut
    validations: list[ValidationOut]
    run: RunOut


class QuestionIn(APIModel):
    question: str = Field(min_length=2, max_length=1000)


class AnswerEvidence(APIModel):
    source_id: str
    quote: str
    source_url: str
    location: str


class AnswerOut(APIModel):
    status: Literal["answered", "abstained", "unavailable", "policy_blocked"]
    message: str
    evidence: list[AnswerEvidence]
    run_id: str | None
    mode: Literal["extractive", "demo"]


class AlertIn(APIModel):
    name: str = Field(min_length=1, max_length=100)
    event_types: list[EventType] = Field(default_factory=list, max_length=7)
    min_score: float = Field(0.4, ge=0, le=1)
    enabled: bool = True


class AlertOut(AlertIn):
    id: str
    created_at: datetime


class CalendarIn(APIModel):
    title: str = Field(min_length=1, max_length=200)
    occurs_on: date
    company_id: str | None = None


class CalendarOut(APIModel):
    id: str
    title: str
    occurs_on: date
    company_id: str | None
    event_id: str | None
    origin: str
    quote: str | None
    source_url: str | None
    is_demo: bool


class FeedbackIn(APIModel):
    rating: Literal["helpful", "unclear", "wrong_evidence"]
    comment: str = Field("", max_length=1000)


class AnalyticsIn(APIModel):
    event_name: Literal[
        "sign_up",
        "login",
        "onboarding_started",
        "watchlist_added",
        "onboarding_completed",
        "brief_impression",
        "brief_opened",
        "evidence_opened",
        "followup_asked",
        "feedback_submitted",
        "density_changed",
        "alert_created",
        "calendar_opened",
    ]
    properties: dict[str, str | int | bool] = Field(default_factory=dict)

    @field_validator("properties")
    @classmethod
    def only_nonsensitive_properties(cls, value):
        allowed = {"event_id", "company_id", "density", "screen", "count"}
        if set(value) - allowed or any(len(str(x)) > 100 for x in value.values()):
            raise ValueError("Only documented non-sensitive analytics properties are accepted")
        return value


class AdminAction(APIModel):
    action: Literal["approve", "reject", "rerun", "mark_duplicate"]
    reason: str = Field(min_length=5, max_length=500)
    duplicate_of: str | None = None


class IngestIn(APIModel):
    company_id: str
    external_id: str | None = Field(None, max_length=100)
    lookback_days: int = Field(7, ge=1, le=3650)


class CatalogSyncIn(APIModel):
    provider: Literal["dart", "sec"]
