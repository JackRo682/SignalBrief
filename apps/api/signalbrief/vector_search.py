"""Optional pgvector index; does not replace quote/numeric verification or authorize data."""

import json
import math
import time
from decimal import Decimal

import httpx
from sqlalchemy import select, text

from . import models as m
from .errors import EvidenceError, ProviderError
from .limits import consume_budget

DIMENSIONS = 1536


def checked_vector(value):
    if not isinstance(value, list) or len(value) != DIMENSIONS:
        raise EvidenceError("embedding_dimension_mismatch")
    if any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in value):
        raise EvidenceError("embedding_not_finite")
    if sum(float(x) * x for x in value) == 0:
        raise EvidenceError("zero_embedding")
    return [float(x) for x in value]


class VectorSearch:
    def __init__(self, settings, factory, transport=None):
        self.settings, self.factory, self.transport = settings, factory, transport
        if not settings.database_url.startswith(("postgresql", "postgres://")):
            raise ProviderError("vector_search_requires_postgresql")
        if not settings.openai_api_key or not settings.embedding_model:
            raise ProviderError("embedding_key_and_model_required")

    def embed(self, content, document_id=None):
        if not 1 <= len(content) <= 15000:
            raise EvidenceError("embedding_input_length_out_of_range")
        if not consume_budget(self.factory, "embedding-global-daily", self.settings.ai_daily_requests, 86400):
            raise ProviderError("embedding_daily_budget_exhausted", True, 3600)
        run_id = m.uid()
        start = time.monotonic()
        with self.factory.begin() as s:
            s.add(
                m.AIRun(
                    id=run_id,
                    document_id=document_id,
                    stage="embedding",
                    model=self.settings.embedding_model,
                    prompt_version="not-applicable",
                    pipeline_version="vector-v1",
                    status="running",
                )
            )
        result = None
        try:
            with httpx.Client(
                timeout=self.settings.openai_timeout, transport=self.transport, follow_redirects=False
            ) as client:
                try:
                    response = client.post(
                        "https://api.openai.com/v1/embeddings",
                        headers={"Authorization": "Bearer " + self.settings.openai_api_key},
                        json={
                            "input": content,
                            "model": self.settings.embedding_model,
                            "dimensions": DIMENSIONS,
                            "encoding_format": "float",
                        },
                    )
                except httpx.TransportError:
                    raise ProviderError("embedding_transport_error", True) from None
            if response.status_code != 200:
                raise ProviderError(
                    "embedding_http_error", response.status_code == 429 or response.status_code >= 500
                )
            result = response.json()
            vector = checked_vector(result["data"][0]["embedding"])
            with self.factory.begin() as s:
                run = s.get(m.AIRun, run_id)
                run.status = "validated"
                run.finished_at = m.now()
                run.latency_ms = int((time.monotonic() - start) * 1000)
                run.model_version = result.get("model")
                run.input_tokens = result.get("usage", {}).get("prompt_tokens")
                run.output_tokens = 0
                if run.input_tokens is not None and self.settings.embedding_input_usd_per_million is not None:
                    run.cost_usd = (
                        Decimal(run.input_tokens)
                        * Decimal(str(self.settings.embedding_input_usd_per_million))
                        / 1_000_000
                    )
            return vector
        except Exception as exc:
            with self.factory.begin() as s:
                run = s.get(m.AIRun, run_id)
                run.status = "failed"
                run.finished_at = m.now()
                run.error_code = getattr(exc, "code", type(exc).__name__)[:100]
                run.latency_ms = int((time.monotonic() - start) * 1000)
            raise

    def index_document(self, document_id):
        with self.factory() as s:
            document = s.get(m.Document, document_id)
            if not document or document.is_demo:
                raise ProviderError("live_document_required")
            s.execute(text("SET LOCAL search_path=public,extensions"))
            chunks = s.execute(select(m.Chunk).where(m.Chunk.document_id == document_id)).scalars().all()
            existing = set(
                s.execute(
                    text("SELECT chunk_id FROM chunk_embeddings WHERE model=:model"),
                    {"model": self.settings.embedding_model},
                ).scalars()
            )
        added = 0
        for chunk in chunks:
            if chunk.id in existing:
                continue
            vector = self.embed(chunk.text, document_id)
            with self.factory.begin() as s:
                s.execute(text("SET LOCAL search_path=public,extensions"))
                s.execute(
                    text("""INSERT INTO chunk_embeddings(chunk_id,model,embedding)
                  VALUES(:id,:model,CAST(:embedding AS vector)) ON CONFLICT(chunk_id,model) DO NOTHING"""),
                    {"id": chunk.id, "model": self.settings.embedding_model, "embedding": json.dumps(vector)},
                )
            added += 1
        return added

    def search(self, company_id, query, limit=5):
        if not 1 <= limit <= 20:
            raise ValueError("limit must be 1..20")
        vector = self.embed(query)
        with self.factory() as s:
            s.execute(text("SET LOCAL search_path=public,extensions"))
            result = (
                s.execute(
                    text("""SELECT c.id,c.text,c.location,d.source_url,d.id AS document_id,
              1-(v.embedding <=> CAST(:embedding AS vector)) AS similarity
              FROM chunk_embeddings v JOIN document_chunks c ON c.id=v.chunk_id
              JOIN documents d ON d.id=c.document_id
              WHERE d.company_id=:company AND d.is_demo=false AND v.model=:model
                AND EXISTS(SELECT 1 FROM events e WHERE e.document_id=d.id AND e.state='published')
              ORDER BY v.embedding <=> CAST(:embedding AS vector) LIMIT :limit"""),
                    {
                        "company": company_id,
                        "model": self.settings.embedding_model,
                        "embedding": json.dumps(vector),
                        "limit": limit,
                    },
                )
                .mappings()
                .all()
            )
            return [dict(x) for x in result]
