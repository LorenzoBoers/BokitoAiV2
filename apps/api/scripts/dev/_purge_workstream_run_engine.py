"""One-shot: strip retired step-run engine from workstreams.py."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "app" / "services" / "workstreams.py"

TAIL = '''
# ---------------------------------------------------------------------------
# Run engine (retired — stages live on Signal; attribution on AgentRun)


_RETIRED_RUN = HTTPException(
    status_code=410,
    detail="Workstream runs are retired; ticket stages live on the conversation.",
)


async def get_run(session: AsyncSession, tenant_id: UUID, run_id: UUID) -> WorkstreamRun:
    del session, tenant_id, run_id
    raise _RETIRED_RUN


async def start_run(
    session: AsyncSession,
    tenant_id: UUID,
    workstream_id: UUID,
    *,
    input_kind: str = "manual",
    input_text: str = "",
    input_ref: str = "",
    signal_id: UUID | None = None,
    project_id: UUID | None = None,
    triggered_by_type: str = "user",
    triggered_by_id: str = "",
    advance: bool = True,
) -> WorkstreamRun:
    """Stages-only: validate the playbook and return an in-memory receipt."""
    del advance
    if input_kind not in WORKSTREAM_INPUT_KINDS:
        raise HTTPException(status_code=400, detail=f"Invalid input kind: {input_kind}")
    ws = await get_workstream(session, tenant_id, workstream_id)
    if ws.deleted_at is not None:
        raise HTTPException(status_code=400, detail="Workstream is disabled.")
    now = datetime.utcnow()
    return WorkstreamRun(
        tenant_id=tenant_id,
        workstream_id=ws.id,
        project_id=project_id,
        signal_id=signal_id,
        status="completed",
        input_kind=input_kind,
        input_ref=input_ref,
        input_text=input_text,
        summary="Stages-only playbook (no run ledger).",
        triggered_by_type=triggered_by_type,
        triggered_by_id=triggered_by_id,
        completed_at=now,
        updated_at=now,
        started_at=now,
    )


async def advance_run(
    session: AsyncSession, tenant_id: UUID, run_id: UUID
) -> dict[str, Any]:
    del session, tenant_id, run_id
    return {"skipped": True, "retired": True}


async def resume_run(
    session: AsyncSession,
    tenant_id: UUID,
    run_id: UUID,
    **_: Any,
) -> WorkstreamRun:
    del session, tenant_id, run_id
    raise _RETIRED_RUN


async def skip_step_run(session: AsyncSession, tenant_id: UUID, run_id: UUID) -> WorkstreamRun:
    del session, tenant_id, run_id
    raise _RETIRED_RUN


async def cancel_run(session: AsyncSession, tenant_id: UUID, run_id: UUID) -> WorkstreamRun:
    del session, tenant_id, run_id
    raise _RETIRED_RUN


async def process_due_run_deadlines(session: AsyncSession) -> int:
    del session
    return 0


async def run_detail(session: AsyncSession, tenant_id: UUID, run_id: UUID) -> dict[str, Any]:
    del session, tenant_id, run_id
    raise _RETIRED_RUN


async def list_runs(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    workstream_id: UUID | None = None,
    project_id: UUID | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """List AgentRuns attributed to a playbook (replaces workstream_runs ledger)."""
    query = (
        select(AgentRun, Workstream.name)
        .outerjoin(Workstream, Workstream.id == AgentRun.workstream_id)
        .where(AgentRun.tenant_id == tenant_id)
    )
    if workstream_id is not None:
        query = query.where(AgentRun.workstream_id == workstream_id)
    if project_id is not None:
        query = query.where(AgentRun.project_id == project_id)
    rows = (
        await session.execute(
            query.order_by(AgentRun.started_at.desc()).limit(max(1, min(limit, 200)))
        )
    ).all()
    items: list[dict[str, Any]] = []
    for run, name in rows:
        items.append(
            {
                "id": str(run.id),
                "workstream_id": str(run.workstream_id) if run.workstream_id else None,
                "workstream_name": name,
                "project_id": str(run.project_id) if run.project_id else None,
                "signal_id": str(run.signal_id) if run.signal_id else None,
                "status": run.status,
                "subject": run.subject,
                "started_at": _iso(run.started_at),
                "completed_at": _iso(run.completed_at),
            }
        )
    return items


async def promote_run_to_knowledge(
    session: AsyncSession, tenant_id: UUID, run_id: UUID
) -> dict[str, Any]:
    del session, tenant_id, run_id
    raise _RETIRED_RUN
'''


def main() -> None:
    text = TARGET.read_text(encoding="utf-8")
    marker = "# ---------------------------------------------------------------------------\n# Run engine\n"
    idx = text.find(marker)
    if idx < 0:
        raise SystemExit("run engine marker missing")
    head = text[:idx]

    src = head.find("async def _source_signal(")
    ser = head.find("# ---------------------------------------------------------------------------\n# Serialization")
    if src < 0 or ser < 0 or ser <= src:
        raise SystemExit("could not locate helpers to strip")
    head = head[:src] + head[ser:]

    old_rs = (
        "async def replace_steps(\n"
        "    session: AsyncSession,\n"
        "    tenant_id: UUID,\n"
        "    workstream_id: UUID,\n"
        "    steps: list[dict[str, Any]],\n"
        ") -> list[WorkstreamStep]:\n"
        '    raise HTTPException(status_code=410, detail="Workstream steps are retired; use stages.")\n'
    )
    i = head.find(old_rs)
    j = head.find("async def delete_workstream(", i if i >= 0 else 0)
    if i < 0 or j < 0:
        raise SystemExit("replace_steps block missing")
    head = head[:i] + old_rs + "\n\n" + head[j:]

    validate = '''def _validate_step_payload(payload: dict[str, Any]) -> None:
    kind = payload.get("kind", "agent_task")
    if kind not in WORKSTREAM_STEP_KINDS:
        raise HTTPException(status_code=400, detail=f"Invalid step kind: {kind}")
    wait_kind = payload.get("wait_kind", "input")
    if wait_kind not in WORKSTREAM_WAIT_KINDS:
        raise HTTPException(status_code=400, detail=f"Invalid wait kind: {wait_kind}")
    on_deadline = payload.get("on_deadline", "continue")
    if on_deadline not in WORKSTREAM_ON_DEADLINE:
        raise HTTPException(status_code=400, detail=f"Invalid on_deadline: {on_deadline}")
    if kind == "schedule" and int(payload.get("deadline_hours") or 0) < 1:
        raise HTTPException(
            status_code=400, detail="Schedule steps need deadline_hours of at least 1."
        )
    if not str(payload.get("name") or "").strip():
        raise HTTPException(status_code=400, detail="Step name is required.")


'''
    head = head.replace(validate, "")

    head = head.replace(
        '''"""Workstream engine: CRUD and the ordered playbook run loop.

