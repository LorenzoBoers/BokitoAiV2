"""Response models shared by routers. Built from ORM rows with `from_attributes`."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class Orm(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ConversationOut(Orm):
    id: uuid.UUID
    channel: str
    external_id: str | None
    status: str
    subject: str
    connection_id: uuid.UUID | None
    contact_id: uuid.UUID | None
    agent_id: uuid.UUID | None
    assignee_user_id: uuid.UUID | None
    signal_type_id: uuid.UUID | None
    tags: list[Any]
    participants: list[Any]
    priority: int
    unread: bool
    handoff: bool
    follow_up_at: datetime | None
    last_activity_at: datetime
    last_inbound_at: datetime | None
    closed_at: datetime | None
    compact_summary: str
    created_at: datetime


class MessageOut(Orm):
    id: uuid.UUID
    conversation_id: uuid.UUID
    kind: str
    direction: str
    author_user_id: uuid.UUID | None
    author_agent_id: uuid.UUID | None
    author_contact_id: uuid.UUID | None
    author_label: str
    body: str
    html: str | None
    attachments: list[Any]
    send_status: str
    send_error: str
    ai_generated: bool
    run_id: uuid.UUID | None
    meta: dict[str, Any]
    created_at: datetime
    sent_at: datetime | None


class DecisionOut(Orm):
    id: uuid.UUID
    conversation_id: uuid.UUID
    message_id: uuid.UUID | None
    run_id: uuid.UUID | None
    status: str
    title: str
    summary: str
    options: list[Any]
    tool_call: dict[str, Any] | None
    requested_by: str
    chosen_option: str | None
    resolution_note: str
    resolved_by_user_id: uuid.UUID | None
    result: dict[str, Any] | None
    expires_at: datetime | None
    created_at: datetime
    resolved_at: datetime | None


class ContactOut(Orm):
    id: uuid.UUID
    name: str
    email: str | None
    phone: str | None
    organization_id: uuid.UUID | None
    language: str
    kind: str
    handles: dict[str, Any]
    fields: dict[str, Any]
    verified: bool
    memory: str
    last_seen_at: datetime | None
    created_at: datetime


class OrganizationOut(Orm):
    id: uuid.UUID
    name: str
    domain: str | None
    kind: str
    fields: dict[str, Any]
    notes: str
    created_at: datetime


class SignalTypeOut(Orm):
    id: uuid.UUID
    slug: str
    name: str
    description: str
    color: str
    fields: list[Any]
    recognition: dict[str, Any]
    autonomy_cap: str | None
    playbook_id: uuid.UUID | None
    module: str
    enabled: bool


class SignalOut(Orm):
    id: uuid.UUID
    conversation_id: uuid.UUID
    type_id: uuid.UUID
    status: str
    title: str
    fields: dict[str, Any]
    confidence: int
    source: str
    created_at: datetime
    done_at: datetime | None


class AgentOut(Orm):
    id: uuid.UUID
    slug: str
    name: str
    role: str
    instructions: str
    model: str
    tools: list[Any]
    autonomy_cap: str | None
    scopes: dict[str, Any]
    channels: list[Any]
    language: str
    active: bool
    is_default: bool
    persona_doc_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class PlaybookOut(Orm):
    id: uuid.UUID
    slug: str
    name: str
    description: str
    steps: list[Any]
    agent_id: uuid.UUID | None
    autonomy_cap: str | None
    module: str
    active: bool
    created_at: datetime


class RunOut(Orm):
    id: uuid.UUID
    kind: str
    status: str
    title: str
    actor: str
    trust: str
    conversation_id: uuid.UUID | None
    agent_id: uuid.UUID | None
    playbook_id: uuid.UUID | None
    trigger_id: uuid.UUID | None
    parent_run_id: uuid.UUID | None
    tool_name: str
    input: dict[str, Any]
    output: dict[str, Any] | None
    error: str
    step: int
    cost_eur: float
    tokens_in: int
    tokens_out: int
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class RunEventOut(Orm):
    id: uuid.UUID
    seq: int
    kind: str
    payload: dict[str, Any]
    created_at: datetime


class TriggerOut(Orm):
    id: uuid.UUID
    name: str
    kind: str
    spec: dict[str, Any]
    agent_id: uuid.UUID | None
    playbook_id: uuid.UUID | None
    instructions: str
    active: bool
    last_fired_at: datetime | None
    next_fire_at: datetime | None


class ConnectionOut(Orm):
    id: uuid.UUID
    kind: str
    provider: str
    name: str
    status: str
    status_message: str
    address: str
    settings: dict[str, Any]
    capabilities: list[Any]
    disclosure_enabled: bool
    region: str
    agent_id: uuid.UUID | None
    public_key: str
    last_used_at: datetime | None
    verified_at: datetime | None
    created_at: datetime
    credentials_masked: dict[str, str] = {}


class DocOut(Orm):
    id: uuid.UUID
    kind: str
    path: str
    title: str
    body: str
    frontmatter: dict[str, Any]
    published: bool
    ai_maintained: bool
    source: str
    indexed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class DocSummaryOut(Orm):
    id: uuid.UUID
    kind: str
    path: str
    title: str
    published: bool
    ai_maintained: bool
    updated_at: datetime


class PolicyOut(Orm):
    id: uuid.UUID
    posture: str
    allowances: dict[str, Any]
    tool_overrides: dict[str, Any]
    consequential: list[Any]
    budgets: dict[str, Any]
    disclosure_text: str


class ChangeOut(Orm):
    id: uuid.UUID
    status: str
    target_kind: str
    target_id: uuid.UUID | None
    title: str
    before: dict[str, Any] | None
    after: dict[str, Any]
    proposed_by: str
    conversation_id: uuid.UUID | None
    decision_id: uuid.UUID | None
    created_at: datetime
    applied_at: datetime | None
    rolled_back_at: datetime | None


class AuditEventOut(Orm):
    id: uuid.UUID
    actor: str
    trust: str
    action: str
    target_kind: str
    target_id: str
    conversation_id: uuid.UUID | None
    run_id: uuid.UUID | None
    payload: dict[str, Any]
    created_at: datetime


class ApiTokenOut(Orm):
    id: uuid.UUID
    name: str
    prefix: str
    scopes: list[Any]
    last_used_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime


class FeedbackOut(Orm):
    id: uuid.UUID
    conversation_id: uuid.UUID | None
    message_id: uuid.UUID | None
    run_id: uuid.UUID | None
    verdict: str
    comment: str
    correction: str
    created_at: datetime


class ToolOutcomeOut(BaseModel):
    status: str
    run_id: uuid.UUID
    result: Any = None
    decision_id: uuid.UUID | None = None
    reason: str = ""
