from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text

from bokito import __version__
from bokito.config import get_settings
from bokito.deps import DbSession

router = APIRouter(tags=["health"])


class Health(BaseModel):
    ok: bool
    version: str
    region: str


@router.get("/health", response_model=Health, summary="Liveness")
async def health() -> Health:
    s = get_settings()
    return Health(ok=True, version=__version__, region=s.region)


@router.get("/health/ready", response_model=Health, summary="Readiness (database reachable)")
async def ready(session: DbSession) -> Health:
    await session.execute(text("select 1"))
    s = get_settings()
    return Health(ok=True, version=__version__, region=s.region)
