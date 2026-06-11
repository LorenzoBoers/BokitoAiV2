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

from app.channels.base import InboundMessage
from app.models.channel import ChannelAccount

GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
GRAPH_SEND_URL = "https://graph.microsoft.com/v1.0/me/sendMail"


def normalize_inbound(payload: dict[str, Any], account: ChannelAccount) -> InboundMessage:
    """Normalize a provider-agnostic inbound email webhook payload."""
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
    )


def _credentials(account: ChannelAccount) -> dict[str, Any]:
    try:
        data = json.loads(account.credentials_json or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def format_outbound(
    account: ChannelAccount, *, to_address: str, subject: str, body_text: str
) -> dict[str, Any]:
    """Build the provider request payload for an outbound email."""
    if account.provider == "gmail":
        mime = EmailMessage()
        mime["To"] = to_address
        mime["From"] = account.address
        mime["Subject"] = subject
        mime.set_content(body_text)
        raw = base64.urlsafe_b64encode(mime.as_bytes()).decode()
        return {"raw": raw}
    if account.provider == "outlook":
        return {
            "message": {
                "subject": subject,
                "body": {"contentType": "Text", "content": body_text},
                "toRecipients": [{"emailAddress": {"address": to_address}}],
            },
            "saveToSentItems": True,
        }
    return {"to": to_address, "subject": subject, "body_text": body_text}


async def send_via_provider(
    account: ChannelAccount, *, to_address: str, subject: str, body_text: str
) -> str:
    """Send an email through the account's provider. Returns a send status."""
    payload = format_outbound(account, to_address=to_address, subject=subject, body_text=body_text)
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
