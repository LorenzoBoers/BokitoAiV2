import asyncio
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
from app.services.agent.tools import (
    execute_tool,
    filter_tools_for_agent,
    get_tool_definitions,
)
from app.services.agent.turn import TurnRecorder
from app.services.workspace import build_workspace_context, hybrid_search
from app.tools.registry import audience_for_trust, filter_tools_for_audience

logger = logging.getLogger(__name__)

# How many backing-chain steps one turn may fall through on rate limits.
_MAX_FAILOVER_STEPS = 3

# Interim updates (update_progress) wait until the turn has been going a bit.
PROGRESS_MIN_SECONDS = 15
PROGRESS_GAP_SECONDS = 20
PROGRESS_MAX = 3
_PROGRESS_FILLER_RE = re.compile(
    r"(?i)^(still working on it\.?|working on (?:this|it)\.?|one moment\.?|hang on\.?)$"
)


def progress_allowed(*, elapsed: float, since_last: float | None, count: int) -> bool:
    if elapsed < PROGRESS_MIN_SECONDS:
        return False
    if since_last is not None and since_last < PROGRESS_GAP_SECONDS:
        return False
    return count < PROGRESS_MAX


def is_progress_filler(text: str) -> bool:
    return bool(_PROGRESS_FILLER_RE.match((text or "").strip()))


# Live replies outside the queue that always end in ``persist_turn``.
_INLINE_TURN_SURFACES = frozenset({"operator_chat", "thread_reply"})


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


def _strip_message_attachments(
    messages: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict] | None]:
    """Drop the history-only attachments key. Keep images from the latest user turns.

    A follow-up question has no new files. The previous user bubble still
    carries them, so the model can look at that picture.
    """
    cleaned: list[dict[str, Any]] = []
    found: list[dict] | None = None
    user_seen = 0
    for message in reversed(messages):
        if message.get("role") != "user":
            continue
        user_seen += 1
        atts = message.get("attachments")
        if isinstance(atts, list) and atts:
            found = [a for a in atts if isinstance(a, dict)]
            break
        if user_seen >= 2:
            break
    for message in messages:
        if "attachments" not in message:
            cleaned.append(message)
            continue
        cleaned.append({key: value for key, value in message.items() if key != "attachments"})
    return cleaned, found or None


def _truncate_trace_value(value: Any, max_chars: int = 480) -> Any:
    """Keep persisted step payloads small enough for message metadata."""
    try:
        if isinstance(value, (dict, list)):
            text = json.dumps(value, default=str)
        else:
            text = str(value)
    except Exception:
        logger.debug('tool result json serialize failed', exc_info=True)
        text = str(value)
    if len(text) <= max_chars:
        return value
    return f"{text[:max_chars]}..."


