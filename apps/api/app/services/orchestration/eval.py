"""Eval checkpoint execution for orchestration steps."""

from __future__ import annotations

import json
import re
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import EvalCheckpoint

def _parse_json(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


async def run_eval_checkpoint(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    agent_task_id: UUID | None,
    run_id: UUID,
    step_id: UUID | None,
    eval_kind: str,
    criteria_json: str,
    output_text: str,
    context: dict[str, Any],
    retry_count: int = 0,
) -> EvalCheckpoint:
    criteria = _parse_json(criteria_json)
    passed = False
    result: dict[str, Any] = {"eval_kind": eval_kind}

    if eval_kind == "rubric":
        required_phrases = criteria.get("required_phrases") or []
        min_length = int(criteria.get("min_length") or 0)
        passed = len(output_text.strip()) >= min_length
        missing = [p for p in required_phrases if p.lower() not in output_text.lower()]
        result["missing_phrases"] = missing
        if missing:
            passed = False
        elif required_phrases:
            passed = True
        elif min_length == 0:
            passed = bool(output_text.strip())

    elif eval_kind == "tool_assert":
        expected = criteria.get("expected") or {}
        actual = context.get("tool_results") or {}
        passed = all(actual.get(k) == v for k, v in expected.items()) if expected else bool(output_text.strip())
        result["expected"] = expected
        result["actual"] = actual

    elif eval_kind == "llm_judge":
        rubric = criteria.get("rubric") or criteria.get("prompt") or "Did the agent complete the task acceptably?"
        from app.services.agent.llm import get_chat_provider
        from app.services.model_resolution import record_usage, resolve_model_call

        resolved = await resolve_model_call(session, tenant_id, kind="chat")
        llm = get_chat_provider(
            resolved.provider_type, resolved.api_key, resolved.base_url or None
        )
        judge_prompt = (
            f"Evaluate this agent output against the rubric.\n\nRubric:\n{rubric}\n\n"
            f"Output:\n{output_text[:4000]}\n\n"
            "Reply with JSON only: {\"passed\": true|false, \"reason\": \"...\"}"
        )
        try:
            response = await llm.chat(
                [{"role": "user", "content": judge_prompt}], tools=None, model=resolved.model_id
            )
            _usage = response.get("usage", {})
            await record_usage(
                session, tenant_id, resolved,
                tokens_in=_usage.get("input_tokens", 0), tokens_out=_usage.get("output_tokens", 0),
                scope="eval", call_type="eval",
            )
            text = " ".join(b.get("text", "") for b in response.get("content", []) if b.get("type") == "text")
            match = re.search(r"\{.*\}", text, re.DOTALL)
            if match:
                parsed = json.loads(match.group())
                passed = bool(parsed.get("passed"))
                result["reason"] = parsed.get("reason", "")
            else:
                passed = "true" in text.lower() and "false" not in text.lower()
                result["reason"] = text[:500]
        except Exception as exc:
            passed = len(output_text.strip()) > 20
            result["reason"] = f"judge_fallback: {exc}"

    else:
        passed = bool(output_text.strip())

    row = EvalCheckpoint(
        tenant_id=tenant_id,
        agent_task_id=agent_task_id,
        run_id=run_id,
        step_id=step_id,
        eval_kind=eval_kind,
        criteria_json=criteria_json,
        result_json=json.dumps(result),
        passed=passed,
        retry_count=retry_count,
    )
    session.add(row)
    await session.flush()
    return row
