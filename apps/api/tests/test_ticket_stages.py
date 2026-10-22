"""Stage pipeline shape: kinds + optional auto-close on done."""

from __future__ import annotations

import json

import pytest
from fastapi import HTTPException
from app.exceptions import AppError

from app.services.tickets import (
    missing_required_stage_fields,
    parse_stages,
    validate_stages,
    waiting_stage_progress,
)


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


def test_validate_stages_rejects_not_started_after_active():
    with pytest.raises((HTTPException, AppError)) as exc:
        validate_stages(
            [
                {"name": "Busy", "kind": "waiting"},
                {"name": "Later", "kind": "open"},
                {"name": "Klaar", "kind": "done"},
            ]
        )
    assert exc.value.status_code == 400


def test_validate_stages_rejects_done_before_active():
    with pytest.raises((HTTPException, AppError)) as exc:
        validate_stages(
            [
                {"name": "Klaar", "kind": "done"},
                {"name": "Busy", "kind": "waiting"},
            ]
        )
    assert exc.value.status_code == 400


def test_waiting_stage_progress_splits_the_ring():
    stages = [
        {"kind": "open"},
        {"kind": "waiting"},
        {"kind": "waiting"},
        {"kind": "waiting"},
        {"kind": "done"},
    ]
    assert waiting_stage_progress(stages, 0) is None
    assert waiting_stage_progress(stages, 1) == 0.25
    assert waiting_stage_progress(stages, 2) == 0.5
    assert waiting_stage_progress(stages, 3) == 0.75
    assert waiting_stage_progress([{"kind": "waiting"}], 0) == 0.5


def test_validate_stages_requires_done():
    with pytest.raises((HTTPException, AppError)) as exc:
        validate_stages([{"name": "Only open", "kind": "open"}])
    assert exc.value.status_code == 400


def test_validate_stages_requires_first_not_started():
    with pytest.raises((HTTPException, AppError)) as exc:
        validate_stages(
            [
                {"name": "Busy", "kind": "waiting"},
                {"name": "Klaar", "kind": "done"},
            ]
        )
    assert exc.value.status_code == 400
    assert "not-started" in str(exc.value.detail).lower()


def test_validate_stages_rejects_extra_not_started():
    with pytest.raises((HTTPException, AppError)) as exc:
        validate_stages(
            [
                {"name": "Start", "kind": "open"},
                {"name": "Again", "kind": "open"},
                {"name": "Klaar", "kind": "done"},
            ]
        )
    assert exc.value.status_code == 400


def test_validate_stages_allows_multiple_done():
    raw = validate_stages(
        [
            {"name": "Start", "kind": "open"},
            {"name": "Busy", "kind": "waiting"},
            {"name": "Klaar", "kind": "done"},
            {"name": "Archief", "kind": "done"},
        ]
    )
    assert [s["kind"] for s in json.loads(raw)] == ["open", "waiting", "done", "done"]


def test_missing_required_stage_fields():
    stages = parse_stages(
        json.dumps(
            [
                {"key": "open", "name": "Open", "kind": "open"},
                {
                    "key": "klaar",
                    "name": "Klaar",
                    "kind": "done",
                    "fields": [
                        {"key": "eindoordeel", "name": "Eindoordeel", "type": "text", "required": True},
                        {"key": "note", "name": "Note", "type": "text", "required": False},
                    ],
                },
            ]
        )
    )
    klaar = stages[1]
    assert [f["key"] for f in missing_required_stage_fields(klaar, {})] == ["eindoordeel"]
    assert missing_required_stage_fields(klaar, {"eindoordeel": "ok"}) == []
    assert missing_required_stage_fields(stages[0], {}) == []

