const LAST_PROJECT_KEY_PREFIX = 'bokito_projecthub_last_project_v1'

export function projectHubScopeKey(tenantId: number | null | undefined, tenantSlug?: string | null): string {
  if (tenantId != null && Number.isFinite(tenantId)) return `tenant:${tenantId}`
  const slug = typeof tenantSlug === 'string' ? tenantSlug.trim().toLowerCase() : ''
  return slug ? `slug:${slug}` : 'tenant:unknown'
}

function storageKey(scopeKey: string): string {
  return `${LAST_PROJECT_KEY_PREFIX}:${scopeKey}`
}

export function readLastProjectId(scopeKey: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(storageKey(scopeKey))
    if (!value) return null
    const trimmed = value.trim()
    return trimmed || null
  } catch {
    return null
  }
}

export function writeLastProjectId(scopeKey: string, projectId: string): void {
  if (typeof window === 'undefined') return
  const trimmed = projectId.trim()
  if (!trimmed) return
  try {
    window.localStorage.setItem(storageKey(scopeKey), trimmed)
  } catch {
    // Ignore storage failures (private mode / blocked storage).
  }
}

export function clearLastProjectId(scopeKey: string, projectId?: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (projectId) {
      const current = readLastProjectId(scopeKey)
      if (current !== projectId) return
    }
    window.localStorage.removeItem(storageKey(scopeKey))
  } catch {
    // Ignore storage failures (private mode / blocked storage).
  }
}
