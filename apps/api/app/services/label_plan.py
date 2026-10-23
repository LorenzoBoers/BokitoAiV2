"""Label plan: one card that places labels where they belong.

An agent proposes lines; each line is one label (existing or new) with a
scope: ``conversation`` (link it on the listed conversations), ``company`` or
``contact`` (every conversation from them inherits it), or ``rule`` (an inbox
rule with action tag labels the next mail and backfills the listed
conversations). The server validates every line before a card exists and
applies an approved line in one call.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import Company, Contact
from app.models.signal import Signal, SignalTag
from app.services.label_policy import check_new_label
from app.services.signal_tags import normalize_tag

SCOPES = ("conversation", "company", "contact", "rule")
RULE_MATCH_TYPES = ("sender", "domain", "list_id")
MAX_ENTRIES = 12
MAX_SIGNALS = 200

_META = {
    "en": {
        "new": "new",
        "existing": "existing",
        "conversations": "{n} conversations",
        "conversation": "1 conversation",
        "company": "on company {name}",
        "contact": "on contact {name}",
        "rule": "rule on {value}",
    },
    "nl": {
        "new": "nieuw",
        "existing": "bestaand",
        "conversations": "{n} gesprekken",
        "conversation": "1 gesprek",
        "company": "op bedrijf {name}",
        "contact": "op contact {name}",
        "rule": "regel op {value}",
    },
}


def _uuid(raw: Any) -> UUID | None:
    try:
        return UUID(str(raw))
    except (TypeError, ValueError):
        return None


async def _company(session: AsyncSession, tenant_id: UUID, ref: str) -> Company | None:
    query = select(Company).where(Company.tenant_id == tenant_id, Company.deleted_at.is_(None))
    as_id = _uuid(ref)
    if as_id:
        query = query.where(Company.id == as_id)
    else:
        value = ref.strip().lower().lstrip("@")
        query = query.where(
            (func.lower(Company.domain) == value) | (func.lower(Company.name) == value)
        )
    return (await session.execute(query.limit(1))).scalars().first()


async def _contact(session: AsyncSession, tenant_id: UUID, ref: str) -> Contact | None:
    query = select(Contact).where(Contact.tenant_id == tenant_id)
    as_id = _uuid(ref)
    if as_id:
        query = query.where(Contact.id == as_id)
    else:
        query = query.where(func.lower(Contact.address) == ref.strip().lower())
    return (await session.execute(query.limit(1))).scalars().first()


async def _tenant_signal_ids(
    session: AsyncSession, tenant_id: UUID, raw_ids: list[Any]
) -> tuple[list[str], list[str]]:
    wanted = [(raw, _uuid(raw)) for raw in raw_ids[:MAX_SIGNALS]]
    ids = [u for _, u in wanted if u]
    found = set()
    if ids:
        found = set(
            (
                await session.execute(
                    select(Signal.id).where(Signal.tenant_id == tenant_id, Signal.id.in_(ids))
                )
            ).scalars()
        )
    good = [str(u) for _, u in wanted if u in found]
    bad = [str(raw) for raw, u in wanted if u not in found]
    return good, bad


async def validate_entries(
    session: AsyncSession, tenant_id: UUID, raw_entries: Any, *, lang: str = "en"
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """``(entries, errors)``: normalized lines ready for the card, or what to fix."""
    from app.services.inbox_rules import _rule_by_key, normalize_match_value

    if not isinstance(raw_entries, list) or not raw_entries:
        return [], [{"error": "missing_entries", "message": "Pass entries: one line per label."}]
    if len(raw_entries) > MAX_ENTRIES:
        return [], [
            {
                "error": "too_many_entries",
                "message": f"At most {MAX_ENTRIES} lines. Fewer, broader labels group better.",
            }
        ]
    copy = _META["nl" if lang == "nl" else "en"]
    registry = {
        row.name: row
        for row in (
            await session.execute(select(SignalTag).where(SignalTag.tenant_id == tenant_id))
        ).scalars()
    }
    entries: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_entries):
        if not isinstance(raw, dict):
            errors.append({"line": index, "error": "invalid_entry", "message": "Each line is an object."})
            continue
        name = normalize_tag(str(raw.get("label") or raw.get("name") or ""))
        description = str(raw.get("description") or "").strip()
        scope = str(raw.get("scope") or "conversation").strip().lower()
        line: dict[str, Any] = {"line": index, "label": name}
        if scope not in SCOPES:
            errors.append({**line, "error": "invalid_scope", "message": f"scope is one of {', '.join(SCOPES)}."})
            continue
        row = registry.get(name)
        if row is not None and row.workstream_id is not None:
            errors.append(
                {**line, "error": "flow_label", "message": f"{name} has a flow; file it with file_ticket."}
            )
            continue
        is_new = row is None
        if is_new:
            refusal = await check_new_label(session, tenant_id, name, description)
            if refusal:
                errors.append({**line, **refusal})
                continue
        signal_ids, bad = await _tenant_signal_ids(
            session, tenant_id, raw.get("signal_ids") if isinstance(raw.get("signal_ids"), list) else []
        )
        if bad:
            errors.append(
                {**line, "error": "unknown_conversations", "message": "Some signal_ids are not in this workspace.", "ids": bad}
            )
            continue
        entry: dict[str, Any] = {
            "name": name,
            "new": is_new,
            "description": description if is_new else "",
            "scope": scope,
            "signal_ids": signal_ids,
        }
        where = ""
        if scope == "conversation":
            if not signal_ids:
                errors.append({**line, "error": "missing_conversations", "message": "List the signal_ids this label covers."})
                continue
            if is_new and len(signal_ids) < 2:
                errors.append(
                    {
                        **line,
                        "error": "single_use",
                        "message": "A new label for one conversation is an item label. Reuse an existing label or leave it out.",
                    }
                )
                continue
        elif scope == "company":
            company = await _company(session, tenant_id, str(raw.get("company") or raw.get("company_id") or ""))
            if company is None:
                errors.append(
                    {
                        **line,
                        "error": "unknown_company",
                        "message": "No such company. Use scope rule with match_type domain instead.",
                    }
                )
                continue
            entry["company_id"] = str(company.id)
            where = copy["company"].format(name=company.name or company.domain)
        elif scope == "contact":
            contact = await _contact(session, tenant_id, str(raw.get("contact") or raw.get("contact_id") or ""))
            if contact is None:
                errors.append({**line, "error": "unknown_contact", "message": "No such contact."})
                continue
            entry["contact_id"] = str(contact.id)
            where = copy["contact"].format(name=contact.display_name or contact.address)
        else:
            match_type = str(raw.get("match_type") or "").strip().lower()
            value = normalize_match_value(match_type, str(raw.get("match_value") or "")) if match_type in RULE_MATCH_TYPES else ""
            if not value:
                errors.append(
                    {
                        **line,
                        "error": "invalid_rule",
                        "message": "A rule needs match_type sender, domain or list_id and a match_value that can match mail.",
                    }
                )
                continue
            existing_rule = await _rule_by_key(session, tenant_id, match_type, value)
            if existing_rule is not None and existing_rule.action != "tag":
                errors.append(
                    {
                        **line,
                        "error": "rule_taken",
                        "message": f"{value} already has an inbox rule ({existing_rule.action}). Use scope conversation.",
                    }
                )
                continue
            entry["match_type"] = match_type
            entry["match_value"] = value
            where = copy["rule"].format(value=value)
        count = len(signal_ids)
        parts = [copy["new"] if is_new else copy["existing"]]
        if count:
            parts.append(copy["conversation"] if count == 1 else copy["conversations"].format(n=count))
        if where:
            parts.append(where)
        entry["where"] = " · ".join(parts)
        entries.append(entry)
    return entries, errors


async def apply_entry(
    session: AsyncSession, tenant_id: UUID, entry: dict[str, Any], *, user_id: UUID | None = None
) -> dict[str, Any]:
    """Run one approved line. Safe to run twice."""
    from app.services.inbox_rules import _rule_by_key, create_rule, rule_tags
    from app.services.signal_tags import (
        add_signal_tags,
        create_tag,
        list_company_tags,
        list_contact_tags,
        set_company_tags,
        set_contact_tags,
    )

    name = normalize_tag(str(entry.get("name") or ""))
    if not name:
        return {"error": "missing_name", "message": "The plan line has no label."}
    row = (
        await session.execute(
            select(SignalTag).where(SignalTag.tenant_id == tenant_id, SignalTag.name == name)
        )
    ).scalars().first()
    created = False
    if row is None:
        refusal = await check_new_label(session, tenant_id, name, str(entry.get("description") or ""))
        if refusal:
            return refusal
        row = await create_tag(
            session, tenant_id, name, description=str(entry.get("description") or ""), user_id=user_id, commit=False
        )
        created = True
    elif row.workstream_id is not None:
        return {"error": "flow_label", "message": f"{name} has a flow; file it with file_ticket."}

    scope = str(entry.get("scope") or "conversation")
    result: dict[str, Any] = {"ok": True, "label": name, "created": created, "scope": scope}
    if scope == "company":
        company_id = _uuid(entry.get("company_id"))
        company = await session.get(Company, company_id) if company_id else None
        if company is None or company.tenant_id != tenant_id:
            return {"error": "unknown_company", "message": "Company not found."}
        names = [t["name"] for t in await list_company_tags(session, tenant_id, company.id)]
        if name not in names:
            await set_company_tags(session, tenant_id, company.id, [*names, name], user_id=user_id)
        result["company"] = company.name or company.domain
    elif scope == "contact":
        contact_id = _uuid(entry.get("contact_id"))
        contact = await session.get(Contact, contact_id) if contact_id else None
        if contact is None or contact.tenant_id != tenant_id:
            return {"error": "unknown_contact", "message": "Contact not found."}
        names = [t["name"] for t in await list_contact_tags(session, tenant_id, contact.id)]
        if name not in names:
            await set_contact_tags(session, tenant_id, contact.id, [*names, name], user_id=user_id)
        result["contact"] = contact.display_name or contact.address

    tagged = 0
    signal_ids, _ = await _tenant_signal_ids(
        session, tenant_id, entry.get("signal_ids") if isinstance(entry.get("signal_ids"), list) else []
    )
    if scope in ("conversation", "rule"):
        for raw in signal_ids:
            _, added = await add_signal_tags(
                session,
                tenant_id,
                UUID(raw),
                [name],
                registered_only=True,
                actor_type="user" if user_id else "system",
                actor_id=str(user_id or ""),
            )
            tagged += len(added)
    result["tagged"] = tagged

    if scope == "rule":
        match_type = str(entry.get("match_type") or "")
        match_value = str(entry.get("match_value") or "")
        existing = await _rule_by_key(session, tenant_id, match_type, match_value)
        if existing is not None and existing.action != "tag":
            await session.commit()
            return {**result, "error": "rule_taken", "message": f"{match_value} already has a {existing.action} rule."}
        tags = rule_tags(existing) if existing is not None else []
        rule = await create_rule(
            session,
            tenant_id,
            match_type=match_type,
            match_value=match_value,
            action="tag",
            tags=[*tags, name] if name not in tags else tags,
            user_id=user_id,
        )
        result["rule"] = {"match_type": rule["match_type"], "match_value": rule["match_value"], "labels": rule["labels"]}
    await session.commit()
    return result
