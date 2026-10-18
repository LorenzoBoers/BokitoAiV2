"""Unified SENSING substrate.

A `Signal` is one inbound/outbound thread regardless of channel (email, chat,
widget, webhook, integration, or internal agent communication). It replaces the
previously split inbox/email/conversation stacks.
"""

import json
import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import model_validator
from sqlalchemy import Index, UniqueConstraint
from sqlmodel import Field, SQLModel

SIGNAL_CHANNELS = (
    "email",
    "chat",
    "widget",
    "slack",
    "whatsapp",
    "webhook",
    "integration",
    "api",
    "internal",
    "assistant",
)
SIGNAL_STATUSES = ("open", "pending", "closed", "spam", "archived")
SIGNAL_PRIORITIES = ("low", "normal", "high", "urgent")
SIGNAL_MESSAGE_KINDS = (
    "user_message",
    "agent_message",
    "run",
    "decision_request",
    "status_update",
    "task_result",
    "system_event",
    "internal_note",
)
# `proposed` sits before the lifecycle: an unsure read the operator still has
# to accept. Accepted tickets carry the kind of their current stage.
# Stage kinds map to ClickUp-style groups: open≈not started, waiting≈active,
# done≈klaar, closed≈closed. `ticket_status` mirrors the current stage kind
# (plus `proposed` before the pipeline).
TICKET_STATUSES = ("proposed", "open", "waiting", "done", "closed")
TICKET_STAGE_KINDS = ("open", "waiting", "done", "closed")
CATEGORY_CREATE_MODES = ("ask_customer", "ask_operator", "auto", "manual_only")
EXTERNAL_CHANNELS = (
    "email",
    "chat",
    "widget",
    "slack",
    "whatsapp",
    "webhook",
    "integration",
    "api",
)


def is_internal_channel(channel: str) -> bool:
    return channel in ("internal", "assistant")


_COMPAT_ATTRS = frozenset(
    {
        "assigned_user_id",
        "assignee_team_id",
        "turn_user_id",
        "turn_team_id",
        "active_turn_json",
        "handoff_session_json",
        "last_human_owner_kind",
        "last_human_owner_user_id",
        "last_human_owner_department_id",
    }
)


