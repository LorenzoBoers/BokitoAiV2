"""Connection presets: a catalog row with ``fields`` and a ``url_template``.

The operator fills the fields the API lists; the server validates them and
builds the server URL and auth. A field ``target`` says where the value goes:
``url`` (only in the template), ``api_key``, ``auth:{key}`` or ``header:{Name}``.
"""

from __future__ import annotations

import re
from typing import Any


from app.exceptions import AppError, status_error
from app.services.mcp_remote_catalog import catalog_providers

_PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")


def preset_for(provider: str) -> dict[str, Any] | None:
    row = next((p for p in catalog_providers() if p.get("slug") == provider), None)
    if not row or not isinstance(row.get("fields"), list) or not row.get("url_template"):
        return None
    return {"fields": [f for f in row["fields"] if isinstance(f, dict) and f.get("key")], "url_template": str(row["url_template"])}


def public_fields(provider: str) -> list[dict[str, Any]]:
    """The form the dashboard draws: labels and which fields are secret, no targets."""
    preset = preset_for(provider)
    if preset is None:
        return []
    return [
        {
            "key": f["key"],
            "label": str(f.get("label") or f["key"]),
            "label_nl": str(f.get("label_nl") or f.get("label") or f["key"]),
            "secret": bool(f.get("secret")),
            "required": f.get("required", True) is not False,
            "placeholder": str(f.get("placeholder") or ""),
        }
        for f in preset["fields"]
    ]


def build_from_fields(provider: str, values: dict[str, Any]) -> tuple[str, dict[str, Any], str]:
    """Validate the filled fields. Returns (server_url, auth extras, api_key)."""
    preset = preset_for(provider)
    if preset is None:
        raise AppError("This connection has no fields to fill.", code="app_error", status_code=400)
    clean: dict[str, str] = {}
    for field in preset["fields"]:
        value = str((values or {}).get(field["key"]) or "").strip()
        if not value and field.get("required", True) is not False:
            raise status_error(status_code=422, detail=f"Fill in {field.get('label') or field['key']}.")
        pattern = field.get("pattern")
        if value and pattern and not re.match(str(pattern), value):
            raise status_error(status_code=422, detail=f"{field.get('label') or field['key']} does not look right.")
        clean[field["key"]] = value
    url = _PLACEHOLDER.sub(lambda m: clean.get(m.group(1), ""), preset["url_template"])
    auth: dict[str, Any] = {}
    headers: dict[str, str] = {}
    api_key = ""
    for field in preset["fields"]:
        value = clean.get(field["key"], "")
        target = str(field.get("target") or f"auth:{field['key']}")
        if not value or target == "url":
            continue
        if target == "api_key":
            api_key = value
        elif target.startswith("header:"):
            headers[target[len("header:"):]] = value
        elif target.startswith("auth:"):
            auth[target[len("auth:"):]] = value
    if headers:
        auth["headers"] = headers
    auth["auth_type"] = "fields"
    return url, auth, api_key
