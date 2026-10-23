"""Service errors keep the HTTPException JSON shape."""

from __future__ import annotations

import json

import pytest
from fastapi import HTTPException

from app.exceptions import NotFoundError, app_error_handler, http_exception_handler, status_error


def _body(response) -> dict:
    return json.loads(response.body)


@pytest.mark.asyncio
async def test_status_error_matches_http_exception_body():
    cases = [
        (400, "nope", None),
        (404, "missing", None),
        (409, {"code": "clash", "message": "taken", "id": "1"}, None),
        (410, "This endpoint was removed", None),
        (422, "bad field", None),
        (503, "down", {"Retry-After": "3"}),
        (500, None, None),
    ]
    for status, detail, headers in cases:
        http_exc = HTTPException(status_code=status, detail=detail, headers=headers)
        domain = status_error(status_code=status, detail=detail, headers=headers)
        http_res = await http_exception_handler(None, http_exc)  # type: ignore[arg-type]
        app_res = await app_error_handler(None, domain)
        assert app_res.status_code == http_res.status_code
        assert _body(app_res) == _body(http_res)
        assert domain.status_code == status
        assert domain.detail == http_exc.detail


def test_typed_errors_keep_their_code():
    err = NotFoundError("Signal not found")
    assert err.status_code == 404
    assert err.code == "not_found"
    assert err.detail == "Signal not found"
    assert str(err) == "Signal not found"
