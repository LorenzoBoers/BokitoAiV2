"""One-shot data migration: thread tags (intent) -> Case / CaseType.

CaseTypes are the single intent catalog; the Communication tag rail and
TagPicker were removed. This script converts existing tag usage:

1. Maps each used/registered tag to a CaseType:
   - `billing` prefers an existing `billing_inquiry` type (accounting module);
   - otherwise an existing type with a matching slug/name is reused;
   - otherwise a new `manual_only` type is created from the tag name and its
     registry description.
2. For every signal carrying the tag without a case of that type, creates a
   Case (`open` when the thread is open, else `closed`),
   `created_by_type="migration"`.
3. Skips workflow-flavored names (vip, urgent, ...) — those are thread
   filters, not intent. They are printed as a review list instead.

`Signal.tags_json` is left in place for read-compat; triage no longer writes
to it. Idempotent: re-running never duplicates types or cases.

Run: python scripts/dev/migrate_tags_to_cases.py [--dry-run]
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sqlalchemy import select  # noqa: E402

from app.db.session import async_session_factory, init_db  # noqa: E402
from app.models.auth import Tenant  # noqa: E402
from app.models.case import Case, CaseType  # noqa: E402
from app.models.signal import Signal, SignalTag  # noqa: E402
from app.services.cases import slugify  # noqa: E402

# Workflow-ish tag names that must not become intake types (thread filters
# like pin/priority cover these). Matched on the normalized tag name.
DENYLIST = {
    "vip",
    "urgent",
    "urgentie",
    "priority",
    "prioriteit",
    "high",
    "hoog",
    "belangrijk",
    "important",
    "follow up",
    "follow-up",
    "followup",
    "opvolgen",
    "todo",
    "to do",
    "later",
    "intern",
    "internal",
    "test",
}


def _parse_tags(tags_json: str | None) -> list[str]:
    try:
        tags = json.loads(tags_json or "[]")
    except (TypeError, json.JSONDecodeError):
        return []
    return [t.strip().lower() for t in tags if isinstance(t, str) and t.strip()]


async def _map_tag_to_type(
    session, tenant_id, tag: str, description: str, *, dry_run: bool
) -> CaseType | None:
    """Find or create the CaseType for one tag. Returns None on dry-run create."""
    types = (
        (await session.execute(select(CaseType).where(CaseType.tenant_id == tenant_id)))
        .scalars()
        .all()
    )
    if tag == "billing":
        # Installed module templates carry template_slug="billing_inquiry";
        # stored slugs are always slugified ("billing-inquiry").
        for row in types:
            if row.template_slug == "billing_inquiry" or row.slug == "billing-inquiry":
                return row
    slug = slugify(tag)
    for row in types:
        if row.slug == slug or row.name.strip().lower() == tag:
            return row
    if dry_run:
        print(f"  [dry-run] would create type '{tag}' (slug {slug})")
        return None
    row = CaseType(
        tenant_id=tenant_id,
        slug=slug,
        name=tag.capitalize(),
        description=description or f"Migrated from the '{tag}' tag.",
        create_mode="manual_only",
        audience="both",
        sort_order=1000,
    )
    session.add(row)
    await session.flush()
    return row


async def migrate_tenant(session, tenant: Tenant, *, dry_run: bool) -> None:
    registry = {
        row.name: (row.description or "").strip()
        for row in (
            await session.execute(select(SignalTag).where(SignalTag.tenant_id == tenant.id))
        ).scalars()
    }
    signals = (
        (
            await session.execute(
                select(Signal).where(
                    Signal.tenant_id == tenant.id,
                    Signal.tags_json.isnot(None),
                    Signal.tags_json != "[]",
                )
            )
        )
        .scalars()
        .all()
    )
    by_tag: dict[str, list[Signal]] = {}
    for signal in signals:
        for tag in _parse_tags(signal.tags_json):
            by_tag.setdefault(tag, []).append(signal)
    all_tags = sorted(set(by_tag) | set(registry))
    if not all_tags:
        return

    print(f"tenant {tenant.slug}: {len(all_tags)} tag(s), {len(signals)} tagged thread(s)")
    review: list[str] = []
    created_cases = 0
    for tag in all_tags:
        if tag in DENYLIST:
            review.append(tag)
            continue
        case_type = await _map_tag_to_type(
            session, tenant.id, tag, registry.get(tag, ""), dry_run=dry_run
        )
        if case_type is None:
            continue
        existing_signal_ids = set(
            (
                await session.execute(
                    select(Case.signal_id).where(
                        Case.tenant_id == tenant.id,
                        Case.case_type_id == case_type.id,
                    )
                )
            ).scalars()
        )
        for signal in by_tag.get(tag, []):
            if signal.id in existing_signal_ids:
                continue
            status = "closed" if signal.status in ("closed", "spam", "archived") else "open"
            if dry_run:
                created_cases += 1
                continue
            session.add(
                Case(
                    tenant_id=tenant.id,
                    case_type_id=case_type.id,
                    signal_id=signal.id,
                    contact_id=signal.contact_id,
                    project_id=signal.project_id,
                    title=case_type.name,
                    summary=(signal.summary or "").strip()[:500],
                    status=status,
                    create_mode_used="manual_only",
                    created_by_type="migration",
                    created_by_id="migrate_tags_to_cases",
                )
            )
            existing_signal_ids.add(signal.id)
            created_cases += 1
    if not dry_run:
        await session.commit()
    print(
        f"  {'would create' if dry_run else 'created'} {created_cases} case(s); "
        f"skipped for review: {', '.join(review) if review else 'none'}"
    )


async def main() -> None:
    dry_run = "--dry-run" in sys.argv
    await init_db()
    async with async_session_factory() as session:
        tenants = (await session.execute(select(Tenant))).scalars().all()
        for tenant in tenants:
            await migrate_tenant(session, tenant, dry_run=dry_run)
    print("done")


if __name__ == "__main__":
    asyncio.run(main())
