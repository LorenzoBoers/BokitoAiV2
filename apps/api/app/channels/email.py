"""Email channel adapter: normalize inbound payloads, send via provider APIs.

Providers:
- `mock` — store-only (dev/tests)
- `gmail` — Gmail API (`users.messages.send`, OAuth access token in credentials)
- `outlook` — Microsoft Graph (`/me/sendMail`, OAuth access token in credentials)

Credentials live in `ChannelAccount.credentials_json` (`{"access_token": ...}`),
written by the OAuth connect flow.
"""

from __future__ import annotations

import base64
import json
import logging
from email.message import EmailMessage
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.channels.base import InboundMessage, account_settings
from app.models.channel import ChannelAccount
from app.services import oauth_providers

logger = logging.getLogger(__name__)

GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
GRAPH_SEND_URL = "https://graph.microsoft.com/v1.0/me/sendMail"
RESEND_SEND_URL = "https://api.resend.com/emails"


def normalize_inbound(payload: dict[str, Any], account: ChannelAccount) -> InboundMessage:
    """Normalize a provider-agnostic inbound email webhook payload."""
    metadata: dict[str, Any] = {}
    if payload.get("body_html"):
        metadata["body_html"] = payload["body_html"]
    if payload.get("attachments"):
        metadata["attachments"] = payload["attachments"]
    if payload.get("rfc_message_id"):
        metadata["rfc_message_id"] = payload["rfc_message_id"]
    if payload.get("references"):
        metadata["references"] = payload["references"]
    return InboundMessage(
        channel="email",
        source=account.provider,
        sender_address=str(payload.get("from_address") or payload.get("from") or ""),
        sender_name=str(payload.get("from_name") or ""),
        subject=str(payload.get("subject") or ""),
        body_text=str(payload.get("body_text") or payload.get("text") or ""),
        external_id=str(payload.get("message_id") or ""),
        thread_external_id=str(payload.get("thread_id") or payload.get("conversation_id") or ""),
        channel_account_id=account.id,
        metadata=metadata,
    )


