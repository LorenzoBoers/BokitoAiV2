import asyncio
import json
import logging
import re
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any, TypeVar

from app.config import get_settings

if TYPE_CHECKING:
    from app.services.tenant_llm import TenantLLMConfig

settings = get_settings()
logger = logging.getLogger(__name__)

T = TypeVar("T")

# Soft 429s: one short retry on the same key+model, then park and fail over
# to the next backing step. Longer backoff stacks hurt chat latency when a
# model is genuinely limited; hard quota (limit=0) still fails immediately.
_RATE_LIMIT_ATTEMPTS = 2
_RATE_LIMIT_BASE_DELAY_S = 1.0
_RATE_LIMIT_MAX_DELAY_S = 20.0


def is_rate_limit_error(exc: BaseException) -> bool:
    """True for provider 429 / rate_limited errors across OpenAI and Anthropic SDKs."""
    name = type(exc).__name__
    if name in ("RateLimitError", "APIStatusError") and getattr(exc, "status_code", None) == 429:
        return True
    if name == "RateLimitError":
        return True
    text = str(exc).lower()
    return (
        "rate limit" in text
        or "rate_limited" in text
        or "error code: 429" in text
        or "'code': '1300'" in text
        or '"code": "1300"' in text
    )


def _retry_after_seconds(exc: BaseException) -> float | None:
    response = getattr(exc, "response", None)
    if response is None:
        return None
    headers = getattr(response, "headers", None)
    if headers is None:
        return None
    raw = None
    try:
        raw = headers.get("retry-after") or headers.get("Retry-After")
    except Exception:  # noqa: BLE001 — header maps vary by SDK
        raw = None
    if raw is None:
        return None
    try:
        return max(0.5, min(float(raw), _RATE_LIMIT_MAX_DELAY_S))
    except (TypeError, ValueError):
        return None


def is_hard_quota_error(exc: BaseException) -> bool:
    """True when the provider reports a request quota of zero (account blocked)."""
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None) if response is not None else None
    if headers is None:
        return False
    try:
        limit = headers.get("x-ratelimit-limit-req-minute")
    except Exception:  # noqa: BLE001 — header maps vary by SDK
        return False
    return limit is not None and str(limit).strip() == "0"


def is_model_unavailable_error(exc: BaseException) -> bool:
    """True when the provider refuses the model for this plan (e.g. Mistral 403 tier)."""
    if getattr(exc, "status_code", None) != 403 and "error code: 403" not in str(exc).lower():
        return False
    text = str(exc).lower()
    return "subscription tier" in text or "not available" in text


def should_fail_over(exc: BaseException) -> bool:
    return is_rate_limit_error(exc) or is_model_unavailable_error(exc)


def is_hard_failure(exc: BaseException) -> bool:
    """Zero quota or plan refusal: retrying the same model will not help."""
    return is_hard_quota_error(exc) or is_model_unavailable_error(exc)


async def with_rate_limit_retry(
    operation: Callable[[], Awaitable[T]],
    *,
    label: str = "llm",
    provider: str = "",
    api_key: str = "",
    model: str = "",
) -> T:
    """Call ``operation``; on rate limit wait and retry a few times.

    When retries run out (or the quota is zero, or the plan refuses the model)
    the key + model pair is parked in ``provider_health`` so the next
    resolution picks the next step of the backing chain.
    """
    from app.services import provider_health

    delay = _RATE_LIMIT_BASE_DELAY_S
    last_exc: BaseException | None = None
    for attempt in range(_RATE_LIMIT_ATTEMPTS):
        try:
            return await operation()
        except Exception as exc:
            last_exc = exc
            if is_model_unavailable_error(exc):
                provider_health.mark_rate_limited(provider or label, api_key, model, hard_quota=True)
                raise
            if not is_rate_limit_error(exc):
                raise
            hard = is_hard_quota_error(exc)
            if hard or attempt >= _RATE_LIMIT_ATTEMPTS - 1:
                provider_health.mark_rate_limited(provider or label, api_key, model, hard_quota=hard)
                raise
            wait = _retry_after_seconds(exc) or delay
            logger.warning(
                "%s rate limited (attempt %s/%s), retry in %.1fs: %s",
                label,
                attempt + 1,
                _RATE_LIMIT_ATTEMPTS,
                wait,
                str(exc)[:200],
            )
            await asyncio.sleep(wait)
            delay = min(delay * 2, _RATE_LIMIT_MAX_DELAY_S)
    assert last_exc is not None
    raise last_exc


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

_DUTCH_HINT_RE = re.compile(
    r"\b(ik|je|jij|u|wij|we|het|een|van|voor|met|niet|nog|graag|bedankt|"
    r"afspraak|factuur|offerte|klacht|dringend|morgen|vandaag|alsjeblieft|"
    r"kunnen|willen|hebben|zijn|goedemorgen|goedemiddag)\b",
    re.IGNORECASE,
)


