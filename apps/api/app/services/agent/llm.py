import json
import re
from typing import TYPE_CHECKING, Any

from app.config import get_settings

if TYPE_CHECKING:
    from app.services.tenant_llm import TenantLLMConfig

settings = get_settings()


def _last_user_text(messages: list[dict[str, Any]]) -> str:
    for message in reversed(messages):
        if message.get("role") != "user":
            continue
        content = message.get("content", "")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    return str(block.get("text", ""))
    return ""


_SCAFFOLD_MARKERS = (
    "a teammate asked you to draft a reply",
    "new inbound widget message",
    "new inbound message from",
    "reply directly to the customer",
)


def _mock_topic(last_user: str) -> str:
    """Short human topic for the mock echo: prefer the mail subject line."""
    subject_match = re.search(r"^Subject:\s*(.+)$", last_user, re.MULTILINE)
    if subject_match:
        return subject_match.group(1).strip()[:120]
    stripped = last_user.strip()
    first_line = stripped.splitlines()[0] if stripped else ""
    return first_line[:120]


def _resolve_max_tokens(max_tokens: int | None, thinking_budget: int) -> int:
    base = max_tokens if max_tokens and max_tokens > 0 else 4096
    if thinking_budget > 0:
        # Anthropic requires max_tokens > budget_tokens.
        return max(base, thinking_budget + 1024)
    return base


def _anthropic_content_blocks(response_content: Any) -> list[dict[str, Any]]:
    """Serialize Anthropic content blocks, preserving thinking for tool-use replay."""
    content: list[dict[str, Any]] = []
    for block in response_content:
        btype = getattr(block, "type", None)
        if btype == "text":
            content.append({"type": "text", "text": block.text})
        elif btype == "tool_use":
            content.append(
                {
                    "type": "tool_use",
                    "id": block.id,
                    "name": block.name,
                    "input": block.input,
                }
            )
        elif btype == "thinking":
            entry: dict[str, Any] = {
                "type": "thinking",
                "thinking": getattr(block, "thinking", "") or "",
            }
            signature = getattr(block, "signature", None)
            if signature:
                entry["signature"] = signature
            content.append(entry)
        elif btype == "redacted_thinking":
            content.append(
                {
                    "type": "redacted_thinking",
                    "data": getattr(block, "data", "") or "",
                }
            )
    return content


