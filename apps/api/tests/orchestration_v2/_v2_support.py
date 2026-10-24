"""Fakes and budgets for the orchestration_v2 suite (imported by tests and conftest)."""

from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

# N >= 5 repeats per scenario (override with ORCH_V2_REPEATS, floor 5).
REPEATS = max(5, int(os.getenv("ORCH_V2_REPEATS", "5")))

# Strict budgets (ms). Measured on the wall clock from "utterance ended"
# (recording handed to handle_utterance) to the ack note being published.
ACK_BUDGET_MS = int(os.getenv("ORCH_V2_ACK_BUDGET_MS", "1200"))
# How quickly the person must hear a failure after the backend reports it.
FAILURE_NOTICE_BUDGET_MS = int(os.getenv("ORCH_V2_FAILURE_BUDGET_MS", "1000"))


@dataclass
class Timeline:
    """Monotonic event log: (t_ms since start, event, detail)."""

    t0: float = field(default_factory=time.perf_counter)
    events: list[tuple[float, str, str]] = field(default_factory=list)

    def reset(self) -> None:
        self.t0 = time.perf_counter()
        self.events.clear()

    def mark(self, event: str, detail: str = "") -> float:
        t = (time.perf_counter() - self.t0) * 1000.0
        self.events.append((t, event, detail))
        return t

    def first(self, event: str) -> float | None:
        return next((t for t, e, _ in self.events if e == event), None)

    def dump(self) -> str:
        return "\n".join(f"{t:8.1f} ms  {e:<14} {d}" for t, e, d in self.events)


@dataclass
class FakeVoice:
    """Stand-in for transcribe_speech / synthesize_speech with set latencies."""

    timeline: Timeline
    transcript: str = ""
    stt_delay_s: float = 0.15
    tts_delay_s: float = 0.20
    stt_calls: int = 0
    tts_calls: list[str] = field(default_factory=list)

    async def transcribe(self, audio: bytes, **_kw: Any) -> str:
        self.stt_calls += 1
        await asyncio.sleep(self.stt_delay_s)
        self.timeline.mark("stt_done", self.transcript)
        return self.transcript

    async def synthesize(self, text: str, **_kw: Any) -> bytes:
        await asyncio.sleep(self.tts_delay_s)
        self.tts_calls.append(text)
        self.timeline.mark("tts_done", text)
        return b"ID3fake-mp3"


class FakeStorage:
    async def store(self, *, data: bytes, filename: str, mime: str, tenant_id: str):
        return SimpleNamespace(
            id="fake", name=filename, mime=mime, size=len(data), url="", storage_key=f"fake/{filename}"
        )


class BackendError(RuntimeError):
    pass


@dataclass
class FakeBackend:
    """Mock work backend: ok, slow (within timeout), fail, or timeout."""

    mode: str
    timeline: Timeline
    timeout_s: float = 0.3
    confirmation: str = "De factuur voor Café Luna is verstuurd (referentie F-2026-0142)."

    async def _work(self) -> str:
        if self.mode == "ok":
            await asyncio.sleep(0.05)
            return self.confirmation
        if self.mode == "slow":
            await asyncio.sleep(self.timeout_s * 0.8)
            return self.confirmation
        if self.mode == "fail":
            await asyncio.sleep(0.05)
            raise BackendError("SMTP 550: mailbox unavailable")
        if self.mode == "timeout":
            await asyncio.sleep(30)
            return self.confirmation  # never reached
        raise ValueError(self.mode)

    async def run(self) -> tuple[str, str]:
        """Returns (status, detail): status in confirmed | failed | timeout."""
        self.timeline.mark("backend_start", self.mode)
        try:
            out = await asyncio.wait_for(self._work(), timeout=self.timeout_s)
        except asyncio.TimeoutError:
            self.timeline.mark("backend_timeout")
            return "timeout", "geen bevestiging binnen de tijd"
        except BackendError as exc:
            self.timeline.mark("backend_failed", str(exc))
            return "failed", str(exc)
        self.timeline.mark("backend_confirmed", out)
        return "confirmed", out


# Dutch phrase sets shared by several files.
# A completion claim, not a negated one ("niet verstuurd" is honest).
SUCCESS_CLAIM = r"(?i)(?<!niet )(?<!geen )\b(gedaan|verstuurd|verzonden|klaar|geboekt|betaald|afgerond|gelukt|done|sent)\b"
FAILURE_WORDS = r"(?i)(niet gelukt|mislukt|lukte niet|fout|time-?out|geen bevestiging|niet verstuurd|niet gedaan|kon niet)"
