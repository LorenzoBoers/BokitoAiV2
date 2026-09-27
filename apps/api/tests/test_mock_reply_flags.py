"""Mock LLM replies prefer NL when instructions or customer text are Dutch."""

import pytest

from app.services.agent.llm import MockLLMProvider, _detect_mock_language
from app.services.signal_threads import (
    message_delivered_to_customer,
    message_is_mock,
)


def test_detect_mock_language_from_dutch_customer():
    messages = [
        {"role": "system", "content": "## Language\n- mirror the customer's message"},
        {"role": "user", "content": "Hallo, ik wil graag een afspraak morgen."},
    ]
    assert _detect_mock_language(messages) == "nl"


def test_detect_mock_language_from_dutch_instruction():
    messages = [
        {"role": "system", "content": "Write every reply in Dutch."},
        {"role": "user", "content": "Hello there"},
    ]
    assert _detect_mock_language(messages) == "nl"


@pytest.mark.asyncio
async def test_mock_llm_replies_in_dutch_for_nl_customer():
    provider = MockLLMProvider()
    result = await provider.chat(
        [
            {"role": "system", "content": "Write the reply body in Dutch."},
            {
                "role": "user",
                "content": "New inbound email message from jan@example.com\nSubject: Factuur\n\nIk heb een vraag over mijn factuur.",
            },
        ]
    )
    text = result["content"][0]["text"]
    assert "tijdelijk antwoord" in text.lower() or "bedankt" in text.lower()
    assert "placeholder reply" not in text.lower()


def test_message_is_mock_from_body_and_metadata():
    assert message_is_mock(
        "I received your message about: hello. This is a placeholder reply while the workspace runs without a live model."
    )
    assert message_is_mock(
        "Ik heb je bericht ontvangen over: factuur. Dit is een tijdelijk antwoord zolang de workspace zonder live model draait."
    )
    assert message_is_mock("Thanks", {"llm_mode": "mock"})
    assert not message_is_mock("We will ship tomorrow.", {"llm_mode": "live"})


def test_mock_never_delivered_to_customer():
    assert (
        message_delivered_to_customer(
            direction="outbound",
            auto_sent=True,
            send_status="sent",
            is_mock=True,
        )
        is False
    )
    assert (
        message_delivered_to_customer(
            direction="outbound",
            auto_sent=True,
            send_status="sent",
            is_mock=False,
        )
        is True
    )
