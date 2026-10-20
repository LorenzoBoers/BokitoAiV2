"""A flow is its stages: creating one without stages stores the default
pipeline named in the workspace language, and saving an empty pipeline is
refused. Migration 125 backfills old stage-less flows."""

import json
import os
from uuid import UUID

import pytest
from httpx import AsyncClient

from app.models.orchestra import Workstream
from app.services.tickets import DEFAULT_TICKET_STAGES, default_stages, has_explicit_stages
from scripts.seed import TEST_EMAIL, TEST_PASSWORD

os.environ["BOKITO_MOCK_EXECUTION"] = "true"

API = "/api/flows"


async def _login(client: AsyncClient) -> dict[str, str]:
    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.mark.asyncio
async def test_new_flow_without_stages_gets_default_pipeline(client: AsyncClient, session_override):
    headers = await _login(client)
    created = await client.post(API, headers=headers, json={"name": "offerte"})
    assert created.status_code == 200, created.text
    body = created.json()
    assert [s["key"] for s in body["stages"]] == [s["key"] for s in DEFAULT_TICKET_STAGES]

    ws = await session_override.get(Workstream, UUID(body["id"]))
    assert has_explicit_stages(ws)
    assert json.loads(ws.stages_json)[0]["key"] == DEFAULT_TICKET_STAGES[0]["key"]


@pytest.mark.asyncio
async def test_saving_empty_or_doneless_pipeline_is_refused(client: AsyncClient):
    headers = await _login(client)
    flow = (await client.post(API, headers=headers, json={"name": "retour"})).json()

    empty = await client.patch(f"{API}/{flow['id']}", headers=headers, json={"stages": []})
    assert empty.status_code == 400

    no_done = await client.patch(
        f"{API}/{flow['id']}", headers=headers, json={"stages": [{"name": "Only", "kind": "open"}]}
    )
    assert no_done.status_code == 400

    unchanged = (await client.get(f"{API}/{flow['id']}", headers=headers)).json()
    assert [s["key"] for s in unchanged["stages"]] == [s["key"] for s in DEFAULT_TICKET_STAGES]


def test_default_stages_are_named_in_the_workspace_language():
    assert [s["name"] for s in default_stages("en")] == ["Not started", "Waiting", "Done"]
    assert [s["name"] for s in default_stages("nl")] == ["Niet gestart", "Wachtend", "Klaar"]
    assert [s["key"] for s in default_stages("nl")] == ["open", "waiting", "done"]
