from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import delete, func, or_, select

from . import api_schemas as a
from . import models as m
from .auth import Principal, authenticate, issue_demo_token
from .jobs import enqueue
from .limits import aware, consume_budget, dialect_insert
from .questions import answer_question
from .ranking import memberships
from .views import company_dict, event_card, event_evidence, require_company, require_event

router = APIRouter(prefix="/v1")
P = Annotated[Principal, Depends(authenticate)]


def session(request: Request):
    with request.app.state.factory() as db:
        yield db


S = Annotated[object, Depends(session)]


def default_watchlist(db, user_id):
    return db.execute(
        select(m.Watchlist).where(m.Watchlist.user_id == user_id).order_by(m.Watchlist.created_at).limit(1)
    ).scalar_one()


def default_portfolio(db, user_id):
    return db.execute(
        select(m.Portfolio).where(m.Portfolio.user_id == user_id).order_by(m.Portfolio.created_at).limit(1)
    ).scalar_one()


def profile(db, principal, settings):
    user = db.get(m.User, principal.id)
    return {
        "id": user.id,
        "display_name": user.display_name,
        "density": user.density,
        "onboarding_completed": user.onboarding_completed,
        "analytics_consent": user.analytics_consent,
        "is_admin": principal.is_admin,
        "demo_mode": settings.demo_mode,
    }


def track(db, user_id, event_name, properties=None):
    user = db.get(m.User, user_id)
    if user and user.analytics_consent:
        event_id = m.uid()
        db.add(m.UserEvent(id=event_id, user_id=user_id, event_name=event_name, properties=properties or {}))
        enqueue(db, "analytics", {"event_id": event_id}, "analytics:" + event_id)


@router.get("/config")
def config(request: Request):
    settings = request.app.state.settings
    return {
        "demo_mode": settings.demo_mode,
        "demo_admin_enabled": settings.demo_mode and settings.demo_admin,
        "auth_mode": settings.auth_mode,
        "version": "0.1.0",
    }


@router.post("/auth/demo")
def demo(request: Request, admin: bool = False):
    if not consume_budget(
        request.app.state.factory, "demo-auth:" + (request.client.host if request.client else "unknown"), 20
    ):
        raise HTTPException(429, "login_rate_limit", headers={"Retry-After": "60"})
    return issue_demo_token(request.app.state.settings, admin)


@router.get("/me", response_model=a.MeOut)
def me(request: Request, principal: P, db: S):
    return profile(db, principal, request.app.state.settings)


@router.patch("/me", response_model=a.MeOut)
def update_me(data: a.ProfileUpdate, request: Request, principal: P, db: S):
    user = db.get(m.User, principal.id)
    for key, value in data.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(user, key, value)
    if data.density:
        track(db, principal.id, "density_changed", {"density": data.density})
    db.commit()
    return profile(db, principal, request.app.state.settings)


@router.post("/onboarding", response_model=a.MeOut)
def onboard(data: a.OnboardingIn, request: Request, principal: P, db: S):
    settings = request.app.state.settings
    for company_id in data.company_ids:
        require_company(db, company_id, settings.demo_mode)
    watchlist = default_watchlist(db, principal.id)
    for company_id in data.company_ids:
        statement = dialect_insert(db, m.WatchlistItem).values(
            watchlist_id=watchlist.id, company_id=company_id, created_at=m.now()
        )
        db.execute(
            statement.on_conflict_do_nothing(
                index_elements=[m.WatchlistItem.watchlist_id, m.WatchlistItem.company_id]
            )
        )
    user = db.get(m.User, principal.id)
    first = not user.onboarding_completed
    user.onboarding_completed, user.analytics_consent = True, data.analytics_consent
    if first:
        track(db, principal.id, "onboarding_completed", {"count": len(data.company_ids)})
        db.add(
            m.Alert(user_id=principal.id, name="중요 변경 알림", event_types=[], min_score=0.4, enabled=True)
        )
    db.commit()
    return profile(db, principal, settings)


