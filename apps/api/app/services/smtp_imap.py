"""SMTP/IMAP mailbox provider for ChannelAccount (provider=smtp_imap).

Credentials live encrypted on the account (see CREDENTIALS_FERNET_KEY). Transport
uses stdlib imaplib/smtplib in a thread pool — no OAuth, no extra dependencies.
V1 syncs INBOX only via UID cursor; outbound is SMTP with RFC822 threading headers.
"""

from __future__ import annotations

import asyncio
import email
import email.policy
import imaplib
import logging
import smtplib
import ssl
from datetime import datetime, timezone
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.utils import formataddr, parsedate_to_datetime, parseaddr
from typing import Any

from app.models.channel import ChannelAccount
from app.services.crypto import get_connection_credentials

logger = logging.getLogger(__name__)

PROVIDER = "smtp_imap"
INBOX_FOLDER_ID = "inbox"
MAX_FETCH = 25
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
VERIFY_TIMEOUT_SEC = 20


class SmtpImapError(Exception):
    """Operator-facing connect/sync/send failure."""

    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


def normalize_credentials(raw: dict[str, Any] | None) -> dict[str, Any]:
    """Validate and normalize credential fields for storage."""
    data = dict(raw or {})
    email_addr = str(data.get("email") or data.get("address") or data.get("username") or "").strip()
    username = str(data.get("username") or email_addr).strip()
    password = str(data.get("password") or "")
    imap_host = str(data.get("imap_host") or "").strip()
    smtp_host = str(data.get("smtp_host") or "").strip()
    if not email_addr or "@" not in email_addr:
        raise SmtpImapError("invalid_email", "Enter a valid mailbox email address.")
    if not username or not password:
        raise SmtpImapError("invalid_credentials", "Username and password are required.")
    if not imap_host:
        raise SmtpImapError("invalid_imap", "IMAP host is required.")
    if not smtp_host:
        raise SmtpImapError("invalid_smtp", "SMTP host is required.")

    try:
        imap_port = int(data.get("imap_port") or 993)
        smtp_port = int(data.get("smtp_port") or 587)
    except (TypeError, ValueError) as exc:
        raise SmtpImapError("invalid_port", "IMAP and SMTP ports must be numbers.") from exc

    imap_ssl = bool(data["imap_ssl"]) if "imap_ssl" in data else True
    smtp_ssl = bool(data["smtp_ssl"]) if "smtp_ssl" in data else (smtp_port == 465)
    smtp_starttls = (
        bool(data["smtp_starttls"]) if "smtp_starttls" in data else (not smtp_ssl)
    )

    return {
        "username": username,
        "password": password,
        "imap_host": imap_host,
        "imap_port": imap_port,
        "imap_ssl": imap_ssl,
        "smtp_host": smtp_host,
        "smtp_port": smtp_port,
        "smtp_ssl": smtp_ssl,
        "smtp_starttls": smtp_starttls,
        "verified_at": data.get("verified_at") or "",
    }


def is_connected(credentials: dict[str, Any] | None) -> bool:
    creds = credentials or {}
    return bool(
        creds.get("username")
        and creds.get("password")
        and creds.get("imap_host")
        and creds.get("smtp_host")
        and creds.get("verified_at")
    )


def _decode_header_value(value: str | None) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def _imap_connect(creds: dict[str, Any]) -> imaplib.IMAP4:
    host = creds["imap_host"]
    port = int(creds["imap_port"])
    timeout = VERIFY_TIMEOUT_SEC
    try:
        if creds.get("imap_ssl", True):
            client: imaplib.IMAP4 = imaplib.IMAP4_SSL(host, port, timeout=timeout)
        else:
            client = imaplib.IMAP4(host, port, timeout=timeout)
        typ, _ = client.login(creds["username"], creds["password"])
        if typ != "OK":
            raise SmtpImapError("auth_failed", "IMAP login failed. Check username and password.")
        return client
    except SmtpImapError:
        raise
    except (TimeoutError, OSError, imaplib.IMAP4.error) as exc:
        msg = str(exc).lower()
        if "authentication" in msg or "invalid credentials" in msg or "login" in msg:
            raise SmtpImapError(
                "auth_failed", "IMAP login failed. Check username and password."
            ) from exc
        raise SmtpImapError(
            "network_unreachable",
            "Could not reach the IMAP server. Check host, port, SSL, and firewall.",
        ) from exc


