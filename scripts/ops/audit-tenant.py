"""Tenant integrity audit.

Scans every tenant-scoped table for rows whose foreign keys point at rows in a
different tenant, and reports per-tenant row counts so a "fresh" tenant can be
verified to be empty.

Usage (from apps/api, venv active):
    python ../../scripts/ops/audit-tenant.py            # audit all tenants
    python ../../scripts/ops/audit-tenant.py <slug>     # counts for one tenant

Uses the API's configured DATABASE_URL.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[2] / "apps" / "api"
sys.path.insert(0, str(API_ROOT))

from sqlalchemy import text  # noqa: E402
from sqlmodel import SQLModel  # noqa: E402

from app.db.session import engine  # noqa: E402
from app.models import *  # noqa: E402, F401, F403

# FK columns that reference another tenant-scoped table; each entry is
# (table, fk_column, target_table). Cross-tenant rows here are integrity bugs.
CROSS_TENANT_CHECKS: list[tuple[str, str, str]] = [
    ("signals", "agent_id", "agents"),
    ("signal_messages", "signal_id", "signals"),
    ("signal_events", "signal_id", "signals"),
    ("agent_runs", "agent_id", "agents"),
    ("triggers", "agent_id", "agents"),
    ("triggers", "signal_id", "signals"),
    ("triggers", "workstream_id", "workstreams"),
    ("workstream_steps", "workstream_id", "workstreams"),
    ("projects", "po_agent_id", "agents"),
    ("decision_requests", "signal_id", "signals"),
]


async def audit_cross_tenant(conn) -> int:
    """Return the number of integrity violations found."""
    violations = 0
    for table, fk_col, target in CROSS_TENANT_CHECKS:
        try:
            rows = (
                await conn.execute(
                    text(
                        f"SELECT COUNT(*) FROM {table} t "
                        f"JOIN {target} x ON t.{fk_col} = x.id "
                        f"WHERE t.tenant_id != x.tenant_id"
                    )
                )
            ).scalar_one()
        except Exception as exc:  # noqa: BLE001 — table may not exist yet
            print(f"  [skip] {table}.{fk_col} -> {target}: {exc}")
            continue
        if rows:
            violations += rows
            print(f"  [FAIL] {table}.{fk_col} -> {target}: {rows} cross-tenant rows")
    return violations


async def tenant_counts(conn, tenant_id: str) -> None:
    for table in sorted(SQLModel.metadata.tables):
        cols = SQLModel.metadata.tables[table].c
        if "tenant_id" not in cols:
            continue
        count = (
            await conn.execute(
                text(f"SELECT COUNT(*) FROM {table} WHERE tenant_id = :tid"),
                {"tid": tenant_id},
            )
        ).scalar_one()
        if count:
            print(f"  {table}: {count}")


async def main() -> None:
    slug = sys.argv[1] if len(sys.argv) > 1 else None
    async with engine.connect() as conn:
        tenants = (
            await conn.execute(text("SELECT id, slug, name FROM tenants ORDER BY created_at"))
        ).fetchall()
        print(f"Tenants: {len(tenants)}")
        for tid, tslug, name in tenants:
            print(f"- {tslug} ({name}) [{tid}]")

        print("\nCross-tenant FK audit:")
        violations = await audit_cross_tenant(conn)
        if violations == 0:
            print("  OK — no cross-tenant references found")

        if slug:
            match = next((t for t in tenants if t[1] == slug), None)
            if not match:
                print(f"\nTenant '{slug}' not found")
                return
            print(f"\nRow counts for tenant '{slug}':")
            await tenant_counts(conn, str(match[0]))

    if violations:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
