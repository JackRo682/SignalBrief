"""Cross-envelope validation after untrusted stage output; no orchestration."""

from datetime import datetime
from typing import Self

from pydantic import model_validator

from services.contracts.scalars import Contract, bounded_references, require
from services.contracts.stages import (
    ChangeStageInput,
    ChangeStageResult,
    CitationStageInput,
    CitationStageResult,
    ClaimBundle,
    ExtractionStageInput,
    ExtractionStageResult,
    GenerationStageInput,
    GenerationStageResult,
    IngestionStageInput,
    IngestionStageResult,
    MatchingStageInput,
    MatchingStageResult,
    MaterialityStageInput,
    MaterialityStageResult,
    NormalizationStageInput,
    NormalizationStageResult,
    ParsingStageInput,
    ParsingStageResult,
    PolicyStageInput,
    PolicyStageResult,
    RelevanceStageInput,
    RelevanceStageResult,
    RetrievalStageInput,
    RetrievalStageResult,
    StageInput,
    StageResult,
    UncertaintyStageInput,
    UncertaintyStageResult,
)


class StageExchange(Contract):
    input: StageInput
    result: StageResult

    @model_validator(mode="after")
    def validate_boundary(self) -> Self:
        i, r = self.input, self.result
        require(
            (i.stage, i.run_id, i.input_hash) == (r.stage, r.run_id, r.input_hash),
            "stage/run/input hash mismatch",
        )
        output = r.output
        if output is None:
            return self
        if (
            isinstance(i, IngestionStageInput)
            and isinstance(r, IngestionStageResult)
            and r.output is not None
        ):
            bounded_references(
                [d.source_id for d in r.output.documents],
                [s.source_id for s in i.payload.approved_sources],
                "approved source",
            )
            bounded_references(
                [d.issuer_id for d in r.output.documents], i.payload.roster_ids, "roster issuer"
            )
        if (
            isinstance(i, ParsingStageInput)
            and isinstance(r, ParsingStageResult)
            and r.output is not None
        ):
            require(r.output.documents == i.evidence.documents, "parser replaced raw input")
            require(r.output.resolved_issuer_id in i.payload.issuer_ids, "unresolved issuer")
            require(
                all(d.issuer_id == r.output.resolved_issuer_id for d in r.output.documents),
                "parser issuer mismatch",
            )
            require(
                r.output.diagnostics == [a.diagnostics for a in r.output.artifacts],
                "parser diagnostics mismatch",
            )
            require(
                all(
                    (a.parser_name, a.parser_version, a.parser_config_hash)
                    == (
                        i.payload.parser_name,
                        i.payload.parser_version,
                        i.payload.parser_config_hash,
                    )
                    for a in r.output.artifacts
                ),
                "parser config mismatch",
            )
        if (
            isinstance(r, (ExtractionStageResult, NormalizationStageResult))
            and r.output is not None
        ):
            require(
                r.output.documents == i.evidence.documents
                and r.output.artifacts == i.evidence.artifacts
                and r.output.spans == i.evidence.spans,
                "output replaced pinned evidence",
            )
        if (
            isinstance(i, ExtractionStageInput)
            and isinstance(r, ExtractionStageResult)
            and r.output is not None
        ):
            require(
                all(
                    e.issuer_id == i.payload.issuer_id
                    and e.event_type in i.payload.supported_taxonomy
                    for e in r.output.events
                ),
                "extraction issuer/taxonomy mismatch",
            )
        if (
            isinstance(i, MatchingStageInput)
            and isinstance(r, MatchingStageResult)
            and r.output is not None
        ):
            p = r.output.prior_match
            require(
                p.event_id == i.payload.current_event_id
                and p.candidate_ids == i.payload.candidate_event_ids,
                "matching candidates changed",
            )
            require(p.retrieval_as_of == i.retrieval_cutoff, "matching cutoff changed")
            events = {e.event_id: e for e in i.payload.events}
            require(p.event_id in events, "current event missing")
            for cid in p.candidate_ids:
                require(cid in events, "candidate event missing")
                e = events[cid]
                require(e.issuer_id == events[p.event_id].issuer_id, "cross-issuer prior")
                require(
                    e.first_published_at is not None
                    and datetime.fromisoformat(e.first_published_at)
                    <= datetime.fromisoformat(p.retrieval_as_of),
                    "prior availability unknown/future",
                )
        if (
            isinstance(i, NormalizationStageInput)
            and isinstance(r, NormalizationStageResult)
            and r.output is not None
        ):
            require(
                r.output.dictionary_version == i.payload.metric_dictionary_version,
                "normalization version mismatch",
            )
            require(
                {f.fact_id for f in r.output.facts} == {f.fact_id for f in i.payload.facts},
                "normalization replaced fact identities",
            )
        if (
            isinstance(i, MaterialityStageInput)
            and isinstance(r, MaterialityStageResult)
            and r.output is not None
        ):
            require(
                (r.output.event_id, r.output.rubric_version)
                == (i.payload.event.event_id, i.payload.rubric_version),
                "materiality input mismatch",
            )
        if (
            isinstance(i, RelevanceStageInput)
            and isinstance(r, RelevanceStageResult)
            and r.output is not None
        ):
            require(
                (r.output.event_id, r.output.policy_version)
                == (i.payload.event.event_id, i.payload.policy_version),
                "relevance input mismatch",
            )
            if r.output.eligible:
                require(
                    i.payload.active_account
                    and (
                        i.payload.event.issuer_id in i.payload.subscribed_issuer_ids
                        or i.payload.event.issuer_id in {p.company_id for p in i.payload.positions}
                    ),
                    "ineligible relevance output",
                )
        if (
            isinstance(i, RetrievalStageInput)
            and isinstance(r, RetrievalStageResult)
            and r.output is not None
        ):
            require(len(r.output.spans) <= i.payload.maximum_spans, "retrieval bound exceeded")
            bounded_references(
                [d.document_id for d in r.output.documents],
                i.source_document_ids,
                "retrieved document",
            )
            documents = {d.document_id: d for d in i.evidence.documents}
            artifacts = {a.parsed_artifact_id: a for a in i.evidence.artifacts}
            spans = {s.span_id: s for s in i.evidence.spans}
            require(
                all(documents.get(d.document_id) == d for d in r.output.documents),
                "retrieval changed pinned raw document",
            )
            require(
                all(artifacts.get(a.parsed_artifact_id) == a for a in r.output.artifacts),
                "retrieval changed/unpinned parsed artifact",
            )
            require(
                all(spans.get(s.span_id) == s for s in r.output.spans),
                "retrieval changed/unpinned source span",
            )
            require(r.output.retrieval_as_of == i.retrieval_cutoff, "retrieval cutoff changed")
            for doc in r.output.documents:
                require(
                    doc.first_seen_at is not None
                    and datetime.fromisoformat(doc.first_seen_at)
                    <= datetime.fromisoformat(r.output.retrieval_as_of),
                    "future retrieval evidence",
                )
        if (
            isinstance(i, ChangeStageInput)
            and isinstance(r, ChangeStageResult)
            and r.output is not None
        ):
            ClaimBundle(
                **i.payload.model_dump(exclude={"prior_match", "calculation_version"}),
                changes=r.output.changes,
                claims=[],
            )
            require(
                all(
                    c.calculation_version == i.payload.calculation_version
                    and c.event_id == i.payload.prior_match.event_id
                    for c in r.output.changes
                ),
                "change lineage mismatch",
            )
        if (
            isinstance(i, GenerationStageInput)
            and isinstance(r, GenerationStageResult)
            and r.output is not None
        ):
            a = r.output.analysis
            require(
                a.run_id == i.run_id and a.event_id in {e.event_id for e in i.payload.events},
                "analysis run/event mismatch",
            )
            require(a.publication_state == "candidate", "generation cannot publish")
            ClaimBundle(
                **i.payload.model_dump(
                    exclude={"claims", "glossary_version", "prompt_version", "language"}
                ),
                claims=a.claims,
            )
        if (
            isinstance(i, CitationStageInput)
            and isinstance(r, CitationStageResult)
            and r.output is not None
        ):
            require(
                all(v.run_id == i.run_id for v in r.output.validations),
                "citation validation run mismatch",
            )
            bounded_references(
                [v.subject_id for v in r.output.validations],
                [c.claim_id for c in i.payload.claims],
                "validation subject",
            )
        if (
            isinstance(i, PolicyStageInput)
            and isinstance(r, PolicyStageResult)
            and r.output is not None
        ):
            d = r.output.publication_decision
            require(
                (
                    d.run_id,
                    d.event_id,
                    d.candidate_brief_id,
                    d.gate_policy_version,
                    d.review_required,
                    d.reviewer_action_id,
                    d.expected_current_brief_id,
                )
                == (
                    i.run_id,
                    i.payload.analysis.event_id,
                    i.payload.analysis.brief_id,
                    i.payload.gate_policy_version,
                    i.payload.review_required,
                    i.payload.reviewer_action_id,
                    i.payload.expected_current_brief_id,
                ),
                "policy decision input mismatch",
            )
            require(d.validations == i.payload.validations, "policy validation records changed")
            if d.decision == "publish":
                require(
                    i.payload.analysis.evidence_status != "unavailable"
                    and bool(i.payload.analysis.claims)
                    and all(
                        not c.material or c.validation_status == "pass"
                        for c in i.payload.analysis.claims
                    ),
                    "policy cannot publish unvalidated analysis",
                )
        if (
            isinstance(i, UncertaintyStageInput)
            and isinstance(r, UncertaintyStageResult)
            and r.output is not None
        ):
            f = r.output.disposition
            require(
                f.run_id == i.run_id and f.publication_decision == i.payload.publication_decision,
                "final disposition input mismatch",
            )
            require(
                set(f.validation_ids) == {v.validation_id for v in i.payload.validations},
                "final validation mismatch",
            )
        return self
