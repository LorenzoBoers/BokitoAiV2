"""Slack decision delivery: Approve/Deny outside the dashboard.

Hooked on the same convergence point as push (`publish_decision`). Targeting:
the thread assignee's DM (via `users.lookupByEmail`, requires the
`users:read.email` scope) when their `decisions` preference has the `slack`
channel enabled; fallback is the workspace notify channel configured on the
Slack `ChannelAccount` (`settings_json.notify_channel_id`).

Interactions come back on `POST /api/channels/slack/interactions` (one global
URL per Slack app); the payload's `team.id` selects the ChannelAccount whose
signing secret verifies the request.
"""

from __future__ import annotations

import json
import logging
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.channels.slack import SLACK_POST_MESSAGE_URL, _credentials
from app.models.auth import User
from app.models.channel import ChannelAccount
from app.models.notification import DecisionRequest
from app.models.signal import Signal

logger = logging.getLogger(__name__)

SLACK_LOOKUP_BY_EMAIL_URL = "https://slack.com/api/users.lookupByEmail"
SLACK_USERS_INFO_URL = "https://slack.com/api/users.info"


async def slack_account(session: AsyncSession, tenant_id: UUID) -> ChannelAccount | None:
    """The tenant's first enabled Slack workspace account with a bot token."""
    result = await session.execute(
        select(ChannelAccount).where(
            ChannelAccount.tenant_id == tenant_id,
            ChannelAccount.channel == "slack",
            ChannelAccount.is_enabled == True,  # noqa: E712
        )
    )
    for account in result.scalars().all():
        if _credentials(account).get("bot_token"):
            return account
    return None


def _account_settings(account: ChannelAccount) -> dict[str, Any]:
    try:
        data = json.loads(account.settings_json or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def decision_blocks(decision: DecisionRequest, *, link: str) -> list[dict[str, Any]]:
    """Block Kit card: title/summary plus Approve/Deny buttons.

    The button value carries the decision id + verdict; the interactions
    endpoint resolves through the exact same path as the dashboard card.
    """
    summary = (decision.summary or "").strip()
    text = f"*Decision required:* {decision.title}"
    if summary:
        text += f"\n{summary[:500]}"
    return [
        {"type": "section", "text": {"type": "mrkdwn", "text": text}},
        {
            "type": "actions",
            "block_id": f"decision:{decision.id}",
            "elements": [
                {
                    "type": "button",
                    "style": "primary",
                    "text": {"type": "plain_text", "text": "Approve"},
                    "action_id": "decision_approve",
                    "value": json.dumps({"decision_id": str(decision.id), "verdict": "approve"}),
                },
                {
                    "type": "button",
                    "style": "danger",
                    "text": {"type": "plain_text", "text": "Deny"},
                    "action_id": "decision_reject",
                    "value": json.dumps({"decision_id": str(decision.id), "verdict": "reject"}),
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "Open in Bokito"},
                    "action_id": "decision_open",
                    "url": link,
                },
            ],
        },
    ]


async def _slack_api(token: str, url: str, payload: dict[str, Any]) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post(url, json=payload, headers={"Authorization": f"Bearer {token}"})
    try:
        data = res.json()
    except ValueError:
        return {"ok": False, "error": f"http_{res.status_code}"}
    return data if isinstance(data, dict) else {"ok": False, "error": "bad_response"}


async def _lookup_slack_user_id(token: str, email: str) -> str | None:
    if not email:
        return None
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.get(
            SLACK_LOOKUP_BY_EMAIL_URL,
            params={"email": email},
            headers={"Authorization": f"Bearer {token}"},
        )
    try:
        data = res.json()
    except ValueError:
        return None
    if data.get("ok") and isinstance(data.get("user"), dict):
        return str(data["user"].get("id") or "") or None
    return None


async def notify_decision_slack(
    session: AsyncSession,
    decision: DecisionRequest,
    *,
    signal_id: UUID | None = None,
) -> int:
    """Deliver an awaiting decision to Slack. Returns number of messages posted."""
    if decision.status != "awaiting_human":
        return 0
    account = await slack_account(session, decision.tenant_id)
    if not account:
        return 0
    token = _credentials(account).get("bot_token", "")

    from app.services.notification_mail import notification_channels, thread_link

    resolved_signal_id = signal_id or decision.signal_id
    link = thread_link(resolved_signal_id) if resolved_signal_id else thread_link("")

    # Preferred target: the thread assignee's DM (opt-in via the `slack`
    # channel on their `decisions` preference row).
    target_channel: str | None = None
    if resolved_signal_id:
        signal = (
            await session.execute(
                select(Signal).where(
                    Signal.id == resolved_signal_id, Signal.tenant_id == decision.tenant_id
                )
            )
        ).scalar_one_or_none()
        assignee_id = signal.assigned_user_id if signal else None
        if assignee_id:
            channels = await notification_channels(
                session, decision.tenant_id, assignee_id, "decisions"
            )
            if channels.get("slack"):
                user = (
                    await session.execute(select(User).where(User.id == assignee_id))
                ).scalar_one_or_none()
                if user and user.email:
                    target_channel = await _lookup_slack_user_id(token, user.email)

    # Fallback: the workspace notify channel configured on the account.
    if not target_channel:
        target_channel = str(_account_settings(account).get("notify_channel_id") or "") or None
    if not target_channel:
        return 0

    blocks = decision_blocks(decision, link=link)
    data = await _slack_api(
        token,
        SLACK_POST_MESSAGE_URL,
        {
            "channel": target_channel,
            "text": f"Decision required: {decision.title}",
            "blocks": blocks,
        },
    )
    if not data.get("ok"):
        logger.warning(
            "slack decision notify failed tenant=%s decision=%s error=%s",
            decision.tenant_id,
            decision.id,
            data.get("error"),
        )
        return 0
    return 1


