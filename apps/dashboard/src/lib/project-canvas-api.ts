import { canvasesRoutes } from '../api/routes'
import { workforceDelete, workforceGet, workforcePatch, workforcePost } from './api'
import type { CanvasNode } from './project-canvas/types'

export type RefreshCadence = 'manual' | 'hourly' | 'daily' | 'weekly' | 'monthly'

export type ProjectCanvas = {
  id: string
  project_id?: string | null
  owner_kind: 'project' | 'tenant'
  owner_id: string
  slug: string
  title: string
  schema_version: number
  revision: number
  source: string
  tree: CanvasNode
  empty: boolean
  managing_agent_id?: string | null
  refresh_trigger_id?: string | null
  refresh_minutes?: number
  refresh_cadence?: RefreshCadence
  next_run_at?: string | null
  updated_by_type: string
  updated_by_id?: string | null
  notes?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export async function listCanvases(ownerKind: 'project' | 'tenant', ownerId: string): Promise<ProjectCanvas[]> {
  const data = await workforceGet<{ items: ProjectCanvas[] }>(canvasesRoutes.list(ownerKind, ownerId))
  return data.items ?? []
}

export async function getCanvasById(canvasId: string): Promise<ProjectCanvas> {
  return workforceGet<ProjectCanvas>(canvasesRoutes.byId(canvasId))
}

export async function createCanvas(body: {
  owner_kind: 'project' | 'tenant'
  owner_id: string
  title: string
  slug?: string
  managing_agent_id?: string | null
  refresh_minutes?: number | null
  refresh_cadence?: RefreshCadence
  notes?: string | null
}): Promise<ProjectCanvas> {
  return workforcePost<ProjectCanvas>(canvasesRoutes.create, body)
}

export async function patchCanvasMeta(
  canvasId: string,
  body: {
    title?: string
    slug?: string
    managing_agent_id?: string | null
    refresh_minutes?: number | null
    refresh_cadence?: RefreshCadence
    notes?: string | null
  },
): Promise<ProjectCanvas> {
  return workforcePatch<ProjectCanvas>(canvasesRoutes.byId(canvasId), body)
}

export async function deleteCanvas(canvasId: string): Promise<void> {
  await workforceDelete(canvasesRoutes.byId(canvasId))
}
