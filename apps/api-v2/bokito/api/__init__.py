"""HTTP routers. Thin: validate, call a service or tool, serialize."""

from fastapi import APIRouter

import bokito.tools.builtin  # noqa: F401  (registers core tools)
from bokito.api import (
    auth,
    connections,
    contacts,
    conversations,
    decisions,
    govern,
    health,
    knowledge,
    mcp,
    me,
    oauth,
    signals,
    tools,
    work,
    workbench,
    workspace,
)
from bokito.channels import email, phone, whatsapp, widget
from bokito.realtime import gateway


def build_router() -> APIRouter:
    router = APIRouter()
    for module in (
        health,
        auth,
        me,
        workspace,
        conversations,
        decisions,
        contacts,
        signals,
        work,
        connections,
        knowledge,
        govern,
        tools,
        oauth,
        mcp,
        workbench,
    ):
        router.include_router(module.router)
    router.include_router(work.hooks)
    for channel in (email, whatsapp, widget, phone):
        router.include_router(channel.router)
    router.include_router(gateway.router)
    return router


def build_root_router() -> APIRouter:
    """Routes that live at the origin root, outside `api_prefix` (RFC 8414 / 9728 discovery)."""
    router = APIRouter()
    router.include_router(oauth.well_known)
    return router
