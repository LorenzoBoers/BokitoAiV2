"""Migration 158: the contact's awareness block moves to its department; a set block stays."""

import importlib.util
import json
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_PATH = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "158_department_awareness.py"


def _run(conn, fn: str) -> None:
    spec = importlib.util.spec_from_file_location("m158_department_awareness", _PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    module.op = Operations(MigrationContext.configure(conn))
    getattr(module, fn)()


def test_contact_awareness_moves_to_the_department():
    engine = sa.create_engine("sqlite://")
    awareness = {"mode": "daily", "cron": "0 8 * * 1-5"}
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE agents (id TEXT PRIMARY KEY, settings_json TEXT)"))
        conn.execute(
            sa.text("CREATE TABLE departments (id TEXT PRIMARY KEY, settings_json TEXT, deleted_at TEXT, visibility TEXT)")
        )
        conn.execute(
            sa.text("CREATE TABLE department_members (department_id TEXT, member_kind TEXT, duty TEXT, agent_id TEXT)")
        )
        conn.execute(sa.text("INSERT INTO agents VALUES ('a1', :s)"), {"s": json.dumps({"awareness": awareness})})
        conn.execute(sa.text("INSERT INTO departments VALUES ('d1', '{}', NULL, 'open')"))
        conn.execute(
            sa.text("INSERT INTO departments VALUES ('d2', :s, NULL, 'open')"),
            {"s": json.dumps({"awareness": {"mode": "off"}})},
        )
        conn.execute(sa.text("INSERT INTO department_members VALUES ('d1', 'agent', 'primary', 'a1')"))
        conn.execute(sa.text("INSERT INTO department_members VALUES ('d2', 'agent', 'primary', 'a1')"))

        _run(conn, "upgrade")
        rows = dict(conn.execute(sa.text("SELECT id, settings_json FROM departments")).all())
        assert json.loads(rows["d1"])["awareness"] == awareness
        assert json.loads(rows["d2"])["awareness"] == {"mode": "off"}
        _run(conn, "downgrade")
