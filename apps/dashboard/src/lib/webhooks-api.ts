/** Outbound webhooks management (Settings > Integrations > Developers). */

import { settingsRoutes } from '../api/routes'
import { settingsDelete, settingsGet, settingsPatch, settingsPost } from './api'

export type WebhookEndpoint = {
  id: string
  url: string
  description: string
  events: string[]
  active: boolean
  last_delivery_at: string | null
  last_status: string
  created_at: string
  secret?: string
}

export type WebhookDelivery = {
  id: string
  endpoint_id: string
  event: string
  status: 'pending' | 'delivered' | 'failed'
  status_code: number
  attempts: number
  error: string
  created_at: string
  delivered_at: string | null
}

export async function listWebhooks() {
  return settingsGet<{ items: WebhookEndpoint[]; events: string[] }>(settingsRoutes.webhooks.list)
}

export async function createWebhook(body: { url: string; description?: string; events?: string[] }) {
  return settingsPost<WebhookEndpoint>(settingsRoutes.webhooks.list, body)
}

export async function updateWebhook(
  id: string,
  body: Partial<{ url: string; description: string; events: string[]; active: boolean }>,
) {
  return settingsPatch<WebhookEndpoint>(settingsRoutes.webhooks.byId(id), body)
}

export async function deleteWebhook(id: string) {
  return settingsDelete(settingsRoutes.webhooks.byId(id))
}

export async function testWebhook(id: string) {
  return settingsPost<WebhookDelivery>(settingsRoutes.webhooks.test(id), {})
}

export async function listWebhookDeliveries(id: string) {
  return settingsGet<{ items: WebhookDelivery[] }>(settingsRoutes.webhooks.deliveries(id))
}
