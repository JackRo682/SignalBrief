from fastapi import FastAPI
from fastapi.responses import JSONResponse

app = FastAPI(title="SignalBrief API foundation", docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health/live")
def live() -> JSONResponse:
    return JSONResponse(
        {"status": "alive", "service": "api"}, headers={"Cache-Control": "no-store"}
    )


@app.get("/health/ready")
def ready() -> JSONResponse:
    # DB/config readiness is deliberately unimplemented until the persistence tasks.
    return JSONResponse(
        {"status": "not_ready", "reason": "foundation_only"},
        status_code=503,
        headers={"Cache-Control": "no-store"},
    )
