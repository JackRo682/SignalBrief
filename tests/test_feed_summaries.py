from signalbrief import models as m
from signalbrief.views import event_cards
from sqlalchemy import event as sql_event
from sqlalchemy import select


def test_batched_cards_keep_detail_summary_and_constant_query_count(db, seeded, monkeypatch):
    instant = m.now()
    monkeypatch.setattr("signalbrief.ranking.now", lambda: instant)
    with db.factory() as session:
        events = session.scalars(select(m.Event).where(m.Event.state == "published")).all()
        assert len(events) > 1
        statements = []

        def capture(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement)

        sql_event.listen(db.engine, "before_cursor_execute", capture)
        try:
            one = event_cards(session, events[:1], "unused", (set(), set()))
            one_count = len(statements)
            statements.clear()
            cards = event_cards(session, events, "unused", (set(), set()))
            assert len(statements) == one_count == 5
        finally:
            sql_event.remove(db.engine, "before_cursor_execute", capture)
        assert cards[0] == one[0]
        for card in cards:
            brief = session.scalar(select(m.Brief).where(m.Brief.event_id == card["id"]))
            assert card["interpretation"] == brief.interpretation
            assert (
                card["fact_summary"]
                in session.scalars(
                    select(m.Fact.quote).where(
                        m.Fact.event_id == card["id"], m.Fact.validation_status == "supported"
                    )
                ).all()
            )
            assert len(card["change_summary"]) <= 2
            assert card["source_document"]["source_url"] == card["source_url"]


def test_feed_and_timeline_expose_matching_compact_summaries(client, headers, seeded):
    for company in client.get("/v1/companies", headers=headers).json():
        response = client.put(f"/v1/watchlist/{company['id']}", headers=headers)
        assert response.status_code == 204
    feed = client.get("/v1/feed?days=180", headers=headers)
    assert feed.status_code == 200
    items = feed.json()["items"]
    assert items
    for card in items:
        detail = client.get(f"/v1/events/{card['id']}", headers=headers).json()
        assert card["interpretation"] == detail["brief"]["interpretation"]
        assert card["fact_summary"] in [f["quote"] for f in detail["facts"]]
        timeline = client.get(f"/v1/companies/{card['company']['id']}/timeline", headers=headers).json()
        assert next(e for e in timeline if e["id"] == card["id"])["change_summary"] == card["change_summary"]
