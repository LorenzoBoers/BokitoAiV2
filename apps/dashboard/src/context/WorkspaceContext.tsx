import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';
import type { Workspace, WorkspaceInvite } from '../types/custom-db';
import { xanoGet, xanoPost } from '../lib/xano';

const LAST_WORKSPACE_STORAGE_KEY = 'bokito_current_workspace';

interface WorkspaceContextValue {
  currentWorkspace: Workspace | null;
  workspaces: Workspace[];
  workspaceLoading: boolean;
  invites: WorkspaceInvite[];
  
  createWorkspace: (data: { name: string; timezone: string; logo?: string }) => Promise<Workspace>;
  updateWorkspace: (id: number | string, data: Partial<Workspace>) => Promise<void>;
  switchWorkspace: (workspaceId: number | string) => Promise<void>;
  
  inviteUser: (email: string, role: 'admin' | 'member' | 'viewer') => Promise<void>;
  loadInvites: () => Promise<void>;
  
  refreshWorkspaces: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { user, token } = useAuth();
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const workspaceIdKey = useCallback((id: number | string | null | undefined) => String(id ?? ''), []);

  const normalizeWorkspaceList = useCallback((raw: unknown): Workspace[] => {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
        if (!row) return null;
        const rawId =
          row.id ??
          row.workspace_id ??
          row.workspaceId ??
          row.organisation_id ??
          row.organization_id ??
          row.account_id;
        const parsedId =
          typeof rawId === 'number'
            ? rawId
            : typeof rawId === 'string' && rawId.trim()
              ? rawId.trim()
              : null;
        if (parsedId == null) return null;
        const name =
          typeof row.name === 'string' && row.name.trim()
            ? row.name.trim()
            : typeof row.workspace_name === 'string' && row.workspace_name.trim()
              ? row.workspace_name.trim()
              : null;
        if (!name) return null;
        return {
          id: parsedId,
          name,
          slug: typeof row.slug === 'string' && row.slug.trim() ? row.slug.trim() : undefined,
          timezone: typeof row.timezone === 'string' && row.timezone.trim() ? row.timezone.trim() : undefined,
        } satisfies Workspace;
      })
      .filter((workspace): workspace is Workspace => workspace !== null);
  }, []);

  const getTenantFallbackWorkspaceList = useCallback((): Workspace[] => {
    // user.organisationId is the UUID string from /auth/me's organisation_id field.
    // user.tenant.id is always null for UUID-based orgs because toNumber() on a UUID returns null.
    // So we use organisationId as the authoritative source.
    const orgId: string | number | null = user?.organisationId ?? null;
    if (!orgId) return [];
    const tenantName = user?.tenant?.name?.trim();
    if (!tenantName || tenantName.toLowerCase() === 'onbekend') return [];
    return [
      {
        id: orgId,
        name: tenantName,
        slug: user?.tenant?.slug || undefined,
      },
    ];
  }, [user?.organisationId, user?.tenant?.name, user?.tenant?.slug]);

  const resolvePreferredWorkspace = useCallback(
    (workspaceList: Workspace[]): Workspace | null => {
      if (workspaceList.length === 0) return null;

      const fromUser = (() => {
        // Use organisationId (UUID string) as the primary identifier.
        // user.tenant.id is null for UUID-based orgs because it failed number coercion in AuthContext.
        const preferredId = user?.organisationId ?? null;
        if (preferredId != null) {
          return workspaceList.find((workspace) => workspaceIdKey(workspace.id) === workspaceIdKey(preferredId)) ?? null;
        }
        return null;
      })();

      const fromStorage = (() => {
        try {
          const raw = localStorage.getItem(LAST_WORKSPACE_STORAGE_KEY);
          if (!raw) return null;
          return workspaceList.find((workspace) => workspaceIdKey(workspace.id) === raw) ?? null;
        } catch {
          return null;
        }
      })();

      return fromUser ?? fromStorage ?? workspaceList[0] ?? null;
    },
    [user?.organisationId, workspaceIdKey],
  );

  const refreshWorkspaces = useCallback(async () => {
    if (!token) {
      setWorkspaceLoading(false);
      setWorkspaces([]);
      setCurrentWorkspace(null);
      return;
    }

    setWorkspaceLoading(true);
    try {
      const workspaceList = await xanoGet<unknown>('/workspaces', token);
      const safeWorkspaceList = normalizeWorkspaceList(workspaceList);
      const resolvedWorkspaceList = safeWorkspaceList.length > 0 ? safeWorkspaceList : getTenantFallbackWorkspaceList();
      if (safeWorkspaceList.length === 0 && resolvedWorkspaceList.length > 0) {
        console.info('WorkspaceContext: using tenant fallback workspace from auth context');
      }
      setWorkspaces(resolvedWorkspaceList);

      const preferredWorkspace = resolvePreferredWorkspace(resolvedWorkspaceList);
      setCurrentWorkspace(preferredWorkspace);
      if (preferredWorkspace) {
        try {
          localStorage.setItem(LAST_WORKSPACE_STORAGE_KEY, workspaceIdKey(preferredWorkspace.id));
        } catch {
          // Ignore storage failures.
        }
      }
    } catch (error) {
      console.error('Failed to load workspaces:', error);
      const fallbackWorkspaceList = getTenantFallbackWorkspaceList();
      setWorkspaces(fallbackWorkspaceList);
      setCurrentWorkspace(resolvePreferredWorkspace(fallbackWorkspaceList));
    } finally {
      setWorkspaceLoading(false);
    }
  }, [getTenantFallbackWorkspaceList, normalizeWorkspaceList, resolvePreferredWorkspace, token]);

  useEffect(() => {
    void refreshWorkspaces();
  }, [refreshWorkspaces]);

  const createWorkspace = useCallback(async (data: { name: string; timezone: string; logo?: string }) => {
    if (!token) throw new Error('Not authenticated');
    
    const workspace = await xanoPost<Workspace>('/workspaces', data, token);
    setWorkspaces(prev => [...prev, workspace]);
    setCurrentWorkspace(workspace);
    try {
      localStorage.setItem(LAST_WORKSPACE_STORAGE_KEY, String(workspace.id));
    } catch {
      // Ignore storage failures.
    }
    return workspace;
  }, [token]);

  const updateWorkspace = useCallback(async (id: number | string, data: Partial<Workspace>) => {
    if (!token) throw new Error('Not authenticated');
    
    const updated = await xanoPost<Workspace>(`/workspaces/${id}`, data, token);
    setWorkspaces(prev => prev.map(w => (workspaceIdKey(w.id) === workspaceIdKey(id) ? { ...w, ...updated } : w)));
    if (workspaceIdKey(currentWorkspace?.id) === workspaceIdKey(id)) {
      setCurrentWorkspace(prev => prev ? { ...prev, ...updated } : null);
    }
  }, [token, currentWorkspace?.id, workspaceIdKey]);

  const switchWorkspace = useCallback(async (workspaceId: number | string) => {
    const workspace = workspaces.find(w => workspaceIdKey(w.id) === workspaceIdKey(workspaceId));
    if (workspace) {
      setCurrentWorkspace(workspace);
      // Store preference in localStorage
      localStorage.setItem(LAST_WORKSPACE_STORAGE_KEY, workspaceIdKey(workspaceId));
    }
  }, [workspaces, workspaceIdKey]);

  const inviteUser = useCallback(async (email: string, role: 'admin' | 'member' | 'viewer') => {
    if (!token || !currentWorkspace) throw new Error('Not authenticated or no workspace');
    
    await xanoPost('/workspace-invites', {
      workspace_id: currentWorkspace.id,
      email,
      role,
    }, token);
    
    // Refresh invites
    await loadInvites();
  }, [token, currentWorkspace]);

  const loadInvites = useCallback(async () => {
    if (!token || !currentWorkspace) return;
    
    try {
      const inviteList = await xanoGet<WorkspaceInvite[]>(`/workspaces/${currentWorkspace.id}/invites`, token);
      setInvites(Array.isArray(inviteList) ? inviteList : []);
    } catch (error) {
      console.error('Failed to load invites:', error);
      setInvites([]);
    }
  }, [token, currentWorkspace]);

  const value: WorkspaceContextValue = {
    currentWorkspace,
    workspaces,
    workspaceLoading,
    invites,
    createWorkspace,
    updateWorkspace,
    switchWorkspace,
    inviteUser,
    loadInvites,
    refreshWorkspaces,
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}