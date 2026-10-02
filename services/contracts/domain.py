import hashlib
from decimal import Decimal
from typing import Literal, Self

from pydantic import Field, model_validator

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
    Period,
    Positive,
    Reason,
    Text,
    Url,
    Utc,
    Version,
    bounded_references,
    ordered,
    require,
)

EventType = Literal[
    "financial_results",
    "guidance",
    "capital_allocation",
    "shareholder_return",
    "governance",
    "material_risk",
    "other",
]
Unit = Literal[
    "currency", "count", "ratio", "percent", "percentage_point", "shares", "text", "date", "unknown"
]
Duration = Literal["instant", "quarter", "YTD", "year", "forward", "none"]
EvidenceStatus = Literal["adequate", "limited", "conflicting_evidence", "unavailable"]
PublicationState = Literal["candidate", "published", "superseded", "withdrawn", "rejected"]
EventStatus = Literal[
    "discovered", "normalized", "needs_review", "published", "withdrawn", "duplicate", "rejected"
]
Verdict = Literal["pass", "fail", "uncertain", "not_applicable"]
ComparisonStatus = Literal["comparable", "missing_baseline", "ambiguous", "incompatible"]


class SourceDocument(Contract):
    document_id: Id
    source_id: Id
    provider_external_id: Name
    version_hash: Hash
    issuer_id: Id
    original_url: Url
    tier: int = Field(ge=1, le=4)
    language: Name
    content_type: Name
    publication_date: Date
    publication_at: Utc | None
    time_precision: Literal["date", "minute", "second"]
    source_timezone: Name | None
    first_seen_at: Utc
    retrieved_at: Utc
    supersedes_document_id: Id | None

    @model_validator(mode="after")
    def consistency(self) -> Self:
        require(
            (self.time_precision == "date") == (self.publication_at is None),
            "date precision/time mismatch",
        )
        require(self.supersedes_document_id != self.document_id, "self supersession")
        ordered(self.first_seen_at, self.retrieved_at)
        return self


class FetchReceipt(Contract):
    receipt_id: Id
    source_id: Id
    provider_external_id: Name
    requested_at: Utc
    finished_at: Utc
    outcome: Literal["fetched", "not_modified", "retryable", "quarantined", "blocked"]
    http_status: int | None = Field(ge=100, le=599)
    document_id: Id | None
    content_hash: Hash | None
    bytes_received: Nonnegative
    attempt: Positive
    reason_codes: list[Reason]
    validator_version: Version

    @model_validator(mode="after")
    def consistency(self) -> Self:
        ordered(self.requested_at, self.finished_at)
        if self.outcome in ("fetched", "not_modified"):
            require(
                self.document_id is not None and self.content_hash is not None,
                "document/hash required",
            )
        else:
            require(bool(self.reason_codes), "failure needs reason")
        return self


class ParserDiagnostics(Contract):
    parser_name: Name
    parser_version: Version
    parser_config_hash: Hash
    output_schema_version: Version
    source_hash: Hash
    parsed_artifact_id: Id | None
    canonical_text_hash: Hash | None
    status: Literal["parsed", "quarantined", "failed"]
    text_codepoint_count: Nonnegative
    page_count: Nonnegative | None
    table_count: Nonnegative
    reason_codes: list[Reason]
    validation_ids: Ids

    @model_validator(mode="after")
    def consistency(self) -> Self:
        if self.status == "parsed":
            require(
                self.parsed_artifact_id is not None and self.canonical_text_hash is not None,
                "parsed identity required",
            )
            require(self.text_codepoint_count > 0, "parsed text must be usable")
        else:
            require(bool(self.reason_codes), "parser failure reason required")
        return self


class ParsedArtifact(Contract):
    parsed_artifact_id: Id
    document_id: Id
    document_version_hash: Hash
    parser_name: Name
    parser_version: Version
    parser_config_hash: Hash
    output_schema_version: Version
    canonical_text_hash: Hash
    canonical_text_object_key: Name
    language: Name
    parse_state: Literal["parsed", "quarantined"]
    diagnostics: ParserDiagnostics

    @model_validator(mode="after")
    def consistency(self) -> Self:
        d = self.diagnostics
        require(d.status == self.parse_state, "artifact state disagrees with diagnostics")
        require(
            (
                d.parser_name,
                d.parser_version,
                d.parser_config_hash,
                d.output_schema_version,
                d.source_hash,
            )
            == (
                self.parser_name,
                self.parser_version,
                self.parser_config_hash,
                self.output_schema_version,
                self.document_version_hash,
            ),
            "parser provenance mismatch",
        )
        if self.parse_state == "parsed":
            require(
                d.parsed_artifact_id == self.parsed_artifact_id
                and d.canonical_text_hash == self.canonical_text_hash,
                "artifact identity mismatch",
            )
        return self


