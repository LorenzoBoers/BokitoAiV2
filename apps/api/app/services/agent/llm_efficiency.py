"""Cost and latency helpers for the LLM providers.

Two concerns, kept out of ``llm.py`` so both stay small:

* **Client reuse** — one SDK client per (event loop, provider, key, base url)
  instead of a new client (and a new TLS connection pool) on every call.
  Keyed by the running loop because httpx pools are bound to the loop that
  opened them; a dead loop drops its clients automatically.
* **Anthropic prompt caching** — ``cache_control`` breakpoints on the tool
  list, the system prompt and the latest message. Inside one agent turn the
  loop resends the same tools + system + growing history on every iteration,
  so iterations after the first read that prefix from cache (≈10% of the input
  price) instead of paying for it again.

Usage stays comparable for spend tracking: ``input_tokens`` is reported as the
billing-equivalent input (uncached + 1.25 × cache writes + 0.1 × cache reads,
rounded up), so every existing ``tokens_in`` / budget calculation remains
correct without touching its call site. The raw counters ride along.
"""

from __future__ import annotations

import asyncio
import math
import weakref
from typing import Any, Callable, TypeVar

from app.config import get_settings

T = TypeVar("T")

_EPHEMERAL = {"type": "ephemeral"}
# cache_control is accepted on these content block types (not thinking).
_CACHEABLE_BLOCKS = {"text", "image", "document", "tool_use", "tool_result"}

CACHE_WRITE_MULTIPLIER = 1.25
CACHE_READ_MULTIPLIER = 0.1

_clients: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, dict[tuple, Any]]" = (
    weakref.WeakKeyDictionary()
)


def shared_client(kind: str, kwargs: dict[str, Any], factory: Callable[..., T]) -> T:
    """Return a cached SDK client for these kwargs on the running event loop."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return factory(**kwargs)
    key = (kind, id(factory), tuple(sorted((k, repr(v)) for k, v in kwargs.items())))
    per_loop = _clients.setdefault(loop, {})
    client = per_loop.get(key)
    if client is None:
        client = factory(**kwargs)
        per_loop[key] = client
    return client


def prompt_caching_enabled(base_url: str | None) -> bool:
    """Only send cache_control to Anthropic itself; compatible gateways may reject it."""
    if not get_settings().llm_prompt_caching:
        return False
    host = (base_url or "").strip().lower()
    return not host or "anthropic.com" in host


def _with_breakpoint(block: dict[str, Any]) -> dict[str, Any]:
    out = dict(block)
    out["cache_control"] = dict(_EPHEMERAL)
    return out


def _cache_last_block(content: Any) -> Any:
    if isinstance(content, str):
        if not content.strip():
            return content
        return [{"type": "text", "text": content, "cache_control": dict(_EPHEMERAL)}]
    if not isinstance(content, list):
        return content
    for idx in range(len(content) - 1, -1, -1):
        block = content[idx]
        if not isinstance(block, dict) or block.get("type") not in _CACHEABLE_BLOCKS:
            continue
        if block.get("type") == "text" and not str(block.get("text") or "").strip():
            continue
        return [*content[:idx], _with_breakpoint(block), *content[idx + 1 :]]
    return content


def apply_prompt_caching(create_kwargs: dict[str, Any]) -> dict[str, Any]:
    """Add cache breakpoints (tools, system, last message) without mutating inputs.

    At most three breakpoints (the API allows four). Prefixes shorter than the
    model's minimum cacheable length are simply not cached — no error.
    """
    kwargs = dict(create_kwargs)

    tools = kwargs.get("tools") or []
    if tools and not any(isinstance(t, dict) and "cache_control" in t for t in tools):
        kwargs["tools"] = [*tools[:-1], _with_breakpoint(tools[-1])]

    system = kwargs.get("system")
    if isinstance(system, str) and system.strip():
        kwargs["system"] = [{"type": "text", "text": system, "cache_control": dict(_EPHEMERAL)}]
    elif isinstance(system, list) and system:
        kwargs["system"] = _cache_last_block(system)

    messages = kwargs.get("messages") or []
    if messages and isinstance(messages[-1], dict):
        last = dict(messages[-1])
        last["content"] = _cache_last_block(last.get("content"))
        kwargs["messages"] = [*messages[:-1], last]
    return kwargs


def anthropic_usage(usage: Any) -> dict[str, int]:
    """Usage dict with billing-equivalent ``input_tokens`` plus raw cache counters."""
    uncached = int(getattr(usage, "input_tokens", 0) or 0)
    written = int(getattr(usage, "cache_creation_input_tokens", 0) or 0)
    read = int(getattr(usage, "cache_read_input_tokens", 0) or 0)
    billed = uncached + math.ceil(written * CACHE_WRITE_MULTIPLIER + read * CACHE_READ_MULTIPLIER)
    return {
        "input_tokens": billed,
        "output_tokens": int(getattr(usage, "output_tokens", 0) or 0),
        "uncached_input_tokens": uncached,
        "cache_creation_input_tokens": written,
        "cache_read_input_tokens": read,
    }
