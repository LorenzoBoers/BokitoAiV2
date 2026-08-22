"""Object-store backend keeps auth-gated API URLs and serves via fetch()."""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient

from app.services.storage import S3StorageBackend, storage_key_from_url


class _FakeBody:
    def __init__(self, data: bytes) -> None:
        self._data = data

    def read(self) -> bytes:
        return self._data


class _FakeS3:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.content_types: dict[str, str] = {}

    def put_object(self, **kwargs):
        self.objects[kwargs["Key"]] = kwargs["Body"]
        self.content_types[kwargs["Key"]] = kwargs.get("ContentType", "application/octet-stream")

    def get_object(self, **kwargs):
        key = kwargs["Key"]
        if key not in self.objects:
            from botocore.exceptions import ClientError

            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        return {"Body": _FakeBody(self.objects[key]), "ContentType": self.content_types[key]}

    def delete_object(self, **kwargs):
        self.objects.pop(kwargs["Key"], None)


@pytest.mark.asyncio
async def test_s3_store_url_stays_on_api_and_roundtrips():
    backend = S3StorageBackend(
        bucket="bokito-uploads",
        region="auto",
        access_key="id",
        secret_key="secret",
        endpoint_url="https://example.eu.r2.cloudflarestorage.com",
    )
    fake = _FakeS3()
    backend._client = fake
    tenant = str(uuid4())
    stored = await backend.store(
        data=b"hello-r2",
        filename="note.txt",
        mime="text/plain",
        tenant_id=tenant,
    )
    assert stored.url.endswith(f"/api/uploads/files/{tenant}/{stored.id}_note.txt")
    assert "r2.cloudflarestorage.com" not in stored.url
    key = storage_key_from_url(stored.url)
    assert key == f"{tenant}/{stored.id}_note.txt"
    fetched = await backend.fetch(key)
    assert fetched is not None
    assert fetched.data == b"hello-r2"
    assert fetched.mime == "text/plain"


@pytest.mark.asyncio
async def test_upload_serving_accepts_widget_session(client: AsyncClient):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    from app.services.livechat_compat import create_widget_session_token

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    me = await client.get("/api/auth/me", headers=headers)
    tenant_id = UUID(me.json()["tenant"]["id"])

    upload = await client.post(
        "/api/uploads",
        headers=headers,
        files={"file": ("shot.png", b"\x89PNG\r\n\x1a\n" + b"x" * 8, "image/png")},
    )
    assert upload.status_code == 200
    from urllib.parse import urlparse

    path = urlparse(upload.json()["url"]).path
    widget = create_widget_session_token(tenant_id=tenant_id)
    ok = await client.get(f"{path}?session_token={widget}")
    assert ok.status_code == 200
    assert ok.content.startswith(b"\x89PNG")

    other = create_widget_session_token(tenant_id=uuid4())
    forbidden = await client.get(f"{path}?session_token={other}")
    assert forbidden.status_code == 403
