"""Shared Lucide catalog for labels and agent icon marks."""

from app.data.platform_icons import PLATFORM_ICON_IDS
from app.services.agent_avatar import ALLOWED_ICONS, normalize_icon
from app.services.signal_tags import LABEL_ICONS, normalize_label_icon


def test_platform_icons_is_large_lucide_set():
    assert len(PLATFORM_ICON_IDS) > 1000
    # Former curated ids stay valid.
    for key in ("route", "bug", "headset", "building-2", "flask-conical", "life-buoy"):
        assert key in PLATFORM_ICON_IDS


def test_label_and_agent_share_the_same_allowlist():
    assert LABEL_ICONS is PLATFORM_ICON_IDS
    assert ALLOWED_ICONS is PLATFORM_ICON_IDS


def test_normalize_label_icon_accepts_lucide_and_rejects_garbage():
    assert normalize_label_icon("A-Arrow-Down") == "a-arrow-down"
    assert normalize_label_icon("not-a-real-icon") == ""
    assert normalize_label_icon(None) == ""


def test_normalize_agent_icon_accepts_lucide_and_rejects_garbage():
    assert normalize_icon("Brain") == "brain"
    assert normalize_icon("zzz-fake-icon") is None
    assert normalize_icon(None) is None