@router.get("/companies", response_model=list[a.CompanyOut])
def companies(
    request: Request,
    principal: P,
    db: S,
    q: str = Query("", max_length=100),
    market: str | None = None,
    limit: int = Query(30, ge=1, le=100),
):
    statement = select(m.Company).where(m.Company.is_demo == request.app.state.settings.demo_mode)
    if q:
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        statement = statement.where(
            or_(
                m.Company.name.ilike("%" + escaped + "%", escape="\\"),
                m.Company.ticker.ilike("%" + escaped + "%", escape="\\"),
            )
        )
    if market:
        statement = statement.where(m.Company.market == market)
    return db.execute(statement.order_by(m.Company.name).limit(limit)).scalars().all()


@router.get("/watchlist", response_model=a.WatchlistOut)
def watchlist(principal: P, db: S):
    row = default_watchlist(db, principal.id)
    items = (
        db.execute(
            select(m.Company)
            .join(m.WatchlistItem, m.WatchlistItem.company_id == m.Company.id)
            .where(m.WatchlistItem.watchlist_id == row.id)
            .order_by(m.Company.name)
        )
        .scalars()
        .all()
    )
    return {"id": row.id, "name": row.name, "items": items}


@router.put("/watchlist/{company_id}", status_code=204)
def add_watchlist(company_id: str, request: Request, principal: P, db: S):
    require_company(db, company_id, request.app.state.settings.demo_mode)
    row = default_watchlist(db, principal.id)
    current_count = db.execute(
        select(func.count()).select_from(m.WatchlistItem).where(m.WatchlistItem.watchlist_id == row.id)
    ).scalar_one()
    exists = db.get(m.WatchlistItem, (row.id, company_id))
    if current_count >= 100 and not exists:
        raise HTTPException(409, "watchlist_limit_100")
    statement = dialect_insert(db, m.WatchlistItem).values(
        watchlist_id=row.id, company_id=company_id, created_at=m.now()
    )
    inserted = db.execute(
        statement.on_conflict_do_nothing(
            index_elements=[m.WatchlistItem.watchlist_id, m.WatchlistItem.company_id]
        ).returning(m.WatchlistItem.company_id)
    ).scalar_one_or_none()
    if inserted:
        track(db, principal.id, "watchlist_added", {"company_id": company_id})
    db.commit()
    return Response(status_code=204)


@router.delete("/watchlist/{company_id}", status_code=204)
def remove_watchlist(company_id: str, principal: P, db: S):
    row = default_watchlist(db, principal.id)
    db.execute(
        delete(m.WatchlistItem).where(
            m.WatchlistItem.watchlist_id == row.id, m.WatchlistItem.company_id == company_id
        )
    )
    db.commit()
    return Response(status_code=204)


@router.get("/portfolio", response_model=a.PortfolioOut)
def portfolio(principal: P, db: S):
    row = default_portfolio(db, principal.id)
    positions = db.execute(
        select(m.Position, m.Company)
        .join(m.Company, m.Company.id == m.Position.company_id)
        .where(m.Position.portfolio_id == row.id)
        .order_by(m.Company.name)
    ).all()
    return {
        "id": row.id,
        "name": row.name,
        "positions": [
            {
                "id": p.id,
                "company": company_dict(c),
                "quantity": str(p.quantity.normalize()),
                "average_cost": str(p.average_cost.normalize()) if p.average_cost is not None else None,
                "currency": p.currency,
            }
            for p, c in positions
        ],
        "weighting_note": "중요도는 보유 여부를 반영합니다. 실시간 가격·환율이 없어 평가손익이나 시가 기준 비중은 계산하지 않습니다.",
    }


