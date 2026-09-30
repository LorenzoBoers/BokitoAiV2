"""Contact tools."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, Field

from bokito.domain.orient import Organization
from bokito.errors import NotFound
from bokito.services import contacts as contact_svc
from bokito.tools.registry import ToolContext, tool


class UpsertContactArgs(BaseModel):
    contact_id: uuid.UUID | None = None
    email: str | None = None
    phone: str | None = None
    name: str = ""
    language: str = ""
    organization_id: uuid.UUID | None = None
    fields: dict = Field(default_factory=dict)
    memory: str | None = Field(default=None, description="Replace the contact memory note")


@tool("upsert_contact", description="Create or update a contact.", category="write")
async def upsert_contact(ctx: ToolContext, args: UpsertContactArgs) -> dict:
    if args.contact_id:
        contact = await contact_svc.get(ctx.session, ctx.tenant_id, args.contact_id)
        if args.name:
            contact.name = args.name[:300]
        if args.email:
            contact.email = contact_svc.normalize_email(args.email)
        if args.phone:
            contact.phone = contact_svc.normalize_phone(args.phone)
    else:
        contact = await contact_svc.resolve_or_create(
            ctx.session, ctx.tenant_id, email=args.email, phone=args.phone, name=args.name
        )
    if args.language:
        contact.language = args.language[:8]
    if args.organization_id:
        org = await ctx.session.get(Organization, args.organization_id)
        if not org or org.tenant_id != ctx.tenant_id:
            raise NotFound("organization not found", code="organization_not_found")
        contact.organization_id = org.id
    if args.fields:
        contact.fields = {**(contact.fields or {}), **args.fields}
    if args.memory is not None:
        contact.memory = args.memory[:8000]
    await ctx.session.flush()
    return {"contact_id": str(contact.id), "name": contact.name, "email": contact.email}


class DeleteContactArgs(BaseModel):
    contact_id: uuid.UUID


@tool(
    "delete_contact",
    description="Delete a contact and detach its conversations.",
    category="destructive",
    consequential=True,
)
async def delete_contact(ctx: ToolContext, args: DeleteContactArgs) -> dict:
    contact = await contact_svc.get(ctx.session, ctx.tenant_id, args.contact_id)
    await ctx.session.delete(contact)
    await ctx.session.flush()
    return {"deleted": True}


class UpsertOrganizationArgs(BaseModel):
    organization_id: uuid.UUID | None = None
    name: str = ""
    domain: str | None = None
    kind: str = "customer"
    fields: dict = Field(default_factory=dict)


@tool("upsert_organization", description="Create or update an organization.", category="write")
async def upsert_organization(ctx: ToolContext, args: UpsertOrganizationArgs) -> dict:
    if args.organization_id:
        org = await contact_svc.get_organization(ctx.session, ctx.tenant_id, args.organization_id)
    else:
        org = Organization(tenant_id=ctx.tenant_id, name=args.name[:300] or "Organization")
        ctx.session.add(org)
    if args.name:
        org.name = args.name[:300]
    if args.domain is not None:
        org.domain = args.domain.lower().strip() or None
    org.kind = args.kind
    if args.fields:
        org.fields = {**(org.fields or {}), **args.fields}
    await ctx.session.flush()
    return {"organization_id": str(org.id), "name": org.name}