class Locator(Contract):
    page: Positive | None
    section: Name | None
    table: Name | None
    row: Name | None
    column: Name | None
    start_offset: Nonnegative
    end_offset: Positive

    @model_validator(mode="after")
    def consistency(self) -> Self:
        require(self.end_offset > self.start_offset, "empty/reversed locator")
        require(
            any(x is not None for x in (self.page, self.section, self.table)),
            "usable locator required",
        )
        return self


class SourceSpan(Contract):
    span_id: Id
    parsed_artifact_id: Id
    document_id: Id
    document_version_hash: Hash
    canonical_text_hash: Hash
    locator: Locator
    exact_text: Text
    text_hash: Hash

    @model_validator(mode="after")
    def consistency(self) -> Self:
        require(
            len(self.exact_text) == self.locator.end_offset - self.locator.start_offset,
            "codepoint length mismatch",
        )
        require(
            hashlib.sha256(self.exact_text.encode()).hexdigest() == self.text_hash,
            "span hash mismatch",
        )
        return self


class Fact(Period):
    fact_id: Id
    event_id: Id
    metric_key: Reason
    original_literal: Text
    value_type: Literal["number", "range", "text", "date"]
    value_decimal: DecimalString | None
    low: DecimalString | None
    high: DecimalString | None
    text_value: Text | None
    date_value: Date | None
    unit: Unit
    currency: str | None = Field(pattern=r"^[A-Z]{3}$")
    scale_decimal: DecimalString
    duration_kind: Duration
    accounting_basis: Name | None
    consolidation_scope: Name | None
    segment: Name | None
    forward_looking: bool
    evidence_span_ids: Ids

    @model_validator(mode="after")
    def consistency(self) -> Self:
        shapes = {
            "number": (True, False, False, False, False),
            "range": (False, True, True, False, False),
            "text": (False, False, False, True, False),
            "date": (False, False, False, False, True),
        }
        require(
            tuple(
                x is not None
                for x in (self.value_decimal, self.low, self.high, self.text_value, self.date_value)
            )
            == shapes[self.value_type],
            "value representation mismatch",
        )
        require(Decimal(self.scale_decimal) > 0, "scale must be positive")
        if self.low is not None and self.high is not None:
            require(Decimal(self.low) <= Decimal(self.high), "range reversed")
        require((self.unit == "currency") == (self.currency is not None), "currency/unit mismatch")
        require(self.value_type != "text" or self.unit == "text", "text unit required")
        require(self.value_type != "date" or self.unit == "date", "date unit required")
        require(
            self.value_type not in ("number", "range") or self.unit not in ("text", "date"),
            "numeric unit required",
        )
        require(bool(self.evidence_span_ids), "fact evidence required")
        return self


class ComparisonContext(Period):
    issuer_id: Id
    metric_key: Reason
    unit: Unit
    currency: str | None = Field(pattern=r"^[A-Z]{3}$")
    duration_kind: Duration
    accounting_basis: Name | None
    consolidation_scope: Name | None
    segment: Name | None

    @model_validator(mode="after")
    def consistency(self) -> Self:
        require((self.unit == "currency") == (self.currency is not None), "currency/unit mismatch")
        return self


class Event(Contract):
    event_id: Id
    issuer_id: Id
    event_type: EventType
    effective_date: Date | None
    target_period: Period | None
    source_document_ids: Ids
    fact_ids: Ids
    first_published_at: Utc | None
    publication_date: Date
    canonical_key: Name
    amendment_of_event_id: Id | None
    canonical_event_id: Id | None
    event_status: EventStatus

    @model_validator(mode="after")
    def consistency(self) -> Self:
        require(bool(self.source_document_ids), "event source required")
        require(
            self.event_id not in (self.amendment_of_event_id, self.canonical_event_id),
            "self event link",
        )
        require(
            (self.event_status == "duplicate") == (self.canonical_event_id is not None),
            "duplicate pointer/state mismatch",
        )
        return self


