"""Inbound email sync for connected Gmail / Outlook mailboxes.

Polls the provider API for recent inbox messages using the OAuth access token
stored on the `ChannelAccount`, normalizes each into the shared `InboundMessage`
shape and runs it through `ingest_inbound` (which dedupes on provider message id,
threads by conversation id, and enqueues agent processing for approved contacts).

Token refresh is handled inline: a 401 triggers a refresh-token exchange and a
single retry. Accounts with no access token (mock/dev mailboxes) are skipped.
"""

from __future__ import annotations

import base64
import json
import logging
from datetime import datetime
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.channels.base import BlockedContactError, InboundMessage, ingest_inbound
from app.models.channel import ChannelAccount
from app.services import oauth_providers

logger = logging.getLogger(__name__)

GMAIL_LIST_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
GMAIL_MSG_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/{id}"
GRAPH_INBOX_URL = "https://graph.microsoft.com/v1.0/me/mailFolders/Inbox/messages"

MAX_FETCH = 25


def _credentials(account: ChannelAccount) -> dict[str, Any]:
    try:
        data = json.loads(account.credentials_json or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _parse_gmail_message(msg: dict[str, Any]) -> dict[str, Any]:
    payload = msg.get("payload", {})
    headers = {h.get("name", "").lower(): h.get("value", "") for h in payload.get("headers", [])}
    from_raw = headers.get("from", "")
    name, address = "", from_raw
    if "<" in from_raw and ">" in from_raw:
        name = from_raw.split("<")[0].strip().strip('"')
        address = from_raw.split("<")[1].split(">")[0].strip()
    body_text = _extract_gmail_body(payload) or msg.get("snippet", "")
    body_html = _extract_gmail_html(payload)
    attachments = _extract_gmail_attachments(payload)
    return {
        "from_address": address,
        "from_name": name,
        "subject": headers.get("subject", ""),
        "body_text": body_text,
        "body_html": body_html,
        "attachments": attachments,
        "message_id": msg.get("id", ""),
        "thread_id": msg.get("threadId", ""),
    }


def _extract_gmail_body(payload: dict[str, Any]) -> str:
    """Depth-first search for the first text/plain part; decode base64url."""
    mime = payload.get("mimeType", "")
    body = payload.get("body", {})
    data = body.get("data")
    if mime == "text/plain" and data:
        try:
            return base64.urlsafe_b64decode(data + "===").decode("utf-8", "replace")
        except Exception:
            return ""
    for part in payload.get("parts", []) or []:
        text = _extract_gmail_body(part)
        if text:
            return text
    return ""


def _extract_gmail_html(payload: dict[str, Any]) -> str:
    """Depth-first search for the first text/html part; decode base64url."""
    mime = payload.get("mimeType", "")
    body = payload.get("body", {})
    data = body.get("data")
    if mime == "text/html" and data:
        try:
            return base64.urlsafe_b64decode(data + "===").decode("utf-8", "replace")
        except Exception:
            return ""
    for part in payload.get("parts", []) or []:
        html = _extract_gmail_html(part)
        if html:
            return html
    return ""


def _extract_gmail_attachments(payload: dict[str, Any]) -> list[dict[str, Any]]:
    attachments: list[dict[str, Any]] = []

    def walk(part: dict[str, Any]) -> None:
        filename = part.get("filename") or ""
        if filename:
            body = part.get("body", {})
            attachments.append(
                {
                    "filename": filename,
                    "mime": part.get("mimeType", "application/octet-stream"),
                    "size": body.get("size", 0),
                    "attachment_id": body.get("attachmentId"),
                }
            )
        for child in part.get("parts", []) or []:
            walk(child)

    walk(payload)
    return attachments


async def _fetch_gmail(token: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=20.0) as client:
        listing = await client.get(
            GMAIL_LIST_URL,
            params={"maxResults": str(MAX_FETCH), "labelIds": "INBOX"},
            headers={"Authorization": f"Bearer {token}"},
        )
        listing.raise_for_status()
        for ref in listing.json().get("messages", []) or []:
            mid = ref.get("id")
            if not mid:
                continue
            detail = await client.get(
                GMAIL_MSG_URL.format(id=mid),
                params={"format": "full"},
                headers={"Authorization": f"Bearer {token}"},
            )
            detail.raise_for_status()
            out.append(_parse_gmail_message(detail.json()))
    return out


async def _fetch_graph(token: str) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(
            GRAPH_INBOX_URL,
            params={
                "$top": str(MAX_FETCH),
                "$orderby": "receivedDateTime desc",
                "$select": "id,subject,from,bodyPreview,body,conversationId,hasAttachments",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        out: list[dict[str, Any]] = []
        for msg in resp.json().get("value", []) or []:
            sender = (msg.get("from") or {}).get("emailAddress") or {}
            body = msg.get("body") or {}
            content_type = (body.get("contentType") or "text").lower()
            body_content = body.get("content") or msg.get("bodyPreview", "")
            body_html = body_content if content_type == "html" else ""
            body_text = msg.get("bodyPreview", "") if content_type == "html" else body_content
            attachments: list[dict[str, Any]] = []
            if msg.get("hasAttachments"):
                att_resp = await client.get(
                    f"{GRAPH_INBOX_URL}/{msg.get('id')}/attachments",
                    headers={"Authorization": f"Bearer {token}"},
                )
                if att_resp.status_code == 200:
                    for att in att_resp.json().get("value", []) or []:
                        attachments.append(
                            {
                                "filename": att.get("name", "attachment"),
                                "mime": att.get("contentType", "application/octet-stream"),
                                "size": att.get("size", 0),
                                "attachment_id": att.get("id"),
                            }
                        )
            out.append(
                {
                    "from_address": sender.get("address", ""),
                    "from_name": sender.get("name", ""),
                    "subject": msg.get("subject", ""),
                    "body_text": body_text,
                    "body_html": body_html,
                    "attachments": attachments,
                    "message_id": msg.get("id", ""),
                    "thread_id": msg.get("conversationId", ""),
                }
            )
        return out


async def _fetch_messages(account: ChannelAccount, token: str) -> list[dict[str, Any]]:
    if account.provider == "gmail":
        return await _fetch_gmail(token)
    if account.provider == "outlook":
        return await _fetch_graph(token)
    return []


async def _refresh_if_possible(session: AsyncSession, account: ChannelAccount) -> str | None:
    creds = _credentials(account)
    refresh_token = creds.get("refresh_token")
    if not refresh_token:
        return None
    provider = account.provider
    try:
        tokens = await oauth_providers.refresh_access_token(provider, refresh_token=refresh_token)
    except Exception:
        logger.exception("token refresh failed for account=%s", account.id)
        return None
    access = tokens.get("access_token")
    if not access:
        return None
    creds["access_token"] = access
    if tokens.get("refresh_token"):
        creds["refresh_token"] = tokens["refresh_token"]
    account.credentials_json = json.dumps(creds)
    session.add(account)
    await session.commit()
    return access


async def sync_account(session: AsyncSession, account: ChannelAccount) -> dict[str, Any]:
    """Poll one mailbox and ingest new messages. Returns a status summary."""
    if account.provider not in ("gmail", "outlook") or not account.is_enabled:
        return {"account_id": str(account.id), "synced": 0, "status": "skipped"}
    token = _credentials(account).get("access_token")
    if not token:
        return {"account_id": str(account.id), "synced": 0, "status": "no_credentials"}

    try:
        messages = await _fetch_messages(account, token)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 401:
            token = await _refresh_if_possible(session, account)
            if not token:
                return {"account_id": str(account.id), "synced": 0, "status": "auth_expired"}
            try:
                messages = await _fetch_messages(account, token)
            except Exception:
                logger.exception("mailbox sync retry failed for account=%s", account.id)
                return {"account_id": str(account.id), "synced": 0, "status": "error"}
        else:
            logger.exception("mailbox sync failed for account=%s", account.id)
            return {"account_id": str(account.id), "synced": 0, "status": "error"}
    except Exception:
        logger.exception("mailbox sync failed for account=%s", account.id)
        return {"account_id": str(account.id), "synced": 0, "status": "error"}

    ingested = 0
    for item in messages:
        inbound = InboundMessage(
            channel="email",
            source=account.provider,
            sender_address=item.get("from_address", ""),
            sender_name=item.get("from_name", ""),
            subject=item.get("subject", ""),
            body_text=item.get("body_text", ""),
            external_id=item.get("message_id", ""),
            thread_external_id=item.get("thread_id", ""),
            channel_account_id=account.id,
            metadata={
                "body_html": item.get("body_html", ""),
                "attachments": item.get("attachments") or [],
            },
        )
        try:
            _signal, should_process = await ingest_inbound(session, account.tenant_id, inbound)
        except BlockedContactError:
            continue
        if should_process:
            ingested += 1
            try:
                from app.workers.tasks import enqueue_signal_processing

                await enqueue_signal_processing(str(account.tenant_id), str(_signal.id))
            except Exception:
                logger.debug("enqueue_signal_processing unavailable; stored only")

    settings = json.loads(account.settings_json or "{}")
    settings["last_sync_at"] = datetime.utcnow().isoformat()
    account.settings_json = json.dumps(settings)
    session.add(account)
    await session.commit()
    return {
        "account_id": str(account.id),
        "synced": ingested,
        "fetched": len(messages),
        "status": "ok",
    }


async def sync_tenant(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    """Sync every connected Gmail/Outlook mailbox for a tenant."""
    result = await session.execute(
        select(ChannelAccount).where(
            ChannelAccount.tenant_id == tenant_id,
            ChannelAccount.channel == "email",
            ChannelAccount.is_enabled.is_(True),
            ChannelAccount.provider.in_(("gmail", "outlook")),
        )
    )
    accounts = result.scalars().all()
    return [await sync_account(session, account) for account in accounts]