def _messages_blob(messages: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for message in messages:
        content = message.get("content", "")
        if isinstance(content, str):
            parts.append(content)
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    parts.append(str(block.get("text", "")))
    return "\n".join(parts)


def _detect_mock_language(messages: list[dict[str, Any]]) -> str:
    """Prefer NL when instructions or the customer message point that way."""
    blob = _messages_blob(messages)
    low = blob.lower()
    if (
        "write the reply body in dutch" in low
        or "write every reply in dutch" in low
        or "must be written in dutch" in low
    ):
        return "nl"
    if (
        "write the reply body in english" in low
        or "write every reply in english" in low
        or "must be written in english" in low
    ):
        return "en"
    last_user = _last_user_text(messages)
    # AUTO: mirror the customer when their message clearly looks Dutch.
    if _DUTCH_HINT_RE.search(last_user):
        return "nl"
    # Workspace / UI default often Dutch — prefer NL when instructions mention it.
    if "in dutch" in low or "dutch workspace" in low:
        return "nl"
    return "en"


def _mock_ack(lang: str) -> str:
    if lang == "nl":
        return (
            "Bedankt voor je bericht. We hebben je verzoek ontvangen "
            "en nemen spoedig contact met je op."
        )
    return (
        "Thank you for your message. We have received your request "
        "and will follow up shortly."
    )


def _mock_placeholder(lang: str, topic: str) -> str:
    if lang == "nl":
        return (
            f"Ik heb je bericht ontvangen over: {topic}. "
            "Dit is een tijdelijk antwoord zolang de workspace zonder live model draait."
        )
    return (
        f"I received your message about: {topic}. "
        "This is a placeholder reply while the workspace runs without a live model."
    )


def _mock_prepared(lang: str) -> str:
    if lang == "nl":
        return (
            "Bedankt voor je bericht. Ik heb je vraag bekeken en de details "
            "hieronder klaargezet. Laat het weten als er iets mist, dan volgen we op."
        )
    return (
        "Thank you for reaching out. I looked into your question and "
        "prepared the details below. Let us know if anything is missing "
        "and we will follow up right away."
    )


def _mock_topic(last_user: str) -> str:
    """Short human topic for the mock echo: prefer the mail subject line."""
    subject_match = re.search(r"^Subject:\s*(.+)$", last_user, re.MULTILINE)
    if subject_match:
        return subject_match.group(1).strip()[:120]
    stripped = last_user.strip()
    first_line = stripped.splitlines()[0] if stripped else ""
    return first_line[:120]


# Claude 5+ rejects ``thinking.type.enabled`` + ``budget_tokens``; it takes
# ``adaptive`` with an effort level. Older ids that answer with that 400 are
# learned at runtime.
_ADAPTIVE_THINKING_MODELS: set[str] = set()
_CLAUDE_MAJOR_RE = re.compile(r"claude-[a-z]+-(\d+)")


def _uses_adaptive_thinking(model: str) -> bool:
    if model in _ADAPTIVE_THINKING_MODELS:
        return True
    match = _CLAUDE_MAJOR_RE.search(model or "")
    return bool(match) and int(match.group(1)) >= 5


def _learn_adaptive_thinking(exc: BaseException, model: str) -> bool:
    """Remember ``model`` needs adaptive thinking when the API says so."""
    if "thinking.type.adaptive" not in str(exc) or model in _ADAPTIVE_THINKING_MODELS:
        return False
    _ADAPTIVE_THINKING_MODELS.add(model)
    return True


_MISTRAL_REASONING_PREFIXES = ("mistral-medium", "mistral-small")


def _thinking_effort(budget: int) -> str:
    if budget <= 2048:
        return "low"
    if budget <= 8192:
        return "medium"
    return "high"


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
        lang = _detect_mock_language(messages)
        ack = _mock_ack(lang)
        tool_loop_count = sum(
            1 for m in messages if m.get("role") == "user" and isinstance(m.get("content"), list)
        )
        # Suggest-only email drafts run with an empty toolset.
        if (not tools) and (
            "Draft a concise" in last_user or "inbound email" in last_user.lower()
        ):
            return {
                "stop_reason": "end_turn",
                "content": [{"type": "text", "text": ack}],
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
                                            "body": ack,
                                            "body_text": ack,
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
                "content": [{"type": "text", "text": _mock_prepared(lang)}],
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
                "content": [{"type": "text", "text": ack}],
                "usage": {"input_tokens": 10, "output_tokens": 20},
            }
        return {
            "stop_reason": "end_turn",
            "content": [
                {
                    "type": "text",
                    "text": _mock_placeholder(lang, _mock_topic(last_user)),
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
            if _uses_adaptive_thinking(kwargs["model"]):
                kwargs["thinking"] = {"type": "adaptive"}
                kwargs["output_config"] = {"effort": _thinking_effort(thinking_budget)}
            else:
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
        def _kwargs() -> dict[str, Any]:
            return self._create_kwargs(
                model=model,
                system=system,
                chat_messages=chat_messages,
                tools=tools,
                thinking_budget=thinking_budget,
                max_tokens=max_tokens,
            )

        async def _create():
            create_kwargs = _kwargs()
            try:
                return await client.messages.create(**create_kwargs)
            except Exception as exc:
                if not _learn_adaptive_thinking(exc, create_kwargs["model"]):
                    raise
                return await client.messages.create(**_kwargs())

        response = await with_rate_limit_retry(
            _create,
            label="anthropic.chat",
            provider="anthropic",
            api_key=self.api_key or "",
            model=model or settings.default_chat_model,
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
        for attempt in range(2):
            create_kwargs = self._create_kwargs(
                model=model,
                system=system,
                chat_messages=chat_messages,
                tools=tools,
                thinking_budget=thinking_budget,
                max_tokens=max_tokens,
            )
            started = False
            try:
                async for event in self._stream_events(client, create_kwargs):
                    started = True
                    yield event
                return
            except Exception as exc:
                if started or attempt or not _learn_adaptive_thinking(exc, create_kwargs["model"]):
                    raise

    @staticmethod
    async def _stream_events(client: Any, create_kwargs: dict[str, Any]):
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
        self.provider_type = "openai"

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
        extra_body = _reasoning_extra_body(self.provider_type, create_kwargs["model"], thinking_budget)
        if extra_body:
            create_kwargs["extra_body"] = extra_body
        oai_tools = self._tools_to_openai(tools)
        if oai_tools:
            create_kwargs["tools"] = oai_tools

        async def _create():
            return await client.chat.completions.create(**create_kwargs)

        response = await with_rate_limit_retry(
            _create,
            label="openai.chat",
            provider=self.provider_type,
            api_key=self.api_key or "",
            model=create_kwargs["model"],
        )
        choice = response.choices[0]
        msg = choice.message
        content: list[dict[str, Any]] = []
        _, answer_text = _split_content_chunks(msg.content)
        if answer_text:
            content.append({"type": "text", "text": answer_text})
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
        extra_body = _reasoning_extra_body(self.provider_type, create_kwargs["model"], thinking_budget)
        if extra_body:
            create_kwargs["extra_body"] = extra_body
        oai_tools = self._tools_to_openai(tools)
        if oai_tools:
            create_kwargs["tools"] = oai_tools

        async def _open_stream():
            return await client.chat.completions.create(**create_kwargs)

        stream = await with_rate_limit_retry(
            _open_stream,
            label="openai.stream",
            provider=self.provider_type,
            api_key=self.api_key or "",
            model=create_kwargs["model"],
        )
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
            thinking_text, answer_text = _split_content_chunks(delta.content)
            if thinking_text:
                yield {"type": "thinking", "text": thinking_text}
            if answer_text:
                text_parts.append(answer_text)
                yield {"type": "delta", "text": answer_text}
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


def _reasoning_extra_body(provider_type: str, model: str, thinking_budget: int) -> dict[str, Any] | None:
    """Mistral hybrid models keep their reasoning hidden unless asked for it."""
    if provider_type != "mistral" or thinking_budget <= 0:
        return None
    if not model.startswith(_MISTRAL_REASONING_PREFIXES):
        return None
    return {"reasoning_effort": "high"}


def _chunk_field(chunk: Any, name: str) -> Any:
    if isinstance(chunk, dict):
        return chunk.get(name)
    return getattr(chunk, name, None)


def _split_content_chunks(content: Any) -> tuple[str, str]:
    """``(thinking, text)`` from a message or delta ``content``.

    Plain strings are answer text. With ``reasoning_effort`` Mistral sends a
    list of chunks instead: ``thinking`` chunks (holding text chunks) and
    ``text`` chunks.
    """
    if content is None:
        return "", ""
    if isinstance(content, str):
        return "", content
    thinking: list[str] = []
    text: list[str] = []
    for chunk in content if isinstance(content, list) else [content]:
        kind = _chunk_field(chunk, "type")
        if kind == "thinking":
            inner = _chunk_field(chunk, "thinking")
            if isinstance(inner, str):
                thinking.append(inner)
            else:
                for part in inner or []:
                    value = _chunk_field(part, "text")
                    if isinstance(value, str):
                        thinking.append(value)
        elif kind == "text":
            value = _chunk_field(chunk, "text")
            if isinstance(value, str):
                text.append(value)
    return "".join(thinking), "".join(text)


def get_chat_provider(provider_type: str, api_key: str, base_url: str | None = None):
    """Return a chat provider instance by provider type (or mock when unknown)."""
    if provider_type == "anthropic" and api_key:
        return AnthropicLLMProvider(api_key=api_key, base_url=base_url)
    if provider_type == "mistral" and api_key:
        from app.services.provider_presets import MISTRAL_BASE_URL

        # Mistral exposes an OpenAI-compatible Chat Completions API (EU-hosted).
        provider = OpenAILLMProvider(api_key=api_key, base_url=base_url or MISTRAL_BASE_URL)
        provider.provider_type = "mistral"
        return provider
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
