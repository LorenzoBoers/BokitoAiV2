"""Migration 149 drops the flow destination columns 127 added."""

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, _DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _run(conn, module, fn: str) -> None:
    ctx = MigrationContext.configure(conn)
    module.op = Operations(ctx)
    getattr(module, fn)()


def test_upgrade_drops_destination_columns():
    engine = sa.create_engine("sqlite://")
    add = _load("m127_flow_destination", "127_flow_destination.py")
    drop = _load("m149_drop_flow_destination", "149_drop_flow_destination.py")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE projects (id TEXT PRIMARY KEY)"))
        conn.execute(sa.text("CREATE TABLE workstreams (id TEXT PRIMARY KEY, name TEXT)"))
        conn.execute(sa.text("INSERT INTO workstreams VALUES ('w1', 'VAT filing')"))
        _run(conn, add, "upgrade")
        _run(conn, drop, "upgrade")
        columns = {c["name"] for c in sa.inspect(conn).get_columns("workstreams")}
        assert columns == {"id", "name"}
        row = conn.execute(sa.text("SELECT id, name FROM workstreams")).one()
        assert row == ("w1", "VAT filing")
        _run(conn, drop, "upgrade")
