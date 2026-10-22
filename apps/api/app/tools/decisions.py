"""Decision requests, proposals, and resolving a decision from chat."""

from __future__ import annotations

from app.core.time import utcnow

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.models.auth import Tenant
from app.models.notification import DecisionRequest, Notification
from app.services.addressee import parse_target
from app.services.signal_decisions import (
    find_open_ack_in_bundle,
    find_open_duplicate_decision,
    find_open_identical_decision,
    options_ack_signature,
    primary_option_key,
    recently_declined_decision,
)
from app.tools._common import (
    PROPOSAL_ITEMS_SCHEMA,
    TO_TARGET_SCHEMA,
)
from app.tools.registry import ToolContext, ToolSpec, register_tool


NON_EXECUTABLE_ACTIONS = frozenset(
    {"escalate", "acknowledge", "defer", "reject", "dismiss", "later", "ignore", "none", ""}
)

# Actions the decision resolver executes itself (no registered tool behind
# them) and that still do something without a conversation.
RESOLVER_ACTIONS = frozenset(
    {
        "setup_integration",
        "enable_module",
        "activate_inbox_rule",
        "add_module_source",
        "accept_platform_change",
        "contact_link",
        "contact_create",
        "calendar_create_event",
        "calendar_update_event",
        # Generic module proposal cards record the approval itself.
        "approve",
    }
)


def executable_option_actions(options: list[dict[str, Any]]) -> list[str]:
    """Action types in ``options`` that approving would actually run.

    A registered tool name or a resolver action counts; escalate /
    acknowledge / defer / reject only make sense when the card sits on a
    thread a human can take over.
    """
    from app.tools.registry import get_tool_spec

    found: list[str] = []
    for option in options:
        if not isinstance(option, dict):
            continue
        action = str(option.get("action_type") or "").strip().lower()
        if option.get("input_type") == "text":
            # A free-text answer is captured; that is the point of the card.
            action = action or "text"
            if action not in found:
                found.append(action)
            continue
        if action in NON_EXECUTABLE_ACTIONS or action in found:
            continue
        if action in RESOLVER_ACTIONS or get_tool_spec(action) is not None:
            found.append(action)
    return found


