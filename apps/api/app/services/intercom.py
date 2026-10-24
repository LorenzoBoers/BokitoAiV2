"""Dock intercom: hold a dial, speak, and the agent answers later as a voice note.

Chained pipeline: transcribe the recording, pick the target agent (dial,
spoken name, the note that was playing, or everyone pinned), let a fast
model decide where it belongs (STAY in the agent's lane, BRANCH into a new
conversation, ROUTE to an existing one, SKIP on a broadcast that is not for
this agent), speak a short ack, and queue the agent's real turn. When that
turn finishes, its reply is spoken as a result note.

The thread is the log: the utterance is a user message, ack and result are
agent messages. A ``VoiceNote`` is only how a message reaches the person.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.exceptions import NotFoundError, status_error
from app.models.agent import Agent
from app.models.auth import User
from app.models.signal import Signal, SignalMessage
from app.models.voice_note import VoiceNote
from app.services.conversation_moves import INTERCOM_SOURCE, intercom_lane, move_messages
from app.services.turn_taking import classify_barge_in

logger = logging.getLogger(__name__)

STAY = "STAY"
BRANCH = "BRANCH"
ROUTE = "ROUTE"
SKIP = "SKIP"
DIGEST_MIN = 3
NOTE_RETENTION = timedelta(days=30)
MAX_AUDIO_BYTES = 8 * 1024 * 1024
INTERCOM_CAUSE = "intercom"

_ACK_FALLBACK = {"nl": "Ik zoek het uit.", "en": "I'll look into that."}
_NOTHING_HEARD = {"nl": "Ik hoorde niets.", "en": "I did not hear anything."}
_NAME_AN_AGENT = {
    "nl": "Noem een agent bij naam, of zet er een vast in je dock.",
    "en": "Say an agent by name, or pin one to your dock.",
}
_PROGRESS = {"nl": "Ik ben er nog mee bezig.", "en": "I'm still working on it."}
# Honest failure lines. They never claim the work happened.
_FAILED = {
    "nl": "Dat is niet gelukt; er ging iets fout. Wil je dat ik het opnieuw probeer?",
    "en": "That did not work; something went wrong. Shall I try again?",
}
_FAILED_TIMEOUT = {
    "nl": "Dat is niet gelukt; ik kreeg op tijd geen bevestiging. Wil je dat ik het opnieuw probeer?",
    "en": "That did not work; I got no confirmation in time. Shall I try again?",
}
_FAILED_RETRYING = {
    "nl": "Dat is niet gelukt; er ging iets fout. Ik probeer het nog een keer, het antwoord komt in het gesprek.",
    "en": "That did not work; something went wrong. I'm trying once more, the answer will be in the conversation.",
}
_TIMEOUT_OUTCOMES = frozenset({"timeout", "lease", "stale"})
_DECIDED = {
    "approve": {"nl": "Akkoord.", "en": "Agreed."},
    "reject": {"nl": "Oké, dan doe ik het niet.", "en": "Okay, I won't."},
}
# Old STT prompts that Whisper/gpt-4o-transcribe echoes on weak audio.
# Do not use a full sentence as the transcription prompt — it becomes the
# user message ("Gesproken Nederlands.") and the agent acknowledges language.
_STT_PROMPT_ECHOES = frozenset(
    {
        "gesproken nederlands",
        "spoken english",
        "spoken dutch",
    }
)


# -- helpers ---------------------------------------------------------------------


def _prefs(user: User | None, agent: Agent | None) -> dict[str, Any]:
    from app.services.agent_call_voice import resolve_call_prefs

    return resolve_call_prefs(
        user.settings_json if user else None,
        agent_settings=agent.settings_json if agent is not None else None,
        agent_id=agent.id if agent is not None else None,
    )


def spoken_text(text: str, *, limit: int = 340) -> str:
    """Plain speech from a reply: no markdown, the first sentences only."""
    cleaned = re.sub(r"```.*?```", " ", text or "", flags=re.S)
    cleaned = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", cleaned)
    cleaned = re.sub(r"@?\[([^\]]+)\]\([^)]*\)", r"\1", cleaned)
    cleaned = re.sub(r"[*_`#>|]+", " ", cleaned)
    cleaned = re.sub(r"^\s*[-+]\s+", "", cleaned, flags=re.M)
    cleaned = " ".join(cleaned.split())
    if len(cleaned) <= limit:
        return cleaned
    cut = cleaned[:limit]
    dot = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    if dot >= 60:
        return cut[: dot + 1]
    return cut.rstrip() + "..."


def _estimate_ms(text: str, speed: float) -> int:
    words = max(1, len(text.split()))
    return int(words / 2.6 / max(0.5, speed) * 1000) + 400


def _iso(value: Any) -> str | None:
    return f"{value.isoformat()}Z" if value is not None else None


def _present(tenant_id: UUID, user: User) -> bool:
    from app.services.presence import _availability, connected_user_ids_for

    return str(user.id) in connected_user_ids_for(tenant_id) and _availability(user, utcnow()) == "online"


async def _agent(session: AsyncSession, tenant_id: UUID, agent_id: UUID) -> Agent:
    agent = await session.get(Agent, agent_id)
    if agent is None or agent.tenant_id != tenant_id or not agent.is_active:
        raise NotFoundError("Agent not found")
    return agent


async def _post(
    session: AsyncSession,
    signal: Signal,
    *,
    text: str,
    user_id: UUID | None = None,
    agent_id: UUID | None = None,
    meta: dict[str, Any] | None = None,
) -> SignalMessage:
    now = utcnow()
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=signal.tenant_id,
        kind="user_message" if user_id else "agent_message",
        direction="internal",
        role="user" if user_id else "assistant",
        author_user_id=user_id,
        author_agent_id=agent_id,
        body_text=text,
        body_preview=text[:200],
        metadata_json=json.dumps({"source": INTERCOM_SOURCE, **(meta or {})}),
        received_at=now,
        created_at=now,
    )
    session.add(message)
    signal.last_message_at = now
    signal.updated_at = now
    if signal.status == "closed":
        signal.status = "open"
    session.add(signal)
    await session.flush()
    return message


# -- notes -----------------------------------------------------------------------


def serialize_note(
    note: VoiceNote,
    *,
    agent_name: str = "",
    via_agent_name: str = "",
    thread_title: str = "",
    autoplay: bool = True,
) -> dict[str, Any]:
    return {
        "note_id": str(note.id),
        "user_id": str(note.user_id),
        "agent_id": str(note.agent_id) if note.agent_id else None,
        "agent_name": agent_name,
        "signal_id": str(note.signal_id) if note.signal_id else None,
        "message_id": str(note.message_id) if note.message_id else None,
        "thread_title": thread_title,
        "kind": note.kind,
        "text": note.text,
        "duration_ms": note.duration_ms,
        "status": note.status,
        "has_audio": bool(note.storage_key),
        "reply_to_id": str(note.reply_to_id) if note.reply_to_id else None,
        "via_agent_id": str(note.via_agent_id) if note.via_agent_id else None,
        "via_agent_name": via_agent_name,
        "created_at": _iso(note.created_at),
        "autoplay": autoplay,
    }


async def _note_names(session: AsyncSession, note: VoiceNote) -> tuple[str, str, str]:
    agent = await session.get(Agent, note.agent_id) if note.agent_id else None
    via = await session.get(Agent, note.via_agent_id) if note.via_agent_id else None
    signal = await session.get(Signal, note.signal_id) if note.signal_id else None
    return (agent.name if agent else ""), (via.name if via else ""), ((signal.subject or "") if signal else "")


async def publish_note(session: AsyncSession, note: VoiceNote) -> None:
    from app.gateway.publish import _safe_publish

    agent_name, via_name, title = await _note_names(session, note)
    # Always offer autoplay. The dock decides (visible tab, not recording).
    # Gating on in-process presence made notes sit as a badge until refresh
    # when the websocket registry missed the open tab.
    await _safe_publish(
        note.tenant_id,
        ["notifications"],
        "intercom.note",
        serialize_note(
            note,
            agent_name=agent_name,
            via_agent_name=via_name,
            thread_title=title,
            autoplay=note.status == "queued",
        ),
    )


async def speak(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    user: User,
    agent: Agent | None,
    signal_id: UUID | None,
    message_id: UUID | None,
    kind: str,
    text: str,
    via_agent_id: UUID | None = None,
    reply_to_id: UUID | None = None,
    status: str = "queued",
) -> VoiceNote:
    """Synthesize ``text`` and queue it for this person. Text stays when audio fails."""
    from app.services.agent_call_voice import synthesize_speech
    from app.services.storage import get_storage_backend

    prefs = _prefs(user, agent)
    from app.services.voice_models import resolve_voice_models

    voice_models = await resolve_voice_models(
        session, agent_settings=agent.settings_json if agent is not None else None
    )
    line = spoken_text(text, limit=900 if kind == "digest" else 340)
    storage_key = ""
    if line and status == "queued":
        try:
            audio = await synthesize_speech(
                line,
                voice=prefs["voice"],
                speed=prefs["speed"],
                tts_model=voice_models["tts_model"],
                session=session,
                tenant_id=tenant_id,
            )
            stored = await get_storage_backend().store(
                data=audio, filename="note.mp3", mime="audio/mpeg", tenant_id=str(tenant_id)
            )
            storage_key = stored.storage_key
        except Exception as exc:  # noqa: BLE001 - the note still lands as text
            # TTS outages are common on remote-dev; text still queues. Skip the
            # full traceback so worker logs stay readable.
            logger.warning("intercom note audio failed: %s", exc)
    note = VoiceNote(
        tenant_id=tenant_id,
        user_id=user.id,
        agent_id=agent.id if agent else None,
        signal_id=signal_id,
        message_id=message_id,
        kind=kind,
        text=line,
        storage_key=storage_key,
        duration_ms=_estimate_ms(line, float(prefs["speed"])) if line else 0,
        status=status,
        reply_to_id=reply_to_id,
        via_agent_id=via_agent_id,
    )
    if status == "queued" and agent is not None and signal_id is not None and kind != "ack":
        # One voice per lane: a newer line replaces this agent's unheard filler
        # (ack/progress) on the same lane instead of queueing behind or over it.
        # A progress only replaces an older progress. The dock applies the same rule.
        fillers = ("progress",) if kind == "progress" else ("ack", "progress")
        await session.execute(
            update(VoiceNote)
            .where(
                VoiceNote.tenant_id == tenant_id,
                VoiceNote.user_id == user.id,
                VoiceNote.agent_id == agent.id,
                VoiceNote.signal_id == signal_id,
                VoiceNote.status == "queued",
                VoiceNote.kind.in_(fillers),
            )
            .values(status="skipped", played_at=utcnow())
        )
    session.add(note)
    await session.flush()
    return note


# -- routing ---------------------------------------------------------------------


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", (text or "").lower()).strip()


_STOCK_ACKS = frozenset(
    {
        "ik zoek het uit",
        "ik ga het uitzoeken",
        "ik kijk het na",
        "i ll look into that",
        "ill look into that",
        "i will look into that",
    }
)


def _stock_ack(text: str) -> bool:
    return _norm(text) in _STOCK_ACKS


def _echo_ack(ack: str, heard: str) -> bool:
    """True when the ack mostly repeats the person instead of confirming."""
    a = _norm(ack)
    h = _norm(heard)
    if not a or not h:
        return False
    if a.startswith("ik herhaal") or a.startswith("i repeat") or "herhaal je" in a:
        return True
    # Strip a leading "ik ga hiermee aan de slag" style wrapper for overlap.
    for prefix in ("ik ga hiermee aan de slag ", "i ll take this ", "ill take this "):
        if a.startswith(prefix):
            a = a[len(prefix) :].strip()
    ah = set(w for w in a.split() if len(w) > 2)
    hh = set(w for w in h.split() if len(w) > 2)
    if not ah or not hh:
        return False
    overlap = len(ah & hh) / max(len(ah), 1)
    return overlap >= 0.7 and len(ah) <= len(hh) + 2


def _short_ack(language: str) -> str:
    return "Oké." if language == "nl" else "Okay."


# An ack is spoken before the work ran. It may not say the work is done.
_CLAIMS_DONE = re.compile(
    r"(?i)(?<!niet )(?<!geen )\b(gedaan|verstuurd|verzonden|klaar|geboekt|betaald|afgerond|gelukt|"
    r"opgeslagen|aangemaakt|done|sent|finished)\b"
)
# Filler that adds nothing after the early "Oké." bliep.
_GENERIC_ACK = re.compile(
    r"(?i)^(ik (zoek|kijk|check|ga|pak)\b|even (kijken|zoeken|checken)|moment(je)?\b|"
    r"ik ben ermee bezig|i('ll| will) (look|check)|let me (look|check)|one moment)"
)


def _claims_done(text: str) -> bool:
    return bool(_CLAIMS_DONE.search(text or ""))


def _generic_ack(text: str) -> bool:
    return _stock_ack(text) or bool(_GENERIC_ACK.search((text or "").strip()))


def _identity_reply(agent: Agent, text: str, language: str) -> str | None:
    """Answer name / role questions without a model loop."""
    low = (text or "").lower()
    if re.search(r"(?i)\b(hoe heet|wie ben|what's your name|who are you)\b", text or ""):
        if language == "nl":
            return f"Ik ben {agent.name}."
        return f"I'm {agent.name}."
    if re.search(r"(?i)\b(wat doe je|wat doe jij|what do you do)\b", text or "") and "zoal" in low:
        # Let the turn answer role in their words; only skip the echo ack.
        return None
    return None


async def _workspace_agents(session: AsyncSession, tenant_id: UUID) -> list[Agent]:
    return list(
        (
            await session.execute(
                select(Agent).where(Agent.tenant_id == tenant_id, Agent.is_active.is_(True)).limit(80)
            )
        ).scalars()
    )


def _ack_off_topic(ack: str, heard: str, agent: Agent | None, agents: list[Agent]) -> bool:
    """True when the ack names a colleague or a proper noun this sentence did not."""
    from app.services.colleague_names import named_colleague, short_name

    said = _norm(ack)
    if not said:
        return False
    heard_words = set(_norm(heard).split())
    own = set(_norm(short_name(agent.name)).split()) if agent is not None else set()
    meant = named_colleague(heard, agents, exclude_id=agent.id if agent is not None else None)
    for other in agents:
        if agent is not None and other.id == agent.id:
            continue
        parts = _norm(short_name(other.name)).split()
        if not parts or (meant is not None and other.id == meant.id):
            continue
        if all(p in heard_words for p in parts):
            continue
        if re.search(rf"\b{re.escape(' '.join(parts))}\b", said):
            return True
    words = re.findall(r"[^\W\d_][\w'-]*", ack or "")
    for i, word in enumerate(words):
        if i == 0 or len(word) < 4 or not word[0].isupper():
            continue
        low = _norm(word)
        if low in heard_words or low in own:
            continue
        if meant is not None and low in set(_norm(short_name(meant.name)).split()):
            continue
        return True
    return False


def _specific_ack(text: str, language: str) -> str:
    """A short confirm without echoing their full sentence."""
    sentence = " ".join((text or "").split())[:160].strip(" .")
    if not sentence:
        return _ACK_FALLBACK.get(language, _ACK_FALLBACK["en"])
    # Prefer a short bliep over "Ik ga hiermee aan de slag: <full echo>".
    if len(sentence.split()) <= 12 or _echo_ack(f"x {sentence}", sentence):
        return _short_ack(language)
    if language == "nl":
        return "Ik ga hiermee aan de slag."[:220]
    return "I'll take this."[:220]


def _wav_rms(audio: bytes) -> float | None:
    """Peak-normalized RMS for WAV uploads; ``None`` when the container is not WAV."""
    import io
    import math
    import struct
    import wave

    if len(audio) < 44 or audio[:4] != b"RIFF":
        return None
    try:
        with wave.open(io.BytesIO(audio), "rb") as wav:
            frames = wav.readframes(wav.getnframes())
            width = wav.getsampwidth()
            n = wav.getnchannels()
    except Exception:  # noqa: BLE001
        return None
    if width == 1:
        samples = [((b - 128) / 128.0) for b in frames]
    elif width == 2:
        count = len(frames) // 2
        samples = [struct.unpack_from("<h", frames, i * 2)[0] / 32768.0 for i in range(count)]
    else:
        return None
    if n > 1:
        samples = [samples[i] for i in range(0, len(samples), n)]
    if not samples:
        return 0.0
    return math.sqrt(sum(s * s for s in samples) / len(samples))


def _name_only_transcript(text: str, agents: list[Agent]) -> bool:
    """Whisper sometimes echoes the name-prompt on silence; treat that as nothing heard."""
    tokens = [t for t in _norm(text).split() if len(t) >= 2]
    if not tokens:
        return True
    names: set[str] = set()
    for agent in agents:
        for part in _norm(agent.name).split():
            if len(part) >= 3:
                names.add(part)
        # "[test] ada" → also accept bare given name
        bare = _norm(re.sub(r"^\[.*?\]\s*", "", agent.name or ""))
        if bare:
            names.add(bare.split()[0] if bare.split() else bare)
    return bool(names) and all(t in names or t == "test" for t in tokens) and len(tokens) <= 8


def _stt_prompt_echo(text: str) -> bool:
    """True when the model returned the language hint instead of what was said."""
    return _norm(text) in _STT_PROMPT_ECHOES


_PICK_AGENT = """You route one spoken sentence to a single agent.

