from app.services.agent.reasoning_policy import (
    KONG_MIN_BUDGET,
    PACE_REPLY,
    PACE_REPLY_THEN_THINK,
    PACE_THINK,
    turn_is_action_request,
    turn_needs_reasoning,
    turn_pace,
    turn_thinking_budget,
)


def test_small_talk_skips_reasoning():
    for text in ("Hoi", "Hoe gaat het?", "Hoe is het met jou?", "thanks!", "ok, top", ""):
        assert not turn_needs_reasoning(text, has_attachments=False), text
        assert turn_pace(text) == PACE_REPLY, text


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


def test_action_requests_skip_the_opening_think():
    assert turn_is_action_request("Kun je deze agent even inschakelen?")
    assert turn_is_action_request("Can you turn that agent on for me?")
    assert turn_is_action_request("Maak een flow voor retouren")
    assert not turn_is_action_request("Waarom krijgt deze klant geen antwoord?")
    assert not turn_is_action_request("Hoe kan ik WhatsApp koppelen?")
    assert not turn_is_action_request("Hoi")
    assert not turn_is_action_request("Wat kan je vinden over dit contact")
    assert not turn_is_action_request("What can you find about this contact?")


def test_lookup_questions_stay_reply_pace():
    from app.services.agent.reasoning_policy import turn_is_lookup_request

    for text in (
        "Wat kan je vinden over dit contact",
        "What can you find about this contact?",
        "Vertel me over deze klant",
        "Wie is dit?",
        "What do you know about this contact",
    ):
        assert turn_is_lookup_request(text), text
        assert turn_pace(text) == PACE_REPLY, text
        assert (
            turn_thinking_budget(
                1024, model_slug="bokito-ai-3-1", user_text=text, agent_pinned=False
            )
            == 0
        ), text


def test_pace_splits_reply_then_think_from_explain():
    assert turn_pace("Kun je deze agent even inschakelen?") == PACE_REPLY_THEN_THINK
    assert turn_pace("Maak een flow voor retouren") == PACE_REPLY_THEN_THINK
    assert turn_pace("Waarom krijgt deze klant geen antwoord?") == PACE_THINK
    assert turn_pace("Hoe kan ik WhatsApp koppelen?") == PACE_THINK


def test_budget_by_tier_and_pin():
    small_talk = "Hoe is het met jou?"
    task = "Leg uit waarom deze flow niet start"
    kw = {"has_attachments": False}

    assert turn_thinking_budget(1024, model_slug="bokito-ai-3-1", user_text=small_talk, agent_pinned=False, **kw) == 0
    assert turn_thinking_budget(1024, model_slug="bokito-ai-3-1", user_text=task, agent_pinned=False, **kw) == 1024
    assert turn_thinking_budget(2048, model_slug="bokito-ai-3-1", user_text=small_talk, agent_pinned=True, **kw) == 0
    assert turn_thinking_budget(2048, model_slug="bokito-ai-3-1", user_text=task, agent_pinned=True, **kw) == 2048
    assert turn_thinking_budget(0, model_slug="bokito-ai-3-1", user_text=task, agent_pinned=False, **kw) == 0
    assert turn_thinking_budget(0, model_slug="bokito-kong", user_text=small_talk, agent_pinned=False, **kw) == 0
    assert turn_thinking_budget(0, model_slug="bokito-kong", user_text=task, agent_pinned=False, **kw) == KONG_MIN_BUDGET
    assert turn_thinking_budget(8192, model_slug="bokito-kong", user_text=task, agent_pinned=False, **kw) == 8192