@router.put("/portfolio/positions/{company_id}", status_code=204)
def set_position(company_id: str, data: a.PositionIn, request: Request, principal: P, db: S):
    require_company(db, company_id, request.app.state.settings.demo_mode)
    row = default_portfolio(db, principal.id)
    values = data.model_dump()
    stmt = dialect_insert(db, m.Position).values(
        id=m.uid(),
        portfolio_id=row.id,
        company_id=company_id,
        **values,
        created_at=m.now(),
        updated_at=m.now(),
    )
    db.execute(
        stmt.on_conflict_do_update(
            index_elements=[m.Position.portfolio_id, m.Position.company_id],
            set_={**values, "updated_at": m.now()},
        )
    )
    db.commit()
    return Response(status_code=204)


@router.delete("/portfolio/positions/{company_id}", status_code=204)
def remove_position(company_id: str, principal: P, db: S):
    row = default_portfolio(db, principal.id)
    db.execute(
        delete(m.Position).where(m.Position.portfolio_id == row.id, m.Position.company_id == company_id)
    )
    db.commit()
    return Response(status_code=204)


@router.get("/feed", response_model=a.FeedOut)
def feed(
    request: Request,
    principal: P,
    db: S,
    days: int = Query(30, ge=1, le=180),
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0, le=1000),
):
    watched, held = memberships(db, principal.id)
    selected = watched | held
    cutoff = m.now() - timedelta(days=days)
    events = (
        db.execute(
            select(m.Event)
            .join(m.Document, m.Document.id == m.Event.document_id)
            .where(
                m.Event.company_id.in_(selected),
                m.Event.state == "published",
                m.Event.published_at >= cutoff,
                m.Document.is_demo == request.app.state.settings.demo_mode,
            )
            .order_by(m.Event.published_at.desc())
            .limit(1001)
        )
        .scalars()
        .all()
        if selected
        else []
    )
    truncated = len(events) > 1000
    cards = [event_card(db, event, principal.id, (watched, held)) for event in events[:1000]]
    cards.sort(key=lambda c: (c["ranking"]["score"], c["published_at"], c["id"]), reverse=True)
    page = cards[offset : offset + limit]
    for card in page:
        stmt = dialect_insert(db, m.RankedEvent).values(
            id=m.uid(),
            user_id=principal.id,
            event_id=card["id"],
            score=card["ranking"]["score"],
            breakdown=card["ranking"],
            scoring_version=card["ranking"]["version"],
            created_at=m.now(),
            updated_at=m.now(),
        )
        db.execute(
            stmt.on_conflict_do_update(
                index_elements=[m.RankedEvent.user_id, m.RankedEvent.event_id],
                set_={"score": card["ranking"]["score"], "breakdown": card["ranking"], "updated_at": m.now()},
            )
        )
    latest = (
        db.execute(
            select(func.max(m.Document.ingested_at)).where(m.Document.company_id.in_(selected))
        ).scalar_one()
        if selected
        else None
    )
    db.commit()
    return {
        "items": page,
        "total": len(cards),
        "has_more": offset + limit < len(cards),
        "truncated": truncated,
        "latest_ingested_at": aware(latest) if latest else None,
        "stale": bool(latest and aware(latest) < m.now() - timedelta(hours=72)),
        "demo_mode": request.app.state.settings.demo_mode,
        "generated_at": m.now(),
    }


@router.get("/events/{event_id}", response_model=a.EventDetailOut)
def event_detail(event_id: str, request: Request, principal: P, db: S):
    event = require_event(db, event_id, principal, request.app.state.settings.demo_mode)
    brief = db.execute(select(m.Brief).where(m.Brief.event_id == event.id)).scalar_one()
    return {
        "event": event_card(db, event, principal.id),
        "document": db.get(m.Document, event.document_id),
        "facts": db.execute(select(m.Fact).where(m.Fact.event_id == event.id)).scalars().all(),
        "changes": db.execute(select(m.Change).where(m.Change.event_id == event.id)).scalars().all(),
        "evidence": event_evidence(db, event.id),
        "brief": brief,
        "validations": db.execute(select(m.Validation).where(m.Validation.event_id == event.id))
        .scalars()
        .all(),
        "run": db.get(m.AIRun, event.run_id),
    }


