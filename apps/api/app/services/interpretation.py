"""INTERPRETATION layer: LLM triage of inbound signals."""

from __future__ import annotations

import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.inbox import InboxSettings
from app.services.agent.llm import get_llm_provider
from app.services.signals import apply_triage, get_signal_detail


async def triage_signal(session: AsyncSession, tenant_id: UUID, signal_id: UUID) -> dict:
    detail = await get_signal_detail(session, tenant_id, signal_id)
    messages = detail.get("messages") or []
    body = messages[-1]["body_text"] if messages else detail.get("subject", "")

    settings_result = await session.execute(
        select(InboxSettings).where(InboxSettings.tenant_id == tenant_id)
    )
    settings_row = settings_result.scalar_one_or_none()
    threshold = settings_row.certainty_threshold if settings_row else 7

    llm = get_llm_provider()
    prompt = (
        "Classify this inbound signal. Reply with JSON only:\n"
        '{"category":"support|sales|billing|other","urgency":0-100,"impact":0-100,'
        '"summary":"one sentence","certainty":0-100,"priority":"normal|high|urgent"}\n\n'
        f"Subject: {detail.get('subject')}\nFrom: {detail.get('contact_email')}\n\n{body}"
    )
    response = await llm.chat([{"role": "user", "content": prompt}], tools=None)
    text_blocks = [b["text"] for b in response.get("content", []) if b.get("type") == "text"]
    raw = "\n".join(text_blocks).strip()
    try:
        start = raw.find("{")
        end = raw.rfind("}") + 1
        parsed = json.loads(raw[start:end]) if start >= 0 else {}
    except (json.JSONDecodeError, ValueError):
        parsed = {
            "category": "other",
            "urgency": 50,
            "impact": 40,
            "summary": detail.get("subject", "Inbound signal"),
            "certainty": 50,
            "priority": "normal",
        }

    priority = parsed.get("priority", "normal")
    if int(parsed.get("certainty", 0)) < threshold * 10:
        priority = "normal"

    signal = await apply_triage(
        session,
        tenant_id,
        signal_id,
        category=str(parsed.get("category", "other")),
        urgency=int(parsed.get("urgency", 50)),
        impact=int(parsed.get("impact", 40)),
        summary=str(parsed.get("summary", ""))[:500],
        certainty=int(parsed.get("certainty", 50)),
        priority=priority if priority in ("normal", "high", "urgent") else "normal",
    )
    from app.services.signals import serialize_signal

    return serialize_signal(signal)
