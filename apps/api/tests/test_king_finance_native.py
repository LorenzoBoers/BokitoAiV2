"""Native KING Accountancy Cloudswitch integration: auth parsing, install,
discovery, and read-only tool calls against SOAP fixtures."""

import json
from uuid import uuid4

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.auth import Tenant
from app.models.integration import McpServer
from app.services import king_finance as kf
from app.services.agent.mcp_client import call_mcp_tool
from app.services.integrations_platform import install_mcp
from app.services.integrations_platform import test_mcp_server as run_mcp_discovery
from app.services.king_finance import (
    KING_NATIVE_TOOLS,
    KING_NATIVE_URL,
    MISSING_ADMIN_ERROR,
    MISSING_PARTNER_KEY_ERROR,
    call_king_tool,
    parse_administraties,
    parse_soap_response,
    public_companies,
)


async def _tenant(session: AsyncSession) -> Tenant:
    tenant = Tenant(slug=f"king-{uuid4().hex[:8]}", name="KING Native")
    session.add(tenant)
    await session.commit()
    await session.refresh(tenant)
    return tenant


def _auth(**overrides: object) -> dict:
    base: dict = {
        "partner_key": "abcdefghijklmnopqrstuvwxyz",
        "administraties": [
            {
                "id": "adm-bakker",
                "name": "Bakker BV",
                "omgevingscode": "ENV-BAKKER",
                "adm_nr": "1001",
            },
            {
                "id": "adm-slager",
                "name": "Slagerij De Vries",
                "omgevingscode": "ENV-SLAGER",
            },
        ],
    }
    base.update(overrides)
    return base


def test_parse_administraties_skips_empty_codes():
    rows = parse_administraties(
        {
            "administraties": [
                {"name": "Empty", "omgevingscode": "  "},
                {"id": "a1", "name": "Bakker BV", "omgevingscode": "CODE-1"},
            ]
        }
    )
    assert len(rows) == 1
    assert rows[0]["id"] == "a1"
    assert rows[0]["omgevingscode"] == "CODE-1"


def test_public_companies_hide_omgevingscode():
    visible = public_companies(_auth())
    assert visible == [
        {"id": "adm-bakker", "name": "Bakker BV", "adm_nr": "1001"},
        {"id": "adm-slager", "name": "Slagerij De Vries", "adm_nr": ""},
    ]
    assert all("omgevingscode" not in row for row in visible)


def test_parse_login_soap():
    xml = """<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <LoginResponse xmlns="https://cloudswitch.imuisonline.com/">
      <LoginResult>true</LoginResult>
      <SessionId>sess-1</SessionId>
      <Foutmelding></Foutmelding>
    </LoginResponse>
  </soap:Body>
</soap:Envelope>"""
    parsed = parse_soap_response(xml, "Login")
    assert parsed["ok"] is True
    assert parsed["session_id"] == "sess-1"


def test_parse_stamdata_rows():
    xml = """<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetStamtabelRecordsResponse xmlns="https://cloudswitch.imuisonline.com/">
      <GetStamtabelRecordsResult>true</GetStamtabelRecordsResult>
      <Records>
        <NewDataSet>
          <DATA><NR>1001</NR><NAAM>Bakker BV</NAAM><EMAIL>info@bakker.nl</EMAIL></DATA>
          <DATA><NR>1002</NR><NAAM>Slagerij De Vries</NAAM><EMAIL>info@devries.nl</EMAIL></DATA>
        </NewDataSet>
      </Records>
      <Foutmelding></Foutmelding>
    </GetStamtabelRecordsResponse>
  </soap:Body>
</soap:Envelope>"""
    parsed = parse_soap_response(xml, "GetStamtabelRecords")
    assert parsed["ok"] is True
    assert [row["NAAM"] for row in parsed["rows"]] == ["Bakker BV", "Slagerij De Vries"]


@pytest.mark.asyncio
async def test_prod_install_defaults_to_native_and_discovers_tools(
    session_override: AsyncSession, monkeypatch
):
    tenant = await _tenant(session_override)
    monkeypatch.setattr(get_settings(), "environment", "prod")
    monkeypatch.setattr(get_settings(), "king_finance_partner_key", "")

    installed = await install_mcp(
        session_override, tenant.id, provider="king_accountancy", api_key=""
    )
    assert installed["binding"]["config"]["server_url"] == KING_NATIVE_URL
    discovery = installed["discovery"]
    assert discovery is not None and discovery["ok"] is True
    assert discovery["note"] == "credentials_pending"
    tool_names = {t["name"] for t in discovery["tools"]}
    assert {"list_companies", "search_customers", "list_recent_bookings"} <= tool_names
    assert discovery["tool_count"] == len(KING_NATIVE_TOOLS)


