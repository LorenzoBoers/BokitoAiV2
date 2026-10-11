"""Sync Google Calendar / Outlook Calendar into CalendarEvent rows.

Connections live on IntegrationConnection (provider google_calendar |
outlook_calendar). One connection is one account; ``meta["calendars"]`` lists
that account's calendars with an ``enabled`` flag, and only enabled calendars
sync. ``meta["default_write_calendar"]`` is where new events land unless the
caller names another calendar.

Who sees and writes a connection follows ``connection_access`` (``use`` reads
and writes events, ``manage`` changes calendars, access and sync). Pass a
``CalendarViewer``; ``None`` means system code (worker, decision apply).

``sync_status`` is ``ok``, ``error`` or ``reconnect`` (the account needs a new
sign-in; cached events stay). Mock credentials seed demo events outside
production only.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable
from urllib.parse import quote
from uuid import UUID, uuid4

import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calendar import CalendarEvent
from app.models.integration import IntegrationConnection
from app.services import oauth_providers

logger = logging.getLogger(__name__)

CALENDAR_PROVIDERS = frozenset({"google_calendar", "outlook_calendar"})


def calendar_slug_for(
    provider: str,
    *,
    kind: str = "",
    display_name: str = "",
) -> str | None:
    """Resolve a stored provider value to google_calendar / outlook_calendar."""
    from app.services.integrations_catalog import canonical_provider_slug

    slug = canonical_provider_slug(provider)
    if slug in CALENDAR_PROVIDERS:
        return slug
    name = (display_name or "").strip().lower()
    if name.startswith("google calendar"):
        return "google_calendar"
    if name.startswith("outlook calendar"):
        return "outlook_calendar"
    if (kind or "").strip().lower() != "calendar":
        return None
    if "outlook" in name or "microsoft" in name:
        return "outlook_calendar"
    if "google" in name:
        return "google_calendar"
    return None


def _calendar_slug(conn: IntegrationConnection) -> str | None:
    return calendar_slug_for(conn.provider, kind=conn.kind, display_name=conn.display_name)


GOOGLE_API = "https://www.googleapis.com/calendar/v3"
GOOGLE_EVENTS_URL = GOOGLE_API + "/calendars/{cal}/events"
GOOGLE_CALENDARS_URL = GOOGLE_API + "/users/me/calendarList"
GRAPH_API = "https://graph.microsoft.com/v1.0"
GRAPH_CALENDARS_URL = GRAPH_API + "/me/calendars"
GRAPH_EVENT_URL = GRAPH_API + "/me/events/{id}"
# Graph returns wall-clock times in this zone; UTC keeps start/end naive-UTC.
GRAPH_TZ_HEADER = {"Prefer": 'outlook.timezone="UTC"'}

SYNC_WINDOW_PAST_DAYS = 7
SYNC_WINDOW_FUTURE_DAYS = 60

RECONNECT_MESSAGE = "Sign in again to keep this calendar in sync."
MOCK_CALENDAR = {
    "id": "primary",
    "name": "Primary",
    "color": "",
    "primary": True,
    "writable": True,
    "enabled": True,
}


class CalendarAuthError(Exception):
    """The provider rejected the access token (HTTP 401)."""


class CalendarReconnectError(ValueError):
    """The connection has no usable token; the operator must sign in again."""

    def __init__(self) -> None:
        super().__init__(RECONNECT_MESSAGE)


@dataclass(frozen=True)
class CalendarViewer:
    """Who is looking: a person (with workspace role) or an agent."""

    user_id: UUID | None = None
    role: str = ""
    agent_id: UUID | None = None


def viewer_for_tool(ctx: Any) -> CalendarViewer | None:
    """Agents see what their access allows; a personal assistant sees what its
    person sees. ``None`` (no agent, no user) is system code."""
    agent = getattr(ctx, "agent", None)
    user_id = getattr(ctx, "user_id", None)
    role = getattr(ctx, "user_role", None) or ""
    if agent is not None and getattr(agent, "acts_for_user", False) and user_id:
        return CalendarViewer(user_id=user_id, role=role)
    if agent is not None and getattr(agent, "id", None):
        return CalendarViewer(agent_id=agent.id)
    if user_id:
        return CalendarViewer(user_id=user_id, role=role)
    return None


def _parse_json(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except (TypeError, json.JSONDecodeError):
        return {}


def _iso_naive(dt: datetime) -> datetime:
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _mock_allowed() -> bool:
    from app.config import get_settings

    return not get_settings().is_production


def _expiry_ts(value: Any) -> float | None:
    """``expires_at`` as a UTC timestamp; accepts epoch numbers and ISO strings
    (naive ISO is UTC, as ``oauth_flow`` writes it)."""
    if isinstance(value, bool) or value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        try:
            return float(value)
        except (TypeError, ValueError):
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def all_day_span(start_at: datetime, end_at: datetime) -> tuple[datetime, datetime]:
    """Midnight start and exclusive midnight end for an all-day event."""
    start = _iso_naive(start_at).replace(hour=0, minute=0, second=0, microsecond=0)
    end = _iso_naive(end_at)
    end_midnight = end.replace(hour=0, minute=0, second=0, microsecond=0)
    if end <= start:
        return start, start + timedelta(days=1)
    if end == end_midnight:
        return start, end
    return start, end_midnight + timedelta(days=1)


def _google_bounds(start: datetime, end: datetime, *, all_day: bool) -> tuple[dict[str, str], dict[str, str]]:
    if all_day:
        return {"date": start.date().isoformat()}, {"date": end.date().isoformat()}
    return (
        {"dateTime": start.isoformat() + "Z", "timeZone": "UTC"},
        {"dateTime": end.isoformat() + "Z", "timeZone": "UTC"},
    )


def _graph_bounds(start: datetime, end: datetime, *, all_day: bool) -> tuple[dict[str, str], dict[str, str]]:
    if all_day:
        fmt = "%Y-%m-%dT00:00:00"
        return (
            {"dateTime": start.strftime(fmt), "timeZone": "UTC"},
            {"dateTime": end.strftime(fmt), "timeZone": "UTC"},
        )
    return (
        {"dateTime": start.isoformat(), "timeZone": "UTC"},
        {"dateTime": end.isoformat(), "timeZone": "UTC"},
    )


def _parse_google_dt(value: dict[str, Any] | None) -> tuple[datetime, bool]:
    if not isinstance(value, dict):
        return datetime.utcnow(), False
    if value.get("date"):
        day = datetime.strptime(str(value["date"])[:10], "%Y-%m-%d")
        return day, True
    raw = str(value.get("dateTime") or "")
    if not raw:
        return datetime.utcnow(), False
    normalized = raw.replace("Z", "+00:00")
    try:
        return _iso_naive(datetime.fromisoformat(normalized)), False
    except ValueError:
        return datetime.utcnow(), False


def _parse_graph_dt(value: dict[str, Any] | None, *, all_day: bool) -> datetime:
    if not isinstance(value, dict):
        return datetime.utcnow()
    raw = str(value.get("dateTime") or "")
    if not raw:
        return datetime.utcnow()
    if all_day and "T" not in raw:
        return datetime.strptime(raw[:10], "%Y-%m-%d")
    normalized = raw.replace("Z", "+00:00")
    try:
        # Naive values are UTC because every request sends GRAPH_TZ_HEADER.
        if "+" not in normalized:
            return datetime.fromisoformat(normalized[:19])
        return _iso_naive(datetime.fromisoformat(normalized))
    except ValueError:
        return datetime.utcnow()


def _check(resp: httpx.Response) -> None:
    if resp.status_code == 401:
        raise CalendarAuthError(f"{resp.request.url.host} returned 401")
    resp.raise_for_status()


def _error_text(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        body = ""
        try:
            body = exc.response.text or ""
        except Exception:
            body = ""
        if exc.response.status_code == 403 and (
            "accessNotConfigured" in body or "SERVICE_DISABLED" in body
        ):
            return "The Google Calendar API is not enabled for this OAuth app."
        if exc.response.status_code == 403:
            return "The calendar provider refused access. Reconnect and accept the calendar permissions."
        return f"The calendar provider returned {exc.response.status_code}."
    if isinstance(exc, httpx.HTTPError):
        return "The calendar provider could not be reached."
    return str(exc)[:300]


async def _access_token(
    session: AsyncSession, conn: IntegrationConnection, *, force_refresh: bool = False
) -> str | None:
    from app.services.crypto import get_connection_credentials, set_connection_credentials

    creds = get_connection_credentials(conn)
    if creds.get("mock"):
        return None
    token = str(creds.get("access_token") or "").strip()
    refresh = str(creds.get("refresh_token") or "").strip()
    expiry = _expiry_ts(creds.get("expires_at"))
    now_ts = datetime.now(timezone.utc).timestamp()
    needs_refresh = force_refresh or not token or (expiry is not None and now_ts > expiry - 60)
    if not needs_refresh:
        return token
    if not refresh:
        return None if force_refresh else (token or None)
    try:
        refreshed = await oauth_providers.refresh_access_token(conn.provider, refresh_token=refresh)
    except Exception:
        logger.warning("calendar token refresh failed provider=%s conn=%s", conn.provider, conn.id)
        return None if force_refresh else (token or None)
    if not refreshed.get("access_token"):
        return None if force_refresh else (token or None)
    creds["access_token"] = refreshed["access_token"]
    if refreshed.get("refresh_token"):
        creds["refresh_token"] = refreshed["refresh_token"]
    expires_in = refreshed.get("expires_in")
    if expires_in:
        creds["expires_at"] = (datetime.utcnow() + timedelta(seconds=int(expires_in))).isoformat()
    set_connection_credentials(conn, creds)
    session.add(conn)
    await session.commit()
    return str(creds["access_token"])


async def _with_token(
    session: AsyncSession,
    conn: IntegrationConnection,
    call: Callable[[str], Awaitable[Any]],
) -> Any:
    """Run ``call(token)``; on a 401 refresh once and retry. Marks the
    connection ``reconnect`` and raises CalendarReconnectError when the
    account cannot be reached with any token."""
    token = await _access_token(session, conn)
    if not token:
        await _mark(session, conn, "reconnect", RECONNECT_MESSAGE)
        raise CalendarReconnectError()
    try:
        return await call(token)
    except CalendarAuthError:
        token = await _access_token(session, conn, force_refresh=True)
        if not token:
            await _mark(session, conn, "reconnect", RECONNECT_MESSAGE)
            raise CalendarReconnectError() from None
        try:
            return await call(token)
        except CalendarAuthError:
            await _mark(session, conn, "reconnect", RECONNECT_MESSAGE)
            raise CalendarReconnectError() from None


async def _mark(
    session: AsyncSession,
    conn: IntegrationConnection,
    status: str,
    error: str = "",
) -> None:
    meta = _parse_json(conn.metadata_json)
    meta["last_synced_at"] = datetime.utcnow().isoformat()
    meta["sync_status"] = status
    meta["sync_error"] = error
    conn.metadata_json = json.dumps(meta)
    session.add(conn)
    await session.commit()


# --- Calendars per account -------------------------------------------------


def stored_calendars(conn: IntegrationConnection) -> list[dict[str, Any]]:
    raw = _parse_json(conn.metadata_json).get("calendars")
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw:
        if isinstance(item, dict) and item.get("id"):
            out.append(
                {
                    "id": str(item["id"]),
                    "name": str(item.get("name") or item["id"]),
                    "color": str(item.get("color") or ""),
                    "primary": bool(item.get("primary")),
                    "writable": bool(item.get("writable")),
                    "enabled": bool(item.get("enabled")),
                }
            )
    return out


def default_write_calendar(conn: IntegrationConnection) -> str | None:
    """Enabled, writable calendar new events land on (stored choice, else primary)."""
    calendars = stored_calendars(conn)
    if not calendars:
        return None
    writable = [c for c in calendars if c["writable"] and c["enabled"]]
    chosen = str(_parse_json(conn.metadata_json).get("default_write_calendar") or "")
    if any(c["id"] == chosen for c in writable):
        return chosen
    for c in writable:
        if c["primary"]:
            return c["id"]
    return writable[0]["id"] if writable else None


def _merge_calendars(
    stored: list[dict[str, Any]], remote: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Fresh provider list with the operator's enabled flags kept; calendars
    seen for the first time start enabled only when primary."""
    prior = {c["id"]: c for c in stored}
    merged = []
    for cal in remote:
        old = prior.get(cal["id"])
        merged.append({**cal, "enabled": old["enabled"] if old else bool(cal["primary"])})
    if merged and not any(c["enabled"] for c in merged) and not stored:
        merged[0]["enabled"] = True
    return merged


