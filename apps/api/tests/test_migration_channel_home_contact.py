"""Migration 159: a channel's own agent becomes the home node's contact when it has none."""

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_PATH = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "159_channel_home_contact.py"


def _run(conn, fn: str) -> None:
    spec = importlib.util.spec_from_file_location("m159_channel_home_contact", _PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    module.op = Operations(MigrationContext.configure(conn))
    getattr(module, fn)()


def test_channel_agent_becomes_the_home_contact():
    engine = sa.create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE agents (id TEXT PRIMARY KEY, is_active BOOLEAN)"))
        conn.execute(
            sa.text(
                "CREATE TABLE departments (id TEXT PRIMARY KEY, tenant_id TEXT, parent_id TEXT, name TEXT, deleted_at TEXT)"
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
                "CREATE TABLE channel_accounts (id TEXT PRIMARY KEY, tenant_id TEXT, default_agent_id TEXT, "
                "routing_department_id TEXT, created_at TEXT)"
            )
        )
        conn.execute(sa.text("INSERT INTO agents VALUES ('desk', 1), ('kim', 1), ('sam', 1)"))
        conn.execute(
            sa.text(
                "INSERT INTO departments VALUES ('root', 't', NULL, 'All', NULL), "
                "('support', 't', 'root', 'Support', NULL), ('sales', 't', 'root', 'Sales', NULL)"
            )
        )
        conn.execute(
            sa.text(
                "INSERT INTO department_members VALUES "
                "('m1', 't', 'sales', 'agent', 'sam', 'primary', 0, '', ''), "
                "('m2', 't', 'support', 'agent', 'kim', 'member', 0, '', '')"
            )
        )
        conn.execute(
            sa.text(
                "INSERT INTO channel_accounts VALUES "
                "('widget', 't', 'desk', NULL, '1'), ('mail', 't', 'kim', 'support', '2'), "
                "('shop', 't', 'kim', 'sales', '3')"
            )
        )

        _run(conn, "upgrade")
        seats = {
            (dept, agent): duty
            for dept, agent, duty in conn.execute(
                sa.text("SELECT department_id, agent_id, duty FROM department_members")
            ).all()
        }
        assert seats[("root", "desk")] == "primary"
        assert seats[("support", "kim")] == "primary"
        assert ("sales", "kim") not in seats and seats[("sales", "sam")] == "primary"
        columns = [row[1] for row in conn.execute(sa.text("PRAGMA table_info(channel_accounts)")).all()]
        assert "default_agent_id" not in columns
