import time
from datetime import date
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import select

from . import models as m
from .ai.client import LiveExtractor, StructuredLLM
from .ai.demo_extractor import DemoExtractor
from .ai.evidence import VALIDATOR_VERSION, conflicting_facts, validate_fact
from .ai.schemas import CitationVerdict, ExtractedFact, ExtractionBatch
from .briefs import build_brief
from .changes import compare, comparison_kind
from .errors import EvidenceError, ProviderError
from .jobs import assert_lease, enqueue
from .limits import dialect_insert
from .parser import PARSER_VERSION, chunk_text, normalized_text
from .storage import make_store

PIPELINE_VERSION = "pipeline-v1"


def stable_id(*parts):
    return str(uuid5(NAMESPACE_URL, "signalbrief:" + ":".join(parts)))


def supported_event_evidence(session, event):
    validations = (
        session.execute(select(m.Validation).where(m.Validation.event_id == event.id)).scalars().all()
    )
    facts = session.execute(select(m.Fact).where(m.Fact.event_id == event.id)).scalars().all()
    if (
        not validations
        or not facts
        or any(v.status != "supported" for v in validations)
        or any(fact.validation_status != "supported" for fact in facts)
    ):
        return False
    chunks = {
        chunk.id: chunk.text
        for chunk in session.execute(
            select(m.Chunk).where(m.Chunk.document_id == event.document_id)
        ).scalars()
    }
    try:
        candidates = [
            ExtractedFact(**{field: getattr(fact, field) for field in ExtractedFact.model_fields})
            for fact in facts
        ]
        return all(
            validate_fact(fact, chunks, f"fact:{index}").status == "supported"
            for index, fact in enumerate(candidates)
        ) and not conflicting_facts(candidates)
    except ValueError:
        return False


def assert_trusted_history(session, event):
    pending = [(event.id, frozenset())]
    checked = set()
    while pending:
        event_id, ancestors = pending.pop()
        if event_id in ancestors:
            raise EvidenceError("publication_blocked_by_cyclic_previous_evidence")
        if event_id in checked:
            continue
        checked.add(event_id)
        parent_ids = (
            session.execute(
                select(m.Change.previous_fact_id).where(
                    m.Change.event_id == event_id, m.Change.previous_fact_id.is_not(None)
                )
            )
            .scalars()
            .all()
        )
        for fact_id in parent_ids:
            fact = session.get(m.Fact, fact_id)
            parent = session.get(m.Event, fact.event_id) if fact else None
            if (
                not parent
                or fact.validation_status != "supported"
                or parent.state not in ("published", "superseded")
                or not supported_event_evidence(session, parent)
            ):
                raise EvidenceError("publication_blocked_by_untrusted_previous_evidence")
            pending.append((parent.id, ancestors | {event_id}))


def publish_event(session, event):
    if not supported_event_evidence(session, event):
        raise EvidenceError("publication_blocked_by_evidence_validation")
    if event.state in ("duplicate", "rejected"):
        raise EvidenceError("event_not_eligible_for_publication")
    assert_trusted_history(session, event)
    if event.state == "published":
        return  # Repeated approvals must not change the publication time or notification audience.
    # Keep prior revisions and every cited fact, but remove superseded analyses from the feed.
    older = (
        session.execute(
            select(m.Event)
            .where(
                m.Event.document_id == event.document_id, m.Event.id != event.id, m.Event.state == "published"
            )
            .with_for_update()
        )
        .scalars()
        .all()
    )
    for previous in older:
        previous.state = "superseded"
    event.state = "published"
    event.published_to_users_at = m.now()
    enqueue(session, "notify", {"event_id": event.id}, "notify:" + event.id)


