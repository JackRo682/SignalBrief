import asyncio
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from services.worker.runtime import Runtime


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    runtime = Runtime()
    app.state.runtime = runtime
    task = asyncio.create_task(runtime.run())
    try:
        await asyncio.wait_for(runtime.started.wait(), timeout=2)
        yield
    finally:
        runtime.stop.set()
        await asyncio.wait_for(task, timeout=2)


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health/live")
def live() -> JSONResponse:
    runtime: Runtime = app.state.runtime
    alive = runtime.is_alive()
    return JSONResponse(
        {"status": "alive" if alive else "stopped", "service": "worker"},
        status_code=200 if alive else 503,
        headers={"Cache-Control": "no-store"},
    )


@app.get("/health/ready")
def ready() -> JSONResponse:
    return JSONResponse(
        {"status": "not_ready", "reason": "foundation_only"},
        status_code=503,
        headers={"Cache-Control": "no-store"},
    )


def health_port(value: str) -> int:
    port = int(value)
    if not 1 <= port <= 65535:
        raise ValueError("WORKER_HEALTH_PORT must be between 1 and 65535")
    return port


def main() -> None:
    uvicorn.run(app, host="127.0.0.1", port=health_port(os.getenv("WORKER_HEALTH_PORT", "8001")))


if __name__ == "__main__":
    main()
