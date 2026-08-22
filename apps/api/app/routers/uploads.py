"""Upload endpoints for message attachments."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.middleware.rate_limit import rate_limit
from app.models.auth import Membership
from app.services.auth import decode_access_token, verify_refresh_token
from app.services.livechat_compat import decode_widget_session_token
from app.services.storage import get_storage_backend, guess_mime

router = APIRouter(prefix="/uploads", tags=["uploads"])
settings = get_settings()
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


@router.post("", dependencies=[Depends(rate_limit("uploads", limit=30))])
async def upload_file(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    file: UploadFile = File(...),
):
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 10MB)")
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    mime = guess_mime(file.filename or "file", file.content_type)
    backend = get_storage_backend()
    stored = await backend.store(
        data=data,
        filename=file.filename or "file",
        mime=mime,
        tenant_id=str(auth.tenant.id),
    )
    return stored.to_attachment()


async def _authorize_file_access(
    request: Request, session: AsyncSession, tenant_id: UUID
) -> None:
    """Allow file access for a member (or staff) of `tenant_id`.

    Accepts a Bearer/query access token, or the httponly refresh cookie —
    the browser loads attachment URLs as plain <img>/<a> subresources that
    carry cookies but no Authorization header.
    """
    auth_header = request.headers.get("Authorization", "")
    token = (
        auth_header.removeprefix("Bearer ").strip()
        if auth_header.startswith("Bearer ")
        else (
            request.query_params.get("access_token", "").strip()
            or request.query_params.get("session_token", "").strip()
        )
    )
    if token:
        payload = None
        try:
            payload = decode_access_token(token)
        except JWTError:
            try:
                payload = decode_widget_session_token(token)
            except Exception as exc:
                raise HTTPException(status_code=401, detail="Invalid token") from exc
        if bool(payload.get("staff")) or str(payload.get("tenant_id", "")) == str(tenant_id):
            return
        raise HTTPException(status_code=403, detail="Forbidden")

    raw_cookie = request.cookies.get(settings.refresh_cookie_name, "")
    if raw_cookie:
        user = await verify_refresh_token(session, raw_cookie)
        if user:
            if user.is_staff:
                return
            membership = await session.execute(
                select(Membership).where(
                    Membership.user_id == user.id, Membership.tenant_id == tenant_id
                )
            )
            if membership.scalar_one_or_none():
                return
            raise HTTPException(status_code=403, detail="Forbidden")
    raise HTTPException(status_code=401, detail="Authentication required")


@router.get("/files/{tenant_id}/{filename}")
async def serve_file(
    tenant_id: UUID,
    filename: str,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    await _authorize_file_access(request, session, tenant_id)
    safe_name = Path(filename).name
    fetched = await get_storage_backend().fetch(f"{tenant_id}/{safe_name}")
    if fetched is None:
        raise HTTPException(status_code=404, detail="Not found")
    return Response(
        content=fetched.data,
        media_type=fetched.mime or guess_mime(safe_name, None),
        headers={"Cache-Control": "private, max-age=3600"},
    )
