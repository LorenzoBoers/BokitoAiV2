import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings, validate_production_settings
from app.db.session import init_db
from sqlalchemy.exc import OperationalError

from app.exceptions import (
    AppError,
    app_error_handler,
    http_exception_handler,
    operational_error_handler,
)
from app.middleware.tenant import TenantHostMiddleware
from app.routers import (
    auth,
    channels,
    chat,
    cockpit,
    app_workspaces,
    custom_db,
    email,
    github_integrations,
    govern,
    health,
    kb,
    livechat,
    integrations,
    mcp,
    me,
    models,
    notifications,
    projects,
    push,
    settings_orchestra,
    signals,
    learning,
    tenant_secrets,
    triggers,
    widget,
    workforce,
    workspace,
    orchestration,
    uploads,
)
from app.routers.settings_orchestra import orchestra_router
from app.gateway.bus import event_bus
from app.gateway.router import router as gateway_router
from app.services.trigger_scheduler import trigger_scheduler_enabled, trigger_scheduler_loop

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    config_errors = validate_production_settings(settings)
    if config_errors:
        raise RuntimeError(
            "Refusing to start in production with unsafe configuration:\n  - "
            + "\n  - ".join(config_errors)
        )
    await init_db()
    await event_bus.start()
    scheduler_task: asyncio.Task | None = None
    if trigger_scheduler_enabled():
        scheduler_task = asyncio.create_task(trigger_scheduler_loop())
    try:
        yield
    finally:
        if scheduler_task:
            scheduler_task.cancel()
            try:
                await scheduler_task
            except asyncio.CancelledError:
                pass
        await event_bus.stop()


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(OperationalError, operational_error_handler)

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(TenantHostMiddleware)

api_prefix = settings.api_prefix
app.include_router(gateway_router, prefix=api_prefix)
app.include_router(health.router, prefix=api_prefix)
app.include_router(auth.router, prefix=api_prefix)
app.include_router(chat.router, prefix=api_prefix)
app.include_router(me.router, prefix=api_prefix)
app.include_router(notifications.router, prefix=api_prefix)
app.include_router(integrations.router, prefix=api_prefix)
app.include_router(github_integrations.router, prefix=api_prefix)
app.include_router(email.router, prefix=api_prefix)
app.include_router(kb.router, prefix=api_prefix)
app.include_router(channels.router, prefix=api_prefix)
app.include_router(push.router, prefix=api_prefix)
app.include_router(cockpit.router, prefix=api_prefix)
app.include_router(settings_orchestra.router, prefix=api_prefix)
app.include_router(orchestra_router, prefix=api_prefix)
app.include_router(triggers.router, prefix=api_prefix)
app.include_router(widget.router, prefix=api_prefix)
app.include_router(livechat.router, prefix=api_prefix)
app.include_router(workspace.router, prefix=api_prefix)
app.include_router(projects.router, prefix=api_prefix)
app.include_router(workforce.router, prefix=api_prefix)
app.include_router(govern.router, prefix=api_prefix)
app.include_router(mcp.router, prefix=api_prefix)
app.include_router(signals.router, prefix=api_prefix)
app.include_router(uploads.router, prefix=api_prefix)
app.include_router(learning.router, prefix=api_prefix)
app.include_router(tenant_secrets.router, prefix=api_prefix)
app.include_router(models.router, prefix=api_prefix)
app.include_router(models.staff_router, prefix=api_prefix)
app.include_router(orchestration.router, prefix=api_prefix)
app.include_router(custom_db.router, prefix=f"{api_prefix}/app")
app.include_router(app_workspaces.router, prefix=f"{api_prefix}/app")