class Signal(SQLModel, table=True):
    __tablename__ = "signals"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    channel: str = Field(default="email", index=True)
    source: str = Field(default="", index=True)
    external_id: str = Field(default="", index=True)
    connection_id: Optional[uuid.UUID] = Field(default=None, foreign_key="integration_connections.id")
    channel_account_id: Optional[uuid.UUID] = Field(default=None, foreign_key="channel_accounts.id", index=True)
    contact_id: Optional[uuid.UUID] = Field(default=None, foreign_key="contacts.id", index=True)
    # Owner for personal assistant threads (channel="assistant").
    owner_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id", index=True)
    # Target agent for chat threads; null = legacy channel routing fallback.
    agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id", index=True)
    project_id: Optional[uuid.UUID] = Field(default=None, foreign_key="projects.id", index=True)

    subject: str = Field(default="(No subject)")
    contact_name: str = ""
    contact_email: str = ""
    contact_phone: str = ""
    # How the thread was linked to its person: verified | claimed | manual; "" = inbound address match.
    contact_basis: str = ""

    status: str = Field(default="open", index=True)
    # A thread with a date is an agenda item: the moment it comes back (reopens,
    # unread) or starts. A repeat rule (Trigger with this signal_id) owns the
    # value and writes its next run here; without one the scheduler clears it
    # once the moment passed.
    next_at: Optional[datetime] = Field(default=None, index=True)
    # Appointments only: when the moment ends.
    ends_at: Optional[datetime] = Field(default=None)
    # Appointment details: {"note", "location", "attendees", "html_link", "all_day"}.
    schedule_json: str = Field(default="{}")
    priority: str = Field(default="normal", index=True)
    # Owner: assignee_kind + assignee_id (polymorphic). agent_id is the handling
    # pin and may differ when a team/person owns while an agent drafts.
    # Maintained by services/ownership.py; every conversation has one.
    assignee_kind: str = Field(default="", index=True)  # user | agent | department
    assignee_id: Optional[uuid.UUID] = Field(default=None, index=True)
    assigned_by_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    # Last person or team that owned this conversation: {"kind","id"}.
    last_human_owner_json: str = Field(default="{}")
    # Collision guard: a person is typing in the composer until this moment;
    # an autonomous agent drafts instead of sending while it is in the future.
    human_composing_until: Optional[datetime] = Field(default=None)
    # Turn: who must act now (derived by ownership.recompute_turn).
    turn_kind: str = Field(default="", index=True)  # customer | agent | user | department | ""
    turn_ref_id: Optional[uuid.UUID] = Field(default=None, index=True)
    turn_reason: str = ""  # reply_needed | question | draft_ready
    # Multi-agent floor: {"active_turn": {...}, "handoff_session": {...}}.
    floor_json: str = Field(default="{}")
    has_unread: bool = Field(default=True, index=True)
    # Temporary AI handling override for this conversation (manual | assisted |
    # autonomous); null follows contact -> channel -> workspace. Cleared on
    # close; set to manual with reason "assigned" when a person is assigned.
    ai_handling: Optional[str] = Field(default=None)
    ai_handling_reason: Optional[str] = Field(default=None)
    # Compact next-action chips set during AI inbound processing
    # (subset of: close, assign, look_at).
    suggested_actions_json: str = Field(default="[]")

    category: Optional[str] = Field(default=None, index=True)
    urgency: Optional[int] = None
    impact: Optional[int] = None
    intent: Optional[str] = None
    sentiment: Optional[str] = None
    summary: str = ""
    certainty: Optional[int] = None
    triaged_at: Optional[datetime] = None

    # History compaction: rolling summary of the oldest `compacted_count`
    # LLM-eligible messages; durable facts are flushed to the memory doc first.
    compact_summary: str = ""
    compacted_count: int = 0

    # Assistant conversations opened from a customer thread (Ask assistant):
    # the referenced thread's transcript is injected into the LLM history each
    # turn so answers stay grounded in the live thread.
    context_signal_id: Optional[uuid.UUID] = Field(default=None, index=True)

    # Inline agent sessions: assistant Signals started from inside a thread
    # carry a lifecycle ("active" -> "closed"). Null for regular threads and
    # standalone assistant chats.
    session_state: Optional[str] = Field(default=None, index=True)
    session_closed_at: Optional[datetime] = None
    # Checkout outcome: {"summary": str, "actions": [...], "message_count": int}
    session_outcome_json: str = Field(default="{}")

    # Closed conversations can be curated as learning examples. The transcript
    # remains the source; this flag only opts it into few-shot retrieval.
    is_example: bool = Field(default=False, index=True)

    # Split on a new intent: the child keeps the provider thread id, and the
    # parent points forward so inbound replies on that thread land in the child.
    parent_signal_id: Optional[uuid.UUID] = Field(default=None, index=True)
    superseded_by_id: Optional[uuid.UUID] = Field(default=None)

    # The conversation is the ticket: at most one category per conversation,
    # with its stage in that category's playbook. ``project_id`` above is the
    # project chosen when the ticket was filed (null = no project).
    ticket_tag_id: Optional[uuid.UUID] = Field(default=None, foreign_key="signal_tags.id", index=True)
    ticket_status: str = Field(default="", index=True)  # "" | proposed | open | waiting | done | closed
    stage_key: str = ""
    ticket_certainty: Optional[int] = None
    ticket_filed_at: Optional[datetime] = None
    # Values for optional intake fields defined on the flow's stages (JSON object).
    ticket_fields_json: str = Field(default="{}")

    last_message_at: Optional[datetime] = Field(default_factory=datetime.utcnow, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # Thread-scoped customer assurance (magic-link). Empty level = none.
    assurance_level: str = ""
    assurance_contact_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="contacts.id"
    )
    assurance_email: str = ""
    assurance_expires_at: Optional[datetime] = Field(default=None, index=True)
    assurance_verified_at: Optional[datetime] = None

    deleted_at: Optional[datetime] = Field(default=None, index=True)
    deleted_by_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    trash_batch_id: Optional[uuid.UUID] = Field(default=None, index=True)

    @staticmethod
    def _remap_compat_kwargs(data: dict[str, Any]) -> dict[str, Any]:
        """Map legacy constructor kwargs onto slim columns."""
        out = dict(data)
        if out.get("assigned_user_id"):
            out["assignee_kind"] = "user"
            out["assignee_id"] = out.pop("assigned_user_id")
            out.pop("assignee_team_id", None)
        elif out.get("assignee_team_id"):
            out["assignee_kind"] = out.get("assignee_kind") or "department"
            out["assignee_id"] = out.pop("assignee_team_id")
        else:
            out.pop("assigned_user_id", None)
            out.pop("assignee_team_id", None)
        if out.get("turn_user_id"):
            out["turn_kind"] = "user"
            out["turn_ref_id"] = out.pop("turn_user_id")
            out.pop("turn_team_id", None)
        elif out.get("turn_team_id"):
            out["turn_kind"] = out.get("turn_kind") or "department"
            out["turn_ref_id"] = out.pop("turn_team_id")
        else:
            out.pop("turn_user_id", None)
            out.pop("turn_team_id", None)
        active = out.pop("active_turn_json", None)
        handoff = out.pop("handoff_session_json", None)
        if active is not None or handoff is not None:
            try:
                at = json.loads(active or "{}") if active is not None else {}
            except (TypeError, ValueError, json.JSONDecodeError):
                at = {}
            try:
                hs = json.loads(handoff or "{}") if handoff is not None else {}
            except (TypeError, ValueError, json.JSONDecodeError):
                hs = {}
            floor: dict[str, Any] = {}
            if isinstance(at, dict) and at:
                floor["active_turn"] = at
            if isinstance(hs, dict) and hs:
                floor["handoff_session"] = hs
            out["floor_json"] = json.dumps(floor)
        kind = out.pop("last_human_owner_kind", None)
        user = out.pop("last_human_owner_user_id", None)
        team = out.pop("last_human_owner_department_id", None)
        if kind == "user" and user:
            out["last_human_owner_json"] = json.dumps({"kind": "user", "id": str(user)})
        elif kind == "department" and team:
            out["last_human_owner_json"] = json.dumps({"kind": "department", "id": str(team)})
        return out

    def __init__(self, **data: Any) -> None:
        # SQLModel drops unknown fields before model_validator; remap first.
        super().__init__(**self._remap_compat_kwargs(data))

    @model_validator(mode="before")
    @classmethod
    def _compat_constructor(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        return cls._remap_compat_kwargs(data)

    def _floor(self) -> dict[str, Any]:
        try:
            data = json.loads(self.floor_json or "{}")
        except (TypeError, ValueError, json.JSONDecodeError):
            data = {}
        return data if isinstance(data, dict) else {}

    def _write_floor(self, data: dict[str, Any]) -> None:
        super().__setattr__("floor_json", json.dumps(data))

    def _human_owner(self) -> dict[str, Any]:
        try:
            data = json.loads(self.last_human_owner_json or "{}")
        except (TypeError, ValueError, json.JSONDecodeError):
            data = {}
        return data if isinstance(data, dict) else {}

    def __getattr__(self, name: str) -> Any:
        if name == "assigned_user_id":
            return self.assignee_id if self.assignee_kind == "user" else None
        if name == "assignee_team_id":
            return self.assignee_id if self.assignee_kind == "department" else None
        if name == "turn_user_id":
            return self.turn_ref_id if self.turn_kind == "user" else None
        if name == "turn_team_id":
            return self.turn_ref_id if self.turn_kind == "department" else None
        if name == "active_turn_json":
            at = self._floor().get("active_turn")
            return json.dumps(at) if isinstance(at, dict) else "{}"
        if name == "handoff_session_json":
            hs = self._floor().get("handoff_session")
            return json.dumps(hs) if isinstance(hs, dict) else "{}"
        if name == "last_human_owner_kind":
            return str(self._human_owner().get("kind") or "")
        if name == "last_human_owner_user_id":
            data = self._human_owner()
            if data.get("kind") != "user" or not data.get("id"):
                return None
            try:
                return uuid.UUID(str(data["id"]))
            except (ValueError, TypeError, AttributeError):
                return None
        if name == "last_human_owner_department_id":
            data = self._human_owner()
            if data.get("kind") != "department" or not data.get("id"):
                return None
            try:
                return uuid.UUID(str(data["id"]))
            except (ValueError, TypeError, AttributeError):
                return None
        raise AttributeError(name)

    def __setattr__(self, name: str, value: Any) -> None:
        if name not in _COMPAT_ATTRS:
            super().__setattr__(name, value)
            return
        if name == "assigned_user_id":
            if value is not None:
                super().__setattr__("assignee_kind", "user")
                super().__setattr__("assignee_id", value)
            elif getattr(self, "assignee_kind", None) == "user":
                super().__setattr__("assignee_id", None)
            return
        if name == "assignee_team_id":
            if value is not None:
                super().__setattr__("assignee_kind", "department")
                super().__setattr__("assignee_id", value)
            elif getattr(self, "assignee_kind", None) == "department":
                super().__setattr__("assignee_id", None)
            return
        if name == "turn_user_id":
            if value is not None:
                super().__setattr__("turn_kind", "user")
                super().__setattr__("turn_ref_id", value)
            elif getattr(self, "turn_kind", None) == "user":
                super().__setattr__("turn_ref_id", None)
            return
        if name == "turn_team_id":
            if value is not None:
                super().__setattr__("turn_kind", "department")
                super().__setattr__("turn_ref_id", value)
            elif getattr(self, "turn_kind", None) == "department":
                super().__setattr__("turn_ref_id", None)
            return
        if name == "active_turn_json":
            floor = self._floor()
            try:
                data = json.loads(value or "{}")
            except (TypeError, ValueError, json.JSONDecodeError):
                data = {}
            if isinstance(data, dict) and data:
                floor["active_turn"] = data
            else:
                floor.pop("active_turn", None)
            self._write_floor(floor)
            return
        if name == "handoff_session_json":
            floor = self._floor()
            try:
                data = json.loads(value or "{}")
            except (TypeError, ValueError, json.JSONDecodeError):
                data = {}
            if isinstance(data, dict) and data:
                floor["handoff_session"] = data
            else:
                floor.pop("handoff_session", None)
            self._write_floor(floor)
            return
        if name == "last_human_owner_kind":
            kind = (value or "").strip()
            if not kind:
                super().__setattr__("last_human_owner_json", "{}")
                return
            data = self._human_owner()
            data["kind"] = kind
            super().__setattr__("last_human_owner_json", json.dumps(data))
            return
        if name == "last_human_owner_user_id":
            if value is None:
                if self._human_owner().get("kind") == "user":
                    super().__setattr__("last_human_owner_json", "{}")
                return
            super().__setattr__(
                "last_human_owner_json", json.dumps({"kind": "user", "id": str(value)})
            )
            return
        if name == "last_human_owner_department_id":
            if value is None:
                if self._human_owner().get("kind") == "department":
                    super().__setattr__("last_human_owner_json", "{}")
                return
            super().__setattr__(
                "last_human_owner_json", json.dumps({"kind": "department", "id": str(value)})
            )
            return
        super().__setattr__(name, value)


class SignalMessage(SQLModel, table=True):
    __tablename__ = "signal_messages"
    __table_args__ = (
        Index("ix_signal_messages_tenant_external", "tenant_id", "external_id"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    signal_id: uuid.UUID = Field(foreign_key="signals.id", index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    kind: str = Field(default="user_message", index=True)
    direction: str = Field(default="inbound")
    role: str = Field(default="user")
    author_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    author_agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id")

    from_address: str = ""
    to_addresses: str = Field(default="[]")
    subject: str = ""
    body_text: str = ""
    body_html: str = ""
    body_preview: str = ""
    external_id: str = Field(default="", index=True)
    attachments_json: str = Field(default="[]")
    metadata_json: str = Field(default="{}")
    certainty: Optional[int] = None
    send_status: Optional[str] = None
    auto_sent: bool = False
    decision_id: Optional[uuid.UUID] = Field(default=None, foreign_key="decision_requests.id")

    # Scheduled send: while send_status == "scheduled" the scheduler delivers
    # the message once this passes. Soft undo cancels before delivery.
    send_after: Optional[datetime] = Field(default=None, index=True)

    received_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SignalEvent(SQLModel, table=True):
    __tablename__ = "signal_events"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    signal_id: uuid.UUID = Field(foreign_key="signals.id", index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    event_type: str = ""
    actor_type: str = "system"
    actor_id: str = ""
    payload_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SignalTag(SQLModel, table=True):
    """A hashtag: the one label people learn. Roles are orthogonal:

    - free label on conversations (`SignalTagLink`), contacts and companies;
    - *action tag* when ``workstream_id`` is set: filing it makes the
      conversation a ticket in that flow (`Signal.ticket_tag_id`);
    - *folder member* when a `Project` lists it in ``project_tag_links``:
      the conversation matches every folder whose tag set it fully covers.

    The intake fields below only apply to action tags. Agents and inbox rules
    may only apply names the registry already has.
    """

    __tablename__ = "signal_tags"
    __table_args__ = (UniqueConstraint("tenant_id", "name", name="uq_signal_tags_tenant_name"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    department_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="departments.id", index=True
    )
    # Normalized hashtag name (lower case, underscores, no leading #); unique per tenant.
    name: str = Field(default="", index=True)
    # When to use this tag. Shown in settings and fed to AI tagging.
    description: str = ""
    # Flow-label hue. Free labels stay empty.
    color: str = ""
    # Lucide kebab name inside a flow-label pill. Empty uses the route mark.
    icon: str = ""
    workstream_id: Optional[uuid.UUID] = Field(default=None, foreign_key="workstreams.id", index=True)
    # Workspace default: a row in the Folders and tags rail for everyone.
    show_in_nav: bool = False
    # When false, triage does not offer or apply this tag automatically.
    ai_auto_tag: bool = True
    create_mode: str = "ask_customer"
    ask_threshold: int = 6
    auto_threshold: int = 9
    # Outbound policy on a ticket of this category: send follows AI handling;
    # draft and ask force a concept.
    send_mode: str = "send"
    # Empty follows the company. A mode is a ceiling under AI handling.
    autonomy_level: str = ""
    requires_verification: bool = False
    module_slug: str = ""
    template_slug: str = ""
    sort_order: int = 0
    created_by_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class SignalTagLink(SQLModel, table=True):
    """One tag on one conversation. Renaming a tag renames it everywhere."""

    __tablename__ = "signal_tag_links"

    signal_id: uuid.UUID = Field(foreign_key="signals.id", primary_key=True)
    tag_id: uuid.UUID = Field(foreign_key="signal_tags.id", primary_key=True, index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ContactTagLink(SQLModel, table=True):
    """One tag on one contact. Read, never copied: a conversation's effective
    tags include its primary contact's tags (and the contact's company's)."""

    __tablename__ = "contact_tag_links"

    contact_id: uuid.UUID = Field(foreign_key="contacts.id", primary_key=True)
    tag_id: uuid.UUID = Field(foreign_key="signal_tags.id", primary_key=True, index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CompanyTagLink(SQLModel, table=True):
    """One tag on one company; every contact of the company inherits it."""

    __tablename__ = "company_tag_links"

    company_id: uuid.UUID = Field(foreign_key="companies.id", primary_key=True)
    tag_id: uuid.UUID = Field(foreign_key="signal_tags.id", primary_key=True, index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SignalThreadPin(SQLModel, table=True):
    __tablename__ = "signal_thread_pins"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    signal_id: uuid.UUID = Field(foreign_key="signals.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
