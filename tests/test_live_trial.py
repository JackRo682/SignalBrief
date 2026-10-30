from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from signalbrief.errors import ProviderError
from signalbrief.live_trial import analyze, collect, selected_pairs


def filing(month, form="10-Q"):
    return SimpleNamespace(form_type=form, published_at=datetime(2026, month, 1, tzinfo=timezone.utc))


def test_pairs_are_oldest_first_and_do_not_mix_annual_or_amended_filings():
    first, second, third = filing(2), filing(5), filing(8)
    assert selected_pairs([third, filing(7, "10-K"), second, filing(6, "10-Q/A"), first], 1) == [
        (second, third)
    ]
    assert selected_pairs([third, first, second], 2) == [(first, second), (second, third)]


def test_insufficient_history_is_explicit():
    with pytest.raises(ProviderError, match="not_enough_verified_quarterly_filings"):
        selected_pairs([filing(2)], 1)


def test_ten_pair_collection_requires_completed_pilot_before_any_network(settings, tmp_path):
    with pytest.raises(ProviderError, match="verified_one_pair_pilot_required"):
        collect(settings, tmp_path / "trial", 10)
    assert not (tmp_path / "trial").exists()


def test_trial_cannot_publish_or_use_demo_configuration(settings, tmp_path):
    with pytest.raises(ProviderError, match="production_manual_review_configuration_required"):
        analyze(settings, tmp_path)


def test_collection_never_overwrites_a_previous_trial(settings, tmp_path):
    (tmp_path / "manifest.json").write_text("{}")
    with pytest.raises(ProviderError, match="trial_directory_already_used"):
        collect(settings, tmp_path, 1)


@pytest.mark.parametrize("state", ["blocked", "rejected", "duplicate", "superseded"])
def test_unapprovable_event_stops_trial_before_next_document(settings, tmp_path, monkeypatch, state):
    import json
    from hashlib import sha256
    from unittest.mock import MagicMock

    import signalbrief.live_trial as trial

    raw = b"An isolated orchestration fixture, not a real financial result."
    item = {
        "descriptor": {},
        "object_key": "fixture",
        "sha256": sha256(raw).hexdigest(),
        "content_type": "text/plain",
    }
    (tmp_path / "manifest.json").write_text(
        json.dumps(
            {
                "status": "COLLECTED_NOT_END_TO_END_VERIFIED",
                "pairs": [{"symbol": "AAPL", "documents": [item, item]}],
            }
        )
    )
    engine, factory, store = MagicMock(), MagicMock(), MagicMock()
    factory.return_value.__enter__.return_value.scalar.return_value = SimpleNamespace(id="company")
    factory.return_value.__enter__.return_value.get.return_value = SimpleNamespace(state=state)
    store.get.return_value = raw
    monkeypatch.setattr(trial, "make_engine", lambda _: engine)
    monkeypatch.setattr(trial, "session_factory", lambda _: factory)
    monkeypatch.setattr(trial, "make_store", lambda _: store)
    monkeypatch.setattr(trial, "LocalBlobStore", lambda _: store)
    monkeypatch.setattr(
        trial.DocumentDescriptor,
        "model_validate",
        lambda _: SimpleNamespace(provider="sec", is_demo=False, company_external_id="0000320193"),
    )
    persist = MagicMock(return_value=("document", False))
    process = MagicMock(return_value="event")
    monkeypatch.setattr(trial, "persist_document", persist)
    monkeypatch.setattr(trial, "process_document", process)
    config = settings.model_copy(
        update={
            "environment": "production",
            "demo_mode": False,
            "auto_publish_validated": False,
            "openai_api_key": "unused-test-key",
            "openai_model": "unused",
        }
    )
    report = analyze(config, tmp_path)
    assert report["status"] == "BLOCKED"
    assert report["errors"] == [{"stage": "analysis", "code": "pilot_event_not_approvable_" + state}]
    assert persist.call_count == process.call_count == 1
    engine.dispose.assert_called_once()
