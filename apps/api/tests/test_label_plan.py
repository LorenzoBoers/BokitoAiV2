"""Label plan: one card per plan; approval puts each label where it belongs."""

import json
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.channel import Company, Contact
from app.models.learning import InboxRule
from app.models.notification import DecisionRequest
from app.models.signal import CompanyTagLink, Signal, SignalTag
from app.services.label_plan import apply_entry, validate_entries
from app.services.signal_tags import signal_tag_names
from app.tools.registry import ToolContext


async def _mistral(session):
    tenant = Tenant(slug=f"plan-{uuid4().hex[:6]}", name="Acme")
    session.add(tenant)
    await session.flush()
    company = Company(tenant_id=tenant.id, name="Mistral AI", domain="mistral.ai")
    session.add_all([company, SignalTag(tenant_id=tenant.id, name="administratie")])
    await session.flush()
    contact = Contact(tenant_id=tenant.id, address="billing@mistral.ai", company_id=company.id)
    session.add(contact)
    await session.flush()
    signals = [
        Signal(
            tenant_id=tenant.id,
            channel="email",
            subject=f"Your receipt from Mistral AI #{n}",
            contact_id=contact.id,
            contact_email="billing@mistral.ai",
        )
        for n in range(3)
    ]
    session.add_all(signals)
    await session.flush()
    return tenant, company, signals


@pytest.mark.asyncio
async def test_combined_and_single_use_lines_are_refused(session_override):
    tenant, _, signals = await _mistral(session_override)
    entries, errors = await validate_entries(
        session_override,
        tenant.id,
        [
            {"label": "mistral_facturen", "description": "Mistral invoices", "scope": "conversation",
             "signal_ids": [str(s.id) for s in signals]},
            {"label": "betaalbevestiging", "description": "One receipt", "scope": "conversation",
             "signal_ids": [str(signals[0].id)]},
        ],
    )
    assert entries == []
    assert [e["error"] for e in errors] == ["combines_labels", "single_use"]


@pytest.mark.asyncio
async def test_mistral_plan_applies_company_label_rule_and_backfill(session_override):
    tenant, company, signals = await _mistral(session_override)
    ids = [str(s.id) for s in signals]
    entries, errors = await validate_entries(
        session_override,
        tenant.id,
        [
            {"label": "mistral", "description": "Mistral AI, our model supplier", "scope": "company",
             "company": "mistral.ai"},
            {"label": "administratie", "scope": "rule", "match_type": "domain",
             "match_value": "mistral.ai", "signal_ids": ids},
        ],
        lang="nl",
    )
    assert errors == []
    assert entries[0]["where"] == "nieuw · op bedrijf Mistral AI"
    assert entries[1]["where"] == "bestaand · 3 gesprekken · regel op mistral.ai"

    for entry in entries:
        out = await apply_entry(session_override, tenant.id, entry)
        assert out["ok"] is True, out
    # A second run changes nothing.
    again = await apply_entry(session_override, tenant.id, entries[1])
    assert again["tagged"] == 0

    mistral = (
        await session_override.execute(
            select(SignalTag).where(SignalTag.tenant_id == tenant.id, SignalTag.name == "mistral")
        )
    ).scalar_one()
    assert mistral.description.startswith("Mistral AI")
    links = (
        await session_override.execute(select(CompanyTagLink).where(CompanyTagLink.company_id == company.id))
    ).scalars().all()
    assert [link.tag_id for link in links] == [mistral.id]

    for signal in signals:
        assert await signal_tag_names(session_override, signal.id) == ["administratie"]
    rule = (
        await session_override.execute(
            select(InboxRule).where(InboxRule.tenant_id == tenant.id, InboxRule.match_value == "mistral.ai")
        )
    ).scalar_one()
    assert rule.action == "tag"
    assert json.loads(rule.labels_json) == ["administratie"]


@pytest.mark.asyncio
async def test_propose_raises_one_card_per_line_in_one_bundle(session_override):
    from app.tools.builtin import _propose_label_plan

    tenant, _, signals = await _mistral(session_override)
    agent = Agent(tenant_id=tenant.id, name="Ava")
    chat = Signal(tenant_id=tenant.id, channel="internal", source="chat", subject="Labels")
    session_override.add_all([agent, chat])
    await session_override.flush()
    ctx = ToolContext(
        session=session_override,
        tenant_id=tenant.id,
        user_id=None,
        agent=agent,
        signal_id=chat.id,
        turn_id=f"turn-{uuid4().hex[:8]}",
    )
    refused = await _propose_label_plan(
        ctx, {"entries": [{"label": "mistral_facturen", "description": "x" * 10, "scope": "company", "company": "mistral.ai"}]}
    )
    assert refused["ok"] is False and refused["lines"][0]["error"] == "combines_labels"

    out = await _propose_label_plan(
        ctx,
        {
            "question": "Zo label ik dit werk:",
            "entries": [
                {"label": "mistral", "description": "Mistral AI, our model supplier", "scope": "company",
                 "company": "mistral.ai"},
                {"label": "administratie", "scope": "rule", "match_type": "domain",
                 "match_value": "mistral.ai", "signal_ids": [str(s.id) for s in signals]},
            ],
        },
    )
    assert out["ok"] is True
    decisions = [
        await session_override.get(DecisionRequest, UUID(i)) for i in out["decision_request_ids"]
    ]
    assert len(decisions) == 2
    assert len({d.bundle_id for d in decisions}) == 1
    approve = json.loads(decisions[0].options_json)[0]
    assert approve["action_type"] == "apply_label_plan"
    assert approve["payload"]["company_id"]
