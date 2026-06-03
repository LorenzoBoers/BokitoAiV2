from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db.session import init_db
from app.exceptions import AppError, app_error_handler, http_exception_handler
from app.middleware.tenant import TenantHostMiddleware
from app.routers import (
    auth,
    blueprint,
    chat,
    cockpit,
    email,
    health,
    inbox,
    inbox_threads,
    integrations,
    notifications,
    push,
    settings_orchestra,
    widget,
    workforce_doc,
)
from app.routers.settings_orchestra import orchestra_router

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(HTTPException, http_exception_handler)

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
app.include_router(email.router, prefix=api_prefix)
app.include_router(push.router, prefix=api_prefix)
app.include_router(inbox.router, prefix=api_prefix)
app.include_router(inbox_threads.router, prefix=api_prefix)
app.include_router(cockpit.router, prefix=api_prefix)
app.include_router(settings_orchestra.router, prefix=api_prefix)
app.include_router(orchestra_router, prefix=api_prefix)
app.include_router(widget.router, prefix=api_prefix)
app.include_router(workforce_doc.router, prefix=api_prefix)
