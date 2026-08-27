"""Planned document-storage capabilities. No vendor adapter yet."""

from __future__ import annotations

from typing import Any

CAPABILITIES: dict[str, dict[str, bool]] = {
    "google_drive": {"docs_only": True, "files.read": True, "files.write": False},
    "microsoft_graph_files": {"docs_only": True, "files.read": True, "files.write": False},
    "dropbox": {"docs_only": True, "files.read": True, "files.write": False},
}


def matrix_rows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for vendor, caps in CAPABILITIES.items():
        docs_only = bool(caps.get("docs_only"))
        for capability, supported in caps.items():
            if capability == "docs_only":
                continue
            rows.append(
                {
                    "vendor": vendor,
                    "capability": capability,
                    "supported": bool(supported),
                    "docs_only": docs_only,
                }
            )
    return rows