def _save_calendars(conn: IntegrationConnection, calendars: list[dict[str, Any]]) -> None:
    meta = _parse_json(conn.metadata_json)
    meta["calendars"] = calendars
    conn.metadata_json = json.dumps(meta)


async def _fetch_google_calendars(client: httpx.AsyncClient, token: str) -> list[dict[str, Any]]:
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    out: list[dict[str, Any]] = []
    page_token = None
    while True:
        params: dict[str, Any] = {"maxResults": 250, "minAccessRole": "reader"}
        if page_token:
            params["pageToken"] = page_token
        resp = await client.get(GOOGLE_CALENDARS_URL, headers=headers, params=params)
        _check(resp)
        payload = resp.json()
        for item in payload.get("items") or []:
            if not isinstance(item, dict) or not item.get("id"):
                continue
            out.append(
                {
                    "id": str(item["id"]),
                    "name": str(item.get("summaryOverride") or item.get("summary") or item["id"]),
                    "color": str(item.get("backgroundColor") or ""),
                    "primary": bool(item.get("primary")),
                    "writable": str(item.get("accessRole") or "") in ("owner", "writer"),
                }
            )
        page_token = payload.get("nextPageToken")
        if not page_token:
            return out


async def _fetch_graph_calendars(client: httpx.AsyncClient, token: str) -> list[dict[str, Any]]:
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    out: list[dict[str, Any]] = []
    url: str | None = GRAPH_CALENDARS_URL
    params: dict[str, Any] | None = {
        "$select": "id,name,hexColor,isDefaultCalendar,canEdit",
        "$top": "100",
    }
    while url:
        resp = await client.get(url, headers=headers, params=params)
        params = None
        _check(resp)
        payload = resp.json()
        for item in payload.get("value") or []:
            if not isinstance(item, dict) or not item.get("id"):
                continue
            out.append(
                {
                    "id": str(item["id"]),
                    "name": str(item.get("name") or "Calendar"),
                    "color": str(item.get("hexColor") or ""),
                    "primary": bool(item.get("isDefaultCalendar")),
                    "writable": bool(item.get("canEdit")),
                }
            )
        url = payload.get("@odata.nextLink")
    return out


