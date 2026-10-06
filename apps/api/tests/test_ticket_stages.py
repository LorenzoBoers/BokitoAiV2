"""Stage pipeline shape: kinds + optional auto-close on done."""

from __future__ import annotations

import json

import pytest
from fastapi import HTTPException

from app.services.tickets import parse_stages, validate_stages


def test_validate_stages_persists_auto_close_only_on_done():
    raw = validate_stages(
        [
            {"name": "Intake", "kind": "open", "auto_close_conversation": True},
            {"name": "Busy", "kind": "waiting", "auto_close_conversation": True},
            {"name": "Klaar", "kind": "done", "auto_close_conversation": True},
            {"name": "Archief", "kind": "closed", "auto_close_conversation": True},
        ]
    )
    stages = json.loads(raw)
    assert [s["kind"] for s in stages] == ["open", "waiting", "done", "closed"]
    assert stages[0]["auto_close_conversation"] is False
    assert stages[1]["auto_close_conversation"] is False
    assert stages[2]["auto_close_conversation"] is True
    assert stages[3]["auto_close_conversation"] is False


def test_parse_stages_defaults_auto_close_false():
    stages = parse_stages('[{"key":"done","name":"Done","kind":"done"}]')
    assert stages[0]["auto_close_conversation"] is False


def test_validate_stages_requires_done():
    with pytest.raises(HTTPException) as exc:
        validate_stages([{"name": "Only open", "kind": "open"}])
    assert exc.value.status_code == 400