class PriorMatch(Contract):
    event_id: Id
    candidate_ids: Ids
    selected_id: Id | None
    match_status: Literal["matched", "missing", "ambiguous", "incompatible"]
    compared_context: ComparisonContext
    rationale_codes: list[Reason]
    retrieval_as_of: Utc

    @model_validator(mode="after")
    def consistency(self) -> Self:
        require(
            (self.match_status == "matched") == (self.selected_id is not None),
            "selected prior/status mismatch",
        )
        require(self.event_id not in self.candidate_ids, "current event cannot be prior")
        if self.selected_id is not None:
            require(self.selected_id in self.candidate_ids, "selected prior not a candidate")
            c = self.compared_context
            require(
                c.duration_kind == "none"
                or (c.period_start is not None and c.period_end is not None),
                "unknown period cannot match",
            )
            require(
                c.unit != "unknown"
                and c.accounting_basis is not None
                and c.consolidation_scope is not None,
                "unknown context cannot match",
            )
        else:
            require(bool(self.rationale_codes), "non-match reason required")
        return self


class Change(Contract):
    change_id: Id
    event_id: Id
    current_fact_id: Id
    previous_fact_id: Id | None
    kind: Literal[
        "new", "increased", "decreased", "unchanged", "revised", "withdrawn", "not_comparable"
    ]
    absolute_delta: DecimalString | None
    percent_delta: DecimalString | None
    percentage_point_delta: DecimalString | None
    comparison_status: ComparisonStatus
    reason_codes: list[Reason]
    calculation_version: Version

    @model_validator(mode="after")
    def consistency(self) -> Self:
        require(self.current_fact_id != self.previous_fact_id, "self fact comparison")
        if self.comparison_status != "comparable":
            require(
                all(
                    x is None
                    for x in (self.absolute_delta, self.percent_delta, self.percentage_point_delta)
                ),
                "incomparable deltas prohibited",
            )
            require(bool(self.reason_codes), "incomparable reason required")
        if any(
            x is not None
            for x in (self.absolute_delta, self.percent_delta, self.percentage_point_delta)
        ):
            require(self.previous_fact_id is not None, "delta needs baseline")
        require(
            self.percent_delta is None or self.percentage_point_delta is None,
            "percent and pp cannot coexist",
        )
        return self


class Claim(Contract):
    claim_id: Id
    kind: Literal["fact", "comparison", "interpretation", "next_check"]
    text: Text
    fact_ids: Ids
    change_ids: Ids
    citation_span_ids: Ids
    material: bool
    uncertainty_codes: list[Reason]
    validation_status: Verdict

    @model_validator(mode="after")
    def consistency(self) -> Self:
        if self.kind in ("fact", "comparison"):
            require(self.material, "checkable claim must be material")
        if self.validation_status == "pass" and self.material:
            require(bool(self.citation_span_ids), "passing material claim needs citations")
            require(bool(self.fact_ids or self.change_ids), "passing claim needs premises")
        return self


class Analysis(Contract):
    brief_id: Id
    revision: Positive
    event_id: Id
    run_id: Id
    title: Text
    summary: Text
    claims: list[Claim]
    title_claim_ids: Ids
    summary_claim_ids: Ids
    interpretation_claim_ids: Ids
    next_check_claim_ids: Ids
    evidence_status: EvidenceStatus
    limitations: list[Text]
    language: Name
    publication_state: PublicationState
    supersedes_brief_id: Id | None

    @model_validator(mode="after")
    def consistency(self) -> Self:
        ids = [claim.claim_id for claim in self.claims]
        require(len(ids) == len(set(ids)), "duplicate claim IDs")
        bounded_references(self.title_claim_ids, ids, "title")
        bounded_references(self.summary_claim_ids, ids, "summary")
        require(
            bool(self.title_claim_ids) and bool(self.summary_claim_ids),
            "title/summary claims required",
        )
        bounded_references(
            self.interpretation_claim_ids,
            [c.claim_id for c in self.claims if c.kind == "interpretation"],
            "interpretation",
        )
        bounded_references(
            self.next_check_claim_ids,
            [c.claim_id for c in self.claims if c.kind == "next_check"],
            "next_check",
        )
        require(self.brief_id != self.supersedes_brief_id, "self brief supersession")
        if self.publication_state == "published":
            require(
                self.evidence_status != "unavailable" and bool(self.claims),
                "unavailable/empty analysis cannot publish",
            )
            require(
                all(not c.material or c.validation_status == "pass" for c in self.claims),
                "unvalidated material claim",
            )
        return self


class Validation(Contract):
    validation_id: Id
    run_id: Id
    subject_id: Id
    check_type: Reason
    result: Verdict
    severity: Literal["info", "blocking"]
    reason_code: Reason
    evidence_ids: Ids
    checker_version: Version
    checked_at: Utc