async def _fetch_calendars(slug: str, token: str) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        if slug == "google_calendar":
            return await _fetch_google_calendars(client, token)
        return await _fetch_graph_calendars(client, token)


async def refresh_calendar_list(
    session: AsyncSession, conn: IntegrationConnection
) -> list[dict[str, Any]]:
    """Pull the account's calendars from the provider and store them."""
    slug = _calendar_slug(conn)
    if slug is None:
        raise ValueError("Calendar connection not found")
    from app.services.crypto import get_connection_credentials

    if get_connection_credentials(conn).get("mock"):
        calendars = stored_calendars(conn) or [dict(MOCK_CALENDAR)]
    else:
        remote = await _with_token(session, conn, lambda token: _fetch_calendars(slug, token))
        calendars = _merge_calendars(stored_calendars(conn), remote)
    _save_calendars(conn, calendars)
    session.add(conn)
    await session.commit()
    return calendars


async def set_calendar_selection(
    session: AsyncSession,
    conn: IntegrationConnection,
    *,
    enabled_ids: list[str] | None = None,
    default_write: str | None = None,
) -> list[dict[str, Any]]:
    """Choose which calendars sync and where new events land. Events of
    calendars that are switched off leave Agenda at once."""
    calendars = stored_calendars(conn)
    known = {c["id"] for c in calendars}
    if enabled_ids is not None:
        wanted = {str(x) for x in enabled_ids}
        unknown = wanted - known
        if unknown:
            raise ValueError("Unknown calendar: " + ", ".join(sorted(unknown)))
        for cal in calendars:
            cal["enabled"] = cal["id"] in wanted
        _save_calendars(conn, calendars)
        disabled = [c["id"] for c in calendars if not c["enabled"]]
        if disabled:
            await session.execute(
                delete(CalendarEvent).where(
                    CalendarEvent.connection_id == conn.id,
                    CalendarEvent.calendar_id.in_(disabled),
                )
            )
    if default_write is not None:
        target = next((c for c in calendars if c["id"] == default_write), None)
        if target is None or not target["writable"] or not target["enabled"]:
            raise ValueError("The default calendar must be switched on and writable.")
        meta = _parse_json(conn.metadata_json)
        meta["default_write_calendar"] = default_write
        conn.metadata_json = json.dumps(meta)
    session.add(conn)
    await session.commit()
    return calendars


