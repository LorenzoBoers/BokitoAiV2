import base64
import json
import logging
import re
import time
from typing import Any, AsyncGenerator
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.agent import Agent, AgentRun, RunEvent
from app.services.agent.llm import get_chat_provider, get_llm_provider
from app.services.agent.turn import TurnRecorder
from app.services.agent.tools import (
    execute_tool,
    filter_tools_for_agent,
    get_tool_definitions,
)
from app.tools.registry import audience_for_trust, filter_tools_for_audience
from app.services.workspace import build_workspace_context, hybrid_search

logger = logging.getLogger(__name__)

# How many backing-chain steps one turn may fall through on rate limits.
_MAX_FAILOVER_STEPS = 3


def _sniff_image_mime(data: bytes) -> str | None:
    """Detect common image formats from magic bytes (uploads may lack a mime)."""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"GIF8"):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _attachment_mime(att: dict) -> str:
    """The attachment's mime, falling back to an extension guess.

    Older widget bundles sent attachments as bare ``{id, url}`` without a
    mime; those must still resolve to images so vision keeps working.
    """
    mime = str(att.get("mime", "") or "")
    if mime:
        return mime
    import mimetypes

    name = str(att.get("name") or att.get("filename") or "")
    url = str(att.get("url") or "")
    guessed, _ = mimetypes.guess_type(name if "." in name else url)
    return guessed or ""


def _truncate_trace_value(value: Any, max_chars: int = 480) -> Any:
    """Keep persisted step payloads small enough for message metadata."""
    try:
        if isinstance(value, (dict, list)):
            text = json.dumps(value, default=str)
        else:
            text = str(value)
    except Exception:
        text = str(value)
    if len(text) <= max_chars:
        return value
    return f"{text[:max_chars]}..."


