"""Numbers per agent and per team for the Team overview (last 30 days).

- questions: decisions the agent raised / decisions addressed to the team;
- answer_minutes: median minutes from question to answer;
- unchanged_rate: share of answered questions approved as proposed
  (``send`` or ``approve``), not edited or rejected;
- picked_up: conversations the agent was given / the team handed to a member
  (picked up by a person or given out by round robin and least open).
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from statistics import median
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import DecisionRequest
from app.models.signal import SignalEvent

WINDOW = timedelta(days=30)
UNCHANGED_OPTIONS = ("send", "approve")


class _Bucket:
    def __init__(self) -> None:
        self.questions = 0
        self.answered = 0
        self.unchanged = 0
        self.waits: list[float] = []
        self.picked_up = 0

    def add_decision(self, row: DecisionRequest) -> None:
        self.questions += 1
        if row.status not in ("approved", "rejected") or row.resolved_at is None:
            return
        self.answered += 1
        if row.status == "approved" and (row.chosen_option_id or "") in UNCHANGED_OPTIONS:
            self.unchanged += 1
        self.waits.append(max((row.resolved_at - row.created_at).total_seconds() / 60, 0))

    def out(self) -> dict[str, Any]:
        return {
            "questions": self.questions,
            "answer_minutes": round(median(self.waits), 1) if self.waits else None,
            "unchanged_rate": round(self.unchanged / self.answered, 2) if self.answered else None,
            "picked_up": self.picked_up,
        }


async def overview_metrics(session: AsyncSession, tenant_id: UUID) -> dict[str, dict[str, dict[str, Any]]]:
    """``{"agents": {agent_id: metrics}, "teams": {team_id: metrics}}``."""
    since = datetime.utcnow() - WINDOW
    agents: dict[str, _Bucket] = {}
    teams: dict[str, _Bucket] = {}
    decisions = (
        await session.execute(
            select(DecisionRequest).where(
                DecisionRequest.tenant_id == tenant_id,
                DecisionRequest.created_at >= since,
            )
        )
    ).scalars().all()
    for row in decisions:
        if row.source_type == "agent" and row.source_id:
            agents.setdefault(str(row.source_id), _Bucket()).add_decision(row)
        if row.addressee_kind == "team" and row.addressee_team_id:
            teams.setdefault(str(row.addressee_team_id), _Bucket()).add_decision(row)

    events = (
        await session.execute(
            select(SignalEvent.event_type, SignalEvent.payload_json).where(
                SignalEvent.tenant_id == tenant_id,
                SignalEvent.event_type.in_(("picked_up", "auto_assigned")),
                SignalEvent.created_at >= since,
            )
        )
    ).all()
    for event_type, raw in events:
        try:
            payload = json.loads(raw or "{}")
        except json.JSONDecodeError:
            continue
        team_id = payload.get("team_id")
        if team_id:
            teams.setdefault(str(team_id), _Bucket()).picked_up += 1
        if event_type == "auto_assigned" and payload.get("owner_kind") == "agent" and payload.get("owner_id"):
            agents.setdefault(str(payload["owner_id"]), _Bucket()).picked_up += 1
    return {
        "agents": {key: bucket.out() for key, bucket in agents.items()},
        "teams": {key: bucket.out() for key, bucket in teams.items()},
    }


def empty_metrics() -> dict[str, Any]:
    return _Bucket().out()
