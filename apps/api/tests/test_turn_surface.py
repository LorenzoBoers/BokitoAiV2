"""The public activity item carries the line the chat shows."""

from app.services.agent.turn_persist import slim_activity_item
from app.services.agent.turn_surface import status_view


def test_web_search_publishes_host_without_the_result_payload():
    shown = slim_activity_item(
        {
            "id": "s1",
            "kind": "work",
            "tool": "web_search",
            "status": "ok",
            "label": "Search: bokito ai",
            "input": {"query": "bokito ai"},
            "result": {"results": [{"host": "bokito.ai", "favicon_url": "https://icons.example/b.png"}]},
        }
    )
    assert shown["label"] == "bokito.ai"
    assert shown["host"] == "bokito.ai"
    assert shown["favicon_url"] == "https://icons.example/b.png"
    assert "result" not in shown
    assert "input" not in shown


def test_running_search_uses_a_site_in_the_query():
    shown = slim_activity_item(
        {
            "id": "s2",
            "kind": "work",
            "tool": "web_search",
            "status": "running",
            "input": {"query": "site:chargecars.nl laadpas prijs"},
        }
    )
    assert shown["host"] == "chargecars.nl"
    assert shown["label"] == "chargecars.nl"
    assert "chargecars.nl" in shown["favicon_url"]


def test_search_without_a_host_keeps_a_translation_key():
    shown = slim_activity_item(
        {
            "id": "s3",
            "kind": "work",
            "tool": "web_search",
            "status": "running",
            "input": {"query": "laadpas prijs"},
        }
    )
    assert shown["label_key"] == "activity.webSearch"
    assert shown["label_params"] == {"query": "laadpas prijs"}


def test_saved_history_is_one_row_plus_frames():
    from app.services.agent.turn_persist import message_activity

    payload = message_activity(
        {
            "activity": [
                {
                    "id": "img",
                    "kind": "work",
                    "tool": "generate_image",
                    "status": "ok",
                    "result": {"images": ["https://files.example/a.jpg"]},
                },
                {
                    "id": "search",
                    "kind": "work",
                    "tool": "web_search",
                    "status": "ok",
                    "label": "Search: bokito",
                    "input": {"query": "bokito"},
                    "result": {"results": [{"host": "bokito.ai"}]},
                    "started_at": "2026-10-18T12:00:00Z",
                    "ended_at": "2026-10-18T12:00:02Z",
                },
            ]
        },
        detail=False,
    )
    history = payload["history"]
    assert history is not None
    assert history["frames"] == [{"id": "img:0", "status": "ready", "src": "https://files.example/a.jpg"}]
    assert any(row["label_key"] == "activity.generatedImage" for row in history["rows"])
    assert any(row["label"] == "bokito.ai" for row in history["rows"])
    assert "result" not in payload["activity"][0]


def test_tool_phrase_is_progressive_while_running_and_past_when_done():
    from app.services.agent.turn_surface import present_activity

    running = present_activity({"tool": "list_docs", "status": "running", "kind": "work"})
    assert running["label_key"] == "activity.verb.list.running"
    assert running["label_params"]["object"] == "docs"
    done = present_activity({"tool": "list_docs", "status": "ok", "kind": "work"})
    assert done["label_key"] == "activity.verb.list.done"
    think = present_activity({"kind": "think", "status": "ok", "text": "ok"})
    assert think["label_key"] == "activity.thought"
    from app.services.agent.turn_surface import surface_motion

    assert surface_motion([], speaking=True, worked=False) == "writing"
    assert surface_motion([{"kind": "think", "status": "running"}], speaking=False, worked=False) == "thinking"
    assert surface_motion([{"tool": "generate_image", "status": "running"}], speaking=False, worked=True) == "working"
    assert surface_motion([{"tool": "propose_action", "status": "ok", "proposes": True}], speaking=False, worked=True) == "writing"
    assert surface_motion([{"tool": "web_search", "status": "running"}], speaking=False, worked=False) == "searching"
    assert surface_motion([{"tool": "ask_agent", "status": "running"}], speaking=False, worked=False) == "sending"
    assert surface_motion([], speaking=False, worked=False, opening=True) == "thinking"
    assert surface_motion([], speaking=False, worked=False) == "idle"


def test_closing_motion_names_the_last_reaction():
    from app.services.agent.turn_surface import closing_motion

    assert closing_motion([], None) == "done"
    assert closing_motion([], "error") == "alert"
    assert closing_motion([], "cancelled") is None
    assert closing_motion([], "silent") is None
    assert closing_motion([{"tool": "handoff_to", "status": "ok"}], None) == "leave"
    assert closing_motion([{"tool": "handoff_to", "status": "error"}], None) == "done"


def test_list_text_drops_the_picture_the_frames_already_show():
    from app.services.agent.turn_surface import spoken_text

    history = {"frames": [{"src": "https://files.example/a.jpg"}]}
    text = "Hier is hij.\n\n![Haai](https://cdn.example/other.jpg)"
    assert spoken_text(text, history) == "Hier is hij."
    assert spoken_text(text, None) == text


def test_gap_after_a_proposal_uses_the_preparing_line():
    pending = [{"tool": "propose_action", "status": "ok", "proposes": True}]
    gap = status_view(pending, worked=True, speaking=False)
    assert gap is not None
    assert gap["label_key"] == "proposal.preparing"


def test_status_line_follows_the_running_tool_then_goes_quiet():
    pending = [{"tool": "generate_image", "status": "running", "label": "Generate image"}]
    live = status_view(pending, worked=True, speaking=False)
    assert live is not None
    assert live["label_key"] == "activity.generatingImage"
    assert live["frames"][0]["status"] == "running"
    speaking = status_view(pending, worked=True, speaking=True)
    assert speaking is not None
    assert speaking["label_key"] == ""
    assert speaking["frames"][0]["status"] == "running"
    assert status_view([], worked=False, speaking=True) is None
    gap = status_view([{"tool": "generate_image", "status": "ok"}], worked=True, speaking=False)
    assert gap is not None
    assert gap["label_key"] == "activity.working"
    assert status_view([], worked=False, speaking=False) is None
    opening = status_view([], worked=False, speaking=False, opening=True)
    assert opening is not None
    assert opening["label_key"] == "activity.looking"


def test_invite_publishes_the_name_for_translation():
    shown = slim_activity_item(
        {
            "id": "i1",
            "kind": "work",
            "tool": "invite_to_thread",
            "status": "ok",
            "input": {"name": "Ada"},
            "result": {"name": "Ada"},
        }
    )
    assert shown["label_key"] == "activity.inviting"
    assert shown["label_params"] == {"name": "Ada"}
    assert "result" not in shown
