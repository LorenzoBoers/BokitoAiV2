from types import SimpleNamespace

from app.services.agent.llm import _reasoning_extra_body, _split_content_chunks


def test_reasoning_requested_only_for_mistral_hybrid_models_with_budget():
    assert _reasoning_extra_body("mistral", "mistral-medium-latest", 1024) == {"reasoning_effort": "high"}
    assert _reasoning_extra_body("mistral", "mistral-small-latest", 1024) == {"reasoning_effort": "high"}
    assert _reasoning_extra_body("mistral", "mistral-medium-latest", 0) is None
    assert _reasoning_extra_body("mistral", "mistral-large-4", 1024) is None
    assert _reasoning_extra_body("openai", "mistral-medium-latest", 1024) is None


def test_split_plain_string_is_answer_text():
    assert _split_content_chunks("Hallo") == ("", "Hallo")
    assert _split_content_chunks(None) == ("", "")


def test_split_thinking_and_text_chunks_from_dicts():
    content = [
        {"type": "thinking", "thinking": [{"type": "text", "text": "Even nadenken. "}]},
        {"type": "text", "text": "Het antwoord is 4."},
    ]
    assert _split_content_chunks(content) == ("Even nadenken. ", "Het antwoord is 4.")


def test_split_thinking_chunks_from_sdk_objects():
    chunk = SimpleNamespace(type="thinking", thinking=[SimpleNamespace(type="text", text="2 plus 2")])
    assert _split_content_chunks([chunk]) == ("2 plus 2", "")
