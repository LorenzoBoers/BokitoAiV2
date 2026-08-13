/** Run detail on the agent detail page. */
export function agentWorkforceRunUrl(agentId: string, workLogId: string): string {
  return `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(workLogId)}`
}

export function workLogDetailUrl(run: {
  id: string
  project_id: string
  agent_id?: string | null
}): string {
  if (run.agent_id) {
    return agentWorkforceRunUrl(run.agent_id, run.id)
  }
  return '/cockpit/activity'
}

export function messageWorkLogUrl(
  workLogId: string,
  _projectId?: string | null,
  agentId?: string | null,
): string {
  if (agentId) return agentWorkforceRunUrl(agentId, workLogId)
  return '/cockpit/activity'
}
