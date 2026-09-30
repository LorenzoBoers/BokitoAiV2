"""Email through Resend: inbound webhook and outbound delivery.

Inbound: Resend posts `email.received` (Svix-signed). The body is fetched from
`GET /emails/receiving/{id}` unless the webhook already carries `text`/`html`
(tests, forwarding setups). Threading uses `In-Reply-To`/`References`, else a
new thread per (connection, sender, normalized subject).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import re
import time
from typing import Any

import httpx
from fastapi import APIRouter, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bokito.channels import base
from bokito.channels.inbound import InboundMessage, ingest
from bokito.config import get_settings
from bokito.deps import DbSession
from bokito.domain.base import utcnow
from bokito.domain.connection import Connection, ConnectionKind
from bokito.domain.conversation import Channel, Conversation, Direction, Message
from bokito.domain.metering import UsageKind
from bokito.domain.orient import Contact
from bokito.errors import NotFound, Unauthorized
from bokito.services import usage as usage_svc

log = logging.getLogger(__name__)
router = APIRouter(prefix="/inbound", tags=["inbound"])

RESEND_API = "https://api.resend.com"
_RE_PREFIX = re.compile(r"^\s*((re|fw|fwd|aw|antw)\s*:\s*)+", re.IGNORECASE)


def normalize_subject(subject: str) -> str:
    return _RE_PREFIX.sub("", subject or "").strip().lower()[:200]


def parse_address(value: str) -> tuple[str, str]:
    """'Jane Doe <jane@x.nl>' -> ('Jane Doe', 'jane@x.nl')."""
    value = (value or "").strip()
    m = re.match(r"^\s*\"?([^\"<]*)\"?\s*<([^>]+)>\s*$", value)
    if m:
        return m.group(1).strip(), m.group(2).strip().lower()
    return "", value.lower()


def verify_svix(secret: str, headers: dict[str, str], body: bytes) -> bool:
    """Svix signature check used by Resend webhooks."""
    if not secret:
        return True
    msg_id = headers.get("svix-id", "")
    ts = headers.get("svix-timestamp", "")
    sigs = headers.get("svix-signature", "")
    if not (msg_id and ts and sigs):
        return False
    try:
        if abs(time.time() - int(ts)) > 300:
            return False
    except ValueError:
        return False
    key = secret.split("_", 1)[1] if secret.startswith("whsec_") else secret
    digest = hmac.new(
        base64.b64decode(key), f"{msg_id}.{ts}.".encode() + body, hashlib.sha256
    ).digest()
    expected = base64.b64encode(digest).decode()
    return any(hmac.compare_digest(expected, s.split(",", 1)[-1]) for s in sigs.split())


async def _fetch_received(email_id: str) -> dict[str, Any]:
    settings = get_settings()
    if not settings.resend_api_key:
        return {}
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(
            f"{RESEND_API}/emails/receiving/{email_id}",
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
        )
        if r.status_code >= 400:
            log.warning("resend receiving fetch failed %s: %s", r.status_code, r.text[:200])
            return {}
        return r.json()


async def _find_connection(session: AsyncSession, recipients: list[str]) -> Connection | None:
    lowered = [r.lower() for r in recipients if r]
    if not lowered:
        return None
    return await session.scalar(
        select(Connection).where(
            Connection.kind == ConnectionKind.email, Connection.address.in_(lowered)
        )
    )


async def _thread_id(
    session: AsyncSession,
    connection: Connection,
    headers: dict[str, Any],
    sender: str,
    subject: str,
) -> str:
    refs = " ".join(
        str(headers.get(k) or "")
        for k in ("in-reply-to", "references", "In-Reply-To", "References")
    )
    for ref in re.findall(r"<[^>]+>", refs):
        msg = await session.scalar(
            select(Message).where(
                Message.tenant_id == connection.tenant_id, Message.external_id == ref
            )
        )
        if msg:
            conv = await session.get(Conversation, msg.conversation_id)
            if conv and conv.external_id:
                return conv.external_id
    key = f"{connection.id}:{sender}:{normalize_subject(subject)}"
    return "email-" + hashlib.sha1(key.encode()).hexdigest()[:24]


def _text_from_html(html: str) -> str:
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.S | re.I)
    text = re.sub(r"<br\s*/?>|</p>|</div>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


@router.post("/resend", summary="Resend inbound email webhook", response_model=dict)
async def resend_webhook(request: Request, session: DbSession) -> dict[str, Any]:
    raw = await request.body()
    settings = get_settings()
    if not verify_svix(
        settings.inbound_secret, {k.lower(): v for k, v in request.headers.items()}, raw
    ):
        raise Unauthorized("invalid webhook signature", code="invalid_signature")
    payload = await request.json()
    if payload.get("type") not in (None, "email.received"):
        return {"ignored": payload.get("type")}
    data = payload.get("data") or payload
    email_id = str(data.get("email_id") or data.get("id") or "")
    recipients = list(data.get("to") or [])
    connection = await _find_connection(session, recipients)
    if connection is None:
        raise NotFound("no inbox for recipient", code="unknown_recipient")

    if not (data.get("text") or data.get("html")) and email_id:
        data = {**data, **await _fetch_received(email_id)}
    sender_name, sender_email = parse_address(str(data.get("from") or ""))
    subject = str(data.get("subject") or "")
    html = data.get("html")
    text = data.get("text") or (_text_from_html(html) if html else "")
    headers = data.get("headers") or {}
    if isinstance(headers, list):
        headers = {h.get("name", ""): h.get("value", "") for h in headers if isinstance(h, dict)}
    message_id = str(
        headers.get("message-id")
        or headers.get("Message-ID")
        or (f"<{email_id}@resend>" if email_id else "")
    )
    thread_id = await _thread_id(session, connection, headers, sender_email, subject)

    conv, msg, dup = await ingest(
        session,
        connection,
        InboundMessage(
            channel=Channel.email,
            external_thread_id=thread_id,
            external_message_id=message_id or None,
            body=text,
            subject=subject,
            html=html,
            sender_name=sender_name,
            sender_email=sender_email,
            attachments=[
                {"name": a.get("filename"), "type": a.get("content_type"), "size": a.get("size")}
                for a in (data.get("attachments") or [])
                if isinstance(a, dict)
            ],
            meta={"email_id": email_id, "cc": data.get("cc") or []},
        ),
    )
    return {"conversation_id": str(conv.id), "message_id": str(msg.id), "duplicate": dup}


async def deliver_email(
    session: AsyncSession, connection: Connection | None, conv: Conversation, msg: Message
) -> dict[str, Any]:
    settings = get_settings()
    contact = await session.get(Contact, conv.contact_id) if conv.contact_id else None
    to = contact.email if contact and contact.email else None
    if not to:
        raise RuntimeError("conversation has no recipient email")
    sender = connection.address if connection and connection.address else settings.mail_from
    if connection and connection.settings.get("from_name"):
        sender = f"{connection.settings['from_name']} <{connection.address}>"
    last_inbound = await session.scalar(
        select(Message)
        .where(
            Message.conversation_id == conv.id,
            Message.direction == Direction.inbound,
            Message.external_id.is_not(None),
        )
        .order_by(Message.created_at.desc())
        .limit(1)
    )
    headers: dict[str, str] = {}
    if last_inbound and last_inbound.external_id:
        headers["In-Reply-To"] = last_inbound.external_id
        headers["References"] = last_inbound.external_id
    subject = conv.subject or "Your message"
    if not subject.lower().startswith("re:"):
        subject = f"Re: {subject}"

    body_html = (
        msg.html or "<p>" + msg.body.replace("\n\n", "</p><p>").replace("\n", "<br>") + "</p>"
    )
    if not settings.resend_api_key or settings.llm_mode == "mock":
        external = f"<{msg.id}@mock.bokito>"
        return {"external_id": external, "transport": "mock"}
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            f"{RESEND_API}/emails",
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={
                "from": sender,
                "to": [to],
                "subject": subject,
                "text": msg.body,
                "html": body_html,
                "headers": headers,
            },
        )
        r.raise_for_status()
        data = r.json()
    await usage_svc.record(
        session,
        conv.tenant_id,
        kind=UsageKind.channel_message,
        provider="resend",
        conversation_id=conv.id,
        run_id=msg.run_id,
        connection_id=connection.id if connection else None,
        units=1,
        cost_eur=0.0,
        meta={"direction": "outbound", "at": utcnow().isoformat()},
    )
    return {"external_id": f"<{data.get('id')}@resend>", "transport": "resend"}


base.register(Channel.email, deliver_email)
