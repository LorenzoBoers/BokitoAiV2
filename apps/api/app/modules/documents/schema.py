"""Canonical external-document objects. No adapters in this slice."""

from __future__ import annotations

from pydantic import BaseModel


class ExternalFile(BaseModel):
    id: str
    name: str
    path: str = ""
    mime: str = ""
    modified_at: str = ""
