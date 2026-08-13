"""Initial schema baseline."""


revision = "001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Tables created via SQLModel.metadata.create_all in dev; migration tracks baseline.
    pass


def downgrade() -> None:
    pass
