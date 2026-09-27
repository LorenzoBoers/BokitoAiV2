"""Native Alpaca Trading API integration (MCP-shaped tools).

Talks directly to Alpaca's REST APIs — no separate MCP sidecar. Tenants install
the ``alpaca_mcp`` marketplace provider, which registers an McpServer row with
``native://alpaca``. Tool names match the official Alpaca MCP server so agent
prompts and docs stay aligned.

Auth: ``APCA-API-KEY-ID`` / ``APCA-API-SECRET-KEY`` from Trading API keys.
Default endpoint is paper trading (``paper=true``).
"""

from __future__ import annotations

from typing import Any

import httpx

ALPACA_NATIVE_URL = "native://alpaca"
ALPACA_PAPER_BASE = "https://paper-api.alpaca.markets"
ALPACA_LIVE_BASE = "https://api.alpaca.markets"
ALPACA_DATA_BASE = "https://data.alpaca.markets"

MISSING_CREDENTIALS_ERROR = (
    "Alpaca credentials are not configured. Open Connections, connect Alpaca, "
    "and paste your Trading API key ID and secret key (paper keys are fine)."
)

# Subset of the official Alpaca MCP tool catalog (same names / intent).
ALPACA_NATIVE_TOOLS: list[dict[str, str]] = [
    {"name": "get_account_info", "description": "Account balances, buying power, margin, and status"},
    {"name": "get_account_config", "description": "Trading restrictions and margin settings"},
    {"name": "get_portfolio_history", "description": "Equity and P/L over time"},
    {"name": "get_account_activities", "description": "Fills, dividends, transfers, and other activities"},
    {"name": "place_stock_order", "description": "Place a stock/ETF order (market, limit, stop, stop-limit, trailing stop)"},
    {"name": "place_crypto_order", "description": "Place a crypto order (market, limit, stop-limit)"},
    {"name": "get_orders", "description": "List orders with optional status/side/symbol filters"},
    {"name": "get_order_by_id", "description": "Fetch a single order by Alpaca order id"},
    {"name": "cancel_order_by_id", "description": "Cancel one open order by id"},
    {"name": "cancel_all_orders", "description": "Cancel all open orders"},
    {"name": "get_all_positions", "description": "List all open positions"},
    {"name": "get_open_position", "description": "Details for one open position by symbol"},
    {"name": "close_position", "description": "Close a position (full or partial qty/percentage)"},
    {"name": "close_all_positions", "description": "Liquidate all positions"},
    {"name": "get_clock", "description": "Current market open/close status"},
    {"name": "get_calendar", "description": "Market calendar for a date range"},
    {"name": "get_asset", "description": "Asset details for a symbol"},
    {"name": "get_stock_snapshot", "description": "Stock snapshot (latest trade, quote, bars)"},
    {"name": "get_stock_bars", "description": "Historical stock OHLCV bars"},
    {"name": "get_stock_latest_quote", "description": "Latest stock bid/ask quote"},
    {"name": "get_crypto_snapshot", "description": "Crypto snapshot for a symbol"},
    {"name": "get_news", "description": "News articles for symbols"},
    {"name": "get_watchlists", "description": "List watchlists"},
    {"name": "create_watchlist", "description": "Create a watchlist with optional symbols"},
]

_transport: httpx.AsyncBaseTransport | None = None


def _http_client(**kwargs: Any) -> httpx.AsyncClient:
    if _transport is not None:
        kwargs["transport"] = _transport
    kwargs.setdefault("timeout", 20.0)
    return httpx.AsyncClient(**kwargs)


