import asyncio

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.agent import Agent
from app.services.agent_avatar import avatar_payload
from app.services.workforce_runtime import serialize_agent


async def main() -> None:
    async with async_session_factory() as s:
        row = (
            await s.execute(
                select(Agent).where(Agent.id == "5a232347-decf-48f8-b5a6-2d7b7edc596e")
            )
        ).scalar_one()
        print("payload", avatar_payload(row))
        print("runtime", {k: serialize_agent(row, view="runtime").get(k) for k in (
            "name", "avatar_kind", "avatar_icon", "avatar_image_url"
        )})


if __name__ == "__main__":
    asyncio.run(main())
