"""Native KING Accountancy / KING Finance Cloudswitch integration.

Talks to the Dutch Cloudswitch SOAP API (formerly iMUIS Online). One Bokito
tenant is an accountancy kantoor; each client environment is an administratie
identified by an omgevingscode. The platform partnerkey comes from env
(``KING_FINANCE_PARTNER_KEY``), never from a King username/password.

Reads are agent-visible tools. Writes (CreateJournaalpost,
Create/UpdateStamTabelRecord) exist as internal write tools that only the
accounting module apply path may call — after a human approved the
DecisionRequest and only when the platform + tenant write switches are on.
"""

from __future__ import annotations

import logging
import time
import uuid
import xml.etree.ElementTree as ET
from typing import Any
from xml.sax.saxutils import escape

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

KING_NATIVE_URL = "native://king-accountancy"
KING_SOAP_NS = "https://cloudswitch.imuisonline.com/"
KING_SOAPENV = "http://schemas.xmlsoap.org/soap/envelope/"
KING_DEFAULT_URL = "https://api.kingfinance.nl/v1/ws1_xml.asmx"
_SESSION_TTL_SEC = 20 * 60

MISSING_PARTNER_KEY_ERROR = (
    "KING Finance partnerkey is not configured. Set KING_FINANCE_PARTNER_KEY "
    "on the API server (issued by partners@muis.nl after the partner "
    "agreement). Do not use a King username or password."
)
MISSING_ADMIN_ERROR = (
    "No KING administratie selected. Call list_companies first and pass "
    "company_id, or add an omgevingscode on the KING Accountancy connection."
)
MISSING_CREDENTIALS_ERROR = (
    "KING Accountancy is not ready. Add at least one administratie "
    "(omgevingscode) on the connection and set KING_FINANCE_PARTNER_KEY "
    "on the API server."
)

KING_NATIVE_TOOLS: list[dict[str, str]] = [
    {
        "name": "list_companies",
        "description": (
            "List KING administraties (client environments) connected to this "
            "kantoor. Returns company_id values for later calls."
        ),
    },
    {
        "name": "get_company_details",
        "description": "Fetch KING administratie details (GetAdmInfo) for company_id",
    },
    {
        "name": "search_customers",
        "description": "Search debtors (DEB) by name, number, or email in one administratie",
    },
    {
        "name": "get_customer",
        "description": "Fetch one debtor (DEB) by customer number in one administratie",
    },
    {
        "name": "list_suppliers",
        "description": "List creditors (CRED) in one administratie, optionally filtered by name",
    },
    {
        "name": "list_accounts",
        "description": "List ledger accounts (GRB) from the chart of accounts",
    },
    {
        "name": "get_account_balance",
        "description": "Fetch one ledger account (GRB) and its stored balance fields",
    },
    {
        "name": "list_recent_bookings",
        "description": "Last booking dates/periods for the selected administratie",
    },
]

# Write tools: not in KING_NATIVE_TOOLS (agents never see them directly).
# Only the accounting module apply path calls these, after human approval
# and behind the platform + tenant write switches.
KING_WRITE_TOOL_NAMES = frozenset(
    {"create_journal_entry", "create_party", "update_party"}
)

# (partner_key, omgevingscode) -> (session_id, expires_at_epoch)
_session_cache: dict[tuple[str, str], tuple[str, float]] = {}

# Test seam: when set, HTTP clients are built with this transport.
_transport: httpx.AsyncBaseTransport | None = None


def _http_client(**kwargs: Any) -> httpx.AsyncClient:
    if _transport is not None:
        kwargs["transport"] = _transport
    kwargs.setdefault("timeout", 30.0)
    return httpx.AsyncClient(**kwargs)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_administraties(auth: dict[str, Any]) -> list[dict[str, str]]:
    """Normalize stored administraties. Omgevingscodes stay on the server."""
    raw = auth.get("administraties") or auth.get("administrations") or []
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for index, row in enumerate(raw):
        if not isinstance(row, dict):
            continue
        code = str(row.get("omgevingscode") or "").strip()
        if not code:
            continue
        name = str(row.get("name") or "").strip() or f"Administratie {index + 1}"
        adm_id = str(row.get("id") or "").strip() or str(uuid.uuid5(uuid.NAMESPACE_URL, code))
        if adm_id in seen:
            continue
        seen.add(adm_id)
        out.append(
            {
                "id": adm_id,
                "name": name,
                "omgevingscode": code,
                "adm_nr": str(row.get("adm_nr") or "").strip(),
            }
        )
    return out


