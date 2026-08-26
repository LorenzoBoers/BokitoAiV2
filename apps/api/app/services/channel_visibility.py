"""Per-user channel account visibility.

Stored on `ChannelAccount.settings_json` under the `visibility` key:

    {"visibility": {"mode": "everyone" | "selected", "user_ids": ["<uuid>", ...]}}

Absent or malformed settings mean everyone. Owners, admins, and staff always
see every account; the ACL only restricts members.
"""

import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import ChannelAccount

VISIBILITY_MODES = ("everyone", "selected")

UNRESTRICTED_ROLES = ("owner", "admin")


def account_visibility(account: ChannelAccount) -> dict:
    """Normalized visibility settings for an account (never raises)."""
    try:
        settings = json.loads(account.settings_json or "{}")
    except json.JSONDecodeError:
        settings = {}
    raw = settings.get("visibility")
    if not isinstance(raw, dict) or raw.get("mode") not in VISIBILITY_MODES:
        return {"mode": "everyone", "user_ids": []}
    user_ids = raw.get("user_ids") if isinstance(raw.get("user_ids"), list) else []
    return {"mode": raw["mode"], "user_ids": [str(u) for u in user_ids if u]}


def is_account_visible_to(account: ChannelAccount, *, user_id: UUID, role: str) -> bool:
    if role in UNRESTRICTED_ROLES:
        return True
    visibility = account_visibility(account)
    if visibility["mode"] == "everyone":
        return True
    return str(user_id) in visibility["user_ids"]


async def visible_channel_account_ids(
    session: AsyncSession, tenant_id: UUID, *, user_id: UUID, role: str
) -> set[UUID] | None:
    """Account ids the user may see. None means unrestricted (owner/admin)."""
    if role in UNRESTRICTED_ROLES:
        return None
    result = await session.execute(
        select(ChannelAccount).where(ChannelAccount.tenant_id == tenant_id)
    )
    return {
        account.id
        for account in result.scalars().all()
        if is_account_visible_to(account, user_id=user_id, role=role)
    }


def set_account_visibility(account: ChannelAccount, *, mode: str, user_ids: list[str]) -> None:
    """Write visibility into settings_json (caller commits)."""
    if mode not in VISIBILITY_MODES:
        raise ValueError(f"Invalid visibility mode: {mode}")
    try:
        settings = json.loads(account.settings_json or "{}")
    except json.JSONDecodeError:
        settings = {}
    if mode == "everyone":
        settings.pop("visibility", None)
    else:
        settings["visibility"] = {"mode": mode, "user_ids": [str(u) for u in user_ids if u]}
    account.settings_json = json.dumps(settings)
