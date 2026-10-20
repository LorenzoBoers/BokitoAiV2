"""Install Wave 1+2 schema files from /tmp/schema101_* into /opt/bokito-dev."""

from __future__ import annotations

from pathlib import Path

PAIRS = [
    ("001_apps_api_alembic_versions_101_drop_dead_schema.py", "apps/api/alembic/versions/101_drop_dead_schema.py"),
    ("002_apps_api_alembic_versions_102_drop_workstream_runs.py", "apps/api/alembic/versions/102_drop_workstream_runs.py"),
    ("003_apps_api_app_models___init__.py", "apps/api/app/models/__init__.py"),
    ("004_apps_api_app_models_agent.py", "apps/api/app/models/agent.py"),
    ("005_apps_api_app_models_channel.py", "apps/api/app/models/channel.py"),
    ("007_apps_api_app_models_orchestra.py", "apps/api/app/models/orchestra.py"),
    ("008_apps_api_app_models_orchestration.py", "apps/api/app/models/orchestration.py"),
    ("009_apps_api_app_models_os_graph.py", "apps/api/app/models/os_graph.py"),
    ("010_apps_api_app_models_outcome.py", "apps/api/app/models/outcome.py"),
    ("011_apps_api_app_models_usage.py", "apps/api/app/models/usage.py"),
    ("012_apps_api_app_db_sqlite_converge.py", "apps/api/app/db/sqlite_converge.py"),
    ("013_apps_api_app_services_os_graph.py", "apps/api/app/services/os_graph.py"),
    ("014_apps_api_app_services_outcomes.py", "apps/api/app/services/outcomes.py"),
    ("015_apps_api_app_services_channel_lifecycle.py", "apps/api/app/services/channel_lifecycle.py"),
    ("016_apps_api_app_services_projects.py", "apps/api/app/services/projects.py"),
    ("017_apps_api_app_services_learning.py", "apps/api/app/services/learning.py"),
    ("018_apps_api_app_services_tenant_introspection.py", "apps/api/app/services/tenant_introspection.py"),
    ("019_apps_api_app_services_signal_threads.py", "apps/api/app/services/signal_threads.py"),
    ("020_apps_api_app_services_work_items.py", "apps/api/app/services/work_items.py"),
    ("021_apps_api_app_services_orchestration_dispatcher.py", "apps/api/app/services/orchestration/dispatcher.py"),
    ("022_apps_api_app_services_orchestration_eval.py", "apps/api/app/services/orchestration/eval.py"),
    ("023_apps_api_app_services_workstreams.py", "apps/api/app/services/workstreams.py"),
    ("024_apps_api_app_services_tickets.py", "apps/api/app/services/tickets.py"),
    ("025_apps_api_app_services_triggers.py", "apps/api/app/services/triggers.py"),
    ("026_apps_api_app_services_project_work.py", "apps/api/app/services/project_work.py"),
    ("027_apps_api_app_services_model_resolution.py", "apps/api/app/services/model_resolution.py"),
    ("028_apps_api_app_services_agent_loop.py", "apps/api/app/services/agent/loop.py"),
    ("029_apps_api_app_services_platform_apply.py", "apps/api/app/services/platform_apply.py"),
    ("030_apps_api_app_tools_builtin.py", "apps/api/app/tools/builtin.py"),
    ("031_apps_dashboard_src_lib_tickets-api.ts", "apps/dashboard/src/lib/tickets-api.ts"),
    ("032_BOKITO_KNOWLEDGE.md", "BOKITO_KNOWLEDGE.md"),
]

ROOT = Path("/opt/bokito-dev")


def main() -> None:
    for src_name, rel in PAIRS:
        src = Path(f"/tmp/schema101_{src_name}")
        dest = ROOT / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        data = src.read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
        dest.write_bytes(data)
        print("ok", rel)
    print("done", len(PAIRS))


if __name__ == "__main__":
    main()
