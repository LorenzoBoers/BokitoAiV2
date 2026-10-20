import pytest

from app.services.conversation_title import (
    apply_title_once,
    intent_title,
    is_placeholder_subject,
    maybe_apply_intent_title,
    normalize_ai_title,
)


def test_placeholder_subjects():
    assert is_placeholder_subject("New conversation")
    assert is_placeholder_subject("Website chat")
    assert is_placeholder_subject("  ")
    assert not is_placeholder_subject("Invoice check")


def test_intent_title_compresses_long_first_line():
    long = (
        "Can you walk through the whole onboarding for Acme including the "
        "token budget, the project agent, and how queue items move?"
    )
    title = intent_title(long)
    assert title
    assert title != long
    assert len(title) <= 48
    assert "onboarding" in title.lower() or "walk" in title.lower()


def test_intent_title_keeps_a_short_request():
    assert intent_title("Check the Acme invoice") == "Check the Acme invoice"


def test_intent_title_strips_greeting():
    assert intent_title("Hoi, kun je de factuur van Acme checken?") == "kun je de factuur van Acme checken?"


def test_normalize_ai_title_strips_quotes_and_emoji():
    assert normalize_ai_title('"Younique gesprekken"') == "Younique gesprekken"
    assert "😊" not in normalize_ai_title("Factuur Acme 😊")
    assert len(normalize_ai_title("x" * 80)) <= 48


def test_maybe_apply_writes_once():
    class Row:
        subject = "New conversation"
        id = None

    row = Row()
    first = maybe_apply_intent_title(row, "Help with invoices please and also the budget")
    assert first
    assert first != "New conversation"
    assert maybe_apply_intent_title(row, "A completely different follow-up") is None
    assert row.subject == first


def test_apply_title_once_sets_provisional_without_id():
    class Row:
        subject = "New conversation"
        id = None

    row = Row()
    apply_title_once(row, "Laat mij even weten welke gesprekken ik met Younique heb gehad")
    assert row.subject != "New conversation"
    assert "Laat mij even weten" in row.subject or "gesprekken" in row.subject.lower()


@pytest.mark.asyncio
async def test_refine_ai_title_upgrades_provisional(monkeypatch):
    from uuid import uuid4

    from app.services import conversation_title as ct

    signal_id = uuid4()
    provisional = "Laat mij even weten welke gesprekken ik"
    seed = "Laat mij even weten welke gesprekken ik met Younique heb gehad in de afgelopen maand"

    class FakeSignal:
        def __init__(self):
            self.id = signal_id
            self.tenant_id = uuid4()
            self.subject = provisional
            self.channel = "assistant"

    fake = FakeSignal()
    published: list[str] = []

    class FakeSession:
        async def get(self, _model, _id):
            return fake

        def add(self, _obj):
            return None

        async def commit(self):
            return None

        async def refresh(self, obj):
            return None

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_exc):
            return None

    class FakeResolved:
        provider_type = "mock"
        api_key = ""
        base_url = ""
        model_id = "mock"
        provider = "mock"
        slug = "mock"
        region = "eu"
        billable = False
        key_source = "mock"
        input_cost_per_mtok_cents = 0
        output_cost_per_mtok_cents = 0
        markup = 1.0
        bill_input_cost_per_mtok_cents = None
        bill_output_cost_per_mtok_cents = None

    class FakeLLM:
        async def chat(self, messages, model=None, max_tokens=None):
            return {
                "stop_reason": "end_turn",
                "content": [{"type": "text", "text": "Younique gesprekken afgelopen maand"}],
                "usage": {"input_tokens": 5, "output_tokens": 4},
            }

    monkeypatch.setattr(ct.asyncio, "sleep", _noop_sleep)
    monkeypatch.setattr(
        "app.db.session.async_session_factory",
        lambda: FakeSession(),
    )
    monkeypatch.setattr(
        "app.services.model_resolution.resolve_model_call",
        _async_return(FakeResolved()),
    )
    monkeypatch.setattr(
        "app.services.model_resolution.record_usage",
        _async_return(None),
    )
    monkeypatch.setattr(
        "app.services.agent.llm.get_chat_provider",
        lambda *_a, **_k: FakeLLM(),
    )
    monkeypatch.setattr(
        "app.gateway.publish.publish_thread_update",
        _async_capture(published),
    )

    title = await ct.refine_ai_title(signal_id, provisional=provisional, seed_text=seed)
    assert title == "Younique gesprekken afgelopen maand"
    assert fake.subject == title
    assert published == [title]


@pytest.mark.asyncio
async def test_refine_ai_title_skips_manual_rename(monkeypatch):
    from uuid import uuid4

    from app.services import conversation_title as ct

    signal_id = uuid4()
    provisional = "Laat mij even weten welke"

    class FakeSignal:
        id = signal_id
        tenant_id = uuid4()
        subject = "Handmatige titel"
        channel = "assistant"

    class FakeSession:
        async def get(self, _model, _id):
            return FakeSignal()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_exc):
            return None

    monkeypatch.setattr(ct.asyncio, "sleep", _noop_sleep)
    monkeypatch.setattr(
        "app.db.session.async_session_factory",
        lambda: FakeSession(),
    )

    assert await ct.refine_ai_title(signal_id, provisional=provisional, seed_text="x") is None


async def _noop_sleep(_seconds: float) -> None:
    return None


def _async_return(value):
    async def _inner(*_a, **_k):
        return value

    return _inner


def _async_capture(bucket: list[str]):
    async def _inner(signal):
        bucket.append(signal.subject)

    return _inner
