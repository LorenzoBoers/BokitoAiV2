# Local database (FastAPI)

## Fresh schema

```bash
cd apps/api
# Stop the API if dev.db is locked, then:
Remove-Item dev.db -ErrorAction SilentlyContinue
uv run python scripts/seed.py
```

Or apply Alembic and seed:

```bash
uv run alembic upgrade head
uv run python scripts/seed.py
```

## Stale schema symptoms

HTTP **503** with `schema_out_of_date`, or **500** on `/api/workforce/agents`, `/api/workforce/work_logs`, `/api/workforce/workspace/doc` often means `dev.db` was created before new tables/columns existed. `create_all` does not alter existing SQLite files.

## Tests

Pytest uses an in-memory database per run; they do not use `dev.db`.
