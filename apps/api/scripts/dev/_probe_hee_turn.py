"""Probe active_turn / messages for the stuck 'hee' thread."""
from __future__ import annotations

import json
import os
import sys

from sqlalchemy import create_engine, text

TID = "aaf94197-fd12-4a18-8520-d1861254573e"


def main() -> None:
    raw = os.environ["DATABASE_URL"]
    # Prefer a sync driver; fall back through common URL shapes.
    candidates = [
        raw.replace("+asyncpg", "+psycopg"),
        raw.replace("+asyncpg", ""),
        raw.replace("postgresql+asyncpg", "postgresql+psycopg"),
    ]
    last_err: Exception | None = None
    for url in candidates:
        try:
            engine = create_engine(url)
            with engine.connect() as c:
                row = c.execute(
                    text(
                        "select active_turn_json, "
                        "left(coalesce(handoff_session_json, ''), 500) "
                        "from signals where id = :id"
                    ),
                    {"id": TID},
                ).first()
                if not row:
                    print("NOT FOUND")
                    sys.exit(1)
                print("active_turn=", row[0])
                print("handoff=", row[1])
                msgs = c.execute(
                    text(
                        """
                        select kind, created_at::text,
                               left(coalesce(body_text, ''), 100),
                               payload_json
                        from signal_messages where signal_id = :id
                        order by created_at desc limit 8
                        """
                    ),
                    {"id": TID},
                ).all()
                for m in msgs:
                    p = json.loads(m[3] or "{}")
                    print(
                        "MSG",
                        m[0],
                        m[1],
                        repr(m[2]),
                        "agent=",
                        p.get("agent_id"),
                        "in_progress=",
                        p.get("in_progress"),
                    )
            return
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            print("fail", type(exc).__name__, exc)
    if last_err:
        raise last_err


if __name__ == "__main__":
    main()
