import json
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


class MockLLMProvider:
    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
    ) -> dict[str, Any]:
        last_user = _last_user_text(messages)
        tool_loop_count = sum(
            1 for m in messages if m.get("role") == "user" and isinstance(m.get("content"), list)
        )
        if tools and tool_loop_count < 2:
            for tool in tools:
                if tool["name"] == "create_decision_request" and "email" in last_user.lower():
                    return {
                        "stop_reason": "tool_use",
                        "content": [
                            {
                                "type": "tool_use",
                                "id": "tool_mock_1",
                                "name": "create_decision_request",
                                "input": {
                                    "title": "Reply to customer email",
                                    "summary": "Draft reply prepared for review.",
                                    "options": [
                                        {"id": "send", "label": "Send reply", "action_type": "send_email"},
                                        {"id": "edit", "label": "Edit first", "action_type": "draft"},
                                        {"id": "escalate", "label": "Escalate", "action_type": "escalate"},
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
        return {
            "stop_reason": "end_turn",
            "content": [
                {
                    "type": "text",
                    "text": f"[mock] I received your message about: {last_user[:200]}. "
                    "This is the Bokito AI OS assistant running in mock mode.",
                }
            ],
            "usage": {"input_tokens": 10, "output_tokens": 30},
        }

    async def stream_chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
    ):
        result = await self.chat(messages, tools, model)
        for block in result["content"]:
            if block.get("type") == "text":
                text = block["text"]
                for i in range(0, len(text), 20):
                    yield {"type": "delta", "text": text[i : i + 20]}
        yield {"type": "done", "usage": result.get("usage", {})}


class AnthropicLLMProvider:
    def __init__(self, api_key: str | None = None) -> None:
        self.api_key = api_key or settings.anthropic_api_key

    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
    ) -> dict[str, Any]:
        from anthropic import AsyncAnthropic

        client = AsyncAnthropic(api_key=self.api_key)
        system = next((m["content"] for m in messages if m["role"] == "system"), "")
        chat_messages = [m for m in messages if m["role"] != "system"]
        response = await client.messages.create(
            model=model or settings.default_chat_model,
            max_tokens=4096,
            system=system,
            messages=chat_messages,
            tools=tools or [],
        )
        content = []
        for block in response.content:
            if block.type == "text":
                content.append({"type": "text", "text": block.text})
            elif block.type == "tool_use":
                content.append(
                    {
                        "type": "tool_use",
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    }
                )
        return {
            "stop_reason": response.stop_reason,
            "content": content,
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
    ):
        from anthropic import AsyncAnthropic

        client = AsyncAnthropic(api_key=self.api_key)
        system = next((m["content"] for m in messages if m["role"] == "system"), "")
        chat_messages = [m for m in messages if m["role"] != "system"]
        async with client.messages.stream(
            model=model or settings.default_chat_model,
            max_tokens=4096,
            system=system,
            messages=chat_messages,
            tools=tools or [],
        ) as stream:
            async for text in stream.text_stream:
                yield {"type": "delta", "text": text}
            final = await stream.get_final_message()
            yield {
                "type": "done",
                "usage": {
                    "input_tokens": final.usage.input_tokens,
                    "output_tokens": final.usage.output_tokens,
                },
            }


class OpenAILLMProvider:
    """OpenAI chat provider that speaks the Anthropic-shaped message protocol.

    The agent loop builds messages and tools in Anthropic format; this provider
    translates to/from the OpenAI Chat Completions tool-calling format so a
    single loop can drive either provider.
    """

    def __init__(self, api_key: str | None = None) -> None:
        self.api_key = api_key or settings.openai_api_key

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
    ) -> dict[str, Any]:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=self.api_key)
        oai_messages = self._messages_to_openai(messages)
        kwargs: dict[str, Any] = {
            "model": model or "gpt-4o",
            "messages": oai_messages,
            "max_tokens": 4096,
        }
        oai_tools = self._tools_to_openai(tools)
        if oai_tools:
            kwargs["tools"] = oai_tools
        response = await client.chat.completions.create(**kwargs)
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
    ):
        result = await self.chat(messages, tools, model)
        for block in result["content"]:
            if block.get("type") == "text":
                text = block["text"]
                for i in range(0, len(text), 20):
                    yield {"type": "delta", "text": text[i : i + 20]}
        yield {"type": "done", "usage": result.get("usage", {})}


def get_chat_provider(provider: str, api_key: str):
    """Return a chat provider instance by provider name (or mock when unknown)."""
    if provider == "anthropic" and api_key:
        return AnthropicLLMProvider(api_key=api_key)
    if provider == "openai" and api_key:
        return OpenAILLMProvider(api_key=api_key)
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
