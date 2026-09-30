"""Moneybird tools. Registered with `module="accounting"`: only callable once installed."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, Field

from bokito.config import get_settings
from bokito.domain.connection import ConnectionKind
from bokito.errors import Forbidden
from bokito.modules.accounting.moneybird import MoneybirdClient, MoneybirdError
from bokito.services import connections as conn_svc
from bokito.services import modules as modules_svc
from bokito.tools.registry import ToolContext, tool

MODULE = "accounting"


async def _client(ctx: ToolContext) -> MoneybirdClient:
    install = await modules_svc.get_install(ctx.session, ctx.tenant_id, MODULE)
    conn = None
    if install and install.connection_id:
        conn = await conn_svc.get(ctx.session, ctx.tenant_id, install.connection_id)
    if conn is None:
        conn = await conn_svc.first_active(
            ctx.session, ctx.tenant_id, ConnectionKind.integration, "moneybird"
        )
    if conn is None:
        raise MoneybirdError(
            "no Moneybird connection; add one under Connections and install the accounting module",
            code="moneybird_missing",
        )
    await conn_svc.touch(ctx.session, conn)
    return MoneybirdClient(conn_svc.credentials_of(conn))


class FindContactArgs(BaseModel):
    query: str = Field(min_length=2, max_length=200, description="Email, company or customer id.")


@tool(
    "moneybird_find_contact",
    description="Find the Moneybird contact for an email address, company name or customer id.",
    category="read",
    module=MODULE,
)
async def find_contact(ctx: ToolContext, args: FindContactArgs) -> dict:
    client = await _client(ctx)
    return {"contacts": await client.find_contacts(args.query)}


class ListInvoicesArgs(BaseModel):
    contact_id: str = Field(default="", description="Moneybird contact id.")
    state: str = Field(
        default="",
        description="Filter: draft, open, late, paid, scheduled, pending_payment; '|' for several.",
    )
    limit: int = Field(default=20, ge=1, le=100)


@tool(
    "moneybird_list_invoices",
    description="List sales invoices, optionally for one contact or state (open, late, paid).",
    category="read",
    module=MODULE,
)
async def list_invoices(ctx: ToolContext, args: ListInvoicesArgs) -> dict:
    client = await _client(ctx)
    return {
        "invoices": await client.list_invoices(
            contact_id=args.contact_id, state=args.state, limit=args.limit
        )
    }


class SendInvoiceArgs(BaseModel):
    invoice_id: str = Field(min_length=1, description="Moneybird invoice id or number.")
    email_address: str = Field(
        default="", description="Override recipient; default is the contact."
    )
    message: str = Field(default="", max_length=2000, description="Email body, e.g. a reminder.")
    conversation_id: uuid.UUID | None = None


@tool(
    "moneybird_send_invoice",
    description="Send or resend an invoice by email from Moneybird, for example as a reminder. "
    "Always asks an operator.",
    category="external",
    consequential=True,
    module=MODULE,
)
async def send_invoice(ctx: ToolContext, args: SendInvoiceArgs) -> dict:
    if MODULE not in get_settings().module_writes and get_settings().llm_mode == "live":
        raise Forbidden(
            "writes to the accounting ledger are disabled on this deployment "
            "(MODULE_WRITES_ENABLED)",
            code="module_writes_disabled",
        )
    client = await _client(ctx)
    invoice = await client.get_invoice(args.invoice_id)
    if invoice["state"] not in ("open", "late", "pending_payment"):
        raise MoneybirdError(
            f"invoice {invoice['number']} is {invoice['state']}; only open or late invoices "
            "are sent",
            code="moneybird_invoice_state",
        )
    return await client.send_invoice(
        invoice["id"], email_address=args.email_address, message=args.message
    )
