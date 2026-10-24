"""The org block an agent reads: chart with its place, responsibility, knowledge along the chain."""

from httpx import AsyncClient
from org_tree import build_org, conversation

from app.models.workspace import WorkspaceDoc
from app.services.agent_awareness import crew_context
from app.services.org_context import org_context


async def test_org_block_shows_place_holder_and_knowledge_chain(client: AsyncClient, session_override):
    org = await build_org(session_override)
    session_override.add_all(
        [
            WorkspaceDoc(tenant_id=org.tenant_id, path="org/values.md", title="Values", department_id=org.root.id),
            WorkspaceDoc(tenant_id=org.tenant_id, path="support/refunds.md", title="Refunds", department_id=org.support.id),
            WorkspaceDoc(tenant_id=org.tenant_id, path="books/vat.md", title="VAT", department_id=org.accounting.id),
        ]
    )
    signal = await conversation(session_override, org, org.billing, holder=org.bill)

    text = await org_context(session_override, org.tenant_id, org.kim, signal)
    assert "## Organization" in text
    support_line = next(line for line in text.splitlines() if "Support" in line and "point of contact" in line)
    assert "<- you" in support_line and "Sam" in support_line
    assert "It is with Billing, holder Bill. You may read it." in text
    assert "Values" in text and "Refunds" in text and "VAT" not in text


async def test_org_block_is_empty_while_org_rules_are_off(client: AsyncClient, session_override):
    org = await build_org(session_override, rules="off")
    signal = await conversation(session_override, org, org.support)
    assert await org_context(session_override, org.tenant_id, org.sam, signal) == ""


async def test_contact_crew_block_lists_sub_departments_and_delegates_down(client: AsyncClient, session_override):
    org = await build_org(session_override)
    text = await crew_context(session_override, org.sam, [org.support])
    assert "Delegate down first" in text
    assert "sub-department" in text and "Billing" in text and "Bill" in text
