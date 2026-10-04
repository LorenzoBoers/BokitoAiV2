"""Team presence hierarchy: people vs agent standby/working."""

from app.services.presence import (
    AVAILABLE,
    AWAY,
    OFFLINE,
    STANDBY,
    WORKING,
    agent_corner_status,
    team_status,
)


class _Agent:
    def __init__(
        self,
        *,
        is_active: bool = True,
        kind: str = "company",
        acts_for_user: bool = False,
        runtime_status: str = "standby",
    ):
        self.is_active = is_active
        self.kind = kind
        self.acts_for_user = acts_for_user
        self.runtime_status = runtime_status


def test_team_available_person_wins_over_working_agent():
    assert (
        team_status([AVAILABLE, AWAY], agent_statuses=[WORKING, STANDBY]) == AVAILABLE
    )


def test_team_working_beats_away():
    assert team_status([AWAY, OFFLINE], agent_statuses=[WORKING]) == WORKING


def test_team_away_beats_standby():
    assert team_status([AWAY], agent_statuses=[STANDBY]) == AWAY


def test_team_standby_when_people_offline():
    assert team_status([OFFLINE, OFFLINE], agent_statuses=[STANDBY]) == STANDBY


def test_team_offline_without_members():
    assert team_status([], agent_statuses=[]) == OFFLINE


def test_agent_corner_standby_and_working():
    assert agent_corner_status(_Agent()) == STANDBY
    assert agent_corner_status(_Agent(runtime_status="active")) == WORKING
    assert agent_corner_status(_Agent(), has_running_run=True) == WORKING
    assert agent_corner_status(_Agent(runtime_status="error")) == "error"


def test_agent_corner_skips_personal_and_archived():
    assert agent_corner_status(_Agent(acts_for_user=True)) is None
    assert agent_corner_status(_Agent(is_active=False)) is None
    assert agent_corner_status(_Agent(kind="archived")) is None
