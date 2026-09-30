"""Knowledge tools: search and write docs, remember about a contact."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, Field

from bokito.domain.orient import DocKind
from bokito.services import contacts as contact_svc
from bokito.services import knowledge as kb
from bokito.tools.registry import ToolContext, tool


class SearchArgs(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    kinds: list[DocKind] | None = None
    limit: int = Field(default=6, ge=1, le=20)


@tool("search_knowledge", description="Search the workspace knowledge base.", category="read")
async def search_knowledge(ctx: ToolContext, args: SearchArgs) -> dict:
    hits = await kb.search(
        ctx.session, ctx.tenant_id, args.query, kinds=args.kinds, limit=args.limit
    )
    return {"hits": [h.to_dict() for h in hits]}


class WriteDocArgs(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    body: str
    kind: DocKind = DocKind.doc
    path: str | None = None
    published: bool | None = None


@tool(
    "write_doc",
    description="Create or update a knowledge document, memory, persona, skill or snippet.",
    category="write",
)
async def write_doc(ctx: ToolContext, args: WriteDocArgs) -> dict:
    doc = await kb.upsert(
        ctx.session,
        ctx.tenant_id,
        title=args.title,
        body=args.body,
        kind=args.kind,
        path=args.path,
        published=args.published,
        ai_maintained=ctx.principal.trust == "agent",
    )
    return {"doc_id": str(doc.id), "path": doc.path}


class RememberArgs(BaseModel):
    contact_id: uuid.UUID
    fact: str = Field(min_length=1, max_length=1000)


@tool(
    "remember_about_contact",
    description="Append a durable fact to a contact's memory.",
    category="write",
)
async def remember_about_contact(ctx: ToolContext, args: RememberArgs) -> dict:
    contact = await contact_svc.get(ctx.session, ctx.tenant_id, args.contact_id)
    line = f"- {args.fact.strip()}"
    if line not in (contact.memory or ""):
        contact.memory = ((contact.memory or "").rstrip() + "\n" + line).strip()[:8000]
    await ctx.session.flush()
    return {"memory": contact.memory}
