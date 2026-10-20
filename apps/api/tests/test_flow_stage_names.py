"""Server-side stage titles follow the workspace language."""

import importlib.util
import json
from pathlib import Path

from app.services.tickets import insert_named_stage, stage_name_for_kind

_BASE = json.dumps(
    [
        {"key": "open", "name": "Open", "kind": "open"},
        {"key": "done", "name": "Done", "kind": "done"},
    ]
)
_M125 = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "125_stage_source.py"


def _normalize():
    spec = importlib.util.spec_from_file_location("m125_stage_source", _M125)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module.normalize_stages


def test_dutch_insert_names_the_stage():
    assert stage_name_for_kind([], "waiting", "nl") == "Wachtend"
    raw = insert_named_stage(_BASE, kind="waiting", index=1, language="nl")
    stages = json.loads(raw)
    assert stages[1]["name"] == "Wachtend"
    assert stages[1]["kind"] == "waiting"


def test_second_insert_gets_a_suffix():
    once = insert_named_stage(_BASE, kind="waiting", index=1, language="en")
    twice = insert_named_stage(once, kind="waiting", index=2, language="en")
    names = [stage["name"] for stage in json.loads(twice)]
    assert names.count("Waiting") == 1
    assert "Waiting 2" in names


def test_migration_renames_suffixed_alias_and_drops_empty_duplicate():
    normalize = _normalize()
    stages = [
        {"key": "open", "name": "Niet gestart", "kind": "open"},
        {"key": "waiting", "name": "Actief", "kind": "waiting"},
        {"key": "waiting-2", "name": "Active 2", "kind": "waiting"},
        {"key": "done", "name": "Klaar", "kind": "done"},
    ]
    out = normalize(stages, "nl", used_keys={"waiting"})
    assert [s["name"] for s in out] == ["Niet gestart", "Wachtend", "Klaar"]


def test_migration_names_a_done_stage_that_carries_a_waiting_name():
    normalize = _normalize()
    stages = [
        {"key": "not-started", "name": "Niet gestart", "kind": "open"},
        {"key": "waiting", "name": "Actief", "kind": "waiting"},
        {"key": "active-2", "name": "Active 2", "kind": "done"},
    ]
    out = normalize(stages, "nl", used_keys=set())
    assert [s["name"] for s in out] == ["Niet gestart", "Wachtend", "Klaar"]


def test_migration_keeps_a_duplicate_with_tickets_or_settings():
    normalize = _normalize()
    stages = [
        {"key": "a", "name": "Active", "kind": "waiting"},
        {"key": "b", "name": "Active 2", "kind": "waiting"},
        {"key": "c", "name": "Active 3", "kind": "waiting", "checkup_minutes": 60},
        {"key": "done", "name": "Done", "kind": "done"},
    ]
    out = normalize(stages, "en", used_keys={"b"})
    assert [(s["key"], s["name"]) for s in out] == [
        ("b", "Waiting"),
        ("c", "Waiting 3"),
        ("done", "Done"),
    ]


def test_migration_fills_empty_pipeline_with_named_defaults():
    normalize = _normalize()
    out = normalize([], "nl", used_keys=set())
    assert [(s["key"], s["name"]) for s in out] == [
        ("open", "Niet gestart"),
        ("waiting", "Wachtend"),
        ("done", "Klaar"),
    ]
    assert normalize([{"key": "x", "name": "Intake", "kind": "open"}], "en", set()) is None


def _module():
    spec = importlib.util.spec_from_file_location("m125_stage_source_full", _M125)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_migration_downgrade_restores_stage_tables_and_names():
    import sqlalchemy as sa
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    old = json.dumps([{"key": "waiting", "name": "Active 2", "kind": "waiting"}])
    engine = sa.create_engine("sqlite://")
    migration = _module()
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE tenants (id TEXT PRIMARY KEY, settings_json TEXT)"))
        conn.execute(sa.text("CREATE TABLE signal_tags (id TEXT PRIMARY KEY, workstream_id TEXT)"))
        conn.execute(sa.text("CREATE TABLE signals (id TEXT PRIMARY KEY, stage_key TEXT, ticket_tag_id TEXT)"))
        conn.execute(sa.text("CREATE TABLE workstreams (id TEXT PRIMARY KEY, tenant_id TEXT, stages_json TEXT)"))
        conn.execute(sa.text(
            "CREATE TABLE workstream_stages (id TEXT PRIMARY KEY, tenant_id TEXT, workstream_id TEXT, key TEXT, "
            "position INTEGER, name TEXT, kind TEXT, checkup_minutes INTEGER, created_at TIMESTAMP)"
        ))
        conn.execute(sa.text(
            "CREATE TABLE workstream_stage_owners (id TEXT PRIMARY KEY, tenant_id TEXT, stage_id TEXT, "
            "user_id TEXT, agent_id TEXT, department_id TEXT, created_at TIMESTAMP)"
        ))
        conn.execute(sa.text("INSERT INTO tenants VALUES ('t1', '{\"ui_language\": \"en\"}')"))
        conn.execute(sa.text("INSERT INTO workstreams VALUES ('w1', 't1', :raw)"), {"raw": old})
        conn.execute(sa.text(
            "INSERT INTO workstream_stages VALUES ('s1', 't1', 'w1', 'waiting', 0, 'Active 2', 'waiting', 0, "
            "'2026-10-01 10:00:00')"
        ))
        conn.execute(sa.text(
            "INSERT INTO workstream_stage_owners VALUES ('o1', 't1', 's1', NULL, 'a1', NULL, '2026-10-01 10:00:00')"
        ))

        migration.op = Operations(MigrationContext.configure(conn))
        migration.upgrade()
        renamed = json.loads(conn.execute(sa.text("SELECT stages_json FROM workstreams")).scalar())
        assert renamed[0]["name"] == "Waiting"
        assert "workstream_stages" not in sa.inspect(conn).get_table_names()

        migration.downgrade()
        assert conn.execute(sa.text("SELECT stages_json FROM workstreams")).scalar() == old
        assert conn.execute(sa.text("SELECT name FROM workstream_stages")).scalar() == "Active 2"
        assert conn.execute(sa.text("SELECT agent_id FROM workstream_stage_owners")).scalar() == "a1"
        assert conn.execute(sa.text("SELECT count(*) FROM schema_value_backups")).scalar() == 0
