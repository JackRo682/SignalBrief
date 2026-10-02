import asyncio
from time import monotonic

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.api.main import app as api
from services.worker.main import app as worker
from services.worker.main import health_port
from services.worker.runtime import Runtime


@pytest.mark.parametrize("app,service", [(api, "api"), (worker, "worker")])
def test_process_health_and_absent_product_routes(app: FastAPI, service: str) -> None:
    with TestClient(app) as client:
        response = client.get("/health/live")
        assert response.status_code == 200
        assert response.json() == {"status": "alive", "service": service}
        assert response.headers["cache-control"] == "no-store"
        response = client.get("/health/ready")
        assert response.status_code == 503
        assert response.json() == {"status": "not_ready", "reason": "foundation_only"}
        assert response.headers["cache-control"] == "no-store"
        assert client.get("/v1/feed").status_code == 404
        assert client.get("/docs").status_code == 404
        assert client.post("/health/live").status_code == 405


@pytest.mark.parametrize("value", ["0", "65536", "abc", "-1"])
def test_worker_rejects_invalid_ports(value: str) -> None:
    with pytest.raises(ValueError):
        health_port(value)


def test_worker_start_stale_stop_and_restart() -> None:
    async def scenario() -> None:
        runtime = Runtime()
        assert not runtime.is_alive()
        task = asyncio.create_task(runtime.run())
        await asyncio.wait_for(runtime.started.wait(), timeout=2)
        assert runtime.is_alive()
        runtime.last_heartbeat = monotonic() - 3
        assert not runtime.is_alive()
        runtime.stop.set()
        await asyncio.wait_for(task, timeout=2)
        assert not runtime.is_alive()
        fresh = Runtime()
        assert not fresh.stop.is_set()

    asyncio.run(scenario())
