"""Live smoke against KING Finance Cloudswitch.

Reads partnerkey + test omgevingscode from env (apps/api/.env or process env).
Never prints full secrets — only first4…last4 on errors.

Usage (from apps/api):
  uv run python scripts/dev/smoke_king_cloudswitch.py

Env:
  KING_FINANCE_PARTNER_KEY          required
  KING_FINANCE_TEST_OMGEVINGSCODE   required for this smoke
  KING_FINANCE_TEST_ADM_NAME        optional display name
  KING_FINANCE_BASE_URL             optional SOAP endpoint
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

# Load apps/api/.env without requiring dotenv package.
_ENV_PATH = Path(__file__).resolve().parents[2] / ".env"


def _load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def _redact(value: str) -> str:
    value = value.strip()
    if len(value) <= 8:
        return "****"
    return f"{value[:4]}…{value[-4:]}"


async def main() -> int:
    _load_dotenv(_ENV_PATH)

    partner_key = os.environ.get("KING_FINANCE_PARTNER_KEY", "").strip()
    omgevingscode = os.environ.get("KING_FINANCE_TEST_OMGEVINGSCODE", "").strip()
    adm_name = (
        os.environ.get("KING_FINANCE_TEST_ADM_NAME", "").strip()
        or "2635 - Demo CSW - KweshDigital (01)"
    )
    base_url = os.environ.get(
        "KING_FINANCE_BASE_URL", "https://api.kingfinance.nl/v1/ws1_xml.asmx"
    ).strip()

    if not partner_key:
        print("FAIL: set KING_FINANCE_PARTNER_KEY in apps/api/.env")
        return 1
    if not omgevingscode:
        print("FAIL: set KING_FINANCE_TEST_OMGEVINGSCODE in apps/api/.env")
        return 1

    print("KING Cloudswitch smoke")
    print(f"  base_url:     {base_url}")
    print(f"  partnerkey:   {_redact(partner_key)}")
    print(f"  omgevingscode:{_redact(omgevingscode)}")
    print(f"  adm_name:     {adm_name}")

    from app.services import king_finance as kf
    from app.services.king_finance import call_king_tool

    kf._session_cache.clear()
    auth = {
        "partner_key": partner_key,
        "base_url": base_url,
        "administraties": [
            {
                "id": "adm-smoke-2635",
                "name": adm_name,
                "omgevingscode": omgevingscode,
                "adm_nr": "2635",
            }
        ],
    }

    # 1) Login + GetAdmInfo
    print("\n[1/3] get_company_details (Login + GetAdmInfo)…")
    details = await call_king_tool(
        auth, "get_company_details", {"company_id": "adm-smoke-2635"}
    )
    if details.get("error"):
        err = str(details["error"])
        print(f"FAIL: {err}")
        lowered = err.lower()
        if any(token in lowered for token in ("ip", "allow", "toegang", "forbidden", "401", "403")):
            print(
                "HINT: partnerkey may be IP-allowlisted. Ask BL partner support to "
                "allowlist this machine's outbound IP (or run from the VPS)."
            )
        return 1
    result = details.get("result") or {}
    name = result.get("name") or result.get("NAAM") or adm_name
    plaats = result.get("PLAATS") or result.get("plaats") or ""
    print(f"OK: Login + GetAdmInfo — name={name!r} plaats={plaats!r}")

    # 2) Debtors
    print("\n[2/3] search_customers (DEB)…")
    customers = await call_king_tool(
        auth, "search_customers", {"company_id": "adm-smoke-2635", "query": ""}
    )
    if customers.get("error"):
        print(f"FAIL: {customers['error']}")
        return 1
    rows = customers.get("result") or []
    print(f"OK: DEB rows={len(rows)}")
    for row in rows[:3]:
        if isinstance(row, dict):
            print(f"  - NR={row.get('NR')} NAAM={row.get('NAAM')}")

    # 3) list_companies (local metadata only)
    print("\n[3/3] list_companies…")
    listed = await call_king_tool(auth, "list_companies", {})
    if listed.get("error"):
        print(f"FAIL: {listed['error']}")
        return 1
    companies = listed.get("result") or []
    print(f"OK: companies={len(companies)} ids={[c.get('id') for c in companies]}")

    print("\nOK: KING Cloudswitch live smoke passed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as exc:  # noqa: BLE001 — smoke should show the raw failure
        print(f"FAIL: {type(exc).__name__}: {exc}")
        msg = str(exc).lower()
        if any(token in msg for token in ("ip", "allow", "forbidden", "401", "403")):
            print(
                "HINT: check IP allowlist with Bjorn Lunden partner support "
                "(share first4…last4 of partnerkey only)."
            )
        raise SystemExit(1) from exc
