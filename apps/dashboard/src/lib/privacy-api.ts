import { apiGet, apiPatch, apiPost } from './api'
import { appRoutes } from '../api/routes'

export type PrivacySettings = {
  retention_messages_days: number
  retention_calendar_days: number
  retention_audit_days: number
  llm_may_use_message_bodies: boolean
}

export async function getPrivacySettings(): Promise<PrivacySettings> {
  const data = await apiGet<{ settings: PrivacySettings }>(appRoutes.privacy.settings)
  return data.settings
}

export async function patchPrivacySettings(
  patch: Partial<PrivacySettings>,
): Promise<PrivacySettings> {
  const data = await apiPatch<{ settings: PrivacySettings }>(appRoutes.privacy.settings, patch)
  return data.settings
}

export async function exportPrivacySubject(email: string): Promise<unknown> {
  const data = await apiPost<{ package: unknown }>(appRoutes.privacy.export, { email })
  return data.package
}

export async function erasePrivacySubject(email: string): Promise<unknown> {
  return apiPost(appRoutes.privacy.eraseSubject, { email })
}
