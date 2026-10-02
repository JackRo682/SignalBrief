import json
import math
from pathlib import Path

from sqlalchemy import select

from .limits import aware
from .models import Portfolio, Position, Watchlist, WatchlistItem, now

CONFIG = json.loads((Path(__file__).parent / "config" / "ranking-v1.json").read_text(encoding="utf-8"))


def memberships(session, user_id):
    watched = set(
        session.execute(
            select(WatchlistItem.company_id)
            .join(Watchlist, Watchlist.id == WatchlistItem.watchlist_id)
            .where(Watchlist.user_id == user_id)
        ).scalars()
    )
    held = set(
        session.execute(
            select(Position.company_id)
            .join(Portfolio, Portfolio.id == Position.portfolio_id)
            .where(Portfolio.user_id == user_id)
        ).scalars()
    )
    return watched, held


def rank(event, is_watched, is_held, source_provider, has_change=True, instant=None):
    age_hours = max(0, ((instant or now()) - aware(event.published_at)).total_seconds() / 3600)
    components = {
        "P": CONFIG["holding_relevance"] if is_held else CONFIG["watchlist_relevance"] if is_watched else 0,
        "M": max(0, min(1, event.materiality)),
        "N": 1.0 if has_change else 0.3,
        "S": 1.0 if source_provider in ("dart", "sec") else 0.5,
        "A": None,
        "T": math.exp(-math.log(2) * age_hours / CONFIG["half_life_hours"]),
    }
    included = {k: w for k, w in CONFIG["weights"].items() if components[k] is not None}
    total = sum(included.values())
    weights = {k: w / total for k, w in included.items()}
    score = sum(components[k] * weights[k] for k in weights)
    return {
        "score": round(score, 6),
        "version": CONFIG["version"],
        "components": components,
        "effective_weights": weights,
        "missing_components": ["A"],
        "reason": "보유종목" if is_held else "관심종목" if is_watched else "직접 조회한 종목",
        "portfolio_weight_method": "membership_only_no_live_prices_or_fx",
        "market_reaction": "unavailable",
    }
