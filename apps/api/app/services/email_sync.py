"""Inbound email sync for connected Gmail / Outlook / SMTP-IMAP mailboxes.

Polls the provider API (or IMAP for smtp_imap) for recent inbox messages,
normalizes each into the shared `InboundMessage` shape and runs it through
`ingest_inbound` (which dedupes on provider message id, threads by conversation
id, and enqueues agent processing for approved contacts).

Incremental sync:
- Gmail: `ChannelAccount.sync_cursor` stores `historyId`; uses users.history.list
  when present, falling back to a full inbox list when the cursor is empty or stale.
- Outlook: `sync_cursor` stores a Graph inbox deltaLink; falls back to a full
  inbox fetch when empty or invalid.
- SMTP/IMAP: UID cursor under `settings_json.sync_cursors.inbox` (INBOX only).

Token refresh is handled inline for OAuth: a 401 triggers a refresh-token
exchange and a single retry. Accounts with no access token (mock/dev mailboxes)
are skipped; smtp_imap requires verified credentials instead.
"""

from __future__ import annotations

import base64
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
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
GRAPH_MESSAGE_URL = "https://graph.microsoft.com/v1.0/me/messages/{id}"
GRAPH_ATTACHMENTS_URL = "https://graph.microsoft.com/v1.0/me/messages/{id}/attachments"

MAX_FETCH = 25
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

# How far back the initial backfill reaches when a mailbox is first connected
# (or when a cursor is invalidated). Per-account override via
# settings_json["sync_window_days"]; 0 means no limit.
DEFAULT_SYNC_WINDOW_DAYS = 30

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


def account_sync_window_days(settings: dict[str, Any]) -> int:
    """Backfill window in days for a mailbox (0 = unlimited)."""
    try:
        value = int(settings.get("sync_window_days", DEFAULT_SYNC_WINDOW_DAYS))
    except (TypeError, ValueError):
        return DEFAULT_SYNC_WINDOW_DAYS
    return max(0, min(value, 3650))


# Grace window so mail arriving just before connect is still treated as live.
AI_LIVE_SINCE_GRACE = timedelta(minutes=5)


def account_ai_live_since(settings: dict[str, Any]) -> datetime | None:
    """UTC naive timestamp after which inbound mail may trigger AI processing."""
    raw = settings.get("ai_live_since")
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def ensure_ai_live_since(settings: dict[str, Any]) -> dict[str, Any]:
    """Set ai_live_since once when a mailbox first starts syncing."""
    if settings.get("ai_live_since"):
        return settings
    settings = dict(settings)
    settings["ai_live_since"] = datetime.utcnow().isoformat()
    return settings


def is_backfill_message(received_at: datetime | None, settings: dict[str, Any]) -> bool:
    """True when the message predates the mailbox AI live cutoff."""
    live_since = account_ai_live_since(settings)
    if live_since is None or received_at is None:
        return False
    return received_at < (live_since - AI_LIVE_SINCE_GRACE)


# Tags whose text content is not prose (CSS, JS, metadata). Email HTML often
# wraps CSS as `<style><!-- ... --></style>`; in CDATA mode that comment body
# reaches handle_data raw, so without skipping it leaks into previews.
_NON_CONTENT_TAGS = frozenset({"style", "script", "head", "title", "template"})


