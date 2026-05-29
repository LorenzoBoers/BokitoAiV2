import { projectsRoutes } from '../api/routes'
import type { ProjectPoAgent } from './workstreams-api'
import { xanoDeleteWorkforce, xanoGetWorkforce, xanoPatchWorkforce, xanoPostWorkforce } from './xano'

export type ProjectPoAgentSummary = {
  project_id: string
  po_agent_id: string | null
  po_agent: ProjectPoAgent | null
  setup_complete: boolean
}

export async function getProjectPoAgent(projectId: string): Promise<ProjectPoAgentSummary> {
  return xanoGetWorkforce<ProjectPoAgentSummary>(projectsRoutes.poAgent(projectId))
}

export async function createProjectPoAgent(
  projectId: string,
  input?: { name?: string },
): Promise<ProjectPoAgentSummary> {
  return xanoPostWorkforce<ProjectPoAgentSummary>(projectsRoutes.poAgent(projectId), input ?? {})
}

export async function linkProjectPoAgent(
  projectId: string,
  poAgentId: string,
): Promise<ProjectPoAgentSummary> {
  const data = await xanoPatchWorkforce<{
    project_id: string
    po_agent_id: string
    po_agent: ProjectPoAgent
    setup_complete: boolean
  }>(projectsRoutes.poAgent(projectId), { po_agent_id: poAgentId })
  return {
    project_id: data.project_id,
    po_agent_id: data.po_agent_id,
    po_agent: data.po_agent,
    setup_complete: data.setup_complete,
  }
}

export async function unlinkProjectPoAgent(projectId: string): Promise<ProjectPoAgentSummary> {
  const data = await xanoDeleteWorkforce<ProjectPoAgentSummary>(projectsRoutes.poAgent(projectId))
  if (!data) {
    return {
      project_id: projectId,
      po_agent_id: null,
      po_agent: null,
      setup_complete: false,
    }
  }
  return data
}
