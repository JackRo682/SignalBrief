import logging
import time
from contextlib import asynccontextmanager
from uuid import uuid4

import jwt
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.concurrency import run_in_threadpool
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .body_limit import BodyLimitMiddleware
from .db import create_development_schema, make_engine, session_factory
from .limits import consume_budget
from .logging_config import configure_logging
from .ops import router as ops_router
from .routes import router
from .settings import Settings, get_settings

log = logging.getLogger(__name__)


def create_app(settings: Settings | None = None, engine=None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    engine = engine or make_engine(settings)
    factory = session_factory(engine)

    @asynccontextmanager
    async def lifespan(app):
        if settings.environment != "production":
            await run_in_threadpool(create_development_schema, engine, settings)
        if settings.demo_mode and settings.demo_seed_on_start:
            from .seed import seed_demo

            await run_in_threadpool(seed_demo, settings, factory)
        if settings.sentry_dsn:
            import sentry_sdk

            def redact(event, hint):
                event.pop("user", None)
                if "request" in event:
                    event["request"] = {"method": event["request"].get("method")}
                event.pop("breadcrumbs", None)
                return event

            sentry_sdk.init(
                dsn=settings.sentry_dsn,
                send_default_pii=False,
                traces_sample_rate=0.05,
                before_send=redact,
                include_local_variables=False,
            )
        yield

    app = FastAPI(
        title="SignalBrief API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs" if settings.environment != "production" else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.environment != "production" else None,
    )
    app.state.settings, app.state.engine, app.state.factory = settings, engine, factory
    if settings.auth_mode == "supabase":
        app.state.jwks = jwt.PyJWKClient(
            settings.supabase_url.rstrip("/") + "/auth/v1/.well-known/jwks.json",
            cache_jwk_set=True,
            lifespan=300,
            timeout=10,
        )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.hosts)

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request.state.request_id = str(uuid4())
        started = time.monotonic()
        # Rate-limit the actual routed path, independent of Host URL reconstruction.
        if request.method != "OPTIONS" and request.scope["path"].startswith("/v1/"):
            # Never trust forwarded IP headers from arbitrary clients.
            peer = request.client.host if request.client else "unknown"
            permitted = await run_in_threadpool(
                consume_budget, factory, "api-peer:" + peer, settings.api_requests_per_minute
            )
            if not permitted:
                return JSONResponse(
                    {
                        "error": {
                            "code": "rate_limit",
                            "message": "요청이 많습니다. 잠시 후 다시 시도하세요.",
                            "request_id": request.state.request_id,
                        }
                    },
                    status_code=429,
                    headers={"Retry-After": "60", "X-Request-ID": request.state.request_id},
                )
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        if settings.environment == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        log.info(
            "http_request",
            extra={
                "request_id": request.state.request_id,
                "status": response.status_code,
                "duration_ms": int((time.monotonic() - started) * 1000),
            },
        )
        return response

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        code = str(exc.detail) if isinstance(exc.detail, str) else "request_rejected"
        return JSONResponse(
            {
                "error": {
                    "code": code,
                    "message": code,
                    "request_id": getattr(request.state, "request_id", None),
                }
            },
            status_code=exc.status_code,
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse(
            {
                "error": {
                    "code": "validation_error",
                    "message": "입력값을 확인해 주세요.",
                    "fields": [{"location": list(e["loc"]), "message": e["msg"]} for e in exc.errors()],
                    "request_id": getattr(request.state, "request_id", None),
                }
            },
            status_code=422,
        )

    @app.exception_handler(Exception)
    async def server_error(request, exc):
        log.error(
            "unhandled_error",
            extra={
                "request_id": getattr(request.state, "request_id", None),
                "error_type": type(exc).__name__,
            },
        )
        return JSONResponse(
            {
                "error": {
                    "code": "internal_error",
                    "message": "요청을 처리하지 못했습니다.",
                    "request_id": getattr(request.state, "request_id", None),
                }
            },
            status_code=500,
        )

    @app.get("/health/live")
    def live():
        return {"status": "ok", "service": "signalbrief-api"}

    @app.get("/health/ready")
    def ready():
        try:
            with factory() as db:
                db.execute(text("SELECT id FROM companies LIMIT 1"))
        except Exception:
            raise HTTPException(503, "database_or_migration_not_ready") from None
        return {"status": "ready"}

    app.add_middleware(BodyLimitMiddleware)
    app.include_router(router)
    app.include_router(ops_router)
    # CORS must wrap rate/body-limit responses as well as normal route responses.
    # Otherwise browsers conceal legitimate 429/413 JSON errors as generic network errors.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        expose_headers=["X-Request-ID", "Retry-After"],
    )
    return app


app = create_app()
