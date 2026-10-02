"""Typed boundaries, not stage algorithms or a job execution interface."""

from typing import Annotated, Literal, Self

from pydantic import Field, TypeAdapter, model_validator

from services.contracts.api import Position, StageSummary
from services.contracts.domain import (
    Analysis,
    Change,
    Claim,
    Event,
    EventType,
    Fact,
    FetchReceipt,
    FinalDisposition,
    ParsedArtifact,
    ParserDiagnostics,
    PriorMatch,
    PublicationDecision,
    SourceDocument,
    SourceSpan,
    Validation,
)
from services.contracts.scalars import (
    Contract,
    Fraction,
    Hash,
    Id,
    Ids,
    Name,
    Reason,
    Utc,
    Version,
    bounded_references,
    ordered,
    require,
)


class EvidenceBundle(Contract):
    documents: list[SourceDocument]
    artifacts: list[ParsedArtifact]
    spans: list[SourceSpan]

    @model_validator(mode="after")
    def provenance(self) -> Self:
        docs = {d.document_id: d for d in self.documents}
        artifacts = {a.parsed_artifact_id: a for a in self.artifacts}
        require(len(docs) == len(self.documents), "duplicate documents")
        require(len(artifacts) == len(self.artifacts), "duplicate artifacts")
        require(len({s.span_id for s in self.spans}) == len(self.spans), "duplicate spans")
        for a in self.artifacts:
            require(a.document_id in docs, "artifact document unresolved")
            require(
                docs[a.document_id].version_hash == a.document_version_hash, "raw hash mismatch"
            )
        for s in self.spans:
            require(s.parsed_artifact_id in artifacts, "span artifact unresolved")
            a = artifacts[s.parsed_artifact_id]
            require(a.parse_state == "parsed", "quarantined artifact cannot support span")
            require(
                (s.document_id, s.document_version_hash, s.canonical_text_hash)
                == (a.document_id, a.document_version_hash, a.canonical_text_hash),
                "span artifact identity mismatch",
            )
            require(
                s.locator.end_offset <= a.diagnostics.text_codepoint_count, "span outside artifact"
            )
        return self


class FactBundle(EvidenceBundle):
    events: list[Event]
    facts: list[Fact]

    @model_validator(mode="after")
    def fact_references(self) -> Self:
        events = {e.event_id: e for e in self.events}
        facts = {f.fact_id: f for f in self.facts}
        require(
            len(events) == len(self.events) and len(facts) == len(self.facts),
            "duplicate event/fact",
        )
        span_docs = {s.span_id: s.document_id for s in self.spans}
        docs = {d.document_id: d for d in self.documents}
        for e in self.events:
            bounded_references(e.source_document_ids, list(docs), "event source")
            require(
                all(docs[d].issuer_id == e.issuer_id for d in e.source_document_ids),
                "cross-issuer document",
            )
            require(
                set(e.fact_ids) == {f.fact_id for f in self.facts if f.event_id == e.event_id},
                "event fact references differ",
            )
            if e.canonical_event_id is not None:
                require(e.canonical_event_id in events, "canonical root unresolved")
                root = events[e.canonical_event_id]
                require(
                    root.issuer_id == e.issuer_id and root.canonical_event_id is None,
                    "canonical root/issuer mismatch",
                )
        for f in self.facts:
            require(f.event_id in events, "fact event unresolved")
            bounded_references(f.evidence_span_ids, list(span_docs), "fact evidence")
            require(
                all(
                    span_docs[s] in events[f.event_id].source_document_ids
                    for s in f.evidence_span_ids
                ),
                "fact evidence outside event",
            )
        return self


