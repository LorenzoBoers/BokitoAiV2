import { projectsRoutes } from '../api/routes'
import { xanoGetWorkforce, xanoPatchWorkforce } from './xano'

export type WakeCadence = 'hourly' | 'daily' | 'weekly' | 'manual'
export type AutonomyMode = 'conservative' | 'balanced' | 'aggressive'
export type HitlSensitivity = 'low' | 'medium' | 'high' | 'all'

export interface ProjectOrchestrationConfig {
  id: string
  tenant_id: string
  project_id: string
  wake_cadence: WakeCadence
  autonomy_mode: AutonomyMode
  hitl_sensitivity: HitlSensitivity
  continuous_enabled: boolean
  next_po_wake_at: string | null
  last_po_wake_at: string | null
  created_at: string
  updated_at: string
}

export async function getProjectOrchestration(
  projectId: string,
): Promise<ProjectOrchestrationConfig> {
  return xanoGetWorkforce<ProjectOrchestrationConfig>(
    projectsRoutes.orchestration(projectId),
  )
}

export async function patchProjectOrchestration(
  projectId: string,
  patch: Partial<
    Pick<
      ProjectOrchestrationConfig,
      'wake_cadence' | 'autonomy_mode' | 'hitl_sensitivity' | 'continuous_enabled'
    >
  >,
): Promise<ProjectOrchestrationConfig> {
  return xanoPatchWorkforce<ProjectOrchestrationConfig>(
    projectsRoutes.orchestration(projectId),
    patch,
  )
}