class MockLLMProvider:
    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
        *,
        thinking_budget: int = 0,
        max_tokens: int | None = None,
    ) -> dict[str, Any]:
        last_user = _last_user_text(messages)
        tool_loop_count = sum(
            1 for m in messages if m.get("role") == "user" and isinstance(m.get("content"), list)
        )
        # Suggest-only email drafts run with an empty toolset.
        if (not tools) and (
            "Draft a concise" in last_user or "inbound email" in last_user.lower()
        ):
            return {
                "stop_reason": "end_turn",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "Thank you for your message. We have received your request "
                            "and will follow up shortly."
                        ),
                    }
                ],
                "usage": {"input_tokens": 10, "output_tokens": 20},
            }
        if tools and tool_loop_count < 1:
            tool_names = {t.get("name") for t in tools if isinstance(t, dict)}
            lowered = last_user.lower()
            wants_decision = "decision" in lowered or "approval" in lowered
            if "create_decision_request" in tool_names and wants_decision:
                return {
                    "stop_reason": "tool_use",
                    "content": [
                        {
                            "type": "tool_use",
                            "id": "tool_mock_1",
                            "name": "create_decision_request",
                            "input": {
                                "title": "Reply to customer message",
                                "summary": "Draft reply prepared for review.",
                                # Same option shape as the real reply-suggestion
                                # flow: approving must actually send the draft.
                                "options": [
                                    {
                                        "id": "send",
                                        "label": "Send",
                                        "action_type": "send_reply",
                                        "payload": {
                                            "body": (
                                                "Thank you for your message. We have "
                                                "received your request and will follow "
                                                "up shortly."
                                            ),
                                            "body_text": (
                                                "Thank you for your message. We have "
                                                "received your request and will follow "
                                                "up shortly."
                                            ),
                                        },
                                    },
                                    {"id": "later", "label": "Defer", "action_type": "defer"},
                                    {"id": "reject", "label": "Reject", "action_type": "reject"},
                                ],
                            },
                        }
                    ],
                    "usage": {"input_tokens": 10, "output_tokens": 20},
                }
            return {
                "stop_reason": "tool_use",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "tool_mock_2",
                        "name": "search_index",
                        "input": {"query": last_user[:80]},
                    }
                ],
                "usage": {"input_tokens": 10, "output_tokens": 5},
            }
        if "preparing a response for a human teammate" in last_user:
            return {
                "stop_reason": "end_turn",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "Thank you for reaching out. I looked into your question and "
                            "prepared the details below. Let us know if anything is missing "
                            "and we will follow up right away."
                        ),
                    }
                ],
                "usage": {"input_tokens": 10, "output_tokens": 25},
            }
        lowered_user = last_user.lower()
        if "reply with json only" in lowered_user and '"category"' in last_user:
            # Triage/classification prompts expect machine-readable JSON.
            topic = _mock_topic(last_user) or "Inbound signal"
            return {
                "stop_reason": "end_turn",
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(
                            {
                                "category": "support",
                                "urgency": 55,
                                "impact": 40,
                                "summary": topic,
                                "certainty": 70,
                                "priority": "normal",
                            }
                        ),
                    }
                ],
                "usage": {"input_tokens": 10, "output_tokens": 30},
            }
        if any(marker in lowered_user for marker in _SCAFFOLD_MARKERS):
            # Internal routing/draft scaffolding must never leak into a body
            # that an operator may approve and send to a customer.
            return {
                "stop_reason": "end_turn",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "Thank you for your message. We have received your request "
                            "and will follow up shortly."
                        ),
                    }
                ],
                "usage": {"input_tokens": 10, "output_tokens": 20},
            }
        return {
            "stop_reason": "end_turn",
            "content": [
                {
                    "type": "text",
                    "text": (
                        f"I received your message about: {_mock_topic(last_user)}. "
                        "This is a placeholder reply while the workspace runs without a live model."
                    ),
                }
            ],
            "usage": {"input_tokens": 10, "output_tokens": 30},
        }

    async def stream_chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
        *,
        thinking_budget: int = 0,
        max_tokens: int | None = None,
    ):
        result = await self.chat(
            messages,
            tools,
            model,
            thinking_budget=thinking_budget,
            max_tokens=max_tokens,
        )
        if thinking_budget > 0:
            for chunk in (
                "Considering the user's request... ",
                "Checking context and tools... ",
                "Drafting a clear reply.",
            ):
                yield {"type": "thinking", "text": chunk}
        for block in result["content"]:
            if block.get("type") == "text":
                text = block["text"]
                for i in range(0, len(text), 20):
                    yield {"type": "delta", "text": text[i : i + 20]}
        yield {
            "type": "done",
            "usage": result.get("usage", {}),
            "content": result.get("content", []),
            "stop_reason": result.get("stop_reason", "end_turn"),
        }


class AnthropicLLMProvider:
    def __init__(self, api_key: str | None = None, base_url: str | None = None) -> None:
        self.api_key = api_key or settings.anthropic_api_key
        self.base_url = (base_url or "").strip() or None

    def _client_kwargs(self) -> dict[str, Any]:
        kwargs: dict[str, Any] = {"api_key": self.api_key}
        if self.base_url:
            kwargs["base_url"] = self.base_url
        return kwargs

    @staticmethod
    def _create_kwargs(
        *,
        model: str | None,
        system: str,
        chat_messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        thinking_budget: int,
        max_tokens: int | None,
    ) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "model": model or settings.default_chat_model,
            "max_tokens": _resolve_max_tokens(max_tokens, thinking_budget),
            "system": system,
            "messages": chat_messages,
            "tools": tools or [],
        }
        if thinking_budget > 0:
            kwargs["thinking"] = {"type": "enabled", "budget_tokens": thinking_budget}
        return kwargs

    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
        *,
        thinking_budget: int = 0,
        max_tokens: int | None = None,
    ) -> dict[str, Any]:
        from anthropic import AsyncAnthropic

        client = AsyncAnthropic(**self._client_kwargs())
        system = next((m["content"] for m in messages if m["role"] == "system"), "")
        chat_messages = [m for m in messages if m["role"] != "system"]
        response = await client.messages.create(
            **self._create_kwargs(
                model=model,
                system=system,
                chat_messages=chat_messages,
                tools=tools,
                thinking_budget=thinking_budget,
                max_tokens=max_tokens,
            )
        )
        return {
            "stop_reason": response.stop_reason,
            "content": _anthropic_content_blocks(response.content),
            "usage": {
                "input_tokens": response.usage.input_tokens,
                "output_tokens": response.usage.output_tokens,
            },
        }

    async def stream_chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
        *,
        thinking_budget: int = 0,
        max_tokens: int | None = None,
    ):
        from anthropic import AsyncAnthropic

        client = AsyncAnthropic(**self._client_kwargs())
        system = next((m["content"] for m in messages if m["role"] == "system"), "")
        chat_messages = [m for m in messages if m["role"] != "system"]
        create_kwargs = self._create_kwargs(
            model=model,
            system=system,
            chat_messages=chat_messages,
            tools=tools,
            thinking_budget=thinking_budget,
            max_tokens=max_tokens,
        )

        async with client.messages.stream(**create_kwargs) as stream:
            async for event in stream:
                etype = getattr(event, "type", None)
                if etype != "content_block_delta":
                    continue
                delta = getattr(event, "delta", None)
                if delta is None:
                    continue
                dtype = getattr(delta, "type", None)
                if dtype == "thinking_delta":
                    text = getattr(delta, "thinking", "") or ""
                    if text:
                        yield {"type": "thinking", "text": text}
                elif dtype == "text_delta":
                    text = getattr(delta, "text", "") or ""
                    if text:
                        yield {"type": "delta", "text": text}

            final = await stream.get_final_message()
            yield {
                "type": "done",
                "usage": {
                    "input_tokens": final.usage.input_tokens,
                    "output_tokens": final.usage.output_tokens,
                },
                "content": _anthropic_content_blocks(final.content),
                "stop_reason": final.stop_reason,
            }


