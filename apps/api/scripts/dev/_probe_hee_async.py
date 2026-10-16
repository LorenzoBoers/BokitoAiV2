import asyncio, os, json
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

TID = "aaf94197-fd12-4a18-8520-d1861254573e"

async def main():
    e = create_async_engine(os.environ["DATABASE_URL"])
    async with e.connect() as c:
        r = (await c.execute(text("select active_turn_json, left(coalesce(handoff_session_json, ''), 500) from signals where id=:id"), {"id": TID})).first()
        print("active_turn=", r[0])
        print("handoff=", r[1])
        msgs = (await c.execute(text("select kind, created_at::text, left(coalesce(body_text, ''), 100), payload_json from signal_messages where signal_id=:id order by created_at desc limit 8"), {"id": TID})).all()
        for m in msgs:
            p = json.loads(m[3] or "{}")
            print(m[0], m[1], repr(m[2]), "agent=", p.get("agent_id"), "ip=", p.get("in_progress"))
    await e.dispose()

asyncio.run(main())