def process_document(
    settings, factory, document_id: str, revision=PIPELINE_VERSION, extractor=None, store=None, lease=None
):
    started = time.monotonic()
    identity = stable_id(document_id, revision)
    with factory() as s:
        existing = s.get(m.Event, identity)
        if existing:
            return existing.id
        document = s.get(m.Document, document_id)
        if not document:
            raise ProviderError("document_not_found")
        blob = s.get(m.RawBlob, document.raw_sha256)
        if document.is_demo and not settings.demo_mode:
            raise ProviderError("synthetic_documents_forbidden_in_live_mode")
    run_id = m.uid()
    with factory.begin() as s:
        s.add(
            m.AIRun(
                id=run_id,
                document_id=document_id,
                stage="extract_validate_compare",
                model="deterministic-fixture-parser"
                if document.is_demo
                else (settings.openai_model or "unconfigured"),
                prompt_version="extract-v1",
                pipeline_version=revision,
                status="running",
            )
        )
    llm = None
    try:
        raw = (store or make_store(settings)).get(blob.object_key)
        parsed = normalized_text(raw, blob.content_type)
        pieces = chunk_text(parsed)
        with factory.begin() as s:
            if lease:
                assert_lease(s, lease)
            for piece in pieces:
                chunk_id = stable_id(document_id, PARSER_VERSION, str(piece.ordinal))
                statement = dialect_insert(s, m.Chunk).values(
                    id=chunk_id,
                    document_id=document_id,
                    ordinal=piece.ordinal,
                    parser_version=PARSER_VERSION,
                    text=piece.text,
                    text_sha256=piece.text_sha256,
                    char_start=piece.char_start,
                    char_end=piece.char_end,
                    location=piece.location,
                    created_at=m.now(),
                )
                s.execute(statement.on_conflict_do_nothing(index_elements=[m.Chunk.id]))
            s.get(m.Document, document_id).state = "parsed"
        with factory() as s:
            chunks = (
                s.execute(
                    select(m.Chunk)
                    .where(m.Chunk.document_id == document_id, m.Chunk.parser_version == PARSER_VERSION)
                    .order_by(m.Chunk.ordinal)
                )
                .scalars()
                .all()
            )
        if extractor is None:
            if document.is_demo:
                extractor = DemoExtractor()
            else:
                llm = StructuredLLM(settings, factory)
                extractor = LiveExtractor(llm)
        batch = ExtractionBatch.model_validate(extractor.extract(chunks))
        source_texts = {chunk.id: chunk.text for chunk in chunks}
        verdicts = [validate_fact(f, source_texts, f"fact:{i}") for i, f in enumerate(batch.facts)]
        good_indexes = [i for i, v in enumerate(verdicts) if v.status == "supported"]
        conflicts = conflicting_facts([batch.facts[i] for i in good_indexes])
        for j in conflicts:
            i = good_indexes[j]
            verdicts[i] = CitationVerdict(
                status="conflicting_sources",
                reason="Different normalized values were extracted for the same metric, compatible unit, period, scope and basis",
                claim_key=f"fact:{i}",
            )
        if not batch.facts:
            verdicts.append(
                CitationVerdict(
                    status="missing_source", reason="No supported financial fact found", claim_key="document"
                )
            )
        supported = [(i, fact) for i, fact in enumerate(batch.facts) if verdicts[i].status == "supported"]
        dates = []
        for i, item in enumerate(batch.scheduled_dates):
            try:
                event_date = date.fromisoformat(item.date_iso)
                valid = item.quote in source_texts.get(item.chunk_id, "") and item.date_iso in item.quote
            except ValueError:
                valid = False
            verdicts.append(
                CitationVerdict(
                    status="supported" if valid else "unsupported",
                    claim_key=f"calendar:{i}",
                    reason="Explicit date in exact source quotation"
                    if valid
                    else "Unverified scheduled event date",
                )
            )
            if valid:
                dates.append((item, event_date))
        with factory.begin() as s:
            if lease:
                assert_lease(s, lease)
            # Serializes concurrent revisions for the same filing in PostgreSQL.
            s.execute(select(m.Document).where(m.Document.id == document_id).with_for_update()).scalar_one()
            if s.get(m.Event, identity):
                # A concurrent worker won the commit. Account for this attempt, without publishing twice.
                duplicate_run = s.get(m.AIRun, run_id)
                duplicate_run.status = "duplicate_skipped"
                duplicate_run.finished_at = m.now()
                duplicate_run.latency_ms = int((time.monotonic() - started) * 1000)
                if llm:
                    duplicate_run.input_tokens = llm.usage.input_tokens if llm.usage.measured else None
                    duplicate_run.output_tokens = llm.usage.output_tokens if llm.usage.measured else None
                    duplicate_run.cost_usd = llm.usage.cost(settings)
                    duplicate_run.model_version = llm.usage.model_version
                return identity
            all_valid = bool(batch.facts) and all(v.status == "supported" for v in verdicts)
            event = m.Event(
                id=identity,
                company_id=document.company_id,
                document_id=document_id,
                run_id=run_id,
                revision=revision,
                title=document.title,
                event_type=batch.event_type,
                state="needs_review" if all_valid else "blocked",
                confidence=0.85 if all_valid else 0.2,
                materiality=0.15,
                published_at=document.published_at,
            )
            s.add(event)
            s.flush()
            facts, changes, source_keys = [], [], set()
            for index, candidate in supported:
                fact = m.Fact(
                    id=stable_id(identity, "fact", str(index)),
                    event_id=identity,
                    **candidate.model_dump(),
                    validation_status="supported",
                )
                s.add(fact)
                facts.append(fact)
            s.flush()
            for fact in facts:
                prior_candidates = (
                    s.execute(
                        select(m.Fact)
                        .join(m.Event, m.Event.id == m.Fact.event_id)
                        .where(
                            m.Event.company_id == document.company_id,
                            m.Event.state.in_(["published", "superseded"]),
                            m.Event.document_id != document_id,
                            m.Event.published_at < document.published_at,
                            m.Fact.field == fact.field,
                            m.Fact.validation_status == "supported",
                        )
                        .order_by(m.Event.published_at.desc(), m.Event.published_to_users_at.desc())
                        .limit(200)
                    )
                    .scalars()
                    .all()
                )
                previous = None
                for old in prior_candidates:
                    if not comparison_kind(old, fact):
                        continue
                    old_event = s.get(m.Event, old.event_id)
                    if not supported_event_evidence(s, old_event):
                        continue
                    try:
                        assert_trusted_history(s, old_event)
                    except EvidenceError:
                        continue
                    previous = old
                    break
                comparison = compare(previous, fact)
                changes.append(comparison)
                s.add(m.Change(event_id=identity, **comparison))
                source_keys.add((fact.chunk_id, "primary"))
                if previous:
                    source_keys.add((previous.chunk_id, "comparison"))
                # Semantic suggestions NEVER authorize publication. A fresh review is always required.
                if (
                    previous
                    and comparison["change_type"] == "wording_changed"
                    and isinstance(extractor, LiveExtractor)
                ):
                    # The deterministic quote comparison is sufficient for V1 publishing UI.
                    # A separate optional semantic CLI stage is available; no network call inside this transaction.
                    event.confidence = min(event.confidence, 0.65)
            for chunk_id, role in source_keys:
                s.add(m.EventSource(event_id=identity, chunk_id=chunk_id, role=role))
            for verdict in verdicts:
                s.add(
                    m.Validation(
                        event_id=identity, **verdict.model_dump(), validator_version=VALIDATOR_VERSION
                    )
                )
            brief = m.Brief(event_id=identity, **build_brief(document, facts, changes))
            s.add(brief)
            s.flush()
            all_fact_ids = {f.id for f in facts} | {
                c["previous_fact_id"] for c in changes if c["previous_fact_id"]
            }
            for fact_id in all_fact_ids:
                s.add(m.BriefSource(brief_id=brief.id, fact_id=fact_id))
            for index, (item, event_date) in enumerate(dates):
                s.add(
                    m.CalendarItem(
                        id=stable_id(identity, "calendar", str(index)),
                        company_id=document.company_id,
                        event_id=identity,
                        origin="official",
                        title="공시 원문에 기재된 일정" + (" · 합성 데모" if document.is_demo else ""),
                        occurs_on=event_date,
                        chunk_id=item.chunk_id,
                        quote=item.quote,
                    )
                )
            event.materiality = max([c["materiality"] for c in changes] or [0.15])
            run = s.get(m.AIRun, run_id)
            run.status = "validated" if all_valid else "validation_failed"
            run.validation_result = {
                "verdicts": [v.model_dump() for v in verdicts],
                "chunks_total": len(chunks),
                "chunks_analyzed": len(chunks),
                "coverage": "complete",
                "publication_requires_review": not document.is_demo and not settings.auto_publish_validated,
            }
            run.latency_ms = int((time.monotonic() - started) * 1000)
            run.finished_at = m.now()
            if llm:
                run.input_tokens = llm.usage.input_tokens if llm.usage.measured else None
                run.output_tokens = llm.usage.output_tokens if llm.usage.measured else None
                run.cost_usd, run.model_version = llm.usage.cost(settings), llm.usage.model_version
            elif document.is_demo:
                run.input_tokens, run.output_tokens, run.cost_usd, run.model_version = (
                    0,
                    0,
                    0,
                    "fixture-parser-v1",
                )
            s.get(m.Document, document_id).state = "processed" if all_valid else "review"
            s.flush()
            if all_valid and (document.is_demo or settings.auto_publish_validated):
                publish_event(s, event)
        return identity
    except Exception as exc:
        with factory.begin() as s:
            run = s.get(m.AIRun, run_id)
            run.status = "failed"
            run.error_code = getattr(
                exc, "code", str(exc) if isinstance(exc, EvidenceError) else type(exc).__name__
            )[:100]
            run.latency_ms = int((time.monotonic() - started) * 1000)
            run.finished_at = m.now()
            if llm:
                run.input_tokens = llm.usage.input_tokens if llm.usage.measured else None
                run.output_tokens = llm.usage.output_tokens if llm.usage.measured else None
                run.cost_usd, run.model_version = llm.usage.cost(settings), llm.usage.model_version
        raise
    finally:
        if llm:
            llm.close()
