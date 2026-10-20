"""Migration 126: a general folder per workspace, orphan resources and workspace canvases move in."""

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_PATH = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "126_general_folder.py"


def _migration():
    spec = importlib.util.spec_from_file_location("m126_general_folder", _PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _schema(conn) -> None:
    conn.execute(sa.text("CREATE TABLE tenants (id TEXT PRIMARY KEY, settings_json TEXT)"))
    conn.execute(sa.text(
        "CREATE TABLE projects (id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT, slug TEXT, description TEXT, "
        "autonomous_scope TEXT, active_domains_json TEXT, parent_id TEXT, sort_order INTEGER, "
        "created_at TIMESTAMP, updated_at TIMESTAMP, deleted_at TIMESTAMP)"
    ))
    conn.execute(sa.text(
        "CREATE TABLE project_resources (id TEXT PRIMARY KEY, tenant_id TEXT, project_id TEXT)"
    ))
    conn.execute(sa.text(
        "CREATE TABLE project_canvases (id TEXT PRIMARY KEY, tenant_id TEXT, owner_kind TEXT, owner_id TEXT, "
        "project_id TEXT, slug TEXT, deleted_at TIMESTAMP)"
    ))
    conn.execute(sa.text(
        "INSERT INTO tenants VALUES ('t1', '{\"ui_language\": \"nl\"}'), ('t2', '{}')"
    ))
    conn.execute(sa.text(
        "INSERT INTO projects (id, tenant_id, name, slug, parent_id, created_at, updated_at) VALUES "
        "('p1', 't1', 'Klant A', 'klant-a', NULL, '2026-01-01', '2026-01-01'), "
        "('p2', 't2', 'General', 'general', NULL, '2026-01-01', '2026-01-01')"
    ))
    conn.execute(sa.text(
        "INSERT INTO project_resources VALUES ('r1', 't1', 'gone'), ('r2', 't1', 'p1')"
    ))
    conn.execute(sa.text(
        "INSERT INTO project_canvases VALUES "
        "('c1', 't1', 'tenant', 't1', NULL, 'main', NULL), "
        "('c2', 't2', 'tenant', 't2', NULL, 'main', NULL), "
        "('c3', 't2', 'project', 'p2', 'p2', 'main', NULL)"
    ))


def test_upgrade_creates_general_folder_and_moves_work_in():
    engine = sa.create_engine("sqlite://")
    migration = _migration()
    with engine.begin() as conn:
        _schema(conn)
        migration.op = Operations(MigrationContext.configure(conn))
        migration.upgrade()

        general_t1 = conn.execute(
            sa.text("SELECT id, name, slug FROM projects WHERE tenant_id = 't1' AND name = 'Algemeen'")
        ).one()
        assert general_t1.slug == "algemeen"
        assert conn.execute(sa.text("SELECT count(*) FROM projects WHERE tenant_id = 't2'")).scalar() == 1

        resources = dict(conn.execute(sa.text("SELECT id, project_id FROM project_resources")).all())
        assert resources == {"r1": general_t1.id, "r2": "p1"}

        canvases = {
            row.id: (row.owner_kind, row.owner_id, row.project_id, row.slug)
            for row in conn.execute(sa.text("SELECT * FROM project_canvases"))
        }
        assert canvases["c1"] == ("project", general_t1.id, general_t1.id, "main")
        assert canvases["c2"] == ("project", "p2", "p2", "main-workspace")
        assert canvases["c3"] == ("project", "p2", "p2", "main")


def test_downgrade_puts_canvases_back_and_bins_created_folder():
    engine = sa.create_engine("sqlite://")
    migration = _migration()
    with engine.begin() as conn:
        _schema(conn)
        migration.op = Operations(MigrationContext.configure(conn))
        migration.upgrade()
        migration.downgrade()

        canvases = {
            row.id: (row.owner_kind, row.owner_id, row.slug)
            for row in conn.execute(sa.text("SELECT * FROM project_canvases"))
        }
        assert canvases["c1"][0] == "tenant" and canvases["c1"][2] == "main"
        assert canvases["c2"][0] == "tenant" and canvases["c2"][2] == "main"
        binned = conn.execute(
            sa.text("SELECT deleted_at FROM projects WHERE tenant_id = 't1' AND name = 'Algemeen'")
        ).scalar()
        assert binned is not None
        assert conn.execute(sa.text("SELECT deleted_at FROM projects WHERE id = 'p2'")).scalar() is None
