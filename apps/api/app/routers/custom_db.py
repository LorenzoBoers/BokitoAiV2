"""Custom database router (dashboard APP_API_BASE contract).

Staff-gated: not a tenant product surface.
"""

import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services import custom_db as svc


def _require_staff(auth: Annotated[AuthContext, Depends(get_current_auth)]) -> AuthContext:
    if not auth.is_staff:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Staff only")
    return auth


router = APIRouter(
    tags=["custom-db"],
    dependencies=[Depends(_require_staff)],
)


class TableCreate(BaseModel):
    name: str
    description: str = ""
    icon: str = "Database"
    color: str = "#3b82f6"


class TablePatch(BaseModel):
    name: str | None = None
    description: str | None = None
    icon: str | None = None
    color: str | None = None


class FieldCreate(BaseModel):
    name: str
    field_type: str
    config: dict[str, Any] | None = None
    required: bool = False
    default_value: Any = None


class FieldPatch(BaseModel):
    name: str | None = None
    config: dict[str, Any] | None = None
    required: bool | None = None
    position: int | None = None
    default_value: Any = None


class RecordBody(BaseModel):
    data: dict[str, Any]


class ViewCreate(BaseModel):
    name: str
    view_type: str = "grid"
    config: dict[str, Any] | None = None


class ViewPatch(BaseModel):
    name: str | None = None
    config: dict[str, Any] | None = None


class BulkIdsBody(BaseModel):
    record_ids: list[int]


class BulkUpdateBody(BaseModel):
    record_ids: list[int]
    data: dict[str, Any]


class CommentCreate(BaseModel):
    content: str
    parent_id: int | None = None
    mentions: list[int] | None = None


class CommentPatch(BaseModel):
    content: str


class ActivityNoteBody(BaseModel):
    action: str = "note"
    note: str


# --- Tables ---


