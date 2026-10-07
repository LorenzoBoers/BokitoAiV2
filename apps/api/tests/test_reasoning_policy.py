from app.services.agent.reasoning_policy import (
    KONG_MIN_BUDGET,
    turn_needs_reasoning,
    turn_thinking_budget,
)


def test_small_talk_skips_reasoning():
    for text in ("Hoi", "Hoe gaat het?", "thanks!", "ok, top", ""):
        assert not turn_needs_reasoning(text, has_attachments=False), text


def test_tasks_and_questions_reason():
    for text in (
        "Waarom krijgt deze klant geen antwoord?",
        "How do I connect WhatsApp?",
        "Maak een flow voor retouren",
        "Kun je dit vergelijken? En wat kost het?",
        "Check https://example.com/page",
        "x" * 200,
    ):
        assert turn_needs_reasoning(text, has_attachments=False), text
    assert turn_needs_reasoning("hoi", has_attachments=True)


def test_slim_think_item_reports_text_presence():
    from app.services.agent.turn_persist import slim_activity_item

    empty = slim_activity_item({"id": "t", "kind": "think", "text": "  "})
    full = slim_activity_item({"id": "t", "kind": "think", "text": "weighing"})
    assert empty["has_text"] is False and "text" not in empty
    assert full["has_text"] is True and "text" not in full
    assert "has_text" not in slim_activity_item({"id": "w", "kind": "work", "text": "x"})


def test_budget_by_tier_and_pin():
    small_talk = "Hoi"
    task = "Leg uit waarom deze flow niet start"
    kw = {"has_attachments": False}

    assert turn_thinking_budget(1024, model_slug="bokito-ai-3-1", user_text=small_talk, agent_pinned=False, **kw) == 0
    assert turn_thinking_budget(1024, model_slug="bokito-ai-3-1", user_text=task, agent_pinned=False, **kw) == 1024
    assert turn_thinking_budget(2048, model_slug="bokito-ai-3-1", user_text=small_talk, agent_pinned=True, **kw) == 2048
    assert turn_thinking_budget(0, model_slug="bokito-ai-3-1", user_text=task, agent_pinned=False, **kw) == 0
    assert turn_thinking_budget(0, model_slug="bokito-kong", user_text=small_talk, agent_pinned=False, **kw) == KONG_MIN_BUDGET
    assert turn_thinking_budget(8192, model_slug="bokito-kong", user_text=small_talk, agent_pinned=False, **kw) == 8192
