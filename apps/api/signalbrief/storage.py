import os
import re
import tempfile
from hashlib import sha256
from pathlib import Path
from typing import Protocol

import httpx

from .errors import ProviderError


class BlobStore(Protocol):
    def put(self, data: bytes) -> tuple[str, str]: ...
    def get(self, key: str) -> bytes: ...


def object_key(digest: str) -> str:
    return f"raw/{digest[:2]}/{digest}"


def validate_key(key: str):
    if not re.fullmatch(r"raw/[a-f0-9]{2}/[a-f0-9]{64}", key):
        raise ValueError("Invalid content-addressed blob key")


class LocalBlobStore:
    def __init__(self, directory: Path):
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)

    def put(self, data: bytes):
        digest = sha256(data).hexdigest()
        key = object_key(digest)
        dest = self.directory / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            if sha256(dest.read_bytes()).hexdigest() != digest:
                raise ProviderError("raw_blob_corrupt")
            return digest, key
        fd, temp = tempfile.mkstemp(dir=dest.parent)
        try:
            with os.fdopen(fd, "wb") as file:
                file.write(data)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temp, dest)
        finally:
            if os.path.exists(temp):
                os.unlink(temp)
        return digest, key

    def get(self, key: str):
        validate_key(key)
        data = (self.directory / key).read_bytes()
        if sha256(data).hexdigest() != key.rsplit("/", 1)[1]:
            raise ProviderError("raw_blob_integrity_failure")
        return data


class SupabaseBlobStore:
    def __init__(self, settings):
        self.base = settings.supabase_url.rstrip("/") + "/storage/v1/object/" + settings.storage_bucket
        self.headers = {
            "Authorization": "Bearer " + settings.supabase_service_key,
            "apikey": settings.supabase_service_key,
        }
        self.timeout = settings.http_timeout
        self.max_bytes = settings.max_download_bytes

    def put(self, data: bytes):
        digest = sha256(data).hexdigest()
        key = object_key(digest)
        with httpx.Client(timeout=self.timeout, follow_redirects=False) as client:
            response = client.post(
                self.base + "/" + key,
                headers={**self.headers, "Content-Type": "application/octet-stream", "x-upsert": "false"},
                content=data,
            )
        if response.status_code not in (200, 201):
            # Supabase may return 400 for an already-existing object, not only 409.
            try:
                existing = self.get(key)
            except Exception:
                raise ProviderError("storage_upload_failed", True) from None
            if sha256(existing).hexdigest() != digest:
                raise ProviderError("raw_blob_integrity_failure")
        return digest, key

    def get(self, key: str):
        validate_key(key)
        with httpx.Client(timeout=self.timeout, follow_redirects=False) as client:
            with client.stream("GET", self.base + "/" + key, headers=self.headers) as response:
                if response.status_code != 200:
                    raise ProviderError("storage_read_failed", True)
                parts, total = [], 0
                for part in response.iter_bytes():
                    total += len(part)
                    if total > self.max_bytes:
                        raise ProviderError("storage_object_too_large")
                    parts.append(part)
        data = b"".join(parts)
        if sha256(data).hexdigest() != key.rsplit("/", 1)[1]:
            raise ProviderError("raw_blob_integrity_failure")
        return data


def make_store(settings) -> BlobStore:
    return (
        SupabaseBlobStore(settings)
        if settings.storage_mode == "supabase"
        else LocalBlobStore(settings.storage_path)
    )
