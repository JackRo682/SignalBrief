from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

import httpx
import pytest
from signalbrief.ai.client import StructuredLLM
from signalbrief.ai.schemas import ExtractionBatch
from signalbrief.errors import ProviderError
from signalbrief.limits import reserve_ai_cost
from signalbrief.models import RateBucket
from sqlalchemy import select


def test_reservation_is_atomic_across_workers_and_survives_new_client(db):
    def reserve(_):
        return reserve_ai_cost(db.factory, Decimal("0.1"), Decimal("1"))

    with ThreadPoolExecutor(max_workers=4) as pool:
        assert sum(pool.map(reserve, range(20))) == 10
    assert not reserve_ai_cost(db.factory, Decimal("0.01"), Decimal("1"))
    with db.factory() as session:
        row = session.scalar(select(RateBucket))
        assert row.hits == 1_000_000
        assert row.expires_at.year == 9999


@pytest.mark.parametrize("amount,limit", [("0", "1"), ("1", "0"), ("1.1", "1")])
def test_unapproved_or_excessive_reservation_does_not_write(db, amount, limit):
    assert not reserve_ai_cost(db.factory, Decimal(amount), Decimal(limit))
    with db.factory() as session:
        assert session.scalar(select(RateBucket)) is None


def test_missing_budget_blocks_before_network(db):
    settings = db.settings.model_copy(update={"openai_api_key": "test", "openai_model": "test"})
    requests = []
    client = StructuredLLM(settings, db.factory, transport=httpx.MockTransport(lambda r: requests.append(r)))
    with pytest.raises(ProviderError, match="ai_budget_and_positive_price_rates_required"):
        client.call(ExtractionBatch, "extract-v1", {})
    assert requests == []
    client.close()


def test_timeout_reservation_is_retained_and_retry_cannot_exceed_ceiling(db):
    settings = db.settings.model_copy(
        update={
            "openai_api_key": "test",
            "openai_model": "test",
            "ai_total_budget_usd": Decimal("0.017"),
            "openai_input_usd_per_million": 1,
            "openai_output_usd_per_million": 1,
        }
    )
    requests = []

    def timeout(request):
        requests.append(request)
        raise httpx.ReadTimeout("uncertain billing")

    client = StructuredLLM(settings, db.factory, transport=httpx.MockTransport(timeout), sleep=lambda _: None)
    with pytest.raises(ProviderError, match="ai_total_cost_budget_exhausted"):
        client.call(ExtractionBatch, "extract-v1", {})
    assert len(requests) == 1
    assert not client.usage.measured
    client.close()
