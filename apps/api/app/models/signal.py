"""Unified SENSING substrate.

A `Signal` is one inbound/outbound thread regardless of channel (email, chat,
widget, webhook, integration, or internal agent communication). It replaces the
previously split inbox/email/conversation stacks.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Index
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
    assigned_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id", index=True)
    # Owner: user (assigned_user_id), agent (agent_id) or team (assignee_team_id).
    # Maintained by services/ownership.py; every conversation has one.
    assignee_kind: str = Field(default="", index=True)  # user | agent | team
    assignee_team_id: Optional[uuid.UUID] = Field(default=None, foreign_key="teams.id", index=True)
    assigned_by_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    # Last person or team that owned this conversation. Set by set_owner for
    # user/team owners; the escalation chain returns the conversation here
    # first when the agent hands it back to people.
    last_human_owner_kind: str = Field(default="")  # user | team | ""
    last_human_owner_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    last_human_owner_team_id: Optional[uuid.UUID] = Field(default=None, foreign_key="teams.id")
    # Collision guard: a person is typing in the composer until this moment;
    # an autonomous agent drafts instead of sending while it is in the future.
    human_composing_until: Optional[datetime] = Field(default=None)
    # Turn: who must act now (derived by ownership.recompute_turn).
    turn_kind: str = Field(default="", index=True)  # customer | agent | user | team | ""
    turn_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id", index=True)
    turn_team_id: Optional[uuid.UUID] = Field(default=None, foreign_key="teams.id", index=True)
    turn_reason: str = ""  # reply_needed | question | draft_ready
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


class SavedReply(SQLModel, table=True):
    """Tenant-scoped canned response for the reply composer."""

    __tablename__ = "saved_replies"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    title: str = ""
    body_text: str = ""
    created_by_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    deleted_at: Optional[datetime] = Field(default=None, index=True)
    deleted_by_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    trash_batch_id: Optional[uuid.UUID] = Field(default=None, index=True)


class SignalTag(SQLModel, table=True):
    """A hashtag: the workspace vocabulary for finding and grouping conversations.

    Conversations link to free tags through `SignalTagLink`. A tag with a
    ``workstream_id`` is a *category* (ticket-hashtag): filing it on a
    conversation makes that conversation a ticket in the playbook's pipeline
    (`Signal.ticket_tag_id`). The intake fields below only apply to categories.
    Agents and inbox rules may only apply names the registry already has.
    """

    __tablename__ = "signal_tags"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    # Normalized hashtag name (lower case, hyphens, no leading #); unique per tenant.
    name: str = Field(default="", index=True)
    # When to use this tag. Shown in settings and fed to AI tagging.
    description: str = ""
    workstream_id: Optional[uuid.UUID] = Field(default=None, foreign_key="workstreams.id", index=True)
    # A row in Communication's Tags and categories section.
    pinned: bool = False
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


class SignalThreadPin(SQLModel, table=True):
    __tablename__ = "signal_thread_pins"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    signal_id: uuid.UUID = Field(foreign_key="signals.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
