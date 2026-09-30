"""The agent loop: Orient -> Decide -> Act for one conversation.

1. Build context: agent passport, persona, contact + memory, knowledge hits,
   compact summary and the recent thread.
2. Call the model with the tools the agent may use.
3. Execute tool calls through the executor (trust=agent). A `decision`
   outcome pauses the loop: the thread now holds the question.
4. Final text becomes a reply (sent or draft, decided by the policy) unless
   the agent already replied through a tool.
Everything is metered to `usage_events` and recorded on one Run.
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from bokito.agent.llm import LLMResult, get_llm
from bokito.agent.models import ModelRef, resolve_model
from bokito.deps import Principal
from bokito.domain.conversation import Conversation, Direction, Message, MessageKind
from bokito.domain.identity import Tenant
from bokito.domain.metering import UsageKind
from bokito.domain.orient import Contact, Doc, DocKind
from bokito.domain.work import Agent, Run, RunKind, RunStatus
from bokito.services import conversation as conv_svc
from bokito.services import knowledge as kb
from bokito.services import usage as usage_svc
from bokito.services import work as work_svc
from bokito.tools.executor import execute_tool
from bokito.tools.registry import registry

log = logging.getLogger(__name__)

MAX_STEPS = 6
RECENT_MESSAGES = 20

AGENT_TOOLS_DEFAULT = [
    "reply",
    "add_note",
    "handoff",
    "set_status",
    "set_tags",
    "recognize_signal",
    "search_knowledge",
    "remember_about_contact",
    "upsert_contact",
    "ask_decision",
]

SYSTEM_FRAME = """You are {name}, {role} at {workspace}.
{instructions}