def _append_user_text(llm_messages: list[dict[str, Any]], text: str) -> None:
    """Add text as user input without breaking user/assistant alternation."""
    last = llm_messages[-1] if llm_messages else None
    if last is not None and last.get("role") == "user":
        content = last.get("content")
        if isinstance(content, list):
            last["content"] = [*content, {"type": "text", "text": text}]
        else:
            last["content"] = f"{content or ''}\n\n{text}".strip()
        return
    llm_messages.append({"role": "user", "content": text})


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
        tool_signal_id: UUID | None = None,
        user_role: str | None = None,
        surface: str = "",
        reply_mode: str | None = None,
        model_override: str | None = None,
        task_hint: str | None = None,
        canvas_refresh: bool = False,
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
        # Plain id. A failed tool rolls the session back and expires `run`,
        # and reading `run.id` after that kills the turn.
        self._run_id = run.id if run is not None else None
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
        self.canvas_refresh = canvas_refresh
        self.surface = surface
        self.audience = audience_for_trust(trust)
        # Showcase cards from attach_items for this turn (request-scoped backup
        # for the module-level stash that persist_agent_turn consumes).
        self._showcase_items: list[dict[str, Any]] = []
        # One sheet create per turn. Further calls were a multi-minute loop
        # that pasted the table into the chat bubble.
        self._canvas_placed = False  # body written via edit_canvas this turn
        self._canvas_opened = False  # empty create_canvas already ran this turn
        self._canvas_finished = False
        self._canvas_finish_asked = False
        self._canvas_edit_asked = False
        self._canvas_edit_failures = 0
        self._canvas_caption_asked = False
        self._canvas_nudged = False
        self._canvas_kind = "dashboard"  # last opened/edited kind this turn
        self._canvas_edit_example: Any = None  # from create_canvas edit_example
        # Finished tool calls this turn. A canvas number may only cite one of these.
        self._source_ledger: dict[str, dict[str, str]] = {}
        # A failed call is not run again with the same arguments this turn.
        self._failed_calls: dict[str, str] = {}
        # Set when this turn may only look up names from the spoken request.
        self.job_sentence = ""
        self.job_slots: dict[str, str] = {}
        self._suppress_tools = False
        # Denied repeats of a call that already failed. After a few, the turn
        # answers from what it has instead of looping.
        self._repeat_denials = 0
        self._speech_hold = ""
        self._pseudo_dropped = False
        self._pseudo_nudged = False
        # Empty create ids this turn — bin if edit never landed (no writing ghosts).
        self._canvas_empty_ids: list[str] = []
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
        self.llm = get_llm_provider()
        # Set during run_chat once the model call is resolved (drives metering).
        self.resolved_call = None
        # Metering labels; orchestration/workstream callers override before run_chat.
        self.usage_scope = "chat"
        self.usage_call_type = "chat"
        # Passport: an agent only sees the tools it is permitted to use.
        tools = filter_tools_for_agent(get_tool_definitions(), agent)
        self._allowed_tool_names = allowed_tool_names
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
        self.tools = self._with_canvas_tools(tools)
        self.max_loops = agent.max_loops if agent else 15
        # Compact step log for chat history (tool calls / think) + token usage UI.
        self.trace_steps: list[dict[str, Any]] = []
        # RAG hits from the latest turn; the widget stream uses these to append
        # "related article" links when hits map to published help-center docs.
        self.last_rag_hits: list[dict[str, Any]] = []
        # Docs read through read_doc / search_index this turn; saved as knowledge_refs.
        self._knowledge_reads: list[dict[str, Any]] = []
        self.thinking_text = ""
        self.thinking_ms = 0
        # This turn's effort (effort_policy); the same on every round.
        self.effort = ""
        # Set when this loop runs a subagent: parent messages land between rounds.
        self.subagent_run_id: UUID | None = None
        # Why the last turn ended (see app.services.agent.stop_gate.STOP_REASONS).
        self.stop_reason = ""
        # Caller override of the agent's completion requirement ({} = none).
        self.completion_requirement: dict[str, Any] | None = None
        self._new_stop_gate()
        # Prompt-guard verdict of the first flagged untrusted text this turn.
        # While set, mutating tools ask first (clamp:untrusted_input).
        self.tainted: dict[str, Any] | None = None
        self._started = 0.0
        self._last_progress = 0.0
        self._progress_count = 0
        # Queue row of this turn: the worker sets it, an Ask records an inline row.
        self.agent_turn_id: UUID | None = None
        self._inline_turn_id: UUID | None = None

    def _no_result_after_tools(self, round_content: list[dict[str, Any]]) -> bool:
        """Tools ran this turn and the closing round said nothing (or only a filler)."""
        if not any(step.get("step_type") == "tool_call" for step in self.trace_steps):
            return False
        texts = [
            str(block.get("text") or "").strip()
            for block in round_content or []
            if block.get("type") == "text"
        ]
        return all(not text or is_progress_filler(text) for text in texts)

    _STRUCTURE_LINE_RE = re.compile(r"^\s*(#{1,6}\s|[-*\u2022]\s|\d+[.)]\s|\*\*[^*]+:\*\*|\|)")
    # A finished canvas is the answer. This is the build log, not something to keep.
    _PROCESS_CHAT_RE = re.compile(
        r"(tool_use_id|operator-message|edit_canvas|finish_canvas|create_canvas|restore_canvas|"
        r"bronvermelding|gridstructuur|definitieve aanpak|definitieve aanpassing|"
        r"correcte structuur|grafische (?:informatie|visualisatie))",
        re.IGNORECASE,
    )
    _CANVAS_FENCE_RE = re.compile(r"```[^\n]*\n.*?```", re.DOTALL)
    _CANVAS_FENCE_LANGS = frozenset({"mermaid", "mmd", "jsx", "tsx", "svg", "bokito"})
    # JSON / markdown fences that are an edit_canvas payload, not copyable chat.
    _CANVAS_PAYLOAD_RE = re.compile(
        r'"blocks"\s*:\s*\[|"type"\s*:\s*"(?:stat|bar_chart|line_chart|area_chart|'
        r'pie_chart|table|heading|callout|grid|card)"',
        re.IGNORECASE,
    )
    _CANVAS_MARKUP_RE = re.compile(
        r"<\s*(?:BarChart|LineChart|PieChart|Stat|Stack|Grid|Row|Card|Table|Callout|"
        r"ScatterPlot|BoxPlot|Heatmap|bokito-canvas)\b"
        r"(?:\s*/?>|\s+[A-Za-z]{1,24}=)"
        r"|['\"]bokito/canvas['\"]"
        r"|from\s+['\"]bokito/canvas['\"]"
        r"|export\s+default\s+function\s+Canvas\b"
        r"|import\s*\{[^}]{0,200}\b(?:BarChart|LineChart|PieChart|Stat|Stack|Card)\b",
        re.IGNORECASE,
    )
    _CANVAS_CODE_LINE_RE = re.compile(
        r"^\s*(?:import\s|export\s|const\s|function\s|return\s*\(|<>|</?[A-Za-z])",
        re.IGNORECASE,
    )
    _CANVAS_WRITE_TOOLS = frozenset(
        {"create_canvas", "edit_canvas", "update_folder_canvas", "finish_canvas", "restore_canvas"}
    )
    # After this many failed edits the turn stops. Pasting the payload in chat
    # is not a recovery path.
    _CANVAS_EDIT_FAIL_LIMIT = 3

    def _canvas_markup(self, text: str) -> bool:
        """JSX or an SVG the operator should see on the canvas, not in the bubble."""
        body = text or ""
        return bool(self._CANVAS_MARKUP_RE.search(body) or "<svg" in body.lower())

    def _canvas_payload_in_text(self, text: str) -> bool:
        """True when the bubble holds an edit_canvas JSON or markdown layout dump."""
        body = text or ""
        if not body.strip():
            return False
        if self._CANVAS_PAYLOAD_RE.search(body):
            return True
        # Unfenced object the model streams after a failed edit.
        stripped = body.lstrip()
        return stripped.startswith("{") and '"blocks"' in stripped[:400]

    def _canvas_body_in_text(self, text: str) -> bool:
        """True when the bubble contains canvas source (JSX, import, SVG, or blocks JSON)."""
        body = text or ""
        if not body.strip():
            return False
        if self._canvas_markup(body) or "<svg" in body.lower() or self._canvas_payload_in_text(body):
            return True
        return bool(
            re.search(r"(?i)export\s+default\s+function\s+Canvas\b", body)
            or re.search(r"(?i)from\s+['\"]bokito/canvas['\"]", body)
        )

    def _fence_lang(self, fence: str) -> str:
        head = fence.split("\n", 1)[0]
        return head.lstrip("`").strip().lower().split()[0] if head else ""

    def _fence_is_canvas(self, fence: str) -> bool:
        """Mermaid, JSX, SVG, and canvas JSON/markdown dumps leave the bubble."""
        lang = self._fence_lang(fence)
        if lang in self._CANVAS_FENCE_LANGS:
            return True
        body = fence.split("\n", 1)[1] if "\n" in fence else fence
        if lang in {"json", "markdown", "md"} and self._canvas_payload_in_text(body):
            return True
        return self._canvas_body_in_text(body)

    def _drop_canvas_fences(self, text: str) -> str:
        return self._CANVAS_FENCE_RE.sub(
            lambda match: "" if self._fence_is_canvas(match.group(0)) else match.group(0),
            text or "",
        ).strip()

    def _keep_chat_speech(self, text: str) -> str:
        """Drop canvas source. Keep prose and copyable text fences in the bubble."""
        cleaned = self._drop_canvas_fences(text)
        if self._canvas_payload_in_text(cleaned) or self._PROCESS_CHAT_RE.search(cleaned or ""):
            return self._chat_after_canvas(cleaned)
        if not self._canvas_body_in_text(cleaned):
            return cleaned
        kept = [
            match.group(0)
            for match in self._CANVAS_FENCE_RE.finditer(cleaned)
            if not self._fence_is_canvas(match.group(0))
        ]
        opening = self._canvas_chat_opening(self._CANVAS_FENCE_RE.sub("", cleaned))
        return "\n\n".join(part for part in [opening, *kept] if part).strip()

    def _canvas_chat_opening(self, text: str) -> str:
        """At most one short prose sentence. Never keep fences or JSX."""
        body = (text or "").strip()
        if not body:
            return ""
        cleaned = self._CANVAS_FENCE_RE.sub("", body).strip()
        if not cleaned:
            return ""
        first = cleaned.split("\n\n", 1)[0].strip()
        lines: list[str] = []
        for line in first.splitlines():
            stripped = line.strip()
            if not stripped:
                if lines:
                    break
                continue
            if (
                self._canvas_markup(stripped)
                or self._CANVAS_CODE_LINE_RE.match(stripped)
                or stripped.startswith("```")
            ):
                break
            lines.append(stripped)
            if len(" ".join(lines)) > 200:
                break
        opening = " ".join(lines).strip()
        if (
            not opening
            or len(opening) > 240
            or self._STRUCTURE_LINE_RE.match(opening)
            or self._canvas_body_in_text(opening)
        ):
            return ""
        return opening

    def _chat_after_canvas(self, text: str) -> str:
        """Once the canvas is finished, the bubble is one short sentence or empty.

        The activity trail is the confirmation. A build log, a markdown copy of
        the figures, or a sentence about tool ids does not stay in the chat.
        """
        opening = self._canvas_chat_opening(text)
        if not opening or self._PROCESS_CHAT_RE.search(opening):
            return ""
        if re.fullmatch(r"(done|klaar|gedaan)\.?", opening.strip(), re.IGNORECASE):
            return ""
        return opening

    def _canvas_bubble(self, text: str) -> str:
        """One short sentence once a canvas edit was tried, including a failed one.

        A failed finish used to leave the build log in the thread. The activity
        trail already shows that step.
        """
        if self._canvas_finished or self._canvas_placed or self._canvas_edit_failures:
            return self._chat_after_canvas(text)
        return self._keep_chat_speech(text)

    def _canvas_in_chat(self, text: str) -> bool:
        """The reply is a canvas body: code, SVG, or a long layout spec. No canvas was made."""
        if self._canvas_nudged or self.trust != "operator":
            return False
        names = {t.get("name") for t in self.tools or []}
        if not (names & self._CANVAS_WRITE_TOOLS):
            return False
        body = text or ""
        # A canvas already written this turn can still leak its source afterwards.
        if self._canvas_placed or self._canvas_opened:
            return self._canvas_body_in_text(body)
        if self._canvas_body_in_text(body):
            return True
        if any(self._fence_is_canvas(match.group(0)) for match in self._CANVAS_FENCE_RE.finditer(body)):
            return True
        # Copyable text fences are chat, not a canvas. Count structure outside them.
        prose = self._CANVAS_FENCE_RE.sub("", body)
        structure = sum(1 for line in prose.splitlines() if self._STRUCTURE_LINE_RE.match(line))
        return structure >= 8

    async def _strip_canvas_speech(self) -> str:
        """Keep at most one short sentence in the bubble; drop every canvas body."""
        turn = self.turn
        if turn is None:
            return ""
        raw = turn.open_speech_text
        if not raw and turn.segments:
            raw = str(turn.segments[-1].get("text") or "")
        opening = self._canvas_bubble(raw)
        # Rewrite only when canvas source actually left the text. A no-op
        # rewrite of streamed prose made the live bubble start over.
        if turn.has_open_speech and opening != turn.open_speech_text:
            if opening:
                await turn.rewrite_open_speech(opening)
            else:
                turn.discard_open_speech()
        for seg in turn.segments:
            raw_seg = str(seg.get("text") or "")
            cleaned = self._canvas_bubble(raw_seg)
            if cleaned != str(seg.get("text") or "").strip():
                seg["text"] = cleaned
        return opening

    def _tool_names(self) -> set[str]:
        from app.services.agent.pseudo_tools import names_from_tools

        return names_from_tools(self.tools)

    def _without_pseudo_calls(self, text: str) -> str:
        from app.services.agent.pseudo_tools import strip_pseudo_calls

        cleaned, dropped = strip_pseudo_calls(text or "", self._tool_names())
        if dropped:
            self._pseudo_dropped = True
        return cleaned

    async def _push_speech(self, turn: Any, delta: str) -> str:
        """Show speech, holding a line that is turning into a written tool call."""
        from app.services.agent.pseudo_tools import release_speech

        self._speech_hold += delta
        shown, self._speech_hold = release_speech(self._speech_hold, self._tool_names())
        if shown and turn is not None:
            await turn.speech(shown)
        return shown

    async def _flush_speech_hold(self, turn: Any) -> None:
        if not self._speech_hold:
            return
        cleaned = self._without_pseudo_calls(self._speech_hold)
        self._speech_hold = ""
        if cleaned and turn is not None:
            await turn.speech(cleaned)

    def _pseudo_nudge(self) -> str | None:
        """One reminder when a tool call was written as text and not called."""
        if not self._pseudo_dropped or self._pseudo_nudged:
            return None
        self._pseudo_nudged = True
        self._pseudo_dropped = False
        return (
            "<system-reminder>\nYou wrote a tool call as text. Call it as a tool. "
            "Do not write create_canvas(, edit_canvas(, or any other tool name "
            "followed by parentheses in the message.\n</system-reminder>"
        )

    async def _move_to_canvas(self, llm_messages: list[dict[str, Any]], content: list[dict[str, Any]], text: str) -> None:
        """Strip the bubble; the body goes into create/edit on the next round."""
        self._canvas_nudged = True
        opening = await self._strip_canvas_speech()
        if not opening:
            opening = self._canvas_chat_opening(text or "")
        llm_messages.append(
            {"role": "assistant", "content": content or [{"type": "text", "text": text or "(draft)"}]}
        )
        llm_messages.append(
            {
                "role": "user",
                "content": (
                    "<system-reminder>\nThat belongs on the canvas, not in the message. "
                    "Do not write tool calls, JSX, or source in chat. "
                    "First tool call now: if this conversation already lists a canvas, "
                    "edit_canvas with that canvas_id, then finish_canvas. "
                    "Otherwise create_canvas (empty — title and kind only), then "
                    "edit_canvas, then finish_canvas. "
                    "Dashboard: blocks (stat, bar_chart, line_chart, pie_chart, table). "
                    "Diagram: Mermaid source. Drawing: one SVG. Sheet: columns and rows. "
                    "Document: markdown. The operator only sees one short sentence (or none). "
                    "finish_canvas is the done confirmation — do not also announce "
                    "finished in chat.\n</system-reminder>"
                ),
            }
        )
        logger.info("canvas nudge: layout in chat, run=%s", self._run_id)
        await self._log_event("think", "Moving the draft into a canvas", {"stop_nudge": "canvas_in_chat"})

    async def _post_progress(self, text: str) -> bool:
        """Post an interim English line the operator can read. Time-gated."""
        if self.turn is None or self.canvas_refresh:
            return False
        now = time.monotonic()
        if not progress_allowed(
            elapsed=now - self._started if self._started else 0.0,
            since_last=(now - self._last_progress) if self._last_progress else None,
            count=self._progress_count,
        ):
            return False
        from app.services.agent.style import strip_emoji

        line = strip_emoji((text or "").strip())
        if not line:
            return False
        await self.turn.say(line[:240])
        self._last_progress = now
        self._progress_count += 1
        await self._keep_lease()
        return True

    async def _settle_canvas_speech(self) -> None:
        """The sentence stays in the bubble. Sheet and JSX leave it."""
        turn = self.turn
        if turn is None:
            return
        from app.services.canvas_sheet import detach_sheet_speech

        def clean(text: str) -> str:
            # Sheet detach also drops text fences and progress lines; only run
            # it when the bubble actually carries sheet data.
            if "|" in text or '"rows"' in text or '"columns"' in text:
                text = detach_sheet_speech(text)
            return self._canvas_bubble(text)

        changed = False
        for seg in turn.segments:
            raw = str(seg.get("text") or "")
            cleaned = clean(raw)
            if cleaned != raw.strip():
                seg["text"] = cleaned
                changed = True
        open_text = turn.open_speech_text
        cleaned_open = clean(open_text)
        if cleaned_open == open_text and not changed:
            return
        await turn.rewrite_open_speech(cleaned_open)

    def _unresolved_tool_failures(self) -> list[str]:
        """Tools whose last call this turn failed and never succeeded afterwards."""
        turn = self.turn
        if turn is None:
            return []
        last: dict[str, tuple[str, str]] = {}
        for item in turn.all_activity() or []:
            if not isinstance(item, dict):
                continue
            name = str(item.get("tool") or "")
            if not name:
                continue
            status = str(item.get("status") or "")
            error = ""
            result = item.get("result")
            if isinstance(result, dict):
                error = result.get("error") or ""
                details = result.get("errors")
                if isinstance(details, list) and details and str(details[0]) != error:
                    error = f"{error} ({details[0]})" if error else str(details[0])
            elif isinstance(result, str):
                error = result
            last[name] = (status, str(error or ""))
        return [
            f"{name}: {error or status}"[:240]
            for name, (status, error) in last.items()
            if status in ("error", "failed", "denied", "timeout", "invalid")
        ]

    async def _say_failure(
        self, llm_messages: list[dict[str, Any]], tokens: dict[str, int], failures: list[str]
    ) -> str:
        """Honest closing line when tools failed. Never "Done." over a red step."""
        llm_messages.append(
            {
                "role": "user",
                "content": (
                    "These tool calls failed and were not fixed:\n- "
                    + "\n- ".join(failures[:4])
                    + "\nTell the operator in one or two short sentences, in their "
                    "language, what did not work, using the error above as the cause. "
                    "Do not guess other causes. Do not say it worked or is done. "
                    "Do not promise to fix or retry it now; this turn ends here. "
                    "Do not paste source or JSON. Do not call any tools."
                ),
            }
        )
        saved_tools = self.tools
        self.tools = []
        try:
            response = await self._llm_chat(llm_messages, 400)
            self._add_usage_tokens(tokens, response.get("usage"))
            text = "\n".join(
                b["text"]
                for b in (response.get("content") or [])
                if b.get("type") == "text" and (b.get("text") or "").strip()
            ).strip()
        except Exception:
            logger.exception("failure summary chat failed")
            text = ""
        finally:
            self.tools = saved_tools
        text = self._keep_chat_speech(text) or "The last step failed. The activity above shows the error."
        if self.turn is not None:
            await self.turn.say(text)
        return text

    async def _bin_empty_canvases_this_turn(self) -> None:
        """Soft-delete empty shells created this turn when edit never landed."""
        if not self._canvas_empty_ids or self.session is None or not self.tenant_id:
            return
        from uuid import UUID as _UUID

        from app.services.project_canvas import delete_canvas, get_canvas

        kept: list[str] = []
        for cid in list(self._canvas_empty_ids):
            try:
                row = await get_canvas(self.session, self.tenant_id, canvas_id=_UUID(cid))
            except Exception:
                continue
            if not (row or {}).get("empty"):
                kept.append(cid)
                continue
            try:
                await delete_canvas(self.session, self.tenant_id, _UUID(cid))
            except Exception:
                logger.exception("bin empty canvas %s failed", cid)
                kept.append(cid)
        self._canvas_empty_ids = kept
        try:
            await self.session.commit()
        except Exception:
            logger.exception("commit after binning empty canvases failed")

    async def _canvas_turn_done(self, llm_messages: list[dict[str, Any]]) -> bool:
        """End after the canvas, unless finish or a short caption is still missing.

        finish_canvas is the done confirmation (activity trail). Chat stays the
        short opening sentence only — not a second \"it's finished\" line.
        """
        await self._strip_canvas_speech()
        # Failed edits on an existing canvas used to loop until max_turns and
        # dump the JSON into chat. Stop once the limit is hit, create or edit.
        if self._canvas_edit_failures >= self._CANVAS_EDIT_FAIL_LIMIT and not self._canvas_placed:
            await self._bin_empty_canvases_this_turn()
            return True
        if self._canvas_opened and not self._canvas_placed:
            # Empty create without a successful edit. Keep nudging; never leave a
            # permanent "writing" card. After a few failed edits, stop clean.
            if self._canvas_edit_failures >= self._CANVAS_EDIT_FAIL_LIMIT:
                await self._bin_empty_canvases_this_turn()
                return True
            self._canvas_edit_asked = True
            from app.services.canvas_content import edit_body_contract

            contract = edit_body_contract(self._canvas_kind)
            field = contract["field"]
            sample = (
                self._canvas_edit_example
                if self._canvas_edit_example is not None
                else contract["example"]
            )
            example = json.dumps(sample, ensure_ascii=False)
            if len(example) > 400:
                example = example[:400] + "..."
            llm_messages.append(
                {
                    "role": "user",
                    "content": (
                        "The empty canvas is open. Call edit_canvas now with that "
                        f"canvas_id and {field} set like {example}. "
                        "If the last edit returned errors, follow edit_example "
                        "and call it again. Then finish_canvas. Do not describe "
                        "the canvas in chat. Do not create another. Do not reply Done "
                        "until finish_canvas succeeds."
                    ),
                }
            )
            return False
        if self._canvas_edit_failures >= self._CANVAS_EDIT_FAIL_LIMIT:
            # Existing canvas, edits keep failing. Activity shows the error.
            return True
        if not self._canvas_placed:
            return False
        await self._settle_canvas_speech()
        text = (self.turn.bubble_text() if self.turn is not None else "").strip()
        if self._canvas_markup(text) and not self._canvas_nudged:
            return False
        if self._canvas_finished:
            return True
        names = {t.get("name") for t in self.tools or []}
        if "finish_canvas" in names and not self._canvas_finish_asked:
            self._canvas_finish_asked = True
            llm_messages.append(
                {
                    "role": "user",
                    "content": (
                        "The canvas body is written. Call finish_canvas with that "
                        "canvas_id now. That call is the done confirmation — do not "
                        "also write that it is finished in the chat message."
                    ),
                }
            )
            return False
        if text and text != "The sheet is beside this message.":
            return True
        if self._canvas_caption_asked:
            return True
        self._canvas_caption_asked = True
        self._suppress_tools = True
        llm_messages.append(
            {
                "role": "user",
                "content": (
                    "The canvas is already beside this message. "
                    "Write one short sentence in the operator's language about what you made. "
                    "Do not call a tool. Do not paste JSON or a table. Do not say it is finished."
                ),
            }
        )
        return False

    def _new_stop_gate(self) -> None:
        from app.services.agent.stop_gate import StopGate
        from app.services.agent_definition import completion_requirement

        requirement = (
            self.completion_requirement
            if self.completion_requirement is not None
            else completion_requirement(self.agent)
        )
        self._stop_gate = StopGate(requirement=requirement or {})
        self._called_ok: set[str] = set()

    async def _stop_check(
        self,
        llm_messages: list[dict[str, Any]],
        assistant_content: list[dict[str, Any]],
        joined: str,
        *,
        rounds_left: int,
    ) -> bool:
        """True when the stop gate sends the model back for another round."""
        if rounds_left <= 0:
            if not self._stop_gate.satisfied(self._called_ok):
                self._stop_gate.forced = True
            return False
        queued = ""
        if self.subagent_run_id is not None:
            from app.services import subagents

            bodies = await subagents.take_messages(
                self.session, self.subagent_run_id, deliveries=("interject", "steer", "queue")
            )
            if bodies:
                queued = subagents.reminder(bodies)
        if not queued and self._canvas_in_chat(joined):
            await self._move_to_canvas(llm_messages, assistant_content, joined)
            return True
        from app.services.agent.stop_gate import ANNOUNCE_REMINDER

        reminder = self._stop_gate.check(
            called_ok=self._called_ok,
            no_result_after_tools=self._no_result_after_tools(assistant_content),
            queued_messages=queued,
        )
        if reminder is None:
            return False
        if reminder == ANNOUNCE_REMINDER:
            logger.info("stop gate: no result after tools, run=%s", self._run_id)
            await self._log_event(
                "think", "Continuing: no result after tools", {"stop_nudge": "no_result_after_tools"}
            )
        llm_messages.append(
            {
                "role": "assistant",
                "content": assistant_content or [{"type": "text", "text": joined or "(no reply yet)"}],
            }
        )
        llm_messages.append({"role": "user", "content": reminder})
        return True

    async def _between_rounds(self, llm_messages: list[dict[str, Any]]) -> None:
        """Model view upkeep before each round: prune old tool results, deliver parent messages."""
        from app.services.compaction import prune_tool_results

        prune_tool_results(llm_messages)
        if self.subagent_run_id is not None:
            from app.services import subagents

            bodies = await subagents.take_messages(
                self.session, self.subagent_run_id, deliveries=("interject", "steer")
            )
            if bodies:
                _append_user_text(llm_messages, subagents.reminder(bodies))

    def _resolve_effort(self) -> str:
        """This turn's effort. Fixed for every round so thinking settings never flip mid-turn."""
        from app.services.agent.effort_policy import turn_effort

        configured = (
            getattr(self.agent, "effort", "") if self.agent else ""
        ) or get_settings().chat_default_effort
        return turn_effort(
            configured,
            user_text=str(getattr(self, "_turn_user_text", "") or ""),
            has_attachments=bool(getattr(self, "_turn_has_attachments", False)),
            model_slug=getattr(self, "_turn_model_slug", None),
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
            "effort": self.effort,
        }

    async def _log_event(self, event_type: str, message: str, payload: dict | None = None) -> None:
        if self._run_id is None:
            return
        event = RunEvent(
            run_id=self._run_id,
            tenant_id=self.tenant_id,
            event_type=event_type,
            message=message,
            payload_json=json.dumps(payload or {}),
        )
        self.session.add(event)
        await self.session.commit()
        from app.gateway.publish import publish_run_event

        status = "running"
        if self.run is not None:
            try:
                status = self.run.status
            except Exception:
                logger.debug('agent run status read failed', exc_info=True)
                status = "running"
        await publish_run_event(
            self.tenant_id,
            self._run_id,
            event_type=event_type,
            message=message,
            payload=payload or {},
            status=status,
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
        reserve = None
        if self.signal_id:
            from app.gateway.publish import publish_turn_event
            from app.services.message_seq import reserve_seq

            tenant_id, signal_id = self.tenant_id, self.signal_id
            bind = self.session.bind

            async def publish(event: str, data: dict[str, Any]) -> None:
                await publish_turn_event(tenant_id, signal_id, event, data)

            async def reserve() -> int | None:
                return await reserve_seq(bind, signal_id)

        author = (
            {"kind": "agent", "id": str(self.agent.id), "name": self.agent.name or ""}
            if self.agent is not None
            else None
        )
        self.turn = TurnRecorder(publish, reserve_seq=reserve, author=author)
        # Asking or handing over ends the turn: the peer speaks next.
        self._passed_floor = False
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
        reads, self._knowledge_reads = self._knowledge_reads, []
        # A finished canvas is the reply. "Done." is only a placeholder for a
        # turn that never spoke; it must not appear under the canvas card.
        effective_fallback = fallback_text
        if self._canvas_finished and turn is not None:
            if not any(str(seg.get("text") or "").strip() for seg in turn.segments):
                effective_fallback = ""
        saved = await persist_agent_turn(
            self.session,
            signal,
            segments=list(turn.segments) if turn else [],
            reply_mode=await self._resolve_reply_mode(),
            author_agent_id=self.agent.id if self.agent else None,
            metadata=metadata,
            first_metadata=first_metadata,
            final_metadata=final_metadata,
            turn_id=turn.stream_id if turn else None,
            fallback_text=effective_fallback,
            append_to_last=append_to_last,
            showcase_items=showcase,
            knowledge_hits=[*self.last_rag_hits, *reads],
        )
        if saved:
            from app.services.knowledge_lessons import schedule_lesson_scan_after_commit

            schedule_lesson_scan_after_commit(self.session, saved[-1].id)
        try:
            from app.services.participant_turns import clear_ask_floor_chip

            await clear_ask_floor_chip(
                self.session,
                signal,
                agent_id=self.agent.id if self.agent else None,
            )
        except Exception:  # noqa: BLE001
            logger.debug("clear ask floor chip failed", exc_info=True)
        await self.end_inline_turn()
        return saved

    async def begin_inline_turn(self) -> None:
        """An Ask or inbound reply runs outside the queue; record it so peers wait."""
        if self.agent_turn_id or self._inline_turn_id or self.agent is None or not self.signal_id:
            return
        if self.canvas_refresh or self.surface not in _INLINE_TURN_SURFACES:
            return
        from app.services.agent_turns import begin_inline_turn

        self._inline_turn_id = await begin_inline_turn(
            self.session.bind,
            tenant_id=self.tenant_id,
            signal_id=self.signal_id,
            agent_id=self.agent.id,
            requested_by_id=self.user_id,
        )

    async def end_inline_turn(self, outcome: str = "spoke") -> None:
        """Close the inline row once this turn's messages are committed; queued peers start."""
        turn_id, self._inline_turn_id = self._inline_turn_id, None
        if turn_id is None:
            return
        from sqlalchemy import event

        from app.services.agent_turns import end_inline_turn

        bind = self.session.bind
        loop = asyncio.get_running_loop()

        def _after_commit(_sync_session) -> None:
            loop.call_soon_threadsafe(
                lambda: asyncio.ensure_future(end_inline_turn(bind, turn_id, outcome=outcome))
            )

        event.listen(self.session.sync_session, "after_commit", _after_commit, once=True)

    async def _abort_turn(self) -> None:
        """A failed turn closes its live bubble and frees the floor now; the caller's rollback never commits."""
        if self.turn is not None:
            try:
                await self.turn.finish("error")
            except Exception:  # noqa: BLE001
                logger.debug("closing failed live turn failed", exc_info=True)
        turn_id, self._inline_turn_id = self._inline_turn_id, None
        if turn_id is None:
            return
        from app.services.agent_turns import end_inline_turn

        await end_inline_turn(self.session.bind, turn_id, outcome="error")

    async def _keep_lease(self) -> None:
        """Mark the turn alive between steps. The open turn itself lives on the thread log."""
        if not self.signal_id or self.turn is None:
            return
        from app.models.signal import Signal, is_internal_channel
        from app.services.agent_turns import extend_lease

        signal = await self.session.get(Signal, self.signal_id)
        if signal is None or not is_internal_channel(signal.channel):
            return
        if self.agent_turn_id or self._inline_turn_id:
            await extend_lease(
                self.session,
                self.agent_turn_id or self._inline_turn_id,
                inline=self.agent_turn_id is None,
            )
        await self.session.commit()

    async def _release_broken_session(self) -> None:
        """Drop a session whose connection greenlet died mid-tool.

        The next query opens a new connection. The tool result itself is
        already in hand, so the model can rewrite and call again.
        """
        try:
            await self.session.rollback()
            return
        except Exception:
            logger.exception("rollback after a broken session failed")
        try:
            self.session.sync_session.close()
        except Exception:
            logger.exception("close after a broken session failed")

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
        if name == "fetch_url" and isinstance(tool_input, dict):
            url = str(tool_input.get("url") or "").strip()
            if url:
                shown["label"] = f"Fetch: {url[:80]}"
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
            logger.debug('provider health json parse failed', exc_info=True)
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
        """Tenant row for this loop, reloaded when a tool commit expired it."""
        from app.models.auth import Tenant

        if self._tenant_resolved and self._tenant_cached is not None:
            try:
                from sqlalchemy import inspect as sa_inspect

                if not sa_inspect(self._tenant_cached).expired:
                    return self._tenant_cached
            except Exception:
                pass
        self._tenant_cached = await self.session.get(Tenant, self.tenant_id)
        self._tenant_resolved = True
        return self._tenant_cached

    async def _operator_filing_block(self) -> str:
        """Current labels, stage and folder for turns that are not an inbound read.

        Inbound keeps its own stricter brief in the worker prompt. The thread
        is the one tools write to, so an Ask session and a subagent see the
        customer thread rather than an empty side chat.
        """
        if self.trust == "external":
            return ""
        target = self.tool_signal_id or self.signal_id
        if target is None:
            return ""
        from app.models.signal import Signal
        from app.services.assistant_context import conversation_filing_brief

        signal = await self.session.get(Signal, target)
        if signal is None:
            return ""
        try:
            return await conversation_filing_brief(self.session, signal, voice="operator")
        except Exception:
            logger.debug("operator filing brief failed", exc_info=True)
            return ""

    async def _situation_block(self) -> str:
        """Clock in the workspace timezone, and that browsing is a tool.

        A custom role (social copy, for example) does not remove web_search
        or fetch_url. Without the date, "komende week" becomes a guessed year.
        """
        from datetime import datetime
        from zoneinfo import ZoneInfo

        tz_name = "Europe/Amsterdam"
        tenant = await self._get_tenant()
        raw = getattr(tenant, "settings_json", None) if tenant is not None else None
        try:
            stored = json.loads(raw or "{}")
        except (TypeError, json.JSONDecodeError):
            stored = {}
        if isinstance(stored, dict) and str(stored.get("timezone") or "").strip():
            tz_name = str(stored["timezone"]).strip()
        try:
            now = datetime.now(ZoneInfo(tz_name))
        except Exception:
            logger.debug('timezone resolve failed; using UTC', exc_info=True)
            now = datetime.now(ZoneInfo("UTC"))
            tz_name = "UTC"
        stamp = f"{now.strftime('%A')} {now.day} {now.strftime('%B %Y, %H:%M')}"
        names = {t.get("name") for t in (self.tools or [])}
        lines = [
            "## Now",
            f"Today is {stamp} ({tz_name}).",
            "Today, tomorrow, and komende week start from this date. Do not invent another year.",
            "The operator's request in this turn is the job. Your role describes the usual "
            "work; it does not limit the tools you may use.",
        ]
        if "web_search" in names and "fetch_url" in names:
            lines.append(
                "## Browse\n"
                "You can browse. web_search finds pages and fetch_url reads one public "
                "page. Both are on your tool list. A search result is links, not the "
                "numbers. In the same turn, call fetch_url on the page that has the "
                "daily figures. For a coming week, open a 14-day forecast and do not "
                "put a year in the search query. Answer from the page you fetched. "
                "If fetch_url errors, say that in one line and try one other url from "
                "the results. Never say you cannot browse, and never send the operator "
                "to a website to look it up themselves."
            )
        if "create_canvas" in names or "edit_canvas" in names or "update_folder_canvas" in names:
            here = ""
            if self.signal_id and ("edit_canvas" in names or "update_folder_canvas" in names):
                from app.services.project_canvas import list_canvases_for_signal

                listed = await list_canvases_for_signal(
                    self.session, self.tenant_id, self.signal_id
                )
                if listed:
                    rows = "; ".join(
                        f"{row.get('title') or 'Canvas'} "
                        f"({row.get('kind') or 'dashboard'}, canvas_id={row.get('id')})"
                        for row in listed[:8]
                    )
                    here = (
                        f"\nCanvases already on this conversation: {rows}. "
                        "A change, extra chart, or tweak is edit_canvas with that "
                        "canvas_id, then finish_canvas. Do not call create_canvas "
                        "to edit one. create_canvas with force_new is only when they "
                        "asked for a separate canvas."
                    )
            if self.canvas_refresh:
                lines.append(
                    "## Canvases\n"
                    "This wake only updates the snapshot."
                    f"{here}\n"
                    "Call edit_canvas or update_folder_canvas with that canvas_id "
                    "and a full blocks list, then reply HEARTBEAT_OK."
                )
            else:
                lines.append(
                    "## Canvases\n"
                    "Anything they want to look at, keep or export is a canvas, not chat text.\n"
                    "Hard rule: never write canvas source in the chat message — no import, "
                    "no export default function Canvas, no JSX, no BarChart/Stat/Stack "
                    "markup, no SVG, no Mermaid, no JSON tables. The body belongs only in "
                    "edit_canvas.\n"
                    "Copyable text stays in the chat bubble. When the operator should copy "
                    "a reply, a snippet, or a block of instructions, put that text in one "
                    "fenced block (```text). That renders as a copy window in the bubble. "
                    "Do not use that fence for a dashboard, diagram, or drawing.\n"
                    "New canvas — first action is the create_canvas tool call (empty: title "
                    "and kind only). Optionally one short sentence before that tool, nothing "
                    "else. Do not describe the layout, the colors, or the steps, and do not "
                    "tell the operator to build the canvas themselves. Then edit_canvas with "
                    "the full source, then finish_canvas.\n"
                    "Existing canvas on this conversation — first action is edit_canvas, then "
                    "finish_canvas. Do not call create_canvas.\n"
                    "finish_canvas is the done confirmation in the activity trail — do not "
                    "also write that it is finished in chat. Do not post_internal_note or "
                    "update_progress to explain tool ids or a failed edit; fix the edit "
                    "and call finish_canvas.\n"
                    "Pick the kind by what the result is, not by the word they use. A dashboard "
                    "is for figures; a text to read or send is a document. When they ask for a "
                    "dashboard but give only text (a quote, letter, a heading with a sentence and no "
                    "figures), make kind=document and say only: 'Ik heb er een document van gemaakt, want een dashboard is voor cijfers.' "
                    "Never add a stat or status to make it a dashboard.\n"
                    "Body kinds (only inside edit_canvas):\n"
                    "- dashboard, grafieken, statistieken, cijfers: kind=dashboard with "
                    "blocks (stat, bar_chart, line_chart, pie_chart, table, heading, text, "
                    "callout, list, divider, grid, card). A chart is not an SVG and not "
                    "generate_image. Temperatures, counts, or a comparison by day, city, or "
                    "category are a dashboard even when they say tekening or plaatje. "
                    "Figures they wrote in this message are a source: set source.tool_use_id "
                    "to operator-message and copy only numbers that appear in their words. "
                    "A dashboard needs at least one stat, chart or table with a source; text alone "
                    "is saved as a document. Never add a date, number or status they did not say.\n"
                    "- diagram, flow, schema, process: kind=diagram with Mermaid source "
                    "(flowchart, sequenceDiagram, erDiagram, …).\n"
                    "- sheet, table, list of values to export: kind=sheet with the values you read. "
                    "A sheet is the exportable table, not the chart of those values.\n"
                    "- poster or one illustration: kind=drawing with one complete "
                    "<svg> document (viewBox, real text and numbers), and only when it is not a chart.\n"
                    "- screen, mockup, artboard: kind=design. source is JSON frames with "
                    "id, x, y, w, h, title and text. Plain text, not HTML and not JSX.\n"
                    "- offerte, quote, letter, report, plan, notulen, uitleg to keep, print or send: "
                    "kind=document with markdown (downloads as .md).\n"
                    "- code or a script: kind=code with language. An email to send: kind=email "
                    "(subject, preheader, body_html). A picture to keep: kind=image (image_prompt).\n"
                    "Every edit keeps the previous version, on every kind. Call restore_canvas "
                    "with canvas_id and revision, then finish_canvas. Omit revision for the previous one.\n"
                    "\"Put this in a design\" after an earlier canvas means kind=design with force_new, "
                    "restating that canvas in frames. A chart stays a dashboard, not generate_image.\n"
                    "The card sits beside your message."
                    + here
                )
        return "\n".join(lines)

    async def _operator_context(self) -> str:
        """Tell the model who is chatting — an internal operator, not a customer."""
        if not self.user_id:
            return ""
        import json

        from app.models.auth import User
        from app.services.language import LANGUAGE_NAMES, platform_default_ui_language

        user = await self.session.get(User, self.user_id)
        if not user:
            return ""
        role = await self._session_user_role() or "member"
        name = (user.display_name or "").strip() or user.email
        agent_line = ""
        if self.agent is not None:
            agent_line = (
                f" You (@[{self.agent.name}](agent:{self.agent.id})) are a different "
                "entity — never address this human as yourself, never chip them with "
                "an agent: id, and never list them among agents."
            )
        ui_line = ""
        if self.agent is not None and self.agent.acts_for_user:
            try:
                stored = json.loads(user.settings_json or "{}")
            except json.JSONDecodeError:
                stored = {}
            if not isinstance(stored, dict):
                stored = {}
            code = stored.get("ui_language")
            if code not in ("en", "nl"):
                code = platform_default_ui_language()
            ui_name = LANGUAGE_NAMES.get(code, code)
            ui_line = (
                f" Their dashboard UI language is {ui_name} (`ui_language={code}`); "
                "they change it under Settings → Profile & security → Language at "
                "/settings/profile. That is independent of the workspace working language."
            )
        return (
            "## Current operator\n"
            f"You are assisting **{name}** <{user.email}> (user:{self.user_id}), a "
            f"human workspace {role} on this Bokito tenant. They are an internal "
            "operator (teammate), not an external customer and not an AI agent."
            f"{agent_line}{ui_line} Address them by their human name when needed. Prefer "
            "tools and workspace context over asking them for information that is "
            "already in the tenant snapshot."
        )

    async def _conversation_opened_by_agent(self) -> str:
        """Who spoke first, taken from the first stored message.

        Setup, wakes, and other agent-opened threads never store the kickoff
        instruction. Without this line the model treats the human as the one
        who started the chat.
        """
        if not self.signal_id:
            return ""
        from app.models.signal import SignalMessage

        row = (
            await self.session.execute(
                select(SignalMessage)
                .where(
                    SignalMessage.signal_id == self.signal_id,
                    SignalMessage.kind.notin_(("system_event", "internal_note")),
                )
                .order_by(SignalMessage.seq.asc(), SignalMessage.id.asc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if row is None or row.role != "assistant" or row.author_agent_id is None:
            return ""
        if self.agent is not None and row.author_agent_id == self.agent.id:
            return (
                "## Who opened this conversation\n"
                "You opened this conversation. The first message in the thread is yours. "
                "The human did not start it. When they say you started it, agree."
            )
        return (
            "## Who opened this conversation\n"
            "An agent opened this conversation. The first message is from an agent, "
            "not from the human. Do not say the human started it."
        )

    async def _with_lead_tools(self, tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """A point of contact can always ask its crew and its person accountable."""
        if self._allowed_tool_names is not None:
            # A pinned turn (intercom) must not grow ask_agent through lead duty.
            return tools
        wanted = {"ask_domain_question", "ask_agent"} - {t["name"] for t in tools}
        if self.agent is None or self.trust == "external" or not wanted:
            return tools
        from app.services.department_domain import agent_departments

        led = [d for d, duty in await agent_departments(self.session, self.tenant_id, self.agent.id) if duty == "primary"]
        if not led:
            return tools
        return [*tools, *(t for t in get_tool_definitions() if t["name"] in wanted)]

    async def _aware_context(self, *, with_crew: bool = True) -> str:
        """Role, standing brief and domain facts. Never for visitors."""
        if self.agent is None or self.trust == "external":
            return ""
        from app.services.agent_awareness import aware_context

        try:
            return await aware_context(self.session, self.agent, with_crew=with_crew)
        except Exception:  # noqa: BLE001 — a missing brief never blocks a run
            logger.debug("aware context failed", exc_info=True)
            return ""

    async def _org_blocks(self, thread: Any | None) -> tuple[str, str]:
        """(org chart + responsibility + knowledge chain, crew) while org rules are on; else empty."""
        if self.agent is None or self.trust == "external":
            return "", ""
        from app.services.org_rules import org_rules_on

        if not await org_rules_on(self.session, self.tenant_id):
            return "", ""
        from app.services.agent_awareness import crew_context
        from app.services.department_domain import agent_departments
        from app.services.org_context import org_context

        try:
            org = await org_context(self.session, self.tenant_id, self.agent, thread)
            led = [
                d for d, duty in await agent_departments(self.session, self.tenant_id, self.agent.id) if duty == "primary"
            ]
            return org, await crew_context(self.session, self.agent, led)
        except Exception:  # noqa: BLE001 — org context never blocks a run
            logger.debug("org context failed", exc_info=True)
            return "", ""

    async def _build_system_prompt(self, extra_context: str = "", user_query: str = "") -> str:
        # Chat turns skip the full tenant snapshot. Scoring docs + snapshot
        # queries used to freeze the event loop so the first token never left.
        # Canvas refresh wakes only rewrite one snapshot — skip RAG/workspace
        # and keep the agent purpose short so the prompt fits the model window.
        skip_heavy = bool(getattr(self, "_skip_rag", False) or self.canvas_refresh)
        if skip_heavy:
            workspace = ""
        else:
            workspace = await build_workspace_context(
                self.session,
                self.tenant_id,
                agent_id=self.agent.id if self.agent is not None else None,
            )
        rag_context = ""
        product_help_context = ""
        from app.models.signal import Signal

        thread = await self.session.get(Signal, self.signal_id) if self.signal_id else None
        org_block, crew_block = ("", "") if skip_heavy else await self._org_blocks(thread)
        if user_query and not skip_heavy:
            tag_ids: list = []
            if self.signal_id:
                from app.services.workspace import conversation_tag_ids

                tag_ids = await conversation_tag_ids(self.session, self.tenant_id, self.signal_id)
            from app.services.org_context import knowledge_scope

            chain, hidden = await knowledge_scope(self.session, self.tenant_id, self.agent, thread)
            try:
                hits = await asyncio.wait_for(
                    hybrid_search(
                        self.session,
                        self.tenant_id,
                        user_query,
                        top_k=5,
                        agent_id=self.agent.id if self.agent is not None else None,
                        tag_ids=tag_ids or None,
                        department_chain=chain,
                        hidden_departments=hidden,
                    ),
                    timeout=6,
                )
            except TimeoutError:
                hits = []
            self.last_rag_hits = hits or []
            if hits:
                from app.services.prompt_guard import fence

                def _hit_line(hit: dict) -> str:
                    mark = " (conceptles, nog niet bevestigd)" if hit.get("unconfirmed") else ""
                    return f"- {hit['title']}{mark}: {hit['content'][:300]}"

                rag_context = fence("\n".join(_hit_line(h) for h in hits), "knowledge")
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
        if self.canvas_refresh and len(base) > 6000:
            base = base[:6000] + "\n\n[…purpose truncated for canvas refresh…]"
        from app.services.agent_definition import prompt_mode, skills_block
        from app.services.platform_skills import platform_skills_block
        from app.services.prompt_guard import SYSTEM_RULE

        parts = [base]
        if self.canvas_refresh:
            # Snapshot wakes only rewrite one canvas. Skip operator/RAG/skills
            # bulk so the prompt stays under the model context window. Keep the
            # soft filing brief so a refresh still sees labels, stage and folder.
            from app.services.agent.style import CANVAS_REFRESH_TURN

            lean = [base, SYSTEM_RULE, CANVAS_REFRESH_TURN]
            if extra_context:
                lean.append(extra_context)
            filing = await self._operator_filing_block()
            if filing:
                lean.append(filing)
            lean.append(await self._situation_block())
            return "\n\n".join(lean).strip()
        skills = "\n\n".join(
            s for s in (platform_skills_block(self.tools), skills_block(self.agent)) if s
        )
        if self.agent is not None and self.agent.system_prompt and prompt_mode(self.agent) == "full":
            from app.services.agent_rules import all_rules, when_to_ask_prompt
            from app.services.language import language_rules_for_trust

            parts.append(SYSTEM_RULE)
            if skills:
                parts.append(skills)
            if rag_context:
                parts.append(f"## Relevant context\n{rag_context}")
            aware = await self._aware_context(with_crew=not org_block)
            if aware:
                parts.append(aware)
            parts.extend(p for p in (org_block, crew_block) if p)
            if extra_context:
                parts.append(extra_context)
            filing = await self._operator_filing_block()
            if filing:
                parts.append(filing)
            tenant_for_lang = await self._get_tenant()
            parts.append(language_rules_for_trust(self.trust, tenant_for_lang))
            if self.trust != "external":
                parts.append(when_to_ask_prompt(all_rules(tenant_for_lang, self.agent)))
            parts.append(await self._situation_block())
            return "\n\n".join(parts).strip()
        if self.agent is not None:
            if self.trust == "external":
                parts.append(f"## You\nYour name is {self.agent.name}.")
            else:
                parts.append(
                    "## You\n"
                    f"You are the AI agent @[{self.agent.name}](agent:{self.agent.id}). "
                    "The person messaging you is a human colleague (see Current operator) — "
                    "not you and not another agent. When listing agents, say \"me\" / "
                    "\"I\" for yourself and never call the human \"you (@[YourName])\". "
                    "Chip other agents only from the Tenant snapshot or a tool result, "
                    "copied exactly; never invent an id."
                )
                if any(t.get("name") == "ask_agent" for t in self.tools or []):
                    parts.append(
                        "## Other agents\n"
                        "To ask another agent here, call ask_agent; their answer "
                        "comes back to you, so end your turn after asking. "
                        "handoff_to gives them the conversation. An @mention is "
                        "only a link: it wakes nobody."
                    )
                role_key = (self.agent.role or "").strip().lower()
                if role_key in ("po", "orchestrator", "manager", "orchestra"):
                    parts.append(
                        "## Lead routing\n"
                        "Do not do module specialist work yourself. To ask another "
                        "agent something in this same conversation, use ask_agent "
                        "(their answer comes back to you) or handoff_to (they take "
                        "over). Use start_conversation only when you need a "
                        "separate peer chat; use spawn_subagent for a longer job "
                        "that runs in the background and reports back to you. "
                        "Keep your own tools to orchestration, messaging, and decisions."
                    )
        opener = await self._conversation_opened_by_agent()
        if opener:
            parts.append(opener)
        parts.append(SYSTEM_RULE)
        if skills:
            parts.append(skills)
        if workspace:
            parts.append(workspace)
        # Always remind agents with custom prompts that live tenant tools exist.
        if self.agent and self.agent.system_prompt:
            parts.append(
                "## Introspection\n"
                "Before claiming you lack information, call get_tenant_overview, "
                "list_tags (for labels), or list_recent_activity. "
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
            from app.services.agent.style import CANVAS_OPERATOR_PROMPT

            parts.append(CANVAS_OPERATOR_PROMPT)
            # The personal assistant is the one agent that carries memory of
            # the person across workspaces.
            if self.agent is not None and self.agent.acts_for_user:
                from app.services.assistant_context import settings_guide_block
                from app.services.user_memory import user_memory_block

                parts.append(settings_guide_block())
                memory = await user_memory_block(self.session, self.user_id)
                if memory:
                    parts.append(memory)
        from app.services.assistant_context import category_map_block

        category_map = await category_map_block(self.session, self.tenant_id)
        if category_map:
            parts.append(category_map)
        aware = await self._aware_context(with_crew=not org_block)
        if aware:
            parts.append(aware)
        if org_block:
            parts.append(org_block)
        if thread is not None:
            from app.services.project_work import client_knowledge_block
            from app.services.workstreams import recipe_block

            client = await client_knowledge_block(self.session, self.tenant_id, thread)
            if client:
                parts.append(client)
            approach = await recipe_block(self.session, thread)
            if approach:
                parts.append(approach)
        filing = await self._operator_filing_block()
        if filing:
            parts.append(filing)
        if crew_block:
            parts.append(crew_block)
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
        if self.canvas_refresh:
            from app.services.agent.style import CANVAS_REFRESH_TURN

            parts.append(CANVAS_REFRESH_TURN)
        parts.append(await self._situation_block())
        return "\n\n".join(parts).strip()

    def _with_canvas_tools(self, tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
        from app.tools.registry import CANVAS_WAKE_DENY, with_platform_core

        tools = with_platform_core(tools, trust=self.trust, refresh=self.canvas_refresh)
        if self.canvas_refresh:
            tools = [t for t in tools if t["name"] not in CANVAS_WAKE_DENY]
        tools = self._apply_definition(tools)
        # Intercom pins a closed set. Platform core must not reopen it — including
        # when prepare times out after this call and falls back to a bare prompt.
        if self._allowed_tool_names is not None:
            allowed = self._allowed_tool_names
            tools = [t for t in tools if t.get("name") in allowed]
        return tools

    def _apply_definition(self, tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Denylist and capability mode win over every default tool."""
        from app.services.agent_definition import tool_permitted
        from app.tools.executor import _EXTERNAL_PASSPORT_BYPASS

        if self.agent is None:
            return tools
        return [
            t
            for t in tools
            if (self.trust == "external" and t["name"] in _EXTERNAL_PASSPORT_BYPASS)
            or tool_permitted(self.agent, t["name"])[0]
        ]

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

    def _llm_chat_timeout(self) -> float:
        """Whole non-streaming call. A hung wake used to leave Bezig up until the 15-minute reap."""
        elapsed = time.monotonic() - self._started if self._started else 0.0
        tool_steps = sum(1 for step in self.trace_steps if step.get("step_type") == "tool_call")
        if tool_steps >= 1 or elapsed >= 20:
            return 180.0
        return 90.0

    async def _fit_llm_messages(
        self, llm_messages: list[dict[str, Any]], *, reserve_tokens: int = 4096
    ) -> list[dict[str, Any]]:
        """Hard-cap messages + tool schemas under the model context window."""
        from app.services.compaction import (
            context_window_for,
            estimate_payload_tokens,
            fit_messages_to_window,
        )

        tools = [] if self._suppress_tools else (self.tools or [])
        slug = getattr(self.resolved_call, "slug", None) if self.resolved_call else None
        try:
            window = await context_window_for(self.session, slug)
        except Exception:
            logger.debug("context window lookup failed", exc_info=True)
            window = 128_000
        before = estimate_payload_tokens(llm_messages, tools)
        fitted = fit_messages_to_window(
            llm_messages,
            window=window,
            reserve_tokens=reserve_tokens,
            tools=tools,
        )
        after = estimate_payload_tokens(fitted, tools)
        if after < before:
            logger.warning(
                "fitted llm payload %s -> %s tokens (window=%s, run=%s)",
                before,
                after,
                window,
                self._run_id,
            )
        return fitted

    async def _llm_chat(self, llm_messages: list[dict[str, Any]], max_tokens: int) -> dict[str, Any]:
        from app.services.compaction import (
            estimate_payload_tokens,
            fit_messages_to_window,
            is_prompt_too_long,
        )

        timeout = self._llm_chat_timeout()
        reserve = max(4096, int(max_tokens or 4096) + 512)
        messages = await self._fit_llm_messages(llm_messages, reserve_tokens=reserve)
        tools = [] if self._suppress_tools else self.tools
        lean_tool_names = {
            "edit_canvas",
            "restore_canvas",
            "update_folder_canvas",
            "list_canvases",
            "get_folder_canvas",
            "web_search",
            "fetch_url",
        }
        for attempt in range(_MAX_FAILOVER_STEPS + 1):
            try:
                return await asyncio.wait_for(
                    self.llm.chat(
                        messages,
                        tools=tools,
                        model=self.resolved_call.model_id if self.resolved_call else None,
                        effort=self.effort or None,
                        max_tokens=max_tokens,
                    ),
                    timeout=timeout,
                )
            except TimeoutError as exc:
                raise TimeoutError("llm chat timed out") from exc
            except Exception as exc:
                if is_prompt_too_long(exc) and attempt == 0:
                    # Second pass: leave more headroom and drop tool schemas if still huge.
                    logger.warning("prompt too long; truncating harder run=%s", self._run_id)
                    messages = fit_messages_to_window(
                        messages,
                        window=64_000,
                        reserve_tokens=8_000,
                        tools=tools,
                    )
                    if estimate_payload_tokens(messages, tools) > 60_000:
                        tools = [t for t in (tools or []) if t.get("name") in lean_tool_names]
                    continue
                if attempt >= _MAX_FAILOVER_STEPS or not await self._failover_after_rate_limit(exc):
                    raise
        raise RuntimeError("unreachable")

    def _llm_first_token_timeout(self) -> float:
        """Longer waits after tool rounds so thinking models can start."""
        elapsed = time.monotonic() - self._started if self._started else 0.0
        tool_steps = sum(1 for s in self.trace_steps if s.get("step_type") == "tool_call")
        if tool_steps >= 2 or elapsed >= 45:
            return 120.0
        if tool_steps >= 1 or elapsed >= 20:
            return 90.0
        return 40.0

    async def _llm_stream(
        self, llm_messages: list[dict[str, Any]], max_tokens: int
    ) -> AsyncGenerator[dict[str, Any], None]:
        # Failover only before the first event; a half-streamed answer cannot restart.
        from app.services.compaction import is_prompt_too_long

        reserve = max(4096, int(max_tokens or 4096) + 512)
        messages = await self._fit_llm_messages(llm_messages, reserve_tokens=reserve)
        tools = [] if self._suppress_tools else self.tools
        for attempt in range(_MAX_FAILOVER_STEPS + 1):
            started = False
            try:
                stream = self.llm.stream_chat(
                    messages,
                    tools=tools,
                    model=self.resolved_call.model_id if self.resolved_call else None,
                    effort=self.effort or None,
                    max_tokens=max_tokens,
                )
                agen = stream.__aiter__()
                first_token_timeout = self._llm_first_token_timeout()
                try:
                    first = await asyncio.wait_for(
                        agen.__anext__(), timeout=first_token_timeout
                    )
                except TimeoutError as exc:
                    raise TimeoutError("llm first token timed out") from exc
                started = True
                yield first
                async for event in agen:
                    yield event
                return
            except Exception as exc:
                if (
                    not started
                    and is_prompt_too_long(exc)
                    and attempt == 0
                ):
                    logger.warning("stream prompt too long; truncating harder run=%s", self._run_id)
                    from app.services.compaction import fit_messages_to_window

                    messages = fit_messages_to_window(
                        messages, window=64_000, reserve_tokens=8_000, tools=tools
                    )
                    continue
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
            )

            enabled = await enabled_module_slugs(self.session, self.tenant_id)
            reachable: set[str] = set()
            if self.agent is not None:
                reachable = await module_slugs_for_agent(
                    self.session, self.tenant_id, self.agent.id
                )
            self.tools = filter_tools_for_agent_modules(
                self.tools,
                enabled_slugs=enabled,
                reachable_slugs=reachable,
                all_tools=(
                    get_tool_definitions()
                    if self._allowed_tool_names is None and not self.canvas_refresh
                    else None
                ),
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
            self.tools = self._with_canvas_tools(self.tools)
            self.tools = await self._with_lead_tools(self.tools)
            if not self.canvas_refresh:
                from app.services.image_generation import image_generation_disabled
                from app.services.tenant_models import get_tenant_model_prefs
                from app.tools.registry import with_default_image_tool

                prefs = await get_tenant_model_prefs(self.session, self.tenant_id)
                self.tools = with_default_image_tool(
                    self.tools,
                    enabled=not image_generation_disabled(prefs),
                )
                self.tools = self._apply_definition(self.tools)
            # Intercom (and other callers) pin a tool set. Platform core must not
            # put ask_agent and the rest back after that pin.
            if self._allowed_tool_names is not None:
                allowed = self._allowed_tool_names
                self.tools = [t for t in self.tools if t.get("name") in allowed]
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
        chat_messages, history_attachments = _strip_message_attachments(messages)
        if not attachments and history_attachments:
            attachments = history_attachments
            self._turn_has_attachments = True
        from app.services.prompt_guard import scan_messages

        self.tainted = scan_messages(chat_messages)
        system = await self._build_system_prompt(extra_context, user_query=user_query)
        if attachments:
            vision_note = self._attachments_context(attachments)
            system += vision_note
        llm_messages = [{"role": "system", "content": system}, *chat_messages]
        llm_messages = await self._apply_attachments_to_messages(llm_messages, attachments)
        return llm_messages, {"input_tokens": 0, "output_tokens": 0}

    async def _prepare_chat_bare(
        self,
        messages: list[dict[str, Any]],
        extra_context: str = "",
        attachments: list[dict] | None = None,
    ) -> tuple[list[dict[str, Any]], dict[str, int]]:
        """Minimal prompt so a timed-out prepare can still reach the LLM."""
        from app.services.model_resolution import resolve_model_call

        try:
            await self.session.rollback()
        except Exception:
            logger.debug("rollback before bare chat prepare failed", exc_info=True)
        if getattr(self, "resolved_call", None) is None or getattr(self, "llm", None) is None:
            selected = await self._select_chat_model()
            self.resolved_call = await resolve_model_call(
                self.session, self.tenant_id, kind="chat", model_slug=selected.slug
            )
            self.llm = get_chat_provider(
                self.resolved_call.provider_type,
                self.resolved_call.api_key,
                self.resolved_call.base_url or None,
            )
        default_prompt = (
            "You are the Bokito AI OS assistant. Answer the operator briefly."
        )
        system = self.agent.system_prompt if self.agent and self.agent.system_prompt else default_prompt
        if extra_context:
            system = f"{system}\n\n{extra_context}"
        chat_messages, history_attachments = _strip_message_attachments(messages)
        from app.services.prompt_guard import SYSTEM_RULE, scan_messages

        self.tainted = scan_messages(chat_messages)
        system = f"{system}\n\n{SYSTEM_RULE}"
        if not attachments and history_attachments:
            attachments = history_attachments
        if messages:
            last = messages[-1]
            content = last.get("content", "") if isinstance(last, dict) else ""
            if isinstance(content, str) and content.strip():
                self._turn_user_text = content
        if attachments:
            system += self._attachments_context(attachments)
        llm_messages = [{"role": "system", "content": system}, *chat_messages]
        llm_messages = await self._apply_attachments_to_messages(llm_messages, attachments)
        return llm_messages, {
            "input_tokens": 0,
            "output_tokens": 0,
            "uncached_input_tokens": 0,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0,
        }

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

    @staticmethod
    def _add_usage_tokens(tokens: dict[str, int], usage: dict | None) -> None:
        usage = usage or {}
        tokens["input_tokens"] = int(tokens.get("input_tokens") or 0) + int(
            usage.get("input_tokens") or 0
        )
        tokens["output_tokens"] = int(tokens.get("output_tokens") or 0) + int(
            usage.get("output_tokens") or 0
        )
        tokens["uncached_input_tokens"] = int(tokens.get("uncached_input_tokens") or 0) + int(
            usage.get("uncached_input_tokens") or 0
        )
        tokens["cache_creation_input_tokens"] = int(
            tokens.get("cache_creation_input_tokens") or 0
        ) + int(usage.get("cache_creation_input_tokens") or 0)
        tokens["cache_read_input_tokens"] = int(tokens.get("cache_read_input_tokens") or 0) + int(
            usage.get("cache_read_input_tokens") or 0
        )

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
            tokens_in_uncached=tokens.get("uncached_input_tokens"),
            tokens_cache_write=tokens.get("cache_creation_input_tokens", 0),
            tokens_cache_read=tokens.get("cache_read_input_tokens", 0),
            scope=self.usage_scope,
            scope_id=scope_id,
            call_type=self.usage_call_type,
            agent_id=self.agent.id if self.agent else None,
            run_id=self.run.id if self.run else None,
            ticket_tag_id=getattr(self.run, "ticket_tag_id", None) if self.run else None,
            workstream_id=(
                getattr(self.run, "workstream_id", None) if self.run else None
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

        return await is_run_cancelled(self.session, self._run_id)

    async def _revive_bound_rows(self) -> None:
        """Reload rows a tool commit/rollback expired, so the next step can read them.

        Canvas apply commits the shared session and expires every loaded ORM
        row. A cached Tenant (or Agent) accessed after that raises MissingGreenlet.
        """
        self._tenant_resolved = False
        self._tenant_cached = None
        for obj in (self.run, self.agent):
            if obj is None:
                continue
            try:
                await self.session.refresh(obj)
            except Exception:
                logger.debug("refresh after tool failed", exc_info=True)
                # Detached after a hard close: re-load by primary key.
                try:
                    from sqlalchemy.orm import object_mapper

                    cls = object_mapper(obj).class_
                    pk = getattr(obj, "id", None)
                    if pk is not None:
                        fresh = await self.session.get(cls, pk)
                        if fresh is not None and obj is self.agent:
                            self.agent = fresh
                        elif fresh is not None and obj is self.run:
                            self.run = fresh
                except Exception:
                    logger.debug("re-get after tool failed", exc_info=True)

    async def _speak_peer_request(self, tool: str, tool_input: Any, result: Any) -> None:
        """One ask or handoff ends this turn. The person hears the answer, not the assignment.

        The peer turn starts after this turn is saved. Speaking the ``said`` line
        here read the question and the agent link aloud, and ``intercom_agent``
        was missing so the model kept asking.
        """
        if tool not in ("ask_agent", "handoff_to", "intercom_agent"):
            return
        if not isinstance(result, dict) or result.get("error") or not result.get("ok"):
            return
        self._passed_floor = True

    async def _recover_leaked_proposal(self, turn: TurnRecorder) -> bool:
        """Run a ``<propose_action>`` the model wrote as text, and drop the tag."""
        speech = turn.open_speech_text
        if "<propose_action" not in speech.lower():
            return False
        from app.services.agent.leaked_tools import lift_propose_action_markup

        clean, calls = lift_propose_action_markup(speech)
        if not calls:
            return False
        if clean:
            await turn.rewrite_open_speech(clean)
        else:
            turn.discard_open_speech()
        tool_uses = [
            {
                "type": "tool_use",
                "id": call["id"],
                "name": call["name"],
                "input": call["input"],
            }
            for call in calls
        ]
        await self._execute_tool_loop([], tool_uses)
        return True

    async def _execute_tool_loop(
        self,
        llm_messages: list[dict[str, Any]],
        response_content: list[dict[str, Any]],
        stream_id: str | None = None,
    ) -> list[dict[str, Any]]:
        from app.services.canvas_blocks import (
            OPERATOR_SOURCE_ID,
            bind_source_ledger,
            note_operator_message,
            reset_source_ledger,
        )

        if OPERATOR_SOURCE_ID not in self._source_ledger:
            note_operator_message(self._source_ledger, str(getattr(self, "_turn_user_text", "") or ""))
        token = bind_source_ledger(self._source_ledger)
        try:
            return await self._execute_tool_loop_bound(llm_messages, response_content, stream_id)
        finally:
            reset_source_ledger(token)

    async def _execute_tool_loop_bound(
        self,
        llm_messages: list[dict[str, Any]],
        response_content: list[dict[str, Any]],
        stream_id: str | None = None,
    ) -> list[dict[str, Any]]:
        tool_results = []
        tool_uses = [step for step in response_content if step.get("type") == "tool_use"]
        opened: dict[str, dict[str, Any]] = {}
        if self.turn is not None:
            for tool_use in tool_uses:
                if tool_use.get("name") != "generate_image":
                    continue
                shown = await self._tool_presentation(tool_use["name"], tool_use.get("input", {}))
                opened[tool_use["id"]] = await self.turn.tool_start(
                    tool_use["name"],
                    tool_use.get("input", {}),
                    label=shown["label"],
                    provider=shown["provider"],
                )
            if opened:
                await self._keep_lease()
        for tool_use in tool_uses:
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
            if self.canvas_refresh:
                from app.tools.registry import CANVAS_WAKE_DENY

                if tool_use["name"] in CANVAS_WAKE_DENY:
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": tool_use["id"],
                            "content": json.dumps(
                                {
                                    "error": (
                                        "This wake only updates the snapshot. "
                                        "Call edit_canvas or update_folder_canvas, then reply HEARTBEAT_OK."
                                    )
                                }
                            ),
                        }
                    )
                    continue
            if tool_use["name"] == "create_canvas" and (
                self._canvas_placed or self._canvas_opened or self._canvas_finished
            ):
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_use["id"],
                        "content": json.dumps(
                            {
                                "message": (
                                    "A canvas is already open this turn. "
                                    "Call edit_canvas with that canvas_id, then "
                                    "finish_canvas. Do not create another."
                                ),
                                "status": "done",
                            }
                        ),
                    }
                )
                continue
            await self._maybe_promote_to_task(tool_use["name"])
            await self._log_event("tool_call", tool_use["name"], tool_use.get("input"))
            tool_input = tool_use.get("input", {})
            self._append_trace_step("tool_call", name=tool_use["name"], payload={"input": tool_input})
            item = opened.get(tool_use["id"])
            if item is None and self.turn is not None:
                shown = await self._tool_presentation(tool_use["name"], tool_input)
                item = await self.turn.tool_start(
                    tool_use["name"], tool_input, label=shown["label"], provider=shown["provider"]
                )
                await self._keep_lease()
            # Proposal cards must land next to agent speech on the session
            # thread. tool_signal_id may be a context host (mail) for outbound
            # replies/tags; explicit ask/propose tools use the speech signal.
            _SPEECH_DECISION_TOOLS = frozenset(
                {
                    "create_decision_request",
                    "propose_action",
                    "suggest_integration",
                    "ask_agent",
                    "handoff_to",
                }
            )
            tool_target = (
                self.signal_id
                if tool_use["name"] in _SPEECH_DECISION_TOOLS
                else self.tool_signal_id
            )
            from app.services.job_card import call_key, lookup_argument, query_in_bounds

            repeat_key = call_key(tool_use["name"], tool_input)
            prior_failure = self._failed_calls.get(repeat_key)
            lookup_query = (
                lookup_argument(tool_use["name"], tool_input) if self.job_sentence else None
            )
            if prior_failure:
                result = {
                    "status": "denied",
                    "error": prior_failure,
                    "hint": "That call already failed. Use different arguments, or stop.",
                }
                self._repeat_denials += 1
                if self._repeat_denials >= 3:
                    self._suppress_tools = True
            elif lookup_query is not None and not query_in_bounds(
                lookup_query, self.job_sentence, self.job_slots
            ):
                result = {
                    "status": "denied",
                    "error": "That name is not in the request.",
                }
            elif (
                self._allowed_tool_names is not None
                and tool_use["name"] not in self._allowed_tool_names
            ):
                result = {
                    "status": "denied",
                    "error": f"Tool {tool_use['name']} is not available on this turn.",
                    "hint": "Answer from what you already have, or use only the tools offered.",
                }
            elif tool_use["name"] == "finish_canvas" and self._canvas_edit_failures:
                from app.services.canvas_content import invalid_edit_for_kind

                kind_name = (self._canvas_kind or "dashboard").strip().lower() or "dashboard"
                result = invalid_edit_for_kind(
                    kind_name,
                    error=(
                        "The last edit_canvas failed; the canvas still shows the old body."
                    ),
                )
            else:
                try:
                    user_role = await self._session_user_role()
                    result = await execute_tool(
                        self.session,
                        self.tenant_id,
                        self.user_id,
                        tool_use["name"],
                        tool_use.get("input", {}),
                        signal_id=tool_target,
                        agent=self.agent,
                        run_id=self.run.id if self.run else None,
                        project_id=self.run.project_id if self.run else None,
                        trust=self.trust,
                        user_role=user_role,
                        surface=self.surface,
                        turn_id=self.turn.stream_id if self.turn is not None else None,
                        tainted=self.tainted is not None,
                        # A person started this turn: the holder rule lets the addressed agent act.
                        operator_asked=self.user_id is not None and self.trust != "external",
                    )
                except Exception as exc:
                    # MissingGreenlet after a mid-tool commit must not kill the turn.
                    if "greenlet" not in str(exc).lower() and type(exc).__name__ != "MissingGreenlet":
                        raise
                    logger.exception("tool %s hit a broken session; recovering", tool_use["name"])
                    await self._release_broken_session()
                    await self._revive_bound_rows()
                    result = {
                        "error": "a tool call failed while saving its result",
                        "status": "error",
                        "hint": "Call the tool again with the same arguments.",
                    }
            from app.services.job_card import failure_text as _failure_text

            failed = _failure_text(result)
            if failed:
                self._failed_calls[repeat_key] = failed
            if (
                tool_use["name"] == "attach_items"
                and isinstance(result, dict)
                and isinstance(result.get("items"), list)
            ):
                for row in result["items"]:
                    if isinstance(row, dict):
                        self._showcase_items.append(row)
            if tool_use["name"] in ("read_doc", "search_index") and isinstance(result, dict):
                if tool_use["name"] == "read_doc" and not result.get("error"):
                    self._knowledge_reads.append({"doc_id": result.get("id"), "title": result.get("title")})
                for hit in result.get("results") or []:
                    if isinstance(hit, dict):
                        self._knowledge_reads.append(hit)
            self._append_trace_step("tool_result", name=tool_use["name"], payload={"result": result})
            if not (isinstance(result, dict) and result.get("error")):
                self._called_ok.add(tool_use["name"])
                from app.services.canvas_blocks import note_turn_tool

                note_turn_tool(
                    self._source_ledger,
                    str(tool_use.get("id") or ""),
                    str(tool_use.get("name") or ""),
                    ok=True,
                    result=result,
                )
            try:
                if self.turn is not None and item is not None:
                    await self.turn.tool_end(item, result)
                    await self._speak_peer_request(tool_use.get("name") or "", tool_use.get("input") or {}, result)
                    await self._keep_lease()
            except Exception:
                logger.exception("tool %s finished; session follow-up failed", tool_use["name"])
                await self._release_broken_session()
            if (
                tool_use["name"] == "update_progress"
                and isinstance(result, dict)
                and not result.get("error")
            ):
                posted = await self._post_progress(str(result.get("message") or ""))
                result["posted"] = posted
                if not posted:
                    result["skipped"] = "too_soon_or_recent"
            if tool_use["name"] in (
                "create_canvas",
                "edit_canvas",
                "update_folder_canvas",
                "finish_canvas",
                "restore_canvas",
            ) and isinstance(result, dict):
                if result.get("error") or result.get("status") == "invalid":
                    if tool_use["name"] in ("edit_canvas", "update_folder_canvas"):
                        self._canvas_edit_failures += 1
                elif not result.get("error"):
                    canvas = result.get("canvas") if isinstance(result.get("canvas"), dict) else {}
                    kind = str(
                        canvas.get("kind")
                        or (tool_use.get("input") or {}).get("kind")
                        or self._canvas_kind
                        or "dashboard"
                    )
                    if kind:
                        self._canvas_kind = kind
                    if tool_use["name"] == "create_canvas":
                        self._canvas_opened = True
                        if "edit_example" in result:
                            self._canvas_edit_example = result.get("edit_example")
                        cid = str(result.get("canvas_id") or "")
                        if cid and (canvas.get("empty") is not False):
                            self._canvas_empty_ids.append(cid)
                    elif tool_use["name"] in ("edit_canvas", "update_folder_canvas", "restore_canvas"):
                        self._canvas_placed = True
                        self._canvas_edit_failures = 0
                        cid = str(result.get("canvas_id") or "")
                        if cid and cid in self._canvas_empty_ids:
                            self._canvas_empty_ids = [x for x in self._canvas_empty_ids if x != cid]
                    elif tool_use["name"] == "finish_canvas" and self._canvas_edit_failures == 0:
                        # After a failed edit the canvas still shows the old body; not done.
                        self._canvas_finished = True
                        self._canvas_placed = True
                for row in result.get("items") or []:
                    # Empty shells must not land as chat cards ("writing" forever).
                    if isinstance(row, dict) and not row.get("empty"):
                        self._showcase_items.append(row)
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tool_use["id"],
                    "content": self._tool_result_content(
                        tool_use["name"], result, str(tool_use.get("id") or "")
                    ),
                }
            )
            await self._revive_bound_rows()
        return tool_results

    def _tool_result_content(self, name: str, result: Any, tool_use_id: str = "") -> str:
        """JSON for the model; outside content is fenced and can taint the turn."""
        from app.services import prompt_guard
        from app.services.canvas_blocks import tool_result_for_model
        from app.tools.registry import get_tool_spec

        result = tool_result_for_model(name, result, tool_use_id)
        text = json.dumps(result)
        spec = get_tool_spec(name)
        if spec is None or not spec.untrusted_output:
            return text
        if self.tainted is None:
            verdict = prompt_guard.assess(text)
            if verdict["flagged"]:
                self.tainted = {**verdict, "source": f"tool:{name}"}
        return prompt_guard.fence(text, f"tool:{name}")

    async def run_chat(
        self,
        messages: list[dict[str, Any]],
        extra_context: str = "",
        attachments: list[dict] | None = None,
    ) -> tuple[str, dict[str, int]]:
        """Non-streaming turn. Returns the last speech; ``self.turn`` has every segment."""
        try:
            return await self._run_chat(messages, extra_context, attachments)
        except Exception:
            await self._abort_turn()
            raise

    async def _run_chat(
        self,
        messages: list[dict[str, Any]],
        extra_context: str,
        attachments: list[dict] | None,
    ) -> tuple[str, dict[str, int]]:
        from app.services.project_canvas import canvas_refresh_wake

        self._source_ledger.clear()
        wake = canvas_refresh_wake.set(bool(self.canvas_refresh))
        try:
            return await self._run_chat_body(messages, extra_context, attachments)
        finally:
            canvas_refresh_wake.reset(wake)

    async def _run_chat_body(
        self,
        messages: list[dict[str, Any]],
        extra_context: str,
        attachments: list[dict] | None,
    ) -> tuple[str, dict[str, int]]:
        await self.begin_inline_turn()
        llm_messages, tokens = await self._prepare_chat(messages, extra_context, attachments)
        turn = self._new_turn()
        self.effort = self._resolve_effort()
        max_tokens = self._resolve_max_tokens()
        self._new_stop_gate()
        started = time.monotonic()
        self._started = started

        self.stop_reason = "max_turns"
        for loop_idx in range(self.max_loops):
            if await self._is_cancelled():
                self.stop_reason = "user_interrupt"
                break
            await self._between_rounds(llm_messages)
            await self._log_event("think", f"Loop {loop_idx + 1}")
            response = await self._llm_chat(llm_messages, max_tokens)
            self._add_usage_tokens(tokens, response.get("usage"))

            for block in response.get("content") or []:
                if block.get("type") == "thinking" and block.get("thinking"):
                    self.thinking_text += str(block["thinking"])
                    await turn.thinking(str(block["thinking"]))

            content = response.get("content") or []
            tool_uses = [b for b in content if b.get("type") == "tool_use"]
            text_blocks = [b["text"] for b in content if b.get("type") == "text"]
            if text_blocks:
                turn.set_speech_text(self._without_pseudo_calls("\n".join(text_blocks)))
            nudge = None if tool_uses else self._pseudo_nudge()
            if nudge:
                llm_messages.append({"role": "assistant", "content": content})
                llm_messages.append({"role": "user", "content": nudge})
                continue

            # Always run tools when the model emitted them — some providers
            # incorrectly label tool turns as end_turn.
            if tool_uses:
                self._pseudo_dropped = False
                if await self._is_cancelled():
                    self.stop_reason = "user_interrupt"
                    break
                joined_tools = "\n".join(text_blocks)
                canvas_tools = any(
                    (tu.get("name") or "") in self._CANVAS_WRITE_TOOLS for tu in tool_uses
                )
                if text_blocks and all(is_progress_filler(t) for t in text_blocks):
                    turn.drop_unseen_filler()
                elif canvas_tools or self._canvas_body_in_text(joined_tools):
                    # Never leave JSX / fences in the bubble next to canvas tools.
                    await self._strip_canvas_speech()
                llm_messages.append({"role": "assistant", "content": content})
                tool_results = await self._execute_tool_loop(llm_messages, tool_uses)
                llm_messages.append({"role": "user", "content": tool_results})
                if await self._canvas_turn_done(llm_messages):
                    self.stop_reason = "end_turn"
                    break
                if self._canvas_caption_asked and self._suppress_tools:
                    continue
                if self._passed_floor:
                    self.stop_reason = "end_turn"
                    break
                continue

            if await self._recover_leaked_proposal(turn):
                self.stop_reason = "end_turn"
                break

            joined = "\n".join(text_blocks)
            if await self._stop_check(
                llm_messages, content, joined, rounds_left=self.max_loops - loop_idx - 1
            ):
                continue
            self.stop_reason = self._stop_gate.stop_reason()
            break

        if self.stop_reason != "user_interrupt" and not await self._is_cancelled():
            failures = self._unresolved_tool_failures()
            canvas_unfinished = (
                ((self._canvas_opened or self._canvas_placed) and not self._canvas_finished)
                or (
                    self._canvas_edit_failures >= self._CANVAS_EDIT_FAIL_LIMIT
                    and not self._canvas_finished
                )
            )
            if canvas_unfinished:
                await self._bin_empty_canvases_this_turn()
                await self._strip_canvas_speech()
                if not self._canvas_placed and turn.has_open_speech:
                    turn.discard_open_speech()
                await self._say_failure(
                    llm_messages,
                    tokens,
                    failures or ["edit_canvas: the canvas was not updated"],
                )
            elif failures and not (turn.final_text or "").strip():
                await self._say_failure(llm_messages, tokens, failures)
        await turn.finish("cancelled" if self.stop_reason == "user_interrupt" else None)
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
        *,
        skip_rag: bool = False,
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Streaming turn.

        Yields ``thinking`` / ``delta`` (with ``segment_id``) events and one
        ``done`` with ``segments`` (speech bubbles + their activity), ``text``
        (last speech, for single-message callers) and ``activity``.

        Operator chat passes ``skip_rag=True`` so the first token is not blocked
        by snapshot + hybrid search. Widget and inbound turns keep RAG so
        published help-center hits can still append related-article links.
        """
        try:
            async for event in self._stream_chat(
                messages, extra_context, attachments, skip_rag=skip_rag
            ):
                yield event
        except Exception:
            await self._abort_turn()
            raise

    async def _stream_chat(
        self,
        messages: list[dict[str, Any]],
        extra_context: str,
        attachments: list[dict] | None,
        *,
        skip_rag: bool,
    ) -> AsyncGenerator[dict[str, Any], None]:
        self._source_ledger.clear()
        turn = self._new_turn()
        stream_id = turn.stream_id
        started = time.monotonic()
        self._started = started
        # Yield before any publish/commit. A slow WebSocket or a locked
        # session used to freeze the turn before the first SSE frame.
        yield {"type": "thinking", "text": ""}
        await asyncio.sleep(0)
        await self.begin_inline_turn()
        self._skip_rag = skip_rag
        try:
            await asyncio.wait_for(turn.start(), timeout=3)
        except Exception:
            logger.exception("chat turn.start failed")
        try:
            await asyncio.wait_for(self._log_event("think", "Preparing reply"), timeout=5)
        except Exception:
            logger.exception("chat preparing-reply event failed")
        prepare_started = time.monotonic()
        try:
            llm_messages, tokens = await asyncio.wait_for(
                self._prepare_chat(messages, extra_context, attachments),
                timeout=12,
            )
            logger.info("chat prepare finished in %.1fs", time.monotonic() - prepare_started)
        except TimeoutError:
            logger.warning(
                "chat prepare timed out after %.1fs; using bare prompt",
                time.monotonic() - prepare_started,
            )
            llm_messages, tokens = await self._prepare_chat_bare(
                messages, extra_context, attachments
            )
        self.effort = self._resolve_effort()
        max_tokens = self._resolve_max_tokens()
        await self._keep_lease()

        cancelled = False
        self._new_stop_gate()
        self.stop_reason = "max_turns"
        for loop_idx in range(self.max_loops):
            if await self._is_cancelled():
                cancelled = True
                break
            await self._between_rounds(llm_messages)
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
                        shown = await self._push_speech(turn, delta)
                        if shown:
                            yield {
                                "type": "delta",
                                "text": shown,
                                "segment_id": turn.current_segment_id,
                                "parts": turn.speech_parts(),
                            }
                elif event["type"] == "done":
                    usage = event.get("usage", {})
                    self._add_usage_tokens(tokens, usage)
                    response_content = event.get("content") or []
                    if not self.thinking_text:
                        for block in response_content:
                            if block.get("type") == "thinking" and block.get("thinking"):
                                self.thinking_text += str(block["thinking"])

            if cancelled:
                break

            await self._flush_speech_hold(turn)
            tool_uses = [b for b in response_content if b.get("type") == "tool_use"]
            text_blocks = [b["text"] for b in response_content if b.get("type") == "text"]
            if text_blocks and not streamed_text:
                turn.set_speech_text(self._without_pseudo_calls("\n".join(text_blocks)))
            nudge = None if tool_uses else self._pseudo_nudge()
            if nudge:
                llm_messages.append(
                    {"role": "assistant", "content": response_content or [{"type": "text", "text": "(draft)"}]}
                )
                llm_messages.append({"role": "user", "content": nudge})
                continue

            if tool_uses:
                self._pseudo_dropped = False
                if await self._is_cancelled():
                    cancelled = True
                    break
                joined_tools = "\n".join(text_blocks) if text_blocks else turn.open_speech_text
                canvas_tools = any(
                    (tu.get("name") or "") in self._CANVAS_WRITE_TOOLS for tu in tool_uses
                )
                if (text_blocks and all(is_progress_filler(t) for t in text_blocks)) or (
                    turn.has_open_speech and is_progress_filler(turn.open_speech_text)
                ):
                    turn.drop_unseen_filler()
                elif canvas_tools or self._canvas_body_in_text(joined_tools or ""):
                    await self._strip_canvas_speech()
                    yield {
                        "type": "delta",
                        "text": "",
                        "segment_id": turn.current_segment_id,
                        "parts": turn.speech_parts(),
                    }
                llm_messages.append({"role": "assistant", "content": response_content})
                tool_results = await self._execute_tool_loop(
                    llm_messages, tool_uses, stream_id=stream_id
                )
                llm_messages.append({"role": "user", "content": tool_results})
                if await self._canvas_turn_done(llm_messages):
                    self.stop_reason = "end_turn"
                    yield {
                        "type": "delta",
                        "text": "",
                        "segment_id": turn.current_segment_id,
                        "parts": turn.speech_parts(),
                    }
                    break
                if self._canvas_caption_asked and self._suppress_tools:
                    continue
                if self._passed_floor:
                    self.stop_reason = "end_turn"
                    break
                continue

            if not cancelled and await self._recover_leaked_proposal(turn):
                self.stop_reason = "end_turn"
                yield {
                    "type": "delta",
                    "text": "",
                    "segment_id": turn.current_segment_id,
                    "parts": turn.speech_parts(),
                }
                break

            joined = "\n".join(text_blocks) if text_blocks else turn.final_text
            if not cancelled and await self._stop_check(
                llm_messages,
                response_content,
                joined or "",
                rounds_left=self.max_loops - loop_idx - 1,
            ):
                # Nudge may have stripped JSX from the open bubble — push that.
                yield {
                    "type": "delta",
                    "text": "",
                    "segment_id": turn.current_segment_id,
                    "parts": turn.speech_parts(),
                }
                continue
            if self._canvas_opened or self._canvas_placed or self._canvas_finished:
                await self._strip_canvas_speech()
                yield {
                    "type": "delta",
                    "text": "",
                    "segment_id": turn.current_segment_id,
                    "parts": turn.speech_parts(),
                }
            self.stop_reason = self._stop_gate.stop_reason()
            break
        if cancelled:
            self.stop_reason = "user_interrupt"

        failures = [] if cancelled else self._unresolved_tool_failures()
        canvas_unfinished = (
            ((self._canvas_opened or self._canvas_placed) and not self._canvas_finished)
            or (
                self._canvas_edit_failures >= self._CANVAS_EDIT_FAIL_LIMIT
                and not self._canvas_finished
            )
        )
        if not cancelled and canvas_unfinished:
            await self._bin_empty_canvases_this_turn()
            await self._strip_canvas_speech()
            # An opening line with no finished canvas would read as success.
            if not self._canvas_placed and turn.has_open_speech:
                turn.discard_open_speech()
            await self._say_failure(
                llm_messages,
                tokens,
                failures or ["edit_canvas: the canvas was not updated"],
            )
            yield {
                "type": "delta",
                "text": "",
                "segment_id": turn.current_segment_id,
                "parts": turn.speech_parts(),
            }
        elif failures and not (turn.final_text or "").strip():
            await self._strip_canvas_speech()
            await self._say_failure(llm_messages, tokens, failures)
            yield {
                "type": "delta",
                "text": "",
                "segment_id": turn.current_segment_id,
                "parts": turn.speech_parts(),
            }
        elif (
            not cancelled
            and (self._canvas_opened or self._canvas_placed or self._canvas_finished)
        ):
            # Never invent a second long bubble after canvas tools — that is how
            # operators saw a different chat cloud plus a writing ghost card.
            await self._strip_canvas_speech()
            yield {
                "type": "delta",
                "text": "",
                "segment_id": turn.current_segment_id,
                "parts": turn.speech_parts(),
            }
        elif (
            not cancelled
            and not (turn.final_text or "").strip()
            and turn.all_activity()
            and not await self._is_cancelled()
        ):
            llm_messages.append(
                {
                    "role": "user",
                    "content": (
                        "You finished the tool calls. Reply to the operator in plain "
                        "language with what you learned. Do not call any tools."
                    ),
                }
            )
            saved_tools = self.tools
            self.tools = []
            await self._log_event("think", "Summarizing")
            try:
                response = await self._llm_chat(llm_messages, max_tokens)
                self._add_usage_tokens(tokens, response.get("usage"))
                text_blocks = [
                    b["text"]
                    for b in (response.get("content") or [])
                    if b.get("type") == "text" and (b.get("text") or "").strip()
                ]
                if text_blocks:
                    summary = "\n".join(text_blocks).strip()
                    await turn.say(summary)
                    seg_id = turn.segments[-1]["id"] if turn.segments else None
                    yield {
                        "type": "delta",
                        "text": summary,
                        "segment_id": seg_id,
                        "parts": turn.speech_parts(),
                    }
            except Exception:
                logger.exception("tool-turn finalize chat failed")
            finally:
                self.tools = saved_tools

        await turn.finish("cancelled" if self.stop_reason == "user_interrupt" else None)
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
        done_text = (turn.final_text or "").strip() or "Done."
        yield {
            **base,
            "text": done_text,
            "thinking": self.thinking_text,
            "thinking_ms": self.thinking_ms,
            "effort": self.effort,
        }