def _smtp_connect(creds: dict[str, Any]) -> smtplib.SMTP:
    host = creds["smtp_host"]
    port = int(creds["smtp_port"])
    timeout = VERIFY_TIMEOUT_SEC
    try:
        if creds.get("smtp_ssl") or port == 465:
            client: smtplib.SMTP = smtplib.SMTP_SSL(host, port, timeout=timeout)
        else:
            client = smtplib.SMTP(host, port, timeout=timeout)
            client.ehlo()
            if creds.get("smtp_starttls", True):
                context = ssl.create_default_context()
                client.starttls(context=context)
                client.ehlo()
        client.login(creds["username"], creds["password"])
        return client
    except SmtpImapError:
        raise
    except smtplib.SMTPAuthenticationError as exc:
        raise SmtpImapError(
            "auth_failed", "SMTP login failed. Check username and password."
        ) from exc
    except (TimeoutError, OSError, smtplib.SMTPException) as exc:
        raise SmtpImapError(
            "network_unreachable",
            "Could not reach the SMTP server. Check host, port, TLS, and firewall.",
        ) from exc


def verify_mailbox_sync(creds: dict[str, Any]) -> dict[str, Any]:
    """IMAP LOGIN + SMTP auth. Returns credentials with verified_at stamped."""
    normalized = normalize_credentials(creds)
    imap_client = None
    smtp_client = None
    try:
        imap_client = _imap_connect(normalized)
        smtp_client = _smtp_connect(normalized)
    finally:
        if imap_client is not None:
            try:
                imap_client.logout()
            except Exception:
                pass
        if smtp_client is not None:
            try:
                smtp_client.quit()
            except Exception:
                pass
    normalized["verified_at"] = datetime.now(timezone.utc).isoformat()
    return normalized


async def verify_mailbox(creds: dict[str, Any]) -> dict[str, Any]:
    return await asyncio.to_thread(verify_mailbox_sync, creds)