# --- Sync ------------------------------------------------------------------


async def _seed_mock_events(
    session: AsyncSession, conn: IntegrationConnection
) -> dict[str, Any]:
    """Dev/demo events around today so Agenda has something to show."""
    await session.execute(
        delete(CalendarEvent).where(CalendarEvent.connection_id == conn.id)
    )
    if not stored_calendars(conn):
        _save_calendars(conn, [dict(MOCK_CALENDAR)])
    now = datetime.utcnow().replace(minute=0, second=0, microsecond=0)
    samples = [
        ("Team standup", now + timedelta(hours=2), now + timedelta(hours=2, minutes=30)),
        ("Customer call", now + timedelta(days=1, hours=10), now + timedelta(days=1, hours=11)),
        ("Planning", now + timedelta(days=2, hours=14), now + timedelta(days=2, hours=15)),
    ]
    for title, start, end in samples:
        session.add(
            CalendarEvent(
                tenant_id=conn.tenant_id,
                connection_id=conn.id,
                provider=conn.provider,
                external_id=f"mock-{uuid4().hex[:12]}",
                calendar_id="primary",
                calendar_name="Primary",
                title=title,
                description="Demo calendar event",
                start_at=start,
                end_at=end,
                status="confirmed",
                html_link="",
            )
        )
    await _mark(session, conn, "ok")
    return {"connection_id": str(conn.id), "synced": len(samples), "status": "mock"}


def _window() -> tuple[datetime, datetime]:
    now = datetime.utcnow()
    return now - timedelta(days=SYNC_WINDOW_PAST_DAYS), now + timedelta(days=SYNC_WINDOW_FUTURE_DAYS)


def _google_event(ev: dict[str, Any]) -> dict[str, Any] | None:
    ext = str(ev.get("id") or "").strip()
    if not ext or str(ev.get("status") or "") == "cancelled":
        return None
    start, all_day = _parse_google_dt(ev.get("start"))
    end, _ = _parse_google_dt(ev.get("end"))
    return {
        "external_id": ext,
        "ical_uid": str(ev.get("iCalUID") or ""),
        "title": str(ev.get("summary") or ""),
        "description": str(ev.get("description") or ""),
        "location": str(ev.get("location") or ""),
        "start_at": start,
        "end_at": end,
        "all_day": all_day,
        "status": "tentative" if ev.get("status") == "tentative" else "confirmed",
        "html_link": str(ev.get("htmlLink") or ""),
        "attendees": [
            {"email": a.get("email"), "name": a.get("displayName"), "status": a.get("responseStatus")}
            for a in (ev.get("attendees") or [])
            if isinstance(a, dict)
        ],
    }


def _graph_event(ev: dict[str, Any]) -> dict[str, Any] | None:
    ext = str(ev.get("id") or "").strip()
    if not ext or ev.get("isCancelled"):
        return None
    all_day = bool(ev.get("isAllDay"))
    loc = ev.get("location")
    attendees = []
    for a in ev.get("attendees") or []:
        if not isinstance(a, dict):
            continue
        addr = a.get("emailAddress") if isinstance(a.get("emailAddress"), dict) else {}
        status = a.get("status") if isinstance(a.get("status"), dict) else {}
        attendees.append(
            {"email": addr.get("address"), "name": addr.get("name"), "status": status.get("response")}
        )
    body = ev.get("body")
    description = str(ev.get("bodyPreview") or "")
    if isinstance(body, dict) and body.get("content"):
        description = str(body.get("content"))[:4000]
    return {
        "external_id": ext,
        "ical_uid": str(ev.get("iCalUId") or ""),
        "title": str(ev.get("subject") or ""),
        "description": description,
        "location": str(loc.get("displayName") or "") if isinstance(loc, dict) else "",
        "start_at": _parse_graph_dt(ev.get("start"), all_day=all_day),
        "end_at": _parse_graph_dt(ev.get("end"), all_day=all_day),
        "all_day": all_day,
        "status": "tentative" if ev.get("showAs") == "tentative" else "confirmed",
        "html_link": str(ev.get("webLink") or ""),
        "attendees": attendees,
    }