@router.get("/companies/{company_id}/timeline", response_model=list[a.EventCard])
def timeline(
    company_id: str,
    request: Request,
    principal: P,
    db: S,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0, le=10000),
):
    require_company(db, company_id, request.app.state.settings.demo_mode)
    events = (
        db.execute(
            select(m.Event)
            .where(m.Event.company_id == company_id, m.Event.state == "published")
            .order_by(m.Event.published_at.desc())
            .offset(offset)
            .limit(limit)
        )
        .scalars()
        .all()
    )
    return [event_card(db, event, principal.id) for event in events]


@router.post("/events/{event_id}/questions", response_model=a.AnswerOut)
def ask(event_id: str, data: a.QuestionIn, request: Request, principal: P, db: S):
    event = require_event(db, event_id, principal, request.app.state.settings.demo_mode)
    if not consume_budget(request.app.state.factory, "followup:" + principal.id, 10):
        raise HTTPException(429, "followup_rate_limit", headers={"Retry-After": "60"})
    evidence = event_evidence(db, event.id)
    document_id = event.document_id
    track(db, principal.id, "followup_asked", {"event_id": event.id})
    db.commit()  # Do not hold a DB transaction while waiting for a model response.
    return answer_question(
        request.app.state.settings,
        request.app.state.factory,
        principal.id,
        document_id,
        data.question,
        evidence,
    )


@router.get("/calendar", response_model=list[a.CalendarOut])
def calendar(
    request: Request, principal: P, db: S, from_date: date | None = None, until_date: date | None = None
):
    begin, end = from_date or m.now().date(), until_date or m.now().date() + timedelta(days=90)
    if end < begin or (end - begin).days > 366:
        raise HTTPException(422, "calendar_range_must_be_within_one_year")
    watched, held = memberships(db, principal.id)
    rows = (
        db.execute(
            select(m.CalendarItem)
            .where(
                m.CalendarItem.occurs_on >= begin,
                m.CalendarItem.occurs_on <= end,
                or_(
                    m.CalendarItem.user_id == principal.id,
                    (m.CalendarItem.user_id.is_(None) & m.CalendarItem.company_id.in_(watched | held)),
                ),
            )
            .order_by(m.CalendarItem.occurs_on)
            .limit(500)
        )
        .scalars()
        .all()
    )
    result, seen = [], set()
    for item in rows:
        source_url, is_demo = None, False
        if item.origin == "official":
            event = db.get(m.Event, item.event_id)
            if not event or event.state != "published":
                continue
            document = db.get(m.Document, event.document_id)
            if document.is_demo != request.app.state.settings.demo_mode:
                continue
            source_url, is_demo = document.source_url, document.is_demo
            key = (item.company_id, item.occurs_on, item.quote)
            if key in seen:
                continue
            seen.add(key)
        result.append(
            {
                "id": item.id,
                "title": item.title,
                "occurs_on": item.occurs_on,
                "company_id": item.company_id,
                "event_id": item.event_id,
                "origin": item.origin,
                "quote": item.quote,
                "source_url": source_url,
                "is_demo": is_demo,
            }
        )
    return result


@router.post("/calendar", response_model=a.CalendarOut, status_code=201)
def add_calendar(data: a.CalendarIn, request: Request, principal: P, db: S):
    if data.company_id:
        require_company(db, data.company_id, request.app.state.settings.demo_mode)
    row = m.CalendarItem(user_id=principal.id, origin="user", **data.model_dump())
    db.add(row)
    db.commit()
    return {
        "id": row.id,
        "title": row.title,
        "occurs_on": row.occurs_on,
        "company_id": row.company_id,
        "event_id": None,
        "origin": "user",
        "quote": None,
        "source_url": None,
        "is_demo": False,
    }


