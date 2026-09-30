"""Policy engine: one autonomy dial, category allowances, tool overrides.

Verdict for a tool call, in order of precedence:
1. Operators (trust=operator) are never asked for their own actions; deny still applies.
2. Explicit tool override in the policy.
3. Consequential tools always ask (unless denied).
4. Category allowance in the policy.
5. Effective posture: workspace posture, capped by the agent, signal type and
   playbook. manual -> ask for everything but reads; assisted -> ask for
   communicate/external/destructive; autonomous -> ask only for destructive.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bokito.domain.govern import Policy
from bokito.domain.identity import Posture, Tenant

Verdict = Literal["allow", "ask", "deny"]
Category = Literal["read", "write", "communicate", "external", "destructive"]

POSTURE_RANK = {Posture.manual: 0, Posture.assisted: 1, Posture.autonomous: 2}

DEFAULT_CONSEQUENTIAL = [
    "delete_contact",
    "set_posture",
    "revoke_token",
    "moneybird_send_invoice",
]

POSTURE_DEFAULTS: dict[Posture, dict[str, Verdict]] = {
    Posture.manual: {
        "read": "allow",
        "write": "ask",
        "communicate": "ask",
        "external": "ask",
        "destructive": "ask",
    },
    Posture.assisted: {
        "read": "allow",
        "write": "allow",
        "communicate": "ask",
        "external": "ask",
        "destructive": "ask",
    },
    Posture.autonomous: {
        "read": "allow",
        "write": "allow",
        "communicate": "allow",
        "external": "allow",
        "destructive": "ask",
    },
}


@dataclass(frozen=True)
class Evaluation:
    verdict: Verdict
    reason: str
    posture: Posture


def min_posture(*values: Posture | None) -> Posture:
    present = [v for v in values if v is not None]
    if not present:
        return Posture.assisted
    return min(present, key=lambda p: POSTURE_RANK[p])


async def get_policy(session: AsyncSession, tenant_id: uuid.UUID) -> Policy:
    policy = await session.scalar(select(Policy).where(Policy.tenant_id == tenant_id))
    if policy:
        return policy
    tenant = await session.get(Tenant, tenant_id)
    policy = Policy(
        tenant_id=tenant_id,
        posture=tenant.posture if tenant else Posture.assisted,
        allowances={},
        tool_overrides={},
        consequential=list(DEFAULT_CONSEQUENTIAL),
        budgets={},
    )
    session.add(policy)
    await session.flush()
    return policy


def evaluate(
    policy: Policy,
    *,
    tool_name: str,
    category: str,
    consequential: bool,
    trust: str,
    caps: list[Posture | None] | None = None,
) -> Evaluation:
    posture = min_posture(policy.posture, *(caps or []))
    override = (policy.tool_overrides or {}).get(tool_name)

    if override == "deny":
        return Evaluation("deny", f"tool {tool_name} denied by policy", posture)
    if category not in POSTURE_DEFAULTS[posture]:
        category = "write"
    allowance = (policy.allowances or {}).get(category)
    if allowance == "deny":
        return Evaluation("deny", f"category {category} denied by policy", posture)

    if trust == "operator":
        return Evaluation("allow", "operator acts directly", posture)

    if override in ("allow", "ask"):
        return Evaluation(override, f"tool override {override}", posture)
    if consequential or tool_name in (policy.consequential or []):
        return Evaluation("ask", "consequential tool always asks", posture)
    if allowance in ("allow", "ask"):
        return Evaluation(allowance, f"category allowance {allowance}", posture)
    verdict = POSTURE_DEFAULTS[posture][category]
    return Evaluation(verdict, f"posture {posture.value} default for {category}", posture)