def resolve_partner_key(auth: dict[str, Any]) -> str:
    override = str(auth.get("partner_key") or "").strip()
    if override:
        return override
    return get_settings().king_finance_partner_key.strip()


def has_king_credentials(auth: dict[str, Any]) -> bool:
    return bool(resolve_partner_key(auth) and parse_administraties(auth))


def resolve_administratie(auth: dict[str, Any], company_id: str) -> dict[str, str] | None:
    needle = company_id.strip()
    if not needle:
        return None
    lowered = needle.lower()
    for row in parse_administraties(auth):
        if row["id"] == needle or row["name"].lower() == lowered or row["omgevingscode"] == needle:
            return row
    return None


def public_companies(auth: dict[str, Any]) -> list[dict[str, str]]:
    """Administraties visible to agents — no omgevingscode."""
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "adm_nr": row["adm_nr"],
        }
        for row in parse_administraties(auth)
    ]


def _dataset_selectie(
    table: str = "",
    select_fields: str = "",
    where_fields: str = "",
    where_operators: str = "",
    where_values: str = "",
    order_by: str = "",
    page: int = 1,
    page_size: int = 10000,
) -> str:
    """Cloudswitch Selectie payload (NewDataSet/Table1), sent as CDATA.

    Docs: https://apps.imuisonline.com/muis-apps/getstamtabelrecords/
    Multi-field SELECT/WHERE values are TAB-separated.
    """
    # Cloudswitch requires WHERE* and ORDERBY tags even when empty
    # ("De selectie is incompleet, zie veld: ORDERBY").
    cells = {
        "TABLE": table,
        "SELECTFIELDS": select_fields,
        "WHEREFIELDS": where_fields,
        "WHEREOPERATORS": where_operators,
        "WHEREVALUES": where_values,
        "ORDERBY": order_by,
        "MAXRESULT": "0",
        "PAGESIZE": str(page_size),
        "SELECTPAGE": str(page if page > 0 else 1),
    }
    row_parts = [f"<{name}>{escape(value)}</{name}>" for name, value in cells.items()]
    return f"<NewDataSet><Table1>{''.join(row_parts)}</Table1></NewDataSet>"


def _soap_envelope(method: str, fields: dict[str, str], selectie_xml: str | None = None) -> str:
    parts = [f"      <{name}>{escape(value)}</{name}>" for name, value in fields.items()]
    if selectie_xml is not None:
        # ws1_xml expects Selectie as a string (CDATA NewDataSet), not nested XML.
        parts.append(f"      <Selectie><![CDATA[{selectie_xml}]]></Selectie>")
        parts.append("      <Records />")
        parts.append("      <Foutmelding></Foutmelding>")
    inner = "\n".join(parts)
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        f'<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        f'xmlns:xsd="http://www.w3.org/2001/XMLSchema" '
        f'xmlns:soap="{KING_SOAPENV}">'
        f"<soap:Body>"
        f'<{method} xmlns="{KING_SOAP_NS}">'
        f"{inner}"
        f"</{method}>"
        f"</soap:Body></soap:Envelope>"
    )


def _element_text(node: ET.Element | None) -> str:
    if node is None or node.text is None:
        return ""
    return node.text.strip()


def _truthy(value: str) -> bool:
    return value.strip().lower() in ("true", "1", "yes")


def _row_to_dict(row: ET.Element) -> dict[str, str]:
    data: dict[str, str] = {}
    for child in list(row):
        key = _local(child.tag)
        if key.lower() in {"schema", "metadata"}:
            continue
        data[key] = (child.text or "").strip()
    return data


def parse_dataset_rows(records_el: ET.Element | None) -> list[dict[str, str]]:
    """Turn a Cloudswitch Records payload into a list of row dicts.

    ws1_xml often returns Records as an HTML-escaped NewDataSet string
    (``&lt;NewDataSet&gt;...``). Nested XML DataSets are also accepted.
    """
    if records_el is None:
        return []

    text = (records_el.text or "").strip()
    if text:
        import html

        # Outer SOAP parse already expands entities once. Only unescape when
        # the payload is still tag-escaped (&lt;NewDataSet&gt;…); a second
        # html.unescape would turn &amp; into bare & and break ET.fromstring.
        candidate = text
        if candidate.lower().startswith("&lt;"):
            candidate = html.unescape(candidate).strip()
        if candidate.startswith("<"):
            try:
                inner = ET.fromstring(candidate)
            except ET.ParseError:
                inner = None
            if inner is not None:
                return _rows_from_dataset_root(inner)

    return _rows_from_dataset_root(records_el)