def _parse_mime_bytes(raw: bytes, *, uid: str) -> dict[str, Any] | None:
    try:
        msg = email.message_from_bytes(raw, policy=email.policy.default)
    except Exception:
        logger.exception("failed to parse IMAP message uid=%s", uid)
        return None

    from_name, from_addr = parseaddr(_decode_header_value(msg.get("From")))
    subject = _decode_header_value(msg.get("Subject"))
    rfc_id = (msg.get("Message-ID") or "").strip()
    in_reply_to = (msg.get("In-Reply-To") or "").strip()
    references = (msg.get("References") or "").strip()
    cc = _decode_header_value(msg.get("Cc"))

    received_at: datetime | None = None
    date_hdr = msg.get("Date")
    if date_hdr:
        try:
            received_at = parsedate_to_datetime(date_hdr)
            if received_at.tzinfo is None:
                received_at = received_at.replace(tzinfo=timezone.utc)
            received_at = received_at.astimezone(timezone.utc).replace(tzinfo=None)
        except Exception:
            received_at = None

    body_text = ""
    body_html = ""
    attachments: list[dict[str, Any]] = []

    if msg.is_multipart():
        for part in msg.walk():
            ctype = (part.get_content_type() or "").lower()
            disp = str(part.get("Content-Disposition") or "").lower()
            if ctype == "text/plain" and "attachment" not in disp and not body_text:
                try:
                    body_text = part.get_content()
                    if not isinstance(body_text, str):
                        body_text = str(body_text)
                except Exception:
                    payload = part.get_payload(decode=True) or b""
                    charset = part.get_content_charset() or "utf-8"
                    body_text = payload.decode(charset, errors="replace")
            elif ctype == "text/html" and "attachment" not in disp and not body_html:
                try:
                    body_html = part.get_content()
                    if not isinstance(body_html, str):
                        body_html = str(body_html)
                except Exception:
                    payload = part.get_payload(decode=True) or b""
                    charset = part.get_content_charset() or "utf-8"
                    body_html = payload.decode(charset, errors="replace")
            elif "attachment" in disp or part.get_filename():
                payload = part.get_payload(decode=True) or b""
                if not payload or len(payload) > MAX_ATTACHMENT_BYTES:
                    continue
                # Attachments are re-fetched/stored by sync hydrate if needed;
                # for IMAP we inline-store metadata and let sync persist bytes.
                attachments.append(
                    {
                        "filename": part.get_filename() or "file",
                        "mime": ctype or "application/octet-stream",
                        "size": len(payload),
                        "data": payload,
                    }
                )
    else:
        ctype = (msg.get_content_type() or "text/plain").lower()
        try:
            content = msg.get_content()
            if not isinstance(content, str):
                content = str(content)
        except Exception:
            payload = msg.get_payload(decode=True) or b""
            charset = msg.get_content_charset() or "utf-8"
            content = payload.decode(charset, errors="replace")
        if ctype == "text/html":
            body_html = content
        else:
            body_text = content

    if not body_text and body_html:
        # Local strip — avoid importing email_sync (circular with fetch wiring).
        import re

        body_text = re.sub(r"<[^>]+>", " ", body_html)
        body_text = re.sub(r"\s+", " ", body_text).strip()

    external_id = rfc_id or f"imap-uid-{uid}"
    thread_id = (
        in_reply_to
        or (references.split()[-1] if references else "")
        or external_id
    )

    return {
        "from_address": from_addr or "",
        "from_name": from_name or "",
        "subject": subject or "",
        "body_text": body_text or "",
        "body_html": body_html or "",
        "message_id": external_id,
        "thread_id": thread_id or external_id,
        "rfc_message_id": rfc_id,
        "in_reply_to": in_reply_to,
        "references": references,
        "cc": cc,
        "received_at": received_at,
        "attachments": attachments,
        "imap_uid": uid,
    }


def fetch_inbox_since_sync(
    creds: dict[str, Any],
    uid_cursor: str,
    *,
    since: datetime | None = None,
    limit: int = MAX_FETCH,
) -> tuple[list[dict[str, Any]], str]:
    """Fetch INBOX messages newer than uid_cursor. Returns (items, new_cursor)."""
    client = _imap_connect(creds)
    try:
        typ, _ = client.select("INBOX", readonly=True)
        if typ != "OK":
            raise SmtpImapError("imap_select", "Could not open INBOX on this mailbox.")

        last_uid = 0
        if uid_cursor.strip().isdigit():
            last_uid = int(uid_cursor.strip())

        if last_uid > 0:
            criteria = f"(UID {last_uid + 1}:*)"
        elif since is not None:
            # IMAP SINCE is date-only (dd-Mon-yyyy).
            criteria = f'(SINCE "{since.strftime("%d-%b-%Y")}")'
        else:
            criteria = "ALL"

        typ, data = client.uid("search", None, criteria)
        if typ != "OK" or not data or not data[0]:
            return [], uid_cursor or str(last_uid or "")

        uids = [u.decode() if isinstance(u, bytes) else str(u) for u in data[0].split()]
        # Skip the cursor UID itself if the server included it.
        uids = [u for u in uids if u.isdigit() and int(u) > last_uid]
        if not uids:
            return [], uid_cursor or str(last_uid or "")

        # Newest last for ingest order; cap to MAX_FETCH most recent.
        uids = uids[-limit:]
        items: list[dict[str, Any]] = []
        new_cursor = uid_cursor or str(last_uid or "")
        for uid in uids:
            typ, fetched = client.uid("fetch", uid, "(RFC822)")
            if typ != "OK" or not fetched:
                continue
            raw = None
            for part in fetched:
                if isinstance(part, tuple) and len(part) >= 2 and isinstance(part[1], (bytes, bytearray)):
                    raw = bytes(part[1])
                    break
            if not raw:
                continue
            parsed = _parse_mime_bytes(raw, uid=uid)
            if parsed:
                items.append(parsed)
            new_cursor = uid
        return items, new_cursor
    finally:
        try:
            client.logout()
        except Exception:
            pass


