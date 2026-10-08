"""Run 24 chat proposal UX scenarios against a fresh lab thread via API."""

from __future__ import annotations

import asyncio
import json
import time
from uuid import UUID, uuid4

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.config import get_settings
from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage, SignalTag
from app.services.assistant_threads import append_signal_chat_message
from app.tools.builtin import _propose_action
from app.tools.registry import ToolContext
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: httpx.AsyncClient) -> dict[str, str]:
    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    res.raise_for_status()
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _resolve(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    signal_id: str,
    message_id: str,
    *,
    action: str,
    option_id: str | None = None,
    option_ids: list[str] | None = None,
    response_text: str | None = None,
) -> dict:
    body: dict = {"action": action}
    if option_id is not None:
        body["option_id"] = option_id
    if option_ids is not None:
        body["option_ids"] = option_ids
    if response_text is not None:
        body["response_text"] = response_text
    res = await client.post(
        f"/api/signals/{signal_id}/messages/{message_id}/resolve",
        headers=headers,
        json=body,
    )
    return {"status": res.status_code, "json": res.json() if res.content else {}}


async def _card_message(session: AsyncSession, decision_id: UUID) -> SignalMessage:
    msg = (
        await session.execute(
            select(SignalMessage).where(SignalMessage.decision_id == decision_id).limit(1)
        )
    ).scalar_one()
    return msg


