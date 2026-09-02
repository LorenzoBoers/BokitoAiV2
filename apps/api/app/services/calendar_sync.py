"""Sync Google Calendar / Outlook Calendar into CalendarEvent rows.

Connections live on IntegrationConnection (provider google_calendar |
outlook_calendar). Tokens refresh like email sync. Mock credentials seed
demo events so Agenda can be showcased without real OAuth apps.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calendar import CalendarEvent
from app.models.integration import IntegrationConnection
from app.services import oauth_providers

logger = logging.getLogger(__name__)

CALENDAR_PROVIDERS = frozenset({"google_calendar", "outlook_calendar"})
GOOGLE_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/{cal}/events"
GOOGLE_CALENDARS_URL = "https://www.googleapis.com/calendar/v3/users/me/calendarList"
GRAPH_EVENTS_URL = "https://graph.microsoft.com/v1.0/me/calendarView"
GRAPH_CREATE_URL = "https://graph.microsoft.com/v1.0/me/events"
GRAPH_EVENT_URL = "https://graph.microsoft.com/v1.0/me/events/{id}"

SYNC_WINDOW_PAST_DAYS = 7
SYNC_WINDOW_FUTURE_DAYS = 60


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
        # Graph often returns local wall time without offset; treat as UTC-ish naive.
        if "+" not in normalized and not normalized.endswith("Z"):
            return datetime.fromisoformat(normalized[:19])
        return _iso_naive(datetime.fromisoformat(normalized))
    except ValueError:
        return datetime.utcnow()


async def _access_token(session: AsyncSession, conn: IntegrationConnection) -> str | None:
    from app.services.crypto import get_connection_credentials, set_connection_credentials

    creds = get_connection_credentials(conn)
    if creds.get("mock"):
        return None
    token = str(creds.get("access_token") or "").strip()
    refresh = str(creds.get("refresh_token") or "").strip()
    expires_at = creds.get("expires_at")
    needs_refresh = False
    if isinstance(expires_at, (int, float)):
        needs_refresh = datetime.utcnow().timestamp() > float(expires_at) - 60
    if (not token or needs_refresh) and refresh:
        try:
            refreshed = await oauth_providers.refresh_access_token(
                conn.provider, refresh_token=refresh
            )
            if refreshed.get("access_token"):
                creds["access_token"] = refreshed["access_token"]
                if refreshed.get("refresh_token"):
                    creds["refresh_token"] = refreshed["refresh_token"]
                expires_in = refreshed.get("expires_in")
                if expires_in:
                    creds["expires_at"] = datetime.utcnow().timestamp() + int(expires_in)
                set_connection_credentials(conn, creds)
                session.add(conn)
                await session.commit()
                token = str(creds["access_token"])
        except Exception:
            logger.exception("calendar token refresh failed provider=%s", conn.provider)
    return token or None


async def _seed_mock_events(
    session: AsyncSession, conn: IntegrationConnection
) -> dict[str, Any]:
    """Dev/demo events around today so Agenda has something to show."""
    await session.execute(
        delete(CalendarEvent).where(CalendarEvent.connection_id == conn.id)
    )
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
    meta = _parse_json(conn.metadata_json)
    meta["last_synced_at"] = datetime.utcnow().isoformat()
    meta["sync_status"] = "ok"
    meta["sync_error"] = ""
    conn.metadata_json = json.dumps(meta)
    session.add(conn)
    await session.commit()
    return {"connection_id": str(conn.id), "synced": len(samples), "status": "mock"}


def _upsert_event(
    session: AsyncSession,
    conn: IntegrationConnection,
    *,
    external_id: str,
    calendar_id: str,
    calendar_name: str,
    title: str,
    description: str,
    location: str,
    start_at: datetime,
    end_at: datetime,
    all_day: bool,
    status: str,
    html_link: str,
    attendees: list[dict[str, Any]],
    existing: dict[str, CalendarEvent],
) -> None:
    row = existing.get(external_id)
    now = datetime.utcnow()
    if row is None:
        row = CalendarEvent(
            tenant_id=conn.tenant_id,
            connection_id=conn.id,
            provider=conn.provider,
            external_id=external_id,
        )
        session.add(row)
    row.calendar_id = calendar_id
    row.calendar_name = calendar_name
    row.title = title or "(No title)"
    row.description = description or ""
    row.location = location or ""
    row.start_at = start_at
    row.end_at = end_at
    row.all_day = all_day
    row.status = status or "confirmed"
    row.html_link = html_link or ""
    row.attendees_json = json.dumps(attendees)
    row.synced_at = now
    row.updated_at = now
    existing[external_id] = row


async def _sync_google(
    session: AsyncSession, conn: IntegrationConnection, token: str
) -> int:
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    window_start = datetime.utcnow() - timedelta(days=SYNC_WINDOW_PAST_DAYS)
    window_end = datetime.utcnow() + timedelta(days=SYNC_WINDOW_FUTURE_DAYS)
    time_min = window_start.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
    time_max = window_end.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")

    async with httpx.AsyncClient(timeout=30.0) as client:
        cal_name = "Primary"
        cal_id = "primary"
        try:
            listing = await client.get(GOOGLE_CALENDARS_URL, headers=headers)
            if listing.status_code == 200:
                for item in listing.json().get("items") or []:
                    if item.get("primary"):
                        cal_id = str(item.get("id") or "primary")
                        cal_name = str(item.get("summary") or "Primary")
                        break
        except Exception:
            logger.debug("calendar list failed; using primary", exc_info=True)

        events: list[dict[str, Any]] = []
        page_token = None
        while True:
            params: dict[str, Any] = {
                "singleEvents": "true",
                "orderBy": "startTime",
                "timeMin": time_min,
                "timeMax": time_max,
                "maxResults": 100,
            }
            if page_token:
                params["pageToken"] = page_token
            resp = await client.get(
                GOOGLE_EVENTS_URL.format(cal=cal_id), headers=headers, params=params
            )
            if resp.status_code == 401:
                raise PermissionError("google calendar unauthorized")
            resp.raise_for_status()
            payload = resp.json()
            events.extend(payload.get("items") or [])
            page_token = payload.get("nextPageToken")
            if not page_token:
                break

    result = await session.execute(
        select(CalendarEvent).where(CalendarEvent.connection_id == conn.id)
    )
    existing = {row.external_id: row for row in result.scalars().all()}
    seen: set[str] = set()
    for ev in events:
        ext = str(ev.get("id") or "").strip()
        if not ext:
            continue
        if str(ev.get("status") or "") == "cancelled":
            continue
        start, all_day = _parse_google_dt(ev.get("start"))
        end, _ = _parse_google_dt(ev.get("end"))
        attendees = [
            {"email": a.get("email"), "name": a.get("displayName"), "status": a.get("responseStatus")}
            for a in (ev.get("attendees") or [])
            if isinstance(a, dict)
        ]
        _upsert_event(
            session,
            conn,
            external_id=ext,
            calendar_id=cal_id,
            calendar_name=cal_name,
            title=str(ev.get("summary") or ""),
            description=str(ev.get("description") or ""),
            location=str(ev.get("location") or ""),
            start_at=start,
            end_at=end,
            all_day=all_day,
            status=str(ev.get("status") or "confirmed"),
            html_link=str(ev.get("htmlLink") or ""),
            attendees=attendees,
            existing=existing,
        )
        seen.add(ext)

    for ext, row in list(existing.items()):
        if ext not in seen:
            await session.delete(row)
    return len(seen)


async def _sync_outlook(
    session: AsyncSession, conn: IntegrationConnection, token: str
) -> int:
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    window_start = datetime.utcnow() - timedelta(days=SYNC_WINDOW_PAST_DAYS)
    window_end = datetime.utcnow() + timedelta(days=SYNC_WINDOW_FUTURE_DAYS)
    params = {
        "startDateTime": window_start.isoformat() + "Z",
        "endDateTime": window_end.isoformat() + "Z",
        "$top": "100",
        "$orderby": "start/dateTime",
        "$select": (
            "id,subject,bodyPreview,body,location,start,end,isAllDay,showAs,"
            "webLink,attendees,organizer"
        ),
    }
    events: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=30.0) as client:
        url: str | None = GRAPH_EVENTS_URL
        first = True
        while url:
            resp = await client.get(url, headers=headers, params=params if first else None)
            first = False
            if resp.status_code == 401:
                raise PermissionError("outlook calendar unauthorized")
            resp.raise_for_status()
            payload = resp.json()
            events.extend(payload.get("value") or [])
            url = payload.get("@odata.nextLink")

    result = await session.execute(
        select(CalendarEvent).where(CalendarEvent.connection_id == conn.id)
    )
    existing = {row.external_id: row for row in result.scalars().all()}
    seen: set[str] = set()
    for ev in events:
        ext = str(ev.get("id") or "").strip()
        if not ext:
            continue
        all_day = bool(ev.get("isAllDay"))
        start = _parse_graph_dt(ev.get("start"), all_day=all_day)
        end = _parse_graph_dt(ev.get("end"), all_day=all_day)
        location = ""
        loc = ev.get("location")
        if isinstance(loc, dict):
            location = str(loc.get("displayName") or "")
        attendees = []
        for a in ev.get("attendees") or []:
            if not isinstance(a, dict):
                continue
            email_addr = ((a.get("emailAddress") or {}) if isinstance(a.get("emailAddress"), dict) else {})
            attendees.append(
                {
                    "email": email_addr.get("address"),
                    "name": email_addr.get("name"),
                    "status": (a.get("status") or {}).get("response")
                    if isinstance(a.get("status"), dict)
                    else None,
                }
            )
        body = ev.get("body")
        description = str(ev.get("bodyPreview") or "")
        if isinstance(body, dict) and body.get("content"):
            description = str(body.get("content"))[:4000]
        _upsert_event(
            session,
            conn,
            external_id=ext,
            calendar_id="primary",
            calendar_name="Calendar",
            title=str(ev.get("subject") or ""),
            description=description,
            location=location,
            start_at=start,
            end_at=end,
            all_day=all_day,
            status=str(ev.get("showAs") or "confirmed"),
            html_link=str(ev.get("webLink") or ""),
            attendees=attendees,
            existing=existing,
        )
        seen.add(ext)

    for ext, row in list(existing.items()):
        if ext not in seen:
            await session.delete(row)
    return len(seen)


async def sync_connection(
    session: AsyncSession, conn: IntegrationConnection
) -> dict[str, Any]:
    if conn.provider not in CALENDAR_PROVIDERS:
        return {"connection_id": str(conn.id), "synced": 0, "status": "skipped"}
    if conn.status != "active":
        return {"connection_id": str(conn.id), "synced": 0, "status": "inactive"}

    from app.services.crypto import get_connection_credentials
    creds = get_connection_credentials(conn)
    if creds.get("mock") or not creds.get("access_token"):
        return await _seed_mock_events(session, conn)

    token = await _access_token(session, conn)
    if not token:
        return await _seed_mock_events(session, conn)

    try:
        if conn.provider == "google_calendar":
            count = await _sync_google(session, conn, token)
        else:
            count = await _sync_outlook(session, conn, token)
        meta = _parse_json(conn.metadata_json)
        meta["last_synced_at"] = datetime.utcnow().isoformat()
        meta["sync_status"] = "ok"
        meta["sync_error"] = ""
        conn.metadata_json = json.dumps(meta)
        session.add(conn)
        await session.commit()
        return {"connection_id": str(conn.id), "synced": count, "status": "ok"}
    except Exception as exc:
        logger.exception("calendar sync failed connection=%s", conn.id)
        meta = _parse_json(conn.metadata_json)
        meta["last_synced_at"] = datetime.utcnow().isoformat()
        meta["sync_status"] = "error"
        meta["sync_error"] = str(exc)[:300]
        conn.metadata_json = json.dumps(meta)
        session.add(conn)
        await session.commit()
        return {
            "connection_id": str(conn.id),
            "synced": 0,
            "status": "error",
            "error": str(exc)[:300],
        }


async def list_calendar_connections(
    session: AsyncSession, tenant_id: UUID
) -> list[dict[str, Any]]:
    result = await session.execute(
        select(IntegrationConnection).where(
            IntegrationConnection.tenant_id == tenant_id,
            IntegrationConnection.provider.in_(list(CALENDAR_PROVIDERS)),
            IntegrationConnection.status == "active",
        )
    )
    rows = []
    for conn in result.scalars().all():
        meta = _parse_json(conn.metadata_json)
        count_result = await session.execute(
            select(CalendarEvent.id).where(CalendarEvent.connection_id == conn.id)
        )
        event_count = len(list(count_result.scalars().all()))
        rows.append(
            {
                "id": str(conn.id),
                "provider": conn.provider,
                "display_name": conn.display_name
                or ("Google Calendar" if conn.provider == "google_calendar" else "Outlook Calendar"),
                "status": conn.status,
                "last_synced_at": meta.get("last_synced_at"),
                "sync_status": meta.get("sync_status") or "idle",
                "sync_error": meta.get("sync_error") or "",
                "event_count": event_count,
            }
        )
    return rows


async def events_as_agenda_items(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    start: datetime,
    end: datetime,
) -> list[dict[str, Any]]:
    result = await session.execute(
        select(CalendarEvent).where(
            CalendarEvent.tenant_id == tenant_id,
            CalendarEvent.start_at < end,
            CalendarEvent.end_at > start,
            CalendarEvent.status != "cancelled",
        )
    )
    items: list[dict[str, Any]] = []
    for ev in result.scalars().all():
        provider_label = (
            "Google" if ev.provider == "google_calendar" else "Outlook"
        )
        items.append(
            {
                "id": f"cal:{ev.id}",
                "trigger_id": None,
                "name": ev.title or "(No title)",
                "kind": "calendar",
                "agent_id": None,
                "agent_role": "",
                "agent_name": None,
                "instructions": ev.description or "",
                "enabled": True,
                "at": ev.start_at.isoformat(),
                "end_at": ev.end_at.isoformat(),
                "status": "calendar",
                "run_id": None,
                "source": "calendar",
                "provider": ev.provider,
                "provider_label": provider_label,
                "calendar_id": ev.calendar_id,
                "calendar_name": ev.calendar_name,
                "location": ev.location,
                "html_link": ev.html_link,
                "all_day": ev.all_day,
                "connection_id": str(ev.connection_id),
                "external_id": ev.external_id,
            }
        )
    return items


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
) -> dict[str, Any]:
    """Create an event on the external calendar and cache it locally."""
    conn = await session.get(IntegrationConnection, connection_id)
    if conn is None or conn.tenant_id != tenant_id or conn.provider not in CALENDAR_PROVIDERS:
        raise ValueError("Calendar connection not found")
    from app.services.crypto import get_connection_credentials
    creds = get_connection_credentials(conn)
    if creds.get("mock") or not creds.get("access_token"):
        # Local-only demo write.
        row = CalendarEvent(
            tenant_id=tenant_id,
            connection_id=conn.id,
            provider=conn.provider,
            external_id=f"local-{uuid4().hex}",
            calendar_id="primary",
            calendar_name="Primary",
            title=title.strip() or "Untitled",
            description=description,
            location=location,
            start_at=_iso_naive(start_at),
            end_at=_iso_naive(end_at),
            status="confirmed",
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return {"id": str(row.id), "external_id": row.external_id, "mock": True}

    token = await _access_token(session, conn)
    if not token:
        raise ValueError("Calendar connection has no access token")

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    start_n = _iso_naive(start_at)
    end_n = _iso_naive(end_at)

    async with httpx.AsyncClient(timeout=30.0) as client:
        if conn.provider == "google_calendar":
            body = {
                "summary": title,
                "description": description,
                "location": location,
                "start": {"dateTime": start_n.isoformat() + "Z", "timeZone": "UTC"},
                "end": {"dateTime": end_n.isoformat() + "Z", "timeZone": "UTC"},
            }
            resp = await client.post(
                GOOGLE_EVENTS_URL.format(cal="primary"), headers=headers, json=body
            )
            resp.raise_for_status()
            data = resp.json()
            external_id = str(data.get("id") or "")
            html_link = str(data.get("htmlLink") or "")
        else:
            body = {
                "subject": title,
                "body": {"contentType": "text", "content": description},
                "location": {"displayName": location},
                "start": {"dateTime": start_n.isoformat(), "timeZone": "UTC"},
                "end": {"dateTime": end_n.isoformat(), "timeZone": "UTC"},
            }
            resp = await client.post(GRAPH_CREATE_URL, headers=headers, json=body)
            resp.raise_for_status()
            data = resp.json()
            external_id = str(data.get("id") or "")
            html_link = str(data.get("webLink") or "")

    row = CalendarEvent(
        tenant_id=tenant_id,
        connection_id=conn.id,
        provider=conn.provider,
        external_id=external_id or f"created-{uuid4().hex}",
        calendar_id="primary",
        calendar_name="Primary",
        title=title.strip() or "Untitled",
        description=description,
        location=location,
        start_at=start_n,
        end_at=end_n,
        status="confirmed",
        html_link=html_link,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return {"id": str(row.id), "external_id": row.external_id, "html_link": html_link}


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
) -> dict[str, Any]:
    """Patch an event on the external calendar and refresh the local cache."""
    row = await session.get(CalendarEvent, event_id)
    if row is None or row.tenant_id != tenant_id:
        raise ValueError("Event not found")

    new_title = title.strip() if title is not None else row.title
    new_title = (new_title or "").strip() or "Untitled"
    new_start = _iso_naive(start_at) if start_at is not None else row.start_at
    new_end = _iso_naive(end_at) if end_at is not None else row.end_at
    if new_end <= new_start:
        raise ValueError("end_at must be after start_at")
    new_description = description if description is not None else (row.description or "")
    new_location = location if location is not None else (row.location or "")

    conn = await session.get(IntegrationConnection, row.connection_id)
    if conn is None:
        raise ValueError("Calendar connection not found")
    from app.services.crypto import get_connection_credentials
    creds = get_connection_credentials(conn)
    mock_or_local = bool(creds.get("mock")) or (row.external_id or "").startswith(
        ("mock-", "local-")
    )

    if not mock_or_local:
        token = await _access_token(session, conn)
        if not token:
            raise ValueError("Calendar connection has no access token")
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            if conn.provider == "google_calendar":
                body = {
                    "summary": new_title,
                    "description": new_description,
                    "location": new_location,
                    "start": {
                        "dateTime": new_start.isoformat() + "Z",
                        "timeZone": "UTC",
                    },
                    "end": {
                        "dateTime": new_end.isoformat() + "Z",
                        "timeZone": "UTC",
                    },
                }
                url = (
                    GOOGLE_EVENTS_URL.format(cal=row.calendar_id or "primary")
                    + f"/{row.external_id}"
                )
                resp = await client.patch(url, headers=headers, json=body)
                resp.raise_for_status()
                data = resp.json()
                if data.get("htmlLink"):
                    row.html_link = str(data.get("htmlLink") or "")
            else:
                body = {
                    "subject": new_title,
                    "body": {"contentType": "text", "content": new_description},
                    "location": {"displayName": new_location},
                    "start": {"dateTime": new_start.isoformat(), "timeZone": "UTC"},
                    "end": {"dateTime": new_end.isoformat(), "timeZone": "UTC"},
                }
                resp = await client.patch(
                    GRAPH_EVENT_URL.format(id=row.external_id),
                    headers=headers,
                    json=body,
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("webLink"):
                    row.html_link = str(data.get("webLink") or "")

    row.title = new_title
    row.start_at = new_start
    row.end_at = new_end
    row.description = new_description
    row.location = new_location
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
    }


async def delete_external_event(
    session: AsyncSession, tenant_id: UUID, event_id: UUID
) -> None:
    row = await session.get(CalendarEvent, event_id)
    if row is None or row.tenant_id != tenant_id:
        raise ValueError("Event not found")
    conn = await session.get(IntegrationConnection, row.connection_id)
    if conn is None:
        await session.delete(row)
        await session.commit()
        return
    from app.services.crypto import get_connection_credentials
    creds = get_connection_credentials(conn)
    token = None if creds.get("mock") else await _access_token(session, conn)
    if token and row.external_id and not row.external_id.startswith(("mock-", "local-")):
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        async with httpx.AsyncClient(timeout=20.0) as client:
            if conn.provider == "google_calendar":
                url = GOOGLE_EVENTS_URL.format(cal=row.calendar_id or "primary") + f"/{row.external_id}"
                await client.delete(url, headers=headers)
            else:
                await client.delete(GRAPH_EVENT_URL.format(id=row.external_id), headers=headers)
    await session.delete(row)
    await session.commit()
