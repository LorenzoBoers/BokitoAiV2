import { useAuth } from '../context/AuthContext'

const ADMIN_ROLES = new Set(['bokito_admin', 'workspace_admin', 'admin', 'owner'])

export function useIsAdmin(): boolean {
  const { user } = useAuth()
  const role = String((user as { role?: string } | null)?.role ?? '').toLowerCase()
  return ADMIN_ROLES.has(role)
}