def _rows_from_dataset_root(root: ET.Element) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for node in root.iter():
        tag = _local(node.tag).upper()
        if tag in {"METADATA", "NEWDATASET", "RECORDS", "SCHEMA", "DIFFGRAM"}:
            continue
        if tag in {"DATA", "TABLE1"} or tag.startswith("TABLE") or tag in {
            "BASALG",
            "BASFIN",
            "DEB",
            "CRED",
            "GRB",
        }:
            parsed = _row_to_dict(node)
            # Prefer leaf rows with field children, skip wrapper-only nodes.
            if parsed and any(k.upper() not in {"TABLE", "SELECTFIELDS"} for k in parsed):
                if parsed not in rows:
                    rows.append(parsed)
    if rows:
        return rows
    for node in root.iter():
        if _local(node.tag) in {"NewDataSet", "diffgram", "Records", "schema"}:
            continue
        children = [c for c in list(node) if (c.text or "").strip()]
        if len(children) >= 2:
            parsed = _row_to_dict(node)
            if parsed and parsed not in rows:
                rows.append(parsed)
    return rows


def parse_soap_response(xml_text: str, method: str) -> dict[str, Any]:
    root = ET.fromstring(xml_text)
    body = next((el for el in root.iter() if _local(el.tag) == "Body"), root)
    response = next(
        (el for el in body.iter() if _local(el.tag) == f"{method}Response"),
        body,
    )
    result_el = next(
        (el for el in response.iter() if _local(el.tag) == f"{method}Result"),
        None,
    )
    session_el = next((el for el in response.iter() if _local(el.tag) == "SessionId"), None)
    error_el = next((el for el in response.iter() if _local(el.tag) == "Foutmelding"), None)
    records_el = next((el for el in response.iter() if _local(el.tag) == "Records"), None)
    primary_el = next((el for el in response.iter() if _local(el.tag) == "Primarykey"), None)
    primary_keys: list[str] = []
    if primary_el is not None:
        direct = _element_text(primary_el)
        if direct:
            primary_keys.append(direct)
        primary_keys.extend(
            text for child in primary_el if (text := (child.text or "").strip())
        )
    return {
        "ok": _truthy(_element_text(result_el)) if result_el is not None else True,
        "session_id": _element_text(session_el),
        "error": _element_text(error_el),
        "rows": parse_dataset_rows(records_el),
        "primary_keys": primary_keys,
    }


async def _soap_call(
    method: str,
    fields: dict[str, str],
    *,
    selectie_xml: str | None = None,
    base_url: str,
) -> dict[str, Any]:
    envelope = _soap_envelope(method, fields, selectie_xml)
    headers = {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": f'"{KING_SOAP_NS}{method}"',
    }
    async with _http_client() as client:
        response = await client.post(base_url, content=envelope.encode("utf-8"), headers=headers)
        response.raise_for_status()
        return parse_soap_response(response.text, method)


def _write_envelope(
    method: str,
    session_fields: dict[str, str],
    dataset_field: str,
    dataset_xml: str,
    *,
    include_primarykey: bool,
) -> str:
    """SOAP envelope for Cloudswitch write methods.

    Writes take a named dataset (Journaalpost / Stamtabel / Mutatie) as a
    CDATA string, plus ByRef Primarykey (create methods) and Foutmelding.
    """
    parts = [f"      <{name}>{escape(value)}</{name}>" for name, value in session_fields.items()]
    parts.append(f"      <{dataset_field}><![CDATA[{dataset_xml}]]></{dataset_field}>")
    if include_primarykey:
        parts.append("      <Primarykey />")
    parts.append("      <Foutmelding></Foutmelding>")
    inner = "\n".join(parts)
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        f'<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        f'xmlns:xsd="http://www.w3.org/2001/XMLSchema" '
        f'xmlns:soap="{KING_SOAPENV}">'
        f"<soap:Body>"
        f'<{method} xmlns="{KING_SOAP_NS}">'
        f"{inner}"
        f"</{method}>"
        f"</soap:Body></soap:Envelope>"
    )


