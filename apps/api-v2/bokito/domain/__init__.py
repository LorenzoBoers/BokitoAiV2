"""Domain models. Import every aggregate so `Base.metadata` is complete."""

from bokito.domain import (  # noqa: F401
    connection,
    conversation,
    govern,
    identity,
    metering,
    orient,
    platform,
    work,
)
from bokito.domain.base import Base

__all__ = ["Base"]
