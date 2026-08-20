import base64
import json
import time
import uuid
from typing import Any, AsyncGenerator
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.agent import Agent, AgentRun, RunEvent
from app.services.agent.llm import get_chat_provider, get_llm_provider
from app.services.agent.tools import (
    execute_tool,
    filter_tools_for_agent,
    get_tool_definitions,
)
from app.services.workspace import build_workspace_context, hybrid_search


def _truncate_trace_value(value: Any, max_chars: int = 480) -> Any:
    """Keep persisted step payloads small enough for message metadata."""
    try:
        if isinstance(value, (dict, list)):
            text = json.dumps(value, default=str)
        else:
            text = str(value)
    except Exception:
        text = str(value)
    if len(text) <= max_chars:
        return value
    return f"{text[:max_chars]}..."


class AgentLoop:
    def __init__(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        user_id: UUID | None,
        agent: Agent | None = None,
        run: AgentRun | None = None,
        signal_id: UUID | None = None,
        trust: str = "operator",
        *,
        allowed_tool_names: set[str] | None = None,
        enable_chat_thinking: bool = False,
    ):
        self.session = session
        self.tenant_id = tenant_id
        self.user_id = user_id
        self.agent = agent
        self.run = run
        self.signal_id = signal_id
        self.trust = trust
        self.enable_chat_thinking = enable_chat_thinking
        self.llm = get_llm_provider()
        # Set during run_chat once the model call is resolved (drives metering).
        self.resolved_call = None
        # Metering labels; orchestration/workstream callers override before run_chat.
        self.usage_scope = "chat"
        self.usage_call_type = "chat"
        # Passport: an agent only sees the tools it is permitted to use.
        tools = filter_tools_for_agent(get_tool_definitions(), agent)
        if allowed_tool_names is not None:
            tools = [t for t in tools if t["name"] in allowed_tool_names]
        self.tools = tools
        self.max_loops = agent.max_loops if agent else 15
        # Compact step log for chat history (tool calls / think) + token usage UI.
        self.trace_steps: list[dict[str, Any]] = []
        # RAG hits from the latest turn; the widget stream uses these to append
        # "related article" links when hits map to published help-center docs.
        self.last_rag_hits: list[dict[str, Any]] = []
        self.thinking_text = ""
        self.thinking_ms = 0
        self.thinking_budget = 0

    def _resolve_thinking_budget(self) -> int:
        """Agent override, else global chat fallback when chat thinking is enabled."""
        agent_budget = int(getattr(self.agent, "thinking_budget", 0) or 0) if self.agent else 0
        if agent_budget > 0:
            return agent_budget
        if not self.enable_chat_thinking:
            return 0
        return max(0, int(get_settings().chat_thinking_budget or 0))

    def _resolve_max_tokens(self) -> int | None:
        if self.agent and getattr(self.agent, "max_tokens", None):
            return int(self.agent.max_tokens)
        return None

    def thinking_payload(self) -> dict[str, Any] | None:
        text = (self.thinking_text or "").strip()
        if len(text) > 8000:
            text = f"{text[:8000]}..."
        if not text and not self.thinking_ms and not self.thinking_budget:
            return None
        return {
            "text": text,
            "ms": self.thinking_ms,
            "budget": self.thinking_budget,
        }

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
        from app.gateway.publish import publish_run_event

        await publish_run_event(
            self.tenant_id,
            self.run.id,
            event_type=event_type,
            message=message,
            payload=payload or {},
            status=self.run.status,
        )

    def _append_trace_step(
        self,
        step_type: str,
        name: str = "",
        payload: dict | None = None,
    ) -> None:
        """Record a compact step for persistence on the assistant message."""
        raw = payload or {}
        compact: dict[str, Any] = {}
        if "input" in raw:
            compact["input"] = _truncate_trace_value(raw["input"])
        if "result" in raw:
            compact["result"] = _truncate_trace_value(raw["result"])
        self.trace_steps.append(
            {
                "step_type": step_type,
                "name": name,
                "payload": compact,
            }
        )

    async def _publish_agent_step(
        self,
        step_type: str,
        name: str = "",
        payload: dict | None = None,
        stream_id: str | None = None,
    ) -> None:
        self._append_trace_step(step_type, name=name, payload=payload)
        if not self.signal_id:
            return
        from app.gateway.publish import publish_agent_step

        await publish_agent_step(
            self.tenant_id,
            self.signal_id,
            step_type=step_type,
            name=name,
            payload=payload,
            stream_id=stream_id,
        )

    async def _publish_agent_thinking(self, delta: str, stream_id: str | None = None) -> None:
        if not self.signal_id or not delta:
            return
        from app.gateway.publish import publish_agent_thinking

        await publish_agent_thinking(
            self.tenant_id,
            self.signal_id,
            delta=delta,
            stream_id=stream_id,
        )

    async def _publish_delta(self, delta: str, stream_id: str | None = None) -> None:
        if not self.signal_id or not delta:
            return
        from app.gateway.publish import publish_message_delta

        await publish_message_delta(
            self.tenant_id,
            self.signal_id,
            delta=delta,
            stream_id=stream_id,
        )

    async def _build_system_prompt(self, extra_context: str = "", user_query: str = "") -> str:
        workspace = await build_workspace_context(self.session, self.tenant_id)
        rag_context = ""
        if user_query:
            hits = await hybrid_search(self.session, self.tenant_id, user_query, top_k=5)
            self.last_rag_hits = hits or []
            if hits:
                rag_context = "\n".join(f"- {h['title']}: {h['content'][:300]}" for h in hits)
        default_prompt = (
            "You are the Bokito AI OS assistant. "
            "You have introspection tools (get_tenant_overview, list_recent_activity, "
            "list_tasks, list_threads, get_usage_summary) and a Tenant snapshot in context — "
            "use them before saying you lack information about the tenant, projects, or activity."
        )
        base = self.agent.system_prompt if self.agent and self.agent.system_prompt else default_prompt
        parts = [base]
        if workspace:
            parts.append(workspace)
        # Always remind agents with custom prompts that live tenant tools exist.
        if self.agent and self.agent.system_prompt:
            parts.append(
                "## Introspection\n"
                "Before claiming you lack information, call get_tenant_overview or "
                "list_recent_activity. Strategy and project docs may require read_doc."
            )
        if rag_context:
            parts.append(f"## Relevant context\n{rag_context}")
        if extra_context:
            parts.append(extra_context)
        # Platform-wide response style: applies to every agent, custom or not.
        from app.services.agent.style import RESPONSE_STYLE

        parts.append(RESPONSE_STYLE)
        return "\n\n".join(parts).strip()

    async def _prepare_chat(
        self,
        messages: list[dict[str, Any]],
        extra_context: str = "",
        attachments: list[dict] | None = None,
    ) -> tuple[list[dict[str, Any]], dict[str, int]]:
        from app.services.model_resolution import resolve_model_call

        model_slug = self.agent.model if self.agent else None
        self.resolved_call = await resolve_model_call(
            self.session, self.tenant_id, kind="chat", model_slug=model_slug
        )
        self.llm = get_chat_provider(
            self.resolved_call.provider_type,
            self.resolved_call.api_key,
            self.resolved_call.base_url or None,
        )

        user_query = ""
        if messages:
            last = messages[-1]
            user_query = last.get("content", "") if isinstance(last.get("content"), str) else ""
        system = await self._build_system_prompt(extra_context, user_query=user_query)
        if attachments:
            vision_note = self._attachments_context(attachments)
            system += vision_note
        llm_messages = [{"role": "system", "content": system}, *messages]
        llm_messages = await self._apply_attachments_to_messages(llm_messages, attachments)
        return llm_messages, {"input_tokens": 0, "output_tokens": 0}

    async def _apply_attachments_to_messages(
        self,
        messages: list[dict[str, Any]],
        attachments: list[dict] | None,
    ) -> list[dict[str, Any]]:
        if not attachments:
            return messages

        from app.services.storage import fetch_attachment_bytes

        last_user_idx: int | None = None
        for idx in range(len(messages) - 1, -1, -1):
            if messages[idx].get("role") == "user":
                last_user_idx = idx
                break
        if last_user_idx is None:
            return messages

        msg = messages[last_user_idx]
        content = msg.get("content", "")
        text = content if isinstance(content, str) else ""
        if isinstance(content, list):
            text_parts = [
                block.get("text", "")
                for block in content
                if isinstance(block, dict) and block.get("type") == "text"
            ]
            text = "\n".join(text_parts)

        blocks: list[dict[str, Any]] = []
        if text:
            blocks.append({"type": "text", "text": text})

        non_image_names: list[str] = []
        for att in attachments:
            mime = str(att.get("mime", ""))
            name = str(att.get("name") or att.get("filename") or "file")
            if mime.startswith("image/"):
                url = str(att.get("url") or "")
                data = await fetch_attachment_bytes(url) if url else None
                if data:
                    blocks.append(
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": mime,
                                "data": base64.standard_b64encode(data).decode("ascii"),
                            },
                        }
                    )
                else:
                    non_image_names.append(name)
            else:
                non_image_names.append(name)

        if non_image_names:
            note = f"[Attached files: {', '.join(non_image_names)}]"
            if blocks and blocks[0].get("type") == "text":
                blocks[0]["text"] = f"{blocks[0]['text']}\n\n{note}".strip()
            else:
                blocks.insert(0, {"type": "text", "text": note})

        if not blocks:
            return messages

        updated = list(messages)
        if len(blocks) == 1 and blocks[0]["type"] == "text":
            updated[last_user_idx] = {**msg, "content": blocks[0]["text"]}
        else:
            updated[last_user_idx] = {**msg, "content": blocks}
        return updated

    @staticmethod
    def _attachments_context(attachments: list[dict]) -> str:
        image_count = sum(1 for a in attachments if str(a.get("mime", "")).startswith("image/"))
        file_count = len(attachments) - image_count
        parts: list[str] = []
        if image_count:
            parts.append(f"{image_count} image(s)")
        if file_count:
            parts.append(f"{file_count} file(s)")
        label = " and ".join(parts) if parts else f"{len(attachments)} attachment(s)"
        return f"\n\nUser attached {label}. Describe and use them if relevant."

    async def _record_usage(self, tokens: dict[str, int]) -> None:
        if self.resolved_call is None:
            return
        from app.services.model_resolution import record_usage

        scope_id = None
        if self.signal_id:
            scope_id = str(self.signal_id)
        elif self.run is not None:
            scope_id = str(self.run.id)
        await record_usage(
            self.session,
            self.tenant_id,
            self.resolved_call,
            tokens_in=tokens.get("input_tokens", 0),
            tokens_out=tokens.get("output_tokens", 0),
            scope=self.usage_scope,
            scope_id=scope_id,
            call_type=self.usage_call_type,
            agent_id=self.agent.id if self.agent else None,
            run_id=self.run.id if self.run else None,
            user_id=self.user_id,
            commit=True,
        )

    async def _execute_tool_loop(
        self,
        llm_messages: list[dict[str, Any]],
        response_content: list[dict[str, Any]],
        stream_id: str | None = None,
    ) -> list[dict[str, Any]]:
        tool_results = []
        for tool_use in response_content:
            if tool_use.get("type") != "tool_use":
                continue
            await self._log_event("tool_call", tool_use["name"], tool_use.get("input"))
            await self._publish_agent_step(
                "tool_call",
                name=tool_use["name"],
                payload={"input": tool_use.get("input", {})},
                stream_id=stream_id,
            )
            result = await execute_tool(
                self.session,
                self.tenant_id,
                self.user_id,
                tool_use["name"],
                tool_use.get("input", {}),
                signal_id=self.signal_id,
                agent=self.agent,
                run_id=self.run.id if self.run else None,
                trust=self.trust,
            )
            await self._publish_agent_step(
                "tool_result",
                name=tool_use["name"],
                payload={"result": result},
                stream_id=stream_id,
            )
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tool_use["id"],
                    "content": json.dumps(result),
                }
            )
        return tool_results

    async def run_chat(
        self,
        messages: list[dict[str, Any]],
        extra_context: str = "",
        attachments: list[dict] | None = None,
    ) -> tuple[str, dict[str, int]]:
        llm_messages, tokens = await self._prepare_chat(messages, extra_context, attachments)
        final_text = ""
        self.thinking_budget = self._resolve_thinking_budget()
        max_tokens = self._resolve_max_tokens()
        started = time.monotonic()

        for loop_idx in range(self.max_loops):
            await self._log_event("think", f"Loop {loop_idx + 1}")
            await self._publish_agent_step("think", name=f"Loop {loop_idx + 1}")
            response = await self.llm.chat(
                llm_messages,
                tools=self.tools,
                model=self.resolved_call.model_id if self.resolved_call else None,
                thinking_budget=self.thinking_budget,
                max_tokens=max_tokens,
            )
            tokens["input_tokens"] += response.get("usage", {}).get("input_tokens", 0)
            tokens["output_tokens"] += response.get("usage", {}).get("output_tokens", 0)

            for block in response.get("content") or []:
                if block.get("type") == "thinking" and block.get("thinking"):
                    self.thinking_text += str(block["thinking"])

            tool_uses = [b for b in response["content"] if b.get("type") == "tool_use"]
            text_blocks = [b["text"] for b in response["content"] if b.get("type") == "text"]
            if text_blocks:
                final_text = "\n".join(text_blocks)

            if not tool_uses or response.get("stop_reason") == "end_turn":
                break

            llm_messages.append({"role": "assistant", "content": response["content"]})
            tool_results = await self._execute_tool_loop(llm_messages, tool_uses)
            llm_messages.append({"role": "user", "content": tool_results})

        self.thinking_ms = int((time.monotonic() - started) * 1000)
        await self._record_usage(tokens)
        return final_text or "Done.", tokens

    async def stream_chat(
        self,
        messages: list[dict[str, Any]],
        extra_context: str = "",
        attachments: list[dict] | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        llm_messages, tokens = await self._prepare_chat(messages, extra_context, attachments)
        stream_id = str(uuid.uuid4())
        final_text = ""
        self.thinking_budget = self._resolve_thinking_budget()
        max_tokens = self._resolve_max_tokens()
        started = time.monotonic()

        for loop_idx in range(self.max_loops):
            await self._log_event("think", f"Loop {loop_idx + 1}")
            await self._publish_agent_step("think", name=f"Loop {loop_idx + 1}", stream_id=stream_id)

            response_content: list[dict[str, Any]] = []
            stop_reason = "end_turn"

            async for event in self.llm.stream_chat(
                llm_messages,
                tools=self.tools,
                model=self.resolved_call.model_id if self.resolved_call else None,
                thinking_budget=self.thinking_budget,
                max_tokens=max_tokens,
            ):
                if event["type"] == "thinking":
                    delta = event.get("text", "")
                    if delta:
                        self.thinking_text += delta
                        yield {"type": "thinking", "text": delta}
                        await self._publish_agent_thinking(delta, stream_id=stream_id)
                elif event["type"] == "delta":
                    delta = event.get("text", "")
                    if delta:
                        final_text += delta
                        yield {"type": "delta", "text": delta}
                        await self._publish_delta(delta, stream_id=stream_id)
                elif event["type"] == "done":
                    usage = event.get("usage", {})
                    tokens["input_tokens"] += usage.get("input_tokens", 0)
                    tokens["output_tokens"] += usage.get("output_tokens", 0)
                    response_content = event.get("content") or []
                    stop_reason = event.get("stop_reason", "end_turn")
                    if not self.thinking_text:
                        for block in response_content:
                            if block.get("type") == "thinking" and block.get("thinking"):
                                self.thinking_text += str(block["thinking"])

            tool_uses = [b for b in response_content if b.get("type") == "tool_use"]
            text_blocks = [b["text"] for b in response_content if b.get("type") == "text"]
            if text_blocks and not final_text:
                final_text = "\n".join(text_blocks)

            if not tool_uses or stop_reason == "end_turn":
                break

            llm_messages.append({"role": "assistant", "content": response_content})
            tool_results = await self._execute_tool_loop(llm_messages, tool_uses, stream_id=stream_id)
            llm_messages.append({"role": "user", "content": tool_results})
            final_text = ""

        self.thinking_ms = int((time.monotonic() - started) * 1000)
        await self._record_usage(tokens)
        text = final_text or "Done."
        yield {
            "type": "done",
            "text": text,
            "usage": tokens,
            "stream_id": stream_id,
            "steps": list(self.trace_steps),
            "thinking": self.thinking_text,
            "thinking_ms": self.thinking_ms,
            "thinking_budget": self.thinking_budget,
        }
