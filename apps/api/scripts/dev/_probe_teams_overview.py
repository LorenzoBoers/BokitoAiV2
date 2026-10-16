"""Probe /teams/overview failure on VPS."""
from __future__ import annotations

import asyncio
import traceback

from sqlalchemy import func, select, text
from uuid import UUID

from app.db.session import async_session_factory
from app.models.agent import Agent, AgentRun
from app.models.auth import Membership, User
from app.models.signal import Signal
from app.services import teams as teams_svc
from app.services.team_metrics import empty_metrics, overview_metrics
from app.services.workforce_runtime import serialize_agent


async def main() -> None:
    async with async_session_factory() as s:
        cols = (
            await s.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name='signals' ORDER BY 1"
                )
            )
        ).scalars().all()
        print("SIGNAL_COLS", list(cols))

        tid = (await s.execute(text("SELECT id FROM tenants LIMIT 1"))).scalar()
        print("TENANT", tid)

        try:
            metrics = await overview_metrics(s, tid)
            print("METRICS_OK", {k: len(v) for k, v in metrics.items()})
        except Exception:
            print("METRICS_FAIL")
            traceback.print_exc()
            await s.rollback()
            return

        try:
            team_rows = await teams_svc.list_teams(s, tid)
            print("TEAMS", len(team_rows))
            for row in team_rows:
                ser = await teams_svc.serialize_team(s, row)
                print("TEAM_OK", ser.get("name"), "keys", sorted(ser.keys()))
        except Exception:
            print("TEAMS_FAIL")
            traceback.print_exc()
            await s.rollback()
            return

        try:
            open_owned_user = dict(
                (
                    await s.execute(
                        select(Signal.assignee_id, func.count())
                        .where(
                            Signal.tenant_id == tid,
                            Signal.status == "open",
                            Signal.assignee_kind == "user",
                            Signal.assignee_id.is_not(None),
                        )
                        .group_by(Signal.assignee_id)
                    )
                ).all()
            )
            print("OPEN_OWNED_USER", len(open_owned_user))
            open_turn_user = dict(
                (
                    await s.execute(
                        select(Signal.turn_ref_id, func.count())
                        .where(
                            Signal.tenant_id == tid,
                            Signal.status == "open",
                            Signal.turn_kind == "user",
                            Signal.turn_ref_id.is_not(None),
                        )
                        .group_by(Signal.turn_ref_id)
                    )
                ).all()
            )
            print("OPEN_TURN_USER", len(open_turn_user))
            open_owned_agent = dict(
                (
                    await s.execute(
                        select(Signal.agent_id, func.count())
                        .where(
                            Signal.tenant_id == tid,
                            Signal.status == "open",
                            Signal.assignee_kind == "agent",
                            Signal.agent_id.is_not(None),
                        )
                        .group_by(Signal.agent_id)
                    )
                ).all()
            )
            print("OPEN_OWNED_AGENT", len(open_owned_agent))
        except Exception:
            print("COUNTS_FAIL")
            traceback.print_exc()
            await s.rollback()
            return

        try:
            people_rows = (
                await s.execute(
                    select(User, Membership)
                    .join(Membership, Membership.user_id == User.id)
                    .where(Membership.tenant_id == tid, User.is_active.is_(True))
                )
            ).all()
            print("PEOPLE", len(people_rows))
        except Exception:
            print("PEOPLE_FAIL")
            traceback.print_exc()
            await s.rollback()
            return

        try:
            agent_rows = list(
                (
                    await s.execute(
                        select(Agent).where(
                            Agent.tenant_id == tid,
                            Agent.acts_for_user.is_(False),
                            Agent.kind.in_(("company", "archived")),
                        )
                    )
                )
                .scalars()
                .all()
            )
            print("AGENTS", len(agent_rows))
            for agent in agent_rows[:5]:
                row = serialize_agent(agent, view="passport", running=False)
                print("AGENT_OK", row.get("name"), "keys", sorted(row.keys())[:20])
                # Validate against OverviewAgent shape later
        except Exception:
            print("AGENTS_FAIL")
            traceback.print_exc()
            await s.rollback()
            return

        # Full router path via importing the handler pieces
        try:
            from app.routers.teams import OverviewOut, OverviewAgent, OverviewPerson, OverviewTeam

            # Build minimal and validate
            teams_out = []
            for row in team_rows:
                ser = await teams_svc.serialize_team(s, row)
                ser["metrics"] = empty_metrics()
                teams_out.append(ser)
            people = []
            for user, member in people_rows:
                people.append(
                    {
                        "uuid": str(user.id),
                        "name": user.display_name or user.email,
                        "email": user.email,
                        "avatar_url": user.avatar_url,
                        "role": member.role,
                        "presence": {"status": "offline", "last_seen_at": None, "away_until": None},
                        "team_ids": [],
                        "open_owned": 0,
                        "open_turn": 0,
                        "deactivated": not bool(member.is_active),
                    }
                )
            agents = []
            for agent in agent_rows:
                row = serialize_agent(agent, view="passport", running=False)
                row.update(
                    {
                        "team_ids": [],
                        "open_owned": 0,
                        "deactivated": agent.kind == "archived" or not bool(agent.is_active),
                        "metrics": empty_metrics(),
                    }
                )
                agents.append(row)
            payload = {"people": people, "agents": agents, "teams": teams_out}
            try:
                OverviewOut.model_validate(payload)
                print("VALIDATE_OK")
            except Exception:
                print("VALIDATE_FAIL")
                traceback.print_exc()
                # Try agents one by one
                for a in agents:
                    try:
                        OverviewAgent.model_validate(a)
                    except Exception as e:
                        print("BAD_AGENT", a.get("id"), a.get("name"), e)
                        print("AGENT_FIELDS", {k: type(v).__name__ for k, v in a.items()})
                for t in teams_out:
                    try:
                        OverviewTeam.model_validate(t)
                    except Exception as e:
                        print("BAD_TEAM", t.get("id"), t.get("name"), e)
                for p in people:
                    try:
                        OverviewPerson.model_validate(p)
                    except Exception as e:
                        print("BAD_PERSON", p.get("uuid"), e)
        except Exception:
            print("VALIDATE_WRAP_FAIL")
            traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
