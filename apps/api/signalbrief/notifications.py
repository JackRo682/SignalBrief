from sqlalchemy import select

from .limits import aware, dialect_insert
from .models import Alert, Change, Document, Event, Notification, now, uid
from .ranking import memberships, rank


def deliver_notifications(factory, event_id):
    count = 0
    with factory.begin() as s:
        event = s.get(Event, event_id)
        if not event or event.state != "published":
            return 0
        document = s.get(Document, event.document_id)
        alerts = s.execute(select(Alert).where(Alert.enabled.is_(True))).scalars().all()
        for alert in alerts:
            # Do not flood newly-created alerts with old publications on a replay.
            if not event.published_to_users_at or aware(event.published_to_users_at) < aware(
                alert.created_at
            ):
                continue
            watched, held = memberships(s, alert.user_id)
            if event.company_id not in watched | held:
                continue
            if alert.event_types and event.event_type not in alert.event_types:
                continue
            changed = s.execute(
                select(Change.id)
                .where(
                    Change.event_id == event.id,
                    Change.change_type.in_(["increased", "decreased", "wording_changed"]),
                )
                .limit(1)
            ).scalar_one_or_none()
            score = rank(
                event,
                event.company_id in watched,
                event.company_id in held,
                document.provider,
                has_change=changed is not None,
            )["score"]
            if score < alert.min_score:
                continue
            stmt = dialect_insert(s, Notification).values(
                id=uid(), user_id=alert.user_id, alert_id=alert.id, event_id=event.id, created_at=now()
            )
            inserted = s.execute(
                stmt.on_conflict_do_nothing(
                    index_elements=[Notification.alert_id, Notification.event_id]
                ).returning(Notification.id)
            ).scalar_one_or_none()
            count += bool(inserted)
    return count
