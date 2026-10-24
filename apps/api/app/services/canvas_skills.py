"""Dashboard skills: proven layouts the agent loads only when it opens a canvas.

The system prompt carries one line per skill (id and when to use it). The full
guide and an example arrive in the create_canvas result, right before the
agent writes blocks. Layout itself belongs to ``canvas_blocks._layout``; a
skill only decides which blocks, in which order.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

DEFAULT_SKILL = "overview"


@dataclass(frozen=True)
class CanvasSkill:
    id: str
    when: str
    steps: tuple[str, ...]
    example: list[dict[str, Any]] = field(default_factory=list)


_RULES = (
    "Heading first: one sentence that states the finding, not a label "
    "('Omzet 12% boven plan', not 'Dashboard Q3').",
    "3-6 stats directly under it. Give each one context: delta ('+12%'), "
    "target, or a short hint. status good/watch/bad only when there is a norm.",
    "Then the chart that proves the headline. Then supporting charts. A table "
    "with the detail rows comes last.",
    "Write a flat list in reading order. The server builds the KPI row and "
    "the columns; do not use grid or card for layout.",
    "Only real numbers from tools or the conversation. No placeholders, no zeros "
    "for missing data; leave a block out instead.",
    "On every stat, chart, pie and table set source.tool_use_id to the "
    "tool_use_id string on the tool result that produced the number. Copy that "
    "string exactly. Do not invent an id, a time, or a conversation id. The "
    "server fills the tool name and time.",
    "Write labels and text in the operator's language; the example only shows the shape.",
)


SKILLS: dict[str, CanvasSkill] = {
    skill.id: skill
    for skill in (
        CanvasSkill(
            id="overview",
            when="Status of an area or business: how are we doing, what needs attention.",
            steps=(
                "heading with the main finding",
                "3-4 stats with delta or target",
                "one line_chart or area_chart for the most important trend",
                "one bar_chart that explains it (by segment, channel, owner)",
                "callout with the one thing to act on, tone warning or success",
                "table with the rows behind the numbers",
            ),
            example=[
                {"type": "heading", "text": "Omzet 12% boven plan, marge staat onder druk"},
                {"type": "stat", "label": "Omzet", "value": "EUR 84k", "delta": "+12%", "target": "EUR 75k", "status": "good"},
                {"type": "stat", "label": "Marge", "value": "31%", "delta": "-4 pt", "status": "watch"},
                {"type": "stat", "label": "Open offertes", "value": "17", "hint": "EUR 52k totaal"},
                {"type": "line_chart", "title": "Omzet per week", "labels": ["W1", "W2", "W3", "W4"], "series": [{"name": "Omzet", "values": [18, 21, 22, 23]}]},
                {"type": "bar_chart", "title": "Marge per productgroep", "labels": ["Advies", "Licenties", "Support"], "series": [{"name": "Marge %", "values": [44, 22, 29]}]},
                {"type": "callout", "tone": "warning", "text": "Licenties drukken de marge; prijsafspraak met leverancier loopt af in november."},
                {"type": "table", "title": "Grootste deals", "columns": ["Klant", "Bedrag", "Status"], "rows": [["Acme", "EUR 12k", "Gewonnen"], ["Globex", "EUR 9k", "Offerte"]]},
            ],
        ),
        CanvasSkill(
            id="trend",
            when="How something changes over time: growth, seasonality, before and after.",
            steps=(
                "heading that names the direction ('Tickets dalen sinds maart')",
                "stats: current value with delta, peak, and average",
                "line_chart in time order as the hero; area_chart with stacked=true for parts of a total",
                "optional bar_chart comparing this period with the last one (two series)",
                "callout with the likely cause when the data shows it",
            ),
            example=[
                {"type": "heading", "text": "Tickets dalen sinds maart"},
                {"type": "stat", "label": "Deze maand", "value": "212", "delta": "-18%", "status": "good"},
                {"type": "stat", "label": "Piek", "value": "301", "hint": "februari"},
                {"type": "stat", "label": "Gemiddeld", "value": "248"},
                {"type": "line_chart", "title": "Tickets per maand", "labels": ["jan", "feb", "mrt", "apr", "mei"], "series": [{"name": "Tickets", "values": [280, 301, 259, 231, 212]}], "wide": True},
                {"type": "bar_chart", "title": "Dit jaar tegen vorig jaar", "labels": ["jan", "feb", "mrt", "apr", "mei"], "series": [{"name": "2026", "values": [280, 301, 259, 231, 212]}, {"name": "2025", "values": [250, 270, 275, 260, 255]}]},
            ],
        ),
        CanvasSkill(
            id="breakdown",
            when="How a total splits into parts: distribution, frequency, share, mix.",
            steps=(
                "heading with the biggest part or the surprise",
                "stats: total, largest part with its share, number of parts",
                "pie_chart for up to 6 parts, otherwise bar_chart sorted from large to small",
                "table with every part, its value and share",
            ),
            example=[
                {"type": "heading", "text": "Drie kanalen leveren 80% van de leads"},
                {"type": "stat", "label": "Leads totaal", "value": "540"},
                {"type": "stat", "label": "Grootste kanaal", "value": "Website", "hint": "38%"},
                {"type": "stat", "label": "Kanalen", "value": "7"},
                {"type": "bar_chart", "title": "Leads per kanaal", "labels": ["Website", "LinkedIn", "Partners", "Events", "Mail", "Ads", "Overig"], "series": [{"name": "Leads", "values": [205, 132, 95, 44, 31, 22, 11]}], "wide": True},
                {"type": "table", "columns": ["Kanaal", "Leads", "Aandeel"], "rows": [["Website", "205", "38%"], ["LinkedIn", "132", "24%"], ["Partners", "95", "18%"]]},
            ],
        ),
        CanvasSkill(
            id="comparison",
            when="Groups, periods, people, or options side by side.",
            steps=(
                "heading with the winner or the gap",
                "one stat per group (2-4) on the same metric, with delta against the others or a target",
                "bar_chart with one series per period or metric, labels are the groups",
                "table with all metrics per group",
            ),
            example=[
                {"type": "heading", "text": "Team Noord lost tickets het snelst op"},
                {"type": "stat", "label": "Noord", "value": "3,1 u", "delta": "-22%", "status": "good"},
                {"type": "stat", "label": "Zuid", "value": "4,0 u", "delta": "0%"},
                {"type": "stat", "label": "West", "value": "5,2 u", "delta": "+30%", "status": "bad"},
                {"type": "bar_chart", "title": "Oplostijd in uren", "labels": ["Noord", "Zuid", "West"], "series": [{"name": "Q2", "values": [4.0, 4.1, 4.4]}, {"name": "Q3", "values": [3.1, 4.0, 5.2]}], "wide": True},
                {"type": "table", "columns": ["Team", "Tickets", "Oplostijd", "Tevredenheid"], "rows": [["Noord", "412", "3,1 u", "4,6"], ["Zuid", "388", "4,0 u", "4,4"], ["West", "351", "5,2 u", "4,1"]]},
            ],
        ),
        CanvasSkill(
            id="report",
            when="An analysis, review, or plan with few numbers: findings and next steps.",
            steps=(
                "heading with the conclusion",
                "text with two or three sentences of context",
                "up to three stats if there are key numbers",
                "callouts for findings: success for what works, warning for risks",
                "list with next steps, each one an action with an owner",
            ),
            example=[
                {"type": "heading", "text": "Onboarding werkt, activatie in week 2 blijft achter"},
                {"type": "text", "text": "We volgden 40 nieuwe klanten van september. De meeste ronden de setup af, maar gebruiken daarna maar een functie."},
                {"type": "stat", "label": "Setup afgerond", "value": "88%", "target": "80%", "status": "good"},
                {"type": "stat", "label": "Actief in week 2", "value": "41%", "target": "60%", "status": "watch"},
                {"type": "callout", "tone": "success", "text": "De welkomstcall verdubbelt de kans op afronding."},
                {"type": "callout", "tone": "warning", "text": "Na week 1 krijgen klanten geen enkel bericht meer."},
                {"type": "list", "items": ["Mail in week 2 met een tweede functie (Sanne)", "Check-in call na 10 dagen testen (Mark)"]},
            ],
        ),
    )
}


def skill_menu() -> str:
    """Level 1: one line per skill for the system prompt."""
    return "\n".join(f"- {skill.id}: {skill.when}" for skill in SKILLS.values())


def skill_ids() -> list[str]:
    return list(SKILLS)


def skill_brief(skill_id: str | None) -> dict[str, Any]:
    """Level 2: the guide and example the agent reads right before edit_canvas."""
    skill = SKILLS.get(str(skill_id or "").strip().lower()) or SKILLS[DEFAULT_SKILL]
    return {
        "id": skill.id,
        "rules": list(_RULES),
        "steps": list(skill.steps),
        "example": skill.example,
        "other_skills": [other for other in SKILLS if other != skill.id],
    }