async def _soap_write(
    method: str,
    session_fields: dict[str, str],
    *,
    dataset_field: str,
    dataset_xml: str,
    include_primarykey: bool,
    base_url: str,
) -> dict[str, Any]:
    envelope = _write_envelope(
        method,
        session_fields,
        dataset_field,
        dataset_xml,
        include_primarykey=include_primarykey,
    )
    headers = {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": f'"{KING_SOAP_NS}{method}"',
    }
    async with _http_client() as client:
        response = await client.post(base_url, content=envelope.encode("utf-8"), headers=headers)
        response.raise_for_status()
        return parse_soap_response(response.text, method)


def _stamtabel_dataset(
    table: str,
    fields: dict[str, Any],
    *,
    where: tuple[str, str, str] | None = None,
) -> str:
    """METADATA + DATA dataset for Create/UpdateStamTabelRecord."""
    meta_cells = [f"<TABLE>{escape(table)}</TABLE>"]
    if where is not None:
        meta_cells.append(f"<WHEREFIELDS>{escape(where[0])}</WHEREFIELDS>")
        meta_cells.append(f"<WHEREOPERATORS>{escape(where[1])}</WHEREOPERATORS>")
        meta_cells.append(f"<WHEREVALUES>{escape(where[2])}</WHEREVALUES>")
    data_cells = [
        f"<{name}>{escape(str(value))}</{name}>"
        for name, value in fields.items()
        if str(value or "").strip()
    ]
    return (
        f"<NewDataSet><METADATA>{''.join(meta_cells)}</METADATA>"
        f"<DATA>{''.join(data_cells)}</DATA></NewDataSet>"
    )


def _journaalpost_dataset(rows: list[dict[str, Any]]) -> str:
    """BOE dataset for CreateJournaalpost (one <BOE> element per datarow)."""
    parts: list[str] = []
    for row in rows:
        cells = "".join(
            f"<{name}>{escape(str(value))}</{name}>"
            for name, value in row.items()
            if str(value if value is not None else "").strip()
        )
        parts.append(f"<BOE>{cells}</BOE>")
    return f"<NewDataSet>{''.join(parts)}</NewDataSet>"


async def _login(partner_key: str, omgevingscode: str, base_url: str) -> str:
    cached = _session_cache.get((partner_key, omgevingscode))
    if cached and cached[1] > time.time() + 30:
        return cached[0]
    parsed = await _soap_call(
        "Login",
        {
            "PartnerKey": partner_key,
            "Omgevingscode": omgevingscode,
            "SessionId": "",
            "Foutmelding": "",
        },
        base_url=base_url,
    )
    if not parsed["ok"] or not parsed["session_id"]:
        raise RuntimeError(parsed["error"] or "KING Finance Login failed")
    _session_cache[(partner_key, omgevingscode)] = (
        parsed["session_id"],
        time.time() + _SESSION_TTL_SEC,
    )
    return parsed["session_id"]


def _filter_rows(rows: list[dict[str, str]], query: str, fields: tuple[str, ...]) -> list[dict[str, str]]:
    if not query:
        return rows
    needle = query.lower()
    return [
        row
        for row in rows
        if any(needle in str(row.get(field, "")).lower() for field in fields)
    ]


async def validate_credentials(auth: dict[str, Any]) -> dict[str, Any]:
    """Health-check stored administraties without requiring a full tool call."""
    partner_key = resolve_partner_key(auth)
    admins = parse_administraties(auth)
    if not partner_key and not admins:
        return {"ok": True, "note": "credentials_pending"}
    if not partner_key:
        return {"ok": True, "note": "partnerkey_pending"}
    if not admins:
        return {"ok": True, "note": "administraties_pending"}
    base_url = str(auth.get("base_url") or get_settings().king_finance_base_url or KING_DEFAULT_URL)
    try:
        await _login(partner_key, admins[0]["omgevingscode"], base_url)
    except Exception as exc:
        return {"ok": False, "error": f"KING Finance authentication failed: {exc}"}
    return {"ok": True}


