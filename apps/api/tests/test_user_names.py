"""First / last name helpers keep display_name in sync."""

from __future__ import annotations

from types import SimpleNamespace

from app.services.user_names import (
    apply_user_names,
    compose_display_name,
    split_display_name,
    user_full_name,
)


def test_compose_and_split():
    assert compose_display_name("Ada", "Lovelace") == "Ada Lovelace"
    assert compose_display_name("Ada", "") == "Ada"
    assert split_display_name("Ada Lovelace") == ("Ada", "Lovelace")
    assert split_display_name("Ada") == ("Ada", "")
    assert split_display_name("") == ("", "")


def test_apply_user_names_prefers_parts():
    user = SimpleNamespace(first_name="", last_name="", display_name="")
    apply_user_names(user, first_name="Ada", last_name="Lovelace")
    assert user.first_name == "Ada"
    assert user.last_name == "Lovelace"
    assert user.display_name == "Ada Lovelace"


def test_apply_user_names_splits_legacy_display():
    user = SimpleNamespace(first_name="", last_name="", display_name="")
    apply_user_names(user, display_name="Ada Lovelace")
    assert user.first_name == "Ada"
    assert user.last_name == "Lovelace"
    assert user.display_name == "Ada Lovelace"


def test_apply_user_names_patch_one_side():
    user = SimpleNamespace(first_name="Ada", last_name="Lovelace", display_name="Ada Lovelace")
    apply_user_names(user, first_name="Augusta")
    assert user.first_name == "Augusta"
    assert user.last_name == "Lovelace"
    assert user.display_name == "Augusta Lovelace"


def test_user_full_name_fallback():
    user = SimpleNamespace(first_name="", last_name="", display_name="Legacy", email="a@b.c")
    assert user_full_name(user) == "Legacy"
    user.display_name = ""
    assert user_full_name(user) == "a@b.c"
