"""Modules: verticals and integrations as packages of types, playbooks and tools.

A module never adds a screen. Installing one seeds Signal types, playbooks and
skill docs into the workspace (all tagged with `module=<slug>`) and unlocks the
module's tools for agents, the palette and MCP. The module's external system
is reached through an `integration` Connection whose provider matches
`ModuleSpec.connection_provider`.

Modules are code: `MODULES` is the catalog, `module_installs` the per-tenant
state.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from bokito.errors import NotFound


@dataclass(frozen=True)
class SignalTypeSeed:
    slug: str
    name: str
    description: str = ""
    color: str = ""
    fields: list[dict[str, Any]] = field(default_factory=list)
    recognition: dict[str, Any] = field(default_factory=dict)
    autonomy_cap: str | None = None
    playbook_slug: str | None = None


@dataclass(frozen=True)
class PlaybookSeed:
    slug: str
    name: str
    description: str = ""
    steps: list[dict[str, Any]] = field(default_factory=list)
    autonomy_cap: str | None = None


@dataclass(frozen=True)
class DocSeed:
    path: str
    title: str
    body: str
    kind: str = "skill"


@dataclass(frozen=True)
class ModuleSpec:
    slug: str
    name: str
    description: str
    version: str
    connection_provider: str | None = None
    connection_kind: str = "integration"
    signal_types: tuple[SignalTypeSeed, ...] = ()
    playbooks: tuple[PlaybookSeed, ...] = ()
    docs: tuple[DocSeed, ...] = ()
    tools: tuple[str, ...] = ()
    settings_schema: dict[str, Any] = field(default_factory=dict)

    def to_public(self) -> dict[str, Any]:
        return {
            "slug": self.slug,
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "connection_provider": self.connection_provider,
            "connection_kind": self.connection_kind,
            "signal_types": [s.slug for s in self.signal_types],
            "playbooks": [p.slug for p in self.playbooks],
            "docs": [d.path for d in self.docs],
            "tools": list(self.tools),
            "settings_schema": self.settings_schema,
        }


MODULES: dict[str, ModuleSpec] = {}


def register_module(spec: ModuleSpec) -> ModuleSpec:
    if spec.slug in MODULES:
        raise ValueError(f"module already registered: {spec.slug}")
    MODULES[spec.slug] = spec
    return spec


def get_module(slug: str) -> ModuleSpec:
    try:
        return MODULES[slug]
    except KeyError as exc:
        raise NotFound(f"unknown module {slug}", code="module_unknown") from exc


def list_modules() -> list[ModuleSpec]:
    return sorted(MODULES.values(), key=lambda m: m.slug)


from bokito.modules import accounting  # noqa: E402,F401  (registers the first module)
