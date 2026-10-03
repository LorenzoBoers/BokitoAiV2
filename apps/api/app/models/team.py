import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

# System teams exist once per workspace; their members are computed, not stored.
TEAM_KIND_PEOPLE = "people"
TEAM_KIND_AGENTS = "agents"
TEAM_KIND_CUSTOM = "custom"
SYSTEM_TEAM_KINDS = (TEAM_KIND_PEOPLE, TEAM_KIND_AGENTS)

# How a team-owned conversation gets picked up.
PICKUP_MODES = ("people", "agent_first", "round_robin", "least_open")


class Team(SQLModel, table=True):
    __tablename__ = "teams"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    name: str
    description: str = ""
    kind: str = Field(default=TEAM_KIND_CUSTOM, index=True)  # people | agents | custom
    pickup: str = Field(default="people")
    # Shown under All communication in the Communication sidebar.
    pinned: bool = Field(default=False)
    # Round-robin cursor: the member key that was picked last.
    last_pick: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class TeamMember(SQLModel, table=True):
    __tablename__ = "team_members"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    team_id: uuid.UUID = Field(foreign_key="teams.id", index=True)
    member_kind: str = Field(default="user")  # user | agent
    user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id", index=True)
    agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
