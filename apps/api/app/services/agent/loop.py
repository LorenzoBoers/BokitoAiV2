import json
from typing import Any, AsyncGenerator
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent, AgentRun, RunEvent
from app.models.policy import AssistantPersona
from app.services.agent.llm import get_llm_provider
from app.services.agent.rag import build_core_summary, search_index
from app.services.agent.tools import execute_tool, get_tool_definitions


class AgentLoop:
    def __init__(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        user_id: UUID | None,
        agent: Agent | None = None,
        run: AgentRun | None = None,
    ):
        self.session = session
        self.tenant_id = tenant_id
        self.user_id = user_id
        self.agent = agent
        self.run = run
        self.llm = get_llm_provider()
        self.tools = get_tool_definitions()
        self.max_loops = agent.max_loops if agent else 15

    async def _log_event(self, event_type: str, message: str, payload: dict | None = None) -> None:
        if not self.run:
            return
        event = RunEvent(
            run_id=self.run.id,
            tenant_id=self.tenant_id,
            event_type=event_type,
            message=message,
            payload_json=json.dumps(payload or {}),
        )
        self.session.add(event)
        await self.session.commit()

    async def _build_system_prompt(self, extra_context: str = "", user_query: str = "") -> str:
        core = await build_core_summary(self.session, self.tenant_id)
        rag_context = ""
        if user_query:
            hits = await search_index(self.session, self.tenant_id, user_query, top_k=5)
            if hits:
                rag_context = "\n".join(f"- {h['title']}: {h['content'][:300]}" for h in hits)
        persona_result = await self.session.execute(
            select(AssistantPersona).where(AssistantPersona.tenant_id == self.tenant_id)
        )
        persona = persona_result.scalar_one_or_none()
        persona_text = ""
        if persona:
            persona_text = f"Tone: {persona.tone}\nDo: {persona.do_text}\nDon't: {persona.dont_text}"
        base = self.agent.system_prompt if self.agent else "You are the Bokito AI OS assistant."
        return (
            f"{base}\n\n## Persona\n{persona_text}\n\n## Core summary\n{core}\n\n"
            f"## Relevant context\n{rag_context}\n\n{extra_context}"
        ).strip()

    async def run_chat(
        self,
        messages: list[dict[str, Any]],
        extra_context: str = "",
        attachments: list[dict] | None = None,
    ) -> tuple[str, dict[str, int]]:
        user_query = ""
        if messages:
            last = messages[-1]
            user_query = last.get("content", "") if isinstance(last.get("content"), str) else ""
        system = await self._build_system_prompt(extra_context, user_query=user_query)
        if attachments:
            vision_note = f"\n\nUser attached {len(attachments)} file(s). Describe and use them if relevant."
            system += vision_note
        llm_messages = [{"role": "system", "content": system}, *messages]
        tokens = {"input_tokens": 0, "output_tokens": 0}
        final_text = ""

        for loop_idx in range(self.max_loops):
            await self._log_event("think", f"Loop {loop_idx + 1}")
            response = await self.llm.chat(
                llm_messages,
                tools=self.tools,
                model=self.agent.model if self.agent else None,
            )
            tokens["input_tokens"] += response.get("usage", {}).get("input_tokens", 0)
            tokens["output_tokens"] += response.get("usage", {}).get("output_tokens", 0)

            tool_uses = [b for b in response["content"] if b.get("type") == "tool_use"]
            text_blocks = [b["text"] for b in response["content"] if b.get("type") == "text"]
            if text_blocks:
                final_text = "\n".join(text_blocks)

            if not tool_uses or response.get("stop_reason") == "end_turn":
                break

            llm_messages.append({"role": "assistant", "content": response["content"]})
            tool_results = []
            for tool_use in tool_uses:
                await self._log_event("tool_call", tool_use["name"], tool_use.get("input"))
                result = await execute_tool(
                    self.session,
                    self.tenant_id,
                    self.user_id,
                    tool_use["name"],
                    tool_use.get("input", {}),
                )
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_use["id"],
                        "content": json.dumps(result),
                    }
                )
            llm_messages.append({"role": "user", "content": tool_results})

        return final_text or "Done.", tokens

    async def stream_chat(
        self,
        messages: list[dict[str, Any]],
        extra_context: str = "",
        attachments: list[dict] | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        text, tokens = await self.run_chat(messages, extra_context, attachments=attachments)
        for i in range(0, len(text), 24):
            yield {"type": "delta", "text": text[i : i + 24]}
        yield {"type": "done", "text": text, "usage": tokens}