class ScoreBreakdown(Contract):
    event_id: Id
    materiality: Fraction
    relevance: Fraction
    novelty: Fraction
    recency: Fraction
    total: Fraction
    scoring_version: Version
    reason_codes: list[Reason]


class CommitReceipt(Contract):
    decision_id: Id
    run_id: Id
    event_id: Id
    brief_id: Id
    outbox_id: Id
    lease_token: Id
    revision: Positive
    committed_at: Utc


class PublicationDecision(Contract):
    decision_id: Id
    run_id: Id
    event_id: Id
    candidate_brief_id: Id | None
    expected_current_brief_id: Id | None
    decision: Literal["publish", "needs_review", "reject", "withhold"]
    gate_policy_version: Version
    validation_ids: Ids
    validations: list[Validation]
    review_required: bool
    reviewer_action_id: Id | None
    reason_codes: list[Reason]
    decided_at: Utc
    publication_outbox_id: Id | None
    commit_receipt: CommitReceipt | None

    @model_validator(mode="after")
    def consistency(self) -> Self:
        require(
            set(self.validation_ids) == {v.validation_id for v in self.validations}
            and len(self.validation_ids) == len(self.validations),
            "validation set mismatch",
        )
        require(all(v.run_id == self.run_id for v in self.validations), "validation run mismatch")
        if self.decision == "publish":
            require(
                self.candidate_brief_id is not None and bool(self.validations),
                "publication requires candidate/validation",
            )
            require(
                all(v.result == "pass" for v in self.validations if v.severity == "blocking"),
                "blocking gate not passed",
            )
            required_checks = {
                "source_identity",
                "source_rights",
                "parser",
                "issuer",
                "numeric",
                "citation",
                "semantic",
                "contradiction",
                "policy",
            }
            require(
                required_checks
                <= {
                    v.check_type
                    for v in self.validations
                    if v.severity == "blocking" and v.result == "pass"
                },
                "required hard gate missing",
            )
            require(
                not self.review_required or self.reviewer_action_id is not None, "review required"
            )
        else:
            require(
                self.publication_outbox_id is None and self.commit_receipt is None,
                "non-publish cannot commit",
            )
            require(bool(self.reason_codes), "withheld/rejected decision needs reason")
        require(
            (self.commit_receipt is None) == (self.publication_outbox_id is None),
            "outbox/receipt mismatch",
        )
        if self.commit_receipt is not None:
            r = self.commit_receipt
            require(
                (r.decision_id, r.run_id, r.event_id, r.brief_id, r.outbox_id)
                == (
                    self.decision_id,
                    self.run_id,
                    self.event_id,
                    self.candidate_brief_id,
                    self.publication_outbox_id,
                ),
                "commit receipt identity mismatch",
            )
            ordered(self.decided_at, r.committed_at)
        return self


class FinalDisposition(Contract):
    run_id: Id
    outcome: Literal[
        "published",
        "fact_only",
        "needs_review",
        "abstained",
        "refused",
        "rejected",
        "failed",
        "blocked",
    ]
    evidence_status: EvidenceStatus
    limitations: list[Text]
    reason_codes: list[Reason]
    validation_ids: Ids
    publication_decision_id: Id | None
    publication_decision: PublicationDecision | None
    finished_at: Utc | None

    @model_validator(mode="after")
    def consistency(self) -> Self:
        require(
            (self.outcome == "needs_review") == (self.finished_at is None),
            "terminal finish/status mismatch",
        )
        d = self.publication_decision
        require(
            (d is None) == (self.publication_decision_id is None), "decision reference unresolved"
        )
        if d is not None:
            require(
                d.decision_id == self.publication_decision_id and d.run_id == self.run_id,
                "decision identity mismatch",
            )
            require(
                set(d.validation_ids) <= set(self.validation_ids),
                "decision validation refs missing",
            )
        if self.outcome in ("published", "fact_only"):
            require(
                d is not None and d.decision == "publish" and d.commit_receipt is not None,
                "committed publication required",
            )
            require(self.evidence_status != "unavailable", "unavailable evidence cannot publish")
            if self.finished_at is not None and d is not None and d.commit_receipt is not None:
                ordered(d.commit_receipt.committed_at, self.finished_at)
        else:
            require(d is None or d.decision != "publish", "non-publication cannot embed publish")
            require(bool(self.reason_codes), "non-publication reason required")
        return self
