"""Rule 2: turn-taking and barge-in.

Pass criteria:
  R2.1  Hold-to-talk sessions disable server VAD (turn_detection is None):
        the agent can only answer after the person releases = a complete utterance.
  R2.2  Open-mic live calls configure turn detection explicitly and patiently:
        semantic_vad with eagerness != "high", or server_vad with
        silence_duration_ms >= 700. Relying on the provider default is a fail
        (the code comment itself says server VAD answers mid-sentence).
  R2.3  End-of-utterance detector: incomplete Dutch
        fragments ("Kun je de factuur van", "Ik wil eh") are NOT complete;
        full sentences with >= 700 ms trailing silence are.
  R2.4  Barge-in classifier: backchannels ('ja', 'oké',
        'hmm', 'mm-hm', 'ja ja') -> keep speaking; real interruptions
        ('wacht even', 'stop', 'nee, dat bedoel ik niet', ...) -> yield.
  R2.5  Voice dock: a backchannel ('ja', 'oké', 'hmm', 'mm-hm') while a
        spoken ask is working does NOT start or supersede a turn; a real
        interruption ('nee wacht, het is Bakkerij De Vries') does.
All checks run REPEATS (>= 5) times and must give identical answers.
(R2.3/R2.4 turn into xfail automatically if app.services.turn_taking is missing.)
"""

from __future__ import annotations

from typing import Any

import pytest

from _v2_support import REPEATS


class _Captured(Exception):
    pass


async def _payload(monkeypatch: pytest.MonkeyPatch, *, push_to_talk: bool) -> dict[str, Any]:
    """Run create_realtime_secret with a fake HTTP client; no request leaves the box."""
    import app.services.agent_call_voice as acv
    from app.config import get_settings

    seen: dict[str, Any] = {}

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, *, headers=None, json=None, **_k):
            assert "openai.com" in url
            seen["payload"] = json
            raise _Captured()

    monkeypatch.setattr(get_settings(), "openai_api_key", "sk-test-not-real")
    monkeypatch.setattr(acv.httpx, "AsyncClient", _FakeClient)
    monkeypatch.setattr("app.services.voice_models.cached_platform_tier", lambda: "standard", raising=False)
    try:
        await acv.create_realtime_secret("Je bent Ada.", language="nl", push_to_talk=push_to_talk)
    except _Captured:
        pass
    except Exception:  # noqa: BLE001 - status_error after the capture is fine
        pass
    assert "payload" in seen, "create_realtime_secret did not build a request"
    return seen["payload"]


@pytest.mark.parametrize("run", range(REPEATS))
async def test_r2_push_to_talk_never_answers_mid_sentence(run, monkeypatch):
    payload = await _payload(monkeypatch, push_to_talk=True)
    audio_in = payload["session"]["audio"]["input"]
    assert "turn_detection" in audio_in and audio_in["turn_detection"] is None, audio_in


@pytest.mark.parametrize("run", range(REPEATS))
async def test_r2_open_mic_turn_detection_is_explicit_and_patient(run, monkeypatch):
    payload = await _payload(monkeypatch, push_to_talk=False)
    audio_in = payload["session"]["audio"]["input"]
    td = audio_in.get("turn_detection", "<provider default>")
    assert isinstance(td, dict), (
        f"R2.2: open-mic call relies on the provider default turn detection ({td!r}); "
        "set semantic_vad (eagerness low/auto) or server_vad silence_duration_ms >= 700"
    )
    if td.get("type") == "semantic_vad":
        assert td.get("eagerness", "auto") != "high", td
    else:
        assert td.get("type") == "server_vad", td
        assert int(td.get("silence_duration_ms", 0)) >= 700, td


# --- R2.3 / R2.4: no hook in the codebase yet ---------------------------------

try:  # the interface these rules should satisfy
    from app.services.turn_taking import classify_barge_in, is_complete_utterance  # type: ignore

    _HAS_HOOK = True
except ImportError:  # pragma: no cover - expected today
    _HAS_HOOK = False

