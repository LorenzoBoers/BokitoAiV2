import type { ProjectRow } from './projects-api'

export function formatWorkLogWhen(value?: string | number | null): string {
  if (value == null || value === '' || value === 0) return '-'
  const d = new Date(typeof value === 'number' ? value : value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString()
}

export function projectNameForRun(projects: ProjectRow[], projectId: string): string {
  const id = projectId ?? ''
  return projects.find((p) => p.id === projectId)?.name ?? (id ? id.slice(0, 8) : '—')
}
