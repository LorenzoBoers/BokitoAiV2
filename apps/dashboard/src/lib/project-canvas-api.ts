import { canvasesRoutes } from '../api/routes'
import { WORKFORCE_API_BASE, buildAuthHeaders, workforceDelete, workforceGet, workforcePatch, workforcePost } from './api'
import type { CanvasKind, CanvasNode } from './project-canvas/types'

export type RefreshCadence = 'manual' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom'

export type ProjectCanvas = {
  id: string
  folder_id?: string | null
  slug: string
  title: string
  kind?: CanvasKind
  language?: string | null
  schema_version: number
  revision: number
  source: string
  tree: CanvasNode
  empty: boolean
  managing_agent_id?: string | null
  signal_id?: string | null
  managing_agent?: {
    id: string
    name: string
    path: string
    avatar_kind?: string | null
    avatar_icon?: string | null
    avatar_color?: string | null
    avatar_shape?: string | null
    avatar_image_url?: string | null
  } | null
  thread?: { id: string; title: string; path: string } | null
  refresh_trigger_id?: string | null
  refresh_minutes?: number
  refresh_cadence?: RefreshCadence
  refresh_cron?: string | null
  next_run_at?: string | null
  updated_by_type: string
  updated_by_id?: string | null
  notes?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export async function listCanvases(folderId: string): Promise<ProjectCanvas[]> {
  const data = await workforceGet<{ items: ProjectCanvas[] }>(canvasesRoutes.list(folderId))
  return data.items ?? []
}

/** Where a canvas link without a folder lands (named canvas, last canvas, or the folder General). */
export async function canvasDefaultLocation(
  canvasId?: string | null,
): Promise<{ folder_id: string; canvas_id: string | null; href: string }> {
  return workforceGet(canvasesRoutes.defaultLocation(canvasId))
}

export async function getCanvasById(canvasId: string): Promise<ProjectCanvas> {
  return workforceGet<ProjectCanvas>(canvasesRoutes.byId(canvasId))
}

export async function listCanvasesForThread(signalId: string): Promise<ProjectCanvas[]> {
  const data = await workforceGet<{ items: ProjectCanvas[] }>(canvasesRoutes.bySignal(signalId))
  return data.items ?? []
}

export async function patchCanvasMeta(
  canvasId: string,
  body: {
    title?: string
    slug?: string
    managing_agent_id?: string | null
    refresh_minutes?: number | null
    refresh_cadence?: RefreshCadence
    refresh_cron?: string | null
    notes?: string | null
  },
): Promise<ProjectCanvas> {
  return workforcePatch<ProjectCanvas>(canvasesRoutes.byId(canvasId), body)
}

export async function deleteCanvas(canvasId: string): Promise<void> {
  await workforceDelete(canvasesRoutes.byId(canvasId))
}

function saveBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

async function exportError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { detail?: unknown }
    if (typeof data.detail === 'string' && data.detail.trim()) return data.detail
  } catch {
    return ''
  }
  return ''
}

/** Download the sheet canvas as CSV or Excel. The file is built on the server. */
export async function downloadSheet(canvasId: string, format: 'csv' | 'xlsx', filename: string): Promise<void> {
  const res = await fetch(`${WORKFORCE_API_BASE}${canvasesRoutes.exportFile(canvasId, format)}`, {
    method: 'GET',
    headers: buildAuthHeaders(undefined, false),
    credentials: 'include',
  })
  if (!res.ok) {
    const detail = await exportError(res)
    throw new Error(detail || `HTTP ${res.status}`)
  }
  saveBlob(filename, await res.blob())
}

/** Create a Google Sheet from this canvas and return its URL. */
export async function exportSheetToGoogle(canvasId: string): Promise<{ url: string; title?: string }> {
  return workforcePost(canvasesRoutes.exportGoogle(canvasId), {})
}
