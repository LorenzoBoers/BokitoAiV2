import { apiDelete, apiGet, apiPatch, apiPost } from './api'
import { appRoutes } from '../api/routes'

export type TrashItem = {
  id: string
  resource_type: string
  resource_id: string
  title: string
  preview: string
  deleted_at: string | null
  purge_after: string | null
  deleted_by_user_id: string | null
  deleted_by_name: string | null
  batch_id: string
  parent_entry_id: string | null
  restore_hint: Record<string, unknown>
}

export type TrashSettings = {
  retention_days: number
  effective_days: number
  source: 'env' | 'tenant'
  env_days: number
}

export const BIN_TYPES = [
  'conversation',
  'project',
  'canvas',
  'knowledge',
  'contact',
  'company',
  'playbook',
  'trigger',
  'team',
  'inbox_rule',
  'saved_reply',
] as const

export function filterBinItems(
  items: TrashItem[],
  type: string | null,
  q: string,
): TrashItem[] {
  const needle = q.trim().toLowerCase()
  return items.filter((item) => {
    if (type && item.resource_type !== type) return false
    if (!needle) return true
    return `${item.title} ${item.preview} ${item.deleted_by_name ?? ''}`.toLowerCase().includes(needle)
  })
}

export async function listTrash(params?: { type?: string; q?: string; cursor?: number }) {
  const search = new URLSearchParams()
  if (params?.type) search.set('type', params.type)
  if (params?.q) search.set('q', params.q)
  if (params?.cursor) search.set('cursor', String(params.cursor))
  return apiGet<{ items: TrashItem[]; next_offset: number | null }>(appRoutes.trash.list(search))
}

export async function restoreTrashItem(id: string) {
  return apiPost<TrashItem>(appRoutes.trash.restore(id), {})
}

export async function purgeTrashItem(id: string) {
  return apiDelete<{ ok: boolean }>(appRoutes.trash.byId(id))
}

export async function emptyTrash(confirm: string) {
  return apiPost<{ purged: number }>(appRoutes.trash.empty, { confirm })
}

export async function getTrashSettings() {
  const data = await apiGet<{ settings: TrashSettings }>(appRoutes.trash.settings)
  return data.settings
}

export async function patchTrashSettings(retentionDays: number) {
  const data = await apiPatch<{ settings: TrashSettings }>(appRoutes.trash.settings, {
    retention_days: retentionDays,
  })
  return data.settings
}