class ClaimBundle(FactBundle):
    changes: list[Change]
    claims: list[Claim]

    @model_validator(mode="after")
    def claim_references(self) -> Self:
        facts = {f.fact_id: f for f in self.facts}
        changes = {c.change_id: c for c in self.changes}
        require(len(changes) == len(self.changes), "duplicate changes")
        require(len({c.claim_id for c in self.claims}) == len(self.claims), "duplicate claims")
        for change in self.changes:
            require(change.current_fact_id in facts, "current fact unresolved")
            current = facts[change.current_fact_id]
            require(current.event_id == change.event_id, "change event mismatch")
            if change.previous_fact_id is not None:
                require(change.previous_fact_id in facts, "prior fact unresolved")
                previous = facts[change.previous_fact_id]
                if change.comparison_status == "comparable":
                    issuers = {e.event_id: e.issuer_id for e in self.events}
                    require(
                        issuers[current.event_id] == issuers[previous.event_id],
                        "cross-issuer comparison",
                    )
                    require(
                        current.duration_kind == "none"
                        or all(
                            p is not None
                            for p in (
                                current.period_start,
                                current.period_end,
                                previous.period_start,
                                previous.period_end,
                            )
                        ),
                        "unknown comparison period",
                    )
                    require(
                        current.unit != "unknown"
                        and current.accounting_basis is not None
                        and current.consolidation_scope is not None,
                        "unknown comparison context",
                    )
                    require(
                        (
                            current.metric_key,
                            current.unit,
                            current.currency,
                            current.duration_kind,
                            current.accounting_basis,
                            current.consolidation_scope,
                            current.segment,
                        )
                        == (
                            previous.metric_key,
                            previous.unit,
                            previous.currency,
                            previous.duration_kind,
                            previous.accounting_basis,
                            previous.consolidation_scope,
                            previous.segment,
                        ),
                        "incompatible comparison context",
                    )
                    if change.percent_delta is not None:
                        from decimal import Decimal

                        require(
                            current.unit not in ("ratio", "percent", "percentage_point"),
                            "rate percentage prohibited",
                        )
                        require(
                            previous.value_decimal is not None
                            and current.value_decimal is not None,
                            "percent needs numeric pair",
                        )
                        if previous.value_decimal is not None and current.value_decimal is not None:
                            require(
                                Decimal(previous.value_decimal) > 0
                                and Decimal(current.value_decimal) >= 0,
                                "percent baseline/sign invalid",
                            )
        for claim in self.claims:
            bounded_references(claim.fact_ids, list(facts), "claim fact")
            bounded_references(claim.change_ids, list(changes), "claim change")
            bounded_references(
                claim.citation_span_ids, [s.span_id for s in self.spans], "claim citation"
            )
            if claim.validation_status == "pass" and claim.material:
                premises = set(claim.fact_ids)
                for cid in claim.change_ids:
                    c = changes[cid]
                    premises.add(c.current_fact_id)
                    if c.previous_fact_id is not None:
                        premises.add(c.previous_fact_id)
                require(
                    all(
                        set(facts[f].evidence_span_ids) <= set(claim.citation_span_ids)
                        for f in premises
                    ),
                    "claim omits premise evidence",
                )
        return self


class ApprovedSource(Contract):
    source_id: Id
    approved_origin: Name
    rights_policy_version: Version
    supported_forms: list[Name]


class IngestionInput(Contract):
    cursor: Name | None
    roster_ids: Ids
    approved_sources: list[ApprovedSource]


class IngestionOutput(Contract):
    documents: list[SourceDocument]
    receipts: list[FetchReceipt]
    next_cursor: Name | None
    complete_poll: bool

    @model_validator(mode="after")
    def receipt_links(self) -> Self:
        docs = {d.document_id: d for d in self.documents}
        for r in self.receipts:
            if r.document_id is not None:
                require(r.document_id in docs, "receipt document unresolved")
                d = docs[r.document_id]
                require(
                    (r.content_hash, r.source_id, r.provider_external_id)
                    == (d.version_hash, d.source_id, d.provider_external_id),
                    "receipt source mismatch",
                )
        require(
            not self.complete_poll
            or all(r.outcome in ("fetched", "not_modified") for r in self.receipts),
            "failed poll cannot complete",
        )
        return self


class ParsingInput(Contract):
    directory_version: Version
    issuer_ids: Ids
    parser_name: Name
    parser_version: Version
    parser_config_hash: Hash


class ParsingOutput(EvidenceBundle):
    resolved_issuer_id: Id
    diagnostics: list[ParserDiagnostics]


class ExtractionInput(Contract):
    issuer_id: Id
    supported_taxonomy: list[EventType]


class ExtractionOutput(FactBundle):
    pass


class NormalizationInput(FactBundle):
    metric_dictionary_version: Version


class NormalizationOutput(FactBundle):
    dictionary_version: Version
    unresolved_metric_codes: list[Reason]


class MatchingInput(FactBundle):
    current_event_id: Id
    candidate_event_ids: Ids
    relation: Literal["forecast_revision", "prior_quarter", "prior_year", "corrected_disclosure"]
    fiscal_calendar_version: Version


class MatchingOutput(Contract):
    prior_match: PriorMatch


class ChangeInput(FactBundle):
    prior_match: PriorMatch
    calculation_version: Version


class ChangeOutput(Contract):
    changes: list[Change]