A run walks six canonical step kinds in order. Reply and decision steps may
branch to another step; all other steps continue linearly. Failures pause
with a decision instead of failing silently.
"""''',
        '''"""Flow (workstream) CRUD and stages-only helpers.

Playbooks are stage pipelines on conversations. The old step-run ledger is
retired; attribution for agent work uses ``AgentRun.workstream_id``.
"""''',
    )

    for chunk in (
        "import logging\n",
        "import os\n",
        "import re\n",
        "from sqlalchemy import delete as sa_delete\n",
        "from app.models.auth import Tenant\n",
    ):
        head = head.replace(chunk, "")

    head = head.replace(
        "from app.models.agent import Agent, AgentRun, RunEvent\n",
        "from app.models.agent import AgentRun\n",
    )
    head = head.replace(
        '''from app.models.orchestra import (
    WORKSTREAM_INPUT_KINDS,
    WORKSTREAM_ON_DEADLINE,
    WORKSTREAM_STEP_KINDS,
    WORKSTREAM_WAIT_KINDS,
    Workstream,
    WorkstreamProject,
    WorkstreamRun,
    WorkstreamStep,
)
from app.models.signal import Signal, SignalMessage

logger = logging.getLogger(__name__)

# Runs execute at most this many steps per advance call (safety valve).
MAX_STEPS_PER_ADVANCE = 30
''',
        '''from app.models.orchestra import (
    WORKSTREAM_INPUT_KINDS,
    Workstream,
    WorkstreamRun,
    WorkstreamStep,
)
''',
    )
    head = head.replace(
        '''def _mock_execution() -> bool:
    return os.environ.get("BOKITO_MOCK_EXECUTION", "").lower() in ("1", "true", "yes")


''',
        "",
    )
    head = head.replace(
        '''async def _step_retry_limit(session: AsyncSession, tenant_id: UUID) -> int:
    """Workspace retry limit; defaults to two automatic retries."""
    tenant = await session.get(Tenant, tenant_id)
    settings = _parse_json(tenant.settings_json if tenant else "{}")
    raw = settings.get("workstream_step_retry_limit", 2)
    try:
        return max(0, min(int(raw), 10))
    except (TypeError, ValueError):
        return 2


''',
        "",
    )

    TARGET.write_text(head.rstrip() + "\n\n" + TAIL.lstrip("\n"), encoding="utf-8")
    print(f"wrote {TARGET} ({len(TARGET.read_text(encoding='utf-8').splitlines())} lines)")


if __name__ == "__main__":
    main()
