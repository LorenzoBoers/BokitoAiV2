"""Pause then resume SMTP channel via is_enabled (U68)."""
import asyncio
from uuid import UUID

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.channel import ChannelAccount
from app.services.email_sync import clear_sync_pause

CHANNEL_ID = UUID("a36a6c30-c643-43ce-bfa9-76f6f2a5d768")


async def main() -> None:
    async with async_session_factory() as s:
        row = (
            await s.execute(select(ChannelAccount).where(ChannelAccount.id == CHANNEL_ID))
        ).scalar_one()
        print("before is_enabled=", row.is_enabled)
        row.is_enabled = False
        s.add(row)
        await s.commit()
        await s.refresh(row)
        print("paused is_enabled=", row.is_enabled)
        row.is_enabled = True
        # Mirror patch_channel resume cleanup
        try:
            import json

            settings = json.loads(row.settings_json or "{}")
            if isinstance(settings, dict):
                clear_sync_pause(settings)
                row.settings_json = json.dumps(settings)
        except Exception:
            pass
        s.add(row)
        await s.commit()
        await s.refresh(row)
        print("resumed is_enabled=", row.is_enabled)
        print("U68_OK")


if __name__ == "__main__":
    asyncio.run(main())
