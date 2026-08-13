"""File storage abstraction: local disk (dev) or S3-compatible (R2 prod)."""

from __future__ import annotations

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


class StorageBackend(ABC):
    @abstractmethod
    async def store(self, *, data: bytes, filename: str, mime: str, tenant_id: str) -> StoredFile:
        raise NotImplementedError

    @abstractmethod
    async def delete(self, storage_key: str) -> None:
        raise NotImplementedError


class LocalStorageBackend(StorageBackend):
    def __init__(self, root: Path, public_base: str) -> None:
        self.root = root
        self.public_base = public_base.rstrip("/")
        self.root.mkdir(parents=True, exist_ok=True)

    async def store(self, *, data: bytes, filename: str, mime: str, tenant_id: str) -> StoredFile:
        file_id = str(uuid.uuid4())
        safe_name = Path(filename).name or "file"
        rel = Path(tenant_id) / f"{file_id}_{safe_name}"
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        url = f"{self.public_base}/api/uploads/files/{rel.as_posix()}"
        return StoredFile(
            id=file_id,
            name=safe_name,
            mime=mime or "application/octet-stream",
            size=len(data),
            url=url,
            storage_key=rel.as_posix(),
        )

    async def delete(self, storage_key: str) -> None:
        path = self.root / storage_key
        if path.exists():
            path.unlink()


class S3StorageBackend(StorageBackend):
    def __init__(
        self,
        *,
        bucket: str,
        region: str,
        access_key: str,
        secret_key: str,
        endpoint_url: str,
        public_base: str,
    ) -> None:
        self.bucket = bucket
        self.region = region
        self.access_key = access_key
        self.secret_key = secret_key
        self.endpoint_url = endpoint_url.rstrip("/")
        self.public_base = public_base.rstrip("/")

    async def store(self, *, data: bytes, filename: str, mime: str, tenant_id: str) -> StoredFile:
        import boto3
        from botocore.config import Config

        file_id = str(uuid.uuid4())
        safe_name = Path(filename).name or "file"
        key = f"{tenant_id}/{file_id}_{safe_name}"
        client = boto3.client(
            "s3",
            region_name=self.region,
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
            endpoint_url=self.endpoint_url,
            config=Config(signature_version="s3v4"),
        )
        client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType=mime or "application/octet-stream",
        )
        url = f"{self.public_base}/{key}"
        return StoredFile(
            id=file_id,
            name=safe_name,
            mime=mime or "application/octet-stream",
            size=len(data),
            url=url,
            storage_key=key,
        )

    async def delete(self, storage_key: str) -> None:
        import boto3
        from botocore.config import Config

        client = boto3.client(
            "s3",
            region_name=self.region,
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
            endpoint_url=self.endpoint_url,
            config=Config(signature_version="s3v4"),
        )
        client.delete_object(Bucket=self.bucket, Key=storage_key)


def get_storage_backend() -> StorageBackend:
    if settings.storage_backend == "s3" and settings.storage_s3_bucket:
        return S3StorageBackend(
            bucket=settings.storage_s3_bucket,
            region=settings.storage_s3_region,
            access_key=settings.storage_s3_access_key,
            secret_key=settings.storage_s3_secret_key,
            endpoint_url=settings.storage_s3_endpoint,
            public_base=settings.storage_public_base or settings.public_api_url.rstrip("/") + "/uploads",
        )
    root = Path(settings.storage_local_path)
    public_base = settings.public_api_url.rstrip("/")
    return LocalStorageBackend(root, public_base)


def guess_mime(filename: str, content_type: str | None) -> str:
    if content_type:
        return content_type.split(";")[0].strip()
    guessed, _ = mimetypes.guess_type(filename)
    return guessed or "application/octet-stream"


def _local_file_for_url(url: str) -> Path | None:
    """Map a local-backend uploads URL to its on-disk path (uploads serving
    requires auth, so server-side consumers read the file directly)."""
    marker = "/api/uploads/files/"
    if marker not in url:
        return None
    rel = url.split(marker, 1)[1]
    parts = [p for p in rel.split("/") if p and p not in (".", "..")]
    if len(parts) != 2:
        return None
    root = Path(settings.storage_local_path).resolve()
    path = (root / parts[0] / parts[1]).resolve()
    if not str(path).startswith(str(root)):
        return None
    return path


async def fetch_attachment_bytes(url: str) -> bytes | None:
    local = _local_file_for_url(url)
    if local is not None:
        try:
            return local.read_bytes() if local.is_file() else None
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