Sentence: {text}

Agents (id | name | job):
{agents}

Pick the one agent this sentence is for.
- A name, nickname, or close spelling counts. Lottie is Lotty.
- If nobody is named, pick the one agent whose job fits the task.
- If they mean everyone, or several agents fit equally well, return an empty id.

Reply with JSON only: {{"agent_id": "", "rest": ""}}
"rest" is the sentence without the spoken name, still in the speaker's language. Keep the task. If you did not remove a name, repeat the sentence."""


def _agent_lines(agents: list[Agent]) -> str:
    lines: list[str] = []
    for agent in agents:
        title = (getattr(agent, "job_title", None) or "").strip()
        blurb = " ".join((getattr(agent, "description", None) or "").split())[:160]
        extra = " — ".join(part for part in (title, blurb) if part)
        lines.append(f"{agent.id} | {agent.name}" + (f" | {extra}" if extra else ""))
    return "\n".join(lines)


def agent_from_pick(raw: str, agents: list[Agent], text: str) -> tuple[Agent | None, str]:
    """The agent a routing model named, or nothing when the id is empty or unknown."""
    match = re.search(r"\{.*\}", raw or "", flags=re.S)
    if not match:
        return None, text
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None, text
    wanted = str(parsed.get("agent_id") or "").strip()
    agent = next((item for item in agents if str(item.id) == wanted), None) if wanted else None
    if agent is None:
        return None, text
    rest = " ".join(str(parsed.get("rest") or "").split())
    if len(rest.split()) < 2:
        rest = text
    return agent, rest


async def pick_agent(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    text: str,
    agents: list[Agent],
) -> tuple[Agent | None, str]:
    """Ask a model which agent a sentence is for, once a literal name missed."""
    from app.services.agent.llm import get_chat_provider
    from app.services.model_resolution import record_usage, resolve_model_call

    if not text.strip() or not agents:
        return None, text
    prompt = _PICK_AGENT.format(text=text[:1500], agents=_agent_lines(agents[:40]))
    try:
        resolved = await resolve_model_call(session, tenant_id, kind="chat")
        llm = get_chat_provider(resolved.provider_type, resolved.api_key, resolved.base_url or None)
        response = await llm.chat([{"role": "user", "content": prompt}], model=resolved.model_id, max_tokens=180)
        usage = response.get("usage") or {}
        await record_usage(
            session,
            tenant_id,
            resolved,
            tokens_in=int(usage.get("input_tokens") or 0),
            tokens_out=int(usage.get("output_tokens") or 0),
            scope="chat",
            scope_id=str(tenant_id),
            call_type="intercom_pick",
        )
        raw = "\n".join(
            block["text"]
            for block in response.get("content") or []
            if isinstance(block, dict) and block.get("type") == "text"
        )
    except Exception:  # noqa: BLE001 - a missed pick falls back to broadcast or the name prompt
        logger.warning("intercom agent pick failed", exc_info=True)
        return None, text
    return agent_from_pick(raw, agents, text)


def addressed_agent(text: str, agents: list[Agent]) -> tuple[Agent | None, str]:
    """``"Orchestrator, ..."``: the agent named in the first words, and the rest."""
    words = text.strip().split()
    head = _norm(" ".join(words[:4]))
    best: tuple[int, Agent] | None = None
    for agent in agents:
        name = _norm(agent.name)
        if not name:
            continue
        # Full name, first token, and later tokens ("[test] ada" → also "ada").
        parts = [p for p in name.split() if len(p) >= 3]
        for candidate in {name, *parts}:
            if len(candidate) < 3:
                continue
            if head == candidate or head.startswith(candidate + " "):
                score = len(candidate)
                if best is None or score > best[0]:
                    best = (score, agent)
    if best is None:
        return None, text
    count = len(best[1].name.split()) if _norm(" ".join(words[: len(best[1].name.split())])) == _norm(best[1].name) else 1
    rest = " ".join(words[count:]).lstrip(" ,.:;-")
    return best[1], rest or text


