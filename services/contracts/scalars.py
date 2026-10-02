import re
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Self
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


def validate_id(value: str) -> str:
    if str(UUID(value)) != value:
        raise ValueError("UUID must use canonical lowercase representation")
    return value


def validate_date(value: str) -> str:
    date.fromisoformat(value)
    return value


def validate_utc(value: str) -> str:
    datetime.fromisoformat(value)
    return value


def unique_ids(value: list[str]) -> list[str]:
    if len(value) != len(set(value)):
        raise ValueError("duplicate IDs")
    return value


Id = Annotated[
    str,
    StringConstraints(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"),
    AfterValidator(validate_id),
    Field(json_schema_extra={"format": "uuid"}),
]
Hash = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
Text = Annotated[str, StringConstraints(min_length=1, max_length=16000)]
Version = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")]
Reason = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,79}$")]
Date = Annotated[
    str,
    StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}$"),
    AfterValidator(validate_date),
    Field(json_schema_extra={"format": "date"}),
]
Utc = Annotated[
    str,
    StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$"),
    AfterValidator(validate_utc),
    Field(json_schema_extra={"format": "date-time"}),
]
DecimalString = Annotated[
    str, StringConstraints(pattern=r"^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$", max_length=100)
]
Nonnegative = Annotated[int, Field(ge=0)]
Positive = Annotated[int, Field(ge=1)]
Ids = Annotated[
    list[Id], AfterValidator(unique_ids), Field(json_schema_extra={"uniqueItems": True})
]


def fraction(value: str) -> str:
    if not Decimal(0) <= Decimal(value) <= Decimal(1):
        raise ValueError("fraction must be in [0,1]")
    return value


Fraction = Annotated[DecimalString, AfterValidator(fraction)]


def ordered(start: str, end: str) -> None:
    if datetime.fromisoformat(end) < datetime.fromisoformat(start):
        raise ValueError("finish precedes start")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def bounded_references(actual: list[str], allowed: list[str], label: str) -> None:
    require(set(actual) <= set(allowed), f"unresolved {label} references")


def nonempty_name(value: str) -> str:
    require(bool(value.strip()), "blank text")
    return value


Name = Annotated[Text, AfterValidator(nonempty_name)]


class Period(Contract):
    period_start: Date | None
    period_end: Date | None
    fiscal_label: Name | None

    @model_validator(mode="after")
    def check_period(self) -> Self:
        if self.period_start is not None and self.period_end is not None:
            require(self.period_start <= self.period_end, "period reversed")
        return self


def safe_url(value: str) -> str:
    from urllib.parse import urlsplit

    parts = urlsplit(value)
    require(parts.scheme == "https" and bool(parts.hostname), "HTTPS URL required")
    require(parts.username is None and parts.password is None, "URL credentials prohibited")
    require(not parts.query and not parts.fragment, "canonical URL cannot contain query/fragment")
    require(not re.search(r"\s", value), "URL whitespace prohibited")
    # Fetch-time approved-host/DNS/redirect validation is T10, not a schema-level SSRF claim.
    return value


Url = Annotated[Name, AfterValidator(safe_url), Field(json_schema_extra={"format": "uri"})]
