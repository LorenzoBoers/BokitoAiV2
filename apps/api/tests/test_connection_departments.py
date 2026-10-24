"""Connections follow the conversation: folder links (with parents) and the department rule."""

import json

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import IntegrationConnection
from app.models.project import Project
from app.services.connection_scope import (
    default_connection,
    set_connection_department,
    set_connection_projects,
    usable_connection_ids,
)
from tests.org_tree import build_org, conversation


async def _king(session: AsyncSession, tenant_id, name: str) -> IntegrationConnection:
    conn = IntegrationConnection(
        tenant_id=tenant_id,
        provider="moneybird",
        display_name=name,
        status="active",
        credentials_json='{"access_token":"tok"}',
        metadata_json=json.dumps({"last_verified_at": "2026-01-01T00:00:00+00:00"}),
    )
    session.add(conn)
    await session.flush()
    return conn


async def _folder(session: AsyncSession, tenant_id, name: str, parent: Project | None = None) -> Project:
    folder = Project(
        tenant_id=tenant_id,
        name=name,
        slug=name.lower().replace(" ", "-"),
        parent_id=parent.id if parent else None,
    )
    session.add(folder)
    await session.flush()
    return folder


@pytest.mark.asyncio
async def test_folder_link_picks_the_connection(client, session_override: AsyncSession):
    org = await build_org(session_override)
    tid = org.tenant_id
    client_a = await _folder(session_override, tid, "Klant A")
    client_b = await _folder(session_override, tid, "Klant B")
    invoices_a = await _folder(session_override, tid, "Facturen A", client_a)
    king_1 = await _king(session_override, tid, "King 1")
    king_2 = await _king(session_override, tid, "King 2")
    await set_connection_projects(session_override, tid, king_1, [str(client_a.id)])
    await set_connection_projects(session_override, tid, king_2, [str(client_b.id)])
    signal = await conversation(session_override, org, org.support)
    signal.project_id = invoices_a.id
    await session_override.commit()

    usable, denied = await usable_connection_ids(
        session_override, tid, [king_1.id, king_2.id], agent_id=org.sam.id, project_id=None, signal=signal
    )
    assert usable == {str(king_1.id)}
    assert "Klant B" in denied[str(king_2.id)]
    assert await default_connection(session_override, tid, signal, [king_1.id, king_2.id]) == str(king_1.id)


@pytest.mark.asyncio
async def test_department_rule_with_org_rules_on(client, session_override: AsyncSession):
    org = await build_org(session_override)
    tid = org.tenant_id
    books = await _king(session_override, tid, "Books")
    await set_connection_department(session_override, tid, books, org.accounting.id)
    await session_override.commit()

    support_case = await conversation(session_override, org, org.support)
    usable, denied = await usable_connection_ids(
        session_override, tid, [books.id], agent_id=org.sam.id, project_id=None, signal=support_case
    )
    assert usable == set()
    assert "belongs to Accounting" in denied[str(books.id)]

    accounting_case = await conversation(session_override, org, org.accounting)
    usable, _ = await usable_connection_ids(
        session_override, tid, [books.id], agent_id=org.boekito.id, project_id=None, signal=accounting_case
    )
    assert usable == {str(books.id)}

    await set_connection_department(session_override, tid, books, org.root.id)
    await session_override.commit()
    assert books.department_id is None


@pytest.mark.asyncio
async def test_department_rule_off_without_org_rules(client, session_override: AsyncSession):
    org = await build_org(session_override, rules="off")
    books = await _king(session_override, org.tenant_id, "Books")
    await set_connection_department(session_override, org.tenant_id, books, org.accounting.id)
    await session_override.commit()

    support_case = await conversation(session_override, org, org.support)
    usable, _ = await usable_connection_ids(
        session_override, org.tenant_id, [books.id], agent_id=org.sam.id, project_id=None, signal=support_case
    )
    assert usable == {str(books.id)}
