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
from email.message import EmailMessage
from typing import Any

import httpx

from app.channels.base import InboundMessage, account_settings
from app.models.channel import ChannelAccount

GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
GRAPH_SEND_URL = "https://graph.microsoft.com/v1.0/me/sendMail"


def normalize_inbound(payload: dict[str, Any], account: ChannelAccount) -> InboundMessage:
    """Normalize a provider-agnostic inbound email webhook payload."""
    metadata: dict[str, Any] = {}
    if payload.get("body_html"):
        metadata["body_html"] = payload["body_html"]
    if payload.get("attachments"):
        metadata["attachments"] = payload["attachments"]
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


def _append_signature(html_body: str, account: ChannelAccount) -> str:
    signature = account_settings(account).get("signature_html") or ""
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
) -> dict[str, Any]:
    """Build the provider request payload for an outbound email."""
    html_body = body_html or f"<p>{body_text.replace(chr(10), '<br>')}</p>"
    html_body = _append_signature(html_body, account)
    cc_addrs = _parse_address_list(cc)
    bcc_addrs = _parse_address_list(bcc)

    if account.provider == "gmail":
        mime = EmailMessage()
        mime["To"] = to_address
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
        raw = base64.urlsafe_b64encode(mime.as_bytes()).decode()
        return {"raw": raw}
    if account.provider == "outlook":
        message: dict[str, Any] = {
            "subject": subject,
            "body": {"contentType": "HTML", "content": html_body},
            "toRecipients": [{"emailAddress": {"address": to_address}}],
        }
        if cc_addrs:
            message["ccRecipients"] = [{"emailAddress": {"address": addr}} for addr in cc_addrs]
        if bcc_addrs:
            message["bccRecipients"] = [{"emailAddress": {"address": addr}} for addr in bcc_addrs]
        if in_reply_to:
            message["internetMessageHeaders"] = [
                {"name": "In-Reply-To", "value": in_reply_to},
                {"name": "References", "value": references or in_reply_to},
            ]
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
    }


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
) -> str:
    """Send an email through the account's provider. Returns a send status."""
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
    )
    if account.provider == "mock":
        return "sent"

    token = _credentials(account).get("access_token")
    if not token:
        return "failed:no_credentials"

    url = GMAIL_SEND_URL if account.provider == "gmail" else GRAPH_SEND_URL
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            res = await client.post(
                url,
                json=payload,
                headers={"Authorization": f"Bearer {token}"},
            )
        if res.status_code in (200, 202):
            return "sent"
        return f"failed:{res.status_code}"
    except httpx.HTTPError:
        return "failed:network"
