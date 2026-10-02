import hashlib

import httpx

from .errors import ProviderError
from .limits import aware
from .models import User, UserEvent


def export_event(settings, factory, event_id, transport=None):
    if not settings.posthog_project_key:
        return "disabled"
    with factory() as db:
        event = db.get(UserEvent, event_id)
        user = db.get(User, event.user_id) if event else None
        if not user or not user.analytics_consent:
            return "consent_absent"
        payload = {
            "api_key": settings.posthog_project_key,
            "event": event.event_name,
            "uuid": event.id,
            "distinct_id": hashlib.sha256(("signalbrief:" + user.id).encode()).hexdigest(),
            "timestamp": aware(event.created_at).isoformat(),
            "properties": {
                **event.properties,
                "$ip": None,
                "$geoip_disable": True,
                "$process_person_profile": False,
            },
        }
    with httpx.Client(timeout=settings.http_timeout, transport=transport, follow_redirects=False) as client:
        try:
            response = client.post(settings.posthog_host + "/capture/", json=payload)
        except httpx.TransportError:
            raise ProviderError("posthog_transport_error", True) from None
    if response.status_code not in (200, 201):
        raise ProviderError(
            "posthog_capture_failed", response.status_code == 429 or response.status_code >= 500
        )
    return "exported"