def parse_alpaca_credentials(auth: dict[str, Any]) -> dict[str, Any]:
    """Extract Alpaca credentials from a connection auth payload.

    Accepts ``api_key_id`` / ``api_secret_key`` (or ``secret_key``), plus
    ``paper`` (default true). Combined ``api_key`` as ``key_id:secret`` also works.
    """
    key_id = str(
        auth.get("api_key_id") or auth.get("ALPACA_API_KEY") or auth.get("key_id") or ""
    ).strip()
    secret = str(
        auth.get("api_secret_key")
        or auth.get("secret_key")
        or auth.get("ALPACA_SECRET_KEY")
        or ""
    ).strip()
    combined = str(auth.get("api_key") or "").strip()
    if (not key_id or not secret) and ":" in combined:
        left, right = combined.split(":", 1)
        key_id = key_id or left.strip()
        secret = secret or right.strip()
    paper_raw = auth.get("paper")
    if paper_raw is None:
        paper_raw = auth.get("ALPACA_PAPER_TRADE", True)
    if isinstance(paper_raw, str):
        paper = paper_raw.strip().lower() not in ("0", "false", "no", "live")
    else:
        paper = bool(paper_raw)
    return {"api_key_id": key_id, "api_secret_key": secret, "paper": paper}


def has_alpaca_credentials(auth: dict[str, Any]) -> bool:
    creds = parse_alpaca_credentials(auth)
    return bool(creds["api_key_id"] and creds["api_secret_key"])


def _trading_base(creds: dict[str, Any], auth: dict[str, Any]) -> str:
    override = str(auth.get("base_url") or "").strip().rstrip("/")
    if override:
        return override
    return ALPACA_PAPER_BASE if creds["paper"] else ALPACA_LIVE_BASE


def _data_base(auth: dict[str, Any]) -> str:
    return str(auth.get("data_base_url") or ALPACA_DATA_BASE).rstrip("/")


def _headers(creds: dict[str, Any]) -> dict[str, str]:
    return {
        "APCA-API-KEY-ID": creds["api_key_id"],
        "APCA-API-SECRET-KEY": creds["api_secret_key"],
        "Accept": "application/json",
    }


async def validate_credentials(auth: dict[str, Any]) -> dict[str, Any]:
    """Health-check stored keys via GET /v2/account."""
    if not has_alpaca_credentials(auth):
        return {"ok": True, "note": "credentials_pending"}
    creds = parse_alpaca_credentials(auth)
    base = _trading_base(creds, auth)
    try:
        async with _http_client() as client:
            response = await client.get(f"{base}/v2/account", headers=_headers(creds))
            response.raise_for_status()
            body = response.json()
    except Exception as exc:
        return {"ok": False, "error": f"Alpaca authentication failed: {exc}"}
    identity = str(body.get("account_number") or body.get("id") or creds["api_key_id"])
    return {"ok": True, "identity": identity, "paper": creds["paper"]}


def _s(args: dict[str, Any], *keys: str, default: str = "") -> str:
    for key in keys:
        val = args.get(key)
        if val is not None and str(val).strip():
            return str(val).strip()
    return default


async def _request(
    method: str,
    url: str,
    *,
    headers: dict[str, str],
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    clean_params = {k: v for k, v in (params or {}).items() if v is not None and v != ""}
    try:
        async with _http_client() as client:
            response = await client.request(
                method,
                url,
                headers=headers,
                params=clean_params or None,
                json=json_body,
            )
            response.raise_for_status()
            if not response.content:
                return {"result": {"ok": True}}
            return {"result": response.json()}
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:400] if exc.response is not None else str(exc)
        return {"error": f"Alpaca API error ({exc.response.status_code}): {detail}"}
    except Exception as exc:
        return {"error": f"Alpaca API request failed: {exc}"}


