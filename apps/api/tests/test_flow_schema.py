"""The flow notation: steps, arrows, and what an arrow carries."""

from uuid import uuid4

import pytest

from app.services.flow_schema import parse_schema, render_schema

BLOG = """
onderwerp: Kies het onderwerp en de lezer
  wie: beide
  tools: geen
  geeft: onderwerp

research: Zoek feiten en voorbeelden
  wie: agent
  tools: web_search
  krijgt: onderwerp
  geeft: feiten
  faalt: retry 2, dan naar schrijven

schrijven: Schrijf de blogpost
  wie: agent
  tools: write
  krijgt: onderwerp
  geeft: concept

review: Lees de post na
  wie: user
  tools: geen
  krijgt: concept
  stil: retry 3d, dan stop

publiceren: Zet de post online
  wie: user
  tools: publish
  krijgt: concept
  faalt: stop

onderwerp -> research: onderwerp gekozen
  geeft: onderwerp
research -> schrijven: feiten rond
  geeft: feiten
research -> schrijven: zoeken mislukt
onderwerp -> schrijven: onderwerp is al uitgewerkt
  geeft: onderwerp
schrijven -> review: concept klaar
  geeft: concept
review -> schrijven: herschrijven
  geeft: concept
review -> publiceren: review akkoord
  geeft: concept
review -> stop: geen reactie
"""


def test_blog_schema_keeps_arrows_data_and_failures():
    graph = parse_schema(BLOG)
    assert graph["errors"] == []
    by_name = {node["name"]: node for node in graph["nodes"]}
    assert by_name["research"]["faalt"] == "retry 2, dan naar schrijven"
    assert by_name["review"]["stil"] == "retry 3d, dan stop"
    assert by_name["publiceren"]["faalt"] == "stop"
    carried = [edge for edge in graph["edges"] if edge["src"] == "onderwerp" and edge["dst"] == "schrijven"]
    assert carried[0]["when"] == "onderwerp is al uitgewerkt"
    assert carried[0]["geeft"] == "onderwerp"
    assert any(edge["dst"] == "stop" and edge["when"] == "geen reactie" for edge in graph["edges"])
    again = parse_schema(render_schema(graph["nodes"], graph["edges"]))
    assert again["errors"] == []
    assert len(again["edges"]) == len(graph["edges"])


def test_arrow_carries_failure_rules():
    graph = parse_schema("review: Lees na\nreview -> stop: geen reactie\n  stil: retry 3d, dan stop\n  geeft: concept\n")
    assert graph["errors"] == []
    assert graph["edges"][0]["stil"] == "retry 3d, dan stop"
    assert graph["edges"][0]["geeft"] == "concept"
    again = parse_schema(render_schema(graph["nodes"], graph["edges"]))
    assert again["edges"][0]["stil"] == "retry 3d, dan stop"


def test_plek_round_trips_and_is_validated():
    graph = parse_schema("extra: Controleer de bijlage\n  plek: 2,-1\n")
    assert graph["errors"] == []
    assert graph["nodes"][0]["plek"] == "2,-1"
    assert "  plek: 2,-1" in render_schema(graph["nodes"], graph["edges"])
    assert parse_schema("extra: Controleer\n  plek: boven\n")["errors"]


def test_max_and_unknown_step_are_rejected():
    assert parse_schema("vragen: Stel de open punten\n  max: 3 werkdagen\n")["errors"] == []
    bad = parse_schema("vragen: Stel de open punten\n  max: morgen\n")
    assert bad["errors"]
    missing = parse_schema("vragen: Stel de open punten\nvragen -> controle: klaar\n")
    assert any("controle" in error["message"] for error in missing["errors"])


@pytest.mark.asyncio
async def test_patch_flow_source_round_trip(client):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    created = await client.post("/api/labels", headers=headers, json={"name": f"schema-{uuid4().hex[:4]}"})
    assert created.status_code == 200, created.text
    ws_id = created.json()["workstream_id"]

    saved = await client.patch(f"/api/flows/{ws_id}", headers=headers, json={"flow_source": BLOG})
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["flow_graph"]["errors"] == []
    assert any(edge["dst"] == "stop" for edge in body["flow_graph"]["edges"])
    assert any(node["name"] == "stop" for node in body["flow_graph"]["nodes"])

    parsed = await client.post("/api/flows/schema/parse", headers=headers, json={"source": BLOG})
    assert parsed.status_code == 200, parsed.text
    assert parsed.json()["errors"] == []
