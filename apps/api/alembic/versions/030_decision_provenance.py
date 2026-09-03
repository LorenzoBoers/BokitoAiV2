"""Add decision_requests.agent_task_id and .run_id (decision provenance).

Revision ID: 030_decision_provenance
Revises: 029_knowledge_hub_scopes

A decision card shows where the question came from: a queue item (AgentTask),
an agent run, a project, or a platform change. The first two were missing.

Both columns are soft links without a foreign key, like the existing
message_id: AgentTask.message_id already points at signal_messages, so a real
constraint would close the loop signal_messages -> decision_requests ->
agent_tasks -> signal_messages, which SQLAlchemy cannot order when a tenant is
purged table by table.

Additive only; SQLite picks it up via create_all/schema_patch.
"""

import sqlalchemy as sa
from alembic import op

revision = "030_decision_provenance"
down_revision = "029_knowledge_hub_scopes"
branch_labels = None
depends_on = None

_COLUMNS = ("agent_task_id", "run_id")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = {c["name"] for c in inspector.get_columns("decision_requests")}
    indexes = {i["name"] for i in inspector.get_indexes("decision_requests")}

    for column in _COLUMNS:
        if column not in existing:
            op.add_column("decision_requests", sa.Column(column, sa.Uuid(), nullable=True))
        index_name = f"ix_decision_requests_{column}"
        if index_name not in indexes:
            op.create_index(index_name, "decision_requests", [column])


def downgrade() -> None:
    for column in _COLUMNS:
        op.drop_index(f"ix_decision_requests_{column}", table_name="decision_requests")
        op.drop_column("decision_requests", column)
