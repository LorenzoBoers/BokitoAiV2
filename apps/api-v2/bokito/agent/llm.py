"""LLM client: one interface, OpenAI-compatible chat (Mistral, OpenAI), Anthropic, and a mock.

The mock is deterministic and tool-aware so the agent loop can be tested end to
end without network: it echoes knowledge hits and answers with a short reply,
or emits a tool call when the last user message asks for one (`/tool name {json}`).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from bokito.agent.models import ModelRef
from bokito.config import get_settings

log = logging.getLogger(__name__)


@dataclass
class ToolCall:
    id: str
    name: str
    args: dict[str, Any]


@dataclass
class LLMResult:
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    tokens_in: int = 0
    tokens_out: int = 0
    finish_reason: str = "stop"
    raw_assistant: dict[str, Any] | None = None


class LLMClient(Protocol):
    async def complete(
        self, model: ModelRef, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> LLMResult: ...


class MockLLM:
    async def complete(
        self, model: ModelRef, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> LLMResult:
        last_user = next((m for m in reversed(messages) if m.get("role") == "user"), None)
        text = str(last_user.get("content") if last_user else "")
        tokens_in = sum(len(str(m.get("content") or "")) for m in messages) // 4
        # A prior tool result: summarise it.
        if messages and messages[-1].get("role") == "tool":
            content = str(messages[-1].get("content") or "")
            return LLMResult(text=f"Done. {content[:200]}", tokens_in=tokens_in, tokens_out=12)
        if text.startswith("/tool "):
            _, _, rest = text.partition(" ")
            name, _, payload = rest.partition(" ")
            try:
                args = json.loads(payload) if payload.strip() else {}
            except json.JSONDecodeError:
                args = {}
            return LLMResult(
                tool_calls=[ToolCall(id="call_1", name=name, args=args)],
                tokens_in=tokens_in,
                tokens_out=8,
                finish_reason="tool_calls",
            )
        system = next((m for m in messages if m.get("role") == "system"), None)
        knowledge = ""
        if system and "Knowledge:" in str(system.get("content")):
            knowledge = (
                str(system["content"]).split("Knowledge:", 1)[1].strip().splitlines()[0][:160]
            )
        reply = "Thanks for your message. " + (
            knowledge or "A colleague or I will get back to you shortly."
        )
        return LLMResult(text=reply, tokens_in=tokens_in, tokens_out=len(reply) // 4)


class OpenAICompatible:
    """Mistral and OpenAI share the chat completions wire format."""

    BASES = {"mistral": "https://api.mistral.ai/v1", "openai": "https://api.openai.com/v1"}

    async def complete(
        self, model: ModelRef, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> LLMResult:
        base = model.base_url or self.BASES.get(model.provider, self.BASES["mistral"])
        body: dict[str, Any] = {"model": model.model, "messages": messages, "temperature": 0.3}
        if tools:
            body["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": t["name"],
                        "description": t["description"],
                        "parameters": t["input_schema"],
                    },
                }
                for t in tools
            ]
            body["tool_choice"] = "auto"
        async with httpx.AsyncClient(timeout=90) as client:
            r = await client.post(
                f"{base}/chat/completions",
                headers={"Authorization": f"Bearer {model.api_key}"},
                json=body,
            )
            r.raise_for_status()
            data = r.json()
        choice = data["choices"][0]
        msg = choice["message"]
        usage = data.get("usage") or {}
        calls = []
        for tc in msg.get("tool_calls") or []:
            fn = tc.get("function") or {}
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            calls.append(
                ToolCall(
                    id=tc.get("id") or fn.get("name", "call"), name=fn.get("name", ""), args=args
                )
            )
        return LLMResult(
            text=str(msg.get("content") or ""),
            tool_calls=calls,
            tokens_in=int(usage.get("prompt_tokens") or 0),
            tokens_out=int(usage.get("completion_tokens") or 0),
            finish_reason=str(choice.get("finish_reason") or "stop"),
            raw_assistant=msg,
        )


class AnthropicClient:
    async def complete(
        self, model: ModelRef, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> LLMResult:
        system = "\n".join(str(m["content"]) for m in messages if m.get("role") == "system")
        converted: list[dict[str, Any]] = []
        for m in messages:
            role = m.get("role")
            if role == "system":
                continue
            if role == "tool":
                converted.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": m.get("tool_call_id"),
                                "content": str(m.get("content") or ""),
                            }
                        ],
                    }
                )
            elif role == "assistant" and m.get("tool_calls"):
                blocks: list[dict[str, Any]] = []
                if m.get("content"):
                    blocks.append({"type": "text", "text": str(m["content"])})
                for tc in m["tool_calls"]:
                    fn = tc["function"]
                    blocks.append(
                        {
                            "type": "tool_use",
                            "id": tc["id"],
                            "name": fn["name"],
                            "input": json.loads(fn.get("arguments") or "{}"),
                        }
                    )
                converted.append({"role": "assistant", "content": blocks})
            else:
                converted.append({"role": role, "content": str(m.get("content") or "")})
        body: dict[str, Any] = {"model": model.model, "max_tokens": 1500, "messages": converted}
        if system:
            body["system"] = system
        if tools:
            body["tools"] = [
                {
                    "name": t["name"],
                    "description": t["description"],
                    "input_schema": t["input_schema"],
                }
                for t in tools
            ]
        async with httpx.AsyncClient(timeout=90) as client:
            r = await client.post(
                (model.base_url or "https://api.anthropic.com") + "/v1/messages",
                headers={"x-api-key": model.api_key, "anthropic-version": "2023-06-01"},
                json=body,
            )
            r.raise_for_status()
            data = r.json()
        text_parts: list[str] = []
        calls: list[ToolCall] = []
        for block in data.get("content") or []:
            if block.get("type") == "text":
                text_parts.append(block.get("text", ""))
            elif block.get("type") == "tool_use":
                calls.append(
                    ToolCall(id=block["id"], name=block["name"], args=block.get("input") or {})
                )
        usage = data.get("usage") or {}
        raw = {
            "role": "assistant",
            "content": "\n".join(text_parts),
            "tool_calls": [
                {
                    "id": c.id,
                    "type": "function",
                    "function": {"name": c.name, "arguments": json.dumps(c.args)},
                }
                for c in calls
            ]
            or None,
        }
        return LLMResult(
            text="\n".join(text_parts),
            tool_calls=calls,
            tokens_in=int(usage.get("input_tokens") or 0),
            tokens_out=int(usage.get("output_tokens") or 0),
            finish_reason=str(data.get("stop_reason") or "stop"),
            raw_assistant=raw,
        )


def get_llm(model: ModelRef) -> LLMClient:
    if get_settings().llm_mode == "mock" or not model.api_key:
        return MockLLM()
    if model.provider == "anthropic":
        return AnthropicClient()
    return OpenAICompatible()