class OpenAILLMProvider:
    """OpenAI chat provider that speaks the Anthropic-shaped message protocol.

    The agent loop builds messages and tools in Anthropic format; this provider
    translates to/from the OpenAI Chat Completions tool-calling format so a
    single loop can drive either provider.
    """

    def __init__(self, api_key: str | None = None, base_url: str | None = None) -> None:
        self.api_key = api_key or settings.openai_api_key
        self.base_url = (base_url or "").strip() or None

    @staticmethod
    def _tools_to_openai(tools: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for tool in tools or []:
            out.append(
                {
                    "type": "function",
                    "function": {
                        "name": tool["name"],
                        "description": tool.get("description", ""),
                        "parameters": tool.get("input_schema", {"type": "object", "properties": {}}),
                    },
                }
            )
        return out

    @staticmethod
    def _messages_to_openai(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for message in messages:
            role = message.get("role")
            content = message.get("content", "")
            if role == "system":
                out.append({"role": "system", "content": content if isinstance(content, str) else ""})
                continue
            if isinstance(content, str):
                out.append({"role": role, "content": content})
                continue
            # List content: either assistant tool_use blocks or user tool_result blocks.
            if role == "assistant":
                text_parts: list[str] = []
                tool_calls: list[dict[str, Any]] = []
                for block in content:
                    if block.get("type") == "text":
                        text_parts.append(block.get("text", ""))
                    elif block.get("type") == "tool_use":
                        tool_calls.append(
                            {
                                "id": block["id"],
                                "type": "function",
                                "function": {
                                    "name": block["name"],
                                    "arguments": json.dumps(block.get("input", {})),
                                },
                            }
                        )
                    # Skip thinking/redacted_thinking for OpenAI replay.
                msg: dict[str, Any] = {"role": "assistant", "content": "\n".join(text_parts)}
                if tool_calls:
                    msg["tool_calls"] = tool_calls
                out.append(msg)
            else:  # user with tool_result blocks
                for block in content:
                    if block.get("type") == "tool_result":
                        out.append(
                            {
                                "role": "tool",
                                "tool_call_id": block["tool_use_id"],
                                "content": block.get("content", ""),
                            }
                        )
                    elif block.get("type") == "text":
                        out.append({"role": "user", "content": block.get("text", "")})
        return out

    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
        *,
        thinking_budget: int = 0,
        max_tokens: int | None = None,
    ) -> dict[str, Any]:
        from openai import AsyncOpenAI

        kwargs: dict[str, Any] = {"api_key": self.api_key}
        if self.base_url:
            kwargs["base_url"] = self.base_url
        client = AsyncOpenAI(**kwargs)
        oai_messages = self._messages_to_openai(messages)
        create_kwargs: dict[str, Any] = {
            "model": model or "gpt-4o",
            "messages": oai_messages,
            "max_tokens": _resolve_max_tokens(max_tokens, thinking_budget),
        }
        oai_tools = self._tools_to_openai(tools)
        if oai_tools:
            create_kwargs["tools"] = oai_tools
        response = await client.chat.completions.create(**create_kwargs)
        choice = response.choices[0]
        msg = choice.message
        content: list[dict[str, Any]] = []
        if msg.content:
            content.append({"type": "text", "text": msg.content})
        for call in msg.tool_calls or []:
            try:
                parsed = json.loads(call.function.arguments or "{}")
            except json.JSONDecodeError:
                parsed = {}
            content.append(
                {
                    "type": "tool_use",
                    "id": call.id,
                    "name": call.function.name,
                    "input": parsed,
                }
            )
        stop_reason = "tool_use" if (msg.tool_calls) else "end_turn"
        usage = response.usage
        return {
            "stop_reason": stop_reason,
            "content": content,
            "usage": {
                "input_tokens": getattr(usage, "prompt_tokens", 0) if usage else 0,
                "output_tokens": getattr(usage, "completion_tokens", 0) if usage else 0,
            },
        }

    async def stream_chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
        *,
        thinking_budget: int = 0,
        max_tokens: int | None = None,
    ):
        from openai import AsyncOpenAI

        kwargs: dict[str, Any] = {"api_key": self.api_key}
        if self.base_url:
            kwargs["base_url"] = self.base_url
        client = AsyncOpenAI(**kwargs)
        oai_messages = self._messages_to_openai(messages)
        create_kwargs: dict[str, Any] = {
            "model": model or "gpt-4o",
            "messages": oai_messages,
            "max_tokens": _resolve_max_tokens(max_tokens, thinking_budget),
            "stream": True,
        }
        oai_tools = self._tools_to_openai(tools)
        if oai_tools:
            create_kwargs["tools"] = oai_tools

        stream = await client.chat.completions.create(**create_kwargs)
        text_parts: list[str] = []
        tool_calls: dict[int, dict[str, Any]] = {}
        usage = {"input_tokens": 0, "output_tokens": 0}

        async for chunk in stream:
            if chunk.usage:
                usage["input_tokens"] = getattr(chunk.usage, "prompt_tokens", 0) or 0
                usage["output_tokens"] = getattr(chunk.usage, "completion_tokens", 0) or 0
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            # Best-effort: some OpenAI-compatible reasoning endpoints expose this.
            reasoning = getattr(delta, "reasoning", None) or getattr(delta, "reasoning_content", None)
            if isinstance(reasoning, str) and reasoning:
                yield {"type": "thinking", "text": reasoning}
            if delta.content:
                text_parts.append(delta.content)
                yield {"type": "delta", "text": delta.content}
            if delta.tool_calls:
                for tc in delta.tool_calls:
                    idx = tc.index
                    if idx not in tool_calls:
                        tool_calls[idx] = {"id": tc.id or "", "name": "", "arguments": ""}
                    if tc.id:
                        tool_calls[idx]["id"] = tc.id
                    if tc.function:
                        if tc.function.name:
                            tool_calls[idx]["name"] = tc.function.name
                        if tc.function.arguments:
                            tool_calls[idx]["arguments"] += tc.function.arguments

        content: list[dict[str, Any]] = []
        if text_parts:
            content.append({"type": "text", "text": "".join(text_parts)})
        for tc in tool_calls.values():
            try:
                parsed = json.loads(tc["arguments"] or "{}")
            except json.JSONDecodeError:
                parsed = {}
            content.append(
                {
                    "type": "tool_use",
                    "id": tc["id"],
                    "name": tc["name"],
                    "input": parsed,
                }
            )
        stop_reason = "tool_use" if tool_calls else "end_turn"
        yield {
            "type": "done",
            "usage": usage,
            "content": content,
            "stop_reason": stop_reason,
        }


def get_chat_provider(provider_type: str, api_key: str, base_url: str | None = None):
    """Return a chat provider instance by provider type (or mock when unknown)."""
    if provider_type == "anthropic" and api_key:
        return AnthropicLLMProvider(api_key=api_key, base_url=base_url)
    if provider_type in ("openai", "openai_compatible") and api_key:
        return OpenAILLMProvider(api_key=api_key, base_url=base_url)
    return MockLLMProvider()


def get_llm_provider(config: "TenantLLMConfig | None" = None):
    """Return the chat provider for a tenant config, falling back to globals.

    When ``config`` is provided, a tenant Anthropic key (or env key in global
    live mode) selects the live provider; otherwise mock. With no config we
    keep the original global behavior.
    """
    if config is not None:
        if config.live and config.anthropic_api_key:
            return AnthropicLLMProvider(api_key=config.anthropic_api_key)
        return MockLLMProvider()
    if settings.llm_mode == "live" and settings.anthropic_api_key:
        return AnthropicLLMProvider()
    return MockLLMProvider()
