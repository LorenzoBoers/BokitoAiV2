const SUBDOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/

export type WorkspaceSubdomainError = 'required' | 'format' | null

export function normalizeWorkspaceSubdomain(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

export function validateWorkspaceSubdomain(value: string): WorkspaceSubdomainError {
  const v = value.trim().toLowerCase()
  if (!v) return 'required'
  if (v.length < 3 || !SUBDOMAIN_REGEX.test(v)) return 'format'
  return null
}
