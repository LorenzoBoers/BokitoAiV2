"""Slack channel adapter: Events API inbound + chat.postMessage outbound.

`ChannelAccount` for slack stores the workspace (`address` = team id) and
`credentials_json` = {"bot_token": "xoxb-...", "signing_secret": "..."}.
Inbound events thread on the Slack channel+thread_ts pair.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any

import httpx

from app.channels.base import InboundMessage
from app.models.channel import ChannelAccount

SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage"


def _credentials(account: ChannelAccount) -> dict[str, Any]:
    try:
        from app.services.crypto import get_connection_credentials
        data = get_connection_credentials(account)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def verify_signature(account: ChannelAccount, *, timestamp: str, signature: str, body: bytes) -> bool:
    """Slack request signing (v0). Without a configured secret, reject."""
    secret = _credentials(account).get("signing_secret", "")
    if not secret:
        return False
    try:
        if abs(time.time() - float(timestamp)) > 300:
            return False
    except (TypeError, ValueError):
        return False
    base = f"v0:{timestamp}:{body.decode()}"
    expected = "v0=" + hmac.new(secret.encode(), base.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")


def normalize_inbound(event: dict[str, Any], account: ChannelAccount) -> InboundMessage | None:
    """Normalize a Slack Events API `message` event. Returns None for noise."""
    if event.get("type") != "message" or event.get("bot_id") or event.get("subtype"):
        return None
    channel_id = str(event.get("channel") or "")
    thread_ts = str(event.get("thread_ts") or event.get("ts") or "")
    return InboundMessage(
        channel="slack",
        source="slack",
        sender_address=str(event.get("user") or ""),
        body_text=str(event.get("text") or ""),
        subject=f"Slack #{channel_id}",
        external_id=f"{channel_id}:{event.get('ts', '')}",
        thread_external_id=f"{channel_id}:{thread_ts}",
        channel_account_id=account.id,
        metadata={"slack_channel": channel_id, "thread_ts": thread_ts},
    )


def format_outbound(thread_external_id: str, body_text: str) -> dict[str, Any]:
    """Build chat.postMessage payload from a Signal thread external id."""
    channel_id, _, thread_ts = thread_external_id.partition(":")
    payload: dict[str, Any] = {"channel": channel_id, "text": body_text}
    if thread_ts:
        payload["thread_ts"] = thread_ts
    return payload


async def send_message(account: ChannelAccount, *, thread_external_id: str, body_text: str) -> str:
    token = _credentials(account).get("bot_token")
    if not token:
        return "failed:no_credentials"
    payload = format_outbound(thread_external_id, body_text)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(
                SLACK_POST_MESSAGE_URL,
                json=payload,
                headers={"Authorization": f"Bearer {token}"},
            )
        data = res.json()
        return "sent" if data.get("ok") else f"failed:{data.get('error', res.status_code)}"
    except httpx.HTTPError:
        return "failed:network"
