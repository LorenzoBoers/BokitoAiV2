import { settingsRoutes, staffRoutes } from '../api/routes'
import {
  settingsDelete,
  settingsGet,
  settingsPatch,
  settingsPost,
  staffDelete,
  staffGet,
  staffPatch,
  staffPost,
  staffPut,
  workforcePatch,
} from './api'
import { WORKFORCE_API_BASE } from './api.config'

export type LlmProvider = 'anthropic' | 'openai'

export type ProviderType = 'anthropic' | 'openai' | 'openai_compatible'

export type ProviderConnection = {
  id: string
  provider_type: ProviderType
  label: string
  base_url: string
  enabled: boolean
  is_set: boolean
  last4: string
  updated_at: string | null
}

export type PresetModel = {
  slug: string
  model_id: string
  display_name: string
  kind: 'chat' | 'embedding'
  context_window: number
  input_cost_per_mtok_cents: number
  output_cost_per_mtok_cents: number
  supports_tools: boolean
  supports_vision: boolean
  sort_order: number
}

export type ProviderPreset = {
  label: string
  default_base_url: string
  requires_base_url: boolean
  models: PresetModel[]
}

export type TenantModelRow = {
  id: string
  connection_id: string
  slug: string
  model_id: string
  display_name: string
  kind: 'chat' | 'embedding'
  enabled: boolean
  supports_tools: boolean
  supports_vision: boolean
  context_window: number
  input_cost_per_mtok_cents: number
  output_cost_per_mtok_cents: number
  is_default_chat: boolean
  is_default_embedding: boolean
  sort_order: number
  provider_type?: ProviderType
  connection_label?: string
}

/** Legacy platform-catalog model shape (fallback before tenant setup). */
export type CatalogModel = {
  slug: string
  provider: string
  kind: 'chat' | 'embedding'
  model_id: string
  display_name: string
  context_window: number
  input_cost_per_mtok_cents: number
  output_cost_per_mtok_cents: number
  supports_tools: boolean
  supports_vision: boolean
  enabled: boolean
  is_default_chat: boolean
  is_default_embedding: boolean
  id?: string
  sort_order?: number
}

export type TenantModelPrefs = {
  default_chat: string
  default_embedding: string
  allowed_chat: string[]
}

export type LlmKeyStatus = {
  provider: 'anthropic' | 'openai'
  is_set: boolean
  last4: string
  updated_at: string | null
}

export type TenantModelsPayload =
  | {
      source: 'tenant'
      models: TenantModelRow[]
      connections: ProviderConnection[]
      default_chat: string
      default_embedding: string
      presets: Record<ProviderType, ProviderPreset>
    }
  | {
      source: 'platform'
      models: CatalogModel[]
      prefs: TenantModelPrefs
      byok: LlmKeyStatus[]
      billable_providers: string[]
      presets: Record<ProviderType, ProviderPreset>
    }

export type ProvidersPayload = {
  connections: ProviderConnection[]
  presets: Record<ProviderType, ProviderPreset>
}

export type PlatformKeysPayload = {
  providers: LlmKeyStatus[]
  markup?: number
}

export function selectableChatModels(payload: TenantModelsPayload): Array<TenantModelRow | CatalogModel> {
  if (payload.source === 'tenant') {
    return payload.models.filter((m) => m.kind === 'chat' && m.enabled)
  }
  const allowed = payload.prefs.allowed_chat ?? []
  return payload.models.filter((m) => {
    if (m.kind !== 'chat' || !m.enabled) return false
    return allowed.length === 0 || allowed.includes(m.slug)
  })
}

export function defaultChatSlug(payload: TenantModelsPayload): string {
  if (payload.source === 'tenant') return payload.default_chat || ''
  return payload.prefs.default_chat || ''
}

// --- Providers ---

export async function getProviders(token: string) {
  return settingsGet<ProvidersPayload>(settingsRoutes.providers.list, token)
}

export async function createProvider(
  token: string,
  body: {
    provider_type: ProviderType
    label?: string
    base_url?: string
    api_key: string
  },
) {
  return settingsPost<ProviderConnection>(settingsRoutes.providers.list, body, token)
}

export async function updateProvider(
  token: string,
  id: string,
  body: Partial<{ label: string; base_url: string; api_key: string; enabled: boolean }>,
) {
  return settingsPatch<ProviderConnection>(settingsRoutes.providers.byId(id), body, token)
}

export async function deleteProvider(token: string, id: string) {
  return settingsDelete(settingsRoutes.providers.byId(id), token)
}

export async function testProvider(token: string, id: string) {
  return settingsPost<{ ok: boolean; message: string }>(
    settingsRoutes.providers.test(id),
    {},
    token,
  )
}

// --- Tenant models ---

export async function getTenantModels(token: string) {
  return settingsGet<TenantModelsPayload>(settingsRoutes.models.list, token)
}

export async function createTenantModel(
  token: string,
  body: {
    connection_id?: string
    model_id?: string
    display_name?: string
    kind?: string
    slug?: string
    enabled?: boolean
    enable_presets?: boolean
    is_default_chat?: boolean
    is_default_embedding?: boolean
  },
) {
  return settingsPost<TenantModelRow | { items: TenantModelRow[] }>(
    settingsRoutes.models.list,
    body,
    token,
  )
}

export async function updateTenantModel(
  token: string,
  id: string,
  body: Partial<{
    display_name: string
    enabled: boolean
    is_default_chat: boolean
    is_default_embedding: boolean
  }>,
) {
  return settingsPatch<TenantModelRow>(settingsRoutes.models.byId(id), body, token)
}

export async function deleteTenantModel(token: string, id: string) {
  return settingsDelete(settingsRoutes.models.byId(id), token)
}

export async function setAgentModel(token: string, agentId: string, model: string) {
  return workforcePatch<{ ok: boolean; agent: Record<string, unknown> }>(
    `/agents/${encodeURIComponent(agentId)}/model`,
    { model },
    token,
  )
}

// --- Staff platform admin ---

export async function staffListModels(token: string) {
  return staffGet<{ items: CatalogModel[] }>(staffRoutes.models.list, token)
}

export async function staffUpsertModel(
  token: string,
  body: Partial<CatalogModel>,
  modelId?: string,
) {
  const path = modelId ? staffRoutes.models.byId(modelId) : staffRoutes.models.list
  if (modelId) {
    return staffPatch<CatalogModel>(path, body, token)
  }
  return staffPost<CatalogModel>(path, body, token)
}

export async function staffDeleteModel(token: string, modelId: string) {
  return staffDelete(staffRoutes.models.byId(modelId), token)
}

export async function staffGetPlatformKeys(token: string) {
  return staffGet<PlatformKeysPayload>(staffRoutes.platformKeys.list, token)
}

export async function staffSetPlatformKey(
  token: string,
  provider: 'anthropic' | 'openai',
  apiKey: string,
) {
  return staffPut<PlatformKeysPayload>(
    staffRoutes.platformKeys.byProvider(provider),
    { api_key: apiKey },
    token,
  )
}

export async function staffDeletePlatformKey(token: string, provider: 'anthropic' | 'openai') {
  return staffDelete<PlatformKeysPayload>(staffRoutes.platformKeys.byProvider(provider), token)
}

export async function staffSetMarkup(token: string, multiplier: number) {
  return staffPut<{ markup: number }>(staffRoutes.markup, { multiplier }, token)
}

// Re-export for callers that need the workforce path constant
export { WORKFORCE_API_BASE }