async def _fetch_google_events(
    client: httpx.AsyncClient, token: str, calendar_id: str
) -> list[dict[str, Any]]:
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    start, end = _window()
    events: list[dict[str, Any]] = []
    page_token = None
    while True:
        params: dict[str, Any] = {
            "singleEvents": "true",
            "orderBy": "startTime",
            "timeMin": start.isoformat() + "Z",
            "timeMax": end.isoformat() + "Z",
            "maxResults": 250,
        }
        if page_token:
            params["pageToken"] = page_token
        resp = await client.get(
            GOOGLE_EVENTS_URL.format(cal=quote(calendar_id, safe="")), headers=headers, params=params
        )
        _check(resp)
        payload = resp.json()
        for ev in payload.get("items") or []:
            parsed = _google_event(ev) if isinstance(ev, dict) else None
            if parsed:
                events.append(parsed)
        page_token = payload.get("nextPageToken")
        if not page_token:
            return events


async def _fetch_graph_events(
    client: httpx.AsyncClient, token: str, calendar_id: str
) -> list[dict[str, Any]]:
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json", **GRAPH_TZ_HEADER}
    start, end = _window()
    params: dict[str, Any] | None = {
        "startDateTime": start.isoformat() + "Z",
        "endDateTime": end.isoformat() + "Z",
        "$top": "100",
        "$orderby": "start/dateTime",
        "$select": (
            "id,iCalUId,subject,bodyPreview,body,location,start,end,isAllDay,"
            "isCancelled,showAs,webLink,attendees"
        ),
    }
    url: str | None = f"{GRAPH_CALENDARS_URL}/{quote(calendar_id, safe='')}/calendarView"
    events: list[dict[str, Any]] = []
    while url:
        resp = await client.get(url, headers=headers, params=params)
        params = None
        _check(resp)
        payload = resp.json()
        for ev in payload.get("value") or []:
            parsed = _graph_event(ev) if isinstance(ev, dict) else None
            if parsed:
                events.append(parsed)
        url = payload.get("@odata.nextLink")
    return events