@router.delete("/calendar/{item_id}", status_code=204)
def delete_calendar(item_id: str, principal: P, db: S):
    item = db.execute(
        select(m.CalendarItem).where(m.CalendarItem.id == item_id, m.CalendarItem.user_id == principal.id)
    ).scalar_one_or_none()
    if not item:
        raise HTTPException(404, "calendar_item_not_found")
    db.delete(item)
    db.commit()
    return Response(status_code=204)


@router.get("/alerts", response_model=list[a.AlertOut])
def alerts(principal: P, db: S):
    return (
        db.execute(select(m.Alert).where(m.Alert.user_id == principal.id).order_by(m.Alert.created_at.desc()))
        .scalars()
        .all()
    )


@router.post("/alerts", response_model=a.AlertOut, status_code=201)
def create_alert(data: a.AlertIn, principal: P, db: S):
    count = db.execute(
        select(func.count()).select_from(m.Alert).where(m.Alert.user_id == principal.id)
    ).scalar_one()
    if count >= 20:
        raise HTTPException(409, "alert_limit_20")
    row = m.Alert(user_id=principal.id, **data.model_dump())
    db.add(row)
    track(db, principal.id, "alert_created")
    db.commit()
    return row


@router.put("/alerts/{alert_id}", response_model=a.AlertOut)
def update_alert(alert_id: str, data: a.AlertIn, principal: P, db: S):
    row = db.execute(
        select(m.Alert).where(m.Alert.id == alert_id, m.Alert.user_id == principal.id)
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "alert_not_found")
    for key, value in data.model_dump().items():
        setattr(row, key, value)
    db.commit()
    return row


@router.delete("/alerts/{alert_id}", status_code=204)
def delete_alert(alert_id: str, principal: P, db: S):
    row = db.execute(
        select(m.Alert).where(m.Alert.id == alert_id, m.Alert.user_id == principal.id)
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "alert_not_found")
    db.delete(row)
    db.commit()
    return Response(status_code=204)


@router.get("/notifications")
def notifications(principal: P, db: S, limit: int = Query(50, ge=1, le=100)):
    rows = db.execute(
        select(m.Notification, m.Event)
        .join(m.Event, m.Event.id == m.Notification.event_id)
        .where(m.Notification.user_id == principal.id, m.Event.state == "published")
        .order_by(m.Notification.created_at.desc())
        .limit(limit)
    ).all()
    return [
        {
            "id": row.id,
            "read_at": row.read_at,
            "created_at": row.created_at,
            "event": event_card(db, event, principal.id),
        }
        for row, event in rows
    ]


@router.put("/notifications/{notification_id}/read", status_code=204)
def read_notification(notification_id: str, principal: P, db: S):
    row = db.execute(
        select(m.Notification).where(
            m.Notification.id == notification_id, m.Notification.user_id == principal.id
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "notification_not_found")
    row.read_at = row.read_at or m.now()
    db.commit()
    return Response(status_code=204)


@router.post("/events/{event_id}/feedback", status_code=204)
def feedback(event_id: str, data: a.FeedbackIn, request: Request, principal: P, db: S):
    require_event(db, event_id, principal, request.app.state.settings.demo_mode)
    values = data.model_dump()
    statement = dialect_insert(db, m.Feedback).values(
        id=m.uid(), user_id=principal.id, event_id=event_id, **values, state="open", created_at=m.now()
    )
    db.execute(
        statement.on_conflict_do_update(index_elements=[m.Feedback.user_id, m.Feedback.event_id], set_=values)
    )
    track(db, principal.id, "feedback_submitted", {"event_id": event_id})
    db.commit()
    return Response(status_code=204)


@router.post("/analytics", status_code=204)
def analytics(data: a.AnalyticsIn, principal: P, db: S):
    track(db, principal.id, data.event_name, data.properties)
    db.commit()
    return Response(status_code=204)