_NO_HOOK = pytest.mark.xfail(
    not _HAS_HOOK,
    strict=False,
    reason="No hook: there is no endpointing/barge-in module (dock is push-to-talk, live calls use "
    "provider VAD). Expected interface: app.services.turn_taking.is_complete_utterance(text, "
    "trailing_silence_ms) -> bool and classify_barge_in(text) -> 'backchannel' | 'interrupt'.",
)

INCOMPLETE = [
    ("Kun je de factuur van", 300),
    ("Ik wil eh", 400),
    ("Stuur de offerte naar", 250),
    ("En dan moet je nog even", 350),
    ("Vraag aan Bram of hij", 300),
]
COMPLETE = [
    ("Kun je de factuur van Café Luna versturen?", 800),
    ("Plan een afspraak met Jansen op dinsdag.", 900),
    ("Wat staat er nog open bij Studio Noord?", 750),
    ("Vraag Bram of de jaarrekening klaar is.", 800),
    ("Zet de debiteurenlijst op een rij.", 1000),
]
BACKCHANNELS = ["ja", "oké", "hmm", "mm-hm", "ja ja", "oké oké", "mhm", "ja, ja"]
INTERRUPTS = [
    "wacht even",
    "stop",
    "nee, dat bedoel ik niet",
    "ho ho, niet versturen",
    "kun je eerst Bram bellen?",
    "nee wacht, het is Bakkerij De Vries",
]


@_NO_HOOK
@pytest.mark.parametrize("run", range(REPEATS))
def test_r2_end_of_utterance_detector(run):
    for text, silence in INCOMPLETE:
        assert is_complete_utterance(text, trailing_silence_ms=silence) is False, text
    for text, silence in COMPLETE:
        assert is_complete_utterance(text, trailing_silence_ms=silence) is True, text


@_NO_HOOK
@pytest.mark.parametrize("run", range(REPEATS))
def test_r2_barge_in_ignores_backchannels_yields_on_interrupts(run):
    for text in BACKCHANNELS:
        assert classify_barge_in(text) == "backchannel", text
    for text in INTERRUPTS:
        assert classify_barge_in(text) == "interrupt", text


async def _dock_say(seeded, fake_voice, text):
    from app.services.intercom import handle_utterance

    fake_voice.transcript = text
    return await handle_utterance(
        seeded.session,
        seeded.tenant.id,
        seeded.user,
        agent_id=seeded.agent.id,
        audio=b"fake-webm",
        filename="n.webm",
        mime="audio/webm",
    )


@pytest.mark.parametrize("run", range(REPEATS))
async def test_r2_dock_backchannel_keeps_the_running_work(run, seeded, fake_voice, timeline, route_fake):
    from sqlalchemy import select

    from app.models.agent_turn import AgentTurn

    first = await _dock_say(seeded, fake_voice, "Zoek uit welke offertes voor Bakkerij De Vries nog openstaan.")
    assert first.get("working") is True, first

    async def turns():
        return (
            await seeded.session.execute(
                select(AgentTurn.id, AgentTurn.status, AgentTurn.outcome)
                .where(AgentTurn.agent_id == seeded.agent.id, AgentTurn.cause_kind == "intercom")
                .order_by(AgentTurn.created_at)
            )
        ).all()

    before = await turns()
    assert len(before) == 1 and before[0].status == "queued", before
    for text in ["ja", "oké", "hmm", "mm-hm", "ja ja"]:
        res = await _dock_say(seeded, fake_voice, text)
        assert res.get("backchannel") is True, (text, res)
    after = await turns()
    assert [(t.id, t.status) for t in after] == [(before[0].id, "queued")], (
        f"R2.5: a backchannel started or superseded work: {after}"
    )

    res = await _dock_say(seeded, fake_voice, "nee wacht, het is Bakkerij De Vries")
    assert not res.get("backchannel"), res
    final = await turns()
    assert len(final) == 2, final
    assert final[0].outcome == "superseded" and final[1].status == "queued", final
