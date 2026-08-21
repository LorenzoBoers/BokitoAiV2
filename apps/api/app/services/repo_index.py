"""Real GitHub repo indexing into the workspace vector pipeline.

Fetches the connected repo's tree + file contents through the tenant's GitHub
OAuth connection, chunks text/code files, and upserts them as `repo_file`
DocChunks (source_id `{project_id}:{path}#{n}`), so `search_index` and the
project-scoped `search_repo` agent tool retrieve real repository content.
"""

from __future__ import annotations

import base64
import json
from datetime import datetime
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.workspace import DocChunk

# Indexing caps keep embedding cost and runtime bounded on large repos.
MAX_FILES = 150
MAX_FILE_BYTES = 60_000
MAX_CHUNKS_TOTAL = 500
CHUNK_CHARS = 1800

# Text/code files worth embedding; binaries and lockfiles are skipped.
INDEXABLE_EXTENSIONS = {
    ".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".md", ".mdx", ".rst", ".txt",
    ".json", ".yaml", ".yml", ".toml", ".ini", ".env.example",
    ".html", ".css", ".scss",
    ".go", ".rs", ".java", ".kt", ".rb", ".php", ".cs", ".c", ".h", ".cpp", ".hpp",
    ".sql", ".sh", ".ps1", ".dockerfile", ".graphql", ".proto", ".vue", ".svelte",
}
INDEXABLE_BASENAMES = {"dockerfile", "makefile", "readme", "license", "caddyfile"}
SKIP_PATH_PARTS = (
    "node_modules/", "dist/", "build/", ".git/", "vendor/", "__pycache__/",
    ".venv/", "venv/", "coverage/", ".next/", "out/",
)
SKIP_FILENAMES = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml", "uv.lock", "poetry.lock"}

_GITHUB_HEADERS = {"Accept": "application/vnd.github+json"}


def _is_indexable(path: str, size: int | None) -> bool:
    lowered = path.lower()
    if any(part in lowered for part in SKIP_PATH_PARTS):
        return False
    name = lowered.rsplit("/", 1)[-1]
    if name in SKIP_FILENAMES:
        return False
    if size is not None and size > MAX_FILE_BYTES:
        return False
    if name in INDEXABLE_BASENAMES or name.split(".")[0] in INDEXABLE_BASENAMES:
        return True
    return any(name.endswith(ext) for ext in INDEXABLE_EXTENSIONS)


def _priority(path: str) -> int:
    """Docs and entry points first so caps keep the most explanatory files."""
    lowered = path.lower()
    name = lowered.rsplit("/", 1)[-1]
    if name.startswith("readme"):
        return 0
    if lowered.endswith((".md", ".mdx", ".rst")):
        return 1
    if "docs/" in lowered:
        return 2
    return 3 + lowered.count("/")


