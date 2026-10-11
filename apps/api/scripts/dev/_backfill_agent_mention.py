"""Rewrite the bold agent name in the showcase thread as a mention chip."""

from __future__ import annotations

import asyncio
import re

from sqlalchemy import text

from app.db.session import async_session_factory

SIGNAL = "e8105925-445f-4db4-82af-b5245bd0886c"
BODY_LIKE = "%Naast mij is er nog%"


async def main() -> None:
    async with async_session_factory() as s:
        agent = (
            await s.execute(
                text(
                    """
                    select a.id::text, a.name
                    from agents a
                    join signals sig on sig.tenant_id = a.tenant_id
                    where sig.id = :sid
                      and a.name ilike '%support%'
                    order by a.name
                    limit 1
                    """
                ),
                {"sid": SIGNAL},
            )
        ).first()
        if not agent:
            raise SystemExit("support agent not found")
        aid, name = agent[0], agent[1]
        mention = f"@[{name}](agent:{aid})"
        msg = (
            await s.execute(
                text(
                    """
                    select id::text, body_text from signal_messages
                    where signal_id = :sid and body_text like :body
                    order by created_at desc
                    limit 1
                    """
                ),
                {"sid": SIGNAL, "body": BODY_LIKE},
            )
        ).first()
        if not msg:
            raise SystemExit("message not found")
        mid, body = msg[0], msg[1] or ""
        # Replace **Name** or bare Name with mention (once).
        new_body = re.sub(
            rf"\*\*{re.escape(name)}\*\*|{re.escape(name)}",
            mention,
            body,
            count=1,
        )
        if new_body == body:
            raise SystemExit(f"no name to replace in: {body!r}")
        await s.execute(
            text(
                "update signal_messages set body_text = :body, body_preview = :preview where id = :id"
            ),
            {"body": new_body, "preview": new_body[:200], "id": mid},
        )
        await s.commit()
        print("patched", mid)
        print(new_body)


if __name__ == "__main__":
    asyncio.run(main())
