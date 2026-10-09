"""Heuristic: modules that construct SignalMessage must publish (or import helpers).

The entity_events post-commit safety net covers forgotten publishes, but new
writers should still call ``publish_signal_message`` / ``publish_thread_update``
so metadata and intent stay explicit. This scan fails the CI when a production
module adds ``SignalMessage(`` without mentioning a gateway publish helper.
"""

from __future__ import annotations

from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1] / "app"

# Definition / seed-style paths that create rows without being live writers.
_ALLOWLIST = {
    "models/signal.py",
    "services/onboarding_demo.py",
}

_PUBLISH_MARKERS = (
    "publish_signal_message",
    "publish_thread_update",
    "from app.gateway.publish",
    "from app.gateway import",
)


def _rel(path: Path) -> str:
    return path.relative_to(APP_ROOT).as_posix()


def test_signal_message_writers_import_publish_helpers():
    offenders: list[str] = []
    for path in sorted(APP_ROOT.rglob("*.py")):
        rel = _rel(path)
        if rel in _ALLOWLIST:
            continue
        text = path.read_text(encoding="utf-8")
        if "SignalMessage(" not in text:
            continue
        if any(marker in text for marker in _PUBLISH_MARKERS):
            continue
        offenders.append(rel)
    assert offenders == [], (
        "Modules that construct SignalMessage must import/call a gateway "
        f"publish helper (or be allowlisted): {offenders}"
    )
