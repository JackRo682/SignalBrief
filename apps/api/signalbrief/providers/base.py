from abc import ABC, abstractmethod
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from ..http_client import validate_source_url


class DocumentDescriptor(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    provider: Literal["dart", "sec", "fixture"]
    company_external_id: str
    external_id: str
    title: str
    form_type: str
    source_url: str
    download_url: str
    published_at: datetime
    publication_date: date
    publication_precision: Literal["date", "second"]
    publication_timezone: str
    provider_metadata: dict
    is_demo: bool = False

    @field_validator("published_at")
    @classmethod
    def timezone_required(cls, value):
        if value.tzinfo is None:
            raise ValueError("Publication time must carry its timezone; date precision is explicit")
        return value

    @model_validator(mode="after")
    def validate_provenance(self):
        if self.is_demo != (self.provider == "fixture"):
            raise ValueError("Fixture provenance must be explicitly labeled as synthetic")
        validate_source_url(self.source_url, self.is_demo)
        validate_source_url(self.download_url, self.is_demo)
        if not self.external_id or not self.title:
            raise ValueError("Document identity/title required")
        return self


class Provider(ABC):
    name: str

    @abstractmethod
    def list_documents(self, company_id: str, since: date, until: date): ...
    @abstractmethod
    def get_document(self, company_id: str, external_id: str) -> DocumentDescriptor: ...
    @abstractmethod
    def download(self, document: DocumentDescriptor) -> tuple[bytes, str]: ...
    @abstractmethod
    def companies(self): ...
    @abstractmethod
    def close(self): ...
