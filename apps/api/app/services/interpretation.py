"""INTERPRETATION layer: LLM triage of inbound signals."""

from __future__ import annotations

import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.inbox import InboxSettings
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

    from app.services.agent.llm import get_chat_provider
    from app.services.model_resolution import record_usage, resolve_model_call

    resolved = await resolve_model_call(session, tenant_id, kind="chat")
    llm = get_chat_provider(
        resolved.provider_type, resolved.api_key, resolved.base_url or None
    )
    prompt = (
        "Classify this inbound signal. Reply with JSON only:\n"
        '{"category":"support|sales|billing|other","urgency":0-100,"impact":0-100,'
        '"summary":"one sentence","certainty":0-100,"priority":"normal|high|urgent"}\n\n'
        f"Subject: {detail.get('subject')}\nFrom: {detail.get('contact_email')}\n\n{body}"
    )
    response = await llm.chat(
        [{"role": "user", "content": prompt}], tools=None, model=resolved.model_id
    )
    _usage = response.get("usage", {})
    await record_usage(
        session, tenant_id, resolved,
        tokens_in=_usage.get("input_tokens", 0), tokens_out=_usage.get("output_tokens", 0),
        scope="triage", scope_id=str(signal_id), call_type="triage",
    )
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
