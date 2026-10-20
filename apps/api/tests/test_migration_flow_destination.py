"""Migration 127: flows get an empty "Delivers to"; the downgrade removes it."""

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_PATH = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "127_flow_destination.py"


def _migration():
    spec = importlib.util.spec_from_file_location("m127_flow_destination", _PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _run(conn, fn: str) -> None:
    module = _migration()
    ctx = MigrationContext.configure(conn)
    module.op = Operations(ctx)
    getattr(module, fn)()


def test_upgrade_adds_empty_destination_and_downgrade_drops_it():
    engine = sa.create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE projects (id TEXT PRIMARY KEY)"))
        conn.execute(sa.text("CREATE TABLE workstreams (id TEXT PRIMARY KEY, name TEXT)"))
        conn.execute(sa.text("INSERT INTO workstreams VALUES ('w1', 'VAT filing')"))

        _run(conn, "upgrade")
        row = conn.execute(sa.text("SELECT deliver_folder_id, deliver_works_in_key FROM workstreams")).one()
        assert row == (None, "")
        _run(conn, "upgrade")

        _run(conn, "downgrade")
        columns = {c["name"] for c in sa.inspect(conn).get_columns("workstreams")}
        assert columns == {"id", "name"}
