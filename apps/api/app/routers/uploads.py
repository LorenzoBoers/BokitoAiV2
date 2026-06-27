"""Upload endpoints for message attachments."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.config import get_settings
from app.dependencies import AuthContext, get_current_auth
from app.services.storage import get_storage_backend, guess_mime

router = APIRouter(prefix="/uploads", tags=["uploads"])
settings = get_settings()
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


@router.post("")
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


@router.get("/files/{tenant_id}/{filename}")
async def serve_local_file(tenant_id: UUID, filename: str):
    if settings.storage_backend != "local":
        raise HTTPException(status_code=404, detail="Not found")
    root = Path(settings.storage_local_path)
    path = root / str(tenant_id) / filename
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path)
