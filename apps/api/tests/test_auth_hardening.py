"""Round-2 hardening: dev auth tokens are opt-in; rate limiter ignores spoofed XFF."""

import pytest
from httpx import AsyncClient
from starlette.requests import Request

from app.config import get_settings
from app.middleware import rate_limit as rl
from scripts.seed import TEST_EMAIL

API = "/api"


@pytest.mark.asyncio
async def test_reset_request_hides_token_when_flag_off(client: AsyncClient, monkeypatch):
    monkeypatch.setattr(get_settings(), "expose_dev_auth_tokens", False)
    res = await client.post(f"{API}/auth/password-reset-request", json={"email": TEST_EMAIL})
    assert res.status_code == 200
    body = res.json()
    assert "dev_token" not in body and "dev_link" not in body


def _request(xff: str | None, peer: str = "10.0.0.2") -> Request:
    headers = [(b"x-forwarded-for", xff.encode())] if xff is not None else []
    return Request({"type": "http", "headers": headers, "client": (peer, 1234)})


def test_client_ip_uses_last_trusted_hop(monkeypatch):
    monkeypatch.setattr(get_settings(), "trusted_proxy_hops", 1)
    # Caller spoofs a left-most value; Caddy appends the real peer last.
    assert rl._client_ip(_request("1.2.3.4, 203.0.113.7")) == "203.0.113.7"
    assert rl._client_ip(_request("203.0.113.7")) == "203.0.113.7"
    assert rl._client_ip(_request(None)) == "10.0.0.2"


def test_client_ip_zero_hops_uses_socket_peer(monkeypatch):
    monkeypatch.setattr(get_settings(), "trusted_proxy_hops", 0)
    assert rl._client_ip(_request("1.2.3.4")) == "10.0.0.2"
