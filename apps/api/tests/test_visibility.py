"""Open and shielded departments, for agents and people."""

from httpx import AsyncClient
from org_tree import build_org, conversation
from sqlalchemy import select

from app.models.auth import Membership, User
from app.models.signal import Signal
from app.services.department_access import department_predicate, scoped_access
from app.services.department_visibility import department_visible, hidden_department_ids
from app.services.tenant_introspection import list_threads_summary
from app.services.department_visibility import agent_hidden_clause
from scripts.seed import TEST_EMAIL


async def test_shielded_work_is_read_only_in_its_branch_and_above(client: AsyncClient, session_override):
    org = await build_org(session_override, shield_accounting=True)
    hidden_for_sam = await hidden_department_ids(session_override, org.tenant_id, kind="agent", member_id=org.sam.id)
    assert hidden_for_sam == {org.accounting.id}
    assert await department_visible(
        session_override, org.tenant_id, org.accounting.id, kind="agent", member_id=org.boekito.id
    )
    assert await department_visible(
        session_override, org.tenant_id, org.accounting.id, kind="agent", member_id=org.lead.id
    )
    assert await department_visible(session_override, org.tenant_id, org.support.id, kind="agent", member_id=org.boekito.id)


async def test_nothing_is_hidden_while_org_rules_are_off(client: AsyncClient, session_override):
    org = await build_org(session_override, rules="off", shield_accounting=True)
    assert await hidden_department_ids(session_override, org.tenant_id, kind="agent", member_id=org.sam.id) == set()


async def test_list_threads_leaves_out_shielded_work_and_marks_responsibility(client: AsyncClient, session_override):
    org = await build_org(session_override, shield_accounting=True)
    books = await conversation(session_override, org, org.accounting, holder=org.boekito)
    support = await conversation(session_override, org, org.support, holder=org.sam)
    exclude = await agent_hidden_clause(session_override, org.tenant_id, org.kim)
    payload = await list_threads_summary(session_override, org.tenant_id, exclude=exclude, limit=200)
    ids = {row["id"] for row in payload["threads"]}
    assert str(support.id) in ids and str(books.id) not in ids


async def test_people_lists_hide_shielded_work_from_members_not_admins(client: AsyncClient, session_override):
    org = await build_org(session_override, shield_accounting=True)
    books = await conversation(session_override, org, org.accounting)
    open_one = await conversation(session_override, org, org.support)
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    membership = (
        await session_override.execute(select(Membership).where(Membership.user_id == user.id))
    ).scalar_one()
    membership.role = "member"
    await session_override.commit()

    access = await scoped_access(session_override, org.tenant_id, user.id, set())
    clause = department_predicate(access)
    assert clause is not None
    rows = (
        await session_override.execute(select(Signal.id).where(Signal.tenant_id == org.tenant_id, clause))
    ).scalars().all()
    assert open_one.id in rows and books.id not in rows
