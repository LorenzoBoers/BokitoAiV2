"""Canvas nodes: snapshot workspaces on a conversation."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services import canvas_sheet, project_canvas as canvas_svc

router = APIRouter(prefix="/workforce/canvases", tags=["canvases"])


class CanvasCreateBody(BaseModel):
    title: str
    signal_id: UUID | None = None
    new_thread: bool = False
    folder_id: UUID | None = None
    slug: str | None = None
    managing_agent_id: UUID | None = None
    refresh_minutes: int | None = None
    refresh_cadence: str | None = None
    refresh_cron: str | None = None
    notes: str | None = None


class CanvasMetaBody(BaseModel):
    title: str | None = None
    slug: str | None = None
    managing_agent_id: UUID | None = None
    refresh_minutes: int | None = None
    refresh_cadence: str | None = None
    refresh_cron: str | None = None
    notes: str | None = None


@router.get("")
async def list_canvases(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    folder_id: UUID | None = Query(None),
    signal_id: UUID | None = Query(None),
    # Legacy aliases while the dashboard switches.
    owner_kind: str | None = Query(None),
    owner_id: UUID | None = Query(None),
):
    del owner_kind
    if signal_id:
        return {
            "items": await canvas_svc.list_canvases_for_signal(
                session, auth.tenant.id, signal_id
            )
        }
    folder = folder_id or owner_id
    if folder is None:
        raise HTTPException(status_code=400, detail="folder_id or signal_id required")
    return {
        "items": await canvas_svc.list_canvases_for_folder(
            session, auth.tenant.id, folder
        )
    }


@router.post("")
async def create_canvas(
    body: CanvasCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    return await canvas_svc.create_canvas(
        session,
        auth.tenant.id,
        signal_id=body.signal_id,
        new_thread=body.new_thread or body.signal_id is None,
        folder_id=body.folder_id,
        title=body.title,
        slug=body.slug,
        managing_agent_id=body.managing_agent_id,
        refresh_minutes=body.refresh_minutes,
        refresh_cadence=body.refresh_cadence,
        refresh_cron=body.refresh_cron,
        notes=body.notes,
        updated_by_type="user",
        updated_by_id=str(auth.user.id),
    )


class CanvasLocation(BaseModel):
    folder_id: str | None
    canvas_id: str | None
    href: str


@router.get("/default-location", response_model=CanvasLocation)
async def canvas_default_location(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    canvas_id: UUID | None = Query(None),
):
    """Where a canvas link without a folder lands.

    The canvas named by ``canvas_id`` when it is alive, else the canvas touched
    last, else the folder General.
    """
    return await canvas_svc.default_location(session, auth.tenant.id, canvas_id)


@router.get("/{canvas_id}/export")
async def export_canvas_sheet(
    canvas_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    fmt: Annotated[str, Query(alias="format", pattern="^(csv|xlsx)$")],
):
    row = await _sheet_row(session, auth.tenant.id, canvas_id)
    title = str(row.get("title") or "sheet")
    source = str(row.get("source") or "")
    if fmt == "csv":
        body = sheet_csv_bytes(source)
        media = "text/csv; charset=utf-8"
        ext = "csv"
    else:
        body = canvas_sheet.sheet_xlsx(source)
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ext = "xlsx"
    name = canvas_sheet.export_filename(title, ext)
    return Response(
        content=body,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.post("/{canvas_id}/export/google")
async def export_canvas_google_sheet(
    canvas_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    row = await _sheet_row(session, auth.tenant.id, canvas_id)
    return await canvas_sheet.publish_google_sheet(
        session,
        auth.tenant.id,
        title=str(row.get("title") or "Sheet"),
        source=str(row.get("source") or ""),
    )


def sheet_csv_bytes(source: str) -> bytes:
    return canvas_sheet.sheet_csv(source).encode("utf-8-sig")


async def _sheet_row(session: AsyncSession, tenant_id: UUID, canvas_id: UUID) -> dict:
    row = await canvas_svc.get_canvas(session, tenant_id, canvas_id=canvas_id)
    if (row.get("kind") or "") != "sheet":
        raise HTTPException(status_code=400, detail="Only a sheet canvas can be exported")
    return row


@router.get("/{canvas_id}")
async def get_canvas(
    canvas_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await canvas_svc.get_canvas(session, auth.tenant.id, canvas_id=canvas_id)


@router.patch("/{canvas_id}")
async def patch_canvas(
    canvas_id: UUID,
    body: CanvasMetaBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    return await canvas_svc.patch_canvas_meta(
        session,
        auth.tenant.id,
        canvas_id,
        title=body.title,
        slug=body.slug,
        managing_agent_id=body.managing_agent_id,
        refresh_minutes=body.refresh_minutes,
        refresh_cadence=body.refresh_cadence,
        refresh_cron=body.refresh_cron,
        notes=body.notes,
    )


@router.delete("/{canvas_id}")
async def delete_canvas(
    canvas_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    return await canvas_svc.delete_canvas(
        session, auth.tenant.id, canvas_id, user_id=auth.user.id if auth.user else None
    )
