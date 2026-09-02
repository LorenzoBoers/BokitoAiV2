"""V2 coding agent sandbox runner skeleton."""

from uuid import UUID


async def enqueue_coding_task(tenant_id: UUID, subject: str, repo_path: str = "/work") -> None:
    from app.workers.tasks import _get_arq_pool

    redis = await _get_arq_pool()
    await redis.enqueue_job("coding_agent_run", str(tenant_id), subject, repo_path)
