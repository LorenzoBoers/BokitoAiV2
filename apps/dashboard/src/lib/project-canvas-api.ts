import { canvasesRoutes } from '../api/routes'
import { WORKFORCE_API_BASE, buildAuthHeaders, workforceDelete, workforceGet, workforcePatch, workforcePost, workforcePut } from './api'
import type { CanvasKind, CanvasNode } from './project-canvas/types'

export type RefreshCadence = 'manual' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom'

export type ProjectCanvas = {
  id: string
  folder_id?: string | null
  folder_name?: string | null
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

export type CanvasRevisionSummary = {
  revision: number
  title: string
  kind: string
  updated_at?: string | null
  updated_by_type: string
}

export async function listCanvasRevisions(canvasId: string): Promise<CanvasRevisionSummary[]> {
  const data = await workforceGet<{ items: CanvasRevisionSummary[] }>(canvasesRoutes.revisions(canvasId))
  return data.items ?? []
}

export async function restoreCanvasRevision(canvasId: string, revision: number): Promise<ProjectCanvas> {
  return workforcePost<ProjectCanvas>(canvasesRoutes.restore(canvasId, revision), {})
}

/** Drag and text on a design canvas. Other kinds change through the conversation. */
export async function putDesignSource(
  canvasId: string,
  source: string,
  expectedRevision?: number,
): Promise<ProjectCanvas> {
  return workforcePut<ProjectCanvas>(canvasesRoutes.source(canvasId), {
    source,
    expected_revision: expectedRevision ?? null,
  })
}

export async function deleteCanvas(canvasId: string): Promise<void> {
  await workforceDelete(canvasesRoutes.byId(canvasId))
}

/** Fired after a canvas is moved to the Bin, so open lists drop the card. */
export const CANVAS_REMOVED_EVENT = 'bokito:canvas-removed'

/** Asks the open composer to draft a change for the canvas beside the thread. */
export const CANVAS_ASK_EVENT = 'bokito:canvas-ask'

export function askCanvasChange(text: string): void {
  window.dispatchEvent(new CustomEvent(CANVAS_ASK_EVENT, { detail: { text } }))
}

/** The open stage should replace itself when a card reloads a newer revision. */
export const CANVAS_UPDATED_EVENT = 'bokito:canvas-updated'

export function notifyCanvasUpdated(canvas: ProjectCanvas): void {
  window.dispatchEvent(new CustomEvent(CANVAS_UPDATED_EVENT, { detail: canvas }))
}

export function notifyCanvasRemoved(canvasId: string): void {
  window.dispatchEvent(new CustomEvent(CANVAS_REMOVED_EVENT, { detail: canvasId }))
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
