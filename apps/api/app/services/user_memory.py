"""Cross-workspace memory of the personal assistant.

The only assistant store without a tenant: what Bokito knows about a person
follows them into every workspace they are a member of. Keep it to facts
about the person (their role, how they work, what they are learning) — never
company or customer data, because an agency user carries this memory between
client workspaces.
"""

from __future__ import annotations

import re
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user_memory import UserAssistantMemory

MAX_ENTRIES = 24
MAX_CONTENT_CHARS = 600
_KEY_RE = re.compile(r"[^a-z0-9-]+")


def normalize_key(value: str) -> str:
    key = _KEY_RE.sub("-", (value or "").strip().lower()).strip("-")
    return key[:48]


async def list_user_memory(
    session: AsyncSession, user_id: UUID
) -> list[UserAssistantMemory]:
    result = await session.execute(
        select(UserAssistantMemory)
        .where(UserAssistantMemory.user_id == user_id)
        .order_by(UserAssistantMemory.updated_at.desc())
    )
    return list(result.scalars().all())


async def upsert_user_memory(
    session: AsyncSession,
    user_id: UUID,
    key: str,
    content: str,
    *,
    commit: bool = False,
) -> UserAssistantMemory | None:
    """Write one durable fact about the user. Empty content deletes the entry."""
    normalized = normalize_key(key)
    if not normalized:
        return None
    existing = (
        await session.execute(
            select(UserAssistantMemory).where(
                UserAssistantMemory.user_id == user_id,
                UserAssistantMemory.key == normalized,
            )
        )
    ).scalars().first()
    text = (content or "").strip()[:MAX_CONTENT_CHARS]
    if not text:
        if existing is not None:
            await session.delete(existing)
            if commit:
                await session.commit()
            else:
                await session.flush()
        return None
    now = datetime.utcnow()
    if existing is not None:
        existing.content = text
        existing.updated_at = now
        session.add(existing)
        entry = existing
    else:
        entries = await list_user_memory(session, user_id)
        if len(entries) >= MAX_ENTRIES:
            # Drop the stalest entry so the prompt block stays bounded.
            await session.delete(entries[-1])
        entry = UserAssistantMemory(
            user_id=user_id, key=normalized, content=text, updated_at=now
        )
        session.add(entry)
    if commit:
        await session.commit()
    else:
        await session.flush()
    return entry


async def delete_user_memory(
    session: AsyncSession,
    user_id: UUID,
    key: str,
    *,
    commit: bool = False,
) -> bool:
    normalized = normalize_key(key)
    if not normalized:
        return False
    existing = (
        await session.execute(
            select(UserAssistantMemory).where(
                UserAssistantMemory.user_id == user_id,
                UserAssistantMemory.key == normalized,
            )
        )
    ).scalars().first()
    if existing is None:
        return False
    await session.delete(existing)
    if commit:
        await session.commit()
    else:
        await session.flush()
    return True


async def clear_user_memory(
    session: AsyncSession,
    user_id: UUID,
    *,
    commit: bool = False,
) -> int:
    entries = await list_user_memory(session, user_id)
    for entry in entries:
        await session.delete(entry)
    if commit:
        await session.commit()
    else:
        await session.flush()
    return len(entries)


async def user_memory_block(session: AsyncSession, user_id: UUID | None) -> str:
    """Prompt block with what Bokito remembers about this person."""
    if not user_id:
        return ""
    entries = await list_user_memory(session, user_id)
    if not entries:
        return ""
    lines = "\n".join(f"- {e.key}: {e.content}" for e in entries)
    return (
        "## What you remember about this person\n"
        "Carried across every workspace they belong to. Use remember_about_me to "
        "add or correct an entry; never store company or customer data here.\n"
        f"{lines}"
    )
