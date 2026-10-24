"""Shared fakes for the orchestration_v2 suite.

Everything here is local and mocked. No paid STT/TTS/LLM call, no network,
no storage writes. Any accidental paid call fails the test loudly.

Parent fixtures (``client``, ``session_override``) come from tests/conftest.py:
in-memory SQLite, BOKITO_MOCK_EXECUTION=true, ARQ/redis/ring mocked.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import select

from _v2_support import FakeStorage, FakeVoice, Timeline  # noqa: E402


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "orch_v2: stricter orchestration/voice suite")


@pytest.fixture(scope="session", autouse=True)
def _warm_imports():
    """Import lazily-imported modules once so latency budgets measure a warm
    worker (per-request cost), not Python's first import in this process."""
    import importlib

    for name in (
        "app.services.intercom",
        "app.services.agent_turns",
        "app.services.participants",
        "app.services.job_card",
        "app.services.conversation_moves",
        "app.services.agent_call_voice",
        "app.services.voice_models",
        "app.services.dock_agents",
        "app.services.storage",
        "app.gateway.publish",
        "app.models.agent_call",
        "app.models.agent_turn",
    ):
        try:
            importlib.import_module(name)
        except Exception:  # noqa: BLE001 - a missing module just stays cold
            pass
    yield


@pytest.fixture
def timeline() -> Timeline:
    return Timeline()


@pytest.fixture
def fake_voice(timeline: Timeline) -> FakeVoice:
    return FakeVoice(timeline=timeline)


@pytest.fixture(autouse=True)
def _no_paid_calls(monkeypatch: pytest.MonkeyPatch, fake_voice: FakeVoice, timeline: Timeline):
    """Fake STT/TTS/storage/publish; any real LLM provider call fails the test."""
    import app.services.agent_call_voice as acv
    import app.services.intercom as intercom

    monkeypatch.setattr(acv, "transcribe_speech", fake_voice.transcribe)
    monkeypatch.setattr(acv, "synthesize_speech", fake_voice.synthesize)
    monkeypatch.setattr("app.services.storage.get_storage_backend", lambda: FakeStorage())
    monkeypatch.setattr(
        "app.services.voice_models.resolve_voice_models",
        AsyncMock(return_value={"tts_model": "fake-tts", "stt_model": "fake-stt", "realtime_model": "fake-rt"}),
    )

    async def _published(_session, note):
        timeline.mark(f"note_{note.kind}", note.text or "")

    monkeypatch.setattr(intercom, "publish_note", _published)
    monkeypatch.setattr("app.gateway.publish.publish_signal_message", AsyncMock())
    monkeypatch.setattr("app.gateway.publish.publish_thread_update", AsyncMock())

    def _paid(*_a: Any, **_k: Any):
        raise AssertionError("orchestration_v2: a real LLM provider was requested (must stay mocked)")

    monkeypatch.setattr("app.services.agent.llm.get_chat_provider", _paid)
    yield


@pytest.fixture
def route_fake(monkeypatch: pytest.MonkeyPatch, timeline: Timeline):
    """Replace the LLM router ``decide`` and the shortcut lookups with a fake.

    Returns a mutable config: ``cfg.delay_s``, ``cfg.ack``, ``cfg.done``.
    """
    import app.services.intercom as intercom

    cfg = SimpleNamespace(delay_s=0.25, ack="Ik zoek het voor je uit.", done=False, calls=0)

    async def _decide(session, **kw):
        cfg.calls += 1
        await asyncio.sleep(cfg.delay_s)
        timeline.mark("route_done", cfg.ack)
        return {
            "decision": intercom.STAY,
            "thread_id": "",
            "title": "",
            "carry": [],
            "ack": cfg.ack,
            "done": cfg.done,
            "refs": {},
            "threads": {},
        }

    monkeypatch.setattr(intercom, "decide", _decide)
    monkeypatch.setattr(intercom, "_fact_from_open_thread", AsyncMock(return_value=None))
    monkeypatch.setattr(intercom, "_spoken_job_shortcut", AsyncMock(return_value=None))
    monkeypatch.setattr("app.services.job_card.resolve", lambda text, job, lang: {"job": None, "missing": []})
    monkeypatch.setattr("app.services.job_card.should_ask", lambda card: False)
    monkeypatch.setattr("app.services.job_card.pack", lambda prompt, card: prompt)
    return cfg


@pytest_asyncio.fixture
async def seeded(client, session_override):
    """(tenant, user, agent) from the parent conftest seed."""
    from app.models.agent import Agent
    from app.models.auth import Tenant, User
    from scripts.seed import TEST_EMAIL

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    agent = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == tenant.id, Agent.slug == "assistant")
        )
    ).scalar_one()
    return SimpleNamespace(tenant=tenant, user=user, agent=agent, session=session_override)


