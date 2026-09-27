import { projectsRoutes } from '../api/routes'
import { workforceGet, workforcePatch, workforcePut } from './api'

export type ProjectCanvasWidgetType =
  | 'markdown'
  | 'metric'
  | 'status'
  | 'queue_summary'
  | 'queue_list'
  | 'resources'
  | 'budget'
  | 'links'
  | 'table'
  | 'chart'
  | 'iframe'
  | 'spacer'

export type ProjectCanvasWidget = {
  id: string
  type: ProjectCanvasWidgetType | string
  title?: string | null
  x: number
  y: number
  w: number
  h: number
  config: Record<string, unknown>
  /** Hydrated live payload from the API (queue/budget/resources). */
  data?: unknown
}

export type ProjectCanvasLayout = {
  columns: number
  row_height: number
  gap: number
}

export type ProjectCanvas = {
  id: string
  project_id: string
  slug: string
  title: string
  schema_version: number
  revision: number
  layout: ProjectCanvasLayout
  widgets: ProjectCanvasWidget[]
  updated_by_type: string
  updated_by_id?: string | null
  notes?: string | null
  created_at?: string | null
  updated_at?: string | null
  widget_types: string[]
  live_widget_types: string[]
}

export type ProjectCanvasListItem = {
  id: string
  slug: string
  title: string
  revision: number
  updated_at?: string | null
  widget_count: number
}

export async function listProjectCanvases(projectId: string): Promise<ProjectCanvasListItem[]> {
  const data = await workforceGet<{ items: ProjectCanvasListItem[] }>(projectsRoutes.canvases(projectId))
  return data.items ?? []
}

export async function getProjectCanvas(
  projectId: string,
  slug = 'main',
  hydrate = true,
): Promise<ProjectCanvas> {
  return workforceGet<ProjectCanvas>(projectsRoutes.canvas(projectId, slug, hydrate))
}

export async function putProjectCanvas(
  projectId: string,
  slug: string,
  body: {
    title?: string
    layout?: ProjectCanvasLayout
    widgets?: ProjectCanvasWidget[]
    notes?: string | null
    expected_revision?: number
    reset_to_default?: boolean
  },
): Promise<ProjectCanvas> {
  return workforcePut<ProjectCanvas>(projectsRoutes.canvas(projectId, slug), body)
}

export async function patchProjectCanvas(
  projectId: string,
  slug: string,
  body: {
    upsert?: Partial<ProjectCanvasWidget>[]
    remove_ids?: string[]
    notes?: string | null
    expected_revision?: number
  },
): Promise<ProjectCanvas> {
  return workforcePatch<ProjectCanvas>(projectsRoutes.canvas(projectId, slug), body)
}
