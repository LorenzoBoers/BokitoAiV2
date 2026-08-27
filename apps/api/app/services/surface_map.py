"""Load docs/product-help/surface-map.yaml (restricted YAML subset)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.services.product_help import SECTIONS, resolve_product_help_dir

_LIST_KEYS = frozenset({"routes", "code_globs", "screenshots"})
_SCALAR_KEYS = frozenset({"section", "docs"})


def _source_map_path() -> Path:
    root = resolve_product_help_dir()
    return root / "surface-map.yaml"


def parse_surface_map_yaml(raw: str) -> dict[str, dict[str, Any]]:
    """Parse the restricted surface-map YAML (2-level keys + string lists)."""
    entries: dict[str, dict[str, Any]] = {}
    current: str | None = None
    list_key: str | None = None
    for lineno, raw_line in enumerate(raw.splitlines(), start=1):
        if (not raw_line.strip()) or raw_line.lstrip().startswith("#"):
            continue
        stripped = raw_line.lstrip(" ")
        indent = len(raw_line) - len(stripped)
        if stripped.startswith("- ") and indent >= 2:
            if current is None or list_key is None:
                raise ValueError(f"line {lineno}: list item outside a list")
            entries[current].setdefault(list_key, []).append(stripped[2:].strip())
            continue
        if raw_line.startswith("  ") and ":" in raw_line:
            list_key = None
            key, _, value = raw_line[2:].partition(":")
            key = key.strip()
            value = value.strip()
            if current is None:
                raise ValueError(f"line {lineno}: nested key without an entry")
            if key in _LIST_KEYS:
                if value in ("", "[]"):
                    entries[current][key] = []
                    list_key = None if value == "[]" else key
                    continue
                raise ValueError(f"line {lineno}: list key '{key}' must be empty or []")
            if key in _SCALAR_KEYS:
                entries[current][key] = value
                continue
            raise ValueError(f"line {lineno}: unknown key '{key}'")
        if raw_line.startswith(" ") or raw_line.startswith("\t"):
            raise ValueError(f"line {lineno}: unexpected indent")
        if raw_line.endswith(":"):
            current = raw_line[:-1].strip()
            if not current:
                raise ValueError(f"line {lineno}: empty entry name")
            entries[current] = {}
            list_key = None
            continue
        raise ValueError(f"line {lineno}: cannot parse")
    return entries


def load_surface_map() -> dict[str, dict[str, Any]]:
    path = _source_map_path()
    if not path.is_file():
        # Packaged API image may only have en/nl/assets; tests use the git copy.
        repo_copy = Path(__file__).resolve().parents[4] / "docs" / "product-help" / "surface-map.yaml"
        if repo_copy.is_file():
            path = repo_copy
        else:
            raise FileNotFoundError("surface-map.yaml not found")
    return parse_surface_map_yaml(path.read_text(encoding="utf-8"))


def article_entries(mapping: dict[str, dict[str, Any]] | None = None) -> dict[str, dict[str, Any]]:
    data = mapping if mapping is not None else load_surface_map()
    return {slug: meta for slug, meta in data.items() if meta.get("docs") != "none"}


def skip_routes(mapping: dict[str, dict[str, Any]] | None = None) -> set[str]:
    data = mapping if mapping is not None else load_surface_map()
    routes: set[str] = set()
    for meta in data.values():
        if meta.get("docs") == "none":
            routes.update(meta.get("routes") or [])
    return routes


def mapped_routes(mapping: dict[str, dict[str, Any]] | None = None) -> set[str]:
    data = mapping if mapping is not None else load_surface_map()
    routes: set[str] = set()
    for meta in data.values():
        routes.update(meta.get("routes") or [])
    return routes


def screenshot_relpaths(slug: str, names: list[str]) -> list[str]:
    return [f"assets/{slug}/{name}.png" for name in names]


def validate_surface_map(mapping: dict[str, dict[str, Any]], article_slugs: set[str]) -> list[str]:
    errors: list[str] = []
    articles = article_entries(mapping)
    for slug, meta in articles.items():
        section = meta.get("section")
        if section not in SECTIONS:
            errors.append(f"{slug}: section must be one of {SECTIONS}")
        if slug not in article_slugs:
            errors.append(f"{slug}: in surface-map but no article in en/")
    for slug in sorted(article_slugs - set(articles)):
        errors.append(f"{slug}: article exists but is missing from surface-map.yaml")
    return errors
