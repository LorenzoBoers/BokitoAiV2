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
    me,
    signals,
    tools,
    work,
)
from bokito.realtime import gateway


def build_router() -> APIRouter:
    router = APIRouter()
    for module in (
        health,
        auth,
        me,
        conversations,
        decisions,
        contacts,
        signals,
        work,
        connections,
        knowledge,
        govern,
        tools,
    ):
        router.include_router(module.router)
    router.include_router(work.hooks)
    router.include_router(gateway.router)
    return router
