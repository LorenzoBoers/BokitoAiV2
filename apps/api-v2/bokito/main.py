"""FastAPI application factory for api-v2."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from bokito import __version__
from bokito.api import build_root_router, build_router
from bokito.config import get_settings, validate_production_settings
from bokito.db import dispose_engine
from bokito.errors import install_error_handlers

log = logging.getLogger("bokito")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    problems = validate_production_settings(settings)
    if problems:
        raise RuntimeError("unsafe production settings: " + "; ".join(problems))
    logging.basicConfig(level=logging.DEBUG if settings.debug else logging.INFO)
    log.info(
        "bokito api-v2 %s starting (%s, region %s)",
        __version__,
        settings.environment,
        settings.region,
    )
    yield
    await dispose_engine()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Bokito API v2",
        version=__version__,
        description="The governed conversation layer for companies run with AI.",
        lifespan=lifespan,
        docs_url=f"{settings.api_prefix}/docs",
        openapi_url=f"{settings.api_prefix}/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_error_handlers(app)
    app.include_router(build_router(), prefix=settings.api_prefix)
    app.include_router(build_root_router())
    return app


app = create_app()
