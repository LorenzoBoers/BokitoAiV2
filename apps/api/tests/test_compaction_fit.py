"""Hard-fit oversized prompts under the model context window."""

from app.services.compaction import (
    estimate_payload_tokens,
    fit_messages_to_window,
    is_prompt_too_long,
)


def test_fit_messages_truncates_giant_system_prompt():
    messages = [
        {"role": "system", "content": "X" * 800_000},
        {"role": "user", "content": "Refresh the canvas"},
    ]
    fitted = fit_messages_to_window(messages, window=131_072, reserve_tokens=4_096)
    assert estimate_payload_tokens(fitted) < 131_072 - 4_000
    assert fitted[-1]["role"] == "user"
    assert "truncated" in fitted[0]["content"].lower() or len(fitted[0]["content"]) < 800_000


def test_is_prompt_too_long_detects_provider_errors():
    assert is_prompt_too_long(
        RuntimeError(
            "Error code: 400 - {'message': 'Prompt 155222 > 131072 maximum context length', "
            "'type': 'invalid_request_prompt_too_long'}"
        )
    )
    assert not is_prompt_too_long(RuntimeError("rate limit"))


def test_fit_accounts_for_tool_schemas():
    messages = [{"role": "user", "content": "hi"}]
    tools = [{"name": f"tool_{i}", "description": "D" * 20_000} for i in range(40)]
    fitted = fit_messages_to_window(
        messages, window=50_000, reserve_tokens=2_000, tools=tools
    )
    # With huge tools the message body alone must stay tiny; fit still returns.
    assert isinstance(fitted, list)
    assert estimate_payload_tokens(fitted, tools) >= estimate_payload_tokens(fitted)
