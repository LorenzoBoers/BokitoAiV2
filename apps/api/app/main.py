import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
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
    agenda,
    auth,
    blueprint,
    chat,
    cockpit,
    app_workspaces,
    custom_db,
    email,
    github_integrations,
    govern,
    health,
    inbox,
    inbox_threads,
    livechat,
    integrations,
    notifications,
    projects,
    push,
    settings_orchestra,
    signals,
    learning,
    widget,
    workforce,
    workforce_doc,
)
from app.routers.settings_orchestra import orchestra_router
from app.services.agenda_scheduler import agenda_scheduler_enabled, agenda_scheduler_loop

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    scheduler_task: asyncio.Task | None = None
    if agenda_scheduler_enabled():
        scheduler_task = asyncio.create_task(agenda_scheduler_loop())
    try:
        yield
    finally:
        if scheduler_task:
            scheduler_task.cancel()
            try:
                await scheduler_task
            except asyncio.CancelledError:
                pass


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
app.include_router(health.router, prefix=api_prefix)
app.include_router(auth.router, prefix=api_prefix)
app.include_router(chat.router, prefix=api_prefix)
app.include_router(notifications.router, prefix=api_prefix)
app.include_router(blueprint.router, prefix=api_prefix)
app.include_router(integrations.router, prefix=api_prefix)
app.include_router(github_integrations.router, prefix=api_prefix)
app.include_router(email.router, prefix=api_prefix)
app.include_router(push.router, prefix=api_prefix)
app.include_router(inbox.router, prefix=api_prefix)
app.include_router(inbox_threads.router, prefix=api_prefix)
app.include_router(cockpit.router, prefix=api_prefix)
app.include_router(settings_orchestra.router, prefix=api_prefix)
app.include_router(orchestra_router, prefix=api_prefix)
app.include_router(agenda.router, prefix=api_prefix)
app.include_router(widget.router, prefix=api_prefix)
app.include_router(livechat.router, prefix=api_prefix)
app.include_router(workforce_doc.router, prefix=api_prefix)
app.include_router(projects.router, prefix=api_prefix)
app.include_router(workforce.router, prefix=api_prefix)
app.include_router(govern.router, prefix=api_prefix)
app.include_router(signals.router, prefix=api_prefix)
app.include_router(learning.router, prefix=api_prefix)
app.include_router(custom_db.router, prefix=f"{api_prefix}/app")
app.include_router(app_workspaces.router, prefix=f"{api_prefix}/app")
