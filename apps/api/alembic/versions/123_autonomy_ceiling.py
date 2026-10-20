"""Store the workspace ceiling on its own and retire contact handling.

Revision ID: 123_autonomy_ceiling
Revises: 122_boekhouder_name

Copies today's messaging-derived ceiling into settings_json.ai_handling.ceiling
so a later change to the messaging tool allowance does not move the inbox cap.
Flows whose autonomy_level is manual start with always_review. Contact
overrides are cleared; the count is printed for the operator log.
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

revision = "123_autonomy_ceiling"
down_revision = "122_boekhouder_name"
branch_labels = None
depends_on = None


def _ceiling_from_settings(raw: str | None) -> str:
    try:
        data = json.loads(raw or "{}")
    except (json.JSONDecodeError, TypeError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    block = data.get("ai_handling") if isinstance(data.get("ai_handling"), dict) else {}
    if block.get("ceiling") in ("autonomous", "assisted", "manual"):
        return ""
    allowances = data.get("tool_allowances") if isinstance(data.get("tool_allowances"), dict) else {}
    posture = data.get("autonomy_posture") or "assisted"
    # Same merge the resolver used: posture defaults, then an explicit override.
    # Assisted's default messaging allowance is allow, so the copied ceiling is
    # autonomous until an operator lowers it.
    defaults = {"manual": "ask", "assisted": "allow", "autonomous": "allow"}
    messaging = allowances.get("messaging") or defaults.get(posture, "allow")
    if messaging == "deny":
        ceiling = "manual"
    elif messaging == "ask":
        ceiling = "assisted"
    else:
        ceiling = "autonomous"
    block["ceiling"] = ceiling
    data["ai_handling"] = block
    return json.dumps(data)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "workstreams" in tables:
        columns = {column["name"] for column in inspector.get_columns("workstreams")}
        if "always_review" not in columns:
            op.add_column(
                "workstreams",
                sa.Column("always_review", sa.Boolean(), nullable=False, server_default=sa.false()),
            )
        bind.execute(sa.text("UPDATE workstreams SET always_review = true WHERE autonomy_level = 'manual'"))
    if "contacts" in tables and "ai_handling" in {c["name"] for c in inspector.get_columns("contacts")}:
        count = bind.execute(sa.text("SELECT count(*) FROM contacts WHERE ai_handling IS NOT NULL")).scalar()
        print(f"cleared contact ai_handling rows: {count}")
        bind.execute(sa.text("UPDATE contacts SET ai_handling = NULL WHERE ai_handling IS NOT NULL"))
    if "tenants" in tables:
        rows = bind.execute(sa.text("SELECT id, settings_json FROM tenants")).fetchall()
        for tenant_id, raw in rows:
            updated = _ceiling_from_settings(raw)
            if not updated:
                continue
            bind.execute(
                sa.text("UPDATE tenants SET settings_json = :settings WHERE id = :id"),
                {"settings": updated, "id": tenant_id},
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "workstreams" in inspector.get_table_names():
        columns = {column["name"] for column in inspector.get_columns("workstreams")}
        if "always_review" in columns:
            op.drop_column("workstreams", "always_review")
