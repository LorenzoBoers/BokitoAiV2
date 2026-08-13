"""Inbound email sync for connected Gmail / Outlook mailboxes.

Polls the provider API for recent inbox messages using the OAuth access token
stored on the `ChannelAccount`, normalizes each into the shared `InboundMessage`
shape and runs it through `ingest_inbound` (which dedupes on provider message id,
threads by conversation id, and enqueues agent processing for approved contacts).

Incremental sync:
- Gmail: `ChannelAccount.sync_cursor` stores `historyId`; uses users.history.list
  when present, falling back to a full inbox list when the cursor is empty or stale.
- Outlook: `sync_cursor` stores a Graph inbox deltaLink; falls back to a full
  inbox fetch when empty or invalid.

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
GMAIL_PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile"
GMAIL_HISTORY_URL = "https://gmail.googleapis.com/gmail/v1/users/me/history"
GMAIL_ATTACHMENT_URL = (
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/{mid}/attachments/{aid}"
)
GRAPH_FOLDER_URL = "https://graph.microsoft.com/v1.0/me/mailFolders/{folder}/messages"
GRAPH_FOLDER_DELTA_URL = (
    "https://graph.microsoft.com/v1.0/me/mailFolders/{folder}/messages/delta"
)
GRAPH_ATTACHMENTS_URL = "https://graph.microsoft.com/v1.0/me/messages/{id}/attachments"

MAX_FETCH = 25
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

# Standard folder set offered in "Select folders to sync". Each selected
# folder is polled with its own cursor (settings_json["sync_cursors"]).
DEFAULT_SYNC_FOLDERS: list[dict[str, Any]] = [
    {"id": "inbox", "display_name": "Inbox", "is_selected": True},
    {"id": "sent", "display_name": "Sent items", "is_selected": False},
    {"id": "archive", "display_name": "Archive", "is_selected": False},
    {"id": "junk", "display_name": "Spam", "is_selected": False},
]

# Generic folder id -> Graph well-known folder name.
GRAPH_FOLDER_NAMES = {
    "inbox": "inbox",
    "sent": "sentitems",
    "archive": "archive",
    "junk": "junkemail",
}

# Generic folder id -> Gmail label id. Gmail has no "archive" label
# (archived mail simply lacks INBOX), so that folder is skipped for Gmail.
GMAIL_LABEL_IDS = {
    "inbox": "INBOX",
    "sent": "SENT",
    "junk": "SPAM",
}


def account_sync_folders(settings: dict[str, Any]) -> list[dict[str, Any]]:
    """Folder selection for a mailbox: stored choice or the default set."""
    stored = settings.get("sync_folders")
    if isinstance(stored, list) and stored:
        return [dict(f) for f in stored if isinstance(f, dict) and f.get("id")]
    return [dict(f) for f in DEFAULT_SYNC_FOLDERS]


async def _record_sync_error(session: AsyncSession, account: ChannelAccount, message: str) -> None:
    try:
        settings = json.loads(account.settings_json or "{}")
        if not isinstance(settings, dict):
            settings = {}
    except json.JSONDecodeError:
        settings = {}
    settings["last_error"] = message
    account.settings_json = json.dumps(settings)
    session.add(account)
    await session.commit()


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
        # RFC 5322 Message-ID — required for In-Reply-To/References on replies
        # (the provider id above is API-internal and useless for threading).
        "rfc_message_id": headers.get("message-id", ""),
        "references": headers.get("references", ""),
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


def _parse_graph_message(msg: dict[str, Any]) -> dict[str, Any] | None:
    """Normalize a Graph message; skip removals / incomplete delta rows."""
    if msg.get("@removed") or not msg.get("id"):
        return None
    if not msg.get("from") and not msg.get("subject") and not msg.get("body"):
        # Delta sometimes returns id-only stubs; skip until a full fetch.
        return None
    sender = (msg.get("from") or {}).get("emailAddress") or {}
    body = msg.get("body") or {}
    content_type = (body.get("contentType") or "text").lower()
    body_content = body.get("content") or msg.get("bodyPreview", "")
    body_html = body_content if content_type == "html" else ""
    body_text = msg.get("bodyPreview", "") if content_type == "html" else body_content
    return {
        "from_address": sender.get("address", ""),
        "from_name": sender.get("name", ""),
        "subject": msg.get("subject", ""),
        "body_text": body_text or "",
        "body_html": body_html or "",
        "attachments": [],
        "has_attachments": bool(msg.get("hasAttachments")),
        "message_id": msg.get("id", ""),
        "thread_id": msg.get("conversationId", ""),
        "rfc_message_id": msg.get("internetMessageId", ""),
    }


async def _gmail_get_message(client: httpx.AsyncClient, token: str, mid: str) -> dict[str, Any]:
    detail = await client.get(
        GMAIL_MSG_URL.format(id=mid),
        params={"format": "full"},
        headers={"Authorization": f"Bearer {token}"},
    )
    detail.raise_for_status()
    return _parse_gmail_message(detail.json())


async def _fetch_gmail_full(token: str, label_id: str) -> tuple[list[dict[str, Any]], str]:
    """Full folder list + current historyId as the new cursor."""
    out: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=20.0) as client:
        listing = await client.get(
            GMAIL_LIST_URL,
            params={"maxResults": str(MAX_FETCH), "labelIds": label_id},
            headers={"Authorization": f"Bearer {token}"},
        )
        listing.raise_for_status()
        for ref in listing.json().get("messages", []) or []:
            mid = ref.get("id")
            if not mid:
                continue
            out.append(await _gmail_get_message(client, token, mid))
        profile = await client.get(
            GMAIL_PROFILE_URL,
            headers={"Authorization": f"Bearer {token}"},
        )
        profile.raise_for_status()
        history_id = str(profile.json().get("historyId") or "")
    return out, history_id


async def _fetch_gmail_history(
    token: str, start_history_id: str, label_id: str
) -> tuple[list[dict[str, Any]], str] | None:
    """Incremental Gmail sync via history.list. Returns None to force full fallback."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    newest_history = start_history_id
    async with httpx.AsyncClient(timeout=20.0) as client:
        page_token: str | None = None
        while True:
            params: dict[str, str] = {
                "startHistoryId": start_history_id,
                "historyTypes": "messageAdded",
                "labelId": label_id,
            }
            if page_token:
                params["pageToken"] = page_token
            resp = await client.get(
                GMAIL_HISTORY_URL,
                params=params,
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code == 404:
                # historyId too old — caller should full-fetch.
                return None
            resp.raise_for_status()
            data = resp.json()
            newest_history = str(data.get("historyId") or newest_history)
            for entry in data.get("history", []) or []:
                for added in entry.get("messagesAdded", []) or []:
                    mid = (added.get("message") or {}).get("id")
                    if not mid or mid in seen:
                        continue
                    seen.add(mid)
                    try:
                        out.append(await _gmail_get_message(client, token, mid))
                    except httpx.HTTPStatusError:
                        continue
            page_token = data.get("nextPageToken")
            if not page_token:
                break
    return out, newest_history


async def _fetch_gmail(
    token: str, sync_cursor: str, label_id: str
) -> tuple[list[dict[str, Any]], str]:
    if sync_cursor:
        incremental = await _fetch_gmail_history(token, sync_cursor, label_id)
        if incremental is not None:
            return incremental
    return await _fetch_gmail_full(token, label_id)


async def _fetch_graph_page(
    client: httpx.AsyncClient, url: str, token: str, params: dict[str, str] | None = None
) -> tuple[list[dict[str, Any]], str | None, str | None]:
    resp = await client.get(
        url,
        params=params,
        headers={"Authorization": f"Bearer {token}"},
    )
    resp.raise_for_status()
    data = resp.json()
    messages: list[dict[str, Any]] = []
    for msg in data.get("value", []) or []:
        parsed = _parse_graph_message(msg)
        if parsed:
            messages.append(parsed)
    return messages, data.get("@odata.nextLink"), data.get("@odata.deltaLink")


async def _fetch_graph_full(token: str, folder: str) -> tuple[list[dict[str, Any]], str]:
    out: list[dict[str, Any]] = []
    delta_link = ""
    async with httpx.AsyncClient(timeout=20.0) as client:
        # Prefer delta so we obtain a deltaLink for subsequent ticks.
        try:
            url: str | None = GRAPH_FOLDER_DELTA_URL.format(folder=folder)
            params: dict[str, str] | None = {
                "$top": str(MAX_FETCH),
                "$select": "id,subject,from,bodyPreview,body,conversationId,hasAttachments,internetMessageId",
            }
            while url:
                page, next_link, delta = await _fetch_graph_page(client, url, token, params)
                out.extend(page)
                if delta:
                    delta_link = delta
                url = next_link
                params = None  # nextLink is a full URL
                if len(out) >= MAX_FETCH and not next_link:
                    break
            if delta_link:
                return out[:MAX_FETCH], delta_link
        except httpx.HTTPStatusError:
            logger.debug("Graph delta unavailable; falling back to folder list")

        resp = await client.get(
            GRAPH_FOLDER_URL.format(folder=folder),
            params={
                "$top": str(MAX_FETCH),
                "$orderby": "receivedDateTime desc",
                "$select": "id,subject,from,bodyPreview,body,conversationId,hasAttachments,internetMessageId",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        for msg in resp.json().get("value", []) or []:
            parsed = _parse_graph_message(msg)
            if parsed:
                out.append(parsed)
    return out, delta_link


async def _fetch_graph(
    token: str, sync_cursor: str, folder: str
) -> tuple[list[dict[str, Any]], str]:
    if sync_cursor.startswith("http"):
        out: list[dict[str, Any]] = []
        delta_link = sync_cursor
        async with httpx.AsyncClient(timeout=20.0) as client:
            url: str | None = sync_cursor
            while url:
                try:
                    page, next_link, delta = await _fetch_graph_page(client, url, token)
                except httpx.HTTPStatusError as exc:
                    if exc.response.status_code in (410, 404):
                        # Delta token expired — full fallback.
                        return await _fetch_graph_full(token, folder)
                    raise
                out.extend(page)
                if delta:
                    delta_link = delta
                url = next_link
        return out, delta_link
    return await _fetch_graph_full(token, folder)


async def _fetch_messages(
    account: ChannelAccount, token: str, folder_id: str, cursor: str
) -> tuple[list[dict[str, Any]], str] | None:
    """Fetch one folder. Returns None when the folder has no provider mapping."""
    if account.provider == "gmail":
        label = GMAIL_LABEL_IDS.get(folder_id)
        if not label:
            return None
        return await _fetch_gmail(token, cursor, label)
    if account.provider == "outlook":
        folder = GRAPH_FOLDER_NAMES.get(folder_id)
        if not folder:
            return None
        return await _fetch_graph(token, cursor, folder)
    return None


async def _store_attachment(
    tenant_id: UUID, *, filename: str, mime: str, data: bytes
) -> dict[str, Any] | None:
    """Persist downloaded attachment bytes; returns the attachment dict."""
    from app.services.storage import get_storage_backend

    try:
        backend = get_storage_backend()
        stored = await backend.store(
            data=data,
            filename=filename or "file",
            mime=mime or "application/octet-stream",
            tenant_id=str(tenant_id),
        )
        return stored.to_attachment()
    except Exception:
        logger.exception("failed to store inbound attachment %s", filename)
        return None


async def _hydrate_outlook_attachments(
    client: httpx.AsyncClient, token: str, tenant_id: UUID, item: dict[str, Any]
) -> None:
    if not item.get("has_attachments") or not item.get("message_id"):
        return
    resp = await client.get(
        GRAPH_ATTACHMENTS_URL.format(id=item["message_id"]),
        headers={"Authorization": f"Bearer {token}"},
    )
    if resp.status_code != 200:
        logger.warning(
            "Graph attachments fetch failed (%s) for message %s",
            resp.status_code,
            item.get("message_id"),
        )
        return
    stored_list: list[dict[str, Any]] = []
    for att in resp.json().get("value", []) or []:
        if att.get("@odata.type") != "#microsoft.graph.fileAttachment":
            continue
        content = att.get("contentBytes") or ""
        if not content:
            continue
        try:
            data = base64.b64decode(content)
        except Exception:
            continue
        if not data or len(data) > MAX_ATTACHMENT_BYTES:
            continue
        stored = await _store_attachment(
            tenant_id,
            filename=str(att.get("name") or "file"),
            mime=str(att.get("contentType") or "application/octet-stream"),
            data=data,
        )
        if stored:
            stored_list.append(stored)
    item["attachments"] = stored_list


async def _hydrate_gmail_attachments(
    client: httpx.AsyncClient, token: str, tenant_id: UUID, item: dict[str, Any]
) -> None:
    raw_attachments = item.get("attachments") or []
    if not raw_attachments or not item.get("message_id"):
        return
    hydrated: list[dict[str, Any]] = []
    for att in raw_attachments:
        aid = att.get("attachment_id")
        if not aid:
            continue
        if int(att.get("size") or 0) > MAX_ATTACHMENT_BYTES:
            continue
        resp = await client.get(
            GMAIL_ATTACHMENT_URL.format(mid=item["message_id"], aid=aid),
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code != 200:
            continue
        try:
            data = base64.urlsafe_b64decode((resp.json().get("data") or "") + "===")
        except Exception:
            continue
        if not data:
            continue
        stored = await _store_attachment(
            tenant_id,
            filename=str(att.get("filename") or "file"),
            mime=str(att.get("mime") or "application/octet-stream"),
            data=data,
        )
        if stored:
            hydrated.append(stored)
    item["attachments"] = hydrated


async def _hydrate_attachments(
    account: ChannelAccount, token: str, items: list[dict[str, Any]]
) -> None:
    """Download attachment bytes for freshly fetched messages and replace the
    provider metadata with served attachment dicts ({name, mime, size, url})."""
    if not items:
        return
    async with httpx.AsyncClient(timeout=30.0) as client:
        for item in items:
            try:
                if account.provider == "outlook":
                    await _hydrate_outlook_attachments(client, token, account.tenant_id, item)
                elif account.provider == "gmail":
                    await _hydrate_gmail_attachments(client, token, account.tenant_id, item)
            except Exception:
                logger.exception(
                    "attachment hydration failed for message %s", item.get("message_id")
                )


async def _already_ingested(
    session: AsyncSession, tenant_id: UUID, external_id: str
) -> bool:
    from app.models.signal import SignalMessage

    result = await session.execute(
        select(SignalMessage.id)
        .where(
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.external_id == external_id,
        )
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


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


def _folder_cursor(
    settings: dict[str, Any], account: ChannelAccount, folder_id: str
) -> str:
    """Per-folder cursor; the legacy account-level cursor seeds the inbox."""
    cursors = settings.get("sync_cursors")
    if isinstance(cursors, dict) and folder_id in cursors:
        return str(cursors.get(folder_id) or "")
    if folder_id == "inbox":
        return (account.sync_cursor or "").strip()
    return ""


async def _ingest_items(
    session: AsyncSession,
    account: ChannelAccount,
    items: list[dict[str, Any]],
    folder_id: str,
) -> int:
    ingested = 0
    for item in items:
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
                "rfc_message_id": item.get("rfc_message_id", ""),
                "references": item.get("references", ""),
                "folder": folder_id,
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
    return ingested


async def sync_account(session: AsyncSession, account: ChannelAccount) -> dict[str, Any]:
    """Poll each selected folder of one mailbox and ingest new messages."""
    if account.provider not in ("gmail", "outlook") or not account.is_enabled:
        return {"account_id": str(account.id), "synced": 0, "status": "skipped"}
    creds = _credentials(account)
    token = creds.get("access_token")
    if not token:
        return {"account_id": str(account.id), "synced": 0, "status": "no_credentials"}
    if creds.get("mock"):
        # Dev mailbox connected via the mock OAuth flow: nothing to poll.
        return {"account_id": str(account.id), "synced": 0, "status": "mock_skipped"}

    settings = json.loads(account.settings_json or "{}")
    if not isinstance(settings, dict):
        settings = {}
    folders = [f["id"] for f in account_sync_folders(settings) if f.get("is_selected")]
    cursors: dict[str, str] = (
        dict(settings.get("sync_cursors"))
        if isinstance(settings.get("sync_cursors"), dict)
        else {}
    )

    ingested = 0
    fetched = 0
    for folder_id in folders:
        cursor = _folder_cursor(settings, account, folder_id)
        try:
            fetch = await _fetch_messages(account, token, folder_id, cursor)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 401:
                token = await _refresh_if_possible(session, account)
                if not token:
                    await _record_sync_error(
                        session, account, "Authentication expired. Reconnect this mailbox."
                    )
                    return {"account_id": str(account.id), "synced": 0, "status": "auth_expired"}
                try:
                    fetch = await _fetch_messages(account, token, folder_id, cursor)
                except Exception as retry_exc:  # noqa: BLE001 — surfaced in sync status
                    logger.exception("mailbox sync retry failed for account=%s", account.id)
                    await _record_sync_error(session, account, f"Sync failed: {retry_exc}")
                    return {"account_id": str(account.id), "synced": 0, "status": "error"}
            else:
                logger.exception("mailbox sync failed for account=%s", account.id)
                await _record_sync_error(
                    session, account, f"Provider error ({exc.response.status_code})."
                )
                return {"account_id": str(account.id), "synced": 0, "status": "error"}
        except Exception as exc:  # noqa: BLE001 — surfaced in sync status
            logger.exception("mailbox sync failed for account=%s", account.id)
            await _record_sync_error(session, account, f"Sync failed: {exc}")
            return {"account_id": str(account.id), "synced": 0, "status": "error"}

        if fetch is None:
            # Folder not supported by this provider (e.g. Gmail archive).
            continue
        messages, new_cursor = fetch
        fetched += len(messages)

        # Skip messages already ingested (dedupe happens in ingest_inbound too,
        # but checking here avoids re-downloading attachments on full re-fetches).
        new_items: list[dict[str, Any]] = []
        for item in messages:
            external_id = item.get("message_id", "")
            if external_id and await _already_ingested(session, account.tenant_id, external_id):
                continue
            new_items.append(item)
        await _hydrate_attachments(account, token, new_items)
        ingested += await _ingest_items(session, account, new_items, folder_id)
        if new_cursor:
            cursors[folder_id] = new_cursor

    settings = json.loads(account.settings_json or "{}")
    if not isinstance(settings, dict):
        settings = {}
    settings["last_sync_at"] = datetime.utcnow().isoformat()
    settings["messages_synced"] = int(settings.get("messages_synced") or 0) + ingested
    settings["sync_cursors"] = cursors
    settings.pop("last_error", None)
    account.settings_json = json.dumps(settings)
    if cursors.get("inbox"):
        # Keep the legacy account-level cursor in step for older readers.
        account.sync_cursor = cursors["inbox"]
    session.add(account)
    await session.commit()
    return {
        "account_id": str(account.id),
        "synced": ingested,
        "fetched": fetched,
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
