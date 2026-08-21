"""Real GitHub repo indexing: chunking, indexing pipeline, search tool."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.project import Project
from app.models.workspace import DocChunk
from app.services import repo_index
from app.services.repo_index import (
    _is_indexable,
    chunk_file,
    index_project_repo,
    search_repo_chunks,
)


async def _tenant(session) -> Tenant:
    return (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()


def test_is_indexable_filters():
    assert _is_indexable("apps/api/app/main.py", 1000)
    assert _is_indexable("README.md", 1000)
    assert _is_indexable("Dockerfile", 1000)
    assert not _is_indexable("node_modules/react/index.js", 1000)
    assert not _is_indexable("package-lock.json", 1000)
    assert not _is_indexable("assets/logo.png", 1000)
    assert not _is_indexable("big.py", 10_000_000)


def test_chunk_file_splits_on_lines():
    text = "\n".join(f"line {i} " + "x" * 40 for i in range(200))
    chunks = chunk_file("a.py", text)
    assert len(chunks) > 1
    assert all(len(c) <= repo_index.CHUNK_CHARS for c in chunks)
    assert "line 0" in chunks[0]
    assert "line 199" in chunks[-1]


@pytest.mark.asyncio
async def test_index_project_repo_end_to_end(
    client: AsyncClient, session_override, monkeypatch
):
    tenant = await _tenant(session_override)
    project = Project(tenant_id=tenant.id, name="Indexed", slug="indexed")
    project.github_repo_full_name = "bokito/example"
    project.github_default_branch = "main"
    session_override.add(project)
    await session_override.commit()
    await session_override.refresh(project)

    async def fake_token(session, tenant_id, provider):
        return "gh-token"

    async def fake_fetch(token, full_name, branch):
        assert token == "gh-token"
        assert full_name == "bokito/example"
        return "sha-123", [
            ("README.md", "# Example\n\nThis repo powers the billing exporter."),
            ("src/export.py", "def export_invoices():\n    return 'invoices'"),
        ]

    monkeypatch.setattr(
        "app.services.integrations_platform.get_provider_access_token", fake_token
    )
    monkeypatch.setattr(repo_index, "fetch_repo_files", fake_fetch)

    result = await index_project_repo(session_override, tenant.id, project.id)
    assert result["indexed"] == 2
    assert result["commit_sha"] == "sha-123"

    await session_override.refresh(project)
    assert project.repo_index_status == "ready"
    assert project.repo_last_commit_sha == "sha-123"

    chunks = (
        await session_override.execute(
            select(DocChunk).where(
                DocChunk.tenant_id == tenant.id, DocChunk.source_type == "repo_file"
            )
        )
    ).scalars().all()
    assert {c.source_id for c in chunks} == {
        f"{project.id}:README.md#0",
        f"{project.id}:src/export.py#0",
    }

    # Search finds the file and reports its path.
    hits = await search_repo_chunks(
        session_override, tenant.id, "billing exporter", project_id=project.id
    )
    assert hits
    assert hits[0]["path"] in ("README.md", "src/export.py")

    # Re-index with one file removed drops the stale chunk.
    async def fake_fetch_smaller(token, full_name, branch):
        return "sha-456", [("README.md", "# Example\n\nOnly the readme now.")]

    monkeypatch.setattr(repo_index, "fetch_repo_files", fake_fetch_smaller)
    result = await index_project_repo(session_override, tenant.id, project.id)
    assert result["indexed"] == 1
    assert result["removed"] == 1


@pytest.mark.asyncio
async def test_index_without_token_sets_error(client: AsyncClient, session_override, monkeypatch):
    tenant = await _tenant(session_override)
    project = Project(tenant_id=tenant.id, name="Broken", slug="broken")
    project.github_repo_full_name = "bokito/missing"
    session_override.add(project)
    await session_override.commit()
    await session_override.refresh(project)

    async def no_token(session, tenant_id, provider):
        return None

    monkeypatch.setattr(
        "app.services.integrations_platform.get_provider_access_token", no_token
    )

    result = await index_project_repo(session_override, tenant.id, project.id)
    assert result["indexed"] == 0
    assert "token" in result["error"].lower()

    await session_override.refresh(project)
    assert project.repo_index_status == "error"
    assert project.repo_index_error