async def resolve_signal_by_subject(session, tenant_id: UUID, subject: str) -> UUID | None:
    """The most recent open conversation whose subject contains ``subject``."""
    from app.models.signal import Signal

    needle = subject.strip()
    if len(needle) < 3:
        return None
    row = (
        await session.execute(
            select(Signal.id)
            .where(
                Signal.tenant_id == tenant_id,
                Signal.deleted_at.is_(None),
                Signal.status.in_(("open", "pending", "snoozed")),
                Signal.subject.ilike(f"%{needle}%"),
            )
            .order_by(Signal.last_message_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return row


# Answers a card may offer without running a tool. Forty labels as buttons hid
# the list from the message and turned "Do you want a plan?" into "2025".
MAX_SOFT_ANSWERS = 8


def _answers_are_a_list(tool_input: dict[str, Any]) -> dict[str, Any] | None:
    options = [o for o in tool_input.get("options") or [] if isinstance(o, dict)]
    soft = [
        o
        for o in options
        if str(o.get("action_type") or "") in ("", "text")
        and str(o.get("id") or "") not in ("reject", "defer")
    ]
    if len(soft) <= MAX_SOFT_ANSWERS or tool_input.get("items"):
        return None
    return {
        "ok": False,
        "code": "too_many_answers",
        "message": (
            f"A card asks one question with at most {MAX_SOFT_ANSWERS} answers. "
            "Write the list in your message (or show the objects with items / "
            "attach_items) and ask about it with a few answers."
        ),
    }


async def _create_decision_request(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.agent.style import strip_emoji

    # Agent-generated copy: keep titles/summaries emoji-free platform-wide.
    tool_input = {
        **tool_input,
        "title": strip_emoji(str(tool_input.get("title", ""))) or "Decision needed",
        "summary": strip_emoji(str(tool_input.get("summary", ""))),
        "options": _with_learn(ctx, tool_input.get("options") or []),
    }
    refused = _answers_are_a_list(tool_input)
    if refused:
        return refused
    raw_signal = tool_input.get("signal_id") or (str(ctx.signal_id) if ctx.signal_id else None)
    target_signal_id: UUID | None = None
    if raw_signal:
        try:
            target_signal_id = UUID(str(raw_signal))
        except ValueError:
            target_signal_id = None
    if target_signal_id is None and str(tool_input.get("thread_subject") or "").strip():
        # Heartbeat and scheduled runs have no thread of their own; when the
        # question is about a conversation, attach the card to that thread so
        # the operator sees the ask next to the message instead of in an
        # orphan internal thread.
        target_signal_id = await resolve_signal_by_subject(
            ctx.session, ctx.tenant_id, str(tool_input["thread_subject"])
        )
    if target_signal_id is None:
        executable = executable_option_actions(tool_input.get("options") or [])
        if not executable:
            # Nothing a click could run: an "acknowledge" card without a thread
            # is just a note. Put it in the report instead of the decision list.
            return {
                "ok": False,
                "code": "no_executable_option",
                "message": (
                    "Not raised as a decision: the card has no thread and none of its "
                    "options runs a platform tool. Mention the observation in your "
                    "report instead, or pass signal_id / thread_subject so the card "
                    "lands on the conversation it concerns."
                ),
            }
    if target_signal_id:
        # A newer identical ask supersedes the stale card: without this the
        # thread stacks duplicate pending decisions every time the customer
        # writes again before anyone resolved the previous draft.

        stale_query = select(DecisionRequest).where(
            DecisionRequest.tenant_id == ctx.tenant_id,
            DecisionRequest.signal_id == target_signal_id,
            DecisionRequest.status == "awaiting_human",
            DecisionRequest.platform_change_id.is_(None),
            DecisionRequest.title == tool_input["title"],
        )
        if ctx.bundle_id:
            # Cards of the same turn form one bundle; they never replace each other.
            stale_query = stale_query.where(DecisionRequest.bundle_id != ctx.bundle_id)
        stale_result = await ctx.session.execute(stale_query)
        for stale in stale_result.scalars().all():
            stale.status = "deferred"
            stale.resolved_at = utcnow()
            stale.chosen_option_id = "superseded"
            ctx.session.add(stale)
            if stale.notification_id:
                # The bell must not keep counting a card nobody can act on.
                stale_notif = (
                    await ctx.session.execute(
                        select(Notification).where(Notification.id == stale.notification_id)
                    )
                ).scalar_one_or_none()
                if stale_notif and stale_notif.status == "unread":
                    stale_notif.status = "read"
                    ctx.session.add(stale_notif)
        # Same turn / same bundle: title supersede skips siblings, so an identical
        # second call (e.g. double calendar_propose_event) would otherwise stack.
        identical = await find_open_identical_decision(
            ctx.session,
            ctx.tenant_id,
            title=tool_input["title"],
            options=tool_input.get("options") or [],
            signal_id=target_signal_id,
        )
        if identical is not None:
            return {
                "decision_request_id": str(identical.id),
                "status": "already_open",
                "message": (
                    "This exact proposal is already waiting. Do not raise it again; "
                    "one Approve card is enough."
                ),
            }
        # Same turn: do not stack Ja/Nee cards under different titles (U75).
        opts = tool_input.get("options") or []
        if (
            ctx.bundle_id
            and not executable_option_actions(opts)
            and options_ack_signature(opts)
            and not primary_option_key(opts)[0]
        ):
            ack_sibling = await find_open_ack_in_bundle(
                ctx.session,
                ctx.tenant_id,
                signal_id=target_signal_id,
                bundle_id=str(ctx.bundle_id),
            )
            if ack_sibling is not None:
                return {
                    "decision_request_id": str(ack_sibling.id),
                    "status": "already_open",
                    "message": (
                        "An acknowledge Decision is already open in this turn. "
                        "Do not raise another Ja/Nee card; wait for that answer."
                    ),
                }
    else:
        # Cards without a thread (heartbeat wakes, scheduled runs) used to pile
        # up: one tenant collected 34 identical "Turn on Banking?" cards, each
        # in its own internal thread. Same title + same primary action while a
        # previous ask is still open means the question is already on the table.
        duplicate = await find_open_duplicate_decision(
            ctx.session,
            ctx.tenant_id,
            title=tool_input["title"],
            options=tool_input.get("options") or [],
        )
        if duplicate is not None:
            return {
                "decision_request_id": str(duplicate.id),
                "status": "already_open",
                "message": (
                    "This question is already waiting for a human decision. "
                    "Do not ask again; mention it at most once in your summary."
                ),
            }
    project_uuid = None
    raw_project = tool_input.get("project_id")
    if raw_project:
        try:
            project_uuid = UUID(str(raw_project))
        except ValueError:
            project_uuid = None
    from app.services.signal_decisions import create_decision

    # Provenance: the card names the run and, when the run executes a queue
    # item, the AgentTask behind it. The task lives on the run, so one lookup
    # covers every caller instead of threading a task id through the executor.
    task_uuid: UUID | None = None
    if ctx.run_id:
        from app.models.agent import AgentRun

        run_row = (
            await ctx.session.execute(select(AgentRun).where(AgentRun.id == ctx.run_id))
        ).scalar_one_or_none()
        if run_row:
            task_uuid = run_row.task_id

    from app.services.proposal_items import resolve_items

    raw_items = tool_input.get("items")
    items = await resolve_items(ctx.session, ctx.tenant_id, raw_items if isinstance(raw_items, list) else None)
    question = strip_emoji(str(tool_input.get("question") or "")).strip() or None
    selection = str(tool_input.get("selection") or "single").strip().lower()
    if selection not in ("single", "multiple"):
        selection = "single"
    asker_id = ctx.agent.id if ctx.agent else None
    # Agent turns defer thread/notification publish until speech is persisted
    # (place_turn_decisions → reveal_decision) so cards land under the question.
    decision, _ = await create_decision(
        ctx.session,
        ctx.tenant_id,
        title=tool_input["title"],
        summary=tool_input.get("summary", ""),
        options=tool_input.get("options", []),
        user_id=ctx.user_id,
        agent_id=asker_id,
        signal_id=target_signal_id,
        project_id=project_uuid,
        agent_task_id=task_uuid,
        run_id=ctx.run_id,
        source_id=str(asker_id) if asker_id else None,
        notification_payload={k: v for k, v in tool_input.items() if k != "items"},
        to=await parse_target(ctx.session, ctx.tenant_id, tool_input.get("to")),
        items=items,
        question=question,
        selection=selection,
        bundle_id=ctx.bundle_id,
        reveal=not bool(ctx.turn_id),
    )
    await ctx.session.commit()
    result: dict[str, Any] = {"decision_request_id": str(decision.id), "status": "awaiting_human"}
    missing = [item for item in items if item.get("missing")]
    if missing:
        result["missing_items"] = [{"type": i["type"], "id": i["id"]} for i in missing]
    return result


PROPOSAL_COOLDOWN_DAYS = 7


async def proposal_cooldown(ctx: ToolContext, title: str) -> dict[str, Any] | None:
    """Block a proposal card a human declined recently (module, integration, source).

    Returns the tool result to hand back to the agent, or None when the
    proposal may be raised.
    """
    declined = await recently_declined_decision(
        ctx.session, ctx.tenant_id, title=title, within_days=PROPOSAL_COOLDOWN_DAYS
    )
    if declined is None:
        return None
    when = declined.resolved_at.date().isoformat() if declined.resolved_at else "recently"
    return {
        "ok": False,
        "code": "recently_declined",
        "decision_request_id": str(declined.id),
        "message": (
            f"A human answered '{declined.status}' to this proposal on {when}. "
            f"Do not propose it again within {PROPOSAL_COOLDOWN_DAYS} days."
        ),
    }


async def _suggest_integration(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.integrations_catalog import PROVIDER_BY_SLUG

    provider = str(tool_input["provider"])
    catalog = PROVIDER_BY_SLUG.get(provider)
    display_name = catalog["name"] if catalog else provider.replace("_", " ").title()
    blocked = await proposal_cooldown(ctx, f"Connect {display_name}?")
    if blocked:
        return blocked
    options = [
        {"id": "connect", "label": "Connect now", "action_type": "setup_integration", "payload": tool_input},
        {"id": "later", "label": "Later", "action_type": "defer"},
    ]
    return await _create_decision_request(
        ctx,
        {
            "title": f"Connect {display_name}?",
            "summary": tool_input.get("reason", ""),
            "signal_id": tool_input.get("signal_id"),
            "items": [{"type": "marketplace", "id": provider}],
            "options": options,
        },
    )


async def _ask_domain_question(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """A lead asks the person accountable something only they know; the answer becomes a domain fact."""
    from uuid import UUID as _UUID

    from app.models.team import Department
    from app.services.department_domain import agent_departments, ask_domain_question

    if ctx.agent is None:
        return {"error": "Only a department lead asks domain questions"}
    led = [d for d, duty in await agent_departments(ctx.session, ctx.tenant_id, ctx.agent.id) if duty == "primary"]
    raw = str(tool_input.get("department_id") or "").strip()
    dept: Department | None = None
    if raw:
        try:
            dept = next((d for d in led if d.id == _UUID(raw)), None)
        except ValueError:
            dept = None
    elif led:
        dept = next((d for d in led if d.parent_id is not None), led[0])
    if dept is None:
        return {"error": "You do not lead that department"}
    try:
        row = await ask_domain_question(
            ctx.session, ctx.tenant_id, dept, str(tool_input.get("question") or ""), agent_id=ctx.agent.id
        )
    except ValueError as exc:
        return {"error": str(exc)}
    await ctx.session.commit()
    return {
        "status": "duplicate" if row.get("duplicate") else "asked",
        "key": row["key"],
        "department": dept.name,
        "signal_id": row.get("signal_id"),
    }


async def _search_repo(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Hybrid search over indexed repository files (optionally one folder)."""
    from uuid import UUID as _UUID

    from app.services.repo_index import search_repo_chunks

    query = str(tool_input.get("query") or "").strip()
    if not query:
        return {"error": "query required"}
    project_id = ctx.project_id
    raw_project = str(tool_input.get("project_id") or "").strip()
    if raw_project:
        try:
            project_id = _UUID(raw_project)
        except ValueError:
            return {"error": "invalid project_id"}
    results = await search_repo_chunks(
        ctx.session, ctx.tenant_id, query, project_id=project_id, top_k=6
    )
    if not results:
        return {
            "results": [],
            "note": "No indexed repository content matched. Connect a repo on the folder and run reindex first.",
        }
    return {
        "results": [
            {"path": r["path"], "title": r["title"], "score": r["score"], "content": r["content"]}
            for r in results
        ]
    }


async def _suggest_inbox_rule(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Propose an inbox automation rule (learned from a correction or pattern).

    The rule lands as *suggested*; a human activates it from Inbox settings
    (Automation rules) or an inline card. Never activates anything itself.
    """
    from app.services.inbox_rules import (
        RULE_ACTIONS,
        normalize_match_value,
        raise_rule_decision,
        suggest_rule,
    )

    match_type = str(tool_input.get("match_type") or "sender")
    match_value = str(tool_input.get("match_value") or "")
    action = str(tool_input.get("action") or "")
    if match_type not in ("sender", "domain", "list_id"):
        return {"error": "match_type must be one of sender, domain, list_id."}
    if action not in RULE_ACTIONS:
        return {"error": f"action must be one of {', '.join(RULE_ACTIONS)}."}
    if not normalize_match_value(match_type, match_value):
        hint = {
            "sender": "a full email address (name@domain.tld)",
            "domain": "a bare domain (domain.tld)",
            "list_id": "the List-Id header value (list.domain.tld)",
        }[match_type]
        return {"error": f"match_value for {match_type} must be {hint}; got {match_value!r}."}

    payload = await suggest_rule(
        ctx.session,
        ctx.tenant_id,
        match_type=match_type,
        match_value=match_value,
        action=action,
        label=str(tool_input.get("label") or ""),
        source="agent",
        reason=str(tool_input.get("reason") or ""),
    )
    if payload is None:
        return {
            "error": (
                "Rule not suggested: a rule for this sender already exists "
                "(active or paused)."
            )
        }
    # In a conversation the question is asked inline, where the operator
    # already is; elsewhere the suggestion waits under Automation rules.
    raised = None
    if ctx.signal_id:
        raised = await raise_rule_decision(
            ctx.session,
            ctx.tenant_id,
            payload,
            signal_id=ctx.signal_id,
            agent_id=ctx.agent.id if ctx.agent else None,
            summary=str(tool_input.get("reason") or ""),
            reveal=not bool(ctx.turn_id),
        )
    await ctx.session.commit()
    return {
        "rule": payload,
        "decision": raised,
        "confirm_path": "/settings/channels#automation-rules",
        "note": (
            "Suggested only — the operator must activate it. "
            + (
                "An inline card now asks them on this thread; do not repeat the question."
                if raised
                else "Tell them with an in-app markdown link, e.g. "
                "[Automation rules](/settings/channels#automation-rules). "
                "Do not write plain breadcrumbs like Inbox > Automation rules."
            )
        ),
    }


async def _propose_integration(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    return await _suggest_integration(
        ctx,
        {
            "provider": tool_input["provider"],
            "reason": tool_input.get("reason", ""),
            "signal_id": str(ctx.signal_id) if ctx.signal_id else None,
        },
    )


async def _propose_agent_rule(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Suggest a rule for yourself; a person confirms it inline before it applies."""
    from fastapi import HTTPException

    from app.services.agent_rules import propose_rule

    if ctx.agent is None:
        return {"error": "Only agents can propose rules for themselves"}
    tenant = await ctx.session.get(Tenant, ctx.tenant_id)
    if tenant is None:
        return {"error": "Workspace not found"}
    rule = {
        "text": tool_input.get("text"),
        "mode": tool_input.get("mode"),
        "kind": tool_input.get("kind") or "judgement",
        "tool": tool_input.get("tool") or "",
        "category": tool_input.get("category") or "",
    }
    try:
        return await propose_rule(
            ctx.session,
            tenant,
            rule=rule,
            agent=ctx.agent,
            proposer_agent=ctx.agent,
            signal_id=ctx.signal_id,
        )
    except HTTPException as exc:
        return {"error": str(exc.detail)}


register_tool(
    ToolSpec(
        name="create_decision_request",
        description=(
            "Ask the human to choose between concrete options via an inline card. "
            "Set input_type to 'text' on an option to let the human answer with "
            "free text instead of clicking a fixed choice. "
            "For action_type use a real platform tool name when approving should "
            "run that tool, or one of: escalate, acknowledge, defer, reject. "
            "Each option needs a distinct id and label. Use send_reply with "
            "payload.body_text when the choice should send a customer message "
            "(e.g. clarification). Use escalate or acknowledge only when a human "
            "takes over with no outbound mail. Outside a conversation (check-ins, "
            "scheduled wakes) pass thread_subject so the card lands on the thread "
            "it concerns; a card without a thread needs at least one option that "
            "runs a platform tool, otherwise report the observation instead. "
            "In a chat, the options appear as buttons under your last message; "
            "pass items (type + id from tool results) so the objects show as "
            "previews inside the message — never paste ids or dump titles in text."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "summary": {"type": "string"},
                "question": {
                    "type": "string",
                    "description": (
                        "Short question shown above the buttons when your message "
                        "does not already ask it."
                    ),
                },
                "items": PROPOSAL_ITEMS_SCHEMA,
                "selection": {
                    "type": "string",
                    "enum": ["single", "multiple"],
                    "description": "single (default) or multiple picks before Confirm.",
                },
                "signal_id": {"type": "string"},
                "thread_subject": {
                    "type": "string",
                    "description": (
                        "Subject (or a distinctive part of it) of the conversation this "
                        "question is about, when signal_id is unknown."
                    ),
                },
                "to": TO_TARGET_SCHEMA,
                "options": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "label": {"type": "string"},
                            "action_type": {"type": "string"},
                            "payload": {"type": "object"},
                            "input_type": {
                                "type": "string",
                                "enum": ["text"],
                                "description": "Ask for a free-text answer when this option is chosen.",
                            },
                            "input_placeholder": {"type": "string"},
                            "item_ref": {"type": "object"},
                        },
                    },
                },
            },
            "required": ["title", "options"],
        },
        handler=_create_decision_request,
        gated=False,
        audience="both",
    )
)


def _learn_blob(ctx: ToolContext, tool_name: str) -> dict[str, Any] | None:
    if ctx.agent is None or not tool_name:
        return None
    return {
        "tool": tool_name,
        "agent_id": str(ctx.agent.id),
        "reason": "",
        "rule_text": "",
    }


def _with_learn(ctx: ToolContext, options: list[Any]) -> list[Any]:
    """Every option that runs a platform tool can teach the agent "always" / "never".

    One place for every card producer, so a new proposal tool cannot forget it.
    """
    from app.tools.registry import get_tool_spec

    out: list[Any] = []
    for option in options:
        if not isinstance(option, dict) or isinstance(option.get("learn"), dict):
            out.append(option)
            continue
        action_type = str(option.get("action_type") or "").strip()
        runs_tool = (
            action_type
            and action_type not in ("reject", "defer", "escalate")
            and action_type not in NON_EXECUTABLE_ACTIONS
            and get_tool_spec(action_type) is not None
        )
        learn = _learn_blob(ctx, action_type) if runs_tool else None
        out.append({**option, "learn": learn} if learn else option)
    return out


async def _propose_action(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.tools.registry import get_tool_spec

    question = str(tool_input.get("question") or "").strip()
    action = str(tool_input.get("action") or "").strip()
    if not question:
        return {"ok": False, "code": "missing_question", "message": "Pass the question to ask."}
    if action and get_tool_spec(action) is None:
        return {"ok": False, "code": "unknown_action", "message": f"No platform tool named {action}."}
    options: list[dict[str, Any]] = []
    if action:
        approve_opt: dict[str, Any] = {
            "id": "approve",
            "label": str(tool_input.get("approve_label") or "Approve"),
            "action_type": action,
            "payload": tool_input.get("payload") or {},
        }
        options.append(approve_opt)
    for extra in tool_input.get("options") or []:
        if isinstance(extra, dict) and extra.get("id") and extra.get("label"):
            row = dict(extra)
            action_type = str(row.get("action_type") or "").strip()
            # Invented verbs (e.g. open_thread) used to resolve as Unknown action
            # and reopen the card. Soften to a label-only pick so Approve still
            # continues the chat; real tools and resolver actions stay.
            if (
                action_type
                and action_type not in NON_EXECUTABLE_ACTIONS
                and action_type not in RESOLVER_ACTIONS
                and get_tool_spec(action_type) is None
            ):
                row.pop("action_type", None)
            options.append(row)
    if not options:
        return {
            "ok": False,
            "code": "no_options",
            "message": "Pass action (the tool to run on approve) or at least one option.",
        }
    if not any(o.get("id") == "reject" for o in options):
        options.append({"id": "reject", "label": str(tool_input.get("reject_label") or "Reject"), "action_type": "reject"})
    return await _create_decision_request(
        ctx,
        {
            "title": str(tool_input.get("title") or question)[:200],
            "summary": str(tool_input.get("summary") or ""),
            "question": question,
            "items": tool_input.get("items") or [],
            "options": options,
            "signal_id": tool_input.get("signal_id"),
            "selection": tool_input.get("selection") or "single",
        },
    )


register_tool(
    ToolSpec(
        name="propose_action",
        description=(
            "End your chat message with an inline proposal when you need an answer. "
            "Write a short question (use #tags and [docs](/docs/…) inline; never paste "
            "ids). Pass items for showcase previews, selection single or multiple, and "
            "options (option.id may match an item id so clicking the preview chooses "
            "it). For destructive work (e.g. delete_tag), pass action + payload so "
            "Approve runs that tool; do not invent soft Yes labels without action. "
            "Buttons appear under your message. To only show objects without asking, "
            "use attach_items instead."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "question": {"type": "string", "description": "Short question, e.g. 'Restore this item?'"},
                "action": {"type": "string", "description": "Platform tool to run when approved"},
                "payload": {"type": "object", "description": "Input for that tool"},
                "items": PROPOSAL_ITEMS_SCHEMA,
                "selection": {
                    "type": "string",
                    "enum": ["single", "multiple"],
                    "description": "single (default) or multiple — operator can pick several options then Confirm.",
                },
                "approve_label": {"type": "string"},
                "reject_label": {"type": "string"},
                "title": {"type": "string"},
                "summary": {"type": "string"},
                "signal_id": {"type": "string"},
                "options": {
                    "type": "array",
                    "description": "Choices. Set id to an item id to link a showcase row to that option.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "label": {"type": "string"},
                            "action_type": {"type": "string"},
                            "payload": {"type": "object"},
                            "input_type": {"type": "string", "enum": ["text"]},
                            "input_placeholder": {"type": "string"},
                            "item_ref": {
                                "type": "object",
                                "description": "Optional {type,id} linking this option to a showcase item.",
                            },
                        },
                    },
                },
            },
            "required": ["question"],
        },
        handler=_propose_action,
        gated=False,
        audience="both",
    )
)


register_tool(
    ToolSpec(
        name="suggest_integration",
        description="Proactively suggest setting up an integration or MCP.",
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "provider": {"type": "string"},
                "reason": {"type": "string"},
                "signal_id": {"type": "string"},
            },
            "required": ["provider", "reason"],
        },
        handler=_suggest_integration,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="ask_domain_question",
        description=(
            "Ask the person accountable for your department something only they know "
            "(a rule, a preference, a threshold). The question lands in the department "
            "conversation; the answer becomes a domain fact in your standing brief. "
            "Only department leads can ask. The same question is never asked twice."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "question": {"type": "string", "description": "One concrete question"},
                "department_id": {"type": "string", "description": "Optional; defaults to the department you lead"},
            },
            "required": ["question"],
        },
        handler=_ask_domain_question,
        gated=False,
        display_name="Ask a domain question",
    )
)

register_tool(
    ToolSpec(
        name="search_repo",
        description=(
            "Search the indexed source code and docs of connected GitHub repositories. "
            "Optionally scope to one folder with project_id. Returns matching file "
            "chunks with paths."
        ),
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "project_id": {"type": "string"},
            },
            "required": ["query"],
        },
        handler=_search_repo,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="suggest_inbox_rule",
        description=(
            "Suggest an inbox automation rule after learning from a correction or a "
            "recurring pattern (e.g. always auto-close newsletters from a sender). "
            "The operator must confirm before it activates — point them to "
            "confirm_path with an in-app markdown link. "
            "Actions: auto_close, auto_task, mute_ai."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "match_type": {"type": "string", "enum": ["sender", "domain", "list_id"]},
                "match_value": {"type": "string"},
                "action": {"type": "string", "enum": ["auto_close", "auto_task", "mute_ai"]},
                "label": {"type": "string"},
                "reason": {"type": "string"},
            },
            "required": ["match_value", "action", "reason"],
        },
        handler=_suggest_inbox_rule,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="propose_agent_rule",
        description=(
            "Propose a rule for when you act on your own and when you ask first. "
            "Use it when a person tells you how to handle a kind of situation from now on. "
            "Nothing changes until a person confirms the proposal in the conversation."
        ),
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "The rule in one sentence, as the person said it"},
                "mode": {"type": "string", "enum": ["manual", "assisted", "autonomous"]},
                "kind": {
                    "type": "string",
                    "enum": ["hard", "judgement"],
                    "description": "hard: always for one action or category; judgement: you weigh it per case",
                },
                "tool": {"type": "string", "description": "Action name for a hard rule"},
                "category": {"type": "string", "description": "Tool category for a hard rule"},
            },
            "required": ["text", "mode"],
        },
        handler=_propose_agent_rule,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="propose_integration",
        description="Propose connecting an integration; always routes to human decision.",
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {
                "provider": {"type": "string"},
                "reason": {"type": "string"},
                "display_name": {"type": "string"},
            },
            "required": ["provider", "reason"],
        },
        handler=_propose_integration,
        gated=False,
    )
)

_DECISION_ACTIONS = {
    "approve": "approved",
    "approved": "approved",
    "reject": "rejected",
    "rejected": "rejected",
    "defer": "deferred",
    "deferred": "deferred",
}


async def _resolve_decision(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Answer a pending decision card the same way the inbox does."""
    from app.services.notifications import DecisionActionError
    from app.services.notifications import resolve_decision as resolve

    raw = str(tool_input.get("decision_id") or "").strip()
    try:
        decision_id = UUID(raw)
    except ValueError:
        return {"error": "decision_id must be a valid id"}
    action = _DECISION_ACTIONS.get(str(tool_input.get("action") or "").strip().lower())
    if action is None:
        return {"error": "action must be approve, reject, or defer"}

    decision = (
        await ctx.session.execute(
            select(DecisionRequest).where(
                DecisionRequest.id == decision_id,
                DecisionRequest.tenant_id == ctx.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if decision is None:
        return {"error": "Decision not found"}
    if decision.status != "awaiting_human":
        return {
            "error": f"Decision is already {decision.status}",
            "decision_id": str(decision.id),
            "status": decision.status,
        }

    try:
        options = json.loads(decision.options_json or "[]")
    except json.JSONDecodeError:
        options = []
    option_ids = [str(o.get("id")) for o in options if isinstance(o, dict) and o.get("id")]
    option_id = str(tool_input.get("chosen_option_id") or "").strip()
    if option_id:
        if option_ids and option_id not in option_ids:
            return {"error": f"Unknown option. Choose one of: {', '.join(option_ids)}"}
    elif action == "approved":
        # Approving runs the option's action, so never guess between choices.
        actionable = [
            str(o.get("id"))
            for o in options
            if isinstance(o, dict)
            and o.get("id")
            and str(o.get("action_type") or "") not in ("reject", "defer")
        ]
        if len(actionable) != 1:
            return {
                "error": "chosen_option_id is required",
                "options": options,
            }
        option_id = actionable[0]
    else:
        option_id = "reject" if action == "rejected" else "defer"

    try:
        resolved = await resolve(
            ctx.session,
            ctx.tenant_id,
            decision_id,
            option_id,
            action,
            user_id=ctx.user_id,
        )
    except ValueError as exc:
        return {"error": str(exc)}
    except DecisionActionError as exc:
        return {"error": str(exc.detail), "decision_id": str(decision_id), "status": "awaiting_human"}
    return {
        "decision_id": str(resolved.id),
        "status": resolved.status,
        "chosen_option_id": resolved.chosen_option_id,
        "title": resolved.title,
    }


register_tool(
    ToolSpec(
        name="resolve_decision",
        description=(
            "Answer a pending decision card: approve, reject, or defer it. "
            "Approving runs the chosen option's action, so pass "
            "chosen_option_id whenever the card offers more than one real "
            "choice. Always asks a human first."
        ),
        category="govern",
        input_schema={
            "type": "object",
            "properties": {
                "decision_id": {"type": "string"},
                "action": {"type": "string", "enum": ["approve", "reject", "defer"]},
                "chosen_option_id": {"type": "string"},
            },
            "required": ["decision_id", "action"],
        },
        handler=_resolve_decision,
        mutating=True,
        gated=True,
        consequential=True,
    )
)
