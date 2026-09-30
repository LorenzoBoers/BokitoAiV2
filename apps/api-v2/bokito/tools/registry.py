"""Tool registry: every mutation in Bokito is a tool.

A tool is a typed async function. REST endpoints, agents, MCP clients and the
command palette all call `executor.execute_tool`, which consults the policy
and records a Run. Tools declare a category (drives the policy) and whether
they are consequential (always ask, regardless of posture).
"""

from __future__ import annotations

import inspect
import typing
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from bokito.deps import Principal, Trust


@dataclass
class ToolContext:
    session: AsyncSession
    principal: Principal
    tenant_id: uuid.UUID
    run_id: uuid.UUID
    conversation_id: uuid.UUID | None = None
    agent_id: uuid.UUID | None = None


Handler = Callable[[ToolContext, Any], Awaitable[Any]]


@dataclass
class ToolDef:
    name: str
    description: str
    input_model: type[BaseModel]
    handler: Handler
    category: str = "write"
    consequential: bool = False
    trusts: tuple[Trust, ...] = ("operator", "api", "agent", "system")
    module: str = ""
    tags: list[str] = field(default_factory=list)
    hidden: bool = False

    def schema(self) -> dict[str, Any]:
        return self.input_model.model_json_schema()

    def to_public(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "consequential": self.consequential,
            "module": self.module,
            "input_schema": self.schema(),
        }


class Registry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolDef] = {}

    def register(self, tool: ToolDef) -> ToolDef:
        if tool.name in self._tools:
            raise ValueError(f"tool already registered: {tool.name}")
        self._tools[tool.name] = tool
        return tool

    def unregister(self, name: str) -> None:
        self._tools.pop(name, None)

    def get(self, name: str) -> ToolDef | None:
        return self._tools.get(name)

    def names(self) -> list[str]:
        return sorted(self._tools)

    def list(
        self,
        *,
        trust: Trust | None = None,
        allowed: list[str] | None = None,
        modules: set[str] | None = None,
        include_hidden: bool = False,
    ) -> list[ToolDef]:
        out: list[ToolDef] = []
        for tool in self._tools.values():
            if tool.hidden and not include_hidden:
                continue
            if trust and trust not in tool.trusts:
                continue
            if allowed is not None and tool.name not in allowed:
                continue
            if tool.module and modules is not None and tool.module not in modules:
                continue
            out.append(tool)
        return sorted(out, key=lambda t: t.name)


registry = Registry()


def tool(
    name: str,
    *,
    description: str,
    category: str = "write",
    consequential: bool = False,
    trusts: tuple[Trust, ...] = ("operator", "api", "agent", "system"),
    module: str = "",
    tags: list[str] | None = None,
    hidden: bool = False,
) -> Callable[[Handler], Handler]:
    """Register `async def handler(ctx: ToolContext, args: InputModel)`."""

    def decorator(fn: Handler) -> Handler:
        sig = inspect.signature(fn)
        params = list(sig.parameters.values())
        if len(params) != 2:
            raise TypeError(f"tool {name}: handler must be (ctx, args)")
        hints = typing.get_type_hints(fn)
        input_model = hints.get(params[1].name, params[1].annotation)
        if not (inspect.isclass(input_model) and issubclass(input_model, BaseModel)):
            raise TypeError(f"tool {name}: args must be annotated with a pydantic model")
        registry.register(
            ToolDef(
                name=name,
                description=description,
                input_model=input_model,
                handler=fn,
                category=category,
                consequential=consequential,
                trusts=trusts,
                module=module,
                tags=tags or [],
                hidden=hidden,
            )
        )
        return fn

    return decorator
