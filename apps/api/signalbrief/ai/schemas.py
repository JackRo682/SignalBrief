from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

EventType = Literal["earnings", "guidance", "capex", "dividend", "management", "risk", "other"]
FactField = Literal[
    "revenue", "operating_income", "guidance", "capex", "dividend", "management_change", "risk_change"
]
Unit = Literal[
    "USD", "USD million", "USD billion", "KRW", "KRW million", "KRW billion", "KRW 억원", "%", "shares"
]
ValidationStatus = Literal[
    "supported",
    "partially_supported",
    "unsupported",
    "conflicting_sources",
    "numeric_mismatch",
    "missing_source",
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ExtractedFact(StrictModel):
    field: FactField
    chunk_id: str
    quote: str = Field(min_length=5, max_length=2500)
    value_raw: str | None
    unit: Unit | None
    period: str | None
    scope: Literal["consolidated", "separate", "unknown"]
    basis: Literal["actual", "guidance", "unknown"]


class ScheduledDate(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    date_iso: str
    chunk_id: str
    quote: str = Field(min_length=5, max_length=1000)


class ExtractionBatch(StrictModel):
    event_type: EventType
    facts: list[ExtractedFact] = Field(max_length=100)
    scheduled_dates: list[ScheduledDate] = Field(max_length=15)


class CitationVerdict(StrictModel):
    status: ValidationStatus
    reason: str
    claim_key: str


class AnswerQuote(StrictModel):
    source_id: str
    quote: str


class ExtractiveAnswer(StrictModel):
    # The model selects verbatim evidence. Free-form financial assertions are not rendered.
    quotes: list[AnswerQuote] = Field(max_length=5)
    abstain: bool


class SemanticComparison(StrictModel):
    has_meaningful_change: bool
    previous_quote: str
    current_quote: str
    uncertainty: Literal["requires_human_review", "insufficient_context"]
