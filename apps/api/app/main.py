from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db.session import init_db
from app.routers import auth, blueprint, chat, email, health, integrations, notifications, push

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_prefix = settings.api_prefix
app.include_router(health.router, prefix=api_prefix)
app.include_router(auth.router, prefix=api_prefix)
app.include_router(chat.router, prefix=api_prefix)
app.include_router(notifications.router, prefix=api_prefix)
app.include_router(blueprint.router, prefix=api_prefix)
app.include_router(integrations.router, prefix=api_prefix)
app.include_router(email.router, prefix=api_prefix)
app.include_router(push.router, prefix=api_prefix)
