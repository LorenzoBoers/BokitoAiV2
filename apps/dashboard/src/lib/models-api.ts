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

export type LlmProvider = 'mistral' | 'anthropic' | 'openai'

export type ProviderType = 'mistral' | 'anthropic' | 'openai' | 'openai_compatible'

/** Hosting region of a provider: where prompts and completions are processed. */
export type DataRegion = 'eu' | 'us' | 'unknown'

export type ProviderConnection = {
  id: string
  provider_type: ProviderType
  label: string
  base_url: string
  region: DataRegion
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
  /** eu | us | '' when it depends on the base URL. */
  region: DataRegion | ''
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
  region?: DataRegion
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
  provider: LlmProvider
  is_set: boolean
  last4: string
  updated_at: string | null
}

/** Managed Bokito tier: abstract platform model (no third-party backing names). */
export type ManagedAiModel = {
  slug: string
  display_name: string
  provider: string
  key_source: 'tenant' | 'platform' | 'mock'
  ready: boolean
  /** Soft region hint for the managed tier. */
  region: DataRegion
  intended_region: DataRegion
  /** True while the tier runs on a temporary backup path. */
  fallback_active: boolean
  /** lighter | standard | heavier — operator hint only. */
  tier?: 'lighter' | 'standard' | 'heavier' | string
  is_default_chat?: boolean
  /** True when this tier is the workspace Bokito AI default. */
  is_workspace_default?: boolean
  kind?: string
  enabled?: boolean
  /** Product-facing context length from the platform catalog. */
  context_window?: number
  supports_tools?: boolean
  supports_vision?: boolean
  input_cost_per_mtok_cents?: number
  output_cost_per_mtok_cents?: number
}

/** Workspace / agent Bokito AI mode. */
export type WorkspaceChatMode = 'automatic' | 'bokito-maki' | 'bokito-ai-3-1' | 'bokito-kong'
export type AgentChatMode = 'inherit' | WorkspaceChatMode | string

export const AUTOMATIC_MODE = 'automatic'
export const INHERIT_MODE = 'inherit'
export const MANAGED_CHAT_SLUGS = ['bokito-maki', 'bokito-ai-3-1', 'bokito-kong'] as const

export type ManagedAiStatus = {
  name: string
  status: 'active' | 'standby' | 'unconfigured'
  chat: ManagedAiModel
  /** All managed chat tiers (Maki, Bokito, Kong). */
  models?: ManagedAiModel[]
  default_chat?: string
  workspace_chat_mode?: WorkspaceChatMode | string
  embedding: ManagedAiModel
}

export type DataRegionPolicy = 'blocked' | 'allowed'

export type UsageRegionRow = {
  region: DataRegion
  tokens: number
  customer_cost_micros: number
}

/** Workspace data-region policy and the EU share of the last 30 days. */
export type DataRegionBlock = {
  non_eu_platform_models: DataRegionPolicy
  eu_share_pct_30d: number | null
  by_region_30d: UsageRegionRow[]
  /** Catalog slugs of US-hosted platform models that active agents point at. */
  non_eu_models_in_use: string[]
}

export type CustomModelsBlock = {
  allowed: boolean
  enabled: boolean
  active: boolean
  models: TenantModelRow[]
  connections: ProviderConnection[]
  presets: Record<ProviderType, ProviderPreset>
  default_chat: string
  default_embedding: string
}

export type SelectableChatModel = {
  slug: string
  display_name: string
  provider?: string
  provider_type?: string
  region?: DataRegion
  tier?: string
  kind: string
  enabled: boolean
  model_id?: string
  is_default_chat?: boolean
  input_cost_per_mtok_cents?: number
  output_cost_per_mtok_cents?: number
  connection_label?: string
}

/** Bokito-first models payload (custom block gated by env + staff entitlement). */
export type TenantModelsPayload = {
  source: 'managed' | 'tenant' | 'platform'
  managed: ManagedAiStatus
  custom_models: CustomModelsBlock
  data_region: DataRegionBlock
  selectable_chat: SelectableChatModel[]
  models: Array<TenantModelRow | CatalogModel | SelectableChatModel>
  connections?: ProviderConnection[]
  presets: Record<ProviderType, ProviderPreset>
  /** Workspace Bokito AI default (automatic or a managed slug). */
  workspace_chat_mode?: WorkspaceChatMode | string
  default_chat: string
  default_embedding: string
  /** Legacy platform-mode fields (may be absent). */
  prefs?: TenantModelPrefs
  byok?: LlmKeyStatus[]
  billable_providers?: string[]
}

export type ProvidersPayload = {
  connections: ProviderConnection[]
  presets: Record<ProviderType, ProviderPreset>
}

export type PlatformKeysPayload = {
  providers: LlmKeyStatus[]
  markup?: number
}

