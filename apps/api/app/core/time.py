"""Shared time helpers."""

from __future__ import annotations

from datetime import datetime, timezone


def utcnow() -> datetime:
    """UTC now as a naive datetime (DB columns are naive UTC today)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