async def _fetch_account(
    slug: str, token: str, stored: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    """Calendar list plus events of every enabled calendar (network only)."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        if slug == "google_calendar":
            remote = await _fetch_google_calendars(client, token)
        else:
            remote = await _fetch_graph_calendars(client, token)
        calendars = _merge_calendars(stored, remote)
        events: dict[str, list[dict[str, Any]]] = {}
        for cal in calendars:
            if not cal["enabled"]:
                continue
            if slug == "google_calendar":
                events[cal["id"]] = await _fetch_google_events(client, token, cal["id"])
            else:
                events[cal["id"]] = await _fetch_graph_events(client, token, cal["id"])
    return calendars, events


def _apply_event(row: CalendarEvent, data: dict[str, Any], calendar_name: str) -> None:
    now = datetime.utcnow()
    row.calendar_name = calendar_name
    row.title = data["title"] or "(No title)"
    row.description = data["description"] or ""
    row.location = data["location"] or ""
    row.start_at = data["start_at"]
    row.end_at = data["end_at"]
    row.all_day = data["all_day"]
    row.status = data["status"] or "confirmed"
    row.html_link = data["html_link"] or ""
    row.attendees_json = json.dumps(data["attendees"])
    meta = _parse_json(row.metadata_json)
    if data.get("ical_uid"):
        meta["ical_uid"] = data["ical_uid"]
    row.metadata_json = json.dumps(meta)
    row.synced_at = now
    row.updated_at = now


async def _store_account(
    session: AsyncSession,
    conn: IntegrationConnection,
    calendars: list[dict[str, Any]],
    events: dict[str, list[dict[str, Any]]],
) -> int:
    """Upsert by (calendar, external id); drop rows the provider no longer
    lists and rows of calendars that are not synced."""
    existing_rows = (
        await session.execute(select(CalendarEvent).where(CalendarEvent.connection_id == conn.id))
    ).scalars().all()
    existing = {(row.calendar_id, row.external_id): row for row in existing_rows}
    names = {c["id"]: c["name"] for c in calendars}
    seen: set[tuple[str, str]] = set()
    for cal_id, items in events.items():
        for data in items:
            key = (cal_id, data["external_id"])
            if key in seen:
                continue
            row = existing.get(key)
            if row is None:
                row = CalendarEvent(
                    tenant_id=conn.tenant_id,
                    connection_id=conn.id,
                    provider=conn.provider,
                    external_id=data["external_id"],
                    calendar_id=cal_id,
                    start_at=data["start_at"],
                    end_at=data["end_at"],
                )
                existing[key] = row
            _apply_event(row, data, names.get(cal_id, ""))
            session.add(row)
            seen.add(key)
    for key, row in existing.items():
        if key not in seen:
            await session.delete(row)
    _save_calendars(conn, calendars)
    return len(seen)


async def sync_connection(
    session: AsyncSession, conn: IntegrationConnection
) -> dict[str, Any]:
    slug = _calendar_slug(conn)
    if slug is None:
        return {"connection_id": str(conn.id), "synced": 0, "status": "skipped"}
    if conn.status != "active":
        return {"connection_id": str(conn.id), "synced": 0, "status": "inactive"}

    from app.services.crypto import get_connection_credentials

    creds = get_connection_credentials(conn)
    if creds.get("mock"):
        if _mock_allowed():
            return await _seed_mock_events(session, conn)
        await _mark(session, conn, "reconnect", RECONNECT_MESSAGE)
        return {"connection_id": str(conn.id), "synced": 0, "status": "reconnect"}

    stored = stored_calendars(conn)
    try:
        calendars, events = await _with_token(
            session, conn, lambda token: _fetch_account(slug, token, stored)
        )
    except CalendarReconnectError:
        return {"connection_id": str(conn.id), "synced": 0, "status": "reconnect"}
    except Exception as exc:
        logger.warning("calendar sync failed connection=%s: %s", conn.id, exc)
        message = _error_text(exc)
        await _mark(session, conn, "error", message)
        return {"connection_id": str(conn.id), "synced": 0, "status": "error", "error": message}

    count = await _store_account(session, conn, calendars, events)
    await _mark(session, conn, "ok")
    return {"connection_id": str(conn.id), "synced": count, "status": "ok"}


# --- Reading (access-aware) ------------------------------------------------


async def connection_level(
    session: AsyncSession, conn: IntegrationConnection, viewer: CalendarViewer | None
) -> str | None:
    """``use``, ``manage`` or None for this viewer; system code manages."""
    from app.services.connection_access import agent_level, user_level

    if viewer is None:
        return "manage"
    if viewer.agent_id is not None:
        return await agent_level(session, conn, viewer.agent_id)
    if viewer.user_id is not None:
        return await user_level(session, conn, user_id=viewer.user_id, role=viewer.role)
    return None


async def visible_connections(
    session: AsyncSession, tenant_id: UUID, viewer: CalendarViewer | None
) -> list[tuple[IntegrationConnection, str]]:
    """Active calendar connections this viewer may use, with their level."""
    from app.services.access_list import UNRESTRICTED_ROLES, agent_principal, user_principal
    from app.services.connection_access import level_for

    result = await session.execute(
        select(IntegrationConnection)
        .where(
            IntegrationConnection.tenant_id == tenant_id,
            IntegrationConnection.status == "active",
        )
        .order_by(IntegrationConnection.created_at.asc())
    )
    conns = [c for c in result.scalars().all() if _calendar_slug(c) is not None]
    if viewer is None or (viewer.agent_id is None and viewer.role in UNRESTRICTED_ROLES):
        return [(c, "manage") for c in conns]
    if viewer.agent_id is not None:
        principal = await agent_principal(session, tenant_id, viewer.agent_id)
    elif viewer.user_id is not None:
        principal = await user_principal(session, tenant_id, viewer.user_id, viewer.role)
    else:
        return []
    out = []
    for conn in conns:
        level = level_for(conn, principal)
        if level:
            out.append((conn, level))
    return out


def _provider_name(slug: str | None) -> str:
    return "Google Calendar" if slug == "google_calendar" else "Outlook Calendar"


async def list_calendar_connections(
    session: AsyncSession, tenant_id: UUID, viewer: CalendarViewer | None = None
) -> list[dict[str, Any]]:
    from sqlalchemy import func

    visible = await visible_connections(session, tenant_id, viewer)
    counts: dict[UUID, int] = {}
    if visible:
        rows = await session.execute(
            select(CalendarEvent.connection_id, func.count())
            .where(CalendarEvent.connection_id.in_([c.id for c, _ in visible]))
            .group_by(CalendarEvent.connection_id)
        )
        counts = {cid: int(n) for cid, n in rows.all()}
    out = []
    for conn, level in visible:
        slug = _calendar_slug(conn)
        meta = _parse_json(conn.metadata_json)
        out.append(
            {
                "id": str(conn.id),
                "provider": slug,
                "display_name": conn.display_name or _provider_name(slug),
                "account": str(meta.get("email") or meta.get("identity") or ""),
                "status": conn.status,
                "last_synced_at": meta.get("last_synced_at"),
                "sync_status": meta.get("sync_status") or "idle",
                "sync_error": meta.get("sync_error") or "",
                "event_count": counts.get(conn.id, 0),
                "calendars": stored_calendars(conn),
                "default_write_calendar": default_write_calendar(conn),
                "access_level": level,
                "can_manage": level == "manage",
            }
        )
    return out


async def calendar_events_in_window(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    start: datetime,
    end: datetime,
    viewer: CalendarViewer | None = None,
) -> list[dict[str, Any]]:
    """Calendar events overlapping [start, end] in the time-item vocabulary
    (``title``, ``start``, ``end``) from connections this viewer may use;
    ``list_time_items`` wraps them."""
    visible = await visible_connections(session, tenant_id, viewer)
    if not visible:
        return []
    by_id = {conn.id: (conn, level) for conn, level in visible}
    colors = {
        (conn.id, cal["id"]): cal for conn, _ in visible for cal in stored_calendars(conn)
    }
    result = await session.execute(
        select(CalendarEvent)
        .where(
            CalendarEvent.tenant_id == tenant_id,
            CalendarEvent.connection_id.in_(list(by_id)),
            CalendarEvent.start_at < end,
            CalendarEvent.end_at > start,
            CalendarEvent.status != "cancelled",
        )
        .order_by(CalendarEvent.start_at.asc())
    )
    items: list[dict[str, Any]] = []
    for ev in result.scalars().all():
        conn, level = by_id[ev.connection_id]
        cal = colors.get((ev.connection_id, ev.calendar_id)) or {}
        items.append(
            {
                "id": f"cal:{ev.id}",
                "title": ev.title or "(No title)",
                "instructions": ev.description or "",
                "start": ev.start_at.replace(microsecond=0).isoformat(),
                "end": ev.end_at.replace(microsecond=0).isoformat(),
                "provider": ev.provider,
                "provider_label": "Google" if ev.provider == "google_calendar" else "Outlook",
                "calendar_id": ev.calendar_id,
                "calendar_name": ev.calendar_name,
                "calendar_color": cal.get("color") or "",
                "account": str(_parse_json(conn.metadata_json).get("email") or ""),
                "location": ev.location,
                "html_link": ev.html_link,
                "all_day": ev.all_day,
                "status": ev.status,
                "connection_id": str(ev.connection_id),
                "external_id": ev.external_id,
                "ical_uid": str(_parse_json(ev.metadata_json).get("ical_uid") or ""),
                "can_edit": bool(level) and (not cal or bool(cal.get("writable", True))),
                "signal_id": str(ev.signal_id) if ev.signal_id else None,
            }
        )
    return items


# --- Writing ---------------------------------------------------------------


async def _tenant_calendar(
    session: AsyncSession, tenant_id: UUID, connection_id: UUID
) -> tuple[IntegrationConnection, str]:
    conn = await session.get(IntegrationConnection, connection_id)
    slug = _calendar_slug(conn) if conn is not None else None
    if conn is None or conn.tenant_id != tenant_id or slug is None:
        raise ValueError("Calendar connection not found")
    return conn, slug


def _write_target(conn: IntegrationConnection, calendar_id: str | None) -> tuple[str, str]:
    calendars = stored_calendars(conn)
    if calendar_id:
        match = next((c for c in calendars if c["id"] == calendar_id), None)
        if calendars and (match is None or not match["writable"]):
            raise ValueError("That calendar does not accept new events.")
        return calendar_id, (match or {}).get("name") or "Calendar"
    target = default_write_calendar(conn)
    if target is None:
        if calendars:
            raise ValueError("No writable calendar is switched on for this account.")
        return "primary", "Primary"
    name = next((c["name"] for c in calendars if c["id"] == target), "Calendar")
    return target, name


def _event_body(
    slug: str, *, title: str, description: str, location: str, start: datetime, end: datetime, all_day: bool
) -> dict[str, Any]:
    if slug == "google_calendar":
        g_start, g_end = _google_bounds(start, end, all_day=all_day)
        return {
            "summary": title,
            "description": description,
            "location": location,
            "start": g_start,
            "end": g_end,
        }
    o_start, o_end = _graph_bounds(start, end, all_day=all_day)
    return {
        "subject": title,
        "body": {"contentType": "text", "content": description},
        "location": {"displayName": location},
        "isAllDay": all_day,
        "start": o_start,
        "end": o_end,
    }


def _json_headers(token: str, slug: str) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if slug != "google_calendar":
        headers.update(GRAPH_TZ_HEADER)
    return headers


def _google_event_url(calendar_id: str, external_id: str = "") -> str:
    url = GOOGLE_EVENTS_URL.format(cal=quote(calendar_id or "primary", safe=""))
    return f"{url}/{quote(external_id, safe='')}" if external_id else url


def _graph_create_url(calendar_id: str) -> str:
    if not calendar_id or calendar_id == "primary":
        return GRAPH_API + "/me/events"
    return f"{GRAPH_CALENDARS_URL}/{quote(calendar_id, safe='')}/events"


async def create_external_event(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    connection_id: UUID,
    title: str,
    start_at: datetime,
    end_at: datetime,
    description: str = "",
    location: str = "",
    all_day: bool = False,
    calendar_id: str | None = None,
) -> dict[str, Any]:
    """Create an event on the external calendar (``calendar_id`` or the
    connection's default) and cache it locally."""
    conn, slug = await _tenant_calendar(session, tenant_id, connection_id)
    from app.services.crypto import get_connection_credentials

    creds = get_connection_credentials(conn)
    start_n = _iso_naive(start_at)
    end_n = _iso_naive(end_at)
    if all_day:
        start_n, end_n = all_day_span(start_n, end_n)
    if end_n <= start_n:
        raise ValueError("end_at must be after start_at")
    target, target_name = _write_target(conn, calendar_id)
    clean_title = title.strip() or "Untitled"

    if creds.get("mock"):
        if not _mock_allowed():
            raise CalendarReconnectError()
        row = CalendarEvent(
            tenant_id=tenant_id,
            connection_id=conn.id,
            provider=conn.provider,
            external_id=f"local-{uuid4().hex}",
            calendar_id=target,
            calendar_name=target_name,
            title=clean_title,
            description=description,
            location=location,
            start_at=start_n,
            end_at=end_n,
            all_day=all_day,
            status="confirmed",
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return {
            "id": str(row.id),
            "external_id": row.external_id,
            "calendar_id": target,
            "mock": True,
            "all_day": all_day,
        }

    body = _event_body(
        slug,
        title=clean_title,
        description=description,
        location=location,
        start=start_n,
        end=end_n,
        all_day=all_day,
    )

    async def _post(token: str) -> dict[str, Any]:
        url = _google_event_url(target) if slug == "google_calendar" else _graph_create_url(target)
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, headers=_json_headers(token, slug), json=body)
        _check(resp)
        return resp.json()

    data = await _with_token(session, conn, _post)
    html_link = str(data.get("htmlLink") or data.get("webLink") or "")
    ical_uid = str(data.get("iCalUID") or data.get("iCalUId") or "")
    row = CalendarEvent(
        tenant_id=tenant_id,
        connection_id=conn.id,
        provider=conn.provider,
        external_id=str(data.get("id") or "") or f"created-{uuid4().hex}",
        calendar_id=target,
        calendar_name=target_name,
        title=clean_title,
        description=description,
        location=location,
        start_at=start_n,
        end_at=end_n,
        all_day=all_day,
        status="confirmed",
        html_link=html_link,
        metadata_json=json.dumps({"ical_uid": ical_uid} if ical_uid else {}),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return {
        "id": str(row.id),
        "external_id": row.external_id,
        "calendar_id": target,
        "html_link": html_link,
        "all_day": all_day,
    }


async def event_connection(
    session: AsyncSession, tenant_id: UUID, event_id: UUID
) -> tuple[CalendarEvent, IntegrationConnection | None]:
    row = await session.get(CalendarEvent, event_id)
    if row is None or row.tenant_id != tenant_id:
        raise ValueError("Event not found")
    return row, await session.get(IntegrationConnection, row.connection_id)


def _is_local(row: CalendarEvent) -> bool:
    return (row.external_id or "").startswith(("mock-", "local-"))


async def update_external_event(
    session: AsyncSession,
    tenant_id: UUID,
    event_id: UUID,
    *,
    title: str | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
    description: str | None = None,
    location: str | None = None,
    all_day: bool | None = None,
) -> dict[str, Any]:
    """Patch an event on the external calendar and refresh the local cache."""
    row, conn = await event_connection(session, tenant_id, event_id)
    if conn is None:
        raise ValueError("Calendar connection not found")

    new_title = title.strip() if title is not None else row.title
    new_title = (new_title or "").strip() or "Untitled"
    new_all_day = row.all_day if all_day is None else bool(all_day)
    new_start = _iso_naive(start_at) if start_at is not None else row.start_at
    new_end = _iso_naive(end_at) if end_at is not None else row.end_at
    if new_all_day:
        new_start, new_end = all_day_span(new_start, new_end)
    if new_end <= new_start:
        raise ValueError("end_at must be after start_at")
    new_description = description if description is not None else (row.description or "")
    new_location = location if location is not None else (row.location or "")

    from app.services.crypto import get_connection_credentials

    slug = _calendar_slug(conn) or ""
    if not (get_connection_credentials(conn).get("mock") or _is_local(row)):
        body = _event_body(
            slug,
            title=new_title,
            description=new_description,
            location=new_location,
            start=new_start,
            end=new_end,
            all_day=new_all_day,
        )

        async def _patch(token: str) -> dict[str, Any]:
            if slug == "google_calendar":
                url = _google_event_url(row.calendar_id, row.external_id)
            else:
                url = GRAPH_EVENT_URL.format(id=quote(row.external_id, safe=""))
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.patch(url, headers=_json_headers(token, slug), json=body)
            _check(resp)
            return resp.json()

        data = await _with_token(session, conn, _patch)
        link = data.get("htmlLink") or data.get("webLink")
        if link:
            row.html_link = str(link)

    row.title = new_title
    row.start_at = new_start
    row.end_at = new_end
    row.all_day = new_all_day
    row.description = new_description
    row.location = new_location
    row.updated_at = datetime.utcnow()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return {
        "id": str(row.id),
        "external_id": row.external_id,
        "html_link": row.html_link,
        "title": row.title,
        "start_at": row.start_at.isoformat() if row.start_at else None,
        "end_at": row.end_at.isoformat() if row.end_at else None,
        "all_day": row.all_day,
    }


async def delete_external_event(
    session: AsyncSession, tenant_id: UUID, event_id: UUID
) -> None:
    row, conn = await event_connection(session, tenant_id, event_id)
    from app.services.crypto import get_connection_credentials

    if conn is not None and not (get_connection_credentials(conn).get("mock") or _is_local(row)):
        slug = _calendar_slug(conn) or ""

        async def _delete(token: str) -> None:
            if slug == "google_calendar":
                url = _google_event_url(row.calendar_id, row.external_id)
            else:
                url = GRAPH_EVENT_URL.format(id=quote(row.external_id, safe=""))
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.delete(
                    url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"}
                )
            if resp.status_code in (404, 410):
                return
            _check(resp)

        await _with_token(session, conn, _delete)
    await session.delete(row)
    await session.commit()


def default_access_entries(user_id: UUID | None) -> list[dict[str, str]]:
    """New calendars are personal: the person who connected manages them and
    agents may use them. Owners and admins always manage."""
    from app.models.team import TEAM_KIND_AGENTS

    entries = [{"kind": "team", "id": TEAM_KIND_AGENTS, "level": "use"}]
    if user_id is not None:
        entries.insert(0, {"kind": "user", "id": str(user_id), "level": "manage"})
    return entries


async def apply_default_access(
    session: AsyncSession, conn: IntegrationConnection, user_id: UUID | None
) -> None:
    """Set the personal default on a calendar connection that has no list yet
    (caller commits)."""
    from app.services.connection_access import is_default_access, set_connection_access

    if user_id is None or not is_default_access(conn):
        return
    await set_connection_access(session, conn, default_access_entries(user_id))
