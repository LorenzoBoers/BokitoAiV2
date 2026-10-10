"""Per-site website chat: appearance and livechat options on ChannelAccount."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.channels.base import account_settings
from app.dependencies import tenant_settings
from app.models.auth import Tenant
from app.models.channel import ChannelAccount

_MIGRATED = "widget_settings_migrated"


def _loads(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
    except json.JSONDecodeError:
        data = {}
    return data if isinstance(data, dict) else {}


def save_account_settings(account: ChannelAccount, settings: dict[str, Any]) -> None:
    account.settings_json = json.dumps(settings)


def tenant_widget_blobs(tenant: Tenant) -> tuple[dict[str, Any], dict[str, Any]]:
    data = tenant_settings(tenant)
    appearance = data.get("appearance")
    if not isinstance(appearance, dict):
        appearance = {}
    livechat = data.get("livechat_settings")
    if not isinstance(livechat, dict):
        livechat = {}
    nested = livechat.get("appearance")
    if isinstance(nested, dict) and nested:
        merged = {**appearance, **nested}
    else:
        merged = dict(appearance)
    return merged, livechat


def merge_widget_settings_from_tenant(tenant: Tenant, account: ChannelAccount) -> bool:
    """Copy tenant appearance + livechat onto the seeded widget once."""
    settings = account_settings(account)
    appearance = settings.get("appearance")
    livechat = settings.get("livechat_settings")
    has_appearance = isinstance(appearance, dict) and bool(appearance)
    has_live = isinstance(livechat, dict) and bool(livechat)
    if settings.get(_MIGRATED) and has_appearance:
        return False
    tenant_appearance, tenant_live = tenant_widget_blobs(tenant)
    if not has_appearance and tenant_appearance:
        settings["appearance"] = tenant_appearance
    if not has_live:
        copied = {k: v for k, v in tenant_live.items() if k != "appearance"}
        if copied:
            settings["livechat_settings"] = copied
    settings[_MIGRATED] = True
    save_account_settings(account, settings)
    return True


async def count_widget_channels(session: AsyncSession, tenant_id: UUID) -> int:
    result = await session.execute(
        select(func.count())
        .select_from(ChannelAccount)
        .where(
            ChannelAccount.tenant_id == tenant_id,
            ChannelAccount.channel == "widget",
            ChannelAccount.archived_at.is_(None),
        )
    )
    return int(result.scalar_one() or 0)


async def get_widget_account(
    session: AsyncSession, tenant_id: UUID, account_id: UUID | None
) -> ChannelAccount | None:
    if account_id is None:
        return (
            await session.execute(
                select(ChannelAccount)
                .where(
                    ChannelAccount.tenant_id == tenant_id,
                    ChannelAccount.channel == "widget",
                )
                .order_by(ChannelAccount.created_at)
            )
        ).scalars().first()
    account = await session.get(ChannelAccount, account_id)
    if (
        account is None
        or account.tenant_id != tenant_id
        or account.channel != "widget"
    ):
        return None
    return account


def appearance_from_account(account: ChannelAccount | None) -> dict[str, Any]:
    if account is None:
        return {}
    settings = account_settings(account)
    appearance = settings.get("appearance")
    return appearance if isinstance(appearance, dict) else {}


def livechat_from_account(account: ChannelAccount | None) -> dict[str, Any]:
    if account is None:
        return {}
    settings = account_settings(account)
    livechat = settings.get("livechat_settings")
    return livechat if isinstance(livechat, dict) else {}


def widget_settings_from_account(tenant: Tenant, account: ChannelAccount | None) -> dict[str, Any]:
    livechat = livechat_from_account(account)
    if not livechat:
        from app.services.livechat_compat import widget_settings_from_tenant

        return widget_settings_from_tenant(tenant)
    return {
        "pre_chat_form": bool(livechat.get("pre_chat_form", True)),
        "offline_message": str(livechat.get("offline_message") or "").strip(),
    }


def handover_from_account(tenant: Tenant | None, account: ChannelAccount | None) -> dict[str, Any]:
    from app.services.whatsapp_handover import digits

    livechat = livechat_from_account(account)
    raw = livechat.get("whatsapp_handover") if livechat else None
    if not isinstance(raw, dict):
        tenant_live = tenant_settings(tenant).get("livechat_settings") if tenant else None
        raw = tenant_live.get("whatsapp_handover") if isinstance(tenant_live, dict) else None
    raw = raw if isinstance(raw, dict) else {}
    return {
        "enabled": bool(raw.get("enabled")),
        "account_id": str(raw.get("account_id") or ""),
        "number": digits(raw.get("number")),
    }


async def create_extra_widget_channel(
    session: AsyncSession,
    tenant: Tenant,
    *,
    label: str = "",
) -> ChannelAccount:
    # Re-enable an unused auto-seeded row instead of stacking a second site.
    seeded = (
        await session.execute(
            select(ChannelAccount)
            .where(
                ChannelAccount.tenant_id == tenant.id,
                ChannelAccount.channel == "widget",
                ChannelAccount.address == tenant.slug,
                ChannelAccount.archived_at.is_(None),
            )
            .order_by(ChannelAccount.created_at)
        )
    ).scalars().first()
    if seeded is not None and not seeded.is_enabled:
        name = (label or "").strip() or seeded.display_name or "Website chat"
        seeded.is_enabled = True
        seeded.display_name = name
        session.add(seeded)
        await session.flush()
        return seeded

    count = await count_widget_channels(session, tenant.id)
    name = (label or "").strip() or (
        "Website chat" if count == 0 else f"Website chat {count + 1}"
    )
    tenant_appearance, _live = tenant_widget_blobs(tenant)
    appearance = {}
    color = str(tenant_appearance.get("main_color") or "").strip()
    if color:
        appearance["main_color"] = color
    account = ChannelAccount(
        tenant_id=tenant.id,
        channel="widget",
        provider="widget",
        address=f"{tenant.slug}:{uuid4().hex[:10]}",
        display_name=name,
        is_enabled=True,
        settings_json=json.dumps(
            {
                "ai_config": {"ai_handling": {"mode": "autonomous"}},
                "label": name,
                "appearance": appearance,
                "livechat_settings": {},
                _MIGRATED: True,
            }
        ),
    )
    session.add(account)
    await session.flush()
    return account


def apply_widget_appearance(account: ChannelAccount, appearance: dict[str, Any]) -> None:
    settings = account_settings(account)
    current = settings.get("appearance")
    current = current if isinstance(current, dict) else {}
    for key, value in appearance.items():
        if value is not None:
            current[str(key)] = value
    settings["appearance"] = current
    save_account_settings(account, settings)


def apply_widget_livechat(account: ChannelAccount, patch: dict[str, Any]) -> None:
    settings = account_settings(account)
    livechat = settings.get("livechat_settings")
    livechat = livechat if isinstance(livechat, dict) else {}
    livechat.update(patch)
    settings["livechat_settings"] = livechat
    save_account_settings(account, settings)


def set_widget_favicon(account: ChannelAccount, data_url: str) -> None:
    apply_widget_appearance(
        account,
        {"widget_favicon": {"url": data_url, "path": data_url}, "widget_favicon_url": data_url},
    )


async def widget_payload(
    session: AsyncSession, tenant: Tenant, account: ChannelAccount
) -> dict[str, Any]:
    from app.services.livechat_compat import team_is_reachable
    from app.services.whatsapp_handover import account_number, handover_target
    from app.models.channel import ChannelAccount as AccountModel

    cfg = handover_from_account(tenant, account)
    wa = None
    if cfg["account_id"]:
        try:
            wa = await session.get(AccountModel, UUID(cfg["account_id"]))
        except ValueError:
            wa = None
    ready_account, _ = await handover_target(session, tenant, widget_account=account)
    appearance = appearance_from_account(account)
    if not appearance:
        appearance, _ = tenant_widget_blobs(tenant)
    live = widget_settings_from_account(tenant, account)
    return {
        "appearance": appearance,
        "pre_chat_form": live["pre_chat_form"],
        "offline_message": live["offline_message"],
        "team_available": await team_is_reachable(
            session, tenant, account=account
        ),
        "whatsapp_handover": {
            **cfg,
            "number_known": bool(account_number(wa)),
            "ready": ready_account is not None,
        },
    }
