import { useAuth } from '../context/AuthContext';
import { PermissionAction } from '../types/custom-db';

/**
 * Hook to check if the current user has permission for a specific action
 * @param action The permission action to check
 * @returns boolean indicating if the user has permission
 */
export function usePermission(action: PermissionAction): boolean {
  const { hasPermission } = useAuth();
  return hasPermission(action);
}