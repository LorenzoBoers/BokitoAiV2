"""One-off: attach showcase image items onto a message that lost them."""

from __future__ import annotations

import asyncio
import json
import sys

from sqlalchemy import text

from app.db.session import async_session_factory
from app.services.web_search import brave_search, _url_field

SIGNAL = "e8105925-445f-4db4-82af-b5245bd0886c"
BODY_PREFIX = "Hier zijn drie fotos%"


def _clean_url(value: object) -> str:
    text = _url_field(value)
    if text.startswith("http://") or text.startswith("https://"):
        return text
    # Salvage urls accidentally stringified from Brave nested objects.
    if "'src': '" in text:
        try:
            start = text.index("'src': '") + len("'src': '")
            end = text.index("'", start)
            candidate = text[start:end]
            if candidate.startswith("http"):
                return candidate
        except ValueError:
            pass
    return ""


async def main() -> None:
    data = await brave_search("straaljager", count=3, kind="images")
    rows = data.get("results") or []
    print("search", data.get("error"), "count", len(rows))
    items: list[dict] = []
    for row in rows[:3]:
        url = _clean_url(row.get("image_url")) or _clean_url(row.get("url"))
        if not url:
            continue
        page = _clean_url(row.get("url")) or url
        items.append(
            {
                "type": "image",
                "id": url,
                "title": (row.get("title") or "Straaljager")[:80],
                "subtitle": (row.get("host") or "")[:80],
                "url": page,
                "image_url": url,
            }
        )
    print("items", len(items))
    if not items:
        raise SystemExit("no images")
    async with async_session_factory() as s:
        r = await s.execute(
            text(
                """
          select id::text, metadata_json from signal_messages
          where signal_id = :sid and body_text like :body
        """
            ),
            {"sid": SIGNAL, "body": BODY_PREFIX},
        )
        row = r.first()
        if not row:
            raise SystemExit("message not found")
        mid, meta_raw = row[0], row[1]
        meta = json.loads(meta_raw or "{}")
        meta["items"] = items
        for key in ("activity", "activity_after"):
            for entry in meta.get(key) or []:
                if isinstance(entry, dict) and entry.get("tool") == "attach_items":
                    entry["result"] = {
                        "ok": True,
                        "attached": len(items),
                        "items": items,
                    }
        await s.execute(
            text("update signal_messages set metadata_json = :meta where id = :id"),
            {"meta": json.dumps(meta, default=str), "id": mid},
        )
        await s.commit()
        print("patched", mid, "items", len(items))
        for i, it in enumerate(items):
            print(i, it["title"], it["image_url"][:90])


if __name__ == "__main__":
    asyncio.run(main())
    sys.exit(0)
