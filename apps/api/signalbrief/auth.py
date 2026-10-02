from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .limits import dialect_insert
from .models import Portfolio, User, Watchlist, now
from .pipeline import stable_id
from .seed import DEMO_ADMIN_ID, DEMO_USER_ID

bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class Principal:
    id: str
    is_admin: bool
    display_name: str


def issue_demo_token(settings, admin=False):
    if not settings.demo_mode or settings.auth_mode != "demo" or settings.environment == "production":
        raise HTTPException(404, "demo_auth_disabled")
    if admin and not settings.demo_admin:
        raise HTTPException(403, "demo_admin_disabled")
    subject = DEMO_ADMIN_ID if admin else DEMO_USER_ID
    stamp = now()
    token = jwt.encode(
        {
            "sub": subject,
            "iss": "signalbrief-demo",
            "aud": "signalbrief-demo",
            "iat": stamp,
            "exp": stamp + timedelta(hours=4),
        },
        settings.demo_jwt_secret,
        algorithm="HS256",
    )
    return {"access_token": token, "token_type": "bearer", "expires_in": 14400}


def authenticate(
    request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)
) -> Principal:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "authentication_required", headers={"WWW-Authenticate": "Bearer"})
    settings = request.app.state.settings
    token = credentials.credentials
    try:
        if len(token) > 16000:
            raise ValueError("token_too_large")
        if settings.auth_mode == "demo":
            claims = jwt.decode(
                token,
                settings.demo_jwt_secret,
                algorithms=["HS256"],
                audience="signalbrief-demo",
                issuer="signalbrief-demo",
                options={"require": ["sub", "iat", "exp", "aud", "iss"]},
            )
        else:
            header = jwt.get_unverified_header(token)
            if header.get("alg") not in ("ES256", "RS256"):
                raise ValueError("asymmetric_supabase_jwt_required")
            key = request.app.state.jwks.get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                key.key,
                algorithms=[header["alg"]],
                audience="authenticated",
                issuer=settings.supabase_url.rstrip("/") + "/auth/v1",
                options={"require": ["sub", "iat", "exp", "aud", "iss"]},
                leeway=15,
            )
            if claims.get("role") != "authenticated" or claims.get("is_anonymous"):
                raise ValueError("authenticated_account_required")
        subject = str(UUID(claims["sub"]))
    except (jwt.PyJWTError, ValueError, KeyError, TypeError):
        raise HTTPException(
            401, "session_invalid_or_expired", headers={"WWW-Authenticate": "Bearer"}
        ) from None
    # Never trust user_metadata, app_metadata, a request header, or a query parameter for admin grants.
    admin = subject in settings.admins or (
        settings.demo_mode and settings.demo_admin and subject == DEMO_ADMIN_ID
    )
    name = (
        "데모 운영자" if settings.demo_mode and admin else "데모 사용자" if settings.demo_mode else "투자자"
    )
    with request.app.state.factory.begin() as s:
        statement = dialect_insert(s, User).values(
            id=subject,
            display_name=name,
            density="beginner",
            analytics_consent=False,
            onboarding_completed=False,
            created_at=now(),
            updated_at=now(),
        )
        s.execute(statement.on_conflict_do_nothing(index_elements=[User.id]))
        for model, label in ((Watchlist, "관심종목"), (Portfolio, "내 포트폴리오")):
            statement = dialect_insert(s, model).values(
                id=stable_id(subject, model.__tablename__), user_id=subject, name=label, created_at=now()
            )
            s.execute(statement.on_conflict_do_nothing(index_elements=[model.user_id, model.name]))
    return Principal(subject, admin, name)


def require_admin(principal: Principal = Depends(authenticate)) -> Principal:
    if not principal.is_admin:
        raise HTTPException(403, "administrator_required")
    return principal
