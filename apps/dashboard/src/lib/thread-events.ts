/** Fields on a `thread_updated` patch that change something an operator can see. */
export function threadPatchHasMeaning(payload?: Record<string, unknown> | null): boolean {
  if (!payload) return false
  if (typeof payload.status === 'string' && payload.status) return true
  if (typeof payload.bulk === 'string' && payload.bulk) return true
  if (payload.assigned_to != null) return true
  if (typeof payload.priority === 'string' && payload.priority) return true
  if (Array.isArray(payload.tags)) return true
  return false
}
