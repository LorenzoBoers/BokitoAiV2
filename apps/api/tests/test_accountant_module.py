"""Accountant year-file workpapers, separate from Accounting."""

import json
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.models.module_source import ModuleSource
from app.modules.accountant.review import (
    engagement,
    filing_calendar,
    size_class,
    tax_bridge,
)
from app.modules.accountant.router import build_proposal, call_verb
from app.modules.catalog import active_module_skill_prompt, set_module_enabled
from app.services.module_sources import (
    ACCOUNTANT_PLATFORM_SEEDS,
    ensure_platform_seeds,
)


def test_size_class_confirms_only_after_two_matching_years():
    confirmed = size_class(
        {
            "legal_form": "bv",
            "total_assets": 400_000,
            "net_turnover": 800_000,
            "employees": 4,
            "prior_total_assets": 390_000,
            "prior_net_turnover": 700_000,
            "prior_employees": 3,
        }
    )
    assert confirmed["indicated"] == "micro"
    assert confirmed["size_class"] == "micro"
    assert confirmed["confirmed"] is True
    assert confirmed["statutory_audit"]["required"] is False
    assert confirmed["deposit"]["required"] is True

    shifted = size_class(
        {
            "legal_form": "bv",
            "total_assets": 400_000,
            "net_turnover": 800_000,
            "employees": 4,
            "prior_total_assets": 8_000_000,
            "prior_net_turnover": 16_000_000,
            "prior_employees": 40,
        }
    )
    assert shifted["indicated"] == "micro"
    assert shifted["prior_indicated"] == "medium"
    assert shifted["size_class"] == "medium"
    assert shifted["confirmed"] is False


def test_size_class_does_not_guess_missing_figures():
    blank = size_class({"legal_form": "bv", "total_assets": 100})
    assert blank["indicated"] is None
    assert blank["size_class"] is None
    assert "Do not estimate" in blank["note"]


def test_eenmanszaak_does_not_deposit():
    row = size_class(
        {
            "legal_form": "eenmanszaak",
            "total_assets": 100_000,
            "net_turnover": 200_000,
            "employees": 1,
            "prior_total_assets": 90_000,
            "prior_net_turnover": 180_000,
            "prior_employees": 1,
        }
    )
    assert row["deposit"]["required"] is False


def test_filing_calendar_for_a_calendar_year_bv():
    row = filing_calendar({"year_end": "2025-12-31", "legal_form": "bv", "size_class": "small"})
    assert row["annual_accounts"]["prepare_by"] == "2026-05-31"
    assert row["annual_accounts"]["deposit_ultimate"] == "2026-12-31"
    assert row["annual_accounts"]["deposit_within_days_after_adoption"] == 8
    assert row["corporate_tax"]["file_by"] == "2026-06-01"
    assert row["income_tax"] is None
    assert "Boekito" in row["left_to_accounting"]


def test_tax_bridge_rates_and_refuses_to_invent():
    due = tax_bridge(
        {
            "legal_form": "bv",
            "year": 2026,
            "commercial_profit": 250_000,
            "adjustments": [{"label": "depreciation", "amount": 0, "kind": "temporary"}],
        }
    )
    assert due["fiscal_profit"] == "250000.00"
    assert due["corporate_tax"]["indicative_tax"] == "50900.00"

    missing = tax_bridge({"legal_form": "bv", "year": 2026})
    assert missing["fiscal_profit"] is None
    assert missing["corporate_tax"] is None
    assert "Do not estimate" in missing["note"]

    later = tax_bridge({"legal_form": "bv", "year": 2027, "commercial_profit": 10_000})
    assert later["corporate_tax"] is None

    income = tax_bridge({"legal_form": "eenmanszaak", "year": 2026, "commercial_profit": 80_000})
    assert income["regime"] == "income_tax"
    assert income["corporate_tax"] is None


def test_engagement_refuses_assurance():
    audit = engagement({"kind": "audit"})
    assert audit["offered"] is False
    assert audit["signs"] is False
    compile_job = engagement({"kind": "compile", "legal_form": "bv"})
    assert compile_job["offered"] is True
    assert compile_job["signs"] is False
    assert compile_job["assurance"] == "none"


def test_compilation_proposal_does_not_file():
    proposal = build_proposal("propose_compilation", {"summary": "Pack is complete."})
    assert proposal is not None
    assert "does not sign" in proposal["summary"].lower() or "Nothing is filed" in proposal["summary"]
    assert proposal["options"][0]["action_type"] == "approve"


def test_accountant_seed_packs_are_not_the_bookkeeping_packs():
    keys = {seed["seed_key"] for seed in ACCOUNTANT_PLATFORM_SEEDS}
    assert {"nba_hra", "nba_products", "rjnet", "kvk_jaarrekening", "bw2_titel9", "vpb_rates"} <= keys
    assert "rgs" not in keys
    assert "belastingdienst" not in keys
    for seed in ACCOUNTANT_PLATFORM_SEEDS:
        assert seed["url"].startswith("https://")
        assert seed["url"] in seed["start_urls"]


@pytest.mark.asyncio
async def test_accountant_tools_require_the_module(session_override: AsyncSession):
    tenant = Tenant(slug=f"accto-{uuid4().hex[:8]}", name="Accounto")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    blocked = await call_verb(
        session_override,
        tenant.id,
        "size_class",
        {"legal_form": "bv", "total_assets": 1, "net_turnover": 1},
    )
    assert blocked["ok"] is False
    assert blocked["code"] == "module_off"

    await set_module_enabled(session_override, tenant.id, "accountant", True)
    opened = await call_verb(
        session_override,
        tenant.id,
        "filing_calendar",
        {"year_end": "2025-12-31", "legal_form": "nv"},
    )
    assert opened["ok"] is True
    assert opened["corporate_tax"]["file_by"] == "2026-06-01"

    skill = await active_module_skill_prompt(session_override, tenant.id)
    assert "does not sign" in skill.lower() or "not a registered accountant" in skill.lower()
    assert "on, no package" not in skill


@pytest.mark.asyncio
async def test_installing_accountant_retires_standards_on_accounting(
    session_override: AsyncSession,
):
    tenant = Tenant(slug=f"seeds-{uuid4().hex[:8]}", name="Seeds")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    await ensure_platform_seeds(session_override, tenant.id, "accounting")
    legacy = ModuleSource(
        tenant_id=tenant.id,
        module_slug="accounting",
        origin="platform",
        title="NBA — HRA",
        url="https://www.nba.nl/wet-en-regelgeving/hra/",
        status="ready",
        metadata_json=json.dumps(
            {"seed_key": "nba_hra", "start_urls": ["https://www.nba.nl/wet-en-regelgeving/hra/"]}
        ),
    )
    session_override.add(legacy)
    await session_override.commit()
    await ensure_platform_seeds(session_override, tenant.id, "accountant")

    rows = (
        await session_override.execute(
            select(ModuleSource).where(ModuleSource.tenant_id == tenant.id)
        )
    ).scalars().all()
    by_module: dict[tuple[str, str], str] = {}
    for row in rows:
        meta = json.loads(row.metadata_json or "{}")
        by_module[(row.module_slug, str(meta.get("seed_key")))] = row.status

    assert by_module[("accounting", "nba_hra")] == "disabled"
    assert by_module[("accounting", "belastingdienst")] != "disabled"
    assert by_module[("accountant", "nba_hra")] != "disabled"
    assert ("accountant", "vpb_rates") in by_module