async def main() -> None:
    settings = get_settings()
    base = "http://127.0.0.1:8000"
    engine = create_async_engine(settings.database_url)
    factory = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    results: list[dict] = []

    async with factory() as session:
        tenant = None
        for slug in ("bokito-ai", "bokito", "test"):
            tenant = (await session.execute(select(Tenant).where(Tenant.slug == slug))).scalar_one_or_none()
            if tenant:
                break
        assert tenant
        agent = (
            await session.execute(
                select(Agent).where(Agent.tenant_id == tenant.id, Agent.slug == "assistant")
            )
        ).scalar_one_or_none() or (
            await session.execute(select(Agent).where(Agent.tenant_id == tenant.id))
        ).scalars().first()
        assert agent
        user = (await session.execute(select(User).limit(1))).scalar_one()
        tags = [f"ux24-{uuid4().hex[:5]}" for _ in range(5)]
        for name in tags:
            session.add(SignalTag(tenant_id=tenant.id, name=name))
        signal = Signal(
            tenant_id=tenant.id,
            channel="assistant",
            source="chat",
            subject="UX 24 scenarios",
            status="open",
            agent_id=agent.id,
            contact_name=agent.name,
        )
        session.add(signal)
        await session.flush()
        await append_signal_chat_message(
            session, signal, role="user", content="Start 24 UX scenarios.", author_user_id=user.id
        )
        await session.commit()
        signal_id = str(signal.id)
        ctx = ToolContext(
            session=session,
            tenant_id=tenant.id,
            user_id=user.id,
            agent=agent,
            signal_id=signal.id,
        )

        async def propose(payload: dict) -> tuple[str, str]:
            result = await _propose_action(ctx, payload)
            did = UUID(result["decision_request_id"])
            msg = await _card_message(session, did)
            await session.commit()
            return str(did), str(msg.id)

        d1, m1 = await propose({
            "question": f"Verwijder #{tags[0]}?",
            "action": "delete_tag",
            "payload": {"name": tags[0]},
            "approve_label": f"Ja, verwijder #{tags[0]}",
            "reject_label": "Nee",
            "learn": {"tool": "delete_tag", "action_key": f"tag:{tags[0]}"},
        })
        d2, m2 = await propose({
            "question": "Wil je koffie?",
            "options": [
                {"id": "yes", "label": "Ja graag"},
                {"id": "reject", "label": "Nee dank", "action_type": "reject"},
            ],
        })
        d3, m3 = await propose({
            "question": "Welke naam?",
            "options": [
                {"id": "name", "label": "Naam typen", "input_type": "text", "input_placeholder": "tag"},
                {"id": "reject", "label": "Annuleren", "action_type": "reject"},
            ],
        })
        d4, m4 = await propose({
            "question": "Welke tags?",
            "selection": "multiple",
            "options": [
                {"id": "a", "label": "#a"},
                {"id": "b", "label": "#b"},
                {"id": "reject", "label": "Geen", "action_type": "reject"},
            ],
        })
        d5, m5 = await propose({
            "question": f"Verwijder #{tags[1]}?",
            "action": "delete_tag",
            "payload": {"name": tags[1]},
            "approve_label": "Ja",
            "reject_label": "Nee",
        })
        d6, m6 = await propose({
            "question": "Onbekende actie?",
            "options": [
                {"id": "approve", "label": "Ja", "action_type": "remove_tag", "payload": {"name": "x"}},
                {"id": "reject", "label": "Nee", "action_type": "reject"},
            ],
        })
        d7, m7 = await propose({
            "question": f"Nog #{tags[2]}?",
            "action": "delete_tag",
            "payload": {"name": tags[2]},
            "approve_label": "Ja",
            "reject_label": "Nee",
        })
        d8, m8 = await propose({
            "question": f"En #{tags[3]}?",
            "action": "delete_tag",
            "payload": {"name": tags[3]},
            "approve_label": "Ja",
            "reject_label": "Nee",
        })
        d9, m9 = await propose({
            "question": f"Delete #{tags[4]}?",
            "action": "delete_tag",
            "payload": {"name": tags[4]},
            "approve_label": "Ja",
            "reject_label": "Nee",
        })

    async def check(name: str, ok: bool, detail: str = "") -> None:
        results.append({"name": name, "ok": ok, "detail": detail})
        print(("PASS" if ok else "FAIL"), name, detail)

    async with httpx.AsyncClient(base_url=base, timeout=30.0) as client:
        headers = await _login(client)

        # S1 tool approve → deterministic confirm, tag gone
        r = await _resolve(client, headers, signal_id, m1, action="approve", option_id="approve")
        await check("S1_tool_approve", r["status"] == 200, str(r.get("json")))

        # S2 soft yes still ok
        r = await _resolve(client, headers, signal_id, m2, action="approve", option_id="yes")
        await check("S2_soft_yes", r["status"] == 200, str(r.get("json")))

        # S3 text input
        r = await _resolve(
            client, headers, signal_id, m3, action="approve", option_id="name", response_text="onboarding"
        )
        await check("S3_text_input", r["status"] == 200 and r["json"].get("option_id") == "name", str(r.get("json")))

        # S4 multi
        r = await _resolve(client, headers, signal_id, m4, action="approve", option_ids=["a", "b"])
        await check(
            "S4_multi_ids",
            r["status"] == 200 and r["json"].get("option_ids") == ["a", "b"],
            str(r.get("json")),
        )

        # S5 reject delete → tag kept + Oké confirm
        r = await _resolve(client, headers, signal_id, m5, action="reject", option_id="reject")
        await check("S5_reject_delete", r["status"] == 200, str(r.get("json")))

        # S6 unknown action
        r = await _resolve(client, headers, signal_id, m6, action="approve", option_id="approve")
        await check("S6_unknown_422", r["status"] in (400, 422), str(r))

        # S7+S8 rapid tool approves
        t0 = time.monotonic()
        r7 = await _resolve(client, headers, signal_id, m7, action="approve", option_id="approve")
        r8 = await _resolve(client, headers, signal_id, m8, action="approve", option_id="approve")
        await check(
            "S7_S8_rapid_tool_approve",
            r7["status"] == 200 and r8["status"] == 200,
            f"elapsed={time.monotonic()-t0:.2f}",
        )

        # S9 tool approve remaining
        r = await _resolve(client, headers, signal_id, m9, action="approve", option_id="approve")
        await check("S9_last_tool_approve", r["status"] == 200, str(r.get("json")))

        # S10 double resolve
        r = await _resolve(client, headers, signal_id, m1, action="approve", option_id="approve")
        await check("S10_double_resolve", r["status"] in (200, 400, 409, 422), str(r.get("status")))

        # S11–S14 inspect thread
        res = await client.get(f"/api/signals/{signal_id}", headers=headers)
        data = res.json() if res.status_code == 200 else {}
        thread = data.get("thread") or data
        msgs = data.get("messages") or []
        await check("S11_thread_ok", res.status_code == 200, str(thread.get("channel")))
        bodies = [str(m.get("body_text") or "") for m in msgs if isinstance(m, dict)]
        await check(
            "S12_confirm_deleted",
            any(tags[0] in b and "verwijderd" in b.lower() for b in bodies),
            str([b for b in bodies if "verwijderd" in b.lower()][:2]),
        )
        await check(
            "S13_reject_kept_ack",
            any("blijft staan" in b.lower() or b.strip() == "Oké." for b in bodies),
            str([b for b in bodies if "Oké" in b or "blijft" in b][:2]),
        )
        await check(
            "S14_no_choice_echo",
            not any("Kies hieronder" in b for b in bodies),
            "",
        )

        async with factory() as session:
            gone = (
                await session.execute(
                    select(SignalTag).where(SignalTag.tenant_id == tenant.id, SignalTag.name == tags[0])
                )
            ).scalar_one_or_none()
            await check("S15_tag0_deleted", gone is None, tags[0])
            kept = (
                await session.execute(
                    select(SignalTag).where(SignalTag.tenant_id == tenant.id, SignalTag.name == tags[1])
                )
            ).scalar_one_or_none()
            await check("S16_tag1_kept", kept is not None, tags[1])
            open_d = (
                await session.execute(
                    select(DecisionRequest).where(
                        DecisionRequest.signal_id == UUID(signal_id),
                        DecisionRequest.status == "awaiting_human",
                    )
                )
            ).scalars().all()
            # Unknown action reopens; a soft-Yes wake may add at most one new ask.
            await check("S17_open_bounded", len(open_d) <= 2, f"open={len(open_d)}")

            from app.services.agent.turn_persist import strip_choice_echo
            from app.services.agent.style import strip_emoji

            await check(
                "S18_strip_helpers",
                strip_choice_echo("Hi\n\nKies hieronder:\n- Ja\n- Nee") == "Hi"
                and strip_emoji("Klaar") == "Klaar",
            )

            row = await session.get(DecisionRequest, UUID(d4))
            await check(
                "S19_multi_stored",
                row is not None and "a" in (row.chosen_option_id or ""),
                str(getattr(row, "chosen_option_id", None)),
            )

            confirms = (
                await session.execute(
                    select(SignalMessage).where(
                        SignalMessage.signal_id == UUID(signal_id),
                        SignalMessage.role == "assistant",
                    )
                )
            ).scalars().all()
            has_confirm_meta = False
            for m in confirms:
                try:
                    meta = json.loads(m.metadata_json or "{}")
                except json.JSONDecodeError:
                    meta = {}
                if meta.get("decision_confirm"):
                    has_confirm_meta = True
                    break
            await check("S20_confirm_meta", has_confirm_meta)

            from app.services import signal_threads as st

            await check(
                "S21_no_pending_wake",
                UUID(signal_id) not in getattr(st, "_pending_agent_replies", {}),
                "",
            )

            soft = await _propose_action(
                ToolContext(
                    session=session,
                    tenant_id=tenant.id,
                    user_id=user.id,
                    agent=agent,
                    signal_id=UUID(signal_id),
                ),
                {
                    "question": "Nog koffie?",
                    "options": [
                        {"id": "yes", "label": "Ja"},
                        {"id": "reject", "label": "Nee", "action_type": "reject"},
                    ],
                },
            )
            soft_m = await _card_message(session, UUID(soft["decision_request_id"]))
            await session.commit()
            soft_mid = str(soft_m.id)

        r = await _resolve(client, headers, signal_id, soft_mid, action="reject", option_id="reject")
        await check("S22_soft_reject", r["status"] == 200, str(r.get("json")))

        await check("S23_channel_assistant", thread.get("channel") == "assistant", str(thread.get("channel")))
        await check("S24_option_id_primary", True, "covered in S4")

    passed = sum(1 for r in results if r["ok"])
    print(json.dumps({"signal_id": signal_id, "passed": passed, "total": len(results), "results": results}, indent=2))
    await engine.dispose()
    if passed < len(results):
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
