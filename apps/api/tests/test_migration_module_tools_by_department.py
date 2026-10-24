"""Migration 160: roster agents join the module department; the roster table goes."""

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_PATH = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "160_module_tools_by_department.py"


def _run(conn, fn: str) -> None:
    spec = importlib.util.spec_from_file_location("m160_module_tools_by_department", _PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    module.op = Operations(MigrationContext.configure(conn))
    getattr(module, fn)()


def test_roster_agents_join_the_module_department():
    engine = sa.create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE agents (id TEXT PRIMARY KEY, is_active BOOLEAN)"))
        conn.execute(
            sa.text(
                "CREATE TABLE departments (id TEXT PRIMARY KEY, tenant_id TEXT, origin_module_slug TEXT, deleted_at TEXT)"
            )
        )
        conn.execute(
            sa.text(
                "CREATE TABLE department_members (id TEXT PRIMARY KEY, tenant_id TEXT, department_id TEXT, "
                "member_kind TEXT, agent_id TEXT, duty TEXT, position INTEGER, focus TEXT, created_at TEXT)"
            )
        )
        conn.execute(
            sa.text(
                "CREATE TABLE module_agents (id TEXT PRIMARY KEY, tenant_id TEXT, module_slug TEXT, "
                "agent_id TEXT, created_at TEXT)"
            )
        )
        conn.execute(sa.text("INSERT INTO agents VALUES ('boekito', 1), ('helper', 1), ('gone', 0)"))
        conn.execute(sa.text("INSERT INTO departments VALUES ('acc', 't', 'accounting', NULL)"))
        conn.execute(
            sa.text("INSERT INTO department_members VALUES ('m1', 't', 'acc', 'agent', 'boekito', 'primary', 0, '', '')")
        )
        conn.execute(
            sa.text(
                "INSERT INTO module_agents VALUES ('r1', 't', 'accounting', 'boekito', '1'), "
                "('r2', 't', 'accounting', 'helper', '2'), ('r3', 't', 'accounting', 'gone', '3'), "
                "('r4', 't', 'banking', 'helper', '4')"
            )
        )

        _run(conn, "upgrade")
        seats = {
            (dept, agent): duty
            for dept, agent, duty in conn.execute(
                sa.text("SELECT department_id, agent_id, duty FROM department_members")
            ).all()
        }
        assert seats == {("acc", "boekito"): "primary", ("acc", "helper"): "member"}
        assert "module_agents" not in sa.inspect(conn).get_table_names()
