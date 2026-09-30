"""Domain models, one module per aggregate.

Import every module here so `Base.metadata` is complete for Alembic and tests.
"""

from bokito.domain import identity  # noqa: E402,F401
from bokito.domain.base import Base, TenantMixin, TimestampMixin, utcnow  # noqa: F401