@router.get("/custom-tables")
async def list_tables(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.list_tables(session, auth.tenant.id)


@router.post("/custom-tables")
async def create_table(
    body: TableCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.create_table(
        session,
        auth.tenant.id,
        name=body.name,
        description=body.description,
        icon=body.icon,
        color=body.color,
    )


@router.patch("/custom-tables/{table_id}")
async def patch_table(
    table_id: int,
    body: TablePatch,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.update_table(session, auth.tenant.id, table_id, body.model_dump(exclude_unset=True))


@router.delete("/custom-tables/{table_id}")
async def delete_table(
    table_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.delete_table(session, auth.tenant.id, table_id)


# --- Fields ---


@router.get("/custom-tables/{table_id}/fields")
async def list_fields(
    table_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.list_fields(session, auth.tenant.id, table_id)


@router.post("/custom-tables/{table_id}/fields")
async def create_field(
    table_id: int,
    body: FieldCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.create_field(session, auth.tenant.id, table_id, body.model_dump())


@router.patch("/custom-fields/{field_id}")
async def patch_field(
    field_id: int,
    body: FieldPatch,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.update_field(session, auth.tenant.id, field_id, body.model_dump(exclude_unset=True))


@router.delete("/custom-fields/{field_id}")
async def delete_field(
    field_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.delete_field(session, auth.tenant.id, field_id)


# --- Records ---


@router.get("/custom-tables/{table_id}/records")
async def list_records(
    table_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=500),
    include_deleted: bool = Query(default=False),
):
    return await svc.list_records(
        session,
        auth.tenant.id,
        table_id,
        page=page,
        per_page=per_page,
        include_deleted=include_deleted,
    )


@router.get("/custom-tables/{table_id}/search")
async def search_records(
    table_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    q: str = Query(default=""),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=500),
):
    return await svc.search_records(session, auth.tenant.id, table_id, q, page=page, per_page=per_page)


@router.post("/custom-tables/{table_id}/records")
async def create_record(
    table_id: int,
    body: RecordBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    user_name = auth.user.display_name or auth.user.email
    return await svc.create_record(
        session,
        auth.tenant.id,
        table_id,
        body.data,
        user_name=user_name,
    )


@router.get("/custom-records/{record_id}")
async def get_record(
    record_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    row = await svc.get_record(session, auth.tenant.id, record_id)
    return svc.serialize_record(row)


@router.patch("/custom-records/{record_id}")
async def patch_record(
    record_id: int,
    body: RecordBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    user_name = auth.user.display_name or auth.user.email
    return await svc.update_record(
        session,
        auth.tenant.id,
        record_id,
        body.data,
        user_name=user_name,
    )


@router.delete("/custom-records/{record_id}")
async def delete_record(
    record_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.delete_record(session, auth.tenant.id, record_id)


@router.patch("/custom-records/{record_id}/soft-delete")
async def soft_delete_record(
    record_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.soft_delete_record(session, auth.tenant.id, record_id)


@router.patch("/custom-records/{record_id}/restore")
async def restore_record(
    record_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.restore_record(session, auth.tenant.id, record_id)


@router.post("/custom-records/{record_id}/duplicate")
async def duplicate_record(
    record_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.duplicate_record(session, auth.tenant.id, record_id)


@router.patch("/custom-records/bulk")
async def bulk_update(
    body: BulkUpdateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.bulk_update(session, auth.tenant.id, body.record_ids, body.data)


@router.patch("/custom-records/bulk-soft-delete")
async def bulk_soft_delete(
    body: BulkIdsBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.bulk_soft_delete(session, auth.tenant.id, body.record_ids)


@router.patch("/custom-records/bulk-restore")
async def bulk_restore(
    body: BulkIdsBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.bulk_restore(session, auth.tenant.id, body.record_ids)


# --- Views ---


@router.get("/custom-tables/{table_id}/views")
async def list_views(
    table_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.list_views(session, auth.tenant.id, table_id)


@router.post("/custom-tables/{table_id}/views")
async def create_view(
    table_id: int,
    body: ViewCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.create_view(session, auth.tenant.id, table_id, body.model_dump())


@router.patch("/custom-views/{view_id}")
async def patch_view(
    view_id: int,
    body: ViewPatch,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.update_view(session, auth.tenant.id, view_id, body.model_dump(exclude_unset=True))


@router.delete("/custom-views/{view_id}")
async def delete_view(
    view_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.delete_view(session, auth.tenant.id, view_id)


# --- Activity & comments ---


@router.get("/custom-records/{record_id}/activity")
async def get_activity(
    record_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.list_activity(session, auth.tenant.id, record_id)


@router.post("/custom-records/{record_id}/activity")
async def post_activity_note(
    record_id: int,
    body: ActivityNoteBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    user_name = auth.user.display_name or auth.user.email
    return await svc.add_activity_note(
        session,
        auth.tenant.id,
        record_id,
        body.note,
        user_name=user_name,
    )


@router.get("/custom-records/{record_id}/comments")
async def get_comments(
    record_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.list_comments(session, auth.tenant.id, record_id)


@router.post("/custom-records/{record_id}/comments")
async def post_comment(
    record_id: int,
    body: CommentCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    user_name = auth.user.display_name or auth.user.email
    return await svc.create_comment(
        session,
        auth.tenant.id,
        record_id,
        content=body.content,
        parent_id=body.parent_id,
        user_name=user_name,
    )


@router.patch("/record-comments/{comment_id}")
async def patch_comment(
    comment_id: int,
    body: CommentPatch,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.update_comment(session, auth.tenant.id, comment_id, body.content)


@router.delete("/record-comments/{comment_id}")
async def delete_comment(
    comment_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.delete_comment(session, auth.tenant.id, comment_id)


# --- Standard tables ---


@router.get("/standard-tables")
async def list_standard_tables(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.list_standard_tables(session, auth.tenant.id)


@router.post("/standard-tables/create")
async def create_standard_tables(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.create_standard_tables(session, auth.tenant.id)


# --- Import / export ---


@router.post("/custom-tables/{table_id}/import/csv")
async def import_csv(
    table_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    file: UploadFile = File(...),
    mapping: str = Form(...),
):
    mapping_dict = json.loads(mapping)
    return await svc.import_csv(session, auth.tenant.id, table_id, file, mapping_dict)


@router.get("/custom-tables/{table_id}/export")
async def export_table(
    table_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    format: str = Query(default="csv", alias="format"),
    fields: str | None = Query(default=None),
):
    field_list = [f.strip() for f in fields.split(",")] if fields else None
    body, media_type, filename = await svc.export_table(
        session,
        auth.tenant.id,
        table_id,
        format,
        field_list,
    )
    return Response(
        content=body,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --- Workspace users ---


@router.get("/workspace-users")
async def workspace_users(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.list_workspace_users(session, auth.tenant.id)
