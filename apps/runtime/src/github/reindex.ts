import { indexQueue } from '../queue.js'
import { cloneOrPull, fetchLatestCommitSha, readRepoTextFiles } from './repo.js'
import { fetchGithubWorkerToken, patchProjectIndexStatus } from './xano-github.js'

export async function processRepoReindex(projectId: string, tenantId: string): Promise<{ files: number }> {
  await patchProjectIndexStatus({
    tenant_id: tenantId,
    project_id: projectId,
    status: 'indexing',
  })

  try {
    const tokenRow = await fetchGithubWorkerToken(tenantId, projectId)
    const branch = tokenRow.github_default_branch || 'main'
    const commitSha = await cloneOrPull(
      projectId,
      tokenRow.github_repo_full_name,
      branch,
      tokenRow.access_token,
    )
    const files = await readRepoTextFiles(projectId)

    for (const file of files) {
      await indexQueue.add('index', {
        project_id: projectId,
        tenant_id: tenantId,
        file_path: file.path,
        content: file.content,
        source_type: 'github_file',
      })
    }

    const latestSha =
      (await fetchLatestCommitSha(tokenRow.github_repo_full_name, branch, tokenRow.access_token)) ||
      commitSha

    await patchProjectIndexStatus({
      tenant_id: tenantId,
      project_id: projectId,
      status: 'ready',
      repo_last_commit_sha: latestSha,
    })

    return { files: files.length }
  } catch (e) {
    const message = (e as Error).message.slice(0, 500)
    await patchProjectIndexStatus({
      tenant_id: tenantId,
      project_id: projectId,
      status: 'error',
      error: message,
    })
    throw e
  }
}
