# Database migrations (Alembic)

As of revision `003_baseline` the Postgres schema is Alembic-managed. The
legacy `apps/api/app/db/schema_patch.py` is **frozen**: never add new ALTERs
or data repairs there.

## How it runs

- **Postgres (prod/staging/dev):** `init_db()` runs `alembic upgrade head`
  in-process at startup, serialized with a Postgres advisory lock so the api
  and worker containers can boot concurrently. No entrypoint change or manual
  step is needed.
- **SQLite (tests/local without Postgres):** `init_db()` keeps the historical
  `create_all` + frozen schema patches. Tests never touch Alembic.

## Prod cutover

No manual `alembic stamp` is required. The chain `001 -> 002 -> 003` is fully
idempotent against an existing database:

- `001_initial` is a no-op.
- `002_schema_sync` and `003_baseline` replay `create_all` (skips existing
  tables), the frozen column patches (only adds missing columns) and the
  idempotent data repairs.

First boot of a new image on the existing prod database therefore simply
records `003_baseline` in `alembic_version` and changes nothing else. Take a
backup before deploying anyway (see `BACKUP_RESTORE.md`).

## Adding a schema change

1. Change the SQLModel model(s) in `apps/api/app/models/`.
2. Create a new revision in `apps/api/alembic/versions/` with **explicit DDL**
   (`op.add_column`, `op.create_index`, ...). Do not use
   `SQLModel.metadata.create_all` in new revisions; that was only for the
   baseline. New *tables* may use `op.create_table` or a scoped
   `Model.__table__.create(bind)`.
3. Set `down_revision` to the current head and implement `downgrade()` where
   feasible.
4. Verify locally: `python -m alembic upgrade head` (twice — the second run
   must be a no-op), and run the test suite (SQLite path picks the column up
   via `create_all` on fresh test databases).

Keep revisions small and reversible. Data backfills belong in the revision
only when they are quick and idempotent; long backfills should be app-side
(batched) with the revision only adding the schema.
