"""HTTP routers. Thin: validate, call a service or tool, serialize."""

from fastapi import APIRouter

from bokito.api import auth, health, me


def build_router() -> APIRouter:
    router = APIRouter()
    router.include_router(health.router)
    router.include_router(auth.router)
    router.include_router(me.router)
    return router