class _HtmlTextExtractor(HTMLParser):
    """Minimal HTML -> plain text for provider bodies."""

    def __init__(self) -> None:
        super().__init__()
        self._parts: list[str] = []
        self._skip_depth = 0

    def handle_data(self, data: str) -> None:
        if data and not self._skip_depth:
            self._parts.append(data)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _NON_CONTENT_TAGS:
            self._skip_depth += 1
            return
        if tag in ("br", "p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"):
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _NON_CONTENT_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if tag in ("p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"):
            self._parts.append("\n")

    def get_text(self) -> str:
        text = "".join(self._parts)
        text = re.sub(r"[ \t]+\n", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()


def html_to_text(html: str) -> str:
    """Strip HTML tags to plain text for agent ingestion."""
    raw = (html or "").strip()
    if not raw:
        return ""
    parser = _HtmlTextExtractor()
    try:
        parser.feed(raw)
        parser.close()
    except Exception:
        stripped = re.sub(r"(?is)<(style|script|head|title)[^>]*>.*?</\1>", " ", raw)
        stripped = re.sub(r"(?s)<!--.*?-->", " ", stripped)
        return re.sub(r"<[^>]+>", " ", stripped).strip()
    return parser.get_text()


def _parse_iso_utc(value: Any) -> datetime | None:
    """Provider ISO timestamp -> naive UTC datetime (our storage convention)."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


async def _record_sync_error(
    session: AsyncSession, account: ChannelAccount, message: str, *, kind: str = "error"
) -> None:
    try:
        settings = json.loads(account.settings_json or "{}")
        if not isinstance(settings, dict):
            settings = {}
    except json.JSONDecodeError:
        settings = {}
    settings["last_error"] = message
    error_count = int(settings.get("sync_error_count") or 0) + 1
    settings["sync_error_count"] = error_count

    # Alert tenant admins when the mailbox needs a human: immediately for
    # expired auth, after 3 consecutive failures otherwise. At most once per
    # 24h per account (tracked here; ops_alerts adds tenant-level dedupe).
    should_alert = kind == "auth_expired" or error_count >= 3
    last_alert_raw = settings.get("last_ops_alert_at")
    if should_alert and last_alert_raw:
        try:
            last_alert = datetime.fromisoformat(str(last_alert_raw))
            if datetime.utcnow() - last_alert < timedelta(hours=24):
                should_alert = False
        except ValueError:
            pass
    if should_alert:
        settings["last_ops_alert_at"] = datetime.utcnow().isoformat()

    account.settings_json = json.dumps(settings)
    session.add(account)
    await session.commit()

    if should_alert:
        from app.services.ops_alerts import alert_channel_disconnect

        await alert_channel_disconnect(
            session,
            account.tenant_id,
            channel_label=account.address or account.provider or "mailbox",
            reason=message,
            account_id=account.id,
        )


def _credentials(account: ChannelAccount) -> dict[str, Any]:
    from app.services.crypto import get_connection_credentials

    return get_connection_credentials(account)

# RFC headers that mark automated / bulk mail; captured at sync time so the
# inbound classifier can suppress reply suggestions for notification email.
_AUTO_HEADER_KEYS = (
    "auto-submitted",
    "precedence",
    "x-auto-response-suppress",
    "list-id",
    "list-unsubscribe",
    "return-path",
)


def _parse_gmail_message(msg: dict[str, Any]) -> dict[str, Any]:
    payload = msg.get("payload", {})
    headers = {h.get("name", "").lower(): h.get("value", "") for h in payload.get("headers", [])}
    from_raw = headers.get("from", "")
    name, address = "", from_raw
    if "<" in from_raw and ">" in from_raw:
        name = from_raw.split("<")[0].strip().strip('"')
        address = from_raw.split("<")[1].split(">")[0].strip()
    body_html = _extract_gmail_html(payload)
    # Fallback order matters: HTML-only mail (most support desks) has no
    # text/plain part, and Gmail's `snippet` is ~200 chars — agents reading a
    # snippet think the email was cut off mid-sentence. Convert the HTML body
    # to text before ever falling back to the snippet.
    body_text = (
        _extract_gmail_body(payload)
        or html_to_text(body_html)
        or msg.get("snippet", "")
    )
    attachments = _extract_gmail_attachments(payload)
    received_at: datetime | None = None
    try:
        # internalDate is epoch milliseconds (delivery time at Gmail).
        received_at = datetime.utcfromtimestamp(int(msg.get("internalDate") or 0) / 1000) or None
    except (TypeError, ValueError, OverflowError, OSError):
        received_at = None
    if received_at and received_at.year < 2000:
        received_at = None
    return {
        "received_at": received_at,
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
        # Who else was copied — shown in the timeline and used for reply-all.
        "cc": headers.get("cc", ""),
        "in_reply_to": headers.get("in-reply-to", ""),
        "references": headers.get("references", ""),
        "auto_headers": {k: headers[k] for k in _AUTO_HEADER_KEYS if headers.get(k)},
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


def _gmail_part_header(part: dict[str, Any], name: str) -> str:
    target = name.lower()
    for header in part.get("headers") or []:
        if str(header.get("name") or "").lower() == target:
            return str(header.get("value") or "").strip()
    return ""


def normalize_content_id(value: str) -> str:
    return (value or "").strip().strip("<>").strip()


def rewrite_cid_urls(html: str, cid_to_url: dict[str, str]) -> str:
    """Replace cid: references in email HTML with hosted attachment URLs."""
    if not html or not cid_to_url:
        return html
    lookup = {normalize_content_id(k): v for k, v in cid_to_url.items() if k and v}

    def repl(match: re.Match[str]) -> str:
        quote = match.group(1)
        key = normalize_content_id(match.group(2))
        url = lookup.get(key)
        if not url:
            return match.group(0)
        return f"src={quote}{url}{quote}"

    return re.sub(r"""src=(["'])cid:([^"']+)\1""", repl, html, flags=re.IGNORECASE)


def _extract_gmail_attachments(payload: dict[str, Any]) -> list[dict[str, Any]]:
    attachments: list[dict[str, Any]] = []

    def walk(part: dict[str, Any]) -> None:
        filename = part.get("filename") or ""
        body = part.get("body", {}) or {}
        attachment_id = body.get("attachmentId")
        content_id = normalize_content_id(_gmail_part_header(part, "content-id"))
        disposition = _gmail_part_header(part, "content-disposition").lower()
        mime = part.get("mimeType", "application/octet-stream")
        # Classic MIME inline images often have a Content-ID and empty filename.
        if attachment_id and (filename or content_id):
            if not filename:
                ext = "bin"
                if isinstance(mime, str) and "/" in mime:
                    ext = mime.split("/", 1)[1].split(";", 1)[0].strip() or "bin"
                filename = f"inline-{content_id[:24] or 'image'}.{ext}"
            attachments.append(
                {
                    "filename": filename,
                    "mime": mime,
                    "size": body.get("size", 0),
                    "attachment_id": attachment_id,
                    "content_id": content_id or None,
                    "inline": "inline" in disposition or bool(content_id and not disposition.startswith("attachment")),
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
    # Graph only returns internetMessageHeaders when explicitly selected /
    # fetched on a single message; tolerate absence for list/delta payloads.
    auto_headers: dict[str, str] = {}
    in_reply_to = ""
    references = ""
    for header in msg.get("internetMessageHeaders") or []:
        name = str(header.get("name", "")).lower()
        value = str(header.get("value") or "")
        if not value:
            continue
        if name in _AUTO_HEADER_KEYS:
            auto_headers[name] = value
        elif name == "in-reply-to":
            in_reply_to = value
        elif name == "references":
            references = value
    body = msg.get("body") or {}
    content_type = (body.get("contentType") or "text").lower()
    body_content = body.get("content") or ""
    preview = msg.get("bodyPreview", "") or ""
    body_html = body_content if content_type == "html" else ""
    if content_type == "html":
        body_text = html_to_text(body_content) or preview
    else:
        body_text = body_content or preview
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
        "in_reply_to": in_reply_to,
        "references": references,
        "received_at": _parse_iso_utc(msg.get("receivedDateTime")),
        "auto_headers": auto_headers,
        # Who else was copied — shown in the timeline and used for reply-all.
        "cc": ", ".join(
            addr
            for r in (msg.get("ccRecipients") or [])
            if (addr := ((r.get("emailAddress") or {}).get("address") or ""))
        ),
    }


async def _enrich_graph_rfc_headers(
    client: httpx.AsyncClient, token: str, parsed: dict[str, Any]
) -> dict[str, Any]:
    """List/delta omit internetMessageHeaders; fetch them for thread matching."""
    if parsed.get("in_reply_to") or parsed.get("references"):
        return parsed
    mid = str(parsed.get("message_id") or "").strip()
    if not mid:
        return parsed
    try:
        resp = await client.get(
            GRAPH_MESSAGE_URL.format(id=mid),
            params={"$select": "internetMessageHeaders"},
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code != 200:
            return parsed
        for header in resp.json().get("internetMessageHeaders") or []:
            name = str(header.get("name", "")).lower()
            value = str(header.get("value") or "")
            if not value:
                continue
            if name == "in-reply-to" and not parsed.get("in_reply_to"):
                parsed["in_reply_to"] = value
            elif name == "references" and not parsed.get("references"):
                parsed["references"] = value
            elif name in _AUTO_HEADER_KEYS:
                auto = parsed.setdefault("auto_headers", {})
                if isinstance(auto, dict) and name not in auto:
                    auto[name] = value
    except httpx.HTTPError:
        logger.debug("Graph RFC header enrich failed for %s", mid, exc_info=True)
    return parsed


async def _gmail_get_message(client: httpx.AsyncClient, token: str, mid: str) -> dict[str, Any]:
    detail = await client.get(
        GMAIL_MSG_URL.format(id=mid),
        params={"format": "full"},
        headers={"Authorization": f"Bearer {token}"},
    )
    detail.raise_for_status()
    return _parse_gmail_message(detail.json())


async def _fetch_gmail_full(
    token: str, label_id: str, since: datetime | None = None
) -> tuple[list[dict[str, Any]], str]:
    """Full folder list + current historyId as the new cursor."""
    out: list[dict[str, Any]] = []
    params: dict[str, str] = {"maxResults": str(MAX_FETCH), "labelIds": label_id}
    if since is not None:
        # Gmail search: `after:` accepts epoch seconds.
        params["q"] = f"after:{int(since.replace(tzinfo=timezone.utc).timestamp())}"
    async with httpx.AsyncClient(timeout=20.0) as client:
        listing = await client.get(
            GMAIL_LIST_URL,
            params=params,
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
    token: str, sync_cursor: str, label_id: str, since: datetime | None = None
) -> tuple[list[dict[str, Any]], str]:
    if sync_cursor:
        incremental = await _fetch_gmail_history(token, sync_cursor, label_id)
        if incremental is not None:
            return incremental
    return await _fetch_gmail_full(token, label_id, since)


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
            messages.append(await _enrich_graph_rfc_headers(client, token, parsed))
    return messages, data.get("@odata.nextLink"), data.get("@odata.deltaLink")


GRAPH_MESSAGE_SELECT = (
    "id,subject,from,bodyPreview,body,conversationId,hasAttachments,"
    "internetMessageId,receivedDateTime"
)


def _graph_since_filter(since: datetime) -> str:
    return f"receivedDateTime ge {since.strftime('%Y-%m-%dT%H:%M:%SZ')}"


async def _fetch_graph_full(
    token: str, folder: str, since: datetime | None = None
) -> tuple[list[dict[str, Any]], str]:
    out: list[dict[str, Any]] = []
    delta_link = ""
    async with httpx.AsyncClient(timeout=20.0) as client:
        # Prefer delta so we obtain a deltaLink for subsequent ticks.
        try:
            url: str | None = GRAPH_FOLDER_DELTA_URL.format(folder=folder)
            params: dict[str, str] | None = {
                "$top": str(MAX_FETCH),
                "$select": GRAPH_MESSAGE_SELECT,
            }
            if since is not None and params is not None:
                params["$filter"] = _graph_since_filter(since)
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

        list_params: dict[str, str] = {
            "$top": str(MAX_FETCH),
            "$orderby": "receivedDateTime desc",
            "$select": GRAPH_MESSAGE_SELECT,
        }
        if since is not None:
            list_params["$filter"] = _graph_since_filter(since)
        resp = await client.get(
            GRAPH_FOLDER_URL.format(folder=folder),
            params=list_params,
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        for msg in resp.json().get("value", []) or []:
            parsed = _parse_graph_message(msg)
            if parsed:
                out.append(parsed)
    return out, delta_link


async def _fetch_graph(
    token: str, sync_cursor: str, folder: str, since: datetime | None = None
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
                        return await _fetch_graph_full(token, folder, since)
                    raise
                out.extend(page)
                if delta:
                    delta_link = delta
                url = next_link
        return out, delta_link
    return await _fetch_graph_full(token, folder, since)


async def _fetch_messages(
    account: ChannelAccount,
    token: str,
    folder_id: str,
    cursor: str,
    since: datetime | None = None,
) -> tuple[list[dict[str, Any]], str] | None:
    """Fetch one folder. Returns None when the folder has no provider mapping.

    `since` bounds the initial backfill (no cursor yet); incremental syncs
    ignore it because a cursor already marks the resume point.
    """
    if account.provider == "gmail":
        label = GMAIL_LABEL_IDS.get(folder_id)
        if not label:
            return None
        return await _fetch_gmail(token, cursor, label, since)
    if account.provider == "outlook":
        folder = GRAPH_FOLDER_NAMES.get(folder_id)
        if not folder:
            return None
        return await _fetch_graph(token, cursor, folder, since)
    if account.provider == "smtp_imap":
        # V1: INBOX only (UID cursor). Other folder ids are skipped.
        if folder_id != "inbox":
            return None
        from app.services.smtp_imap import SmtpImapError, fetch_inbox_since

        try:
            return await fetch_inbox_since(account, cursor, since=since)
        except SmtpImapError:
            raise
    return None


async def _hydrate_smtp_imap_attachments(
    tenant_id: UUID, item: dict[str, Any]
) -> None:
    """Persist inline MIME attachment bytes already present on the sync item."""
    raw_attachments = item.get("attachments") or []
    if not raw_attachments:
        return
    hydrated: list[dict[str, Any]] = []
    for att in raw_attachments:
        data = att.get("data")
        if not data or not isinstance(data, (bytes, bytearray)):
            continue
        if len(data) > MAX_ATTACHMENT_BYTES:
            continue
        stored = await _store_attachment(
            tenant_id,
            filename=str(att.get("filename") or "file"),
            mime=str(att.get("mime") or "application/octet-stream"),
            data=bytes(data),
        )
        if stored:
            hydrated.append(stored)
    item["attachments"] = hydrated


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
    cid_map: dict[str, str] = {}
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
        content_id = normalize_content_id(str(att.get("contentId") or ""))
        stored = await _store_attachment(
            tenant_id,
            filename=str(att.get("name") or (f"inline-{content_id[:24]}.bin" if content_id else "file")),
            mime=str(att.get("contentType") or "application/octet-stream"),
            data=data,
        )
        if stored:
            if content_id:
                stored["content_id"] = content_id
                stored["inline"] = bool(att.get("isInline"))
                cid_map[content_id] = str(stored.get("url") or "")
            stored_list.append(stored)
    item["attachments"] = stored_list
    if cid_map and item.get("body_html"):
        item["body_html"] = rewrite_cid_urls(str(item.get("body_html") or ""), cid_map)


async def _hydrate_gmail_attachments(
    client: httpx.AsyncClient, token: str, tenant_id: UUID, item: dict[str, Any]
) -> None:
    raw_attachments = item.get("attachments") or []
    if not raw_attachments or not item.get("message_id"):
        return
    hydrated: list[dict[str, Any]] = []
    cid_map: dict[str, str] = {}
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
            content_id = normalize_content_id(str(att.get("content_id") or ""))
            if content_id:
                stored["content_id"] = content_id
                stored["inline"] = bool(att.get("inline"))
                cid_map[content_id] = str(stored.get("url") or "")
            hydrated.append(stored)
    item["attachments"] = hydrated
    if cid_map and item.get("body_html"):
        item["body_html"] = rewrite_cid_urls(str(item.get("body_html") or ""), cid_map)


async def _hydrate_attachments(
    account: ChannelAccount, token: str, items: list[dict[str, Any]]
) -> None:
    """Download attachment bytes for freshly fetched messages and replace the
    provider metadata with served attachment dicts ({name, mime, size, url})."""
    if not items:
        return
    if account.provider == "smtp_imap":
        for item in items:
            try:
                await _hydrate_smtp_imap_attachments(account.tenant_id, item)
            except Exception:
                logger.exception(
                    "attachment hydration failed for message %s", item.get("message_id")
                )
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
    from app.services.crypto import set_connection_credentials

    set_connection_credentials(account, creds)
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
    try:
        account_settings = json.loads(account.settings_json or "{}")
    except json.JSONDecodeError:
        account_settings = {}
    if not isinstance(account_settings, dict):
        account_settings = {}

    ingested = 0
    for item in items:
        received_at = item.get("received_at")
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
            received_at=received_at if isinstance(received_at, datetime) else None,
            metadata={
                "body_html": item.get("body_html", ""),
                "attachments": item.get("attachments") or [],
                "rfc_message_id": item.get("rfc_message_id", ""),
                "in_reply_to": item.get("in_reply_to", ""),
                "references": item.get("references", ""),
                "auto_headers": item.get("auto_headers") or {},
                "folder": folder_id,
                "cc": item.get("cc", ""),
            },
        )
        try:
            _signal, should_process = await ingest_inbound(session, account.tenant_id, inbound)
        except BlockedContactError:
            continue
        if should_process:
            ingested += 1
            # Backfilled history (older than the mailbox AI-live cutoff) is
            # stored for context but never triggers agent processing.
            if is_backfill_message(inbound.received_at, account_settings):
                continue
            try:
                from app.workers.tasks import enqueue_signal_processing

                await enqueue_signal_processing(str(account.tenant_id), str(_signal.id))
            except Exception:
                logger.debug("enqueue_signal_processing unavailable; stored only")
    return ingested


async def sync_account(session: AsyncSession, account: ChannelAccount) -> dict[str, Any]:
    """Poll each selected folder of one mailbox and ingest new messages."""
    if account.provider not in ("gmail", "outlook", "smtp_imap") or not account.is_enabled:
        return {"account_id": str(account.id), "synced": 0, "status": "skipped"}
    creds = _credentials(account)
    token = ""
    if account.provider == "smtp_imap":
        from app.services.smtp_imap import is_connected

        if not (creds.get("username") and creds.get("password")):
            return {"account_id": str(account.id), "synced": 0, "status": "no_credentials"}
        if not is_connected(creds):
            return {"account_id": str(account.id), "synced": 0, "status": "not_verified"}
    else:
        token = creds.get("access_token") or ""
        if not token:
            return {"account_id": str(account.id), "synced": 0, "status": "no_credentials"}
        if creds.get("mock"):
            # Dev mailbox connected via the mock OAuth flow: nothing to poll.
            return {"account_id": str(account.id), "synced": 0, "status": "mock_skipped"}

    settings = json.loads(account.settings_json or "{}")
    if not isinstance(settings, dict):
        settings = {}
    # Stamp the AI-live cutoff on the first sync so historical (backfilled)
    # mail is stored without triggering agent runs or decision cards.
    settings = ensure_ai_live_since(settings)
    account.settings_json = json.dumps(settings)
    folders = [f["id"] for f in account_sync_folders(settings) if f.get("is_selected")]
    if account.provider == "smtp_imap":
        folders = [f for f in folders if f == "inbox"] or ["inbox"]
    cursors: dict[str, str] = (
        dict(settings.get("sync_cursors"))
        if isinstance(settings.get("sync_cursors"), dict)
        else {}
    )
    window_days = account_sync_window_days(settings)
    since = datetime.utcnow() - timedelta(days=window_days) if window_days > 0 else None

    ingested = 0
    fetched = 0
    for folder_id in folders:
        cursor = _folder_cursor(settings, account, folder_id)
        try:
            fetch = await _fetch_messages(account, token, folder_id, cursor, since)
        except Exception as fetch_exc:
            from app.services.smtp_imap import SmtpImapError

            if isinstance(fetch_exc, SmtpImapError):
                kind = (
                    "auth_expired"
                    if fetch_exc.code == "auth_failed"
                    else (
                        "network_unreachable"
                        if fetch_exc.code == "network_unreachable"
                        else "error"
                    )
                )
                await _record_sync_error(session, account, fetch_exc.message, kind=kind)
                return {
                    "account_id": str(account.id),
                    "synced": 0,
                    "status": fetch_exc.code,
                }
            if isinstance(fetch_exc, httpx.HTTPStatusError):
                if fetch_exc.response.status_code == 401:
                    token = await _refresh_if_possible(session, account)
                    if not token:
                        await _record_sync_error(
                            session,
                            account,
                            "Authentication expired. Reconnect this mailbox.",
                            kind="auth_expired",
                        )
                        return {
                            "account_id": str(account.id),
                            "synced": 0,
                            "status": "auth_expired",
                        }
                    try:
                        fetch = await _fetch_messages(
                            account, token, folder_id, cursor, since
                        )
                    except Exception as retry_exc:  # noqa: BLE001 — surfaced in sync status
                        logger.exception(
                            "mailbox sync retry failed for account=%s", account.id
                        )
                        await _record_sync_error(
                            session, account, f"Sync failed: {retry_exc}"
                        )
                        return {
                            "account_id": str(account.id),
                            "synced": 0,
                            "status": "error",
                        }
                else:
                    logger.exception("mailbox sync failed for account=%s", account.id)
                    await _record_sync_error(
                        session,
                        account,
                        f"Provider error ({fetch_exc.response.status_code}).",
                    )
                    return {"account_id": str(account.id), "synced": 0, "status": "error"}
            else:
                logger.exception("mailbox sync failed for account=%s", account.id)
                await _record_sync_error(session, account, f"Sync failed: {fetch_exc}")
                return {"account_id": str(account.id), "synced": 0, "status": "error"}

        if fetch is None:
            # Folder not supported by this provider (e.g. Gmail archive).
            continue
        messages, new_cursor = fetch
        fetched += len(messages)

        # Initial backfill: enforce the window client-side too — not every
        # provider path honors the server-side filter (e.g. Gmail history).
        if not cursor and since is not None:
            messages = [
                m
                for m in messages
                if not isinstance(m.get("received_at"), datetime) or m["received_at"] >= since
            ]

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
    settings.pop("sync_error_count", None)
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
    """Sync every connected Gmail/Outlook/SMTP-IMAP mailbox for a tenant."""
    result = await session.execute(
        select(ChannelAccount).where(
            ChannelAccount.tenant_id == tenant_id,
            ChannelAccount.channel == "email",
            ChannelAccount.is_enabled.is_(True),
            ChannelAccount.provider.in_(("gmail", "outlook", "smtp_imap")),
        )
    )
    accounts = result.scalars().all()
    return [await sync_account(session, account) for account in accounts]
