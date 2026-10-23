"""Dashboard skills: every example is a valid, drawable, well-designed dashboard."""

import pytest

from app.services.canvas_blocks import blocks_to_tree, polish_blocks, render_problems, validate_blocks
from app.services.canvas_skills import DEFAULT_SKILL, SKILLS, skill_brief, skill_menu


@pytest.mark.parametrize("skill_id", list(SKILLS))
def test_skill_example_is_valid_and_clean(skill_id):
    example = SKILLS[skill_id].example
    blocks, errors = validate_blocks(example)
    assert errors == []
    assert render_problems(blocks) == []
    _polished, notes = polish_blocks(blocks)
    assert notes == []
    assert blocks_to_tree(blocks)["children"][0]["type"] == "Heading"


def test_brief_falls_back_to_default_and_lists_others():
    brief = skill_brief("does-not-exist")
    assert brief["id"] == DEFAULT_SKILL
    assert brief["rules"] and brief["steps"] and brief["example"]
    assert DEFAULT_SKILL not in brief["other_skills"]


def test_menu_has_one_line_per_skill():
    assert len(skill_menu().splitlines()) == len(SKILLS)
