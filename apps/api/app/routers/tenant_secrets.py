"""Per-tenant LLM API key management (admin-gated).

Lets a workspace owner/admin store its own Anthropic (chat) and OpenAI
(embeddings) keys. Keys are encrypted at rest; only masked metadata and the
effective mode (live/mock) are returned.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services import tenant_secrets
from app.services.tenant_llm import resolve_tenant_llm_config

router = APIRouter(prefix="/settings", tags=["settings"])


class LlmKeyUpdate(BaseModel):
    api_key: str


async def _status_payload(session: AsyncSession, tenant_id) -> dict:
    providers = await tenant_secrets.list_status(session, tenant_id)
    config = await resolve_tenant_llm_config(session, tenant_id)
    return {
        "providers": providers,
        "chat_mode": "live" if config.live else "mock",
        "embeddings_mode": "live" if config.embeddings_live else "mock",
    }


@router.get("/llm-keys")
async def get_llm_keys(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    return await _status_payload(session, auth.tenant.id)


@router.put("/llm-keys/{provider}")
async def set_llm_key(
    provider: str,
    body: LlmKeyUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    if provider not in tenant_secrets.LLM_PROVIDERS:
        raise HTTPException(status_code=400, detail="Unknown provider")
    if not body.api_key.strip():
        raise HTTPException(status_code=400, detail="API key cannot be empty")
    await tenant_secrets.set_secret(session, auth.tenant.id, provider, body.api_key)
    return await _status_payload(session, auth.tenant.id)


@router.delete("/llm-keys/{provider}")
async def delete_llm_key(
    provider: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    if provider not in tenant_secrets.LLM_PROVIDERS:
        raise HTTPException(status_code=400, detail="Unknown provider")
    await tenant_secrets.delete_secret(session, auth.tenant.id, provider)
    return await _status_payload(session, auth.tenant.id)
