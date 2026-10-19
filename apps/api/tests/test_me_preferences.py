"""Sidebar preference sanitizer keeps section order and per-view layout."""

from app.routers.me import _sidebar_state


def test_sidebar_state_keeps_flows_and_view_layout():
    out = _sidebar_state(
        {
            "sidebar": {
                "order": ["channels", "folders", "agents", "teams", "settings"],
                "item_order": {"inbox": ["queue:open", "queue:for_you"]},
                "hidden_items": ["queue:for_you", "queue:open", "queue:spam"],
            }
        }
    )
    assert out["order"] == ["channels", "folders", "flows", "agents", "teams", "settings"]
    assert out["item_order"]["inbox"] == ["queue:open", "queue:for_you"]
    assert out["hidden_items"] == ["queue:for_you", "queue:spam"]
