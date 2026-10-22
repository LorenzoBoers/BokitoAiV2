"""Agents speak the operator vocabulary and only link to pages that exist."""

import inspect
import re
from pathlib import Path
from uuid import uuid4

import pytest

from app.models.auth import Tenant
from app.services import assistant_context, personal_assistant, vocabulary
from app.tools.registry import _ensure_builtin_loaded, iter_tool_specs

REPO = Path(__file__).resolve().parents[3]
APP_TSX = REPO / "apps" / "dashboard" / "src" / "App.tsx"
LINK = re.compile(r"(?<![\w{])(/(?:settings|docs|workforce|communication|folders|flows|agents)[\w/?=&.-]*)")
# Tool descriptions also must not say "project": the folder is the word.
TOOL_EXTRA = ["project", "projects"]
# The accounting general ledger is the bookkeeping term, not the Log.
TOOL_ALLOWED = {"ledger"}


def _forbidden(extra: list[str] | None = None, allowed: set[str] | None = None) -> re.Pattern:
    words = [w for w in vocabulary.forbidden_synonyms() if w.lower() not in (allowed or set())]
    pattern = vocabulary.forbidden_pattern(words + (extra or []))
    assert pattern is not None, "glossary.json is missing; run sync_product_help.py"
    return pattern


def _without_vocabulary(text: str) -> str:
    block = vocabulary.vocabulary_block()
    assert block and block in text
    return text.replace(block, "")


def _texts(schema) -> list[str]:
    out: list[str] = []
    if isinstance(schema, dict):
        for key, value in schema.items():
            if key == "description" and isinstance(value, str):
                out.append(value)
            out.extend(_texts(value))
    elif isinstance(schema, list):
        for value in schema:
            out.extend(_texts(value))
    return out


def _dashboard_routes() -> set[str]:
    return set(re.findall(r'path="(/[^"]*)"', APP_TSX.read_text(encoding="utf-8")))


def _route_exists(path: str, routes: set[str]) -> bool:
    path = path.split("?", 1)[0].rstrip("/.") or "/"
    for route in routes:
        pattern = "^" + re.sub(r":[^/]+", "[^/]+", route.rstrip("/*")) + "$"
        if re.match(pattern, path):
            return True
    return False


def _doc_exists(path: str) -> bool:
    from app.services.product_help import get_article

    parts = path.split("?", 1)[0].strip("/").split("/")
    if len(parts) != 3:
        return False
    article = get_article(parts[2], "en")
    return article is not None and article.section == parts[1]


def test_folder_and_department_stay_distinct():
    shape = assistant_context.PLATFORM_SHAPE.lower()
    assert "a folder is not a department" in shape
    assert "never call a department a folder" in shape
    _ensure_builtin_loaded()
    by_name = {spec.name: spec.description or "" for spec in iter_tool_specs()}
    assert "never list_departments" in by_name["list_folders"].lower()
    assert "not folders" in by_name["list_departments"].lower()
    assert "list_folders" in by_name["list_departments"]


def test_vocabulary_block_lists_every_glossary_term():
    block = vocabulary.vocabulary_block()
    for term in vocabulary.glossary()["terms"]:
        assert term["en"] in block and term["nl"] in block
        for word in term["forbidden"]:
            assert word in block
    for word in ("Map", "Werkt in", "Opgeleverd", "Autonomie", "Werk"):
        assert word in block


@pytest.mark.asyncio
async def test_every_agent_prompt_carries_the_vocabulary(session_override):
    tenant = Tenant(slug=f"voc-{uuid4().hex[:6]}", name="Voc")
    session_override.add(tenant)
    await session_override.commit()
    block = await assistant_context.category_map_block(session_override, tenant.id)
    assert vocabulary.vocabulary_block() in block
    assert assistant_context.PLATFORM_SHAPE in block


@pytest.mark.asyncio
async def test_prompts_use_no_forbidden_synonyms(session_override):
    tenant = Tenant(slug=f"voc-{uuid4().hex[:6]}", name="Voc")
    session_override.add(tenant)
    await session_override.commit()
    pattern = _forbidden(TOOL_EXTRA)
    texts = {
        "category_map_block": _without_vocabulary(
            await assistant_context.category_map_block(session_override, tenant.id)
        ),
        "settings_guide_block": assistant_context.settings_guide_block(),
        "personal SYSTEM_PROMPT": personal_assistant.SYSTEM_PROMPT,
    }
    hits = {name: pattern.findall(text) for name, text in texts.items() if pattern.search(text)}
    assert hits == {}


def _tool_hits(*, in_builtin: bool) -> dict[str, list[str]]:
    _ensure_builtin_loaded()
    pattern = _forbidden(TOOL_EXTRA, TOOL_ALLOWED)
    hits: dict[str, list[str]] = {}
    for spec in iter_tool_specs():
        source = inspect.getsourcefile(spec.handler) or ""
        if source.endswith("builtin.py") != in_builtin:
            continue
        found = [m for text in [spec.description or "", *_texts(spec.input_schema or {})] for m in pattern.findall(text)]
        if found:
            hits[spec.name] = found
    return hits


def test_tool_descriptions_use_no_forbidden_synonyms():
    assert _tool_hits(in_builtin=False) == {}


def test_builtin_tool_descriptions_use_no_forbidden_synonyms():
    # builtin.py is now a thin loader; descriptions live in domain modules.
    assert _tool_hits(in_builtin=True) == {}


@pytest.mark.asyncio
async def test_prompt_links_point_at_real_pages(session_override):
    tenant = Tenant(slug=f"voc-{uuid4().hex[:6]}", name="Voc")
    session_override.add(tenant)
    await session_override.commit()
    routes = _dashboard_routes()
    text = "\n".join(
        [
            await assistant_context.category_map_block(session_override, tenant.id),
            assistant_context.settings_guide_block(),
            personal_assistant.SYSTEM_PROMPT,
        ]
    )
    links = {link for link in LINK.findall(text) if not link.endswith("/")}
    assert "/settings/govern?tab=policy" in links
    broken = sorted(
        link
        for link in links
        if not (_doc_exists(link) if link.startswith("/docs/") else _route_exists(link, routes))
    )
    assert broken == []
