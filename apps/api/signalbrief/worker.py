import logging
import os
import signal
import socket
import threading
from datetime import date

from . import jobs
from .errors import LostLease, ProviderError
from .ingestion import IngestionService
from .notifications import deliver_notifications
from .pipeline import process_document

log = logging.getLogger(__name__)


def run_once(settings, factory, worker_id=None):
    worker_id = worker_id or f"{socket.gethostname()}:{os.getpid()}"
    lease = jobs.claim(factory, worker_id, settings.worker_lease_seconds)
    if not lease:
        return False
    stopped = threading.Event()

    def keep_alive():
        while not stopped.wait(settings.worker_lease_seconds / 3):
            if not jobs.heartbeat(factory, lease, settings.worker_lease_seconds):
                return

    keeper = threading.Thread(target=keep_alive, daemon=True)
    keeper.start()
    log.info("job_started", extra={"job_id": lease.job_id})
    try:
        if lease.kind == "parse":
            process_document(
                settings,
                factory,
                lease.payload["document_id"],
                lease.payload.get("revision", "pipeline-v1"),
                lease=lease,
            )
        elif lease.kind == "ingest_company":
            IngestionService(settings, factory).company(
                lease.payload["company_id"],
                date.fromisoformat(lease.payload["since"]),
                date.fromisoformat(lease.payload["until"]),
            )
        elif lease.kind == "ingest_document":
            IngestionService(settings, factory).document(
                lease.payload["company_id"], lease.payload["external_id"]
            )
        elif lease.kind == "sync_companies":
            IngestionService(settings, factory).sync_companies(lease.payload["provider"])
        elif lease.kind == "analytics":
            from .analytics import export_event

            export_event(settings, factory, lease.payload["event_id"])
        elif lease.kind == "notify":
            deliver_notifications(factory, lease.payload["event_id"])
        else:
            raise ProviderError("unknown_job_kind")
        jobs.succeed(factory, lease)
        log.info("job_succeeded", extra={"job_id": lease.job_id})
    except LostLease:
        log.warning("job_lease_lost", extra={"job_id": lease.job_id})
    except Exception as exc:
        jobs.fail(factory, lease, exc)
        log.warning("job_failed", extra={"job_id": lease.job_id, "error_type": type(exc).__name__})
    finally:
        stopped.set()
        keeper.join(timeout=5)
    return True


def run_forever(settings, factory):
    stopped = threading.Event()

    def stop(signum, frame):
        stopped.set()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    while not stopped.is_set():
        if not run_once(settings, factory):
            stopped.wait(settings.worker_poll_seconds)
