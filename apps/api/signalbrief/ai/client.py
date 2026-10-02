import json
import random
import time
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path

import httpx
from pydantic import ValidationError

from ..errors import EvidenceError, ProviderError
from ..http_client import retry_after_seconds
from ..limits import consume_budget
from .schemas import ExtractionBatch, ExtractiveAnswer, SemanticComparison

PROMPTS = Path(__file__).resolve().parents[1] / "prompts"


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    requests: int = 0
    model_version: str | None = None
    measured: bool = True

    def cost(self, settings):
        if (
            not self.measured
            or settings.openai_input_usd_per_million is None
            or settings.openai_output_usd_per_million is None
        ):
            return None
        return (
            Decimal(self.input_tokens) * Decimal(str(settings.openai_input_usd_per_million))
            + Decimal(self.output_tokens) * Decimal(str(settings.openai_output_usd_per_million))
        ) / Decimal(1_000_000)


class StructuredLLM:
    def __init__(self, settings, factory, transport=None, sleep=time.sleep):
        if not settings.openai_api_key or not settings.openai_model:
            raise ProviderError("openai_key_and_model_required")
        self.settings, self.factory, self.sleep = settings, factory, sleep
        self.client = httpx.Client(
            timeout=settings.openai_timeout, transport=transport, follow_redirects=False
        )
        self.usage = Usage()

    def close(self):
        self.client.close()

    def call(self, schema, prompt_name: str, data: dict):
        prompt = (PROMPTS / (prompt_name + ".txt")).read_text(encoding="utf-8")
        payload = {
            "model": self.settings.openai_model,
            "store": False,
            "input": [
                {"role": "system", "content": prompt},
                {"role": "user", "content": json.dumps(data, ensure_ascii=False)},
            ],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": schema.__name__,
                    "schema": schema.model_json_schema(),
                    "strict": True,
                }
            },
            "max_output_tokens": 5000,
        }
        for attempt in range(self.settings.max_retries + 1):
            if not consume_budget(
                self.factory, "openai-global-daily", self.settings.ai_daily_requests, 86400
            ):
                raise ProviderError("ai_daily_request_budget_exhausted", True, 3600)
            self.usage.requests += 1
            try:
                response = self.client.post(
                    "https://api.openai.com/v1/responses",
                    json=payload,
                    headers={"Authorization": "Bearer " + self.settings.openai_api_key},
                )
            except httpx.TransportError:
                # The server may have processed a request even when the final response was lost.
                self.usage.measured = False
                if attempt == self.settings.max_retries:
                    raise ProviderError("openai_transport_failure", True) from None
                self.sleep(2**attempt + random.random())
                continue
            if response.status_code == 429 or response.status_code >= 500:
                if response.status_code >= 500:
                    self.usage.measured = False
                delay = retry_after_seconds(response.headers.get("Retry-After")) or 0
                if attempt == self.settings.max_retries or delay > 60:
                    raise ProviderError("openai_rate_or_server_error", True, delay)
                self.sleep(max(delay, 2**attempt + random.random()))
                continue
            if response.status_code != 200:
                raise ProviderError("openai_request_rejected_" + str(response.status_code))
            try:
                result = response.json()
                usage = result.get("usage")
                if not isinstance(usage, dict) or any(
                    not isinstance(usage.get(key), int) or isinstance(usage.get(key), bool) or usage[key] < 0
                    for key in ("input_tokens", "output_tokens")
                ):
                    self.usage.measured = False
                else:
                    self.usage.input_tokens += usage["input_tokens"]
                    self.usage.output_tokens += usage["output_tokens"]
                self.usage.model_version = result.get("model")
                if result.get("status") != "completed":
                    raise EvidenceError("openai_incomplete_output")
                text = []
                for item in result.get("output", []):
                    if item.get("type") == "message":
                        for content in item.get("content", []):
                            if content.get("type") == "refusal":
                                raise EvidenceError("model_refusal")
                            if content.get("type") == "output_text":
                                text.append(content.get("text", ""))
                return schema.model_validate_json("".join(text))
            except (ValueError, TypeError, ValidationError, KeyError):
                raise EvidenceError("malformed_structured_output") from None
        raise ProviderError("openai_retry_exhausted", True)


class LiveExtractor:
    def __init__(self, llm: StructuredLLM):
        self.llm = llm

    def extract(self, chunks):
        if len(chunks) > self.llm.settings.max_llm_chunks:
            # Avoid pretending a truncated excerpt represents the entire filing.
            raise EvidenceError("document_exceeds_llm_coverage_budget")
        batches = [
            self.llm.call(ExtractionBatch, "extract-v1", {"chunk_id": chunk.id, "source_text": chunk.text})
            for chunk in chunks
        ]
        facts, dates, seen = [], [], set()
        for batch in batches:
            for fact in batch.facts:
                key = (fact.field, fact.quote, fact.value_raw, fact.period, fact.unit, fact.scope, fact.basis)
                if key not in seen:
                    facts.append(fact)
                    seen.add(key)
            for item in batch.scheduled_dates:
                if not any(x.date_iso == item.date_iso and x.quote == item.quote for x in dates):
                    dates.append(item)
        # Deterministic majority; only a classification hypothesis until review.
        kinds = [batch.event_type for batch in batches if batch.facts]
        kind = max(sorted(set(kinds)), key=kinds.count) if kinds else "other"
        if len(facts) > 100 or len(dates) > 15:
            raise EvidenceError("extraction_result_exceeds_review_budget")
        return ExtractionBatch(event_type=kind, facts=facts, scheduled_dates=dates)

    def semantic_compare(self, previous, current):
        result = self.llm.call(SemanticComparison, "semantic-v1", {"previous": previous, "current": current})
        if result.previous_quote != previous or result.current_quote != current:
            raise EvidenceError("semantic_comparison_changed_evidence")
        return result

    def answer(self, question, evidence):
        return self.llm.call(ExtractiveAnswer, "followup-v1", {"question": question, "evidence": evidence})
