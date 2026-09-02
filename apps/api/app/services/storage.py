"""File storage: local disk (dev) or S3-compatible (Cloudflare R2 in prod).

Canonical attachment URLs always go through the auth-gated API
(``/api/uploads/files/{tenant}/{filename}``). The bucket stays private;
API and worker both talk to the same object store.
"""

from __future__ import annotations

import asyncio
import mimetypes
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path

import httpx

from app.config import get_settings

settings = get_settings()

ATTACHMENT_SCHEMA_VERSION = 1


@dataclass
class StoredFile:
    id: str
    name: str
    mime: str
    size: int
    url: str
    storage_key: str

    def to_attachment(self) -> dict:
        return {
            "schema_version": ATTACHMENT_SCHEMA_VERSION,
            "id": self.id,
            "name": self.name,
            "mime": self.mime,
            "size": self.size,
            "url": self.url,
        }


@dataclass
class FetchedFile:
    data: bytes
    mime: str


def _canonical_url(tenant_id: str, filename: str) -> str:
    return f"{settings.public_api_url.rstrip('/')}/api/uploads/files/{tenant_id}/{filename}"


def _safe_key(tenant_id: str, filename: str) -> tuple[str, str, str]:
    file_id = str(uuid.uuid4())
    safe_name = Path(filename).name or "file"
    stored_name = f"{file_id}_{safe_name}"
    return file_id, safe_name, f"{tenant_id}/{stored_name}"


class StorageBackend(ABC):
    @abstractmethod
    async def store(self, *, data: bytes, filename: str, mime: str, tenant_id: str) -> StoredFile:
        raise NotImplementedError

    @abstractmethod
    async def delete(self, storage_key: str) -> None:
        raise NotImplementedError

    @abstractmethod
    async def fetch(self, storage_key: str) -> FetchedFile | None:
        raise NotImplementedError


class LocalStorageBackend(StorageBackend):
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _store_sync(self, data: bytes, key: str) -> None:
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def _delete_sync(self, storage_key: str) -> None:
        path = self.root / storage_key
        if path.exists():
            path.unlink()

    def _fetch_sync(self, storage_key: str) -> FetchedFile | None:
        path = (self.root / storage_key).resolve()
        root = self.root.resolve()
        if not str(path).startswith(str(root)) or not path.is_file():
            return None
        mime = guess_mime(path.name, None)
        try:
            return FetchedFile(data=path.read_bytes(), mime=mime)
        except OSError:
            return None

    async def store(self, *, data: bytes, filename: str, mime: str, tenant_id: str) -> StoredFile:
        file_id, safe_name, key = _safe_key(tenant_id, filename)
        await asyncio.to_thread(self._store_sync, data, key)
        return StoredFile(
            id=file_id,
            name=safe_name,
            mime=mime or "application/octet-stream",
            size=len(data),
            url=_canonical_url(tenant_id, Path(key).name),
            storage_key=key,
        )

    async def delete(self, storage_key: str) -> None:
        await asyncio.to_thread(self._delete_sync, storage_key)

    async def fetch(self, storage_key: str) -> FetchedFile | None:
        return await asyncio.to_thread(self._fetch_sync, storage_key)


class S3StorageBackend(StorageBackend):
    def __init__(
        self,
        *,
        bucket: str,
        region: str,
        access_key: str,
        secret_key: str,
        endpoint_url: str,
    ) -> None:
        self.bucket = bucket
        self.region = region
        self.access_key = access_key
        self.secret_key = secret_key
        self.endpoint_url = endpoint_url.rstrip("/")
        self._client = None

    def _s3(self):
        if self._client is None:
            import boto3
            from botocore.config import Config

            self._client = boto3.client(
                "s3",
                region_name=self.region or "auto",
                aws_access_key_id=self.access_key,
                aws_secret_access_key=self.secret_key,
                endpoint_url=self.endpoint_url,
                config=Config(signature_version="s3v4"),
            )
        return self._client

    def _store_sync(self, data: bytes, key: str, content_type: str) -> None:
        self._s3().put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )

    def _delete_sync(self, storage_key: str) -> None:
        self._s3().delete_object(Bucket=self.bucket, Key=storage_key)

    def _fetch_sync(self, storage_key: str) -> FetchedFile | None:
        from botocore.exceptions import ClientError

        try:
            obj = self._s3().get_object(Bucket=self.bucket, Key=storage_key)
        except ClientError:
            return None
        body = obj["Body"].read()
        mime = str(obj.get("ContentType") or guess_mime(storage_key, None))
        return FetchedFile(data=body, mime=mime)

    async def store(self, *, data: bytes, filename: str, mime: str, tenant_id: str) -> StoredFile:
        file_id, safe_name, key = _safe_key(tenant_id, filename)
        content_type = mime or "application/octet-stream"
        await asyncio.to_thread(self._store_sync, data, key, content_type)
        return StoredFile(
            id=file_id,
            name=safe_name,
            mime=content_type,
            size=len(data),
            url=_canonical_url(tenant_id, Path(key).name),
            storage_key=key,
        )

    async def delete(self, storage_key: str) -> None:
        await asyncio.to_thread(self._delete_sync, storage_key)

    async def fetch(self, storage_key: str) -> FetchedFile | None:
        return await asyncio.to_thread(self._fetch_sync, storage_key)


def get_storage_backend() -> StorageBackend:
    if settings.storage_backend == "s3" and settings.storage_s3_bucket:
        return S3StorageBackend(
            bucket=settings.storage_s3_bucket,
            region=settings.storage_s3_region,
            access_key=settings.storage_s3_access_key,
            secret_key=settings.storage_s3_secret_key,
            endpoint_url=settings.storage_s3_endpoint,
        )
    return LocalStorageBackend(Path(settings.storage_local_path))


def guess_mime(filename: str, content_type: str | None) -> str:
    if content_type:
        return content_type.split(";")[0].strip()
    guessed, _ = mimetypes.guess_type(filename)
    return guessed or "application/octet-stream"


def storage_key_from_url(url: str) -> str | None:
    """Parse a canonical uploads URL into the storage key ``tenant/filename``."""
    marker = "/api/uploads/files/"
    if marker not in url:
        return None
    rel = url.split(marker, 1)[1].split("?", 1)[0]
    parts = [p for p in rel.split("/") if p and p not in (".", "..")]
    if len(parts) != 2:
        return None
    return f"{parts[0]}/{parts[1]}"


def _local_file_for_url(url: str) -> Path | None:
    """Map a local-backend uploads URL to its on-disk path."""
    key = storage_key_from_url(url)
    if not key:
        return None
    root = Path(settings.storage_local_path).resolve()
    path = (root / key).resolve()
    if not str(path).startswith(str(root)):
        return None
    return path


async def fetch_attachment_bytes(url: str) -> bytes | None:
    key = storage_key_from_url(url)
    if key:
        fetched = await get_storage_backend().fetch(key)
        if fetched is not None:
            return fetched.data
        # Local fallback when the process that wrote the file is this one
        # and the backend is still local (tests / single-container).
        if settings.storage_backend != "s3":
            local = _local_file_for_url(url)
            if local is not None:
                try:
                    return await asyncio.to_thread(
                        lambda: local.read_bytes() if local.is_file() else None
                    )
                except OSError:
                    return None
    if url.startswith("/"):
        url = f"{settings.public_api_url.rstrip('/')}{url}"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(url)
            if res.status_code == 200:
                return res.content
    except Exception:
        return None
    return None
