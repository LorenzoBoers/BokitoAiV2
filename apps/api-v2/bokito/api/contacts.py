"""Contacts and organizations."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Query
from sqlalchemy import select

from bokito.api.schemas import ContactOut, ConversationOut, OrganizationOut, ToolOutcomeOut
from bokito.deps import DbSession, Operator
from bokito.domain.conversation import Conversation
from bokito.domain.orient import Organization
from bokito.services import contacts as contact_svc
from bokito.tools import execute_tool
from bokito.tools.builtin.contacts import UpsertContactArgs, UpsertOrganizationArgs

router = APIRouter(tags=["contacts"])


@router.get("/contacts", response_model=list[ContactOut], summary="Search contacts")
async def list_contacts(
    session: DbSession,
    principal: Operator,
    q: str | None = None,
    limit: int = Query(default=50, le=200),
    offset: int = 0,
) -> list[ContactOut]:
    rows = await contact_svc.search(session, principal.tenant_id, q, limit=limit, offset=offset)
    return [ContactOut.model_validate(c) for c in rows]


@router.post(
    "/contacts", response_model=ToolOutcomeOut, summary="Create or update (tool: upsert_contact)"
)
async def upsert_contact(
    body: UpsertContactArgs, session: DbSession, principal: Operator
) -> ToolOutcomeOut:
    outcome = await execute_tool(session, principal, "upsert_contact", body.model_dump(mode="json"))
    await session.commit()
    return ToolOutcomeOut(**outcome.to_dict())


@router.get("/contacts/{contact_id}", response_model=ContactOut, summary="Contact detail")
async def get_contact(contact_id: uuid.UUID, session: DbSession, principal: Operator) -> ContactOut:
    return ContactOut.model_validate(
        await contact_svc.get(session, principal.tenant_id, contact_id)
    )


@router.get(
    "/contacts/{contact_id}/conversations",
    response_model=list[ConversationOut],
    summary="Conversations of a contact",
)
async def contact_conversations(
    contact_id: uuid.UUID, session: DbSession, principal: Operator
) -> list[ConversationOut]:
    await contact_svc.get(session, principal.tenant_id, contact_id)
    rows = (
        await session.scalars(
            select(Conversation)
            .where(
                Conversation.tenant_id == principal.tenant_id, Conversation.contact_id == contact_id
            )
            .order_by(Conversation.last_activity_at.desc())
            .limit(50)
        )
    ).all()
    return [ConversationOut.model_validate(c) for c in rows]


@router.delete(
    "/contacts/{contact_id}", response_model=ToolOutcomeOut, summary="Delete (tool: delete_contact)"
)
async def delete_contact(
    contact_id: uuid.UUID, session: DbSession, principal: Operator
) -> ToolOutcomeOut:
    outcome = await execute_tool(
        session, principal, "delete_contact", {"contact_id": str(contact_id)}
    )
    await session.commit()
    return ToolOutcomeOut(**outcome.to_dict())


@router.get("/organizations", response_model=list[OrganizationOut], summary="Organizations")
async def list_organizations(
    session: DbSession, principal: Operator, q: str | None = None
) -> list[OrganizationOut]:
    stmt = select(Organization).where(Organization.tenant_id == principal.tenant_id)
    if q:
        stmt = stmt.where(Organization.name.ilike(f"%{q}%"))
    rows = (await session.scalars(stmt.order_by(Organization.name).limit(200))).all()
    return [OrganizationOut.model_validate(o) for o in rows]


@router.post(
    "/organizations",
    response_model=ToolOutcomeOut,
    summary="Create or update (tool: upsert_organization)",
)
async def upsert_organization(
    body: UpsertOrganizationArgs, session: DbSession, principal: Operator
) -> ToolOutcomeOut:
    outcome = await execute_tool(
        session, principal, "upsert_organization", body.model_dump(mode="json")
    )
    await session.commit()
    return ToolOutcomeOut(**outcome.to_dict())


@router.get(
    "/organizations/{organization_id}",
    response_model=OrganizationOut,
    summary="Organization detail",
)
async def get_organization(
    organization_id: uuid.UUID, session: DbSession, principal: Operator
) -> OrganizationOut:
    return OrganizationOut.model_validate(
        await contact_svc.get_organization(session, principal.tenant_id, organization_id)
    )


@router.get(
    "/organizations/{organization_id}/contacts",
    response_model=list[ContactOut],
    summary="Contacts of an organization",
)
async def organization_contacts(
    organization_id: uuid.UUID, session: DbSession, principal: Operator
) -> list[Any]:
    await contact_svc.get_organization(session, principal.tenant_id, organization_id)
    from bokito.domain.orient import Contact

    rows = (
        await session.scalars(
            select(Contact)
            .where(
                Contact.tenant_id == principal.tenant_id, Contact.organization_id == organization_id
            )
            .order_by(Contact.name)
        )
    ).all()
    return [ContactOut.model_validate(c) for c in rows]