class MaterialityInput(Contract):
    event: Event
    changes: list[Change]
    flags: list[Reason]
    rubric_version: Version


class MaterialityOutput(Contract):
    event_id: Id
    materiality: Fraction
    reason_codes: list[Reason]
    rubric_version: Version


class RelevanceInput(Contract):
    event: Event
    subscribed_issuer_ids: Ids
    positions: list[Position]
    active_account: bool
    policy_version: Version


class RelevanceOutput(Contract):
    event_id: Id
    eligible: bool
    relevance: Fraction | None
    reason_codes: list[Reason]
    policy_version: Version


class RetrievalInput(Contract):
    event_ids: Ids
    planned_metric_keys: list[Reason]
    maximum_spans: int = Field(ge=1, le=100)
    retrieval_policy_version: Version


class RetrievalOutput(EvidenceBundle):
    retrieved_at: Utc
    retrieval_as_of: Utc
    snapshot_hash: Hash
    truncated: bool
    reason_codes: list[Reason]


class GenerationInput(ClaimBundle):
    glossary_version: Version
    prompt_version: Version
    language: Name


class GenerationOutput(Contract):
    analysis: Analysis


class CitationInput(ClaimBundle):
    checker_version: Version


class CitationOutput(Contract):
    validations: list[Validation]


class UncertaintyInput(Contract):
    stage_states: list[StageSummary]
    validations: list[Validation]
    publication_decision: PublicationDecision | None
    policy_version: Version


class UncertaintyOutput(Contract):
    disposition: FinalDisposition


class PolicyInput(ClaimBundle):
    analysis: Analysis
    validations: list[Validation]
    gate_policy_version: Version
    review_required: bool
    reviewer_action_id: Id | None
    expected_current_brief_id: Id | None

    @model_validator(mode="after")
    def analysis_premises(self) -> Self:
        require(self.analysis.claims == self.claims, "policy analysis differs from pinned claims")
        require(
            self.analysis.event_id in {e.event_id for e in self.events},
            "policy analysis event unresolved",
        )
        require(
            self.analysis.publication_state == "candidate", "policy requires candidate analysis"
        )
        return self


class PolicyOutput(Contract):
    publication_decision: PublicationDecision


class UpstreamReference(Contract):
    result_id: Id
    stage: Reason
    run_id: Id
    input_hash: Hash
    output_hash: Hash
    validator_version: Version


class InputEnvelope[P: Contract](Contract):
    schema_version: Literal["1"]
    run_id: Id
    stage: str
    input_hash: Hash
    pipeline_config_version: Version
    schema_contract_version: Literal["1"]
    source_document_ids: Ids
    parsed_artifact_ids: Ids
    upstream_result_ids: Ids
    upstream_results: list[UpstreamReference]
    retrieval_cutoff: Utc | None
    evidence: EvidenceBundle
    payload: P

    @model_validator(mode="after")
    def pins(self) -> Self:
        if isinstance(self.payload, PolicyInput):
            require(self.payload.analysis.run_id == self.run_id, "policy analysis run mismatch")
        require(
            set(self.upstream_result_ids) == {r.result_id for r in self.upstream_results}
            and len(self.upstream_result_ids) == len(self.upstream_results),
            "upstream pins mismatch",
        )
        require(
            all(r.run_id == self.run_id for r in self.upstream_results), "upstream run mismatch"
        )
        require(
            set(self.source_document_ids) == {d.document_id for d in self.evidence.documents},
            "source pins mismatch",
        )
        require(
            set(self.parsed_artifact_ids)
            == {a.parsed_artifact_id for a in self.evidence.artifacts},
            "artifact pins mismatch",
        )
        if self.stage in ("document_ingestion", "parsing_company_resolution"):
            require(not self.parsed_artifact_ids, "pre-parsing cannot pin artifacts")
        if self.stage == "previous_event_matching":
            require(self.retrieval_cutoff is not None, "matching cutoff required")
        if isinstance(self.payload, EvidenceBundle):
            require(
                self.payload.documents == self.evidence.documents
                and self.payload.artifacts == self.evidence.artifacts
                and self.payload.spans == self.evidence.spans,
                "payload differs from pinned evidence",
            )
        return self


