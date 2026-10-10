"""Select a preview bound to the stored headline, never an arbitrary fact UUID."""

from .briefs import LABELS, build_brief


def headline_fact(headline, facts, changes, document):
    facts = [f for f in facts if f.validation_status == "supported"]
    field = next((key for key, label in LABELS.items() if headline.startswith(label + " ")), None)
    candidates = [f for f in facts if f.field == field]
    if not candidates:
        return None
    # Same closing date can have quarterly and year-to-date columns. Prefer the
    # latest starting date, i.e. the current quarter, within the latest period.
    latest = max((f.period or "").split("/")[-1] for f in candidates)
    candidates = [f for f in candidates if (f.period or "").split("/")[-1] == latest]
    if headline == f"{LABELS[field]} 확인 · 비교 근거 추가 필요":
        latest_start = max(f.period or "" for f in candidates)
        candidates = [f for f in candidates if (f.period or "") == latest_start]
    else:
        matching = set()
        for change in changes:
            if change.change_type not in ("increased", "decreased", "wording_changed"):
                continue
            data = {
                key: getattr(change, key)
                for key in ("field", "change_type", "percentage_change", "materiality")
            }
            if build_brief(document, [], [data])["headline"] == headline:
                matching.add(change.current_fact_id)
        candidates = [f for f in candidates if f.id in matching]
    # An ambiguous or stale headline is not evidence for choosing another fact.
    if len(candidates) != 1:
        return None
    return candidates[0]