async def call_king_tool(
    auth: dict[str, Any], tool_name: str, arguments: dict[str, Any]
) -> dict[str, Any]:
    """Execute one KING Cloudswitch tool.

    Reads are agent-visible (``KING_NATIVE_TOOLS``); write tools
    (``KING_WRITE_TOOL_NAMES``) are only reachable through the accounting
    module apply path. Returns ``{"result": ...}`` or ``{"error": ...}``.
    """
    if tool_name == "list_companies":
        return {"result": public_companies(auth)}

    known = {t["name"] for t in KING_NATIVE_TOOLS} | KING_WRITE_TOOL_NAMES
    if tool_name not in known:
        return {"error": f"Unknown KING Accountancy tool: {tool_name}"}

    partner_key = resolve_partner_key(auth)
    if not partner_key:
        return {"error": MISSING_PARTNER_KEY_ERROR}
    if not parse_administraties(auth):
        return {"error": MISSING_CREDENTIALS_ERROR}

    company_id = str(arguments.get("company_id") or "").strip()
    admin = resolve_administratie(auth, company_id)
    if admin is None:
        return {"error": MISSING_ADMIN_ERROR}

    logger.info("king_finance tool=%s administratie_id=%s", tool_name, admin["id"])
    base_url = str(auth.get("base_url") or get_settings().king_finance_base_url or KING_DEFAULT_URL)

    try:
        session_id = await _login(partner_key, admin["omgevingscode"], base_url)
    except Exception as exc:
        return {"error": f"KING Finance authentication failed: {exc}"}

    session_fields = {
        "PartnerKey": partner_key,
        "Omgevingscode": admin["omgevingscode"],
        "SessionId": session_id,
    }

    try:
        if tool_name == "get_company_details":
            parsed = await _soap_call(
                "GetAdmInfo",
                session_fields,
                selectie_xml=_dataset_selectie(
                    table="BASALG",
                    select_fields="NAAM\tNAAM2\tADRES\tPOSTCD\tPLAATS\tLAND\tBTWNR",
                ),
                base_url=base_url,
            )
            if not parsed["ok"]:
                return {"error": parsed["error"] or "GetAdmInfo failed"}
            details = parsed["rows"][0] if parsed["rows"] else {}
            display_name = str(details.get("NAAM") or admin["name"])
            return {
                "result": {
                    "company_id": admin["id"],
                    "name": display_name,
                    **details,
                }
            }

        if tool_name in ("search_customers", "get_customer"):
            customer_id = str(arguments.get("customer_id") or arguments.get("id") or "").strip()
            query = str(arguments.get("query") or arguments.get("name") or "").strip()
            where = ("NR", "=", customer_id) if tool_name == "get_customer" and customer_id else ("", "", "")
            parsed = await _soap_call(
                "GetStamtabelRecords",
                session_fields,
                selectie_xml=_dataset_selectie(
                    table="DEB",
                    select_fields="NR\tNAAM\tEMAIL\tSTRAAT\tPLAATS\tPOSTCD",
                    where_fields=where[0],
                    where_operators=where[1],
                    where_values=where[2],
                    order_by="NAAM",
                ),
                base_url=base_url,
            )
            if not parsed["ok"]:
                return {"error": parsed["error"] or "GetStamtabelRecords(DEB) failed"}
            rows = parsed["rows"]
            if tool_name == "search_customers":
                rows = _filter_rows(rows, query, ("NAAM", "EMAIL", "NR", "ZKSL"))
            elif not rows:
                return {"error": f"Customer {customer_id or query} not found"}
            return {"result": rows[0] if tool_name == "get_customer" else rows}

        if tool_name == "list_suppliers":
            query = str(arguments.get("query") or arguments.get("name") or "").strip()
            parsed = await _soap_call(
                "GetStamtabelRecords",
                session_fields,
                selectie_xml=_dataset_selectie(
                    table="CRED",
                    select_fields="NR\tNAAM\tEMAIL\tSTRAAT\tPLAATS\tPOSTCD",
                    order_by="NAAM",
                ),
                base_url=base_url,
            )
            if not parsed["ok"]:
                return {"error": parsed["error"] or "GetStamtabelRecords(CRED) failed"}
            return {"result": _filter_rows(parsed["rows"], query, ("NAAM", "EMAIL", "NR"))}

        if tool_name in ("list_accounts", "get_account_balance"):
            account = str(
                arguments.get("account") or arguments.get("account_id") or arguments.get("id") or ""
            ).strip()
            where = ("NR", "=", account) if tool_name == "get_account_balance" and account else ("", "", "")
            parsed = await _soap_call(
                "GetStamtabelRecords",
                session_fields,
                selectie_xml=_dataset_selectie(
                    table="GRB",
                    select_fields="NR\tOMSCHR",
                    where_fields=where[0],
                    where_operators=where[1],
                    where_values=where[2],
                    order_by="NR",
                ),
                base_url=base_url,
            )
            if not parsed["ok"]:
                return {"error": parsed["error"] or "GetStamtabelRecords(GRB) failed"}
            rows = parsed["rows"]
            if tool_name == "get_account_balance":
                if not rows:
                    return {"error": f"Account {account} not found"}
                return {"result": rows[0]}
            return {"result": rows}

        if tool_name == "list_recent_bookings":
            # These endpoints accept an empty NewDataSet selection.
            empty_selectie = "<NewDataSet><Table1></Table1></NewDataSet>"
            dates = await _soap_call(
                "GetDatumLaatsteBoekingen",
                {"PartnerKey": partner_key},
                selectie_xml=empty_selectie,
                base_url=base_url,
            )
            period = await _soap_call(
                "GetLaatsteBoekingPeriode",
                session_fields,
                selectie_xml=empty_selectie,
                base_url=base_url,
            )
            if not dates["ok"] and not period["ok"]:
                return {
                    "error": dates["error"] or period["error"] or "Recent bookings lookup failed"
                }
            return {
                "result": {
                    "company_id": admin["id"],
                    "last_booking_dates": dates["rows"] if dates["ok"] else [],
                    "last_booking_period": period["rows"] if period["ok"] else [],
                    "errors": [e for e in (dates.get("error"), period.get("error")) if e],
                }
            }

        if tool_name == "create_journal_entry":
            rows = arguments.get("rows") or []
            if not isinstance(rows, list) or not rows:
                return {"error": "create_journal_entry requires prepared BOE rows"}
            parsed = await _soap_write(
                "CreateJournaalpost",
                session_fields,
                dataset_field="Journaalpost",
                dataset_xml=_journaalpost_dataset(rows),
                include_primarykey=True,
                base_url=base_url,
            )
            if not parsed["ok"]:
                return {"error": parsed["error"] or "CreateJournaalpost failed"}
            return {
                "result": {
                    "company_id": admin["id"],
                    "created": True,
                    "primary_keys": parsed.get("primary_keys") or [],
                }
            }

        if tool_name in ("create_party", "update_party"):
            table = "CRED" if str(arguments.get("role") or "") == "supplier" else "DEB"
            fields = arguments.get("fields") or {}
            if not isinstance(fields, dict) or not fields:
                return {"error": f"{tool_name} requires a fields mapping"}
            if tool_name == "create_party":
                parsed = await _soap_write(
                    "CreateStamTabelRecord",
                    session_fields,
                    dataset_field="Stamtabel",
                    dataset_xml=_stamtabel_dataset(table, fields),
                    include_primarykey=True,
                    base_url=base_url,
                )
                if not parsed["ok"]:
                    return {"error": parsed["error"] or "CreateStamTabelRecord failed"}
                keys = parsed.get("primary_keys") or []
                return {
                    "result": {
                        "company_id": admin["id"],
                        "created": True,
                        "party_number": keys[0] if keys else "",
                        "primary_keys": keys,
                    }
                }
            number = str(arguments.get("party_id") or "").strip()
            if not number:
                return {"error": "update_party requires party_id (NR)"}
            parsed = await _soap_write(
                "UpdateStamtabelRecord",
                session_fields,
                dataset_field="Mutatie",
                dataset_xml=_stamtabel_dataset(table, fields, where=("NR", "=", number)),
                include_primarykey=False,
                base_url=base_url,
            )
            if not parsed["ok"]:
                return {"error": parsed["error"] or "UpdateStamtabelRecord failed"}
            return {
                "result": {
                    "company_id": admin["id"],
                    "updated": True,
                    "party_number": number,
                }
            }
    except httpx.HTTPStatusError as exc:
        detail = (exc.response.text or "").strip()[:300] if exc.response is not None else str(exc)
        if not detail and exc.response is not None:
            detail = f"(empty body, status={exc.response.status_code})"
        return {"error": f"KING Finance API error ({exc.response.status_code}): {detail}"}
    except Exception as exc:
        return {"error": f"KING Finance API request failed: {exc}"}

    return {"error": f"Unknown KING Accountancy tool: {tool_name}"}