export function selectableChatModels(payload: TenantModelsPayload): SelectableChatModel[] {
  if (Array.isArray(payload.selectable_chat) && payload.selectable_chat.length > 0) {
    return payload.selectable_chat.filter((m) => m.kind === 'chat' && m.enabled !== false)
  }
  // Legacy fallback while older APIs roll out.
  if (payload.source === 'tenant') {
    return (payload.models as TenantModelRow[]).filter((m) => m.kind === 'chat' && m.enabled)
  }
  const tiers = payload.managed?.models
  if (Array.isArray(tiers) && tiers.length > 0) {
    return tiers.map((m) => ({
      slug: m.slug,
      display_name: m.display_name,
      provider: m.provider,
      region: m.region,
      tier: m.tier,
      kind: 'chat',
      enabled: true,
      model_id: '',
      is_default_chat: Boolean(m.is_default_chat),
      input_cost_per_mtok_cents: m.input_cost_per_mtok_cents,
      output_cost_per_mtok_cents: m.output_cost_per_mtok_cents,
    }))
  }
  const managed = payload.managed?.chat
  if (managed?.slug) {
    return [
      {
        slug: managed.slug,
        display_name: managed.display_name,
        provider: managed.provider,
        region: managed.region,
        tier: managed.tier,
        kind: 'chat',
        enabled: true,
        model_id: '',
        is_default_chat: true,
      },
    ]
  }
  return []
}

export function defaultChatSlug(payload: TenantModelsPayload): string {
  return payload.default_chat || payload.managed?.chat?.slug || ''
}

export function workspaceChatMode(payload: TenantModelsPayload): string {
  return (
    payload.workspace_chat_mode ||
    payload.managed?.workspace_chat_mode ||
    AUTOMATIC_MODE
  )
}

export async function setWorkspaceChatMode(token: string, mode: string) {
  return settingsPatch<TenantModelsPayload>(
    settingsRoutes.models.workspaceChatMode,
    { workspace_chat_mode: mode },
    token,
  )
}

/** Normalize agent.model for pickers (empty → inherit). */
export function normalizeAgentChatMode(value: string | null | undefined): string {
  const raw = (value || '').trim().toLowerCase()
  if (!raw || raw === INHERIT_MODE) return INHERIT_MODE
  return raw
}

/** Options for agent default mode: inherit, automatic, then selectable chat models. */
export function agentChatModeOptions(payload: TenantModelsPayload): SelectableChatModel[] {
  const chat = selectableChatModels(payload)
  const modes: SelectableChatModel[] = [
    {
      slug: INHERIT_MODE,
      display_name: 'Workspace default',
      kind: 'chat',
      enabled: true,
      tier: 'inherit',
    },
    {
      slug: AUTOMATIC_MODE,
      display_name: 'Automatic',
      provider: 'bokito',
      kind: 'chat',
      enabled: true,
      tier: 'automatic',
    },
  ]
  const seen = new Set(modes.map((m) => m.slug))
  for (const row of chat) {
    if (seen.has(row.slug)) continue
    seen.add(row.slug)
    modes.push(row)
  }
  return modes
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

export type LlmRuntimeStatus = {
  live: boolean
  mode: 'live' | 'mock'
  keySource: string
  slug: string
}

export async function getLlmRuntime(token: string): Promise<LlmRuntimeStatus> {
  const data = await settingsGet<{
    live?: boolean
    mode?: string
    key_source?: string
    slug?: string
  }>(settingsRoutes.models.runtime, token)
  return {
    live: data.live === true,
    mode: data.mode === 'live' ? 'live' : 'mock',
    keySource: typeof data.key_source === 'string' ? data.key_source : 'mock',
    slug: typeof data.slug === 'string' ? data.slug : '',
  }
}

export async function getTenantModels(token: string) {
  return settingsGet<TenantModelsPayload>(settingsRoutes.models.list, token)
}

export async function setCustomModelsOptIn(token: string, enabled: boolean) {
  return settingsPatch<TenantModelsPayload>(
    settingsRoutes.models.custom,
    { enabled },
    token,
  )
}

export async function setDataRegionPolicy(token: string, policy: DataRegionPolicy) {
  return settingsPatch<TenantModelsPayload>(
    settingsRoutes.models.dataRegion,
    { non_eu_platform_models: policy },
    token,
  )
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
  provider: LlmProvider,
  apiKey: string,
) {
  return staffPut<PlatformKeysPayload>(
    staffRoutes.platformKeys.byProvider(provider),
    { api_key: apiKey },
    token,
  )
}

export async function staffDeletePlatformKey(token: string, provider: LlmProvider) {
  return staffDelete<PlatformKeysPayload>(staffRoutes.platformKeys.byProvider(provider), token)
}

export async function staffSetMarkup(token: string, multiplier: number) {
  return staffPut<{ markup: number }>(staffRoutes.markup, { multiplier }, token)
}

// Re-export for callers that need the workforce path constant
export { WORKFORCE_API_BASE }
