"""Replayable table evidence stored in the existing immutable chunk contract.

The visible prefix explicitly labels reconstructed excerpts. The bounded compressed
payload preserves the *original* bytes, not model output or reserialized HTML.
This makes approval replay independent of an LLM and preserves the raw SHA-256.
"""

import base64
import gzip
import io
from functools import lru_cache
from hashlib import sha256

from ..errors import EvidenceError, ParseError
from ..sec_tables import VERSION, parse_sec_tables
from .schemas import CitationVerdict, ExtractionBatch

PREFIX = "SignalBrief SEC table evidence v1\n"
MARKER = "\n---SEC-ORIGINAL-GZIP-BASE64---\n"
SCOPE = "consolidated_operations_revenue_and_operating_income_only"


def evidence_source(raw):
    result = parse_sec_tables(raw)
    if result.errors:
        raise EvidenceError("sec_table_source_validation_failed")
    # Preserve repeated financial contexts as separate source locations. The model
    # must cover each, and conflict validation still checks normalized values.
    return (
        PREFIX
        + result.raw_sha256
        + "\n"
        + "\n\n".join(f.quote for f in result.facts)
        + MARKER
        + base64.b64encode(gzip.compress(raw, mtime=0)).decode("ascii")
    )


@lru_cache(maxsize=4)
def replay_source(source):
    if not source.startswith(PREFIX) or len(source) > 6_000_000:
        raise EvidenceError("invalid_sec_evidence_envelope")
    try:
        prefix, encoded = source.split(MARKER)
        expected = prefix.splitlines()[1]
        compressed = base64.b64decode(encoded, validate=True)
        with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
            raw = stream.read(4_000_001)
        if len(raw) > 4_000_000 or sha256(raw).hexdigest() != expected:
            raise ValueError("raw_integrity")
        result = parse_sec_tables(raw)
        if result.errors or source != evidence_source(raw):
            raise ValueError("source_reconstruction")
        return result
    except (ValueError, OSError, EOFError, ParseError) as exc:
        raise EvidenceError("invalid_sec_evidence_envelope") from exc


def validate_sec_fact(fact, source, key):
    try:
        result = replay_source(source)
        valid = fact in [f.claim(fact.chunk_id) for f in result.facts]
    except (EvidenceError, ValueError):
        valid = False
    return CitationVerdict(
        status="supported" if valid else "unsupported",
        claim_key=key,
        reason="Original HTML cells, headers, XBRL context/unit/scale and raw hash replayed"
        if valid
        else "Table claim does not exactly match replayed original SEC evidence",
    )


def complete_table_coverage(facts, chunks):
    expected = []
    for chunk_id, source in chunks.items():
        if source.startswith(PREFIX):
            expected.extend(f.claim(chunk_id) for f in replay_source(source).facts)
    actual = [f for f in facts if chunks.get(f.chunk_id, "").startswith(PREFIX)]
    return len(actual) == len(expected) and all(f in actual for f in expected)


class SecTableExtractor:
    """Explicit scoped extraction, never labeled a complete filing analysis."""

    def __init__(self, llm):
        self.llm = llm

    def extract(self, chunks):
        if len(chunks) != 1 or chunks[0].parser_version != VERSION:
            raise EvidenceError("sec_table_chunk_required")
        chunk = chunks[0]
        source = replay_source(chunk.text)
        cells = []
        for f in source.facts:
            data = f.record()
            # Values and field classification must be returned by the model and
            # independently matched to the deterministic parser after extraction.
            for key in ("value", "base_value", "field", "unit", "period_kind"):
                data.pop(key)
            cells.append(data)
        return self.llm.call(
            ExtractionBatch,
            "sec-table-v1",
            {
                "chunk_id": chunk.id,
                "scope": SCOPE,
                "cells": cells,
            },
        )
