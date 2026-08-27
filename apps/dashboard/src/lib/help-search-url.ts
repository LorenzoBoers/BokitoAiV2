export function parseHelpSearch(value: string | null): string {
  return (value ?? '').trim()
}

export function helpCenterPath(tenantSlug: string, query?: string): string {
  const base = `/help/${tenantSlug}`
  const q = (query ?? '').trim()
  return q ? `${base}?q=${encodeURIComponent(q)}` : base
}
