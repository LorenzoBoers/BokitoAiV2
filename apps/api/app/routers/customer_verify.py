"""Public magic-link endpoint for thread-scoped customer assurance."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.services.customer_verify import consume_verify_token

router = APIRouter(prefix="/customer-verify", tags=["customer-verify"])

_SUCCESS_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Conversation confirmed</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 3rem auto; max-width: 32rem;
           color: #111; line-height: 1.5; padding: 0 1.25rem; }
    h1 { font-size: 1.25rem; font-weight: 600; }
    p { color: #444; }
  </style>
</head>
<body>
  <h1>Conversation confirmed</h1>
  <p>You can return to the chat. This confirmation stays active for a short while.</p>
</body>
</html>
"""

_FAIL_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Link expired</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 3rem auto; max-width: 32rem;
           color: #111; line-height: 1.5; padding: 0 1.25rem; }
    h1 { font-size: 1.25rem; font-weight: 600; }
    p { color: #444; }
  </style>
</head>
<body>
  <h1>This link is no longer valid</h1>
  <p>Ask in the chat for a new confirmation link.</p>
</body>
</html>
"""


def _wants_json(request: Request) -> bool:
    accept = (request.headers.get("accept") or "").lower()
    return "application/json" in accept and "text/html" not in accept


@router.api_route("/{token}", methods=["GET", "POST"])
async def consume_customer_verify(
    token: str,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Confirm a pending magic link and attach assurance to the thread.

    GET is the email click-through. POST (or ``Accept: application/json``)
    returns a machine payload for tests and the widget refresh path.
    """
    signal = await consume_verify_token(session, token)
    if signal is None:
        if _wants_json(request) or request.method == "POST":
            return JSONResponse(
                {"ok": False, "error": "This link is no longer valid"},
                status_code=400,
            )
        return HTMLResponse(_FAIL_HTML, status_code=400)
    payload = {
        "ok": True,
        "signal_id": str(signal.id),
        "assurance_level": signal.assurance_level,
    }
    if _wants_json(request) or request.method == "POST":
        return payload
    return HTMLResponse(_SUCCESS_HTML)