def _credentials(account: ChannelAccount) -> dict[str, Any]:
    try:
        data = json.loads(account.credentials_json or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _parse_address_list(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [part.strip() for part in raw.split(",") if part.strip()]


def _append_signature(
    html_body: str, account: ChannelAccount, override: str | None = None
) -> str:
    """Append exactly one signature: the resolved identity signature when
    provided (user or agent, see services/signatures.py), otherwise the
    mailbox-level `signature_html` fallback."""
    signature = override if override else (account_settings(account).get("signature_html") or "")
    if not signature:
        return html_body
    return f"{html_body}<br><br>{signature}"


def format_outbound(
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
    thread_provider_id: str | None = None,
    attachment_payloads: list[dict[str, Any]] | None = None,
    signature_html: str | None = None,
) -> dict[str, Any]:
    """Build the provider request payload for an outbound email.

    `attachment_payloads` items carry hydrated bytes: {name, mime, data}.
    """
    html_body = body_html or f"<p>{body_text.replace(chr(10), '<br>')}</p>"
    html_body = _append_signature(html_body, account, override=signature_html)
    # `to_address` may carry multiple comma/semicolon-separated recipients
    # (compose to several people); normalize once for both providers.
    to_addrs = _parse_address_list(to_address) or [to_address]
    cc_addrs = _parse_address_list(cc)
    bcc_addrs = _parse_address_list(bcc)
    files = attachment_payloads or []

    if account.provider == "gmail":
        mime = EmailMessage()
        mime["To"] = ", ".join(to_addrs)
        mime["From"] = account.address
        mime["Subject"] = subject
        if cc_addrs:
            mime["Cc"] = ", ".join(cc_addrs)
        if bcc_addrs:
            mime["Bcc"] = ", ".join(bcc_addrs)
        if in_reply_to:
            mime["In-Reply-To"] = in_reply_to
            mime["References"] = references or in_reply_to
        mime.set_content(body_text)
        mime.add_alternative(html_body, subtype="html")
        for item in files:
            mime_type = str(item.get("mime") or "application/octet-stream")
            maintype, _, subtype = mime_type.partition("/")
            mime.add_attachment(
                item.get("data") or b"",
                maintype=maintype or "application",
                subtype=subtype or "octet-stream",
                filename=str(item.get("name") or "file"),
            )
        raw = base64.urlsafe_b64encode(mime.as_bytes()).decode()
        payload: dict[str, Any] = {"raw": raw}
        if thread_provider_id:
            # Threads the sent reply in the connected mailbox itself.
            payload["threadId"] = thread_provider_id
        return payload
    if account.provider == "bokito":
        # Resend Send API. Threading relies on standard RFC headers.
        sender = (
            f"{account.display_name} <{account.address}>"
            if account.display_name
            else account.address
        )
        resend_payload: dict[str, Any] = {
            "from": sender,
            "to": to_addrs,
            "subject": subject,
            "text": body_text,
            "html": html_body,
        }
        if cc_addrs:
            resend_payload["cc"] = cc_addrs
        if bcc_addrs:
            resend_payload["bcc"] = bcc_addrs
        if in_reply_to:
            resend_payload["headers"] = {
                "In-Reply-To": in_reply_to,
                "References": references or in_reply_to,
            }
        if files:
            resend_payload["attachments"] = [
                {
                    "filename": str(item.get("name") or "file"),
                    "content": base64.b64encode(item.get("data") or b"").decode(),
                }
                for item in files
            ]
        return resend_payload
    if account.provider == "outlook":
        message: dict[str, Any] = {
            "subject": subject,
            "body": {"contentType": "HTML", "content": html_body},
            "toRecipients": [{"emailAddress": {"address": addr}} for addr in to_addrs],
        }
        if cc_addrs:
            message["ccRecipients"] = [{"emailAddress": {"address": addr}} for addr in cc_addrs]
        if bcc_addrs:
            message["bccRecipients"] = [{"emailAddress": {"address": addr}} for addr in bcc_addrs]
        if files:
            message["attachments"] = [
                {
                    "@odata.type": "#microsoft.graph.fileAttachment",
                    "name": str(item.get("name") or "file"),
                    "contentType": str(item.get("mime") or "application/octet-stream"),
                    "contentBytes": base64.b64encode(item.get("data") or b"").decode(),
                }
                for item in files
            ]
        # Note: Graph rejects In-Reply-To in internetMessageHeaders (only
        # custom x- headers are allowed). Replies thread via the Graph
        # /messages/{id}/reply endpoint in send_via_provider instead.
        return {"message": message, "saveToSentItems": True}
    return {
        "to": to_address,
        "subject": subject,
        "body_text": body_text,
        "body_html": html_body,
        "cc": cc,
        "bcc": bcc,
        "in_reply_to": in_reply_to,
        "references": references,
        "attachments": [str(item.get("name") or "file") for item in files],
    }


async def _refresh_access_token(
    session: AsyncSession | None, account: ChannelAccount
) -> str | None:
    creds = _credentials(account)
    refresh_token = creds.get("refresh_token")
    if not refresh_token:
        return None
    try:
        tokens = await oauth_providers.refresh_access_token(
            account.provider, refresh_token=refresh_token
        )
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
    if session is not None:
        session.add(account)
        await session.commit()
    return access


async def _post_send(url: str, payload: dict[str, Any], token: str) -> httpx.Response:
    async with httpx.AsyncClient(timeout=20) as client:
        return await client.post(
            url,
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )


async def _load_attachment_payloads(
    attachments: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Hydrate stored attachment references ({name, mime, url}) into bytes."""
    if not attachments:
        return []
    from app.services.storage import fetch_attachment_bytes

    out: list[dict[str, Any]] = []
    for att in attachments:
        if not isinstance(att, dict):
            continue
        url = str(att.get("url") or "")
        data = await fetch_attachment_bytes(url) if url else None
        if data is None:
            logger.warning("outbound attachment unavailable: %s", url)
            continue
        out.append(
            {
                "name": att.get("name") or att.get("filename") or "file",
                "mime": att.get("mime") or "application/octet-stream",
                "data": data,
            }
        )
    return out


def _graph_reply_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Convert a sendMail payload into a /messages/{id}/reply payload."""
    message = dict(payload.get("message") or {})
    # Subject is derived from the original message on Graph replies.
    message.pop("subject", None)
    return {"message": message}


async def send_via_provider(
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
    reply_to_provider_id: str | None = None,
    thread_provider_id: str | None = None,
    attachments: list[dict[str, Any]] | None = None,
    session: AsyncSession | None = None,
    signature_html: str | None = None,
) -> str:
    """Send an email through the account's provider. Returns a send status."""
    attachment_payloads = await _load_attachment_payloads(attachments)
    payload = format_outbound(
        account,
        to_address=to_address,
        subject=subject,
        body_text=body_text,
        body_html=body_html,
        cc=cc,
        bcc=bcc,
        in_reply_to=in_reply_to,
        references=references,
        thread_provider_id=thread_provider_id,
        attachment_payloads=attachment_payloads,
        signature_html=signature_html,
    )
    if account.provider == "mock":
        return "sent"

    if account.provider == "bokito":
        # Built-in address: platform-level Resend key, no per-account OAuth.
        from app.config import get_settings

        api_key = get_settings().resend_api_key
        if not api_key:
            if not get_settings().is_production:
                return "sent"
            return "failed:no_credentials"
        try:
            res = await _post_send(RESEND_SEND_URL, payload, api_key)
        except httpx.HTTPError:
            return "failed:network"
        if res.status_code in (200, 201, 202):
            return "sent"
        logger.warning(
            "resend send failed status=%s body=%s", res.status_code, res.text[:300]
        )
        return f"failed:{res.status_code}"

    creds = _credentials(account)
    token = creds.get("access_token")
    if not token or creds.get("mock"):
        from app.config import get_settings

        if not get_settings().is_production:
            # Dev mailboxes connected via the mock OAuth flow have placeholder
            # credentials; store-only "send" keeps every reply flow working.
            return "sent"
        return "failed:no_credentials"

    if account.provider == "outlook" and reply_to_provider_id:
        # Graph threads replies server-side; sendMail cannot set In-Reply-To.
        url = f"https://graph.microsoft.com/v1.0/me/messages/{reply_to_provider_id}/reply"
        payload = _graph_reply_payload(payload)
    else:
        url = GMAIL_SEND_URL if account.provider == "gmail" else GRAPH_SEND_URL

    async def _attempt(current_token: str) -> httpx.Response:
        res = await _post_send(url, payload, current_token)
        if (
            res.status_code == 404
            and account.provider == "outlook"
            and reply_to_provider_id
        ):
            # Original message no longer exists — fall back to a fresh send.
            fresh = format_outbound(
                account,
                to_address=to_address,
                subject=subject,
                body_text=body_text,
                body_html=body_html,
                cc=cc,
                bcc=bcc,
                attachment_payloads=attachment_payloads,
                signature_html=signature_html,
            )
            return await _post_send(GRAPH_SEND_URL, fresh, current_token)
        return res

    try:
        res = await _attempt(token)
        if res.status_code in (200, 201, 202):
            return "sent"
        if res.status_code == 401:
            refreshed = await _refresh_access_token(session, account)
            if not refreshed:
                return "failed:auth_expired"
            retry = await _attempt(refreshed)
            if retry.status_code in (200, 201, 202):
                return "sent"
            return f"failed:{retry.status_code}"
        return f"failed:{res.status_code}"
    except httpx.HTTPError:
        return "failed:network"
