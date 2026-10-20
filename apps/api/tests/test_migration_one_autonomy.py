"""Migration 124: stricter label or flow autonomy becomes Always review on the flow."""

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_PATH = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "124_one_autonomy.py"


def _migration():
    spec = importlib.util.spec_from_file_location("m124_one_autonomy", _PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _schema(conn) -> None:
    conn.execute(sa.text(
        "CREATE TABLE workstreams (id INTEGER PRIMARY KEY, name TEXT, "
        "autonomy_level TEXT NOT NULL DEFAULT '', always_review BOOLEAN NOT NULL DEFAULT 0)"
    ))
    conn.execute(sa.text(
        "CREATE TABLE signal_tags (id INTEGER PRIMARY KEY, name TEXT, workstream_id INTEGER, "
        "send_mode TEXT NOT NULL DEFAULT 'send', autonomy_level TEXT NOT NULL DEFAULT '')"
    ))
    conn.execute(sa.text("CREATE TABLE contacts (id INTEGER PRIMARY KEY, ai_handling TEXT)"))
    conn.execute(sa.text(
        "INSERT INTO workstreams (id, name, autonomy_level) VALUES "
        "(1, 'own manual', 'manual'), (2, 'label drafts', ''), (3, 'free', 'autonomous')"
    ))
    conn.execute(sa.text(
        "INSERT INTO signal_tags (id, name, workstream_id, send_mode, autonomy_level) VALUES "
        "(10, 'klacht', 2, 'draft', ''), (11, 'vrij', 3, 'send', ''), (12, 'los', NULL, 'ask', '')"
    ))
    conn.execute(sa.text("INSERT INTO contacts (id, ai_handling) VALUES (1, 'manual')"))


def test_stricter_scopes_become_always_review_and_columns_drop(capsys):
    engine = sa.create_engine("sqlite://")
    migration = _migration()
    with engine.begin() as conn:
        _schema(conn)
        ops = Operations(MigrationContext.configure(conn))
        migration.op = ops
        migration.upgrade()

        rows = dict(conn.execute(sa.text("SELECT id, always_review FROM workstreams")).all())
        assert rows == {1: 1, 2: 1, 3: 0}

        inspector = sa.inspect(conn)
        assert "autonomy_level" not in {c["name"] for c in inspector.get_columns("workstreams")}
        tag_cols = {c["name"] for c in inspector.get_columns("signal_tags")}
        assert not {"send_mode", "autonomy_level"} & tag_cols
        assert "ai_handling" not in {c["name"] for c in inspector.get_columns("contacts")}

    assert "lose their autonomy setting: 1" in capsys.readouterr().out


def test_downgrade_restores_dropped_values():
    engine = sa.create_engine("sqlite://")
    migration = _migration()
    with engine.begin() as conn:
        _schema(conn)
        migration.op = Operations(MigrationContext.configure(conn))
        migration.upgrade()
        kept = conn.execute(sa.text("SELECT count(*) FROM schema_value_backups")).scalar()
        assert kept == 7  # 3 send_mode/autonomy on tags and flows, 1 contact, 2 always_review, 1 flow level
        migration.downgrade()

        flows = {r[0]: (r[1], r[2]) for r in conn.execute(sa.text("SELECT id, autonomy_level, always_review FROM workstreams"))}
        assert flows == {1: ("manual", 0), 2: ("", 0), 3: ("autonomous", 0)}
        tags = {r[0]: r[1] for r in conn.execute(sa.text("SELECT id, send_mode FROM signal_tags"))}
        assert tags == {10: "draft", 11: "send", 12: "ask"}
        assert conn.execute(sa.text("SELECT ai_handling FROM contacts WHERE id = 1")).scalar() == "manual"
        assert conn.execute(sa.text("SELECT count(*) FROM schema_value_backups")).scalar() == 0
