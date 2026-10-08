"""File board tickets for existing queue items that have matching action tags.

Run inside the API container after deploy:
  python scripts/ops/backfill_queue_board_tickets.py [--tenant-slug bokito] [--dry-run]
"""
from __future__ import annotations

import argparse
import asyncio
import json
from uuid import UUID

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.auth import Tenant
from app.models.orchestration import AgentTask
from app.services.project_work import _file_board_ticket_for_queue_item


async def main(tenant_slug: str, dry_run: bool) -> int:
    async with async_session_factory() as session:
        tenant = (
            await session.execute(select(Tenant).where(Tenant.slug == tenant_slug))
        ).scalar_one_or_none()
        if tenant is None:
            print("TENANT_NOT_FOUND", tenant_slug)
            return 2
        items = (
            await session.execute(
                select(AgentTask).where(
                    AgentTask.tenant_id == tenant.id,
                    AgentTask.deleted_at.is_(None),
                    AgentTask.kind.in_(("bug", "feature")),
                    AgentTask.project_id.is_not(None),
                )
            )
        ).scalars().all()
        filed = 0
        for item in items:
            try:
                meta = json.loads(item.metadata_json or "{}")
            except json.JSONDecodeError:
                meta = {}
            if isinstance(meta, dict) and meta.get("ticket_signal_id"):
                print("SKIP_HAS_TICKET", item.id, item.title[:60])
                continue
            if dry_run:
                print("WOULD_FILE", item.id, item.kind, item.title[:60])
                continue
            ticket_id = await _file_board_ticket_for_queue_item(
                session,
                tenant.id,
                project_id=item.project_id,
                kind=item.kind,
                title=item.title,
                body=item.description or "",
                created_by_type=item.created_by_type or "system",
                created_by_id=item.created_by_id or "",
                origin_signal_id=item.signal_id,
            )
            if ticket_id is None:
                print("NO_TAG", item.id, item.kind, item.title[:60])
                continue
            if not isinstance(meta, dict):
                meta = {}
            meta["ticket_signal_id"] = str(ticket_id)
            item.metadata_json = json.dumps(meta)
            item.status = "queued"
            session.add(item)
            await session.commit()
            filed += 1
            print("FILED", item.id, "->", ticket_id, item.title[:60])
        print("DONE filed=", filed, "scanned=", len(items))
    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--tenant-slug", default="bokito")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    raise SystemExit(asyncio.run(main(args.tenant_slug, args.dry_run)))