def _order_body(args: dict[str, Any], *, asset_class: str | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {
        "symbol": _s(args, "symbol"),
        "side": _s(args, "side", default="buy").lower(),
        "type": _s(args, "type", "order_type", default="market").lower(),
        "time_in_force": _s(args, "time_in_force", "tif", default="day").lower(),
    }
    qty = args.get("qty") if args.get("qty") is not None else args.get("quantity")
    notional = args.get("notional")
    if qty is not None and str(qty).strip():
        body["qty"] = str(qty).strip()
    elif notional is not None and str(notional).strip():
        body["notional"] = str(notional).strip()
    for key in (
        "limit_price",
        "stop_price",
        "trail_price",
        "trail_percent",
        "client_order_id",
        "extended_hours",
        "order_class",
        "take_profit",
        "stop_loss",
    ):
        if key in args and args[key] is not None:
            body[key] = args[key]
    if asset_class:
        body["asset_class"] = asset_class
    return body


async def call_alpaca_tool(
    auth: dict[str, Any], tool_name: str, arguments: dict[str, Any] | None
) -> dict[str, Any]:
    """Execute one Alpaca tool against the live Trading / Market Data APIs."""
    args = arguments if isinstance(arguments, dict) else {}
    if not has_alpaca_credentials(auth):
        return {"error": MISSING_CREDENTIALS_ERROR}

    creds = parse_alpaca_credentials(auth)
    trading = _trading_base(creds, auth)
    data = _data_base(auth)
    headers = _headers(creds)

    if tool_name == "get_account_info":
        return await _request("GET", f"{trading}/v2/account", headers=headers)

    if tool_name == "get_account_config":
        return await _request("GET", f"{trading}/v2/account/configurations", headers=headers)

    if tool_name == "get_portfolio_history":
        return await _request(
            "GET",
            f"{trading}/v2/account/portfolio/history",
            headers=headers,
            params={
                "period": _s(args, "period") or None,
                "timeframe": _s(args, "timeframe") or None,
                "intraday_reporting": _s(args, "intraday_reporting") or None,
            },
        )

    if tool_name == "get_account_activities":
        return await _request(
            "GET",
            f"{trading}/v2/account/activities",
            headers=headers,
            params={
                "activity_types": _s(args, "activity_types", "type") or None,
                "after": _s(args, "after") or None,
                "until": _s(args, "until") or None,
                "direction": _s(args, "direction") or None,
                "page_size": args.get("page_size"),
            },
        )

    if tool_name == "place_stock_order":
        body = _order_body(args)
        if not body.get("symbol"):
            return {"error": "place_stock_order requires symbol"}
        if not body.get("qty") and not body.get("notional"):
            return {"error": "place_stock_order requires qty or notional"}
        return await _request("POST", f"{trading}/v2/orders", headers=headers, json_body=body)

    if tool_name == "place_crypto_order":
        body = _order_body(args)
        if not body.get("symbol"):
            return {"error": "place_crypto_order requires symbol"}
        if not body.get("qty") and not body.get("notional"):
            return {"error": "place_crypto_order requires qty or notional"}
        return await _request("POST", f"{trading}/v2/orders", headers=headers, json_body=body)

    if tool_name == "get_orders":
        return await _request(
            "GET",
            f"{trading}/v2/orders",
            headers=headers,
            params={
                "status": _s(args, "status", default="open") or None,
                "limit": args.get("limit"),
                "direction": _s(args, "direction") or None,
                "symbols": _s(args, "symbols", "symbol") or None,
                "side": _s(args, "side") or None,
            },
        )

    if tool_name == "get_order_by_id":
        order_id = _s(args, "order_id", "id")
        if not order_id:
            return {"error": "get_order_by_id requires order_id"}
        return await _request("GET", f"{trading}/v2/orders/{order_id}", headers=headers)

    if tool_name == "cancel_order_by_id":
        order_id = _s(args, "order_id", "id")
        if not order_id:
            return {"error": "cancel_order_by_id requires order_id"}
        return await _request("DELETE", f"{trading}/v2/orders/{order_id}", headers=headers)

    if tool_name == "cancel_all_orders":
        return await _request("DELETE", f"{trading}/v2/orders", headers=headers)

    if tool_name == "get_all_positions":
        return await _request("GET", f"{trading}/v2/positions", headers=headers)

    if tool_name == "get_open_position":
        symbol = _s(args, "symbol")
        if not symbol:
            return {"error": "get_open_position requires symbol"}
        return await _request("GET", f"{trading}/v2/positions/{symbol}", headers=headers)

    if tool_name == "close_position":
        symbol = _s(args, "symbol")
        if not symbol:
            return {"error": "close_position requires symbol"}
        return await _request(
            "DELETE",
            f"{trading}/v2/positions/{symbol}",
            headers=headers,
            params={
                "qty": str(args["qty"]) if args.get("qty") is not None else None,
                "percentage": str(args["percentage"]) if args.get("percentage") is not None else None,
            },
        )

    if tool_name == "close_all_positions":
        return await _request(
            "DELETE",
            f"{trading}/v2/positions",
            headers=headers,
            params={"cancel_orders": args.get("cancel_orders")},
        )

    if tool_name == "get_clock":
        return await _request("GET", f"{trading}/v2/clock", headers=headers)

    if tool_name == "get_calendar":
        return await _request(
            "GET",
            f"{trading}/v2/calendar",
            headers=headers,
            params={"start": _s(args, "start") or None, "end": _s(args, "end") or None},
        )

    if tool_name == "get_asset":
        symbol = _s(args, "symbol")
        if not symbol:
            return {"error": "get_asset requires symbol"}
        return await _request("GET", f"{trading}/v2/assets/{symbol}", headers=headers)

    if tool_name == "get_stock_snapshot":
        symbols = _s(args, "symbols", "symbol")
        if not symbols:
            return {"error": "get_stock_snapshot requires symbol or symbols"}
        return await _request(
            "GET",
            f"{data}/v2/stocks/snapshots",
            headers=headers,
            params={"symbols": symbols},
        )

    if tool_name == "get_stock_bars":
        symbols = _s(args, "symbols", "symbol")
        if not symbols:
            return {"error": "get_stock_bars requires symbol or symbols"}
        return await _request(
            "GET",
            f"{data}/v2/stocks/bars",
            headers=headers,
            params={
                "symbols": symbols,
                "timeframe": _s(args, "timeframe", default="1Day") or "1Day",
                "start": _s(args, "start") or None,
                "end": _s(args, "end") or None,
                "limit": args.get("limit"),
                "adjustment": _s(args, "adjustment") or None,
            },
        )

    if tool_name == "get_stock_latest_quote":
        symbols = _s(args, "symbols", "symbol")
        if not symbols:
            return {"error": "get_stock_latest_quote requires symbol or symbols"}
        return await _request(
            "GET",
            f"{data}/v2/stocks/quotes/latest",
            headers=headers,
            params={"symbols": symbols},
        )

    if tool_name == "get_crypto_snapshot":
        symbols = _s(args, "symbols", "symbol")
        if not symbols:
            return {"error": "get_crypto_snapshot requires symbol or symbols"}
        return await _request(
            "GET",
            f"{data}/v1beta3/crypto/us/snapshots",
            headers=headers,
            params={"symbols": symbols},
        )

    if tool_name == "get_news":
        return await _request(
            "GET",
            f"{data}/v1beta1/news",
            headers=headers,
            params={
                "symbols": _s(args, "symbols", "symbol") or None,
                "start": _s(args, "start") or None,
                "end": _s(args, "end") or None,
                "limit": args.get("limit"),
            },
        )

    if tool_name == "get_watchlists":
        return await _request("GET", f"{trading}/v2/watchlists", headers=headers)

    if tool_name == "create_watchlist":
        name = _s(args, "name")
        if not name:
            return {"error": "create_watchlist requires name"}
        symbols_raw = args.get("symbols") or args.get("symbol") or []
        if isinstance(symbols_raw, str):
            symbols = [s.strip() for s in symbols_raw.split(",") if s.strip()]
        elif isinstance(symbols_raw, list):
            symbols = [str(s).strip() for s in symbols_raw if str(s).strip()]
        else:
            symbols = []
        return await _request(
            "POST",
            f"{trading}/v2/watchlists",
            headers=headers,
            json_body={"name": name, "symbols": symbols},
        )

    return {"error": f"Unknown Alpaca tool: {tool_name}"}
