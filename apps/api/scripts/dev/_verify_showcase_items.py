import asyncio
import json

from sqlalchemy import text

from app.db.session import async_session_factory
from app.services.web_search import brave_search


async def main() -> None:
    data = await brave_search("straaljager", count=1, kind="images")
    print("search image_url", data["results"][0]["image_url"][:120])
    async with async_session_factory() as s:
        r = await s.execute(
            text(
                "select metadata_json from signal_messages "
                "where id = '35c848a3-65eb-4422-9767-cc83cd478d92'"
            )
        )
        meta = json.loads(r.scalar() or "{}")
        items = meta.get("items") or []
        print("db items", len(items))
        for it in items:
            print(it["type"], (it.get("image_url") or "")[:100])


if __name__ == "__main__":
    asyncio.run(main())
