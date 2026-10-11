"""Print email channel send readiness (dev probe)."""
from __future__ import annotations

from app.db import SessionLocal
from app.models.channel import ChannelAccount
from app.services.channel_registry import account_can_send, can_send, resolve_channel
from sqlalchemy import select


def main() -> None:
    with SessionLocal() as s:
        rows = s.execute(select(ChannelAccount).where(ChannelAccount.channel == "email")).scalars().all()
        for a in rows:
            r = resolve_channel(a)
            print(
                f"{a.display_name or a.address}"
                f" | state={r.get('state')}"
                f" | caps={r.get('capabilities')}"
                f" | can_send={can_send(r)}"
                f" | account_can_send={account_can_send(a)}"
                f" | enabled={a.is_enabled}"
            )


if __name__ == "__main__":
    main()
