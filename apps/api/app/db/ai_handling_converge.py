"""Data mapping from the pre-AI-handling settings (Alembic 055 and SQLite dev).

- ``signals.ai_paused = true`` -> ``ai_handling = 'manual'`` (reason ``operator_takeover``).
- Tenant ``channel_ai_modes`` / built-in channel defaults and mailbox
  ``ai_config.mode`` / ``suggestions_enabled`` -> ``ai_config.ai_handling`` per
  account when they differ from the workspace default (assisted).
- ``inbox.certainty_threshold`` -> ``ai_handling.safeguards.certainty_threshold``;
  ``channel_ai_modes`` and ``inbox.autonomous_reply`` are removed.

Idempotent: a tenant that already has an ``ai_handling`` block is skipped.
"""

from __future__ import annotations

import json

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection

_LEGACY = {"auto": "autonomous", "suggest": "assisted", "off": "manual"}
_BUILTIN_CHANNEL_DEFAULTS = {"email": "suggest", "widget": "auto", "chat": "auto", "whatsapp": "suggest"}
_WORKSPACE_DEFAULT = "assisted"


def _obj(raw) -> dict:
    try:
        data = json.loads(raw or "{}")
    except (json.JSONDecodeError, TypeError):
        return {}
    return data if isinstance(data, dict) else {}


def map_pause_flags(connection: Connection) -> None:
    columns = {c["name"] for c in inspect(connection).get_columns("signals")}
    if "ai_paused" not in columns:
        return
    connection.execute(
        text(
            "UPDATE signals SET ai_handling = 'manual', ai_handling_reason = 'operator_takeover' "
            "WHERE ai_paused AND ai_handling IS NULL"
        )
    )


def map_settings(connection: Connection) -> None:
    tenants = connection.execute(text("SELECT id, settings_json FROM tenants")).mappings().all()
    for tenant in tenants:
        settings = _obj(tenant["settings_json"])
        if isinstance(settings.get("ai_handling"), dict):
            continue
        channel_modes = dict(_BUILTIN_CHANNEL_DEFAULTS)
        legacy = settings.get("channel_ai_modes")
        if isinstance(legacy, dict):
            channel_modes.update({k: v for k, v in legacy.items() if v in _LEGACY})
        inbox = settings.get("inbox") if isinstance(settings.get("inbox"), dict) else {}
        block: dict = {"default": {"mode": _WORKSPACE_DEFAULT}}
        if "certainty_threshold" in inbox:
            block["safeguards"] = {"certainty_threshold": inbox.get("certainty_threshold")}
        inbox.pop("autonomous_reply", None)
        inbox.pop("certainty_threshold", None)
        if inbox:
            settings["inbox"] = inbox
        else:
            settings.pop("inbox", None)
        settings.pop("channel_ai_modes", None)
        settings["ai_handling"] = block

        accounts = connection.execute(
            text("SELECT id, channel, settings_json FROM channel_accounts WHERE tenant_id = :tid"),
            {"tid": tenant["id"]},
        ).mappings().all()
        for account in accounts:
            acc_settings = _obj(account["settings_json"])
            cfg = acc_settings.get("ai_config") if isinstance(acc_settings.get("ai_config"), dict) else {}
            if "ai_handling" in cfg:
                continue
            mode = None
            if cfg.get("mode") in _LEGACY:
                mode = _LEGACY[cfg["mode"]]
            elif cfg.get("suggestions_enabled") is False:
                mode = "manual"
            elif account["channel"] in channel_modes:
                mode = _LEGACY[channel_modes[account["channel"]]]
            cfg.pop("mode", None)
            cfg.pop("suggestions_enabled", None)
            if mode and mode != _WORKSPACE_DEFAULT:
                cfg["ai_handling"] = {"mode": mode}
            acc_settings["ai_config"] = cfg
            connection.execute(
                text("UPDATE channel_accounts SET settings_json = :s WHERE id = :id"),
                {"s": json.dumps(acc_settings), "id": account["id"]},
            )
        connection.execute(
            text("UPDATE tenants SET settings_json = :s WHERE id = :id"),
            {"s": json.dumps(settings), "id": tenant["id"]},
        )


def converge_sqlite(connection: Connection) -> None:
    """SQLite dev databases skip Alembic: map then drop the old column."""
    map_pause_flags(connection)
    map_settings(connection)
    columns = {c["name"] for c in inspect(connection).get_columns("signals")}
    if "ai_paused" in columns:
        connection.execute(text("ALTER TABLE signals DROP COLUMN ai_paused"))
