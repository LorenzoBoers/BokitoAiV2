"""Resend inbound email webhook for the built-in per-tenant address.

Resend posts Svix-signed `email.received` events with metadata only; the body
and attachments are fetched from the Received Emails API and routed through the
canonical `ingest_inbound` pipeline (contact pairing, threading, agent runs).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re
import time
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.channels.base import BlockedContactError, InboundMessage, ingest_inbound
from app.config import get_settings
from app.db.session import get_session
from app.services.bokito_mailbox import find_bokito_account_by_address
from app.workers.tasks import enqueue_signal_processing

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/inbound", tags=["inbound"])

RESEND_RECEIVED_URL = "https://api.resend.com/emails/receiving/{email_id}"
RESEND_ATTACHMENTS_URL = "https://api.resend.com/emails/receiving/{email_id}/attachments"
MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024

# Svix signatures are valid for a short window; reject stale replays.
TIMESTAMP_TOLERANCE_SECONDS = 5 * 60


def verify_svix_signature(
    secret: str, msg_id: str, timestamp: str, signature_header: str, body: bytes
) -> bool:
    """Verify a Svix webhook signature (`whsec_` base64 secret)."""
    try:
        ts = int(timestamp)
    except (TypeError, ValueError):
        return False
    if abs(time.time() - ts) > TIMESTAMP_TOLERANCE_SECONDS:
        return False
    raw_secret = secret.removeprefix("whsec_")
    try:
        key = base64.b64decode(raw_secret)
    except Exception:
        return False
    signed = f"{msg_id}.{timestamp}.".encode() + body
    expected = base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest()).decode()
    # Header may contain multiple space-separated "v1,<sig>" entries.
    for part in (signature_header or "").split(" "):
        version, _, sig = part.partition(",")
        if version == "v1" and hmac.compare_digest(sig, expected):
            return True
    return False


def _extract_thread_ids(headers: dict[str, str]) -> tuple[str, str, str]:
    """(rfc_message_id, references, thread_root) from RFC 5322 headers."""
    lowered = {k.lower(): v for k, v in headers.items()}
    rfc_id = (lowered.get("message-id") or "").strip()
    references = (lowered.get("references") or "").strip()
    in_reply_to = (lowered.get("in-reply-to") or "").strip()
    # The first Message-ID in References is the thread root; a reply without
    # References still threads via In-Reply-To. New mail roots its own thread.
    ids = re.findall(r"<[^>]+>", references or in_reply_to)
    thread_root = ids[0] if ids else rfc_id
    return rfc_id, references, thread_root


def _normalize_headers(raw: Any) -> dict[str, str]:
    """Resend returns headers either as a dict or a list of {name, value}."""
    if isinstance(raw, dict):
        return {str(k): str(v) for k, v in raw.items()}
    headers: dict[str, str] = {}
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict) and item.get("name"):
                headers[str(item["name"])] = str(item.get("value") or "")
    return headers


def _parse_from(raw: str) -> tuple[str, str]:
    """Split `Name <addr>` into (address, name)."""
    match = re.match(r"^\s*(?:\"?([^\"<]*)\"?\s*)?<([^>]+)>\s*$", raw or "")
    if match:
        return match.group(2).strip().lower(), (match.group(1) or "").strip()
    return (raw or "").strip().lower(), ""


async def _fetch_received_email(email_id: str, api_key: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(
            RESEND_RECEIVED_URL.format(email_id=email_id),
            headers={"Authorization": f"Bearer {api_key}"},
        )
        res.raise_for_status()
        data = res.json()
        return data.get("data") if isinstance(data.get("data"), dict) else data


async def _fetch_attachments(email_id: str, api_key: str, tenant_id) -> list[dict[str, Any]]:
    """Download and persist inbound attachments; failures never block ingest."""
    stored: list[dict[str, Any]] = []
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            res = await client.get(
                RESEND_ATTACHMENTS_URL.format(email_id=email_id),
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if res.status_code != 200:
                return []
            body = res.json()
            items = body.get("data") if isinstance(body.get("data"), list) else []
            for att in items:
                if not isinstance(att, dict):
                    continue
                url = str(att.get("download_url") or att.get("url") or "")
                if not url:
                    continue
                download = await client.get(url)
                if download.status_code != 200 or len(download.content) > MAX_ATTACHMENT_BYTES:
                    continue
                from app.services.storage import get_storage_backend

                backend = get_storage_backend()
                saved = await backend.store(
                    data=download.content,
                    filename=str(att.get("filename") or "file"),
                    mime=str(att.get("content_type") or "application/octet-stream"),
                    tenant_id=str(tenant_id),
                )
                stored.append(saved.to_attachment())
    except Exception:
        logger.exception("failed to fetch inbound attachments for %s", email_id)
    return stored


@router.post("/resend")
async def resend_inbound(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    svix_id: Annotated[str | None, Header(alias="svix-id")] = None,
    svix_timestamp: Annotated[str | None, Header(alias="svix-timestamp")] = None,
    svix_signature: Annotated[str | None, Header(alias="svix-signature")] = None,
):
    settings = get_settings()
    if not settings.resend_webhook_secret:
        raise HTTPException(status_code=404, detail="Inbound email is not configured")
    body = await request.body()
    if not verify_svix_signature(
        settings.resend_webhook_secret,
        svix_id or "",
        svix_timestamp or "",
        svix_signature or "",
        body,
    ):
        raise HTTPException(status_code=403, detail="Invalid signature")

    try:
        event = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    if event.get("type") != "email.received":
        return {"ok": True, "ignored": event.get("type")}

    data = event.get("data") or {}
    email_id = str(data.get("email_id") or "")
    recipients = [str(addr) for addr in (data.get("to") or [])]
    recipients += [str(addr) for addr in (data.get("received_for") or [])]
    recipients += [str(addr) for addr in (data.get("cc") or [])]

    account = None
    for addr in recipients:
        account = await find_bokito_account_by_address(session, addr)
        if account:
            break
    if not account:
        # Catch-all domain: mail to unknown/rotated addresses is dropped.
        logger.info("inbound mail for unknown recipient(s): %s", recipients[:5])
        return {"ok": True, "dropped": "unknown_recipient"}

    if not email_id or not settings.resend_api_key:
        return {"ok": False, "reason": "missing email_id or api key"}
    try:
        full = await _fetch_received_email(email_id, settings.resend_api_key)
    except httpx.HTTPError:
        # Non-2xx makes Resend retry the webhook later.
        raise HTTPException(status_code=502, detail="Failed to fetch email content")

    headers = _normalize_headers(full.get("headers"))
    rfc_id, references, thread_root = _extract_thread_ids(headers)
    body_html = str(full.get("html") or "")
    body_text = str(full.get("text") or "")
    if not body_text and body_html:
        from app.services.email_sync import html_to_text

        body_text = html_to_text(body_html)
    sender_address, sender_name = _parse_from(
        str(headers.get("From") or headers.get("from") or data.get("from") or "")
    )
    if not sender_address:
        return {"ok": True, "dropped": "no_sender"}

    attachments = await _fetch_attachments(email_id, settings.resend_api_key, account.tenant_id)

    metadata: dict[str, Any] = {"auto_headers": headers}
    if body_html:
        metadata["body_html"] = body_html
    if attachments:
        metadata["attachments"] = attachments
    if rfc_id:
        metadata["rfc_message_id"] = rfc_id
    if references:
        metadata["references"] = references

    inbound = InboundMessage(
        channel="email",
        source="bokito",
        sender_address=sender_address,
        sender_name=sender_name,
        subject=str(data.get("subject") or full.get("subject") or ""),
        body_text=body_text,
        external_id=email_id,
        thread_external_id=thread_root,
        channel_account_id=account.id,
        metadata=metadata,
    )
    try:
        signal, should_process = await ingest_inbound(session, account.tenant_id, inbound)
    except BlockedContactError:
        return {"ok": True, "dropped": "blocked_contact"}
    if should_process:
        await enqueue_signal_processing(str(account.tenant_id), str(signal.id))
    return {"ok": True, "signal_id": str(signal.id), "processing": should_process}
