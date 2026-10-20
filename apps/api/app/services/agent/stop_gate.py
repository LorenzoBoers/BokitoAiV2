"""Stop rule for one agent turn.

Derived from xai-org/grok-build (Apache-2.0); changes listed in docs/third_party/grok-build/CHANGES.md.

When the model wants to end its turn (a reply without tool calls), the gate
may send it back with a reminder instead. Reasons, in order:

1. Queued messages from the agent that started this subagent.
2. A completion requirement: ``{"any_of": [tool, ...], "reminder": str}``.
   The turn may only end after one of those tools ran without error.
3. The work-announce nudge: the model said it would do something and
   stopped (at most once per turn).

At most ``MAX_STOP_CONTINUATIONS`` continuations per turn. On the
continuation after the first, ``stop_hook_active`` is true. When the limit
is reached with the requirement still unmet the turn ends with stop reason
``requirement_forced``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

MAX_STOP_CONTINUATIONS = 8
STOP_REASONS = (
    "end_turn",
    "max_turns",
    "no_progress",
    "user_interrupt",
    "permission_rejected",
    "requirement_forced",
)

DEFAULT_REMINDER = (
    "You have not finished this turn. End it only after calling one of: {tools}. "
    "Call the one that fits now."
)
ANNOUNCE_REMINDER = (
    "Continue now. Finish what you started in this turn — the full answer in "
    "several short bubbles if that is what was asked, and any tools you still "
    "need. Do not stop after the opening line. Saying you are working on it is "
    "not an answer: do the work now, or call ask_agent when a colleague must "
    "help, instead of announcing it."
)


@dataclass
class StopGate:
    requirement: dict[str, Any] = field(default_factory=dict)
    max_continuations: int = MAX_STOP_CONTINUATIONS
    continuations: int = 0
    stop_hook_active: bool = False
    announce_nudged: bool = False
    forced: bool = False

    @property
    def required_tools(self) -> list[str]:
        return list(self.requirement.get("any_of") or [])

    def satisfied(self, called_ok: set[str]) -> bool:
        tools = self.required_tools
        return not tools or any(name in called_ok for name in tools)

    def _continue(self, text: str) -> str | None:
        if self.continuations >= self.max_continuations:
            return None
        self.stop_hook_active = self.continuations > 0
        self.continuations += 1
        return text

    def check(
        self,
        *,
        called_ok: set[str],
        announced_work: bool = False,
        queued_messages: str = "",
    ) -> str | None:
        """Reminder text to continue with, or None to let the turn end."""
        if queued_messages:
            return self._continue(queued_messages)
        if not self.satisfied(called_ok):
            reminder = str(self.requirement.get("reminder") or "").strip() or DEFAULT_REMINDER.format(
                tools=", ".join(self.required_tools)
            )
            nxt = self._continue(f"<system-reminder>\n{reminder}\n</system-reminder>")
            if nxt is None:
                self.forced = True
            return nxt
        if announced_work and not self.announce_nudged:
            self.announce_nudged = True
            return self._continue(ANNOUNCE_REMINDER)
        return None

    def stop_reason(self) -> str:
        return "requirement_forced" if self.forced else "end_turn"


def inbound_requirement() -> dict[str, Any]:
    """Assisted inbound turns end with exactly one outcome tool."""
    return {
        "any_of": ["suggest_thread_reply", "note_no_reply", "create_decision_request", "send_reply"],
        "reminder": (
            "Finish the read with one outcome: suggest_thread_reply with the "
            "customer-facing draft, create_decision_request when the human must "
            "choose, or note_no_reply when no reply is needed. Then return: Done."
        ),
    }
