import { appRoutes } from '../api/routes/app.routes'
import { apiDelete, apiGet, apiPatch, apiPost } from './api'

export type ChannelBinding = {
  id: string
  channel: string
  channel_account_id: string | null
  contact_id: string | null
  agent_id: string
  priority: number
  enabled: boolean
  created_at: string
}

export async function listChannelBindings(): Promise<ChannelBinding[]> {
  const res = await apiGet<{ bindings: ChannelBinding[] }>(appRoutes.channelBindings.list)
  return Array.isArray(res.bindings) ? res.bindings : []
}

export async function createChannelBinding(body: {
  channel: string
  agent_id: string
  /** Scope the binding to one mailbox / number / account instead of the whole channel. */
  channel_account_id?: string | null
  contact_id?: string | null
  priority?: number
  enabled?: boolean
}): Promise<ChannelBinding> {
  return apiPost<ChannelBinding>(appRoutes.channelBindings.list, body)
}

export async function updateChannelBinding(
  id: string,
  body: {
    enabled?: boolean
    priority?: number
    agent_id?: string
    channel_account_id?: string | null
  },
): Promise<ChannelBinding> {
  return apiPatch<ChannelBinding>(appRoutes.channelBindings.byId(id), body)
}

export async function deleteChannelBinding(id: string): Promise<void> {
  await apiDelete(appRoutes.channelBindings.byId(id))
}