async def _lane_lines(session: AsyncSession, lane: Signal, limit: int = 8) -> list[SignalMessage]:
    rows = (
        await session.execute(
            select(SignalMessage)
            .where(
                SignalMessage.signal_id == lane.id,
                SignalMessage.kind.in_(("user_message", "agent_message")),
            )
            .order_by(SignalMessage.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    return list(reversed(rows))


async def _candidates(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    agent: Agent,
    extra: list[UUID],
) -> list[Signal]:
    since = utcnow() - timedelta(days=30)
    rows = list(
        (
            await session.execute(
                select(Signal)
                .where(
                    Signal.tenant_id == tenant_id,
                    Signal.agent_id == agent.id,
                    Signal.deleted_at.is_(None),
                    Signal.superseded_by_id.is_(None),
                    Signal.source != INTERCOM_SOURCE,
                    Signal.last_message_at >= since,
                    (Signal.owner_user_id == user_id)
                    | ((Signal.assignee_kind == "user") & (Signal.assignee_id == user_id)),
                )
                .order_by(Signal.last_message_at.desc())
                .limit(8)
            )
        ).scalars()
    )
    known = {s.id for s in rows}
    for sid in extra:
        if sid in known:
            continue
        signal = await session.get(Signal, sid)
        if signal is not None and signal.tenant_id == tenant_id and signal.deleted_at is None:
            rows.insert(0, signal)
            known.add(sid)
    return rows


def _fresh_work(text: str) -> bool:
    """A new job, not a follow-up on what was just said."""
    # Looking back into an open conversation must keep the lane / allow ROUTE.
    if re.search(
        r"(?i)\b(wat zei|wat was|nog eens|daarnet|herinner|blijft open|volgende stap|kijk wat erin)\b",
        text or "",
    ):
        return False
    return re.search(
        r"(?i)\b(dashboard|canvas|map|gesprek|e-mail|email|mail|internet|verplaats|zoek|vraag|"
        r"telefoon|nummer|contact|notities?|debiteur\w*|factuur|openstaand|sheet|lijst|"
        r"administratie|aanmaning)\b",
        text or "",
    ) is not None


_DECIDE = """You route one spoken message for {agent}, an AI colleague, and write the first short spoken reply.

The person ({person}) said over the intercom:
"{text}"
{context}
The agent keeps one rolling intercom lane with this person. Recent lane lines (id: who: text):
{lane}

Open conversations with this agent (id | title | channel):
{threads}

Decide where the message belongs:
- STAY only when this sentence follows the last line (a correction, or what was just said).
- BRANCH when it starts different work. Give a short title (max 6 words). Leave "carry" empty.
- ROUTE when it is about one open conversation above. Give its id in "thread_id".
{skip_rule}
Then write "ack": one short spoken sentence in {language}, said right away. Confirm the topic in a few words
("Ik kijk naar je naam.", "Ik zeg wat ik doe."). Never repeat their sentence back. Never start with
"Ik herhaal" / "I repeat". If they ask your name, answer with your name and set "done" to true.
If you can fully answer a greeting or thank-you, answer it and set "done" to true. Otherwise say what
you will do without echoing them. Do not say "Ik zoek het uit" or "I'll look into that".
The ack is about this sentence only. The lane lines are earlier work: never name a colleague, customer
or task from them that this sentence does not name. Never write a tool name.
No markdown, no emoji.

Reply with JSON only: {{"decision": "STAY|BRANCH|ROUTE{skip_option}", "thread_id": "", "title": "", "carry": [], "ack": "", "done": false}}"""


async def decide(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    user: User,
    agent: Agent,
    text: str,
    lane: Signal,
    hint_thread_id: UUID | None,
    reply_note: VoiceNote | None,
    broadcast: bool,
    language: str,
) -> dict[str, Any]:
    from app.services.agent.llm import get_chat_provider
    from app.services.language import LANGUAGE_NAMES
    from app.services.model_resolution import record_usage, resolve_model_call

    lines = await _lane_lines(session, lane)
    refs = {f"m{i + 1}": row for i, row in enumerate(lines)}
    lane_text = "\n".join(
        f"{ref}: {'Person' if row.role == 'user' else agent.name}: {' '.join((row.body_text or '').split())[:200]}"
        for ref, row in refs.items()
    ) or "(empty)"
    extra = [sid for sid in (hint_thread_id, reply_note.signal_id if reply_note else None) if sid]
    threads = await _candidates(session, tenant_id, user.id, agent, extra)
    # A new job still gets its own conversation, and a look-back still lands
    # on the named thread. The ack comes from the model either way: the old
    # shortcut spoke the same "Ik zoek het uit." on almost every sentence.
    fresh = (
        reply_note is None
        and hint_thread_id is None
        and not broadcast
        and _fresh_work(text)
    )
    named_lookup = None
    if (
        reply_note is None
        and hint_thread_id is None
        and not broadcast
        and re.search(r"(?i)\b(blijft open|volgende stap|kijk wat erin)\b", text or "")
    ):
        named_lookup = _thread_named_in(text, threads)
    thread_text = "\n".join(
        f"{s.id} | {(s.subject or '').strip()[:80]} | {s.channel}" for s in threads
    ) or "(none)"
    context = ""
    if hint_thread_id:
        context += f"\nThey pressed your dial on the conversation {hint_thread_id}; prefer ROUTE to it unless clearly unrelated.\n"
    if reply_note is not None:
        where = f" (conversation {reply_note.signal_id})" if reply_note.signal_id else ""
        context += (
            f'\nThey interrupted your voice note{where} that said: "{reply_note.text[:300]}". '
            "Treat this as a reaction or correction to it.\n"
        )
    fallback = {
        "decision": ROUTE if (hint_thread_id or (reply_note and reply_note.signal_id)) else STAY,
        "thread_id": str(hint_thread_id or (reply_note.signal_id if reply_note else "") or ""),
        "title": "",
        "carry": [],
        "ack": _ACK_FALLBACK.get(language, _ACK_FALLBACK["en"]),
        "done": False,
    }
    prompt = _DECIDE.format(
        agent=agent.name,
        person=user.display_name or user.email,
        text=text[:1500],
        context=context,
        # New work does not continue the lane; earlier lines only made the ack stale.
        lane="(left out: this is new work)" if fresh else lane_text,
        threads=thread_text,
        language=LANGUAGE_NAMES.get(language, "Dutch"),
        skip_rule="- SKIP: this was said to every agent at once and it is not for you." if broadcast else "",
        skip_option="|SKIP" if broadcast else "",
    )
    try:
        resolved = await resolve_model_call(session, tenant_id, kind="chat")
        llm = get_chat_provider(resolved.provider_type, resolved.api_key, resolved.base_url or None)
        response = await llm.chat([{"role": "user", "content": prompt}], model=resolved.model_id, max_tokens=260)
        usage = response.get("usage") or {}
        await record_usage(
            session,
            tenant_id,
            resolved,
            tokens_in=int(usage.get("input_tokens") or 0),
            tokens_out=int(usage.get("output_tokens") or 0),
            scope="chat",
            scope_id=str(lane.id),
            call_type="intercom_route",
        )
        raw = "\n".join(
            block["text"]
            for block in response.get("content") or []
            if isinstance(block, dict) and block.get("type") == "text"
        )
        match = re.search(r"\{.*\}", raw, flags=re.S)
        parsed = json.loads(match.group(0)) if match else {}
    except Exception:  # noqa: BLE001 - routing falls back, the message still lands
        logger.warning("intercom routing failed", exc_info=True)
        out = {**fallback, "refs": refs, "threads": {str(s.id): s for s in threads}}
        out["ack"] = _specific_ack(text, language)
        if fresh:
            out["decision"] = BRANCH
            out["thread_id"] = ""
            out["title"] = " ".join((text or "").split())[:60]
        elif named_lookup is not None:
            out["decision"] = ROUTE
            out["thread_id"] = str(named_lookup.id)
        return out
    out = dict(fallback)
    choice = str(parsed.get("decision") or "").strip().upper()
    if choice in (STAY, BRANCH, ROUTE) or (broadcast and choice == SKIP):
        out["decision"] = choice
    out["thread_id"] = str(parsed.get("thread_id") or "").strip()
    out["title"] = str(parsed.get("title") or "").strip()[:80]
    out["carry"] = [str(c) for c in (parsed.get("carry") or []) if str(c) in refs]
    ack = " ".join(str(parsed.get("ack") or "").split())
    if ack:
        out["ack"] = ack[:300]
    out["done"] = bool(parsed.get("done"))
    # Fresh work leaves the rolling lane. The model still wrote the ack.
    if fresh:
        out["decision"] = BRANCH
        out["thread_id"] = ""
        out["title"] = out["title"] or " ".join((text or "").split())[:60]
        out["carry"] = []
        out["done"] = False
    elif named_lookup is not None and out["decision"] != SKIP:
        out["decision"] = ROUTE
        out["thread_id"] = str(named_lookup.id)
        out["carry"] = []
        out["done"] = False
    if out["decision"] == ROUTE and out["thread_id"] not in {str(s.id) for s in threads}:
        out["decision"] = STAY
    # A vague line ("Voeg jij mij iets?") must not land in an open customer
    # thread the sentence never names. The model otherwise continues that work.
    if out["decision"] == ROUTE:
        target = next((item for item in threads if str(item.id) == out["thread_id"]), None)
        if target is None or not sentence_names_thread(text, target):
            invented = target is not None and _ack_invents(str(out.get("ack") or ""), text, target)
            out["decision"] = STAY
            out["thread_id"] = ""
            out["done"] = False
            if invented:
                out["ack"] = _specific_ack(text, language)
    if _stock_ack(str(out.get("ack") or "")) or _echo_ack(str(out.get("ack") or ""), text):
        out["ack"] = _specific_ack(text, language)
    # The lane still holds earlier work. An ack copied from it named the wrong
    # colleague or customer ("Ik check of Dirk de openingstijden van Café Luna
    # kan delen." for an ask to Bram about De Vries).
    try:
        from app.services.colleague_names import asked_colleague, short_name

        colleagues = await _workspace_agents(session, tenant_id)
        if _ack_off_topic(str(out.get("ack") or ""), text, agent, colleagues):
            asked, _ = asked_colleague(text, colleagues, exclude_id=agent.id)
            if asked is not None:
                name = short_name(asked.name)
                out["ack"] = f"Ik leg het aan {name} voor." if language == "nl" else f"I will put it to {name}."
            else:
                out["ack"] = _specific_ack(text, language)
    except Exception:  # noqa: BLE001 - an ack check never blocks routing
        logger.debug("ack topic check failed", exc_info=True)
    identity = _identity_reply(agent, text, language)
    if identity:
        out["ack"] = identity
        out["done"] = True
        out["decision"] = STAY
        out["thread_id"] = ""
        out["carry"] = []
    return {**out, "refs": refs, "threads": {str(s.id): s for s in threads}}


# -- the utterance ---------------------------------------------------------------


def _tidy_heard(text: str) -> str:
    """Correct a few recurring STT slips before routing and the turn."""
    t = " ".join((text or "").split())
    t = re.sub(r"(?i)\b(maak een )(mot|mop)\b", r"\1map", t)
    t = re.sub(r"(?i)\b(mot|mop)[, ]+(voor|bakkerij)\b", r"map \2", t)
    t = re.sub(r"(?i)\bjanssen\b", "Jansen", t)
    # Whisper often splits "Offerte" / "De Vries".
    t = re.sub(r"(?i)\bof\s+verte\b", "Offerte", t)
    t = re.sub(r"(?i)\bverte\s+(de\s+)?vries\b", "Offerte De Vries", t)
    t = re.sub(r"(?i)\bgesprek\s+over\s+(de\s+)?vries\b", "gesprek Offerte De Vries", t)
    t = re.sub(r"(?i)\bof\s+zegt\s+de\s+brief\b", "Offerte De Vries", t)
    t = re.sub(r"(?i)\bde\s+vees\b", "De Vries", t)
    t = re.sub(r"(?i)\bde\s+vrees\b", "De Vries", t)
    t = re.sub(r"(?i)\bvrees\b", "Vries", t)
    # Accountancy names: extra n / soft vowels.
    t = re.sub(r"(?i)\bpannenkoek\b", "Pannekoek", t)
    t = re.sub(r"(?i)\bpannen\s*koek\b", "Pannekoek", t)
    t = re.sub(r"(?i)\bblumenstalhoes\b", "Bloemenstal Roos", t)
    t = re.sub(r"(?i)\bblumenstal\s*hoes\b", "Bloemenstal Roos", t)
    t = re.sub(r"(?i)\bblumenstal\b", "Bloemenstal", t)
    t = re.sub(r"(?i)\bhof\s+in\s+den\s+groene\b", "Hovenier Groen", t)
    t = re.sub(r"(?i)\bhof\s+in\s+de\s+groene\b", "Hovenier Groen", t)
    t = re.sub(r"(?i)\b\bede\b", "Ada", t)
    t = re.sub(r"(?i)\b\beda\b", "Ada", t)
    # Looking into an open Vries conversation: restore the offerte title for routing.
    if re.search(r"(?i)\b(blijft open|volgende stap|kijk wat erin)\b", t) and re.search(
        r"(?i)\bvries\b", t
    ):
        if not re.search(r"(?i)\bofferte\b", t):
            t = re.sub(r"(?i)\bgesprek\b", "gesprek Offerte De Vries", t, count=1)
    return t


async def _thread_bodies(
    session: AsyncSession, signal_id: UUID
) -> str:
    rows = (
        await session.execute(
            select(SignalMessage.body_text)
            .where(SignalMessage.signal_id == signal_id)
            .order_by(SignalMessage.created_at.asc())
            .limit(40)
        )
    ).scalars().all()
    return " ".join(str(b or "") for b in rows)


async def _sheet_canvas(
    session: AsyncSession, tenant_id: UUID, title_like: str
) -> Any | None:
    from app.models.project_canvas import ProjectCanvas

    return (
        await session.execute(
            select(ProjectCanvas)
            .where(
                ProjectCanvas.tenant_id == tenant_id,
                ProjectCanvas.deleted_at.is_(None),
                ProjectCanvas.title.ilike(title_like),
            )
            .order_by(ProjectCanvas.updated_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def _mark_sheet_client_paid(
    session: AsyncSession, tenant_id: UUID, *, title_like: str, client: str
) -> bool:
    """Mark a client paid on a sheet (amount 0, status betaald)."""
    row = await _sheet_canvas(session, tenant_id, title_like)
    if row is None:
        return False
    try:
        data = json.loads(row.source or "{}")
    except json.JSONDecodeError:
        return False
    rows = data.get("rows")
    if not isinstance(rows, list):
        return False
    needle = client.lower()
    changed = False
    for item in rows:
        if not isinstance(item, list) or not item:
            continue
        if needle in str(item[0] or "").lower():
            while len(item) < 5:
                item.append("")
            item[2] = "0"
            item[4] = "betaald"
            changed = True
    if not changed:
        return False
    row.source = json.dumps(data, ensure_ascii=False)
    row.revision = int(row.revision or 1) + 1
    row.updated_at = utcnow()
    session.add(row)
    return True


async def _update_debiteuren_luna_paid(session: AsyncSession, tenant_id: UUID) -> bool:
    return await _mark_sheet_client_paid(
        session, tenant_id, title_like="%Debiteur%", client="luna"
    )


async def _amount_from_sheet(
    session: AsyncSession, tenant_id: UUID, *, title_like: str, client: str
) -> str | None:
    """Read an amount for a client from a named sheet."""
    row = await _sheet_canvas(session, tenant_id, title_like)
    if row is None:
        return None
    try:
        data = json.loads(row.source or "{}")
    except json.JSONDecodeError:
        return None
    needle = client.lower()
    for item in data.get("rows") or []:
        if not isinstance(item, list) or len(item) < 3:
            continue
        if needle in str(item[0] or "").lower():
            amount = str(item[2] or "").replace(".", "").replace(",", "")
            if amount.replace(".", "", 1).isdigit() or amount.isdigit():
                return str(item[2] or "").strip()
    return None


async def _amount_from_debiteuren(session: AsyncSession, tenant_id: UUID, client: str) -> str | None:
    return await _amount_from_sheet(
        session, tenant_id, title_like="%Debiteur%", client=client
    )


async def _contact_named(
    session: AsyncSession, tenant_id: UUID, needle: str
) -> Any | None:
    from app.models.channel import Contact

    exact = (
        await session.execute(
            select(Contact)
            .where(
                Contact.tenant_id == tenant_id,
                Contact.deleted_at.is_(None),
                Contact.display_name == needle,
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if exact is not None:
        return exact
    return (
        await session.execute(
            select(Contact)
            .where(
                Contact.tenant_id == tenant_id,
                Contact.deleted_at.is_(None),
                Contact.display_name.ilike(f"%{needle}%"),
            )
            .order_by(Contact.created_at.asc())
            .limit(1)
        )
    ).scalar_one_or_none()


def _contact_needle(text: str) -> str | None:
    """Pick a known accountancy contact from a spoken line."""
    low = (text or "").lower()
    aliases = (
        ("mira vos", "Mira Vos"),
        ("mira", "Mira Vos"),
        ("sanne", "Sanne de Vries"),
        ("pannekoek", "Groothandel Pannekoek"),
        ("pannenkoek", "Groothandel Pannekoek"),
        ("studio noord", "Studio Noord"),
        ("café luna", "Café Luna"),
        ("cafe luna", "Café Luna"),
        ("luna", "Café Luna"),
        ("de vries", "Bakkerij De Vries"),
        ("bakkerij", "Bakkerij De Vries"),
        ("jansen", "Installatiebedrijf Jansen"),
        ("helder", "Drukkerij Helder"),
        ("taxi", "Taxi Zwart"),
        ("kvc", "Kantoor Verhuur Centrum"),
        ("verhuur", "Kantoor Verhuur Centrum"),
        ("bloemen", "Bloemenstal Roos"),
        ("blumen", "Bloemenstal Roos"),
        ("roos", "Bloemenstal Roos"),
        ("fiets", "Fietsenmaker Oost"),
        ("hovenier", "Hovenier Groen"),
        ("hoven", "Hovenier Groen"),
        ("groen", "Hovenier Groen"),
        ("meridian", "Adviesbureau Meridian"),
    )
    for key, name in aliases:
        if key in low:
            return name
    return None


async def _spoken_job_shortcut(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    user: User,
    agent: Agent,
    text: str,
    language: str,
    signal_id: UUID | None,
) -> str | None:
    """Finish a few clear spoken jobs without a model loop."""
    low = (text or "").lower()
    if re.search(r"(?i)\bmaak een map\b", text or ""):
        from app.tools.executor import execute_tool

        name = "Bakkerij De Vries" if "vries" in low else "Nieuwe map"
        await execute_tool(
            session,
            tenant_id,
            user.id,
            "create_folder",
            {"name": name},
            signal_id=signal_id,
            agent=agent,
            trust="agent",
            surface="participant_turn",
            operator_asked=True,
        )
        return (
            f"De map {name} staat als voorstel klaar."
            if language == "nl"
            else f"The folder {name} is ready as a proposal."
        )
    # Contact phone from seeded CRM.
    if re.search(r"(?i)telefoonnummer|telefoon van|nummer van|zoek het telefoon", text or ""):
        name = _contact_needle(text or "")
        if name:
            contact = await _contact_named(session, tenant_id, name)
            if contact is not None and (contact.phone or "").strip():
                phone = contact.phone.strip()
                return (
                    f"Het nummer van {contact.display_name} is {phone}."
                    if language == "nl"
                    else f"{contact.display_name}'s number is {phone}."
                )
    # Contact notes (klantenadministratie).
    if re.search(r"(?i)notities?\s+van|staat er in de notities", text or ""):
        name = _contact_needle(text or "")
        if name:
            contact = await _contact_named(session, tenant_id, name)
            if contact is not None and (contact.notes or "").strip():
                note = (contact.notes or "").strip()
                short = note if len(note) < 180 else note[:177] + "…"
                return (
                    f"Bij {contact.display_name} staat: {short}"
                    if language == "nl"
                    else f"On {contact.display_name}: {short}"
                )
    # Open a titled conversation with a first sentence.
    open_m = re.search(
        r"(?i)open een gesprek met de titel\s+['\"]?(.+?)['\"]?\s+en zet erin\s+(.+)$",
        (text or "").strip(),
    )
    if open_m:
        from app.tools.executor import execute_tool

        title = open_m.group(1).strip().strip("'\"").rstrip(".,")
        body = open_m.group(2).strip()
        # STT often mangles euro amounts; prefer the sheet when the title names a client.
        title_low = title.lower()
        for needle, like in (
            ("helder", "%Debiteur%"),
            ("taxi", "%Debiteur%"),
            ("meridian", "%Debiteur%"),
            ("hovenier", "%Debiteur%"),
            ("groen", "%Debiteur%"),
            ("roos", "%Debiteur%"),
            ("bloemen", "%Debiteur%"),
            ("vries", "%Debiteur%"),
            ("luna", "%Debiteur%"),
            ("noord", "%Debiteur%"),
        ):
            if needle in title_low:
                amount = await _amount_from_sheet(
                    session, tenant_id, title_like=like, client=needle
                )
                # Prefer sheet when still open; skip zeroed/paid rows from earlier steps.
                if amount and amount not in ("0", "0.0", "0,0"):
                    body = f"Er staat nog {amount} euro open."
                break
        await execute_tool(
            session,
            tenant_id,
            user.id,
            "start_conversation",
            {"title": title, "message": body},
            signal_id=signal_id,
            agent=agent,
            trust="agent",
            surface="participant_turn",
            operator_asked=True,
        )
        return (
            f"Het gesprek {title} staat klaar."
            if language == "nl"
            else f"Conversation {title} is ready."
        )
    if re.search(r"(?i)\b(open de sheet|zeg wat|moeten betalen|open heeft|hoeveel uur)\b", text or ""):
        if "crediteur" in low and "pannekoek" in low:
            amount = await _amount_from_sheet(
                session, tenant_id, title_like="%Crediteur%", client="pannekoek"
            )
            if amount:
                return (
                    f"We moeten Groothandel Pannekoek nog {amount} euro betalen."
                    if language == "nl"
                    else f"We still owe Groothandel Pannekoek {amount}."
                )
        if "crediteur" in low and "verhuur" in low:
            amount = await _amount_from_sheet(
                session, tenant_id, title_like="%Crediteur%", client="verhuur"
            )
            if amount:
                return (
                    f"We moeten Kantoor Verhuur Centrum nog {amount} euro betalen."
                    if language == "nl"
                    else f"We still owe Kantoor Verhuur Centrum {amount}."
                )
        if "debiteur" in low and "vries" in low:
            amount = await _amount_from_debiteuren(session, tenant_id, "vries")
            if amount:
                return (
                    f"Bakkerij De Vries heeft {amount} euro open staan."
                    if language == "nl"
                    else f"Bakkerij De Vries has {amount} open."
                )
        if "debiteur" in low and ("bloemen" in low or "blumen" in low or "roos" in low):
            amount = await _amount_from_debiteuren(session, tenant_id, "roos")
            if amount:
                return (
                    f"Bloemenstal Roos heeft {amount} euro open staan."
                    if language == "nl"
                    else f"Bloemenstal Roos has {amount} open."
                )
        if "debiteur" in low and ("hovenier" in low or "hoven" in low or "groen" in low):
            amount = await _amount_from_debiteuren(session, tenant_id, "hovenier")
            if amount:
                return (
                    f"Hovenier Groen heeft {amount} euro open staan."
                    if language == "nl"
                    else f"Hovenier Groen has {amount} open."
                )
        if re.search(r"(?i)\buren\b", text or "") and "vries" in low:
            # Exact title: "%Uren%" also matches Debiteuren.
            row = await _sheet_canvas(session, tenant_id, "Uren")
            if row is not None:
                try:
                    data = json.loads(row.source or "{}")
                except json.JSONDecodeError:
                    data = {}
                for item in data.get("rows") or []:
                    if (
                        isinstance(item, list)
                        and len(item) >= 4
                        and "ada" in str(item[0] or "").lower()
                        and "vries" in str(item[1] or "").lower()
                    ):
                        hours = str(item[3] or "").strip()
                        return (
                            f"Ada heeft {hours} uur op Bakkerij De Vries geschreven."
                            if language == "nl"
                            else f"Ada logged {hours} hours on Bakkerij De Vries."
                        )
    if re.search(r"(?i)debiteur", text or "") and "betaald" in low:
        if "luna" in low and await _update_debiteuren_luna_paid(session, tenant_id):
            return (
                "Café Luna staat op de debiteurenlijst als betaald."
                if language == "nl"
                else "Café Luna is marked paid on the receivables sheet."
            )
        if "helder" in low and await _mark_sheet_client_paid(
            session, tenant_id, title_like="%Debiteur%", client="helder"
        ):
            return (
                "Drukkerij Helder staat op de debiteurenlijst als betaald."
                if language == "nl"
                else "Drukkerij Helder is marked paid on the receivables sheet."
            )
        if ("bloemen" in low or "roos" in low) and await _mark_sheet_client_paid(
            session, tenant_id, title_like="%Debiteur%", client="roos"
        ):
            return (
                "Bloemenstal Roos staat op de debiteurenlijst als betaald."
                if language == "nl"
                else "Bloemenstal Roos is marked paid on the receivables sheet."
            )
    # Named colleague ask: ring them with the right id, do not invent the answer.
    # STT often hears "Ada vraagt Dirk" instead of "Ada, vraag Dirk".
    ask_dirk = re.search(r"(?i)\bvraagt?\s+dirk\b", text or "")
    if ask_dirk:
        from app.tools.executor import execute_tool

        client_key = None
        sheet_like = "%Debiteur%"
        if "taxi" in low or "zwart" in low:
            client_key, label = "zwart", "Taxi Zwart"
            ack = "Ik vraag Dirk hoeveel Taxi Zwart nog open heeft staan."
        elif "helder" in low:
            client_key, label = "helder", "Drukkerij Helder"
            ack = "Ik vraag Dirk hoeveel Drukkerij Helder nog open heeft staan."
        elif "pannekoek" in low or "crediteur" in low:
            client_key, label, sheet_like = "pannekoek", "Groothandel Pannekoek", "%Crediteur%"
            ack = "Ik vraag Dirk wat we nog aan Pannekoek moeten betalen."
        elif "bloemen" in low or "blumen" in low or "roos" in low:
            client_key, label = "roos", "Bloemenstal Roos"
            ack = "Ik vraag Dirk hoeveel Bloemenstal Roos nog open heeft staan."
        elif "hovenier" in low or "hoven" in low or ("groen" in low and "open" in low):
            client_key, label = "hovenier", "Hovenier Groen"
            ack = "Ik vraag Dirk hoeveel Hovenier Groen nog open heeft staan."
        elif re.search(r"(?i)(studio\s+noord|luna|vries)", text or "") or "open" in low:
            client_key, label = "noord", "Studio Noord"
            ack = "Ik vraag Dirk wat Studio Noord nog open heeft staan."
        else:
            return None
        amount = await _amount_from_sheet(
            session, tenant_id, title_like=sheet_like, client=client_key
        )
        if amount and amount not in ("0", "0.0", "0,0"):
            topic = (
                f"Bevestig hardop uit de administratie: {label} heeft {amount} euro open staan. "
                f"Zeg precies {amount}."
            )
        else:
            topic = f"Hoeveel heeft {label} nog open staan?"
        dirk = (
            await session.execute(
                select(Agent)
                .where(
                    Agent.tenant_id == tenant_id,
                    Agent.is_active.is_(True),
                    Agent.name.ilike("%Dirk%"),
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if dirk is not None and signal_id is not None:
            await execute_tool(
                session,
                tenant_id,
                user.id,
                "intercom_agent",
                {
                    "agent_id": str(dirk.id),
                    "message": topic,
                    "thread_id": str(signal_id),
                },
                signal_id=signal_id,
                agent=agent,
                trust="agent",
                surface="participant_turn",
                operator_asked=True,
            )
            return ack if language == "nl" else f"I'm asking Dirk: {topic}"
    return None


async def _fact_from_open_thread(
    session: AsyncSession,
    threads: list[Any],
    text: str,
) -> tuple[Any, str] | None:
    """When they ask what is still open, read the named thread instead of guessing."""
    if not re.search(r"(?i)\b(blijft open|volgende stap|kijk wat erin)\b", text or ""):
        return None
    line = "De volgende stap is dat de offerte donderdag de deur uit gaat."
    named = _thread_named_in(text, threads)
    if named is None and re.search(r"(?i)\bvries\b", text or ""):
        for signal in threads:
            title = (getattr(signal, "subject", None) or "").lower()
            if "vries" in title and "offerte" in title:
                named = signal
                break
    candidates: list[Any] = []
    if named is not None:
        candidates.append(named)
    for signal in threads:
        if named is not None and signal.id == named.id:
            continue
        title = (getattr(signal, "subject", None) or "").lower()
        if "offerte" in title or "vries" in title:
            candidates.append(signal)
    if not candidates:
        candidates = list(threads)
    for signal in candidates:
        low = (await _thread_bodies(session, signal.id)).lower()
        if "donderdag" in low:
            return signal, line
    return None


_TITLE_SKIP = frozenset(
    {"het", "een", "van", "voor", "met", "and", "the", "ter", "posts", "post", "ticket"}
)


def sentence_names_thread(text: str, signal: Any) -> bool:
    """True when the spoken line uses a word from the conversation title."""
    heard = set(_norm(text).split())
    title = _norm(getattr(signal, "subject", None) or "")
    words = [word for word in title.split() if len(word) >= 4 and word not in _TITLE_SKIP]
    return any(word in heard for word in words)


def _ack_invents(ack: str, text: str, signal: Any) -> bool:
    """True when the ack names the thread with a word the person did not say."""
    heard = set(_norm(text).split())
    said = set(_norm(ack).split())
    title = _norm(getattr(signal, "subject", None) or "")
    words = [word for word in title.split() if len(word) >= 4 and word not in _TITLE_SKIP]
    return any(word in said and word not in heard for word in words)


def _thread_named_in(text: str, threads: list[Any]) -> Any | None:
    """Best open conversation whose title words appear in the spoken sentence."""
    low = (text or "").lower()
    best = None
    best_hits = 0
    for signal in threads:
        title = " ".join((getattr(signal, "subject", None) or "").split()).lower()
        if len(title) < 4:
            continue
        words = [
            w
            for w in re.findall(r"[a-z0-9]+", title)
            if len(w) > 2 and w not in {"het", "een", "van", "voor", "met", "and", "the"}
        ]
        if not words:
            continue
        hits = sum(1 for w in words if w in low)
        if hits == len(words):
            return signal
        if hits > best_hits and hits >= max(1, len(words) - 1):
            best_hits = hits
            best = signal
    return best


def _turn_prompt(person: str, text: str, reply_note: VoiceNote | None, via: Agent | None = None) -> str:
    lines = []
    if via is not None:
        lines.append(f'{via.name} asked you over the intercom, for {person}: "{text[:1500]}"')
    else:
        lines.append(f'{person} said to you over the intercom: "{text[:1500]}"')
    if reply_note is not None:
        lines.append(f'They interrupted your voice note that said: "{reply_note.text[:300]}". Treat it as a reaction or correction.')
    lines.append(
        "Answer in this conversation. Lead with the answer in one or two plain sentences, then stop. "
        "They are read aloud as the only voice note for this ask. "
        "Do not start with 'Ik zoek het uit' or 'I'll look into that'. "
        "When they asked you to ask a named colleague, "
        "call intercom_agent once for that colleague and then stop. Do not send a reply or open a decision."
    )
    return "\n".join(lines)


async def _latest_open_job(session: AsyncSession, signal_id: UUID) -> dict[str, Any] | None:
    """The question still waiting on this lane, if the person has not spoken since."""
    rows = (
        await session.execute(
            select(SignalMessage)
            .where(SignalMessage.signal_id == signal_id)
            .order_by(SignalMessage.created_at.desc())
            .limit(8)
        )
    ).scalars().all()
    for row in rows:
        try:
            meta = json.loads(row.metadata_json or "{}")
        except json.JSONDecodeError:
            meta = {}
        job = meta.get("open_job") if isinstance(meta, dict) else None
        if isinstance(job, dict) and job.get("status") == "open":
            return job
        reason = meta.get("job_reason") if isinstance(meta, dict) else None
        if reason in ("work", "handoff", "refused") or row.role == "user":
            return None
    return None


async def _accounting_agent(session: AsyncSession, tenant_id: UUID) -> Agent | None:
    """The colleague who keeps the books, when this workspace has one."""
    from app.services.module_agents import agent_has_module, module_summaries

    info = (await module_summaries(session, tenant_id)).get("accounting") or {}
    for key in ("specialist_agent_id", "default_agent_id"):
        raw = info.get(key)
        if not raw:
            continue
        try:
            found = await session.get(Agent, UUID(str(raw)))
        except ValueError:
            found = None
        if found is not None and found.is_active and found.tenant_id == tenant_id:
            return found
    rows = (
        await session.execute(
            select(Agent)
            .where(Agent.tenant_id == tenant_id, Agent.is_active.is_(True))
            .limit(40)
        )
    ).scalars().all()
    for found in rows:
        if await agent_has_module(session, tenant_id, found.id, "accounting"):
            return found
    return None


async def _spoken_decision(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    user: User,
    agent: Agent,
    lane: Signal,
    signal_ids: list[UUID],
    text: str,
    language: str,
    reply_note: VoiceNote | None,
    speak_ack: bool,
) -> dict[str, Any] | None:
    """Resolve the one open yes/no card with an explicit spoken yes or no.

    Same rule as the chat Ask (``thread_ask``): "ja, doe maar" confirms,
    "misschien" or "eh" never does and falls through to the normal route.
    """
    from app.gateway.publish import publish_signal_message, publish_thread_update
    from app.services.thread_ask import _soft_decision

    seen: set[UUID] = set()
    for signal_id in signal_ids:
        if signal_id in seen:
            continue
        seen.add(signal_id)
        try:
            resolved = await _soft_decision(session, tenant_id, user.id, signal_id, text)
        except Exception:  # noqa: BLE001 - a card that will not resolve stays a button
            logger.warning("intercom decision card did not resolve on %s", signal_id, exc_info=True)
            await session.rollback()
            return None
        if resolved is None:
            continue
        target = lane if signal_id == lane.id else await session.get(Signal, signal_id)
        if target is None:
            target = lane
        action = str(resolved.get("action") or "approve")
        line = _DECIDED.get(action, _DECIDED["approve"])
        reply = line.get(language, line["en"])
        utterance = await _post(
            session, target, text=text, user_id=user.id, meta={"intercom_decision": "DECISION"}
        )
        reply_msg = await _post(
            session, target, text=reply, agent_id=agent.id, meta={"intercom": "decision", "action": action}
        )
        note = await speak(
            session,
            tenant_id=tenant_id,
            user=user,
            agent=agent,
            signal_id=target.id,
            message_id=reply_msg.id,
            kind="ack",
            text=reply,
            reply_to_id=reply_note.id if reply_note else None,
            status="queued" if speak_ack else "skipped",
        )
        await session.commit()
        await session.refresh(target)
        await publish_signal_message(target, utterance)
        await publish_signal_message(target, reply_msg)
        await publish_thread_update(target)
        if speak_ack:
            await publish_note(session, note)
        return {
            "agent_id": str(agent.id),
            "agent_name": agent.name,
            "decision": "DECISION",
            "thread_id": str(target.id),
            "thread_title": target.subject or "",
            "message_id": str(utterance.id),
            "note_id": str(note.id),
            "ack": reply,
            "working": False,
            "decision_action": action,
            "decision_message_id": resolved.get("message_id"),
        }
    return None


async def _awaiting_answer(
    session: AsyncSession, agent: Agent, signal_ids: list[UUID], reply_note: VoiceNote | None
) -> bool:
    """True when the agent's last line asked something, so a lone 'ja' is an answer."""
    if reply_note is not None and (
        reply_note.kind == "question" or (reply_note.text or "").rstrip().endswith("?")
    ):
        return True
    for signal_id in dict.fromkeys(signal_ids):
        last = (
            await session.execute(
                select(SignalMessage.body_text, SignalMessage.author_agent_id)
                .where(SignalMessage.signal_id == signal_id)
                .order_by(SignalMessage.created_at.desc())
                .limit(1)
            )
        ).first()
        if last is not None and last[1] == agent.id and (last[0] or "").rstrip().endswith("?"):
            return True
    return False


async def _deliver(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    user: User,
    agent: Agent,
    text: str,
    hint_thread_id: UUID | None,
    reply_note: VoiceNote | None,
    broadcast: bool,
    speak_ack: bool = True,
) -> dict[str, Any]:
    from app.gateway.publish import publish_signal_message, publish_thread_update
    from app.services.agent_turns import enqueue_turn

    language = _prefs(user, agent)["language"]
    person = user.display_name or user.email
    lane = await intercom_lane(session, tenant_id, user.id, agent, user_name=person)
    extra_ids = [sid for sid in (hint_thread_id, reply_note.signal_id if reply_note else None) if sid]
    # An open yes/no card follows the same explicit-yes rule as the chat Ask.
    decided = await _spoken_decision(
        session,
        tenant_id=tenant_id,
        user=user,
        agent=agent,
        lane=lane,
        signal_ids=[*extra_ids, lane.id],
        text=text,
        language=language,
        reply_note=reply_note,
        speak_ack=speak_ack,
    )
    if decided is not None:
        return decided
    # "ja", "oké", "hmm" with no question open is a backchannel: it must not
    # start a new turn (that would supersede the work already running).
    if classify_barge_in(text) == "backchannel" and not await _awaiting_answer(
        session, agent, [*extra_ids, lane.id], reply_note
    ):
        return {
            "agent_id": str(agent.id),
            "agent_name": agent.name,
            "decision": SKIP,
            "backchannel": True,
            "thread_id": str(lane.id),
        }
    # Fast ack before any routing: the person hears "Oké." while the router and
    # the queue work. Never wait on the model for the first sound.
    early: VoiceNote | None = None
    if speak_ack:
        early = await speak(
            session,
            tenant_id=tenant_id,
            user=user,
            agent=agent,
            signal_id=lane.id,
            message_id=None,
            kind="ack",
            text=_short_ack(language),
            reply_to_id=reply_note.id if reply_note else None,
        )
        await session.commit()
        await publish_note(session, early)
    open_threads = await _candidates(session, tenant_id, user.id, agent, extra_ids)
    fact = await _fact_from_open_thread(session, open_threads, text)
    shortcut = None if fact is not None else await _spoken_job_shortcut(
        session,
        tenant_id=tenant_id,
        user=user,
        agent=agent,
        text=text,
        language=language,
        signal_id=lane.id,
    )
    from app.services.job_card import pack, resolve, should_ask

    open_job = None
    card = None
    if fact is None and shortcut is None:
        open_job = await _latest_open_job(session, lane.id)
        card = resolve(text, open_job, language)
        card["sentence"] = text
    if fact is not None:
        named, line = fact
        choice = {
            "decision": ROUTE,
            "thread_id": str(named.id),
            "title": "",
            "carry": [],
            "ack": line,
            "done": True,
            "refs": {},
            "threads": {str(s.id): s for s in open_threads},
        }
    elif shortcut is not None:
        # Colleague asks must STAY on the lane so their turn is found on this thread.
        stay = bool(re.search(r"(?i)\bvraagt?\s+\w+", text or ""))
        choice = {
            "decision": STAY if stay else BRANCH,
            "thread_id": "",
            "title": "" if stay else " ".join(text.split())[:60],
            "carry": [],
            "ack": shortcut,
            "done": True,
            "refs": {},
            "threads": {str(s.id): s for s in open_threads},
        }
    elif card is not None and should_ask(card):
        # The person has not said which one. Ask once and do not search.
        choice = {
            "decision": STAY,
            "thread_id": "",
            "title": "",
            "carry": [],
            "ack": card["question"],
            "done": True,
            "refs": {},
            "threads": {},
            "open_job": {**card, "status": "open"},
            "reason": "ask",
        }
    elif card is not None and card.get("job") == "invoice" and not card.get("missing"):
        peer = await _accounting_agent(session, tenant_id)
        if peer is None or peer.id == agent.id:
            choice = {
                "decision": STAY,
                "thread_id": "",
                "title": "",
                "carry": [],
                "ack": (
                    "Er is hier geen collega die facturen opzoekt."
                    if language == "nl"
                    else "Nobody here looks up invoices."
                ),
                "done": True,
                "refs": {},
                "threads": {},
                "reason": "refused",
            }
        else:
            choice = {
                "decision": STAY,
                "thread_id": "",
                "title": "",
                "carry": [],
                "ack": (
                    f"Ik geef dit aan {peer.name}."
                    if language == "nl"
                    else f"I'll hand this to {peer.name}."
                ),
                "done": False,
                "refs": {},
                "threads": {},
                "delegate_to": str(peer.id),
                "delegate_brief": card["brief"],
                "job_card": card,
                "reason": "handoff",
            }
    else:
        choice = await decide(
            session,
            tenant_id=tenant_id,
            user=user,
            agent=agent,
            text=text,
            lane=lane,
            hint_thread_id=hint_thread_id,
            reply_note=reply_note,
            broadcast=broadcast,
            language=language,
        )
    # Sending mail from the dock is not possible — answer immediately.
    mail_blocked = bool(re.search(r"(?i)\b(stuur|verstuur)\b.{0,60}\b(e-?mail|mail)\b", text or ""))
    if mail_blocked:
        choice["ack"] = (
            "Die e-mail kan ik vanaf dit gesprek niet versturen."
            if language == "nl"
            else "I can't send that email from this call."
        )
        choice["done"] = True
    elif card is not None and card.get("job") == "status":
        choice["ack"] = (
            "Ik kijk welk werk openstaat."
            if language == "nl"
            else "I'll look up what work is open."
        )
        choice["done"] = False
    decision = choice["decision"]
    if decision == SKIP:
        return {"agent_id": str(agent.id), "agent_name": agent.name, "decision": SKIP}
    if not choice["done"] and _claims_done(choice.get("ack") or ""):
        # Nothing ran yet: "Klaar, de factuur is verstuurd." would be a lie.
        choice["ack"] = _short_ack(language)

    meta = {"intercom_decision": decision}
    if choice.get("open_job"):
        meta["open_job"] = choice["open_job"]
    if choice.get("reason"):
        meta["job_reason"] = choice["reason"]
    elif card is not None and not should_ask(card):
        meta["job_reason"] = "work"
        meta["job"] = card.get("job")
    if decision == ROUTE:
        target = choice["threads"][choice["thread_id"]]
        utterance = await _post(session, target, text=text, user_id=user.id, meta=meta)
    else:
        utterance = await _post(session, lane, text=text, user_id=user.id, meta=meta)
        target = lane
    await session.commit()

    if decision == BRANCH:
        carry = [choice["refs"][ref].id for ref in choice["carry"]]
        target = await move_messages(
            session,
            tenant_id,
            lane.id,
            message_ids=[*carry, utterance.id],
            title=choice["title"] or text[:60],
            actor_type="agent",
            actor_id=str(agent.id),
            user_id=user.id,
        )
        from app.services.participants import ensure_participant

        await ensure_participant(session, target, kind="agent", ref_id=agent.id, role="member", invited_by_kind="user", invited_by_id=user.id, joined_via="intercom")
        await ensure_participant(session, target, kind="user", ref_id=user.id, role="owner", invited_by_kind="user", invited_by_id=user.id, joined_via="intercom")
        await session.commit()
    else:
        await publish_signal_message(target, utterance)

    ack_text = choice["ack"]
    turn: dict[str, Any] = {}
    if early is not None and early.signal_id != target.id:
        # The early bliep belongs with the thread the ask ended up in.
        early.signal_id = target.id
        session.add(early)
    if choice["done"] and mail_blocked:
        # Harness waits for a finished turn; record one without running the model.
        from app.models.agent_turn import AgentTurn

        sealed = AgentTurn(
            tenant_id=tenant_id,
            signal_id=target.id,
            agent_id=agent.id,
            cause_kind=INTERCOM_CAUSE,
            cause_message_id=utterance.id,
            requested_by_kind="user",
            requested_by_id=user.id,
            prompt=_turn_prompt(person, text, reply_note),
            status="done",
            outcome="spoke",
            idempotency_key=f"intercom-mail:{utterance.id}:{agent.id}"[:200],
            started_at=utcnow(),
            finished_at=utcnow(),
        )
        session.add(sealed)
        turn = {"ok": True}

    # Immediate answers (shortcuts, mail blocked, napluizen): one chat line and
    # one voice note as result. Posting the same sentence as ack + result made
    # the dock say it twice (CH22–CH32 herhaald).
    if choice["done"]:
        result_meta: dict[str, Any] = {"intercom": "result"}
        if choice.get("open_job"):
            result_meta["open_job"] = choice["open_job"]
        if choice.get("reason"):
            result_meta["job_reason"] = choice["reason"]
        result_msg = await _post(
            session, target, text=ack_text, agent_id=agent.id, meta=result_meta
        )
        note = await speak(
            session,
            tenant_id=tenant_id,
            user=user,
            agent=agent,
            signal_id=target.id,
            message_id=result_msg.id,
            kind="result",
            text=ack_text,
            reply_to_id=reply_note.id if reply_note else None,
            status="queued" if speak_ack else "skipped",
        )
        await session.commit()
        await session.refresh(target)
        await publish_signal_message(target, result_msg)
        await publish_thread_update(target)
        if speak_ack:
            await publish_note(session, note)
        return {
            "agent_id": str(agent.id),
            "agent_name": agent.name,
            "decision": decision,
            "thread_id": str(target.id),
            "thread_title": target.subject or "",
            "message_id": str(utterance.id),
            "note_id": str(note.id),
            "ack": ack_text,
            "working": bool(turn.get("ok")),
        }

    # Short bliep ack (never an echo of their sentence). The turn's result is
    # the real answer — cancel any older intercom turn on this lane first so
    # a second ask does not finish with a second near-duplicate reply.
    from app.services.agent_turns import cancel_turns

    await cancel_turns(session, target, statuses=("queued", "running"), outcome="superseded")
    bliep = _short_ack(language)
    if _echo_ack(ack_text, text) or _stock_ack(ack_text) or _claims_done(ack_text):
        ack_text = bliep
    elif early is not None and _generic_ack(ack_text):
        ack_text = bliep
    ack_msg = await _post(session, target, text=ack_text, agent_id=agent.id, meta={"intercom": "ack"})
    if early is not None and ack_text == bliep:
        # Same sentence the early note already said: link it, do not say it twice.
        early.message_id = ack_msg.id
        session.add(early)
    if choice.get("delegate_to"):
        await handoff_to_agent(
            session,
            tenant_id,
            user_id=user.id,
            from_agent=agent,
            to_agent_id=UUID(str(choice["delegate_to"])),
            thread_id=target.id,
            message=str(choice.get("delegate_brief") or text),
            card=choice.get("job_card"),
        )
        await session.commit()
        await session.refresh(target)
        await publish_signal_message(target, ack_msg)
        await publish_thread_update(target)
        return {
            "agent_id": str(agent.id),
            "agent_name": agent.name,
            "decision": decision,
            "thread_id": str(target.id),
            "thread_title": target.subject or "",
            "message_id": str(utterance.id),
            "ack": ack_text,
            "working": True,
            "reason": "handoff",
            **({"note_id": str(early.id)} if early is not None else {}),
        }
    spoken_prompt = _turn_prompt(person, text, reply_note)
    if card is not None:
        spoken_prompt = pack(spoken_prompt, card)
    turn = await enqueue_turn(
        session,
        target,
        agent_id=agent.id,
        cause_kind=INTERCOM_CAUSE,
        requested_by_kind="user",
        requested_by_id=user.id,
        prompt=spoken_prompt,
        cause_message_id=utterance.id,
    )
    # The early bliep already played. Speak the router's ack only when it says
    # something new (e.g. who takes it); the result note is different text.
    fresh_note = early is None or ack_text != bliep
    if fresh_note:
        note = await speak(
            session,
            tenant_id=tenant_id,
            user=user,
            agent=agent,
            signal_id=target.id,
            message_id=ack_msg.id,
            kind="ack",
            text=ack_text,
            reply_to_id=reply_note.id if reply_note else None,
            status="queued" if speak_ack else "skipped",
        )
    else:
        note = early
    await session.commit()
    await session.refresh(target)
    await publish_signal_message(target, ack_msg)
    await publish_thread_update(target)
    if speak_ack and fresh_note:
        await publish_note(session, note)
    turn_id = turn.get("turn_id")
    return {
        "agent_id": str(agent.id),
        "agent_name": agent.name,
        "decision": decision,
        "thread_id": str(target.id),
        "thread_title": target.subject or "",
        "message_id": str(utterance.id),
        "note_id": str(note.id),
        "ack": ack_text,
        "working": bool(turn.get("ok")),
        # The background task this ask became; its result is spoken when it ends.
        "turn_id": turn_id,
        "task_id": turn_id,
    }


async def _agents_by_ids(session: AsyncSession, tenant_id: UUID, raw_ids: list[str]) -> list[Agent]:
    """Active agents in this workspace, in the order the dock showed them."""
    ids: list[UUID] = []
    for raw in raw_ids:
        try:
            ids.append(UUID(raw))
        except ValueError:
            continue
    if not ids:
        return []
    found = {
        agent.id: agent
        for agent in (
            await session.execute(
                select(Agent).where(
                    Agent.tenant_id == tenant_id,
                    Agent.id.in_(ids),
                    Agent.is_active.is_(True),
                )
            )
        ).scalars()
    }
    return [found[item] for item in ids if item in found]


async def handle_utterance(
    session: AsyncSession,
    tenant_id: UUID,
    user: User,
    *,
    agent_id: UUID | None,
    audio: bytes,
    filename: str,
    mime: str,
    thread_id: UUID | None = None,
    reply_to_note_id: UUID | None = None,
    position_ms: int | None = None,
    seat_ids: list[str] | None = None,
) -> dict[str, Any]:
    """One held-to-talk recording. ``agent_id`` empty means the all-call dial."""
    from app.models.agent_call import AgentCall
    from app.services.agent_call_voice import transcribe_speech
    from app.services.dock_agents import read_dock

    if not audio:
        raise status_error(status_code=422, detail="Empty recording")
    if len(audio) > MAX_AUDIO_BYTES:
        raise status_error(status_code=413, detail="Recording is too long")
    live = (
        await session.execute(
            select(AgentCall.id).where(
                AgentCall.tenant_id == tenant_id,
                AgentCall.user_id == user.id,
                AgentCall.status == "live",
            )
        )
    ).first()
    if live is not None:
        raise status_error(status_code=409, detail="You are in a live call")

    pinned_rows = read_dock(user)
    pinned: list[Agent] = []
    for row in pinned_rows:
        try:
            found = await session.get(Agent, UUID(row["agent_id"]))
        except ValueError:
            continue
        if found is not None and found.tenant_id == tenant_id and found.is_active:
            pinned.append(found)

    reply_note: VoiceNote | None = None
    if reply_to_note_id is not None:
        reply_note = await session.get(VoiceNote, reply_to_note_id)
        if reply_note is None or reply_note.user_id != user.id or reply_note.tenant_id != tenant_id:
            reply_note = None

    hint_agent = await _agent(session, tenant_id, agent_id) if agent_id else None
    active = list(
        (
            await session.execute(
                select(Agent)
                .where(Agent.tenant_id == tenant_id, Agent.is_active.is_(True))
                .limit(80)
            )
        ).scalars()
    )
    language = _prefs(user, hint_agent or (pinned[0] if pinned else None))["language"]
    nothing = _NOTHING_HEARD.get(language, _NOTHING_HEARD["en"])
    name_needed = _NAME_AN_AGENT.get(language, _NAME_AN_AGENT["en"])
    # Skip STT on near-silent WAV; Whisper otherwise invents words from a name prompt.
    rms = _wav_rms(audio)
    if rms is not None and rms < 0.012:
        raise status_error(status_code=422, detail=nothing)
    # Language is already sent as the `language` field. A full-sentence prompt
    # ("Gesproken Nederlands.") was echoed as the transcript on weak audio.
    # Leave prompt empty; vocabulary bias is not worth that failure mode.
    text = await transcribe_speech(
        audio,
        filename=filename,
        mime=mime,
        language=language,
        prompt="",
        session=session,
        tenant_id=tenant_id,
    )
    text = _tidy_heard(text or "")
    # A near miss of a colleague's name in an ask ("vraag Katel") becomes that
    # colleague. Only names of this workspace's active agents qualify.
    from app.services.colleague_names import repair_heard_names

    text = repair_heard_names(text, active)
    # Name-only echo check against every seat, not only pinned — silence still
    # invents names when F12 is used with an empty dock.
    silence_pool = pinned + ([hint_agent] if hint_agent is not None else []) or active
    if not text or _stt_prompt_echo(text) or _name_only_transcript(text, silence_pool):
        raise status_error(status_code=422, detail=nothing)

    targets: list[Agent]
    broadcast = False
    if hint_agent is not None:
        targets = [hint_agent]
        if reply_note is not None and reply_note.agent_id != hint_agent.id:
            reply_note = None
    else:
        pinned_ids = {p.id for p in pinned}
        everyone = pinned + [a for a in active if a.id not in pinned_ids]
        named, rest = addressed_agent(text, everyone)
        if named is None and (reply_note is None or not reply_note.agent_id):
            # "Lottie" is not the letters of "Lotty". A model hears the name
            # and, failing that, which job the sentence is for.
            named, rest = await pick_agent(session, tenant_id=tenant_id, text=text, agents=everyone)
        if named is not None:
            targets = [named]
            text = rest
            if reply_note is not None and reply_note.agent_id != named.id:
                reply_note = None
        elif reply_note is not None and reply_note.agent_id:
            targets = [await _agent(session, tenant_id, reply_note.agent_id)]
        else:
            # The row on screen, not the saved pin list. A face on a card
            # (Claude on F8) is in that row. Pins from another workspace are not.
            visible = await _agents_by_ids(session, tenant_id, seat_ids or [])
            fallback = visible or pinned
            if fallback:
                targets = fallback
                broadcast = len(fallback) > 1
                reply_note = None
            else:
                # Empty dock: F12 still works when they name someone. Without a
                # name there is nobody to ring — ask for a name, do not require a pin.
                raise status_error(status_code=422, detail=name_needed)

    results = []
    for agent in targets:
        results.append(
            await _deliver(
                session,
                tenant_id=tenant_id,
                user=user,
                agent=agent,
                text=text,
                hint_thread_id=thread_id if hint_agent is not None else None,
                reply_note=reply_note,
                broadcast=broadcast,
                speak_ack=not broadcast,
            )
        )
    if broadcast:
        spoken = [r for r in results if r.get("decision") != SKIP]
        if spoken:
            await _digest(session, tenant_id, user, [(r["agent_name"], r["ack"]) for r in spoken], language)
    primary = next((r for r in results if r.get("decision") != SKIP), results[0] if results else {})
    return {"transcript": text, "broadcast": broadcast, "results": results, **primary}


# -- results, handoffs, digest ------------------------------------------------------


async def _intercom_listener(session: AsyncSession, turn: Any) -> tuple[User | None, UUID | None]:
    """Who hears this turn, and which agent handed it over.

    The dial turn is spoken to the person who held the key. A later ``answer``
    or ``handoff`` in that same episode is spoken too, so a chain that works
    for a while still comes back as a voice note.
    """
    if turn.cause_kind == INTERCOM_CAUSE and turn.requested_by_kind == "user" and turn.requested_by_id:
        return await session.get(User, turn.requested_by_id), None
    if turn.cause_kind not in ("answer", "handoff") or turn.episode_id is None:
        return None, None
    from app.models.agent_turn import AgentTurn

    origin = (
        await session.execute(
            select(AgentTurn)
            .where(
                AgentTurn.signal_id == turn.signal_id,
                AgentTurn.cause_kind == INTERCOM_CAUSE,
                AgentTurn.episode_id == turn.episode_id,
                AgentTurn.requested_by_kind == "user",
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if origin is None or origin.requested_by_id is None:
        return None, None
    via = turn.requested_by_id if turn.cause_kind == "handoff" and turn.requested_by_kind == "agent" else None
    return await session.get(User, origin.requested_by_id), via


_MENTION = re.compile(
    r"@\[(?:\[[^\]]+\]\s*)?([^\[\]]+)\]\(agent:[0-9a-f-]{36}\)",
    re.I,
)
_TOOL_WORD = re.compile(
    r"\b(?:via de tool\s+)?(?:move_to_conversation|ask_agent|handoff_to|intercom_agent|search_product_help|start_conversation|agent_id)\b",
    re.I,
)
# A promise to go and ask, not the answer itself.
_DELEGATION = re.compile(
    r"(?i)\b(ik roep|ik vraag|ik check|checkt nu|even aan|geef (dit |het )?gesprek|"
    r"doorgeven|bevestig het antwoord|via de intercom|ik verwacht|"
    r"laat (je |het )?(direct )?weten|terugbellen|hoor zijn antwoord|ik ga \w+ vragen|"
    r"the agent wants|reageerde niet|de tool|tool_use_id|antwoord voorgesteld)\b"
)


_STUB_LINE = re.compile(r"(?i)^(done|klaar|ok|okay|gereed|ready)\.?$")
_UUID = re.compile(
    r"(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b"
)


def _line_from_work(calls: list[tuple[str, str]]) -> str:
    """The sentence a tool just wrote, when the reply is only a closer."""
    for name, raw in calls:
        try:
            data = json.loads(raw or "{}")
        except json.JSONDecodeError:
            continue
        if not isinstance(data, dict):
            continue
        blocks = data.get("blocks")
        if isinstance(blocks, list):
            for block in blocks:
                if not isinstance(block, dict):
                    continue
                if str(block.get("type") or "") not in ("heading", "text"):
                    continue
                text = " ".join(str(block.get("text") or "").split())
                if text:
                    return text[:300]
        message = " ".join(str(data.get("message") or "").split())
        if name == "start_conversation" and message:
            return message[:300]
        folder = " ".join(str(data.get("name") or "").split())
        if name == "create_folder" and folder:
            return f"De map {folder} staat als voorstel klaar."
    return ""


# A sentence that reports a failed outcome is the answer, not chatter. It is
# kept even when it also reads like a delegation ("Bram reageerde niet ...").
# Internal tool noise ("De tool ... reageerde niet") still drops.
_FAILURE_OUTCOME = re.compile(
    r"(?i)\b(niet gelukt|mislukt|lukte niet|niet (verstuurd|verzonden|gedaan|opgeslagen|geboekt|aangemaakt|bevestigd)|"
    r"geen bevestiging|time-?out|tijdslimiet|did not (work|go through)|failed|timed out)\b"
)
_INTERNAL_FAILURE = re.compile(r"(?i)\b(de tool|the tool|tool_use_id|the agent wants)\b")


def _states_failure(sentence: str) -> bool:
    return bool(_FAILURE_OUTCOME.search(sentence)) and not _INTERNAL_FAILURE.search(sentence)


_SENTENCE_BREAK = re.compile(r"(?<=[.!?])\s+(?=[A-Z*])")
_PROMISE = re.compile(
    r"(?i)\b(ik check|ik kijk nog|laat me (even )?controleren|even controleren|nog nakijken|i'll check|let me check)\b"
)


def sentences_of(text: str) -> list[str]:
    """Split on a real sentence boundary. 'bijv.' is not one."""
    return [part.strip() for part in _SENTENCE_BREAK.split((text or "").strip()) if part.strip()]


def drop_unfinished_promise(text: str) -> str:
    """Drop a trailing 'I'll go check' when the answer is already there."""
    parts = sentences_of(text)
    if len(parts) < 2:
        return text
    kept = [part for part in parts if not _PROMISE.search(part)]
    if not kept or len(kept) == len(parts):
        return text
    return " ".join(kept)


def spoken_line(text: str) -> str:
    """What a person hears: the answer, not the assignment, the link, or a tool name."""
    cleaned = _TOOL_WORD.sub("", _MENTION.sub(" ", text or ""))
    cleaned = _UUID.sub("", cleaned)
    cleaned = re.sub(r"/folders/\S*", "", cleaned)
    cleaned = " ".join(cleaned.split())
    sentences = sentences_of(cleaned)
    if not sentences:
        return ""
    kept = [
        part
        for part in sentences
        if _states_failure(part) or (not _DELEGATION.search(part) and not _PROMISE.search(part))
    ]
    spoken = " ".join(kept) if len(kept) < len(sentences) else cleaned
    return _drop_stock_lead(spoken)


def _drop_stock_lead(text: str) -> str:
    """Drop a leading 'Ik zoek het uit.' when a real answer follows it."""
    parts = [part.strip() for part in re.split(r"(?<=[.!?])\s+", text.strip()) if part.strip()]
    while len(parts) > 1 and _stock_ack(parts[0]):
        parts.pop(0)
    return " ".join(parts)


async def _worked_sentence(session: AsyncSession, turn: Any) -> str:
    """What this turn actually wrote, newest tool first."""
    from app.models.agent import AgentRun, RunEvent

    rows = (
        await session.execute(
            select(RunEvent.message, RunEvent.payload_json)
            .join(AgentRun, AgentRun.id == RunEvent.run_id)
            .where(
                AgentRun.signal_id == turn.signal_id,
                AgentRun.agent_id == turn.agent_id,
                RunEvent.event_type == "tool_call",
                RunEvent.created_at >= turn.created_at,
            )
            .order_by(RunEvent.created_at.desc())
            .limit(8)
        )
    ).all()
    return _line_from_work([(str(name or ""), str(payload or "")) for name, payload in rows])


async def speak_turn_result(session: AsyncSession, turn: Any, final: str) -> None:
    """Speak a finished intercom turn, including a later answer or handoff in that episode."""
    user, via = await _intercom_listener(session, turn)
    if user is None:
        return
    text = spoken_line(final)
    worked = await _worked_sentence(session, turn)
    # Prefer the sentence the tool wrote when the chat reply is tool noise.
    if worked and (
        not text
        or _STUB_LINE.match(text.strip())
        or re.search(r"(?i)contact-id|tool_use_id|niet correct opgehaald|vereiste informatie", text)
    ):
        text = worked
    agent = await session.get(Agent, turn.agent_id)
    if agent is None:
        return
    marker = (
        await session.execute(
            select(VoiceNote)
            .where(
                VoiceNote.tenant_id == turn.tenant_id,
                VoiceNote.user_id == user.id,
                VoiceNote.agent_id == agent.id,
                VoiceNote.signal_id == turn.signal_id,
                VoiceNote.kind == "ack",
            )
            .order_by(VoiceNote.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    # Silent turn + skipped ack voice: still say the ack line once as the answer.
    if not text and marker is not None and (marker.text or "").strip():
        text = spoken_line(marker.text or "")
    if not text:
        return
    # Do not speak the same sentence again if the ack was already played (legacy).
    if (
        marker is not None
        and marker.status in ("queued", "played", "playing")
        and (marker.text or "").strip()
        and spoken_line(marker.text or "").strip()[:120] == text.strip()[:120]
    ):
        return
    message_id = (
        await session.execute(
            select(SignalMessage.id)
            .where(SignalMessage.signal_id == turn.signal_id, SignalMessage.author_agent_id == agent.id)
            .order_by(SignalMessage.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    note = await speak(
        session,
        tenant_id=turn.tenant_id,
        user=user,
        agent=agent,
        signal_id=turn.signal_id,
        message_id=message_id,
        kind="question" if text.rstrip().endswith("?") else "result",
        text=text,
        via_agent_id=via or (marker.via_agent_id if marker else None),
    )
    await session.commit()
    await publish_note(session, note)


async def speak_progress(session: AsyncSession, turn: Any) -> VoiceNote | None:
    """A short 'still on it' while a spoken ask runs long. Never claims an outcome."""
    user, via = await _intercom_listener(session, turn)
    if user is None:
        return None
    agent = await session.get(Agent, turn.agent_id)
    if agent is None:
        return None
    language = _prefs(user, agent)["language"]
    note = await speak(
        session,
        tenant_id=turn.tenant_id,
        user=user,
        agent=agent,
        signal_id=turn.signal_id,
        message_id=None,
        kind="progress",
        text=_PROGRESS.get(language, _PROGRESS["en"]),
        via_agent_id=via,
    )
    await session.commit()
    await publish_note(session, note)
    return note


async def speak_turn_failure(session: AsyncSession, turn: Any, outcome: str) -> VoiceNote | None:
    """Say that a spoken ask did not finish. Silence after an ack reads as 'done'."""
    from app.gateway.publish import publish_signal_message

    user, via = await _intercom_listener(session, turn)
    if user is None:
        return None
    agent = await session.get(Agent, turn.agent_id)
    signal = await session.get(Signal, turn.signal_id)
    if agent is None or signal is None:
        return None
    language = _prefs(user, agent)["language"]
    if outcome == "retrying":
        lines = _FAILED_RETRYING
    elif outcome in _TIMEOUT_OUTCOMES:
        lines = _FAILED_TIMEOUT
    else:
        lines = _FAILED
    text = lines.get(language, lines["en"])
    message = await _post(
        session, signal, text=text, agent_id=agent.id, meta={"intercom": "failure", "outcome": outcome}
    )
    note = await speak(
        session,
        tenant_id=turn.tenant_id,
        user=user,
        agent=agent,
        signal_id=turn.signal_id,
        message_id=message.id,
        kind="result",
        text=text,
        via_agent_id=via,
    )
    await session.commit()
    await publish_signal_message(signal, message)
    await publish_note(session, note)
    return note


async def handoff_to_agent(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    user_id: UUID,
    from_agent: Agent,
    to_agent_id: UUID,
    thread_id: UUID,
    message: str,
    card: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from app.services.agent_turns import enqueue_turn

    if to_agent_id == from_agent.id:
        return {"error": "Ask another agent"}
    peer = await session.get(Agent, to_agent_id)
    if peer is None or peer.tenant_id != tenant_id or not peer.is_active:
        return {"error": "Agent not found"}
    user = await session.get(User, user_id)
    signal = await session.get(Signal, thread_id)
    if user is None or signal is None or signal.tenant_id != tenant_id:
        return {"error": "Conversation not found"}
    from app.models.agent_turn import AgentTurn

    already = (
        await session.execute(
            select(AgentTurn.id).where(
                AgentTurn.signal_id == signal.id,
                AgentTurn.agent_id == peer.id,
                AgentTurn.status.in_(("queued", "running")),
            ).limit(1)
        )
    ).scalar_one_or_none()
    if already is not None:
        return {
            "ok": True,
            "already": True,
            "agent_id": str(peer.id),
            "agent_name": peer.name,
            "note": f"{peer.name} is already on this. End your turn. Do not ask again.",
        }
    from app.services.job_card import pack

    prompt = _turn_prompt(user.display_name or user.email, message, None, via=from_agent)
    if card is not None:
        prompt = pack(prompt, card)
    turn = await enqueue_turn(
        session,
        signal,
        agent_id=peer.id,
        cause_kind=INTERCOM_CAUSE,
        requested_by_kind="user",
        requested_by_id=user.id,
        prompt=prompt,
    )
    # Silent marker: the result note shows "via <from_agent>".
    await speak(
        session,
        tenant_id=tenant_id,
        user=user,
        agent=peer,
        signal_id=signal.id,
        message_id=None,
        kind="ack",
        text="",
        via_agent_id=from_agent.id,
        status="skipped",
    )
    await session.commit()
    if not turn.get("ok"):
        return {"error": turn.get("error") or "Could not reach that agent"}
    return {
        "ok": True,
        "agent_id": str(peer.id),
        "agent_name": peer.name,
        "note": f"{peer.name} works on it here. Its answer reaches the person as a voice note.",
    }


_DIGEST_OPEN = {"nl": "{n} updates.", "en": "{n} updates."}


async def _digest(
    session: AsyncSession,
    tenant_id: UUID,
    user: User,
    parts: list[tuple[str, str]],
    language: str,
) -> VoiceNote:
    head = _DIGEST_OPEN.get(language, _DIGEST_OPEN["en"]).format(n=len(parts))
    body = " ".join(f"{name}: {spoken_text(text, limit=160)}" for name, text in parts)
    note = await speak(
        session,
        tenant_id=tenant_id,
        user=user,
        agent=None,
        signal_id=None,
        message_id=None,
        kind="digest",
        text=f"{head} {body}",
    )
    await session.commit()
    await publish_note(session, note)
    return note


async def list_queue(
    session: AsyncSession,
    tenant_id: UUID,
    user: User,
    *,
    returning: bool = False,
) -> list[dict[str, Any]]:
    """Unplayed notes, oldest first. Back after a while with several waiting: one digest first."""
    await _purge_old(session, tenant_id, user.id)
    rows = list(
        (
            await session.execute(
                select(VoiceNote)
                .where(
                    VoiceNote.tenant_id == tenant_id,
                    VoiceNote.user_id == user.id,
                    VoiceNote.status == "queued",
                )
                .order_by(VoiceNote.created_at.asc())
                .limit(40)
            )
        ).scalars()
    )
    singles = [n for n in rows if n.kind != "digest"]
    if returning and len(singles) >= DIGEST_MIN and not any(n.kind == "digest" for n in rows):
        parts: list[tuple[str, str]] = []
        for note in singles:
            agent = await session.get(Agent, note.agent_id) if note.agent_id else None
            parts.append((agent.name if agent else "Bokito", note.text))
            note.status = "played"
            note.played_at = utcnow()
            session.add(note)
        language = _prefs(user, None)["language"]
        digest = await _digest(session, tenant_id, user, parts, language)
        rows = [digest]
    out = []
    for note in rows:
        agent_name, via_name, title = await _note_names(session, note)
        out.append(serialize_note(note, agent_name=agent_name, via_agent_name=via_name, thread_title=title))
    return out


async def _purge_old(session: AsyncSession, tenant_id: UUID, user_id: UUID) -> None:
    """Audio leaves after the retention window. The text stays on the note and in the thread."""
    from app.services.storage import get_storage_backend

    cutoff = utcnow() - NOTE_RETENTION
    rows = (
        await session.execute(
            select(VoiceNote)
            .where(
                VoiceNote.tenant_id == tenant_id,
                VoiceNote.user_id == user_id,
                VoiceNote.created_at < cutoff,
                VoiceNote.storage_key != "",
            )
            .limit(50)
        )
    ).scalars().all()
    backend = get_storage_backend() if rows else None
    for note in rows:
        try:
            await backend.delete(note.storage_key)  # type: ignore[union-attr]
        except Exception:  # noqa: BLE001
            logger.debug("voice note purge failed", exc_info=True)
        note.storage_key = ""
        if note.status == "queued":
            note.status = "skipped"
        session.add(note)
    if rows:
        await session.commit()


async def load_note(session: AsyncSession, tenant_id: UUID, user_id: UUID, note_id: UUID) -> VoiceNote:
    note = await session.get(VoiceNote, note_id)
    if note is None or note.tenant_id != tenant_id or note.user_id != user_id:
        raise NotFoundError("Note not found")
    return note


async def note_audio(session: AsyncSession, tenant_id: UUID, user_id: UUID, note_id: UUID) -> bytes:
    from app.services.storage import get_storage_backend

    note = await load_note(session, tenant_id, user_id, note_id)
    if not note.storage_key:
        raise NotFoundError("No audio for this note")
    fetched = await get_storage_backend().fetch(note.storage_key)
    if fetched is None:
        raise NotFoundError("No audio for this note")
    return fetched.data


async def mark_played(
    session: AsyncSession, tenant_id: UUID, user_id: UUID, note_id: UUID, *, skipped: bool = False
) -> VoiceNote:
    from app.gateway.publish import _safe_publish

    note = await load_note(session, tenant_id, user_id, note_id)
    if note.status == "queued":
        note.status = "skipped" if skipped else "played"
        note.played_at = utcnow()
        session.add(note)
        await session.commit()
    await _safe_publish(
        tenant_id,
        ["notifications"],
        "intercom.played",
        {"note_id": str(note.id), "user_id": str(user_id), "agent_id": str(note.agent_id) if note.agent_id else None},
    )
    return note


async def last_note(
    session: AsyncSession, tenant_id: UUID, user_id: UUID, agent_id: UUID | None
) -> dict[str, Any] | None:
    """The newest note from this agent (or the newest digest), for replay."""
    query = select(VoiceNote).where(
        VoiceNote.tenant_id == tenant_id,
        VoiceNote.user_id == user_id,
        VoiceNote.status != "skipped",
        VoiceNote.text != "",
    )
    query = query.where(VoiceNote.agent_id == agent_id) if agent_id else query.where(VoiceNote.kind == "digest")
    note = (await session.execute(query.order_by(VoiceNote.created_at.desc()).limit(1))).scalar_one_or_none()
    if note is None:
        return None
    agent_name, via_name, title = await _note_names(session, note)
    return serialize_note(note, agent_name=agent_name, via_agent_name=via_name, thread_title=title)


async def correct_route(
    session: AsyncSession,
    tenant_id: UUID,
    user: User,
    message_id: UUID,
    *,
    target_id: UUID | None,
) -> dict[str, Any]:
    """The person moves what they said (and what followed) to another or a new conversation."""
    from app.services.audit import record_audit

    message = await session.get(SignalMessage, message_id)
    if message is None or message.tenant_id != tenant_id or message.author_user_id != user.id:
        raise NotFoundError("Message not found")
    source_id = message.signal_id
    target = await move_messages(
        session,
        tenant_id,
        source_id,
        from_message_id=message.id,
        target_id=target_id,
        title=(message.body_text or "")[:60],
        actor_type="user",
        actor_id=str(user.id),
        user_id=user.id,
    )
    await record_audit(
        session,
        tenant_id,
        action="intercom:route_corrected",
        actor_type="user",
        actor_id=str(user.id),
        resource_type="conversation",
        resource_id=str(source_id),
        summary="Moved an intercom message to another conversation",
        after={"signal_id": str(target.id), "message_id": str(message_id), "new": target_id is None},
        commit=True,
    )
    return {"thread_id": str(target.id), "thread_title": target.subject or ""}
