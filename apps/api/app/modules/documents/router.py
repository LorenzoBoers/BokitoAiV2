"""Documents module provider: Google Drive and Sheets on the workspace's connection."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import IntegrationConnection
from app.modules.accounting.schema import module_error, ok_result
from app.modules.documents.adapters import google_drive

PROVIDER = "google_drive"
RECONNECT = "Google Drive needs to be connected again under Connections."


async def _connection(session: AsyncSession, tenant_id: UUID, args: dict[str, Any]) -> IntegrationConnection | None:
    query = select(IntegrationConnection).where(
        IntegrationConnection.tenant_id == tenant_id,
        IntegrationConnection.provider == PROVIDER,
        IntegrationConnection.status == "active",
    )
    raw = str(args.get("connection_id") or "").strip()
    if raw:
        try:
            query = query.where(IntegrationConnection.id == UUID(raw))
        except ValueError:
            return None
    return (await session.execute(query.order_by(IntegrationConnection.created_at.asc()).limit(1))).scalar_one_or_none()


async def call_verb(
    session: AsyncSession,
    tenant_id: UUID,
    verb: str,
    args: dict[str, Any],
    *,
    agent_id: UUID | None = None,
    project_id: UUID | None = None,
) -> dict[str, Any]:
    del project_id
    args = dict(args or {})
    from app.modules.documents.workpapers import WORKPAPERS

    paper = WORKPAPERS.get(verb)
    if paper is not None:
        from app.modules.catalog import module_is_on

        if not await module_is_on(session, tenant_id, "documents"):
            return module_error(
                "module_off",
                "Documents is off. Turn it on at /connections/documents before agents use documents tools.",
            )
        if agent_id is not None:
            from app.services.module_agents import agent_has_module

            if not await agent_has_module(session, tenant_id, agent_id, "documents"):
                return module_error(
                    "agent_forbidden",
                    "This agent is not in the documents department. Ask its point of contact, or add the agent to that department.",
                )
        try:
            return paper(args)
        except ValueError as exc:
            return module_error("invalid_input", str(exc))

    del agent_id
    from app.services.calendar_sync import _access_token

    run = google_drive.VERBS.get(verb)
    if run is None:
        return module_error("unknown_verb", f"Documents has no verb '{verb}'.")
    conn = await _connection(session, tenant_id, args)
    if conn is None:
        return module_error("not_connected", "Connect Google Drive under Connections first.")
    token = await _access_token(session, conn)
    if not token:
        return module_error("needs_reconnect", RECONNECT)
    try:
        try:
            return ok_result(**await run(token, args))
        except google_drive.DriveAuthError:
            token = await _access_token(session, conn, force_refresh=True)
            if not token:
                return module_error("needs_reconnect", RECONNECT)
            return ok_result(**await run(token, args))
    except google_drive.DriveAuthError:
        return module_error("needs_reconnect", RECONNECT)
    except google_drive.DriveError as exc:
        return module_error("provider_error", str(exc))