Rules:
- Answer in the customer's language ({language}). Be brief and concrete.
- Use the knowledge below before guessing. If it does not cover the question, say so and `handoff`.
- Never invent prices, dates or commitments. Use `ask_decision` for anything consequential.
- To answer the customer call `reply`. Internal remarks go in `add_note`.
- When the conversation is resolved call `set_status` with status closed.
{persona}
Contact: {contact}
Knowledge:
{knowledge}
Summary so far: {summary}"""


@dataclass
class LoopResult:
    run_id: uuid.UUID
    status: str
    replied: bool
    steps: int
    decision_id: uuid.UUID | None = None
    text: str = ""


def _message_role(msg: Message) -> str | None:
    if msg.kind == MessageKind.message:
        return "user" if msg.direction == Direction.inbound else "assistant"
    if msg.kind == MessageKind.note:
        return "system"
    return None


async def build_messages(
    session: AsyncSession, tenant: Tenant, agent: Agent, conv: Conversation
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    contact = await session.get(Contact, conv.contact_id) if conv.contact_id else None
    persona = ""
    if agent.persona_doc_id:
        doc = await session.get(Doc, agent.persona_doc_id)
        if doc:
            persona = f"Persona:\n{doc.body[:3000]}\n"

    recent = await conv_svc.list_messages(session, conv, limit=RECENT_MESSAGES)
    last_inbound = next(
        (
            m
            for m in reversed(recent)
            if m.kind == MessageKind.message and m.direction == Direction.inbound
        ),
        None,
    )
    query = " ".join(filter(None, [conv.subject, last_inbound.body[:500] if last_inbound else ""]))
    hits = await kb.search(
        session, tenant.id, query, kinds=[DocKind.doc, DocKind.snippet, DocKind.skill], limit=5
    )
    knowledge = (
        "\n".join(f"- [{h.title}] {' '.join(h.text.split())[:400]}" for h in hits)
        or "- (no matching knowledge)"
    )

    contact_line = "unknown"
    if contact:
        contact_line = f"{contact.name or 'unnamed'} <{contact.email or contact.phone or ''}>"
        if contact.memory:
            contact_line += f"\nMemory about this contact:\n{contact.memory[:1500]}"

    language = (
        (contact.language if contact and contact.language else "")
        or agent.language
        or tenant.language
    )
    system = SYSTEM_FRAME.format(
        name=agent.name,
        role=agent.role or "AI colleague",
        workspace=tenant.name,
        instructions=agent.instructions or "",
        language=language,
        persona=persona,
        contact=contact_line,
        knowledge=knowledge,
        summary=conv.compact_summary or "(none)",
    )
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}]
    for msg in recent:
        role = _message_role(msg)
        if role is None:
            continue
        prefix = f"[{msg.author_label}] " if msg.author_label and role != "user" else ""
        messages.append({"role": role, "content": f"{prefix}{msg.body}"})
    messages.append(
        {
            "role": "system",
            "content": f"conversation_id={conv.id}. Call tools with this id."
            + (f" contact_id={contact.id}." if contact else ""),
        }
    )

    allowed = list(agent.tools or []) or AGENT_TOOLS_DEFAULT
    tools = [t.to_public() for t in registry.list(trust="agent", allowed=allowed)]
    return messages, tools


async def _meter(
    session: AsyncSession,
    tenant: Tenant,
    agent: Agent,
    conv: Conversation,
    run: Run,
    model: ModelRef,
    result: LLMResult,
) -> None:
    cost = 0.0 if model.byok else model.cost_eur(result.tokens_in, result.tokens_out)
    run.tokens_in += result.tokens_in
    run.tokens_out += result.tokens_out
    run.cost_eur = float(run.cost_eur or 0) + cost
    await usage_svc.record(
        session,
        tenant.id,
        kind=UsageKind.llm,
        provider=model.provider,
        model=model.model,
        region=model.region,
        conversation_id=conv.id,
        run_id=run.id,
        agent_id=agent.id,
        connection_id=model.connection_id,
        tokens_in=result.tokens_in,
        tokens_out=result.tokens_out,
        cost_eur=cost,
        billed_by_tenant=model.byok,
    )


async def run_agent_on_conversation(
    session: AsyncSession,
    tenant: Tenant,
    agent: Agent,
    conv: Conversation,
    *,
    run: Run | None = None,
    instructions: str = "",
) -> LoopResult:
    principal = Principal(trust="agent", tenant_id=tenant.id, agent_id=agent.id)
    if run is None:
        run = await work_svc.create_run(
            session,
            tenant.id,
            kind=RunKind.reply,
            title=f"{agent.name} on {conv.subject or conv.channel.value}",
            actor=principal.actor,
            trust="agent",
            conversation_id=conv.id,
            agent_id=agent.id,
        )
    run.status = RunStatus.running
    run.started_at = run.started_at or conv.last_activity_at
    model = await resolve_model(session, tenant, agent)
    llm = get_llm(model)
    await work_svc.run_event(session, run, "start", {"model": model.label, "region": model.region})

    messages, tools = await build_messages(session, tenant, agent, conv)
    if instructions:
        messages.append({"role": "system", "content": instructions})
    tool_names = {t["name"] for t in tools}
    replied = False
    text = ""
    steps = 0

    try:
        while steps < MAX_STEPS:
            steps += 1
            run.step = steps
            result = await llm.complete(model, messages, tools)
            await _meter(session, tenant, agent, conv, run, model, result)
            text = result.text or text

            if not result.tool_calls:
                break

            messages.append(
                result.raw_assistant
                or {
                    "role": "assistant",
                    "content": result.text or None,
                    "tool_calls": [
                        {
                            "id": c.id,
                            "type": "function",
                            "function": {"name": c.name, "arguments": json.dumps(c.args)},
                        }
                        for c in result.tool_calls
                    ],
                }
            )
            paused = False
            for call in result.tool_calls:
                if call.name not in tool_names:
                    content = json.dumps({"error": f"tool {call.name} not available"})
                else:
                    args = {**call.args}
                    args.setdefault("conversation_id", str(conv.id))
                    try:
                        outcome = await execute_tool(
                            session,
                            principal,
                            call.name,
                            args,
                            conversation_id=conv.id,
                            parent_run_id=run.id,
                            raise_on_deny=False,
                        )
                    except Exception as exc:  # AppError or validation
                        content = json.dumps({"error": str(getattr(exc, "message", exc))[:500]})
                    else:
                        await work_svc.run_event(
                            session, run, "tool", {"name": call.name, "status": outcome.status}
                        )
                        if outcome.status == "decision":
                            paused = True
                            run.status = RunStatus.waiting
                            run.checkpoint = {
                                "decision_id": str(outcome.decision_id),
                                "tool": call.name,
                            }
                            await session.flush()
                            return LoopResult(
                                run.id, "waiting", replied, steps, outcome.decision_id, text
                            )
                        if outcome.status == "done" and call.name == "reply":
                            replied = True
                        content = json.dumps(outcome.to_dict(), default=str)[:4000]
                messages.append(
                    {"role": "tool", "tool_call_id": call.id, "name": call.name, "content": content}
                )
            if paused:
                break

        if text and not replied:
            outcome = await execute_tool(
                session,
                principal,
                "reply",
                {"conversation_id": str(conv.id), "body": text},
                conversation_id=conv.id,
                parent_run_id=run.id,
                raise_on_deny=False,
            )
            if outcome.status == "decision":
                run.status = RunStatus.waiting
                run.checkpoint = {"decision_id": str(outcome.decision_id), "tool": "reply"}
                await session.flush()
                return LoopResult(run.id, "waiting", False, steps, outcome.decision_id, text)
            replied = outcome.status == "done"

        await work_svc.finish_run(
            session,
            run,
            status=RunStatus.done,
            output={"replied": replied, "steps": steps, "text": text[:2000]},
        )
        return LoopResult(run.id, "done", replied, steps, None, text)
    except Exception as exc:
        log.exception("agent loop failed")
        await work_svc.finish_run(session, run, status=RunStatus.failed, error=str(exc))
        return LoopResult(run.id, "failed", replied, steps, None, text)
