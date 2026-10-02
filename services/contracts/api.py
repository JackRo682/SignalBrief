"""User-safe transport components; no routes or authorization implementation."""

from decimal import Decimal
from typing import Literal, Self, TypeVar

from pydantic import Field, model_validator

from services.contracts.domain import (
    Change,
    Claim,
    EventType,
    EvidenceStatus,
    Fact,
    Locator,
    SourceDocument,
    Validation,
)
from services.contracts.scalars import (
    Contract,
    Date,
    DecimalString,
    Fraction,
    Hash,
    Id,
    Ids,
    Name,
    Nonnegative,
    Positive,
    Reason,
    Text,
    Url,
    Utc,
    Version,
    ordered,
    require,
)

AccountState = Literal["active", "disabled", "deletion_pending", "deleted"]
RunState = Literal["queued", "running", "needs_review", "succeeded", "failed", "blocked"]
JobState = Literal[
    "queued", "running", "retry_wait", "succeeded", "failed", "dead_letter", "canceled"
]


class Meta(Contract):
    request_id: Id
    schema_version: Literal["1"]
    server_time: Utc


class ListMeta(Meta):
    next_cursor: Name | None


T = TypeVar("T")


class Success[T](Contract):
    data: T
    meta: Meta


class ListSuccess[T](Contract):
    data: list[T]
    meta: ListMeta


class FieldError(Contract):
    field: Name
    code: Reason
    message: Text


class ErrorDetail(Contract):
    code: Literal[
        "invalid_request",
        "unauthenticated",
        "forbidden",
        "not_found",
        "version_conflict",
        "outdated_revision",
        "idempotency_conflict",
        "validation_error",
        "quota_exceeded",
        "service_unavailable",
        "precondition_required",
    ]
    message: Text
    retryable: bool
    field_errors: list[FieldError] | None
    request_id: Id


class ErrorMeta(Contract):
    schema_version: Literal["1"]


class ErrorResponse(Contract):
    error: ErrorDetail
    meta: ErrorMeta


class Profile(Contract):
    id: Id
    timezone: Name
    locale: Name
    onboarding_completed_at: Utc | None
    analytics_consent: bool
    consent_version: Version | None
    account_state: AccountState
    row_version: Positive


class Instrument(Contract):
    ticker: Name
    exchange: Name


class Coverage(Contract):
    state: Literal["current", "coverage_pending", "source_delayed", "unsupported"]
    indexed_from: Date | None
    last_complete_poll_at: Utc | None
    supported_forms: list[Name]
    gaps: list[Reason]


class Company(Contract):
    id: Id
    display_name: Name
    legal_name: Name
    market: Name
    instruments: list[Instrument]
    coverage: Coverage


class WatchlistItem(Contract):
    id: Id
    company: Company
    created_at: Utc


class Position(Contract):
    id: Id
    company_id: Id
    manual_weight: Fraction | None
    weight_confirmed_at: Utc | None


class Portfolio(Contract):
    id: Id
    name: Name
    positions: list[Position]
    known_weight_total: DecimalString
    weights_complete: bool
    row_version: Positive

    @model_validator(mode="after")
    def weights(self) -> Self:
        require(len({p.id for p in self.positions}) == len(self.positions), "duplicate positions")
        require(
            len({p.company_id for p in self.positions}) == len(self.positions),
            "duplicate companies",
        )
        known = sum(
            (Decimal(p.manual_weight) for p in self.positions if p.manual_weight is not None),
            Decimal(0),
        )
        require(known == Decimal(self.known_weight_total) and known <= 1, "weight total mismatch")
        require(
            self.weights_complete
            == (bool(self.positions) and all(p.manual_weight is not None for p in self.positions)),
            "weight completeness mismatch",
        )
        return self


class PublicationFields(Contract):
    publication_date: Date
    publication_at: Utc | None
    precision: Literal["date", "minute", "second"]
    source_timezone: Name | None

    @model_validator(mode="after")
    def precision_time(self) -> Self:
        require(
            (self.precision == "date") == (self.publication_at is None),
            "publication precision mismatch",
        )
        return self


class Ranking(Contract):
    total: Fraction
    reason_codes: list[Reason]
    version: Version