def chunk_file(path: str, text: str) -> list[str]:
    """Split file content into ~CHUNK_CHARS pieces on line boundaries."""
    text = text.strip()
    if not text:
        return []
    chunks: list[str] = []
    while len(text) > CHUNK_CHARS:
        cut = text.rfind("\n", CHUNK_CHARS // 2, CHUNK_CHARS)
        if cut <= 0:
            cut = CHUNK_CHARS
        chunks.append(text[:cut].strip())
        text = text[cut:].strip()
    if text:
        chunks.append(text)
    return chunks


async def fetch_repo_files(
    token: str, full_name: str, branch: str
) -> tuple[str, list[tuple[str, str]]]:
    """Return (head_sha, [(path, text)]) for the indexable files of a repo."""
    headers = {**_GITHUB_HEADERS, "Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=30.0, headers=headers) as client:
        ref_resp = await client.get(
            f"https://api.github.com/repos/{full_name}/commits/{branch}"
        )
        ref_resp.raise_for_status()
        head_sha = str(ref_resp.json().get("sha") or "")

        tree_resp = await client.get(
            f"https://api.github.com/repos/{full_name}/git/trees/{head_sha}",
            params={"recursive": "1"},
        )
        tree_resp.raise_for_status()
        entries = tree_resp.json().get("tree") or []

        candidates = [
            (str(e.get("path") or ""), str(e.get("sha") or ""))
            for e in entries
            if e.get("type") == "blob" and _is_indexable(str(e.get("path") or ""), e.get("size"))
        ]
        candidates.sort(key=lambda item: _priority(item[0]))
        candidates = candidates[:MAX_FILES]

        files: list[tuple[str, str]] = []
        for path, blob_sha in candidates:
            blob_resp = await client.get(
                f"https://api.github.com/repos/{full_name}/git/blobs/{blob_sha}"
            )
            if blob_resp.status_code != 200:
                continue
            payload = blob_resp.json()
            if payload.get("encoding") != "base64":
                continue
            try:
                text = base64.b64decode(payload.get("content") or "").decode("utf-8")
            except (UnicodeDecodeError, ValueError):
                continue  # binary despite the extension
            files.append((path, text))
        return head_sha, files


async def index_project_repo(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> dict[str, Any]:
    """Index the project's connected GitHub repo into repo_file DocChunks."""
    from app.models.project import Project
    from app.services.integrations_platform import get_provider_access_token
    from app.services.workspace import upsert_source_chunk

    project = (
        await session.execute(
            select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if project is None or not project.github_repo_full_name:
        return {"indexed": 0, "error": "No repository connected"}

    full_name = project.github_repo_full_name
    branch = project.github_default_branch or "main"
    prefix = f"{project_id}:"

    project.repo_index_status = "indexing"
    project.repo_index_error = None
    project.updated_at = datetime.utcnow()
    session.add(project)
    await session.commit()

    try:
        token = await get_provider_access_token(session, tenant_id, "github")
        if not token:
            raise RuntimeError("GitHub connection has no access token — reconnect GitHub.")
        head_sha, files = await fetch_repo_files(token, full_name, branch)

        indexed_ids: set[str] = set()
        chunk_budget = MAX_CHUNKS_TOTAL
        for path, text in files:
            if chunk_budget <= 0:
                break
            for n, piece in enumerate(chunk_file(path, text)):
                if chunk_budget <= 0:
                    break
                source_id = f"{prefix}{path}#{n}"
                await upsert_source_chunk(
                    session,
                    tenant_id,
                    source_type="repo_file",
                    source_id=source_id,
                    title=f"{full_name}/{path}",
                    content=piece,
                    metadata={
                        "project_id": str(project_id),
                        "repo": full_name,
                        "path": path,
                        "branch": branch,
                        "commit_sha": head_sha,
                    },
                )
                indexed_ids.add(source_id)
                chunk_budget -= 1

        # Drop chunks for files that no longer exist (or fell out of the caps).
        stale = (
            await session.execute(
                select(DocChunk.id, DocChunk.source_id).where(
                    DocChunk.tenant_id == tenant_id,
                    DocChunk.source_type == "repo_file",
                    DocChunk.source_id.like(f"{prefix}%"),
                )
            )
        ).all()
        stale_ids = [row_id for row_id, source_id in stale if source_id not in indexed_ids]
        if stale_ids:
            await session.execute(delete(DocChunk).where(DocChunk.id.in_(stale_ids)))

        project.repo_index_status = "ready"
        project.repo_indexed_at = datetime.utcnow()
        project.repo_last_commit_sha = head_sha
        project.repo_index_error = None
        project.updated_at = datetime.utcnow()
        session.add(project)
        await session.commit()
        return {
            "indexed": len(indexed_ids),
            "files": len(files),
            "commit_sha": head_sha,
            "removed": len(stale_ids),
        }
    except Exception as exc:  # noqa: BLE001 — status must reflect any failure
        await session.rollback()
        project.repo_index_status = "error"
        project.repo_index_error = str(exc)[:500]
        project.updated_at = datetime.utcnow()
        session.add(project)
        await session.commit()
        return {"indexed": 0, "error": str(exc)[:500]}


async def search_repo_chunks(
    session: AsyncSession,
    tenant_id: UUID,
    query: str,
    *,
    project_id: UUID | None = None,
    top_k: int = 6,
) -> list[dict[str, Any]]:
    """Hybrid search over repo_file chunks, optionally scoped to one project."""
    from app.services.workspace import hybrid_search

    results = await hybrid_search(
        session, tenant_id, query, top_k=top_k * 3, source_types=["repo_file"]
    )
    if project_id is not None:
        prefix = f"{project_id}:"
        results = [r for r in results if str(r.get("source_id") or "").startswith(prefix)]
    out = []
    for r in results[:top_k]:
        source_id = str(r.get("source_id") or "")
        path = source_id.split(":", 1)[1].rsplit("#", 1)[0] if ":" in source_id else source_id
        out.append({**r, "path": path})
    return out


def parse_chunk_metadata(chunk: DocChunk) -> dict[str, Any]:
    try:
        return json.loads(chunk.metadata_json or "{}")
    except json.JSONDecodeError:
        return {}