class ResultEnvelope[OutputT: Contract](Contract):
    schema_version: Literal["1"]
    run_id: Id
    stage: str
    status: Literal["ok", "retryable", "blocked", "skipped"]
    input_hash: Hash
    output: OutputT | None
    reason_codes: list[Reason]
    started_at: Utc
    finished_at: Utc
    validator_version: Version

    @model_validator(mode="after")
    def outcome(self) -> Self:
        ordered(self.started_at, self.finished_at)
        require((self.status == "ok") == (self.output is not None), "output/status mismatch")
        require(self.status == "ok" or bool(self.reason_codes), "failure requires reason")
        return self


class IngestionStageInput(InputEnvelope[IngestionInput]):
    stage: Literal["document_ingestion"]


class IngestionStageResult(ResultEnvelope[IngestionOutput]):
    stage: Literal["document_ingestion"]


class ParsingStageInput(InputEnvelope[ParsingInput]):
    stage: Literal["parsing_company_resolution"]


class ParsingStageResult(ResultEnvelope[ParsingOutput]):
    stage: Literal["parsing_company_resolution"]


class ExtractionStageInput(InputEnvelope[ExtractionInput]):
    stage: Literal["event_extraction"]


class ExtractionStageResult(ResultEnvelope[ExtractionOutput]):
    stage: Literal["event_extraction"]


class NormalizationStageInput(InputEnvelope[NormalizationInput]):
    stage: Literal["event_normalization"]


class NormalizationStageResult(ResultEnvelope[NormalizationOutput]):
    stage: Literal["event_normalization"]


class MatchingStageInput(InputEnvelope[MatchingInput]):
    stage: Literal["previous_event_matching"]


class MatchingStageResult(ResultEnvelope[MatchingOutput]):
    stage: Literal["previous_event_matching"]


class ChangeStageInput(InputEnvelope[ChangeInput]):
    stage: Literal["change_detection"]


class ChangeStageResult(ResultEnvelope[ChangeOutput]):
    stage: Literal["change_detection"]


class MaterialityStageInput(InputEnvelope[MaterialityInput]):
    stage: Literal["materiality_scoring"]


class MaterialityStageResult(ResultEnvelope[MaterialityOutput]):
    stage: Literal["materiality_scoring"]


class RelevanceStageInput(InputEnvelope[RelevanceInput]):
    stage: Literal["portfolio_relevance"]


class RelevanceStageResult(ResultEnvelope[RelevanceOutput]):
    stage: Literal["portfolio_relevance"]


class RetrievalStageInput(InputEnvelope[RetrievalInput]):
    stage: Literal["evidence_retrieval"]


class RetrievalStageResult(ResultEnvelope[RetrievalOutput]):
    stage: Literal["evidence_retrieval"]


class GenerationStageInput(InputEnvelope[GenerationInput]):
    stage: Literal["analysis_generation"]


class GenerationStageResult(ResultEnvelope[GenerationOutput]):
    stage: Literal["analysis_generation"]


class CitationStageInput(InputEnvelope[CitationInput]):
    stage: Literal["citation_validation"]


class CitationStageResult(ResultEnvelope[CitationOutput]):
    stage: Literal["citation_validation"]


class UncertaintyStageInput(InputEnvelope[UncertaintyInput]):
    stage: Literal["uncertainty_handling"]


class UncertaintyStageResult(ResultEnvelope[UncertaintyOutput]):
    stage: Literal["uncertainty_handling"]


class PolicyStageInput(InputEnvelope[PolicyInput]):
    stage: Literal["policy_validation_publish"]


class PolicyStageResult(ResultEnvelope[PolicyOutput]):
    stage: Literal["policy_validation_publish"]


StageInput = Annotated[
    IngestionStageInput
    | ParsingStageInput
    | ExtractionStageInput
    | NormalizationStageInput
    | MatchingStageInput
    | ChangeStageInput
    | MaterialityStageInput
    | RelevanceStageInput
    | RetrievalStageInput
    | GenerationStageInput
    | CitationStageInput
    | UncertaintyStageInput
    | PolicyStageInput,
    Field(discriminator="stage"),
]
StageResult = Annotated[
    IngestionStageResult
    | ParsingStageResult
    | ExtractionStageResult
    | NormalizationStageResult
    | MatchingStageResult
    | ChangeStageResult
    | MaterialityStageResult
    | RelevanceStageResult
    | RetrievalStageResult
    | GenerationStageResult
    | CitationStageResult
    | UncertaintyStageResult
    | PolicyStageResult,
    Field(discriminator="stage"),
]
INPUT_ADAPTER: TypeAdapter[StageInput] = TypeAdapter(StageInput)
RESULT_ADAPTER: TypeAdapter[StageResult] = TypeAdapter(StageResult)
