from typing import Any

from app.config import get_settings

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
    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
    ) -> dict[str, Any]:
        from anthropic import AsyncAnthropic

        client = AsyncAnthropic(api_key=settings.anthropic_api_key)
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

        client = AsyncAnthropic(api_key=settings.anthropic_api_key)
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


def get_llm_provider():
    if settings.llm_mode == "live" and settings.anthropic_api_key:
        return AnthropicLLMProvider()
    return MockLLMProvider()