class FeedItem(PublicationFields):
    event_id: Id
    brief_id: Id
    revision: Positive
    company: Company
    title: Text
    summary_claims: list[Claim]
    event_type: EventType
    change_status: Literal["new", "changed", "unchanged", "not_comparable"]
    evidence_status: EvidenceStatus
    source_count: Nonnegative
    ranking: Ranking
    read_state: Literal["unread", "read"]
    correction_state: Literal["none", "corrected", "withdrawn"]


class EventDetail(PublicationFields):
    event_id: Id
    brief_id: Id
    revision: Positive
    company: Company
    event_type: EventType
    state: Literal["published", "superseded", "withdrawn"]
    facts: list[Fact]
    comparisons: list[Change]
    claims: list[Claim]
    limitations: list[Text]
    prior_event_ids: Ids
    canonical_event_id: Id | None
    duplicate_state: Literal["canonical", "alias"]
    source_refs: list[SourceDocument]
    interpretation_claim_ids: Ids
    next_check_claim_ids: Ids


class EvidenceItem(PublicationFields):
    span_id: Id
    parsed_artifact_id: Id
    parser_version: Version
    canonical_text_hash: Hash
    document_id: Id
    source_tier: int = Field(ge=1, le=4)
    issuer_id: Id
    document_title: Name
    locator: Locator
    exact_excerpt: Text
    language: Name
    translation: Text | None
    original_url: Url
    source_availability: Literal["available", "unavailable"]
    document_hash: Hash


class QuestionResult(Contract):
    id: Id
    brief_id: Id
    revision: Positive
    state: Literal["queued", "running", "answered", "abstained", "refused", "failed", "canceled"]
    claims: list[Claim] | None
    limitations: list[Text] | None
    failure_code: Reason | None
    created_at: Utc
    completed_at: Utc | None

    @model_validator(mode="after")
    def question_state(self) -> Self:
        pending = self.state in ("queued", "running")
        require(pending == (self.completed_at is None), "question finish mismatch")
        if self.completed_at is not None:
            ordered(self.created_at, self.completed_at)
        if self.state == "answered":
            require(
                bool(self.claims) and all(c.validation_status == "pass" for c in self.claims or []),
                "answer needs validated claims",
            )
        if self.state != "answered":
            require(not self.claims, "non-answer cannot display claims")
        return self


class CalendarItem(Contract):
    id: Id
    company_id: Id
    kind: Literal["results", "meeting", "dividend", "other"]
    date_local: Date | None
    time_at: Utc | None
    precision: Literal["unknown", "date", "minute", "second"]
    timezone: Name | None
    date_status: Literal["confirmed", "estimated", "unknown", "canceled"]
    evidence_span_id: Id
    supersedes_id: Id | None
    checked_at: Utc


class AccuracyNotice(Contract):
    id: Id
    accuracy_action_id: Id
    event_id: Id
    affected_brief_id: Id
    replacement_brief_id: Id | None
    kind: Literal["correction", "withdrawal"]
    reason_code: Reason
    safe_summary: Text
    action_at: Utc
    created_at: Utc
    acknowledged_at: Utc | None
    visible_canonical_event_id: Id | None


class Notification(Contract):
    id: Id
    event_id: Id
    brief_id: Id
    kind: Literal["normal"]
    created_at: Utc
    read_at: Utc | None


class StageSummary(Contract):
    stage: Reason
    status: Literal["ok", "retryable", "blocked", "skipped"]
    reason_codes: list[Reason]


class ModelCall(Contract):
    requested_model: Name
    returned_model: Name | None
    snapshot: Name | None
    prompt_version: Version
    prompt_hash: Hash
    input_hash: Hash
    schema_version: Version
    price_table_version: Version
    called_at: Utc
    input_tokens: Nonnegative | None
    output_tokens: Nonnegative | None
    latency_ms: Nonnegative | None
    usd: DecimalString | None


class Cost(Contract):
    usd: DecimalString | None
    complete: bool

    @model_validator(mode="after")
    def cost_known(self) -> Self:
        require(self.complete == (self.usd is not None), "cost completeness mismatch")
        require(self.usd is None or Decimal(self.usd) >= 0, "negative cost")
        return self


class OpsRun(Contract):
    id: Id
    subject_id: Id
    state: RunState
    config_version: Version
    stage_summaries: list[StageSummary]
    validators: list[Validation]
    source_ids: Ids
    model_calls: list[ModelCall]
    cost: Cost
    latency_ms: Nonnegative | None
    review_state: Literal["pending", "approved", "rejected", "not_required"]