class AgentLoop:
    def __init__(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        user_id: UUID | None,
        agent: Agent | None = None,
        run: AgentRun | None = None,
        signal_id: UUID | None = None,
        trust: str = "operator",
        *,
        allowed_tool_names: set[str] | None = None,
        enable_chat_thinking: bool = False,
        tool_signal_id: UUID | None = None,
        user_role: str | None = None,
        surface: str = "",
        reply_mode: str | None = None,
        model_override: str | None = None,
        task_hint: str | None = None,
    ):
        self.session = session
        # mail | chat | document; resolved from the thread channel when None.
        self.reply_mode = reply_mode
        self.turn: TurnRecorder | None = None
        self._mcp_providers: dict[str, str] | None = None
        self.tenant_id = tenant_id
        self.user_id = user_id
        self.agent = agent
        self.run = run
        self.signal_id = signal_id
        # Optional force from a flow stage / Agenda item / tool call.
        self.model_override = model_override
        # Hint for Automatic mode (lighter | heavier | free text).
        self.task_hint = task_hint
        # Thread that tool calls act on. Differs from `signal_id` when the
        # conversation is an assistant session about another thread: streaming
        # stays in the session, while replies/tags/handover hit the real thread.
        self.tool_signal_id = tool_signal_id or signal_id
        self.trust = trust
        self.surface = surface
        self.audience = audience_for_trust(trust)
        # Showcase cards from attach_items for this turn (request-scoped backup
        # for the module-level stash that persist_agent_turn consumes).
        self._showcase_items: list[dict[str, Any]] = []
        # Membership role of the session user; explicit when the caller has an
        # AuthContext (staff sessions map to admin there), else resolved from
        # the membership row on first tool call. Autonomous runs stay None.
        self._user_role_override = user_role
        self._user_role_cached: str | None = None
        self._user_role_resolved = False
        # One Tenant / reachability load per turn (prompt + tool gating share it).
        self._tenant_cached = None
        self._tenant_resolved = False
        self._reachable_cached: bool | None = None
        self.enable_chat_thinking = enable_chat_thinking
        self.llm = get_llm_provider()
        # Set during run_chat once the model call is resolved (drives metering).
        self.resolved_call = None
        # Metering labels; orchestration/workstream callers override before run_chat.
        self.usage_scope = "chat"
        self.usage_call_type = "chat"
        # Passport: an agent only sees the tools it is permitted to use.
        tools = filter_tools_for_agent(get_tool_definitions(), agent)
        if allowed_tool_names is not None:
            tools = [t for t in tools if t["name"] in allowed_tool_names]
        # External conversations (widget/inbound) must always be able to
        # escalate to a human, regardless of the agent's tool allowlist.
        if trust == "external" and not any(t["name"] == "handoff_to_human" for t in tools):
            handoff = next(
                (t for t in get_tool_definitions() if t["name"] == "handoff_to_human"), None
            )
            if handoff:
                tools = [*tools, handoff]
        self.tools = tools
        self.max_loops = agent.max_loops if agent else 15
        # Compact step log for chat history (tool calls / think) + token usage UI.
        self.trace_steps: list[dict[str, Any]] = []
        # RAG hits from the latest turn; the widget stream uses these to append
        # "related article" links when hits map to published help-center docs.
        self.last_rag_hits: list[dict[str, Any]] = []
        self.thinking_text = ""
        self.thinking_ms = 0
        self.thinking_budget = 0
        # One soft nudge per turn when the model announces work but emits no tools.
        self._continue_nudged = False

    # Phrases that mean "I will do X next" without having called a tool yet.
    _WORK_ANNOUNCE_RE = re.compile(
        r"(?i)\b("
        r"even kijken|ik ga |laat me |ik zoek|ik kijk|ik pak|"
        r"i(?:'| a)?m going to|let me |i(?:'| wi)?ll |looking up|checking |"
        r"i will |going to (?:look|check|list|find|create|file|open)"
        r")\b"
    )

    def _looks_like_work_announce(self, text: str) -> bool:
        cleaned = (text or "").strip()
        if len(cleaned) < 12 or len(cleaned) > 400:
            return False
        if not self._WORK_ANNOUNCE_RE.search(cleaned):
            return False
        # Finished answers usually end with a period after substance; keep it
        # loose — the nudge is cheap and only runs once.
        return True

    def _append_continue_nudge(
        self,
        llm_messages: list[dict[str, Any]],
        assistant_content: list[dict[str, Any]],
    ) -> None:
        """Ask the model to follow through after a plan-only reply."""
        self._continue_nudged = True
        llm_messages.append({"role": "assistant", "content": assistant_content})
        llm_messages.append(
            {
                "role": "user",
                "content": (
                    "Continue now. Call the tools you need and finish the work. "
                    "Do not only announce what you will do."
                ),
            }
        )

    def _resolve_thinking_budget(self) -> int:
        """This turn's reasoning budget (see ``reasoning_policy``).

        An agent's own budget always reasons; the global chat default only
        reasons when the message calls for it. Kong always reasons.
        """
        from app.services.agent.reasoning_policy import turn_thinking_budget

        agent_budget = int(getattr(self.agent, "thinking_budget", 0) or 0) if self.agent else 0
        if agent_budget > 0:
            configured = agent_budget
        elif self.enable_chat_thinking:
            configured = max(0, int(get_settings().chat_thinking_budget or 0))
        else:
            configured = 0
        return turn_thinking_budget(
            configured,
            model_slug=getattr(self, "_turn_model_slug", None),
            user_text=getattr(self, "_turn_user_text", ""),
            has_attachments=getattr(self, "_turn_has_attachments", False),
            agent_pinned=agent_budget > 0,
        )

    def _resolve_max_tokens(self) -> int | None:
        if self.agent and getattr(self.agent, "max_tokens", None):
            return int(self.agent.max_tokens)
        return None

    def thinking_payload(self) -> dict[str, Any] | None:
        text = (self.thinking_text or "").strip()
        if len(text) > 8000:
            text = f"{text[:8000]}..."
        # No reasoning text, nothing to unfold: the UI only shows "Thought for"
        # when there is something to read.
        if not text:
            return None
        return {
            "text": text,
            "ms": self.thinking_ms,
            "budget": self.thinking_budget,
        }

    async def _log_event(self, event_type: str, message: str, payload: dict | None = None) -> None:
        if not self.run:
            return
        event = RunEvent(
            run_id=self.run.id,
            tenant_id=self.tenant_id,
            event_type=event_type,
            message=message,
            payload_json=json.dumps(payload or {}),
        )
        self.session.add(event)
        await self.session.commit()
        from app.gateway.publish import publish_run_event

        await publish_run_event(
            self.tenant_id,
            self.run.id,
            event_type=event_type,
            message=message,
            payload=payload or {},
            status=self.run.status,
        )

    def _append_trace_step(
        self,
        step_type: str,
        name: str = "",
        payload: dict | None = None,
    ) -> None:
        """Record a compact step for persistence on the assistant message."""
        raw = payload or {}
        compact: dict[str, Any] = {}
        if "input" in raw:
            compact["input"] = _truncate_trace_value(raw["input"])
        if "result" in raw:
            compact["result"] = _truncate_trace_value(raw["result"])
        self.trace_steps.append(
            {
                "step_type": step_type,
                "name": name,
                "payload": compact,
            }
        )

    def _new_turn(self) -> TurnRecorder:
        publish = None
        if self.signal_id:
            from app.gateway.publish import publish_turn_event

            tenant_id, signal_id = self.tenant_id, self.signal_id

            async def publish(event: str, data: dict[str, Any]) -> None:
                await publish_turn_event(tenant_id, signal_id, event, data)

        self.turn = TurnRecorder(publish)
        return self.turn

    async def persist_turn(
        self,
        signal: Any,
        *,
        metadata: dict[str, Any] | None = None,
        first_metadata: dict[str, Any] | None = None,
        final_metadata: dict[str, Any] | None = None,
        fallback_text: str = "Done.",
        append_to_last: str = "",
    ) -> list[Any]:
        """Save the last turn on ``signal``: chat bubbles or one mail message."""
        from app.services.agent.turn_persist import persist_agent_turn

        turn = self.turn
        showcase = list(self._showcase_items)
        self._showcase_items = []
        return await persist_agent_turn(
            self.session,
            signal,
            segments=list(turn.segments) if turn else [],
            reply_mode=await self._resolve_reply_mode(),
            author_agent_id=self.agent.id if self.agent else None,
            metadata=metadata,
            first_metadata=first_metadata,
            final_metadata=final_metadata,
            turn_id=turn.stream_id if turn else None,
            fallback_text=fallback_text,
            append_to_last=append_to_last,
            showcase_items=showcase,
        )

    async def _resolve_reply_mode(self) -> str:
        if self.reply_mode:
            return self.reply_mode
        from app.models.signal import Signal
        from app.services.agent.reply_mode import reply_mode_for

        channel = None
        if self.signal_id:
            signal = await self.session.get(Signal, self.signal_id)
            channel = signal.channel if signal else None
        self.reply_mode = reply_mode_for(channel)
        return self.reply_mode

    async def _tool_presentation(self, name: str, tool_input: Any) -> dict[str, str]:
        from app.tools.registry import tool_presentation

        shown = tool_presentation(name)
        if name == "web_search" and isinstance(tool_input, dict):
            query = str(tool_input.get("query") or "").strip()
            if query:
                shown["label"] = f"Search: {query}"
        if name == "call_mcp_tool" and isinstance(tool_input, dict):
            server = str(tool_input.get("server_name") or "")
            inner = str(tool_input.get("tool_name") or "")
            if inner:
                from app.tools.registry import humanize_tool_name

                shown["label"] = humanize_tool_name(inner)
            if server:
                shown["provider"] = (await self._mcp_provider_map()).get(server, "")
        return shown

    async def _mcp_provider_map(self) -> dict[str, str]:
        """MCP server name -> integration provider slug, for activity icons."""
        if self._mcp_providers is not None:
            return self._mcp_providers
        providers: dict[str, str] = {}
        try:
            from app.models.integration import IntegrationConnection, McpServer

            servers = (
                await self.session.execute(
                    select(McpServer.id, McpServer.name).where(McpServer.tenant_id == self.tenant_id)
                )
            ).all()
            conns = (
                await self.session.execute(
                    select(IntegrationConnection.provider, IntegrationConnection.metadata_json).where(
                        IntegrationConnection.tenant_id == self.tenant_id
                    )
                )
            ).all()
            by_server: dict[str, str] = {}
            for provider, meta_json in conns:
                try:
                    meta = json.loads(meta_json or "{}")
                except json.JSONDecodeError:
                    continue
                sid = str(meta.get("mcp_server_id") or "") if isinstance(meta, dict) else ""
                if sid:
                    by_server[sid] = provider or ""
            for sid, name in servers:
                providers[name] = by_server.get(str(sid), "")
        except Exception:  # noqa: BLE001 - icons are cosmetic
            providers = {}
        self._mcp_providers = providers
        return providers

    async def _session_user_role(self) -> str | None:
        """Membership role of the chatting user (None for autonomous runs)."""
        if self._user_role_override:
            return self._user_role_override
        if not self.user_id:
            return None
        if self._user_role_resolved:
            return self._user_role_cached
        from sqlalchemy import select

        from app.models.auth import Membership

        membership = (
            await self.session.execute(
                select(Membership).where(
                    Membership.tenant_id == self.tenant_id,
                    Membership.user_id == self.user_id,
                )
            )
        ).scalar_one_or_none()
        self._user_role_cached = membership.role if membership else "member"
        self._user_role_resolved = True
        return self._user_role_cached

    async def _get_tenant(self):
        """Tenant row for this loop, loaded at most once."""
        if self._tenant_resolved:
            return self._tenant_cached
        from app.models.auth import Tenant

        self._tenant_cached = await self.session.get(Tenant, self.tenant_id)
        self._tenant_resolved = True
        return self._tenant_cached

    async def _operator_context(self) -> str:
        """Tell the model who is chatting — an internal operator, not a customer."""
        if not self.user_id:
            return ""
        from app.models.auth import User

        user = await self.session.get(User, self.user_id)
        if not user:
            return ""
        role = await self._session_user_role() or "member"
        name = (user.display_name or "").strip() or user.email
        return (
            "## Current operator\n"
            f"You are assisting {name} <{user.email}>, a workspace {role} on this "
            "Bokito tenant. They are an internal operator (teammate), not an external "
            "customer. Address them as a colleague. Prefer tools and workspace context "
            "over asking them for information that is already in the tenant snapshot."
        )

    async def _build_system_prompt(self, extra_context: str = "", user_query: str = "") -> str:
        workspace = await build_workspace_context(
            self.session,
            self.tenant_id,
            agent_id=self.agent.id if self.agent is not None else None,
        )
        rag_context = ""
        product_help_context = ""
        if user_query:
            hits = await hybrid_search(self.session, self.tenant_id, user_query, top_k=5)
            self.last_rag_hits = hits or []
            if hits:
                rag_context = "\n".join(f"- {h['title']}: {h['content'][:300]}" for h in hits)
            if self.trust != "external":
                from app.services.language import resolve_workspace_language
                from app.services.product_help import search_product_help

                tenant = await self._get_tenant()
                help_lang = resolve_workspace_language(tenant)
                if help_lang not in ("en", "nl"):
                    help_lang = get_settings().platform_default_language
                product_hits = await search_product_help(
                    user_query,
                    lang=help_lang,
                    top_k=3,
                )
                if product_hits:
                    product_help_context = "\n".join(
                        f"- {h['title']} (/learn/{h['slug']}): {h['content'][:300]}"
                        for h in product_hits
                    )
        default_prompt = (
            "You are the Bokito AI OS assistant. "
            "You have introspection tools (get_tenant_overview, list_recent_activity, "
            "list_tasks, list_threads, list_tags, get_usage_summary) and a Tenant snapshot "
            "in context — use them before saying you lack information about the tenant, "
            "projects, tags, or activity."
        )
        base = self.agent.system_prompt if self.agent and self.agent.system_prompt else default_prompt
        parts = [base]
        if self.agent is not None:
            if self.trust == "external":
                parts.append(f"## You\nYour name is {self.agent.name}.")
            else:
                parts.append(
                    "## You\n"
                    f"You are @[{self.agent.name}](agent:{self.agent.id}), not any other agent "
                    "in the workspace. Refer to yourself or a colleague with the chip from the "
                    "Tenant snapshot or a tool result, copied exactly; never make up an id."
                )
        if workspace:
            parts.append(workspace)
        # Always remind agents with custom prompts that live tenant tools exist.
        if self.agent and self.agent.system_prompt:
            parts.append(
                "## Introspection\n"
                "Before claiming you lack information, call get_tenant_overview, "
                "list_tags (for hashtags / action tags), or list_recent_activity. "
                "Do not infer which tags exist from search_index or conversation text. "
                "Strategy and project docs may require read_doc."
            )
        if rag_context:
            parts.append(f"## Relevant context\n{rag_context}")
        if product_help_context:
            parts.append(
                "## How Bokito works\n"
                "Cite these platform help articles when the user asks how to use Bokito. "
                "In-app path is /learn/{slug}; the public URL is /docs/{slug}.\n"
                f"{product_help_context}"
            )
        if self.trust == "external":
            reachable = await self._team_reachable()
            if reachable:
                parts.append(
                    "## Human handoff\n"
                    "You can hand this conversation to a human team member at any time "
                    "by calling the handoff_to_human tool. Do this when the visitor asks "
                    "for a human, employee, or agent, when they are clearly frustrated, "
                    "or when you cannot help. Never claim you are unable to connect them "
                    "with a human. After the tool succeeds, tell the visitor a team "
                    "member will take over in this same conversation."
                )
            else:
                parts.append(
                    "## Team availability\n"
                    "Nobody who can take a live handoff is available right now. Chat "
                    "stays open; never say the chat is closed or offline. If the visitor "
                    "wants a person, say honestly that nobody is available at this moment "
                    "and offer the alternatives: leave an email address so the team can "
                    "write back, or a callback (call request_callback). Tell them the team "
                    "follows up in this conversation."
                )
            parts.append(
                "## Customer confirmation\n"
                "Never claim you can see invoices or account data until the "
                "visitor has confirmed a short email link. Call "
                "request_customer_verify with the email they give you. Always "
                "tell them to check their inbox. Never say whether an account "
                "exists. Chat stays open after the link is sent.\n\n"
                "## Who is this\n"
                "When the visitor gives an email address or phone number, call "
                "link_conversation_contact once with it (and their name if "
                "given). It never tells you whether a contact exists; continue "
                "the conversation normally."
            )
        else:
            operator = await self._operator_context()
            if operator:
                parts.append(operator)
            # The personal assistant is the one agent that carries memory of
            # the person across workspaces.
            if self.agent is not None and self.agent.acts_for_user:
                from app.services.user_memory import user_memory_block

                memory = await user_memory_block(self.session, self.user_id)
                if memory:
                    parts.append(memory)
        from app.services.assistant_context import category_map_block

        category_map = await category_map_block(self.session, self.tenant_id)
        if category_map:
            parts.append(category_map)
        if extra_context:
            parts.append(extra_context)
        # Platform-wide response style: applies to every agent, custom or not.
        from app.services.agent.style import identity_for_bokito_slug, style_for_reply_mode

        parts.append(style_for_reply_mode(await self._resolve_reply_mode()))
        from app.services.language import language_rules_for_trust

        tenant_for_lang = await self._get_tenant()
        parts.append(language_rules_for_trust(self.trust, tenant_for_lang))
        if self.agent is not None and self.trust != "external":
            from app.services.agent_rules import all_rules, when_to_ask_prompt

            parts.append(when_to_ask_prompt(all_rules(tenant_for_lang, self.agent)))
        # Bokito virtual models present as Bokito's own model; agents on
        # BYOK/real models keep their actual identity.
        resolved = getattr(self, "resolved_call", None)
        if resolved is not None and resolved.provider == "bokito":
            parts.append(identity_for_bokito_slug(resolved.slug))
        return "\n\n".join(parts).strip()

    async def _team_reachable(self) -> bool:
        if self.trust != "external":
            return True
        if self._reachable_cached is not None:
            return self._reachable_cached
        from app.services.livechat_compat import team_is_reachable

        tenant = await self._get_tenant()
        if tenant is None:
            self._reachable_cached = True
            return True
        self._reachable_cached = await team_is_reachable(self.session, tenant)
        return self._reachable_cached

    async def _whatsapp_handover_on(self) -> bool:
        from app.services.whatsapp_handover import handover_target

        tenant = await self._get_tenant()
        account, _ = await handover_target(self.session, tenant)
        return account is not None

    async def _apply_reachability_tools(self) -> None:
        reachable = await self._team_reachable()
        names = {t["name"] for t in self.tools}
        self.tools = [t for t in self.tools if t["name"] != "continue_on_whatsapp"]
        if not reachable and self.trust == "external" and await self._whatsapp_handover_on():
            whatsapp = next(
                (t for t in get_tool_definitions() if t["name"] == "continue_on_whatsapp"),
                None,
            )
            if whatsapp:
                self.tools = [*self.tools, whatsapp]
        if reachable:
            self.tools = [t for t in self.tools if t["name"] != "request_callback"]
            if "handoff_to_human" not in names:
                handoff = next(
                    (t for t in get_tool_definitions() if t["name"] == "handoff_to_human"),
                    None,
                )
                if handoff:
                    self.tools = [*self.tools, handoff]
        else:
            self.tools = [t for t in self.tools if t["name"] != "handoff_to_human"]
            if "request_callback" not in {t["name"] for t in self.tools}:
                callback = next(
                    (t for t in get_tool_definitions() if t["name"] == "request_callback"),
                    None,
                )
                if callback:
                    self.tools = [*self.tools, callback]
        for always_on in ("request_customer_verify", "link_conversation_contact"):
            if always_on in {t["name"] for t in self.tools}:
                continue
            definition = next(
                (t for t in get_tool_definitions() if t["name"] == always_on),
                None,
            )
            if definition:
                self.tools = [*self.tools, definition]

    async def _failover_after_rate_limit(self, exc: BaseException) -> bool:
        """Park the rate-limited key and switch to the next backing, if any."""
        from app.services import provider_health
        from app.services.agent.llm import is_hard_failure, should_fail_over
        from app.services.model_resolution import resolve_model_call

        current = self.resolved_call
        if current is None or not current.api_key or not should_fail_over(exc):
            return False
        provider_health.mark_rate_limited(
            current.provider_type,
            current.api_key,
            current.model_id,
            hard_quota=is_hard_failure(exc),
        )
        selected = await self._select_chat_model()
        candidate = await resolve_model_call(
            self.session,
            self.tenant_id,
            kind="chat",
            model_slug=selected.slug,
        )
        if not candidate.api_key or (
            candidate.api_key == current.api_key and candidate.model_id == current.model_id
        ):
            return False
        logger.warning(
            "Agent model failover after rate limit: %s/%s -> %s/%s",
            current.provider_type,
            current.model_id,
            candidate.provider_type,
            candidate.model_id,
        )
        self.resolved_call = candidate
        self.llm = get_chat_provider(
            candidate.provider_type, candidate.api_key, candidate.base_url or None
        )
        return True

    async def _llm_chat(self, llm_messages: list[dict[str, Any]], max_tokens: int) -> dict[str, Any]:
        for attempt in range(_MAX_FAILOVER_STEPS + 1):
            try:
                return await self.llm.chat(
                    llm_messages,
                    tools=self.tools,
                    model=self.resolved_call.model_id if self.resolved_call else None,
                    thinking_budget=self.thinking_budget,
                    max_tokens=max_tokens,
                )
            except Exception as exc:
                if attempt >= _MAX_FAILOVER_STEPS or not await self._failover_after_rate_limit(exc):
                    raise
        raise RuntimeError("unreachable")

    async def _llm_stream(
        self, llm_messages: list[dict[str, Any]], max_tokens: int
    ) -> AsyncGenerator[dict[str, Any], None]:
        # Failover only before the first event; a half-streamed answer cannot restart.
        for attempt in range(_MAX_FAILOVER_STEPS + 1):
            started = False
            try:
                async for event in self.llm.stream_chat(
                    llm_messages,
                    tools=self.tools,
                    model=self.resolved_call.model_id if self.resolved_call else None,
                    thinking_budget=self.thinking_budget,
                    max_tokens=max_tokens,
                ):
                    started = True
                    yield event
                return
            except Exception as exc:
                if (
                    started
                    or attempt >= _MAX_FAILOVER_STEPS
                    or not await self._failover_after_rate_limit(exc)
                ):
                    raise

    async def _select_chat_model(self):
        """Product slug for this turn: item override > agent mode > workspace."""
        from app.services.model_policy import ModelSelectionContext, resolve_chat_model_slug

        return await resolve_chat_model_slug(
            self.session,
            self.tenant_id,
            ModelSelectionContext(
                override_slug=self.model_override,
                agent_model=self.agent.model if self.agent else None,
                task_hint=self.task_hint,
            ),
        )

    async def _prepare_chat(
        self,
        messages: list[dict[str, Any]],
        extra_context: str = "",
        attachments: list[dict] | None = None,
    ) -> tuple[list[dict[str, Any]], dict[str, int]]:
        from app.services.model_resolution import resolve_model_call

        selected = await self._select_chat_model()
        model_slug = selected.slug
        if not getattr(self, "_module_tools_applied", False):
            from app.modules.catalog import enabled_module_slugs
            from app.services.module_agents import (
                filter_tools_for_agent_modules,
                module_slugs_for_agent,
                writable_module_slugs_for_agent,
            )

            enabled = await enabled_module_slugs(self.session, self.tenant_id)
            rostered: set[str] = set()
            writable: set[str] = set()
            if self.agent is not None:
                rostered = await module_slugs_for_agent(
                    self.session, self.tenant_id, self.agent.id
                )
                writable = await writable_module_slugs_for_agent(
                    self.session, self.tenant_id, self.agent.id
                )
            self.tools = filter_tools_for_agent_modules(
                self.tools,
                enabled_slugs=enabled,
                rostered_slugs=rostered,
                writable_slugs=writable,
            )
            from app.services.customer_verify import enabled_customer_tool_names

            enabled_customer = await enabled_customer_tool_names(
                self.session, self.tenant_id
            )
            self.tools = filter_tools_for_audience(
                self.tools,
                self.audience,
                enabled_customer_tools=enabled_customer,
            )
            self._module_tools_applied = True
        if self.trust == "external" and not getattr(self, "_reachability_tools_applied", False):
            await self._apply_reachability_tools()
            self._reachability_tools_applied = True
        self.resolved_call = await resolve_model_call(
            self.session, self.tenant_id, kind="chat", model_slug=model_slug
        )
        if self.run and self.run.project_id:
            from app.services.projects import check_project_token_budget

            await check_project_token_budget(self.session, self.tenant_id, self.run.project_id)
        self.llm = get_chat_provider(
            self.resolved_call.provider_type,
            self.resolved_call.api_key,
            self.resolved_call.base_url or None,
        )

        user_query = ""
        if messages:
            last = messages[-1]
            user_query = last.get("content", "") if isinstance(last.get("content"), str) else ""
        self._turn_model_slug = model_slug
        self._turn_user_text = user_query
        self._turn_has_attachments = bool(attachments)
        system = await self._build_system_prompt(extra_context, user_query=user_query)
        if attachments:
            vision_note = self._attachments_context(attachments)
            system += vision_note
        llm_messages = [{"role": "system", "content": system}, *messages]
        llm_messages = await self._apply_attachments_to_messages(llm_messages, attachments)
        return llm_messages, {"input_tokens": 0, "output_tokens": 0}

    async def _apply_attachments_to_messages(
        self,
        messages: list[dict[str, Any]],
        attachments: list[dict] | None,
    ) -> list[dict[str, Any]]:
        if not attachments:
            return messages

        from app.services.storage import fetch_attachment_bytes

        last_user_idx: int | None = None
        for idx in range(len(messages) - 1, -1, -1):
            if messages[idx].get("role") == "user":
                last_user_idx = idx
                break
        if last_user_idx is None:
            return messages

        msg = messages[last_user_idx]
        content = msg.get("content", "")
        text = content if isinstance(content, str) else ""
        if isinstance(content, list):
            text_parts = [
                block.get("text", "")
                for block in content
                if isinstance(block, dict) and block.get("type") == "text"
            ]
            text = "\n".join(text_parts)

        blocks: list[dict[str, Any]] = []
        if text:
            blocks.append({"type": "text", "text": text})

        non_image_names: list[str] = []
        for att in attachments:
            mime = _attachment_mime(att)
            name = str(att.get("name") or att.get("filename") or "file")
            url = str(att.get("url") or "")
            data: bytes | None = None
            # Unknown mime: fetch anyway and sniff — widget uploads are
            # image-only, so a bare {id, url} attachment is almost certainly
            # an image the model should see.
            if url and (mime.startswith("image/") or not mime):
                data = await fetch_attachment_bytes(url)
                if data and not mime.startswith("image/"):
                    mime = _sniff_image_mime(data) or mime
            if data and mime.startswith("image/"):
                blocks.append(
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": mime,
                            "data": base64.standard_b64encode(data).decode("ascii"),
                        },
                    }
                )
            else:
                non_image_names.append(name)

        if non_image_names:
            note = f"[Attached files: {', '.join(non_image_names)}]"
            if blocks and blocks[0].get("type") == "text":
                blocks[0]["text"] = f"{blocks[0]['text']}\n\n{note}".strip()
            else:
                blocks.insert(0, {"type": "text", "text": note})

        if not blocks:
            return messages

        updated = list(messages)
        if len(blocks) == 1 and blocks[0]["type"] == "text":
            updated[last_user_idx] = {**msg, "content": blocks[0]["text"]}
        else:
            updated[last_user_idx] = {**msg, "content": blocks}
        return updated

    @staticmethod
    def _attachments_context(attachments: list[dict]) -> str:
        image_count = sum(1 for a in attachments if _attachment_mime(a).startswith("image/"))
        file_count = len(attachments) - image_count
        parts: list[str] = []
        if image_count:
            parts.append(f"{image_count} image(s)")
        if file_count:
            parts.append(f"{file_count} file(s)")
        label = " and ".join(parts) if parts else f"{len(attachments)} attachment(s)"
        return f"\n\nUser attached {label}. Describe and use them if relevant."

    async def _record_usage(self, tokens: dict[str, int]) -> None:
        if self.resolved_call is None:
            return
        from app.services.model_resolution import record_usage

        scope_id = None
        if self.signal_id:
            scope_id = str(self.signal_id)
        elif self.run is not None:
            scope_id = str(self.run.id)
        await record_usage(
            self.session,
            self.tenant_id,
            self.resolved_call,
            tokens_in=tokens.get("input_tokens", 0),
            tokens_out=tokens.get("output_tokens", 0),
            scope=self.usage_scope,
            scope_id=scope_id,
            call_type=self.usage_call_type,
            agent_id=self.agent.id if self.agent else None,
            run_id=self.run.id if self.run else None,
            ticket_tag_id=getattr(self.run, "ticket_tag_id", None) if self.run else None,
            workstream_run_id=(
                getattr(self.run, "workstream_run_id", None) if self.run else None
            ),
            user_id=self.user_id,
            commit=True,
        )

    async def _maybe_promote_to_task(self, tool_name: str) -> None:
        """Lazy Task promotion: the first real-work tool call puts this run
        on the ledger. Plain Q&A turns never reach here with a work tool, so
        they stay Run-only."""
        if self.run is None or self.run.task_id is not None:
            return
        from app.services.task_ledger import is_work_tool, promote_run_to_task

        if not is_work_tool(tool_name):
            return
        await promote_run_to_task(
            self.session,
            self.run,
            trust=self.trust,
            signal_id=self.tool_signal_id,
            first_tool=tool_name,
        )

    async def _is_cancelled(self) -> bool:
        from app.services.agent.run_cancel import is_run_cancelled

        run_id = self.run.id if self.run else None
        return await is_run_cancelled(self.session, run_id)

    async def _execute_tool_loop(
        self,
        llm_messages: list[dict[str, Any]],
        response_content: list[dict[str, Any]],
        stream_id: str | None = None,
    ) -> list[dict[str, Any]]:
        tool_results = []
        for tool_use in response_content:
            if tool_use.get("type") != "tool_use":
                continue
            if await self._is_cancelled():
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_use["id"],
                        "content": json.dumps(
                            {"error": "Run cancelled", "status": "cancelled"}
                        ),
                    }
                )
                continue
            await self._maybe_promote_to_task(tool_use["name"])
            await self._log_event("tool_call", tool_use["name"], tool_use.get("input"))
            tool_input = tool_use.get("input", {})
            self._append_trace_step("tool_call", name=tool_use["name"], payload={"input": tool_input})
            item = None
            if self.turn is not None:
                shown = await self._tool_presentation(tool_use["name"], tool_input)
                item = await self.turn.tool_start(
                    tool_use["name"], tool_input, label=shown["label"], provider=shown["provider"]
                )
            result = await execute_tool(
                self.session,
                self.tenant_id,
                self.user_id,
                tool_use["name"],
                tool_use.get("input", {}),
                signal_id=self.tool_signal_id,
                agent=self.agent,
                run_id=self.run.id if self.run else None,
                project_id=self.run.project_id if self.run else None,
                trust=self.trust,
                user_role=await self._session_user_role(),
                surface=self.surface,
                turn_id=self.turn.stream_id if self.turn is not None else None,
            )
            if (
                tool_use["name"] == "attach_items"
                and isinstance(result, dict)
                and isinstance(result.get("items"), list)
            ):
                for row in result["items"]:
                    if isinstance(row, dict):
                        self._showcase_items.append(row)
            self._append_trace_step("tool_result", name=tool_use["name"], payload={"result": result})
            if self.turn is not None and item is not None:
                await self.turn.tool_end(item, result)
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tool_use["id"],
                    "content": json.dumps(result),
                }
            )
        return tool_results

    async def run_chat(
        self,
        messages: list[dict[str, Any]],
        extra_context: str = "",
        attachments: list[dict] | None = None,
    ) -> tuple[str, dict[str, int]]:
        """Non-streaming turn. Returns the last speech; ``self.turn`` has every segment."""
        llm_messages, tokens = await self._prepare_chat(messages, extra_context, attachments)
        turn = self._new_turn()
        self.thinking_budget = self._resolve_thinking_budget()
        max_tokens = self._resolve_max_tokens()
        self._continue_nudged = False
        started = time.monotonic()

        for loop_idx in range(self.max_loops):
            if await self._is_cancelled():
                break
            await self._log_event("think", f"Loop {loop_idx + 1}")
            response = await self._llm_chat(llm_messages, max_tokens)
            tokens["input_tokens"] += response.get("usage", {}).get("input_tokens", 0)
            tokens["output_tokens"] += response.get("usage", {}).get("output_tokens", 0)

            for block in response.get("content") or []:
                if block.get("type") == "thinking" and block.get("thinking"):
                    self.thinking_text += str(block["thinking"])
                    await turn.thinking(str(block["thinking"]))

            content = response.get("content") or []
            tool_uses = [b for b in content if b.get("type") == "tool_use"]
            text_blocks = [b["text"] for b in content if b.get("type") == "text"]
            if text_blocks:
                turn.set_speech_text("\n".join(text_blocks))

            # Always run tools when the model emitted them — some providers
            # incorrectly label tool turns as end_turn.
            if tool_uses:
                if await self._is_cancelled():
                    break
                llm_messages.append({"role": "assistant", "content": content})
                tool_results = await self._execute_tool_loop(llm_messages, tool_uses)
                llm_messages.append({"role": "user", "content": tool_results})
                continue

            joined = "\n".join(text_blocks)
            if (
                not self._continue_nudged
                and self._looks_like_work_announce(joined)
                and loop_idx + 1 < self.max_loops
            ):
                self._append_continue_nudge(
                    llm_messages,
                    content or [{"type": "text", "text": joined}],
                )
                continue
            break

        await turn.finish()
        self.thinking_ms = int((time.monotonic() - started) * 1000)
        await self._record_usage(tokens)
        final_text = turn.final_text
        if await self._is_cancelled():
            return final_text or "", tokens
        return final_text or "Done.", tokens

    async def stream_chat(
        self,
        messages: list[dict[str, Any]],
        extra_context: str = "",
        attachments: list[dict] | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Streaming turn.

        Yields ``thinking`` / ``delta`` (with ``segment_id``) events and one
        ``done`` with ``segments`` (speech bubbles + their activity), ``text``
        (last speech, for single-message callers) and ``activity``.
        """
        llm_messages, tokens = await self._prepare_chat(messages, extra_context, attachments)
        turn = self._new_turn()
        stream_id = turn.stream_id
        self.thinking_budget = self._resolve_thinking_budget()
        max_tokens = self._resolve_max_tokens()
        self._continue_nudged = False
        started = time.monotonic()
        await turn.start()

        cancelled = False
        for loop_idx in range(self.max_loops):
            if await self._is_cancelled():
                cancelled = True
                break
            await self._log_event("think", f"Loop {loop_idx + 1}")

            response_content: list[dict[str, Any]] = []
            streamed_text = False

            async for event in self._llm_stream(llm_messages, max_tokens):
                if await self._is_cancelled():
                    cancelled = True
                    break
                if event["type"] == "thinking":
                    delta = event.get("text", "")
                    if delta:
                        self.thinking_text += delta
                        await turn.thinking(delta)
                        yield {"type": "thinking", "text": delta}
                elif event["type"] == "delta":
                    delta = event.get("text", "")
                    if delta:
                        streamed_text = True
                        await turn.speech(delta)
                        yield {"type": "delta", "text": delta, "segment_id": turn.current_segment_id}
                elif event["type"] == "done":
                    usage = event.get("usage", {})
                    tokens["input_tokens"] += usage.get("input_tokens", 0)
                    tokens["output_tokens"] += usage.get("output_tokens", 0)
                    response_content = event.get("content") or []
                    if not self.thinking_text:
                        for block in response_content:
                            if block.get("type") == "thinking" and block.get("thinking"):
                                self.thinking_text += str(block["thinking"])

            if cancelled:
                break

            tool_uses = [b for b in response_content if b.get("type") == "tool_use"]
            text_blocks = [b["text"] for b in response_content if b.get("type") == "text"]
            if text_blocks and not streamed_text:
                turn.set_speech_text("\n".join(text_blocks))

            if tool_uses:
                if await self._is_cancelled():
                    cancelled = True
                    break
                llm_messages.append({"role": "assistant", "content": response_content})
                tool_results = await self._execute_tool_loop(
                    llm_messages, tool_uses, stream_id=stream_id
                )
                llm_messages.append({"role": "user", "content": tool_results})
                continue

            joined = "\n".join(text_blocks) if text_blocks else turn.final_text
            if (
                not cancelled
                and not self._continue_nudged
                and self._looks_like_work_announce(joined or "")
                and loop_idx + 1 < self.max_loops
            ):
                assistant_content = response_content or [
                    {"type": "text", "text": joined or ""}
                ]
                self._append_continue_nudge(llm_messages, assistant_content)
                continue
            break

        await turn.finish()
        self.thinking_ms = int((time.monotonic() - started) * 1000)
        await self._record_usage(tokens)
        base = {
            "type": "done",
            "usage": tokens,
            "stream_id": stream_id,
            "segments": list(turn.segments),
            "activity": turn.all_activity(),
            "steps": list(self.trace_steps),
        }
        if cancelled or await self._is_cancelled():
            yield {**base, "text": turn.final_text, "cancelled": True}
            return
        yield {
            **base,
            "text": turn.final_text or "Done.",
            "thinking": self.thinking_text,
            "thinking_ms": self.thinking_ms,
            "thinking_budget": self.thinking_budget,
        }
