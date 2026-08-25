"""WhatsApp Business Cloud API adapter: webhook inbound + Graph API outbound.

`ChannelAccount` for whatsapp stores the business phone number
(`address` = Cloud API phone_number_id) and `credentials_json` =
{"access_token": "...", "waba_id": "..."}. Meta delivers events for all
tenants to ONE app-level webhook URL; the router resolves the account via
`metadata.phone_number_id` in the payload.

Threading: WhatsApp has no thread concept — every customer number maps to a
single continuous Signal (`thread_external_id` = the customer's wa_id).
"""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timezone
from typing import Any

import httpx

from app.channels.base import InboundMessage
from app.models.channel import ChannelAccount

GRAPH_API_BASE = "https://graph.facebook.com/v21.0"

# Cloud API error codes for sends outside the 24h customer-service window.
_SERVICE_WINDOW_ERROR_CODES = {131047, 131026, 470}
_AUTH_ERROR_CODES = {190, 401}

# Non-text message types rendered as a placeholder in V1 (no media download).
_MEDIA_PLACEHOLDERS = {
    "image": "[Image received]",
    "video": "[Video received]",
    "audio": "[Voice message received]",
    "document": "[Document received]",
    "sticker": "[Sticker received]",
    "location": "[Location shared]",
    "contacts": "[Contact card shared]",
}


def _credentials(account: ChannelAccount) -> dict[str, Any]:
    try:
        data = json.loads(account.credentials_json or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def verify_signature(*, app_secret: str, signature: str, body: bytes) -> bool:
    """Meta webhook signing: X-Hub-Signature-256 = 'sha256=' + HMAC(app secret)."""
    if not app_secret:
        return False
    expected = "sha256=" + hmac.new(app_secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")


def extract_message_values(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Flatten a webhook payload into its `value` objects (one per change)."""
    values: list[dict[str, Any]] = []
    for entry in payload.get("entry") or []:
        if not isinstance(entry, dict):
            continue
        for change in entry.get("changes") or []:
            if not isinstance(change, dict):
                continue
            value = change.get("value")
            if isinstance(value, dict) and change.get("field") == "messages":
                values.append(value)
    return values


def _message_body(message: dict[str, Any]) -> str:
    """Extract display text for a Cloud API message; placeholder for media."""
    msg_type = str(message.get("type") or "")
    if msg_type == "text":
        return str((message.get("text") or {}).get("body") or "")
    if msg_type == "button":
        return str((message.get("button") or {}).get("text") or "")
    if msg_type == "interactive":
        interactive = message.get("interactive") or {}
        reply = interactive.get("button_reply") or interactive.get("list_reply") or {}
        return str(reply.get("title") or "")
    placeholder = _MEDIA_PLACEHOLDERS.get(msg_type, f"[{msg_type or 'Unsupported'} message received]")
    caption = str((message.get(msg_type) or {}).get("caption") or "") if msg_type else ""
    return f"{placeholder} {caption}".strip() if caption else placeholder


def normalize_inbound(
    value: dict[str, Any], account: ChannelAccount
) -> list[InboundMessage]:
    """Normalize a webhook `value` object into InboundMessages.

    Status updates (`statuses`) and payloads without customer messages
    return an empty list.
    """
    messages = value.get("messages") or []
    if not isinstance(messages, list) or not messages:
        return []

    # Sender display names come from the parallel contacts array.
    names: dict[str, str] = {}
    for contact in value.get("contacts") or []:
        if isinstance(contact, dict):
            wa_id = str(contact.get("wa_id") or "")
            profile = contact.get("profile") or {}
            if wa_id:
                names[wa_id] = str(profile.get("name") or "")

    inbound: list[InboundMessage] = []
    for message in messages:
        if not isinstance(message, dict):
            continue
        sender = str(message.get("from") or "")
        if not sender:
            continue
        received_at = None
        try:
            ts = int(message.get("timestamp") or 0)
            if ts > 0:
                received_at = datetime.fromtimestamp(ts, tz=timezone.utc).replace(tzinfo=None)
        except (TypeError, ValueError):
            pass
        msg_type = str(message.get("type") or "")
        body_text = _message_body(message)
        if not body_text:
            continue
        metadata: dict[str, Any] = {"whatsapp_type": msg_type}
        media = message.get(msg_type) if msg_type in _MEDIA_PLACEHOLDERS else None
        if isinstance(media, dict) and media.get("id"):
            metadata["whatsapp_media_id"] = str(media.get("id"))
            if media.get("mime_type"):
                metadata["whatsapp_media_mime"] = str(media.get("mime_type"))
        inbound.append(
            InboundMessage(
                channel="whatsapp",
                source="whatsapp",
                sender_address=sender,
                sender_name=names.get(sender, ""),
                subject=f"WhatsApp {sender}",
                body_text=body_text,
                external_id=str(message.get("id") or ""),
                thread_external_id=sender,
                channel_account_id=account.id,
                received_at=received_at,
                metadata=metadata,
            )
        )
    return inbound


def format_outbound(to_address: str, body_text: str) -> dict[str, Any]:
    """Build a Cloud API text-message payload."""
    return {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to_address,
        "type": "text",
        "text": {"preview_url": False, "body": body_text},
    }


def _send_error_status(status_code: int, data: dict[str, Any]) -> str:
    error = data.get("error") or {}
    code = error.get("code")
    if code in _SERVICE_WINDOW_ERROR_CODES:
        return "failed:outside_service_window"
    if status_code == 401 or code in _AUTH_ERROR_CODES:
        return "failed:auth"
    detail = error.get("message") or status_code
    return f"failed:{detail}"


async def send_message(account: ChannelAccount, *, to_address: str, body_text: str) -> str:
    token = _credentials(account).get("access_token")
    if not token:
        return "failed:no_credentials"
    if not to_address:
        return "failed:no_recipient"
    phone_number_id = (account.address or "").strip()
    if not phone_number_id:
        return "failed:no_phone_number_id"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(
                f"{GRAPH_API_BASE}/{phone_number_id}/messages",
                json=format_outbound(to_address, body_text),
                headers={"Authorization": f"Bearer {token}"},
            )
        try:
            data = res.json()
        except json.JSONDecodeError:
            data = {}
        if res.status_code < 300 and data.get("messages"):
            return "sent"
        return _send_error_status(res.status_code, data if isinstance(data, dict) else {})
    except httpx.HTTPError:
        return "failed:network"
