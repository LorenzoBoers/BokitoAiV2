/** Run detail in project workforce context. */
export function projectWorkforceRunUrl(projectId: string, workLogId: string): string {
  return `/project/${encodeURIComponent(projectId)}/workforce/${encodeURIComponent(workLogId)}`
}

/** Run detail in AI agent context. */
export function agentWorkforceRunUrl(agentId: string, workLogId: string): string {
  return `/ai/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(workLogId)}`
}

export function workLogDetailUrl(run: {
  id: string
  project_id: string
  agent_id?: string | null
}): string {
  if (run.project_id) {
    return projectWorkforceRunUrl(run.project_id, run.id)
  }
  if (run.agent_id) {
    return agentWorkforceRunUrl(run.agent_id, run.id)
  }
  return '/projects'
}

export function messageWorkLogUrl(
  workLogId: string,
  projectId?: string | null,
  agentId?: string | null,
): string {
  if (projectId) return projectWorkforceRunUrl(projectId, workLogId)
  if (agentId) return agentWorkforceRunUrl(agentId, workLogId)
  return '/projects'
}