@pytest.mark.asyncio
async def test_test_mcp_server_native_persists_tools(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    server = McpServer(
        tenant_id=tenant.id,
        name="KING Accountancy",
        server_url=KING_NATIVE_URL,
        auth_json="{}",
    )
    session_override.add(server)
    await session_override.commit()
    await session_override.refresh(server)

    result = await run_mcp_discovery(session_override, tenant.id, server.id)
    assert result["ok"] is True
    assert result["tool_count"] == len(KING_NATIVE_TOOLS)
    await session_override.refresh(server)
    stored = json.loads(server.tools_json or "[]")
    assert {t["name"] for t in stored} == {t["name"] for t in KING_NATIVE_TOOLS}


def _soap_transport(seen: list[httpx.Request]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        action = request.headers.get("SOAPAction", "")
        body = request.content.decode("utf-8")
        if "Login" in action:
            assert "ENV-BAKKER" in body or "ENV-SLAGER" in body
            return httpx.Response(
                200,
                text="""<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <LoginResponse xmlns="https://cloudswitch.imuisonline.com/">
      <LoginResult>true</LoginResult>
      <SessionId>sess-live</SessionId>
      <Foutmelding></Foutmelding>
    </LoginResponse>
  </soap:Body>
</soap:Envelope>""",
            )
        if "GetAdmInfo" in action:
            return httpx.Response(
                200,
                text="""<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetAdmInfoResponse xmlns="https://cloudswitch.imuisonline.com/">
      <GetAdmInfoResult>true</GetAdmInfoResult>
      <Records>
        <NewDataSet>
          <DATA><NAAM>Bakker BV</NAAM><PLAATS>Amsterdam</PLAATS><IBAN>NL00BANK0123</IBAN></DATA>
        </NewDataSet>
      </Records>
      <Foutmelding></Foutmelding>
    </GetAdmInfoResponse>
  </soap:Body>
</soap:Envelope>""",
            )
        if "GetStamtabelRecords" in action:
            table = "CRED" if "<TABLE>CRED</TABLE>" in body else "DEB"
            if table == "CRED":
                rows = "<DATA><NR>2001</NR><NAAM>Groothandel X</NAAM></DATA>"
            elif "Bakker" in body or "1001" in body:
                rows = "<DATA><NR>1001</NR><NAAM>Bakker BV</NAAM><EMAIL>info@bakker.nl</EMAIL></DATA>"
            else:
                rows = (
                    "<DATA><NR>1001</NR><NAAM>Bakker BV</NAAM><EMAIL>info@bakker.nl</EMAIL></DATA>"
                    "<DATA><NR>1002</NR><NAAM>Slagerij De Vries</NAAM><EMAIL>info@devries.nl</EMAIL></DATA>"
                )
            return httpx.Response(
                200,
                text=f"""<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetStamtabelRecordsResponse xmlns="https://cloudswitch.imuisonline.com/">
      <GetStamtabelRecordsResult>true</GetStamtabelRecordsResult>
      <Records><NewDataSet>{rows}</NewDataSet></Records>
      <Foutmelding></Foutmelding>
    </GetStamtabelRecordsResponse>
  </soap:Body>
</soap:Envelope>""",
            )
        if "GetDatumLaatsteBoekingen" in action or "GetLaatsteBoekingPeriode" in action:
            method = (
                "GetDatumLaatsteBoekingen"
                if "GetDatumLaatsteBoekingen" in action
                else "GetLaatsteBoekingPeriode"
            )
            return httpx.Response(
                200,
                text=f"""<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <{method}Response xmlns="https://cloudswitch.imuisonline.com/">
      <{method}Result>true</{method}Result>
      <Records><NewDataSet><DATA><DATUM>2026-08-01</DATUM><PERIODE>2026-08</PERIODE></DATA></NewDataSet></Records>
      <Foutmelding></Foutmelding>
    </{method}Response>
  </soap:Body>
</soap:Envelope>""",
            )
        if "CreateJournaalpost" in action:
            assert "<![CDATA[" in body and "<BOE>" in body
            return httpx.Response(
                200,
                text="""<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <CreateJournaalpostResponse xmlns="https://cloudswitch.imuisonline.com/">
      <CreateJournaalpostResult>true</CreateJournaalpostResult>
      <Primarykey><string>2026</string><string>10</string><string>42</string></Primarykey>
      <Foutmelding></Foutmelding>
    </CreateJournaalpostResponse>
  </soap:Body>
</soap:Envelope>""",
            )
        if "CreateStamTabelRecord" in action:
            assert "<METADATA>" in body and "<DATA>" in body
            return httpx.Response(
                200,
                text="""<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <CreateStamTabelRecordResponse xmlns="https://cloudswitch.imuisonline.com/">
      <CreateStamTabelRecordResult>true</CreateStamTabelRecordResult>
      <Primarykey>10588</Primarykey>
      <Foutmelding></Foutmelding>
    </CreateStamTabelRecordResponse>
  </soap:Body>
</soap:Envelope>""",
            )
        if "UpdateStamtabelRecord" in action:
            assert "<WHEREFIELDS>NR</WHEREFIELDS>" in body
            return httpx.Response(
                200,
                text="""<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <UpdateStamtabelRecordResponse xmlns="https://cloudswitch.imuisonline.com/">
      <UpdateStamtabelRecordResult>true</UpdateStamtabelRecordResult>
      <Foutmelding></Foutmelding>
    </UpdateStamtabelRecordResponse>
  </soap:Body>
</soap:Envelope>""",
            )
        return httpx.Response(404, text="unknown method")

    return httpx.MockTransport(handler)


@pytest.mark.asyncio
async def test_list_companies_needs_no_partnerkey():
    outcome = await call_king_tool(
        {"administraties": [{"id": "a1", "name": "Bakker BV", "omgevingscode": "X"}]},
        "list_companies",
        {},
    )
    assert outcome["result"] == [{"id": "a1", "name": "Bakker BV", "adm_nr": ""}]


@pytest.mark.asyncio
async def test_search_customers_hits_cloudswitch(monkeypatch):
    seen: list[httpx.Request] = []
    monkeypatch.setattr(kf, "_transport", _soap_transport(seen))
    kf._session_cache.clear()

    outcome = await call_king_tool(
        _auth(), "search_customers", {"company_id": "adm-bakker", "query": "bakker"}
    )
    assert "error" not in outcome
    assert outcome["result"][0]["NAAM"] == "Bakker BV"
    assert any("Login" in (r.headers.get("SOAPAction") or "") for r in seen)
    assert any("GetStamtabelRecords" in (r.headers.get("SOAPAction") or "") for r in seen)


@pytest.mark.asyncio
async def test_company_scoped_call_without_company_id(monkeypatch):
    monkeypatch.setattr(kf, "_transport", _soap_transport([]))
    kf._session_cache.clear()
    outcome = await call_king_tool(_auth(), "search_customers", {})
    assert outcome["error"] == MISSING_ADMIN_ERROR


@pytest.mark.asyncio
async def test_search_without_partnerkey(monkeypatch):
    monkeypatch.setattr(get_settings(), "king_finance_partner_key", "")
    outcome = await call_king_tool(
        {"administraties": [{"id": "a1", "name": "Bakker", "omgevingscode": "X"}]},
        "search_customers",
        {"company_id": "a1"},
    )
    assert outcome["error"] == MISSING_PARTNER_KEY_ERROR


def test_parse_escaped_records_with_ampersand():
    """ws1_xml returns Records as a text blob; SOAP already expands outer entities."""
    xml = """<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetStamtabelRecordsResponse xmlns="https://cloudswitch.imuisonline.com/">
      <GetStamtabelRecordsResult>true</GetStamtabelRecordsResult>
      <Records>&lt;NewDataSet&gt;&lt;DATA&gt;&lt;NR&gt;1&lt;/NR&gt;&lt;NAAM&gt;Droom &amp;amp; Vreesman&lt;/NAAM&gt;&lt;/DATA&gt;&lt;/NewDataSet&gt;</Records>
      <Foutmelding></Foutmelding>
    </GetStamtabelRecordsResponse>
  </soap:Body>
</soap:Envelope>"""
    parsed = parse_soap_response(xml, "GetStamtabelRecords")
    assert parsed["ok"] is True
    assert parsed["rows"][0]["NAAM"] == "Droom & Vreesman"


@pytest.mark.asyncio
async def test_get_company_details(monkeypatch):
    monkeypatch.setattr(kf, "_transport", _soap_transport([]))
    kf._session_cache.clear()
    outcome = await call_king_tool(_auth(), "get_company_details", {"company_id": "adm-bakker"})
    assert outcome["result"]["PLAATS"] == "Amsterdam"
    assert outcome["result"]["company_id"] == "adm-bakker"


@pytest.mark.asyncio
async def test_list_recent_bookings(monkeypatch):
    monkeypatch.setattr(kf, "_transport", _soap_transport([]))
    kf._session_cache.clear()
    outcome = await call_king_tool(_auth(), "list_recent_bookings", {"company_id": "Bakker BV"})
    assert outcome["result"]["last_booking_period"][0]["PERIODE"] == "2026-08"


@pytest.mark.asyncio
async def test_native_call_without_creds_errors_in_prod(
    session_override: AsyncSession, monkeypatch
):
    tenant = await _tenant(session_override)
    server = McpServer(
        tenant_id=tenant.id,
        name="KING Accountancy",
        server_url=KING_NATIVE_URL,
        auth_json="{}",
    )
    session_override.add(server)
    await session_override.commit()
    monkeypatch.setattr(get_settings(), "environment", "prod")

    result = await call_mcp_tool(
        session_override,
        tenant.id,
        {
            "server_name": "KING Accountancy",
            "tool_name": "search_customers",
            "arguments": {"company_id": "missing"},
        },
    )
    assert "KING Finance partnerkey" in result["error"] or "not ready" in result["error"]


@pytest.mark.asyncio
async def test_list_companies_from_mcp_uses_stored_admins(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    server = McpServer(
        tenant_id=tenant.id,
        name="KING Accountancy",
        server_url=KING_NATIVE_URL,
        auth_json=json.dumps(_auth(partner_key="")),
    )
    session_override.add(server)
    await session_override.commit()

    result = await call_mcp_tool(
        session_override,
        tenant.id,
        {"server_name": "KING Accountancy", "tool_name": "list_companies", "arguments": {}},
    )
    assert "error" not in result
    ids = {row["id"] for row in result["result"]}
    assert ids == {"adm-bakker", "adm-slager"}


# --- Write tools (module apply path only) ---


def test_write_tools_not_discoverable_by_agents():
    names = {t["name"] for t in KING_NATIVE_TOOLS}
    assert not names & kf.KING_WRITE_TOOL_NAMES


@pytest.mark.asyncio
async def test_create_journal_entry(monkeypatch):
    seen: list[httpx.Request] = []
    monkeypatch.setattr(kf, "_transport", _soap_transport(seen))
    kf._session_cache.clear()

    outcome = await call_king_tool(
        _auth(),
        "create_journal_entry",
        {
            "company_id": "adm-bakker",
            "rows": [
                {
                    "JR": "2026",
                    "PN": "8",
                    "DAGB": "10",
                    "REK": "10000",
                    "TEGREK": "8000",
                    "BEDRBOEK": "100.00",
                    "BTW": "-21",
                    "DAT": "31-08-2026",
                    "OMSCHR": "Verkoopfactuur",
                    "BOEKSTUK": "BKST1000",
                }
            ],
        },
    )
    assert "error" not in outcome
    assert outcome["result"]["created"] is True
    assert outcome["result"]["primary_keys"] == ["2026", "10", "42"]
    assert any("CreateJournaalpost" in (r.headers.get("SOAPAction") or "") for r in seen)


@pytest.mark.asyncio
async def test_create_party_returns_new_number(monkeypatch):
    monkeypatch.setattr(kf, "_transport", _soap_transport([]))
    kf._session_cache.clear()

    outcome = await call_king_tool(
        _auth(),
        "create_party",
        {
            "company_id": "adm-bakker",
            "role": "customer",
            "fields": {"NAAM": "Nieuwe Debiteur BV", "EMAIL": "info@nieuw.nl"},
        },
    )
    assert "error" not in outcome
    assert outcome["result"]["party_number"] == "10588"


@pytest.mark.asyncio
async def test_update_party(monkeypatch):
    seen: list[httpx.Request] = []
    monkeypatch.setattr(kf, "_transport", _soap_transport(seen))
    kf._session_cache.clear()

    outcome = await call_king_tool(
        _auth(),
        "update_party",
        {
            "company_id": "adm-bakker",
            "role": "customer",
            "party_id": "10007",
            "fields": {"EMAIL": "nieuw@breed.nl"},
        },
    )
    assert "error" not in outcome
    assert outcome["result"]["updated"] is True
    update_request = next(
        r for r in seen if "UpdateStamtabelRecord" in (r.headers.get("SOAPAction") or "")
    )
    body = update_request.content.decode("utf-8")
    assert "<WHEREVALUES>10007</WHEREVALUES>" in body
    assert "<EMAIL>nieuw@breed.nl</EMAIL>" in body


def test_stamtabel_dataset_shape():
    xml = kf._stamtabel_dataset(
        "DEB", {"NAAM": "Test", "EMAIL": ""}, where=("NR", "=", "10007")
    )
    assert xml.startswith("<NewDataSet><METADATA><TABLE>DEB</TABLE>")
    assert "<WHEREFIELDS>NR</WHEREFIELDS>" in xml
    assert "<EMAIL>" not in xml  # empty fields are dropped


def test_journaalpost_dataset_shape():
    xml = kf._journaalpost_dataset(
        [{"JR": "2026", "DAGB": "10", "BEDRBOEK": "100.00", "OPM": ""}]
    )
    assert xml == (
        "<NewDataSet><BOE><JR>2026</JR><DAGB>10</DAGB>"
        "<BEDRBOEK>100.00</BEDRBOEK></BOE></NewDataSet>"
    )
