"""WhatsApp Business through the Meta Cloud API, with per-message cost metering.

Meta bills per conversation window: a reply inside the 24-hour customer
service window is free ("service"); a business-initiated message outside it is
a template message and is metered at the utility rate. Every outbound message
lands in `usage_events` as `channel_message` with the cost in EUR.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import timedelta
from typing import Any

import httpx
from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bokito.channels import base
from bokito.channels.inbound import InboundMessage, ingest
from bokito.config import get_settings
from bokito.deps import DbSession
from bokito.domain.base import utcnow
from bokito.domain.connection import Connection, ConnectionKind
from bokito.domain.conversation import Channel, Conversation, Message
from bokito.domain.metering import UsageKind
from bokito.domain.orient import Contact
from bokito.errors import Unauthorized
from bokito.services import connections as conn_svc
from bokito.services import usage as usage_svc

log = logging.getLogger(__name__)
router = APIRouter(prefix="/inbound", tags=["inbound"])

GRAPH = "https://graph.facebook.com/v21.0"
SERVICE_WINDOW = timedelta(hours=24)


def verify_meta_signature(app_secret: str, signature: str | None, body: bytes) -> bool:
    if not app_secret:
        return True
    if not signature or not signature.startswith("sha256="):
        return False
    expected = hmac.new(app_secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature.split("=", 1)[1])


@router.get("/whatsapp", summary="Meta webhook verification", response_class=PlainTextResponse)
async def verify_webhook(
    hub_mode: str = Query(default="", alias="hub.mode"),
    hub_verify_token: str = Query(default="", alias="hub.verify_token"),
    hub_challenge: str = Query(default="", alias="hub.challenge"),
) -> str:
    settings = get_settings()
    if (
        hub_mode == "subscribe"
        and settings.whatsapp_verify_token
        and hub_verify_token == settings.whatsapp_verify_token
    ):
        return hub_challenge
    raise Unauthorized("verification failed", code="verify_failed")


async def _connection_for(session: AsyncSession, phone_number_id: str) -> Connection | None:
    rows = (
        await session.scalars(select(Connection).where(Connection.kind == ConnectionKind.whatsapp))
    ).all()
    for conn in rows:
        creds = conn_svc.credentials_of(conn)
        if (
            str(creds.get("phone_number_id") or conn.settings.get("phone_number_id") or "")
            == phone_number_id
        ):
            return conn
    return None


def _text_of(message: dict[str, Any]) -> str:
    kind = message.get("type")
    if kind == "text":
        return str((message.get("text") or {}).get("body") or "")
    if kind in ("image", "document", "audio", "video", "sticker"):
        caption = str((message.get(kind) or {}).get("caption") or "")
        return caption or f"[{kind}]"
    if kind == "location":
        loc = message.get("location") or {}
        where = f"{loc.get('latitude')},{loc.get('longitude')} {loc.get('name') or ''}"
        return f"[location] {where}".strip()
    if kind == "interactive":
        inter = message.get("interactive") or {}
        reply = inter.get("button_reply") or inter.get("list_reply") or {}
        return str(reply.get("title") or "[interactive]")
    if kind == "button":
        return str((message.get("button") or {}).get("text") or "[button]")
    return f"[{kind}]"


@router.post("/whatsapp", summary="Meta Cloud API webhook", response_model=dict)
async def whatsapp_webhook(
    request: Request, session: DbSession, x_hub_signature_256: str | None = Header(default=None)
) -> dict[str, Any]:
    raw = await request.body()
    if not verify_meta_signature(get_settings().meta_app_secret, x_hub_signature_256, raw):
        raise Unauthorized("invalid signature", code="invalid_signature")
    payload = await request.json()
    handled = 0
    for entry in payload.get("entry") or []:
        for change in entry.get("changes") or []:
            value = change.get("value") or {}
            phone_number_id = str((value.get("metadata") or {}).get("phone_number_id") or "")
            connection = await _connection_for(session, phone_number_id)
            if connection is None:
                continue
            names = {
                c.get("wa_id"): (c.get("profile") or {}).get("name", "")
                for c in value.get("contacts") or []
            }
            for message in value.get("messages") or []:
                wa_id = str(message.get("from") or "")
                await ingest(
                    session,
                    connection,
                    InboundMessage(
                        channel=Channel.whatsapp,
                        external_thread_id=f"{phone_number_id}:{wa_id}",
                        external_message_id=str(message.get("id") or "") or None,
                        body=_text_of(message),
                        sender_name=str(names.get(wa_id) or ""),
                        sender_phone=f"+{wa_id}" if wa_id and not wa_id.startswith("+") else wa_id,
                        sender_handle=("whatsapp", wa_id),
                        meta={"type": message.get("type"), "timestamp": message.get("timestamp")},
                    ),
                )
                handled += 1
            for status in value.get("statuses") or []:
                await _apply_status(session, connection, status)
    await session.commit()
    return {"handled": handled}


async def _apply_status(
    session: AsyncSession, connection: Connection, status: dict[str, Any]
) -> None:
    from bokito.domain.conversation import SendStatus

    external = str(status.get("id") or "")
    if not external:
        return
    msg = await session.scalar(
        select(Message).where(
            Message.tenant_id == connection.tenant_id, Message.external_id == external
        )
    )
    if not msg:
        return
    state = str(status.get("status") or "")
    if state in ("delivered", "read"):
        msg.send_status = SendStatus.delivered
    elif state == "failed":
        msg.send_status = SendStatus.failed
        msg.send_error = str((status.get("errors") or [{}])[0].get("title") or "failed")[:500]
    pricing = status.get("pricing") or {}
    if pricing:
        msg.meta = {**(msg.meta or {}), "pricing": pricing}


def message_cost(conv: Conversation, now=None) -> tuple[str, float]:
    """Category and EUR cost for an outbound message right now."""
    now = now or utcnow()
    if conv.last_inbound_at and now - conv.last_inbound_at <= SERVICE_WINDOW:
        return "service", usage_svc.WHATSAPP_PRICES["service"]
    return "utility", usage_svc.WHATSAPP_PRICES["utility"]


async def deliver_whatsapp(
    session: AsyncSession, connection: Connection | None, conv: Conversation, msg: Message
) -> dict[str, Any]:
    if connection is None:
        raise RuntimeError("whatsapp conversation without connection")
    contact = await session.get(Contact, conv.contact_id) if conv.contact_id else None
    wa_id = (contact.handles or {}).get("whatsapp") if contact else None
    if not wa_id and conv.external_id and ":" in conv.external_id:
        wa_id = conv.external_id.split(":", 1)[1]
    if not wa_id:
        raise RuntimeError("no WhatsApp recipient")
    creds = conn_svc.credentials_of(connection)
    phone_number_id = str(
        creds.get("phone_number_id") or connection.settings.get("phone_number_id") or ""
    )
    token = str(creds.get("access_token") or "")
    category, cost = message_cost(conv)

    settings = get_settings()
    if not token or settings.llm_mode == "mock":
        external_id = f"wamid.mock.{msg.id.hex}"
    else:
        body: dict[str, Any]
        if category == "service":
            body = {
                "messaging_product": "whatsapp",
                "to": wa_id,
                "type": "text",
                "text": {"body": msg.body},
            }
        else:
            template = connection.settings.get("reopen_template") or "bokito_followup"
            body = {
                "messaging_product": "whatsapp",
                "to": wa_id,
                "type": "template",
                "template": {
                    "name": template,
                    "language": {"code": connection.settings.get("template_language") or "nl"},
                    "components": [
                        {"type": "body", "parameters": [{"type": "text", "text": msg.body[:1000]}]}
                    ],
                },
            }
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                f"{GRAPH}/{phone_number_id}/messages",
                headers={"Authorization": f"Bearer {token}"},
                json=body,
            )
            r.raise_for_status()
            data = r.json()
        external_id = str(((data.get("messages") or [{}])[0]).get("id") or "")

    await usage_svc.record(
        session,
        conv.tenant_id,
        kind=UsageKind.channel_message,
        provider="meta",
        model=category,
        conversation_id=conv.id,
        run_id=msg.run_id,
        connection_id=connection.id,
        units=1,
        cost_eur=cost,
        meta={"category": category, "direction": "outbound"},
    )
    return {"external_id": external_id, "category": category, "cost_eur": cost}


base.register(Channel.whatsapp, deliver_whatsapp)