def schedule_notify_decision_slack(decision_id: UUID, *, signal_id: UUID | None = None) -> None:
    """Fire-and-forget Slack dispatch; never breaks the caller."""
    from app.services.push import _schedule_push_task

    async def _run() -> None:
        from app.db.session import async_session_factory

        async with async_session_factory() as session:
            decision = (
                await session.execute(
                    select(DecisionRequest).where(DecisionRequest.id == decision_id)
                )
            ).scalar_one_or_none()
            if decision:
                await notify_decision_slack(session, decision, signal_id=signal_id)

    _schedule_push_task(_run())


# ---------------------------------------------------------------------------
# Interactions (Approve/Deny button clicks)
# ---------------------------------------------------------------------------


async def _map_slack_user(
    session: AsyncSession, token: str, tenant_id: UUID, slack_user_id: str
) -> User | None:
    """Best-effort Slack user -> Bokito user mapping via profile email."""
    if not slack_user_id or not token:
        return None
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.get(
            SLACK_USERS_INFO_URL,
            params={"user": slack_user_id},
            headers={"Authorization": f"Bearer {token}"},
        )
    try:
        data = res.json()
    except ValueError:
        return None
    profile = (data.get("user") or {}).get("profile") or {} if data.get("ok") else {}
    email = str(profile.get("email") or "").strip().lower()
    if not email:
        return None
    return (
        await session.execute(select(User).where(User.email == email))
    ).scalar_one_or_none()


async def handle_interaction(
    session: AsyncSession, account: ChannelAccount, payload: dict[str, Any]
) -> dict[str, Any]:
    """Resolve a decision from a Slack block_actions payload.

    Uses the exact same resolve path as the dashboard card and posts a
    confirmation back through `response_url` so the Slack message updates.
    """
    from app.services.signal_threads import resolve_message_decision

    actions = payload.get("actions") or []
    action = next((a for a in actions if str(a.get("action_id", "")).startswith("decision_")), None)
    if not action or action.get("action_id") == "decision_open":
        return {"ok": True, "ignored": True}
    try:
        value = json.loads(action.get("value") or "{}")
    except json.JSONDecodeError:
        return {"ok": False, "error": "bad_action_value"}
    decision_id = value.get("decision_id")
    verdict = value.get("verdict")
    if not decision_id or verdict not in ("approve", "reject"):
        return {"ok": False, "error": "bad_action_value"}

    decision = (
        await session.execute(
            select(DecisionRequest).where(
                DecisionRequest.id == UUID(decision_id),
                DecisionRequest.tenant_id == account.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not decision:
        return {"ok": False, "error": "decision_not_found"}

    slack_user_id = str((payload.get("user") or {}).get("id") or "")
    slack_user_name = str((payload.get("user") or {}).get("username") or slack_user_id)
    token = _credentials(account).get("bot_token", "")
    user = await _map_slack_user(session, token, account.tenant_id, slack_user_id)

    outcome_label = "Approved" if verdict == "approve" else "Denied"
    if decision.status != "awaiting_human":
        result: dict[str, Any] = {"ok": True, "already_resolved": True}
        outcome_label = "Already resolved"
    elif decision.signal_id and decision.message_id:
        result = await resolve_message_decision(
            session,
            account.tenant_id,
            user.id if user else None,
            decision.signal_id,
            decision.message_id,
            action=verdict,
            source=f"slack:{slack_user_id}",
        )
    else:
        from app.services.decisions import resolve_decision_message

        await resolve_decision_message(
            session,
            account.tenant_id,
            decision.id,
            action=verdict,
            user_id=user.id if user else None,
        )
        await session.commit()
        result = {"ok": True}

    # Replace the interactive message so the buttons cannot be clicked twice.
    response_url = str(payload.get("response_url") or "")
    if response_url:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(
                    response_url,
                    json={
                        "replace_original": True,
                        "text": f"{outcome_label}: {decision.title} (by @{slack_user_name})",
                    },
                )
        except httpx.HTTPError:
            logger.warning("slack response_url update failed for decision %s", decision.id)
    return result