async def fetch_inbox_since(
    account: ChannelAccount,
    uid_cursor: str,
    *,
    since: datetime | None = None,
) -> tuple[list[dict[str, Any]], str]:
    creds = get_connection_credentials(account)
    if not is_connected(creds) and not (creds.get("username") and creds.get("password")):
        raise SmtpImapError("no_credentials", "Mailbox credentials are missing.")
    return await asyncio.to_thread(
        fetch_inbox_since_sync, creds, uid_cursor, since=since
    )


def send_smtp_sync(
    creds: dict[str, Any],
    *,
    from_address: str,
    from_display_name: str | None,
    to_address: str,
    subject: str,
    body_text: str,
    body_html: str | None = None,
    cc: str | None = None,
    bcc: str | None = None,
    in_reply_to: str | None = None,
    references: str | None = None,
    attachments: list[dict[str, Any]] | None = None,
) -> None:
    msg = EmailMessage()
    msg["Subject"] = subject or ""
    msg["From"] = (
        formataddr((from_display_name, from_address))
        if from_display_name
        else from_address
    )
    msg["To"] = to_address
    if cc:
        msg["Cc"] = cc
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
    if references:
        msg["References"] = references

    if body_html:
        msg.set_content(body_text or "")
        msg.add_alternative(body_html, subtype="html")
    else:
        msg.set_content(body_text or "")

    for att in attachments or []:
        data = att.get("data")
        if not data:
            continue
        filename = str(att.get("filename") or "file")
        mime = str(att.get("mime") or "application/octet-stream")
        maintype, _, subtype = mime.partition("/")
        if not subtype:
            maintype, subtype = "application", "octet-stream"
        msg.add_attachment(
            data if isinstance(data, (bytes, bytearray)) else bytes(data),
            maintype=maintype,
            subtype=subtype,
            filename=filename,
        )

    recipients: list[str] = []
    for field in (to_address, cc or "", bcc or ""):
        for part in field.split(","):
            _, addr = parseaddr(part.strip())
            if addr:
                recipients.append(addr)
    if not recipients:
        raise SmtpImapError("no_recipient", "No recipients to send to.")

    client = _smtp_connect(creds)
    try:
        client.send_message(msg, from_addr=from_address, to_addrs=recipients)
    finally:
        try:
            client.quit()
        except Exception:
            pass


async def send_smtp(
    account: ChannelAccount,
    *,
    to_address: str,
    subject: str,
    body_text: str,
    body_html: str | None = None,
    cc: str | None = None,
    bcc: str | None = None,
    in_reply_to: str | None = None,
    references: str | None = None,
    attachments: list[dict[str, Any]] | None = None,
    from_display_name: str | None = None,
) -> str:
    """Send via tenant SMTP. Returns send_status string."""
    creds = get_connection_credentials(account)
    if not creds.get("username") or not creds.get("password"):
        return "failed:no_credentials"
    try:
        await asyncio.to_thread(
            send_smtp_sync,
            creds,
            from_address=account.address,
            from_display_name=from_display_name or account.display_name or None,
            to_address=to_address,
            subject=subject,
            body_text=body_text,
            body_html=body_html,
            cc=cc,
            bcc=bcc,
            in_reply_to=in_reply_to,
            references=references,
            attachments=attachments,
        )
        return "sent"
    except SmtpImapError as exc:
        if exc.code == "auth_failed":
            return "failed:auth"
        if exc.code == "network_unreachable":
            return "failed:network"
        return f"failed:{exc.code}"
    except Exception:
        logger.exception("smtp send failed for account=%s", account.id)
        return "failed:network"
