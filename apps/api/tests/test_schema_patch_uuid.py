"""Schema patcher must create uuid-typed model columns as native uuid on
Postgres; older deployments got VARCHAR, which broke joins against uuid
primary keys (Cockpit usage breakdown 500)."""

from sqlmodel import SQLModel

from app.db.schema_patch import _dialect_ddl, _is_uuid_type, _sqlite_type


def test_usage_ledger_agent_id_detected_as_uuid():
    import app.models  # noqa: F401

    table = SQLModel.metadata.tables["usage_ledger"]
    for name in ("agent_id", "run_id", "user_id", "tenant_id"):
        assert _is_uuid_type(table.columns[name].type), name


def test_uuid_columns_get_uuid_ddl_on_postgres_and_varchar_on_sqlite():
    import app.models  # noqa: F401

    col_type = SQLModel.metadata.tables["usage_ledger"].columns["agent_id"].type
    fragment = _sqlite_type(col_type)
    assert fragment == "UUID"
    assert _dialect_ddl(fragment, is_postgres=True) == "UUID"
    assert _dialect_ddl(fragment, is_postgres=False) == "VARCHAR"


def test_non_uuid_types_unaffected():
    import app.models  # noqa: F401

    table = SQLModel.metadata.tables["usage_ledger"]
    assert _sqlite_type(table.columns["tokens_in"].type) == "INTEGER"
    assert not _is_uuid_type(table.columns["model"].type)
