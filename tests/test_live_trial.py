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
