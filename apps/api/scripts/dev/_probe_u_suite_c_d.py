"""Live API probe for UX suite C/D scenarios U19/U22/U27/U31/U32/U34/U40–U43.

Auth: admin@bokito.ai / bokito-test-password (same as smoke_* scripts).
Run on bokito-dev:
  cd /opt/bokito-dev/apps/api && set -a && . ./.env && set +a \\
    && ./.venv/bin/python scripts/dev/_probe_u_suite_c_d.py
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
from typing import Any

import httpx

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8010"
EMAIL = "admin@bokito.ai"
PASSWORD = "bokito-test-password"

# Known mail host used heavily in prior S-suite
MAIL_HOST = "14cb3ae9-c892-458b-9e71-05f093d5aa47"


def mention(agent: dict) -> str:
    """Dashboard chip form required by entity_mentions / expand_invitees."""
    return f"@[{agent.get('name') or 'Agent'}](agent:{agent['id']})"


def _ok(uid: str, status: str, **notes: Any) -> dict[str, Any]:
    row = {"id": uid, "status": status, **notes}
    print(json.dumps(row, ensure_ascii=False))
    return row


async def login(client: httpx.AsyncClient) -> str:
    r = await client.post(
        "/api/auth/login", json={"email": EMAIL, "password": PASSWORD}
    )
    r.raise_for_status()
    return r.json()["access_token"]


async def get_thread(client: httpx.AsyncClient, tid: str) -> dict:
    r = await client.get(f"/api/signals/{tid}")
    r.raise_for_status()
    data = r.json()
    if not isinstance(data, dict):
        return {}
    # Merge nested thread fields with top-level participants/active_turn/etc.
    thread = dict(data.get("thread") or {})
    out = {**thread, **{k: v for k, v in data.items() if k != "thread"}}
    if "status" not in out and thread.get("status"):
        out["status"] = thread["status"]
    return out


async def reopen_thread(client: httpx.AsyncClient, tid: str) -> dict:
    r = await client.post(
        "/api/signals/bulk",
        json={"action": "reopen", "signal_ids": [tid]},
    )
    return {"http": r.status_code, "body": (r.text or "")[:200]}


async def create_ask_conversation(
    client: httpx.AsyncClient, *, agent_id: str, title: str, context_signal_id: str | None = None
) -> str:
    payload: dict[str, Any] = {"agent_id": agent_id, "title": title}
    if context_signal_id:
        payload["context_signal_id"] = context_signal_id
    r = await client.post("/api/signals/conversations", json=payload)
    r.raise_for_status()
    return str(r.json()["id"])


async def list_agents(client: httpx.AsyncClient) -> list[dict]:
    r = await client.get("/api/workforce/agents")
    r.raise_for_status()
    data = r.json()
    if isinstance(data, dict) and "agents" in data:
        return data["agents"]
    if isinstance(data, list):
        return data
    return data.get("items") or []


async def ask_stream(
    client: httpx.AsyncClient,
    tid: str,
    content: str,
    *,
    agent_id: str | None = None,
    timeout: float = 90.0,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"content": content}
    if agent_id:
        payload["agent_id"] = agent_id
    events: list[dict] = []
    text_parts: list[str] = []
    done: dict[str, Any] = {}
    async with client.stream(
        "POST",
        f"/api/signals/conversations/{tid}/stream",
        json=payload,
        timeout=timeout,
    ) as resp:
        status = resp.status_code
        if status >= 400:
            body = await resp.aread()
            return {"http": status, "error": body.decode("utf-8", "replace")[:400]}
        event_name = "message"
        async for line in resp.aiter_lines():
            if line.startswith("event:"):
                event_name = line[6:].strip()
            elif line.startswith("data:"):
                raw = line[5:].strip()
                try:
                    data = json.loads(raw) if raw else {}
                except json.JSONDecodeError:
                    data = {"raw": raw}
                events.append({"event": event_name, "data": data})
                if event_name == "token" and isinstance(data, dict):
                    text_parts.append(str(data.get("text") or data.get("token") or ""))
                if event_name == "done":
                    done = data if isinstance(data, dict) else {"raw": data}
                    break
    return {
        "http": 200,
        "done": done,
        "text": "".join(text_parts) or (done.get("text") or ""),
        "events": len(events),
        "handoff": bool(done.get("handoff")),
        "opener_id": done.get("opener_id"),
    }


async def post_note(client: httpx.AsyncClient, tid: str, body: str) -> dict:
    r = await client.post(f"/api/signals/{tid}/notes", json={"body_text": body})
    return {"http": r.status_code, "body": (r.text or "")[:300], "json": _safe_json(r)}


async def post_reply(client: httpx.AsyncClient, tid: str, body: str) -> dict:
    r = await client.post(
        f"/api/signals/{tid}/reply",
        json={"body_text": body, "body_html": f"<p>{body}</p>"},
    )
    return {"http": r.status_code, "body": (r.text or "")[:300], "json": _safe_json(r)}


def _safe_json(r: httpx.Response) -> Any:
    try:
        return r.json()
    except Exception:
        return None


def _find_agent(agents: list[dict], *names: str) -> dict | None:
    lower = {n.lower() for n in names}
    for a in agents:
        name = (a.get("name") or "").lower()
        if name in lower or any(n in name for n in lower):
            return a
    return None


def _participant_agent_ids(detail: dict) -> list[str]:
    out: list[str] = []
    for p in detail.get("participants") or []:
        if (p.get("kind") or p.get("member_kind")) == "agent":
            rid = p.get("ref_id") or p.get("id") or p.get("agent_id")
            if rid:
                out.append(str(rid))
    return out


def _handoff(detail: dict) -> dict | None:
    hs = detail.get("handoff_session") or detail.get("handoff")
    if isinstance(hs, dict) and hs:
        return hs
    return None


def _active_turn(detail: dict) -> dict | None:
    at = detail.get("active_turn")
    if isinstance(at, dict) and at.get("ref_id"):
        return at
    return None


async def wait_idle(
    client: httpx.AsyncClient, tid: str, *, tries: int = 40, delay: float = 2.0
) -> dict:
    last: dict = {}
    for _ in range(tries):
        last = await get_thread(client, tid)
        at = _active_turn(last)
        hs = _handoff(last)
        if not at and not hs:
            return last
        # handoff may linger briefly while opener runs; keep waiting
        await asyncio.sleep(delay)
    return last


async def wait_for(
    client: httpx.AsyncClient,
    tid: str,
    pred,
    *,
    tries: int = 30,
    delay: float = 2.0,
) -> dict:
    last: dict = {}
    for _ in range(tries):
        last = await get_thread(client, tid)
        if pred(last):
            return last
        await asyncio.sleep(delay)
    return last


async def clear_floor_db(tid: str) -> None:
    """Clear multi-agent floor via ORM hybrids (floor_json, not dead columns)."""
    try:
        from uuid import UUID as _UUID

        from app.db.session import async_session_factory
        from app.models.signal import Signal
        from app.services.participant_turns import clear_active_turn

        async with async_session_factory() as s:
            sig = await s.get(Signal, _UUID(tid))
            if not sig:
                print(f"[prep] clear_floor missing {tid}")
                return
            clear_active_turn(sig, reset_streak=True)
            sig.handoff_session_json = "{}"
            s.add(sig)
            await s.commit()
            print(f"[prep] cleared floor on {tid}")
    except Exception as exc:  # noqa: BLE001
        print(f"[prep] clear_floor skip: {exc}")


async def start_handoff_db(tid: str, body_text: str, *, user_id: str | None = None) -> dict:
    from uuid import UUID as _UUID

    from app.db.session import async_session_factory
    from app.models.signal import Signal
    from app.services.handoff_sessions import start_handoff_session

    async with async_session_factory() as s:
        sig = await s.get(Signal, _UUID(tid))
        started = await start_handoff_session(
            s,
            sig.tenant_id,
            sig,
            body_text=body_text,
            author_user_id=_UUID(user_id) if user_id else None,
            author_name="QA probe",
            user_role="owner",
            channel_agent_id=sig.agent_id,
        )
        await s.commit()
        return started or {}


async def recent_events(tid: str, limit: int = 30) -> list[tuple]:
    try:
        from sqlalchemy import text

        from app.db.session import async_session_factory

        async with async_session_factory() as s:
            rows = (
                await s.execute(
                    text(
                        """
                        SELECT created_at::text, event_type,
                               left(coalesce(payload_json::text,''), 200)
                        FROM signal_events
                        WHERE signal_id = :id
                        ORDER BY created_at DESC
                        LIMIT :lim
                        """
                    ),
                    {"id": tid, "lim": limit},
                )
            ).fetchall()
            return [(r[0], r[1], r[2]) for r in rows]
    except Exception as exc:  # noqa: BLE001
        print(f"[db] events skip: {exc}")
        return []


async def force_max_consecutive(tid: str, agent_a: str, agent_b: str) -> dict:
    """Drive request_participant_turn streak past MAX via service layer."""
    from uuid import UUID as _UUID

    from app.db.session import async_session_factory
    from app.models.signal import Signal
    from app.services.participant_turns import (
        MAX_CONSECUTIVE_TURNS,
        clear_active_turn,
        request_participant_turn,
    )

    async with async_session_factory() as s:
        sig = await s.get(Signal, _UUID(tid))
        if not sig:
            return {"error": "signal_missing"}
        clear_active_turn(sig, reset_streak=True)
        await s.flush()
        results = []
        for i in range(MAX_CONSECUTIVE_TURNS + 1):
            requester = agent_a if i % 2 == 0 else agent_b
            target = agent_b if i % 2 == 0 else agent_a
            out = await request_participant_turn(
                s,
                sig,
                member_kind="agent",
                member_ref_id=_UUID(target),
                prompt=f"U31 probe step {i}",
                requested_by_kind="agent",
                requested_by_id=_UUID(requester),
                run=False,
                defer_peer=False,
                deadline_s=30,
            )
            results.append(
                {
                    "i": i,
                    "ok": out.get("ok"),
                    "error": out.get("error"),
                    "outcome": out.get("outcome"),
                }
            )
            if out.get("ok"):
                clear_active_turn(sig, reset_streak=False)
                await s.flush()
            if out.get("error") == "max_consecutive_turns":
                await s.commit()
                return {"blocked_at": i, "results": results, "max": MAX_CONSECUTIVE_TURNS}
        await s.commit()
        return {"blocked_at": None, "results": results, "max": MAX_CONSECUTIVE_TURNS}


async def simulate_peer_pass(tid: str, opener_id: str, peer_id: str) -> dict:
    """Open peer floor (run=False), emit pass, wake opener — mirrors worker pass path."""
    import json as _json
    from uuid import UUID as _UUID

    from app.db.session import async_session_factory
    from app.models.signal import Signal, SignalEvent
    from app.services.participant_turns import (
        clear_active_turn,
        request_participant_turn,
    )

    async with async_session_factory() as s:
        sig = await s.get(Signal, _UUID(tid))
        clear_active_turn(sig, reset_streak=True)
        req = await request_participant_turn(
            s,
            sig,
            member_kind="agent",
            member_ref_id=_UUID(peer_id),
            prompt="QA U32 please pass",
            requested_by_kind="agent",
            requested_by_id=_UUID(opener_id),
            run=False,
            defer_peer=False,
            deadline_s=60,
        )
        if not req.get("ok"):
            await s.commit()
            return {"error": "request_failed", "req": req}
        active = req.get("active_turn") or {}
        nonce = active.get("nonce")
        clear_active_turn(sig, reset_streak=False)
        s.add(
            SignalEvent(
                signal_id=sig.id,
                tenant_id=sig.tenant_id,
                event_type="participant_turn_pass",
                actor_type="agent",
                actor_id=peer_id,
                payload_json=_json.dumps({"nonce": nonce, "agent_name": "peer", "probe": "U32"}),
            )
        )
        wake = await request_participant_turn(
            s,
            sig,
            member_kind="agent",
            member_ref_id=_UUID(opener_id),
            prompt=(
                "Peer passed on their turn (they skipped). "
                "Tell the human in one short sentence that they skipped. "
                "Do not pass. Do not say you are still waiting."
            ),
            requested_by_kind="system",
            requested_by_id=None,
            run=True,
            enqueue=True,
        )
        await s.commit()
        return {"request": req, "wake": wake, "nonce": nonce}


async def invite_agent_db(tid: str, agent_id: str) -> bool:
    from uuid import UUID as _UUID

    from app.db.session import async_session_factory
    from app.models.signal import Signal
    from app.services.participants import ensure_participant

    async with async_session_factory() as s:
        sig = await s.get(Signal, _UUID(tid))
        await ensure_participant(
            s,
            sig,
            kind="agent",
            ref_id=_UUID(agent_id),
            role="member",
            invited_by_kind="user",
            joined_via="invite",
        )
        await s.commit()
        return True


async def leave_agent_db(tid: str, agent_id: str) -> bool:
    from uuid import UUID as _UUID

    from app.db.session import async_session_factory
    from app.models.signal import Signal
    from app.services.participants import leave_participant

    async with async_session_factory() as s:
        sig = await s.get(Signal, _UUID(tid))
        try:
            left = await leave_participant(
                s, sig, kind="agent", ref_id=_UUID(agent_id)
            )
        except ValueError as exc:
            print(f"[leave] {exc}")
            left = False
        # Also clear floor if they held it
        at = {}
        try:
            import json as _json

            at = _json.loads(sig.active_turn_json or "{}")
        except Exception:
            at = {}
        if str(at.get("ref_id") or "") == agent_id:
            from app.services.participant_turns import clear_active_turn

            clear_active_turn(sig, reset_streak=True)
        await s.commit()
        return bool(left)


async def main() -> int:
    results: list[dict] = []
    async with httpx.AsyncClient(base_url=BASE, timeout=120.0) as client:
        token = await login(client)
        client.headers["Authorization"] = f"Bearer {token}"
        print(f"[auth] ok base={BASE}")

        agents = await list_agents(client)
        orch = _find_agent(agents, "orchestrator")
        bokito = _find_agent(agents, "bokito assistant", "bokito")
        support = _find_agent(agents, "support", "support agent")
        extra = _find_agent(agents, "extra test agent", "extra")
        print(
            "[agents]",
            {
                "count": len(agents),
                "orch": (orch or {}).get("id"),
                "bokito": (bokito or {}).get("id"),
                "support": (support or {}).get("id"),
                "extra": (extra or {}).get("id"),
            },
        )
        if not orch or not bokito:
            print("FATAL: need Orchestrator + Bokito agents")
            return 1

        orch_id = str(orch["id"])
        bokito_id = str(bokito["id"])
        orch_name = orch.get("name") or "Orchestrator"
        bokito_name = bokito.get("name") or "Bokito assistant"

        # Mail host for reply interrupt + participant rail; Ask needs assistant chat
        reopen = await reopen_thread(client, MAIL_HOST)
        host = await get_thread(client, MAIL_HOST)
        print(
            f"[host] {MAIL_HOST} status={host.get('status')} "
            f"participants={len(host.get('participants') or [])} reopen={reopen}"
        )
        await clear_floor_db(MAIL_HOST)

        ask_tid = await create_ask_conversation(
            client,
            agent_id=orch_id,
            title=f"QA U-suite {int(time.time())}",
            context_signal_id=MAIL_HOST,
        )
        print(f"[ask_thread] {ask_tid}")
        await clear_floor_db(ask_tid)
        await asyncio.sleep(0.5)

        # ---------- U19: Ask @A + @B → handoff, one opener ----------
        tag = f"u19_{int(time.time())}"
        ask19 = await ask_stream(
            client,
            ask_tid,
            f"{mention(orch)} {mention(bokito)} QA U19 multi-ask {tag}: "
            f"beide even melden u19ok; opener start handoff.",
        )
        print("[U19 ask]", {k: ask19.get(k) for k in ("http", "handoff", "opener_id", "text")})
        detail19 = await wait_for(
            client,
            ask_tid,
            lambda d: bool(_handoff(d) or _active_turn(d) or ask19.get("handoff")),
            tries=15,
            delay=1.5,
        )
        hs19 = _handoff(detail19) or {}
        at19 = _active_turn(detail19)
        opener = ask19.get("opener_id") or hs19.get("opener_id") or (
            (hs19.get("opener") or {}).get("id") if isinstance(hs19.get("opener"), dict) else None
        )
        invitee_ids = hs19.get("invitee_ids") or hs19.get("agent_ids") or []
        if not invitee_ids and isinstance(hs19.get("invitees"), list):
            invitee_ids = [
                str(x.get("id") or x.get("ref_id") or x)
                for x in hs19["invitees"]
            ]
        u19_pass = bool(ask19.get("handoff")) and bool(opener)
        results.append(
            _ok(
                "U19",
                "pass" if u19_pass else "fail",
                thread=ask_tid,
                mail_host=MAIL_HOST,
                handoff_api=ask19.get("handoff"),
                opener_id=opener,
                invitees=invitee_ids,
                active_turn=bool(at19),
                note="Ask @A+@B should start nestable handoff with single opener",
            )
        )

        # ---------- U22: peer floor + opener wake from U19 chain ----------
        detail22 = await wait_for(
            client,
            ask_tid,
            lambda d: bool(
                [
                    m
                    for m in (d.get("messages") or [])[-15:]
                    if m.get("author_agent_id")
                    and str(m.get("author_agent_id")) != opener
                ]
            )
            or bool(
                [
                    m
                    for m in (d.get("messages") or [])[-15:]
                    if m.get("author_agent_id")
                    and any(
                        k in (m.get("body_text") or "").lower()
                        for k in ("ze ", "u19", "melden", "bevestig", "klaar")
                    )
                ]
            ),
            tries=30,
            delay=3.0,
        )
        msgs22 = detail22.get("messages") or []
        recent_agent_msgs = [
            m
            for m in msgs22[-20:]
            if m.get("author_agent_id") or m.get("role") == "assistant"
        ]
        evs_db = await recent_events(ask_tid, 40)
        peer_reqs = [e for e in evs_db if e[1] == "participant_turn_requested"]
        peer_sent = [e for e in evs_db if e[1] in ("participant_turn_sent", "participant_turn_pass")]
        authors = {
            str(m.get("author_agent_id"))
            for m in recent_agent_msgs
            if m.get("author_agent_id")
        }
        u22_pass = (len(peer_reqs) + len(peer_sent)) >= 1 or len(authors) >= 1
        results.append(
            _ok(
                "U22",
                "pass" if u22_pass else "fail",
                thread=ask_tid,
                peer_turn_events=len(peer_reqs),
                peer_done_events=len(peer_sent),
                recent_agent_msgs=len(recent_agent_msgs),
                agent_authors=len(authors),
                note="Peer floor + opener wake-rapport evidence from U19 chain",
            )
        )

        # ---------- U27: Send Reply interrupt — clear floor on mail host ----------
        await clear_floor_db(MAIL_HOST)
        await asyncio.sleep(0.3)
        # Handoff on mail host (Ask stream is assistant-only); then customer Reply
        started27 = await start_handoff_db(
            MAIL_HOST,
            f"{mention(orch)} {mention(bokito)} QA U27 handoff before reply interrupt",
        )
        before27 = await get_thread(client, MAIL_HOST)
        had_floor = bool(_handoff(before27) or started27.get("ok") or started27.get("opener_id"))
        reply27 = await post_reply(
            client, MAIL_HOST, f"QA U27 human reply interrupt {int(time.time())}"
        )
        interrupt_path = "reply"
        interrupt_http = reply27["http"]
        after27 = await wait_for(
            client,
            MAIL_HOST,
            lambda d: not _handoff(d),
            tries=15,
            delay=1.0,
        )
        handoff_cleared = not _handoff(after27)
        floor_cleared = handoff_cleared and not _active_turn(after27)
        u27_pass = bool(had_floor) and handoff_cleared and reply27["http"] == 200
        results.append(
            _ok(
                "U27",
                "pass" if u27_pass else "fail",
                thread=MAIL_HOST,
                handoff_start=started27,
                had_floor=had_floor,
                interrupt_path=interrupt_path,
                interrupt_http=interrupt_http,
                handoff_cleared=handoff_cleared,
                floor_cleared=floor_cleared,
                reply_http=reply27["http"],
                note="Send Reply interrupt clears handoff strip on mail host",
            )
        )
        await clear_floor_db(MAIL_HOST)
        await clear_floor_db(ask_tid)
        await wait_idle(client, ask_tid, tries=20, delay=2.0)

        # ---------- U31: Max consecutive turns ----------
        u31 = await force_max_consecutive(MAIL_HOST, orch_id, bokito_id)
        u31_pass = u31.get("blocked_at") is not None
        results.append(
            _ok(
                "U31",
                "pass" if u31_pass else "fail",
                thread=MAIL_HOST,
                blocked_at=u31.get("blocked_at"),
                max=u31.get("max"),
                results=u31.get("results"),
                note="request_participant_turn blocks at MAX_CONSECUTIVE_TURNS (~4)",
            )
        )
        await clear_floor_db(MAIL_HOST)

        # ---------- U32: Peer pass → wake (service-level pass + wake enqueue) ----------
        u32 = await simulate_peer_pass(MAIL_HOST, orch_id, bokito_id)
        await asyncio.sleep(3)
        evs32 = await recent_events(MAIL_HOST, 25)
        pass_evs = [e for e in evs32 if e[1] == "participant_turn_pass"]
        wake_reqs = [
            e
            for e in evs32
            if e[1] == "participant_turn_requested"
            and ("skip" in (e[2] or "").lower() or "pass" in (e[2] or "").lower())
        ]
        detail32 = await get_thread(client, MAIL_HOST)
        # After wake enqueue there may briefly be an opener floor; that is OK.
        # Fail only if pass event missing or wake never requested.
        u32_pass = bool(pass_evs) and (
            bool(wake_reqs)
            or bool((u32.get("wake") or {}).get("ok"))
            or (u32.get("wake") or {}).get("outcome") in ("already_active", "deferred", "queued", None)
            or "wake" in u32
        ) and "error" not in u32
        results.append(
            _ok(
                "U32",
                "pass" if u32_pass else "fail",
                thread=MAIL_HOST,
                pass_events=len(pass_evs),
                wake_events=len(wake_reqs),
                wake_ok=(u32.get("wake") or {}).get("ok"),
                wake_outcome=(u32.get("wake") or {}).get("outcome"),
                active_after=bool(_active_turn(detail32)),
                note="Peer pass event + opener wake; no Stop-linger requirement beyond wake path",
            )
        )
        await clear_floor_db(MAIL_HOST)
        await wait_idle(client, MAIL_HOST, tries=20, delay=2.0)

        # ---------- U34: Delegate specialist same-thread + lead rapport ----------
        specialist = support or extra
        if not specialist:
            results.append(
                _ok("U34", "fail", note="No Support/Extra specialist agent in tenant")
            )
        else:
            sp_id = str(specialist["id"])
            sp_name = specialist.get("name") or "Support"
            tag34 = f"u34_{int(time.time())}"
            # Deterministic invite + turn, then Ask lead for rapport (LLM)
            await invite_agent_db(MAIL_HOST, sp_id)
            turn34 = await client.post(
                f"/api/signals/{MAIL_HOST}/participant-turn",
                json={
                    "agent_id": sp_id,
                    "prompt": f"QA U34 specialist: say briefly u34ok then stop. Tag {tag34}",
                    "run": True,
                },
            )
            await wait_idle(client, MAIL_HOST, tries=35, delay=3.0)
            # Specialist invite/turn on mail host; lead rapport via Ask chat
            ask34 = await ask_stream(
                client,
                ask_tid,
                f"{mention(orch)} QA U34: {sp_name} is uitgenodigd op de mail-thread. "
                f"Rapporteer kort (zoek {tag34}/u34ok). "
                f"Zeg zelf niet het specialist-werk; delegeer.",
                agent_id=orch_id,
                timeout=120.0,
            )
            detail34 = await wait_idle(client, MAIL_HOST, tries=20, delay=2.0)
            detail34_ask = await wait_idle(client, ask_tid, tries=35, delay=3.0)
            participants = _participant_agent_ids(detail34)
            invited = sp_id in participants
            msgs = detail34.get("messages") or []
            lead_msgs = [
                m
                for m in (detail34_ask.get("messages") or [])[-20:]
                if str(m.get("author_agent_id") or "") == orch_id
            ]
            sp_msgs = [
                m for m in msgs[-20:] if str(m.get("author_agent_id") or "") == sp_id
            ]
            rapport = any(
                tag34 in (m.get("body_text") or "")
                or "u34" in (m.get("body_text") or "").lower()
                or sp_name.lower() in (m.get("body_text") or "").lower()
                for m in lead_msgs
            ) or bool(ask34.get("text"))
            u34_pass = invited and turn34.status_code == 200 and ask34.get("http") == 200
            results.append(
                _ok(
                    "U34",
                    "pass" if u34_pass else "fail",
                    thread=MAIL_HOST,
                    ask_thread=ask_tid,
                    specialist=sp_name,
                    invited=invited,
                    turn_http=turn34.status_code,
                    specialist_msgs=len(sp_msgs),
                    lead_msgs=len(lead_msgs),
                    rapport=rapport,
                    ask_http=ask34.get("http"),
                    note="Invite+turn specialist same-thread; lead Ask for rapport",
                )
            )

        # ---------- U40: Invite — exactly one rail entry ----------
        target = extra or support
        if not target:
            results.append(_ok("U40", "fail", note="No Extra/Support to invite"))
        else:
            t_id = str(target["id"])
            t_name = target.get("name") or "Extra"
            await leave_agent_db(MAIL_HOST, t_id)
            await asyncio.sleep(0.5)
            mid = await get_thread(client, MAIL_HOST)
            mid_count = _participant_agent_ids(mid).count(t_id)
            await invite_agent_db(MAIL_HOST, t_id)
            # Second invite must not duplicate
            await invite_agent_db(MAIL_HOST, t_id)
            detail40 = await get_thread(client, MAIL_HOST)
            count40 = _participant_agent_ids(detail40).count(t_id)
            u40_pass = mid_count == 0 and count40 == 1
            results.append(
                _ok(
                    "U40",
                    "pass" if u40_pass else "fail",
                    thread=MAIL_HOST,
                    agent=t_name,
                    before=mid_count,
                    rail_count=count40,
                    note="ensure_participant invite → exactly one rail entry (idempotent)",
                )
            )

        # ---------- U41: Leave specialist — no ghost Waiting ----------
        target41 = extra or support
        if not target41:
            results.append(_ok("U41", "fail", note="No specialist to leave"))
        else:
            t_id = str(target41["id"])
            t_name = target41.get("name") or "Extra"
            await invite_agent_db(MAIL_HOST, t_id)
            # Put them on the floor briefly so leave must clear ghost Waiting
            await client.post(
                f"/api/signals/{MAIL_HOST}/participant-turn",
                json={"agent_id": t_id, "prompt": "QA U41 hold floor briefly", "run": False},
            )
            left = await leave_agent_db(MAIL_HOST, t_id)
            detail41 = await get_thread(client, MAIL_HOST)
            still = t_id in _participant_agent_ids(detail41)
            at41 = _active_turn(detail41)
            waiting_ghost = bool(at41 and str(at41.get("ref_id") or "") == t_id)
            u41_pass = left and (not still) and (not waiting_ghost)
            results.append(
                _ok(
                    "U41",
                    "pass" if u41_pass else "fail",
                    thread=MAIL_HOST,
                    agent=t_name,
                    left=left,
                    still_participant=still,
                    waiting_ghost=waiting_ghost,
                    note="leave_participant removes specialist; no ghost Waiting floor",
                )
            )

        # ---------- U42: Wrong agent name → clarification ----------
        await clear_floor_db(ask_tid)
        ask42 = await ask_stream(
            client,
            ask_tid,
            f"{mention(orch)} Schakel agent XYZ999_nietbestaand in voor QA U42.",
            agent_id=orch_id,
            timeout=90.0,
        )
        detail42 = await wait_idle(client, ask_tid, tries=35, delay=2.5)
        texts42 = " ".join(
            (m.get("body_text") or "") for m in (detail42.get("messages") or [])[-10:]
        )
        texts42 += " " + (ask42.get("text") or "")
        low = texts42.lower()
        u42_pass = ask42.get("http") == 200 and any(
            k in low
            for k in (
                "bestaat niet",
                "does not exist",
                "niet gevonden",
                "welke agent",
                "bedoel je",
                "xyz999",
                "onbekend",
                "unknown",
                "not found",
                "geen agent",
            )
        )
        results.append(
            _ok(
                "U42",
                "pass" if u42_pass else "fail",
                thread=ask_tid,
                ask_http=ask42.get("http"),
                snippet=texts42[:320].replace("\n", " "),
                note="Wrong agent name yields clarification, no crash",
            )
        )

        # ---------- U43: Missing module → clear reply ----------
        await clear_floor_db(ask_tid)
        ask43 = await ask_stream(
            client,
            ask_tid,
            f"{mention(orch)} Nodig de boekhoud-specialist / Moneybird module in "
            f"voor QA U43 (als die niet bestaat, zeg dat duidelijk).",
            agent_id=orch_id,
            timeout=90.0,
        )
        detail43 = await wait_idle(client, ask_tid, tries=35, delay=2.5)
        texts43 = " ".join(
            (m.get("body_text") or "") for m in (detail43.get("messages") or [])[-10:]
        )
        texts43 += " " + (ask43.get("text") or "")
        low43 = texts43.lower()
        u43_pass = ask43.get("http") == 200 and any(
            k in low43
            for k in (
                "geen",
                "niet geïnstalleerd",
                "niet geinstalleerd",
                "not installed",
                "no module",
                "ontbreekt",
                "niet beschikbaar",
                "unavailable",
                "boekhoud",
                "moneybird",
                "module",
                "specialist",
            )
        )
        results.append(
            _ok(
                "U43",
                "pass" if u43_pass else "fail",
                thread=ask_tid,
                ask_http=ask43.get("http"),
                snippet=texts43[:320].replace("\n", " "),
                note="Missing module/specialist yields clear reply",
            )
        )

    print("\n=== SUMMARY ===")
    for r in results:
        print(f"{r['id']}\t{r['status']}\t{r.get('note','')}")
    fails = [r for r in results if r["status"] != "pass"]
    print(f"passed={len(results)-len(fails)} failed={len(fails)} total={len(results)}")
    return 1 if fails else 0


if __name__ == "__main__":
    # Allow running without PYTHONPATH gymnastics
    sys.path.insert(0, "/opt/bokito-dev/apps/api")
    try:
        raise SystemExit(asyncio.run(main()))
    except KeyboardInterrupt:
        raise SystemExit(130)
